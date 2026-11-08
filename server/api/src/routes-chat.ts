/** Salons textuels, chat des salons vocaux, et outils communs aux messages. */
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { db, tx } from "./db.js";
import { attachmentsFor, checkAttachments, linkAttachments, sweepAttachments, type Attachment } from "./attachments.js";
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
  editedAt?: number;
  attachments: Attachment[];
  reactions: Reaction[];
};
/** Réaction agrégée : l'emoji, combien, et qui. */
export type Reaction = { emoji: string; count: number; userIds: string[] };

const MAX_LENGTH = 2000;
const MAX_REACTIONS_PER_MESSAGE = 20;
/** Un emoji (ou une petite séquence d'emojis) : pas de texte libre dans les réactions. */
export const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣#*0-9]|\p{Emoji_Modifier}){1,12}$/u;
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
  edited_at: number | null;
};
const toMessage = (r: Row, attachments: Attachment[] = [], reactions: Reaction[] = []): Message => ({
  id: r.id,
  scope: r.scope,
  target: r.target,
  authorId: r.author_id,
  authorName: r.author_name,
  guest: !!r.guest,
  content: r.content,
  createdAt: r.created_at,
  ...(r.edited_at ? { editedAt: r.edited_at } : {}),
  attachments,
  reactions,
});

/** Réactions de plusieurs messages, regroupées par emoji (dans l'ordre d'arrivée). */
export function reactionsFor(messageIds: string[]): Map<string, Reaction[]> {
  const out = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return out;
  const rows = db
    .prepare(`SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${messageIds.map(() => "?").join(",")}) ORDER BY created_at`)
    .all(...messageIds) as { message_id: string; user_id: string; emoji: string }[];
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    let rx = list.find((x) => x.emoji === r.emoji);
    if (!rx) list.push((rx = { emoji: r.emoji, count: 0, userIds: [] }));
    rx.count++;
    rx.userIds.push(r.user_id);
    out.set(r.message_id, list);
  }
  return out;
}

/** Les 50 derniers messages (ou ceux avant `before`), du plus ancien au plus récent. */
export function listMessages(scope: Scope, target: string, before?: number): Message[] {
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE scope = ? AND target = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(scope, target, before ?? Number.MAX_SAFE_INTEGER, PAGE) as Row[];
  const ids = rows.map((r) => r.id);
  const files = attachmentsFor(ids);
  const reacts = reactionsFor(ids);
  return rows.reverse().map((r) => toMessage(r, files.get(r.id), reacts.get(r.id)));
}

/**
 * Mentions : le client écrit <@id-du-compte>, <@vocal> (ceux en vocal) ou <@tous>.
 * <@tous> est réservé aux admins : sinon il devient du simple texte « @tous ».
 */
function cleanMentions(text: string, canMentionAll: boolean): string {
  return canMentionAll ? text : text.replace(/<@tous>/g, "@tous");
}

/** Corps d'un message envoyé par le client : texte et/ou pièces jointes. */
export type MessageBody = { content?: unknown; attachments?: unknown };

