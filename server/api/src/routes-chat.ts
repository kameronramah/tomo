/** Salons textuels, chat des salons vocaux, et outils communs aux messages. */
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { accessOf, isManager } from "./access.js";
import { authenticate, cleanLabel, requireUser, type Principal } from "./security.js";
import { sendToServer, sendToUser } from "./realtime.js";

export type Scope = "channel" | "room" | "dm";
export type Message = {
  id: string;
  scope: Scope;
  target: string;
  authorId: string;
  authorName: string;
  guest: boolean;
  content: string;
  createdAt: number;
};

const MAX_LENGTH = 2000;
const PAGE = 50;
const MAX_CHANNELS = 30;

type Row = {
  id: string;
  scope: Scope;
  target: string;
  author_id: string;
  author_name: string;
  guest: number;
  content: string;
  created_at: number;
};
const toMessage = (r: Row): Message => ({
  id: r.id,
  scope: r.scope,
  target: r.target,
  authorId: r.author_id,
  authorName: r.author_name,
  guest: !!r.guest,
  content: r.content,
  createdAt: r.created_at,
});

/** Les 50 derniers messages (ou ceux avant `before`), du plus ancien au plus récent. */
export function listMessages(scope: Scope, target: string, before?: number): Message[] {
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE scope = ? AND target = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(scope, target, before ?? Number.MAX_SAFE_INTEGER, PAGE) as Row[];
  return rows.reverse().map(toMessage);
}

