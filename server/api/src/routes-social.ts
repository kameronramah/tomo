/** Amis, messages privés et appels privés. */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { db } from "./db.js";
import { config } from "./config.js";
import { areFriends, isBlocked, pair } from "./access.js";
import { requireUser } from "./security.js";
import { isOnline, presenceOf, sendToUser } from "./realtime.js";
import { canAddFriend, canCall, canMessage, displayNameOf, dmState, lightProfile, setDmState, userRow } from "./profiles.js";
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
    return rows.map((r) => {
      const p = lightProfile(userRow(r.other_id)!);
      const friend = r.status === "accepted";
      return {
        id: r.other_id,
        username: r.other_name,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        status: friend ? "friend" : r.requested_by === me.id ? "outgoing" : "incoming",
        presence: friend ? p.status : "offline",
        customStatus: friend ? p.customStatus : null,
        online: friend ? isOnline(r.other_id) : false,
        since: r.created_at,
      };
    });
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
      // Accepter une demande reçue reste toujours possible ; sinon on respecte le réglage de l'autre.
      if (isBlocked(me.id, target.id)) return reply.code(403).send({ error: "Impossible d'ajouter cette personne." });
      if (!existing && !canAddFriend(me.id, target.id))
        return reply.code(403).send({ error: "Cette personne n'accepte pas les demandes d'ami de ta part." });
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
  // Messages privés : entre amis, ou avec des non-amis selon le réglage
  // « Qui peut m'écrire » du destinataire. Un non-ami arrive dans les « Demandes ».
  // -------------------------------------------------------------------------
  const dmTarget = (a: string, b: string) => pair(a, b).join(":");
  const hasConversation = (a: string, b: string) =>
    !!db.prepare("SELECT 1 FROM messages WHERE scope = 'dm' AND target = ? LIMIT 1").get(dmTarget(a, b));

  /** La conversation est-elle une « demande » pour `me` (non-ami, pas encore acceptée) ? */
  const isRequestFor = (me: string, other: string) => !areFriends(me, other) && dmState(me, other) !== "accepted";

  app.get<{ Params: { userId: string }; Querystring: { before?: string } }>("/dm/:userId/messages", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const other = req.params.userId;
    if (isBlocked(me.id, other)) return reply.code(403).send({ error: "Conversation indisponible." });
    if (!areFriends(me.id, other) && !hasConversation(me.id, other) && !canMessage(me.id, other))
      return reply.code(403).send({ error: "Cette personne n'accepte pas les messages de ta part." });
    const before = req.query.before && /^\d+$/.test(req.query.before) ? Number(req.query.before) : undefined;
    return listMessages("dm", dmTarget(me.id, other), before);
  });

  app.post<{ Params: { userId: string }; Body: MessageBody }>(
    "/dm/:userId/messages",
    { config: { rateLimit: { max: 20, timeWindow: "10 seconds" } } },
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const other = req.params.userId;
      if (!userRow(other)) return reply.code(404).send({ error: "Compte introuvable." });
      if (!canMessage(me.id, other)) return reply.code(403).send({ error: "Cette personne n'accepte pas les messages de ta part." });
      // Répondre à quelqu'un vaut acceptation de sa demande.
      if (!areFriends(me.id, other) && dmState(me.id, other) !== "accepted") setDmState(me.id, other, "accepted");
      const msg = createMessage(me, "dm", dmTarget(me.id, other), req.body);
      if (typeof msg === "string") return reply.code(400).send({ error: msg });
      const event = { type: "message", message: msg };
      // Une demande ignorée ne dérange plus : on n'envoie rien en direct au destinataire.
      if (dmState(other, me.id) !== "ignored") sendToUser(other, event);
      sendToUser(me.id, event);
      return msg;
    },
  );

  /** Accepter / ignorer la demande de message de quelqu'un. */
  app.post<{ Params: { userId: string; action: string } }>("/dm/:userId/:action", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (req.params.action !== "accept" && req.params.action !== "ignore") return reply.code(404).send({ error: "Action inconnue." });
    setDmState(me.id, req.params.userId, req.params.action === "accept" ? "accepted" : "ignored");
    sendToUser(me.id, { type: "friends" });
    return { ok: true };
  });

  /** Conversations privées : dernier message, et si c'est une demande (non-ami) ou ignorée. */
  app.get("/dm", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const rows = db
      .prepare(
        `SELECT target, MAX(created_at) AS last FROM messages
         WHERE scope = 'dm' AND (target LIKE ? OR target LIKE ?) GROUP BY target`,
      )
      .all(`${me.id}:%`, `%:${me.id}`) as { target: string; last: number }[];
    return rows
      .map((r) => {
        const userId = r.target.split(":").find((id) => id !== me.id)!;
        const u = userRow(userId);
        if (!u || isBlocked(me.id, userId)) return null;
        // Une demande n'existe que si l'autre m'a écrit (pas si c'est moi qui ai écrit le premier).
        const theyWrote = !!db.prepare("SELECT 1 FROM messages WHERE scope = 'dm' AND target = ? AND author_id = ? LIMIT 1").get(r.target, userId);
        const request = isRequestFor(me.id, userId) && theyWrote && !db.prepare("SELECT 1 FROM messages WHERE scope = 'dm' AND target = ? AND author_id = ? LIMIT 1").get(r.target, me.id);
        return {
          userId,
          lastMessageAt: r.last,
          request,
          ignored: dmState(me.id, userId) === "ignored",
          friend: areFriends(me.id, userId),
          profile: lightProfile(u),
        };
      })
      .filter((x) => x !== null);
  });

  // -------------------------------------------------------------------------
  // Appels privés
  // -------------------------------------------------------------------------
  app.post<{ Params: { userId: string } }>("/calls/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!canCall(me.id, req.params.userId)) return reply.code(403).send({ error: "Cette personne n'accepte pas les appels de ta part." });
    if (!isOnline(req.params.userId)) return reply.code(409).send({ error: "Cette personne n'est pas connectée." });
    if (presenceOf(req.params.userId) === "dnd") return reply.code(409).send({ error: "Cette personne est en « Ne pas déranger »." });
    const other = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.userId) as { id: string; username: string };
    const myName = displayNameOf(me.id) ?? me.name;
    const call: Call = {
      id: randomUUID(),
      from: { id: me.id, name: myName },
      to: { id: other.id, name: displayNameOf(other.id) ?? other.username },
      state: "ringing",
    };
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