/** Vérifie et enregistre un message. Renvoie une erreur lisible ou le message. */
export function createMessage(
  who: Principal,
  scope: Scope,
  target: string,
  body: MessageBody | undefined,
  canMentionAll = false,
): Message | string {
  const content = body?.content ?? "";
  if (typeof content !== "string") return "Message vide.";
  const text = cleanMentions(content.replace(/\r\n/g, "\n").trim(), canMentionAll);
  const files = checkAttachments(who, body?.attachments);
  if (typeof files === "string") return files;
  if (!text && files.length === 0) return "Message vide.";
  if (text.length > MAX_LENGTH) return `Message trop long (${MAX_LENGTH} caractères maximum).`;
  const id = randomUUID();
  const createdAt = Date.now();
  const attachments = tx(() => {
    db.prepare(
      "INSERT INTO messages (id, scope, target, author_id, author_name, guest, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, scope, target, who.id, who.name, who.kind === "guest" ? 1 : 0, text, createdAt);
    return linkAttachments(id, files);
  });
  return {
    id,
    scope,
    target,
    authorId: who.id,
    authorName: who.name,
    guest: who.kind === "guest",
    content: text,
    createdAt,
    attachments,
    reactions: [],
  };
}

/** Message complet (avec pièces jointes et réactions) pour l'envoyer en direct. */
function fullMessage(id: string): Message | null {
  const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  return toMessage(r, attachmentsFor([id]).get(id), reactionsFor([id]).get(id));
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
    sweepAttachments();
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

  app.post<{ Params: { channelId: string }; Body: MessageBody }>(
    "/channels/:channelId/messages",
    writeLimit,
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const ch = serverOfChannel(req.params.channelId);
      if (!ch || !accessOf(me, ch.server_id)) return notFound(reply);
      const msg = createMessage(me, "channel", ch.id, req.body, isManager(accessOf(me, ch.server_id)));
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

  app.post<{ Params: { roomId: string }; Body: MessageBody }>(
    "/rooms/:roomId/messages",
    writeLimit,
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const room = serverOfRoom(req.params.roomId);
      if (!room || !accessOf(me, room.server_id)) return notFound(reply);
      const msg = createMessage(me, "room", room.id, req.body, isManager(accessOf(me, room.server_id)));
      if (typeof msg === "string") return reply.code(400).send({ error: msg });
      sendToServer(room.server_id, { type: "message", serverId: room.server_id, message: msg });
      return msg;
    },
  );

  // ---- Où envoyer les nouvelles d'un message, et qui peut le lire ------------
  /** Serveur du message (ou null pour un message privé) et droit de lecture de `me`. */
  function placeOf(row: Row, me: Principal): { serverId: string | null; canRead: boolean } {
    if (row.scope === "dm") return { serverId: null, canRead: me.kind === "user" && row.target.split(":").includes(me.id) };
    const serverId = (row.scope === "channel" ? serverOfChannel(row.target) : serverOfRoom(row.target))?.server_id ?? null;
    return { serverId, canRead: !!serverId && !!accessOf(me, serverId) };
  }
  function broadcast(row: Row, serverId: string | null, event: { type: string; [k: string]: unknown }) {
    if (serverId) sendToServer(serverId, { ...event, serverId });
    else row.target.split(":").forEach((u) => sendToUser(u, event));
  }

  // ---- Modifier son message ------------------------------------------------
  app.patch<{ Params: { messageId: string }; Body: { content?: unknown } }>("/messages/:messageId", writeLimit, async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId) as Row | undefined;
    if (!row) return reply.code(404).send({ error: "Message introuvable." });
    if (row.author_id !== me.id) return reply.code(403).send({ error: "Tu ne peux modifier que tes messages." });
    const { serverId } = placeOf(row, me);
    if (typeof req.body?.content !== "string") return reply.code(400).send({ error: "Message vide." });
    const text = cleanMentions(req.body.content.replace(/\r\n/g, "\n").trim(), serverId ? isManager(accessOf(me, serverId)) : false);
    const hasFiles = (attachmentsFor([row.id]).get(row.id) ?? []).length > 0;
    if (!text && !hasFiles) return reply.code(400).send({ error: "Message vide (supprime-le plutôt)." });
    if (text.length > MAX_LENGTH) return reply.code(400).send({ error: `Message trop long (${MAX_LENGTH} caractères maximum).` });
    if (text === row.content) return fullMessage(row.id);
    db.prepare("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?").run(text, Date.now(), row.id);
    const msg = fullMessage(row.id)!;
    broadcast(row, serverId, { type: "messageEdited", message: msg });
    return msg;
  });

  // ---- Réagir (ou retirer sa réaction) --------------------------------------
  app.post<{ Params: { messageId: string }; Body: { emoji?: unknown } }>(
    "/messages/:messageId/reactions",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.messageId) as Row | undefined;
      if (!row) return reply.code(404).send({ error: "Message introuvable." });
      const { serverId, canRead } = placeOf(row, me);
      if (!canRead) return reply.code(404).send({ error: "Message introuvable." });
      const emoji = typeof req.body?.emoji === "string" ? req.body.emoji.trim() : "";
      if (!EMOJI_RE.test(emoji)) return reply.code(400).send({ error: "Réaction invalide (un emoji)." });
      const had = db.prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(row.id, me.id, emoji);
      if (had) {
        db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(row.id, me.id, emoji);
      } else {
        const kinds = db.prepare("SELECT COUNT(DISTINCT emoji) AS n FROM message_reactions WHERE message_id = ?").get(row.id) as { n: number };
        const exists = db.prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND emoji = ?").get(row.id, emoji);
        if (!exists && kinds.n >= MAX_REACTIONS_PER_MESSAGE) return reply.code(400).send({ error: "Trop de réactions différentes sur ce message." });
        db.prepare("INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)").run(row.id, me.id, emoji, Date.now());
      }
      const reactions = reactionsFor([row.id]).get(row.id) ?? [];
      broadcast(row, serverId, { type: "reactions", scope: row.scope, target: row.target, messageId: row.id, reactions });
      return { reactions };
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
    db.prepare("DELETE FROM message_reactions WHERE message_id = ?").run(row.id);
    sweepAttachments(); // ses fichiers partent avec lui
    const event = { type: "messageDeleted", scope: row.scope, target: row.target, id: row.id };
    if (serverId) sendToServer(serverId, event);
    else if (row.scope === "dm") row.target.split(":").forEach((u) => sendToUser(u, event));
    return { ok: true };
  });
}