/** Vérifie et enregistre un message. Renvoie une erreur lisible ou le message. */
export function createMessage(who: Principal, scope: Scope, target: string, content: unknown): Message | string {
  if (typeof content !== "string") return "Message vide.";
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return "Message vide.";
  if (text.length > MAX_LENGTH) return `Message trop long (${MAX_LENGTH} caractères maximum).`;
  const msg: Message = {
    id: randomUUID(),
    scope,
    target,
    authorId: who.id,
    authorName: who.name,
    guest: who.kind === "guest",
    content: text,
    createdAt: Date.now(),
  };
  db.prepare(
    "INSERT INTO messages (id, scope, target, author_id, author_name, guest, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(msg.id, scope, target, msg.authorId, msg.authorName, msg.guest ? 1 : 0, msg.content, msg.createdAt);
  return msg;
}

const parseBefore = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

function serverOfChannel(channelId: string) {
  return db.prepare("SELECT id, server_id, name FROM channels WHERE id = ?").get(channelId) as
    | { id: string; server_id: string; name: string }
    | undefined;
}
function serverOfRoom(roomId: string) {
  return db.prepare("SELECT id, server_id FROM rooms WHERE id = ?").get(roomId) as { id: string; server_id: string } | undefined;
}

function notFound(reply: FastifyReply, what = "Salon introuvable.") {
  return reply.code(404).send({ error: what });
}

/** Nom de salon textuel : minuscules, tirets à la place des espaces (style « # général »). */
function cleanChannelName(v: unknown): string | null {
  const label = cleanLabel(v, 32);
  return label ? label.toLowerCase().replace(/\s+/g, "-") : null;
}

export default async function chatRoutes(app: FastifyInstance) {
  const writeLimit = { config: { rateLimit: { max: 20, timeWindow: "10 seconds" } } };

  // ---- Salons textuels -----------------------------------------------------
  app.get<{ Params: { id: string } }>("/servers/:id/channels", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    if (!accessOf(me, req.params.id)) return notFound(reply, "Serveur introuvable.");
    return db.prepare("SELECT id, name FROM channels WHERE server_id = ? ORDER BY position, rowid").all(req.params.id);
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>("/servers/:id/channels", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = accessOf(me, req.params.id);
    if (!role) return notFound(reply, "Serveur introuvable.");
    if (!isManager(role)) return reply.code(403).send({ error: "Seuls les admins du serveur peuvent faire ça." });
    const name = cleanChannelName(req.body?.name);
    if (!name) return reply.code(400).send({ error: "Nom de salon invalide (1 à 32 caractères)." });
    const count = (db.prepare("SELECT COUNT(*) AS n, MAX(position) AS p FROM channels WHERE server_id = ?").get(req.params.id) as {
      n: number;
      p: number | null;
    });
    if (count.n >= MAX_CHANNELS) return reply.code(400).send({ error: "Trop de salons textuels." });
    const channel = { id: randomUUID(), name };
    db.prepare("INSERT INTO channels (id, server_id, name, position) VALUES (?, ?, ?, ?)").run(
      channel.id,
      req.params.id,
      name,
      (count.p ?? -1) + 1,
    );
    sendToServer(req.params.id, { type: "channels", serverId: req.params.id });
    return channel;
  });

  app.patch<{ Params: { channelId: string }; Body: { name?: unknown } }>("/channels/:channelId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const ch = serverOfChannel(req.params.channelId);
    if (!ch || !accessOf(me, ch.server_id)) return notFound(reply);
    if (!isManager(accessOf(me, ch.server_id))) return reply.code(403).send({ error: "Seuls les admins du serveur peuvent faire ça." });
    const name = cleanChannelName(req.body?.name);
    if (!name) return reply.code(400).send({ error: "Nom de salon invalide (1 à 32 caractères)." });
    db.prepare("UPDATE channels SET name = ? WHERE id = ?").run(name, ch.id);
    sendToServer(ch.server_id, { type: "channels", serverId: ch.server_id });
    return { ok: true };
  });

  app.delete<{ Params: { channelId: string } }>("/channels/:channelId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const ch = serverOfChannel(req.params.channelId);
    if (!ch || !accessOf(me, ch.server_id)) return notFound(reply);
    if (!isManager(accessOf(me, ch.server_id))) return reply.code(403).send({ error: "Seuls les admins du serveur peuvent faire ça." });
    db.prepare("DELETE FROM messages WHERE scope = 'channel' AND target = ?").run(ch.id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(ch.id);
    sendToServer(ch.server_id, { type: "channels", serverId: ch.server_id });
    return { ok: true };
  });

  // ---- Messages des salons textuels ---------------------------------------
  app.get<{ Params: { channelId: string }; Querystring: { before?: string } }>(
    "/channels/:channelId/messages",
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const ch = serverOfChannel(req.params.channelId);
      if (!ch || !accessOf(me, ch.server_id)) return notFound(reply);
      return listMessages("channel", ch.id, parseBefore(req.query.before));
    },
  );

  app.post<{ Params: { channelId: string }; Body: { content?: unknown } }>(
    "/channels/:channelId/messages",
    writeLimit,
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const ch = serverOfChannel(req.params.channelId);
      if (!ch || !accessOf(me, ch.server_id)) return notFound(reply);
      const msg = createMessage(me, "channel", ch.id, req.body?.content);
      if (typeof msg === "string") return reply.code(400).send({ error: msg });
      sendToServer(ch.server_id, { type: "message", serverId: ch.server_id, message: msg });
      return msg;
    },
  );

  // ---- Chat des salons vocaux ---------------------------------------------
  app.get<{ Params: { roomId: string }; Querystring: { before?: string } }>("/rooms/:roomId/messages", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const room = serverOfRoom(req.params.roomId);
    if (!room || !accessOf(me, room.server_id)) return notFound(reply);
    return listMessages("room", room.id, parseBefore(req.query.before));
  });

  app.post<{ Params: { roomId: string }; Body: { content?: unknown } }>(
    "/rooms/:roomId/messages",
    writeLimit,
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const room = serverOfRoom(req.params.roomId);
      if (!room || !accessOf(me, room.server_id)) return notFound(reply);
      const msg = createMessage(me, "room", room.id, req.body?.content);
      if (typeof msg === "string") return reply.code(400).send({ error: msg });
      sendToServer(room.server_id, { type: "message", serverId: room.server_id, message: msg });
      return msg;
    },
  );

  // ---- Supprimer un message (auteur, ou admin du serveur) ------------------
  app.delete<{ Params: { messageId: string } }>("/messages/:messageId", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId) as Row | undefined;
    if (!row) return reply.code(404).send({ error: "Message introuvable." });
    let serverId: string | undefined;
    if (row.scope === "channel") serverId = serverOfChannel(row.target)?.server_id;
    if (row.scope === "room") serverId = serverOfRoom(row.target)?.server_id;
    const mine = row.author_id === me.id;
    const canModerate = serverId ? isManager(accessOf(me, serverId)) : false;
    if (!mine && !canModerate) return reply.code(403).send({ error: "Tu ne peux pas supprimer ce message." });
    db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    const event = { type: "messageDeleted", scope: row.scope, target: row.target, id: row.id };
    if (serverId) sendToServer(serverId, event);
    else if (row.scope === "dm") row.target.split(":").forEach((u) => sendToUser(u, event));
    return { ok: true };
  });
}
