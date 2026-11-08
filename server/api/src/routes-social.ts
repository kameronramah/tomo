/** Amis, messages privés et appels privés. */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { db } from "./db.js";
import { config } from "./config.js";
import { areFriends, pair } from "./access.js";
import { requireUser } from "./security.js";
import { isOnline, sendToUser } from "./realtime.js";
import { createMessage, listMessages, type MessageBody } from "./routes-chat.js";
import { closeRooms } from "./livekit.js";

type FriendRow = { user_a: string; user_b: string; status: string; requested_by: string; created_at: number };

const RING_TIMEOUT_MS = 30_000;

/** Appels en cours (en mémoire : un redémarrage de l'API coupe la sonnerie, pas l'appel LiveKit). */
type Call = {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  state: "ringing" | "active";
  timer?: NodeJS.Timeout;
};
const calls = new Map<string, Call>();

function callRoom(id: string) {
  return `call-${id}`;
}

async function callToken(callId: string, user: { id: string; name: string }) {
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `u:${user.id}`,
    name: user.name,
    ttl: "6h",
  });
  token.addGrant({ room: callRoom(callId), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
  return token.toJwt();
}

function endCall(call: Call, reason: "ended" | "declined" | "missed" | "cancelled") {
  if (call.timer) clearTimeout(call.timer);
  calls.delete(call.id);
  const event = { type: "callEnded", callId: call.id, reason };
  sendToUser(call.from.id, event);
  sendToUser(call.to.id, event);
  void closeRooms([callRoom(call.id)]);
}

function userByName(username: string) {
  return db.prepare("SELECT id, username FROM users WHERE username = ? AND is_test = 0").get(username.normalize("NFKC").trim()) as
    | { id: string; username: string }
    | undefined;
}

export default async function socialRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Amis
  // -------------------------------------------------------------------------

  /** Mes amis (avec présence) et demandes en attente (reçues / envoyées). */
  app.get("/friends", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const rows = db
      .prepare(
        `SELECT f.*, u.id AS other_id, u.username AS other_name
         FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
         WHERE f.user_a = ? OR f.user_b = ? ORDER BY u.username`,
      )
      .all(me.id, me.id, me.id) as (FriendRow & { other_id: string; other_name: string })[];
    return rows.map((r) => ({
      id: r.other_id,
      username: r.other_name,
      status: r.status === "accepted" ? "friend" : r.requested_by === me.id ? "outgoing" : "incoming",
      online: r.status === "accepted" ? isOnline(r.other_id) : false,
      since: r.created_at,
    }));
  });

  /** Envoyer une demande d'ami par pseudo (ou accepter si l'autre l'a déjà demandé). */
  app.post<{ Body: { username?: unknown } }>(
    "/friends",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const target = typeof req.body?.username === "string" ? userByName(req.body.username) : undefined;
      if (!target) return reply.code(404).send({ error: "Aucun compte avec ce pseudo." });
      if (target.id === me.id) return reply.code(400).send({ error: "Tu ne peux pas t'ajouter toi-même 🙂" });
      const [a, b] = pair(me.id, target.id);
      const existing = db.prepare("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b) as FriendRow | undefined;
      if (existing?.status === "accepted") return reply.code(409).send({ error: "Vous êtes déjà amis." });
      if (existing && existing.requested_by === me.id) return reply.code(409).send({ error: "Demande déjà envoyée." });
      if (existing) {
        db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?").run(a, b);
        sendToUser(target.id, { type: "friends" });
        sendToUser(me.id, { type: "friends" });
        return { status: "friend" };
      }
      db.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").run(
        a,
        b,
        me.id,
        Date.now(),
      );
      sendToUser(target.id, { type: "friends", request: { from: me.name } });
      return { status: "outgoing" };
    },
  );

  app.post<{ Params: { userId: string } }>("/friends/:userId/accept", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const [a, b] = pair(me.id, req.params.userId);
    const row = db.prepare("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b) as FriendRow | undefined;
    if (!row || row.status !== "pending" || row.requested_by === me.id)
      return reply.code(404).send({ error: "Demande introuvable." });
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?").run(a, b);
    sendToUser(req.params.userId, { type: "friends", accepted: { by: me.name } });
    sendToUser(me.id, { type: "friends" });
    return { ok: true };
  });

  /** Retirer un ami, refuser ou annuler une demande. */
  app.delete<{ Params: { userId: string } }>("/friends/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const [a, b] = pair(me.id, req.params.userId);
    db.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").run(a, b);
    sendToUser(req.params.userId, { type: "friends" });
    sendToUser(me.id, { type: "friends" });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Messages privés (entre amis uniquement)
  // -------------------------------------------------------------------------
  app.get<{ Params: { userId: string }; Querystring: { before?: string } }>("/dm/:userId/messages", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!areFriends(me.id, req.params.userId)) return reply.code(403).send({ error: "Vous devez être amis pour discuter." });
    const before = req.query.before && /^\d+$/.test(req.query.before) ? Number(req.query.before) : undefined;
    return listMessages("dm", pair(me.id, req.params.userId).join(":"), before);
  });

  app.post<{ Params: { userId: string }; Body: MessageBody }>(
    "/dm/:userId/messages",
    { config: { rateLimit: { max: 20, timeWindow: "10 seconds" } } },
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      if (!areFriends(me.id, req.params.userId)) return reply.code(403).send({ error: "Vous devez être amis pour discuter." });
      const msg = createMessage(me, "dm", pair(me.id, req.params.userId).join(":"), req.body);
      if (typeof msg === "string") return reply.code(400).send({ error: msg });
      const event = { type: "message", message: msg };
      sendToUser(req.params.userId, event);
      sendToUser(me.id, event);
      return msg;
    },
  );

  /** Dernier message de chaque conversation privée (pour la liste et les non-lus). */
  app.get("/dm", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const rows = db
      .prepare(
        `SELECT target, MAX(created_at) AS last FROM messages
         WHERE scope = 'dm' AND (target LIKE ? OR target LIKE ?) GROUP BY target`,
      )
      .all(`${me.id}:%`, `%:${me.id}`) as { target: string; last: number }[];
    return rows.map((r) => ({ userId: r.target.split(":").find((id) => id !== me.id)!, lastMessageAt: r.last }));
  });

  // -------------------------------------------------------------------------
  // Appels privés
  // -------------------------------------------------------------------------
  app.post<{ Params: { userId: string } }>("/calls/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!areFriends(me.id, req.params.userId)) return reply.code(403).send({ error: "Vous devez être amis pour vous appeler." });
    if (!isOnline(req.params.userId)) return reply.code(409).send({ error: "Ton ami n'est pas connecté." });
    const other = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.userId) as { id: string; username: string };
    const call: Call = { id: randomUUID(), from: { id: me.id, name: me.name }, to: { id: other.id, name: other.username }, state: "ringing" };
    call.timer = setTimeout(() => calls.has(call.id) && call.state === "ringing" && endCall(call, "missed"), RING_TIMEOUT_MS);
    calls.set(call.id, call);
    sendToUser(other.id, { type: "callIncoming", callId: call.id, from: call.from });
    return { callId: call.id, url: config.livekit.url, token: await callToken(call.id, call.from), with: call.to };
  });

  app.post<{ Params: { callId: string } }>("/calls/:callId/accept", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const call = calls.get(req.params.callId);
    if (!call || call.to.id !== me.id || call.state !== "ringing") return reply.code(404).send({ error: "Cet appel n'est plus disponible." });
    call.state = "active";
    if (call.timer) clearTimeout(call.timer);
    sendToUser(call.from.id, { type: "callAccepted", callId: call.id });
    return { callId: call.id, url: config.livekit.url, token: await callToken(call.id, call.to), with: call.from };
  });

  app.post<{ Params: { callId: string } }>("/calls/:callId/decline", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const call = calls.get(req.params.callId);
    if (call && (call.to.id === me.id || call.from.id === me.id)) endCall(call, call.from.id === me.id ? "cancelled" : "declined");
    return { ok: true };
  });

  app.post<{ Params: { callId: string } }>("/calls/:callId/end", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const call = calls.get(req.params.callId);
    if (call && (call.to.id === me.id || call.from.id === me.id)) endCall(call, call.state === "ringing" ? "cancelled" : "ended");
    return { ok: true };
  });
}
