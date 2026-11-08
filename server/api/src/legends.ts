/**
 * Mur des légendes : les meilleurs moments d'un serveur (clips, citations, images).
 *
 * - Citation / image : on épingle un message d'un fil ou d'une pièce (le texte est recopié,
 *   l'image est copiée : la légende reste même si le message est supprimé).
 * - Clip : le fichier .wav du clip est envoyé (POST /attachments) puis rattaché à la légende.
 * Tout membre peut épingler ; celui qui a épinglé, l'auteur du moment et les admins peuvent retirer.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { accessOf, isManager } from "./access.js";
import { requireUser, cleanLabel, authenticate } from "./security.js";
import { attachmentById, claimForHolder, copyAttachment, sweepAttachments, type Attachment } from "./attachments.js";
import { sendToServer } from "./realtime.js";
import { EMOJI_RE } from "./routes-chat.js";

db.exec(`
CREATE TABLE IF NOT EXISTS legends (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,      -- clip | quote | image
  title         TEXT,
  text          TEXT,
  context       TEXT,               -- ex. « #général »
  author_id     TEXT,               -- qui a dit / qui a pris le clip
  author_name   TEXT NOT NULL,
  attachment_id TEXT,
  message_id    TEXT,
  pinned_by     TEXT NOT NULL,
  moment_at     INTEGER NOT NULL,   -- date du moment (message ou clip)
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS legends_by_server ON legends (server_id, created_at);
CREATE TABLE IF NOT EXISTS legend_reactions (
  legend_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (legend_id, user_id, emoji)
);
`);

type LegendRow = {
  id: string;
  server_id: string;
  kind: "clip" | "quote" | "image";
  title: string | null;
  text: string | null;
  context: string | null;
  author_id: string | null;
  author_name: string;
  attachment_id: string | null;
  message_id: string | null;
  pinned_by: string;
  moment_at: number;
  created_at: number;
};

export type Legend = {
  id: string;
  kind: LegendRow["kind"];
  title: string | null;
  text: string | null;
  context: string | null;
  authorId: string | null;
  authorName: string;
  pinnedBy: string;
  momentAt: number;
  createdAt: number;
  attachment: Attachment | null;
  reactions: { emoji: string; count: number; userIds: string[] }[];
};

const MAX_PER_SERVER = 500;

function toLegend(r: LegendRow): Legend {
  const rx = db.prepare("SELECT user_id, emoji FROM legend_reactions WHERE legend_id = ?").all(r.id) as { user_id: string; emoji: string }[];
  const reactions: Legend["reactions"] = [];
  for (const x of rx) {
    let e = reactions.find((y) => y.emoji === x.emoji);
    if (!e) reactions.push((e = { emoji: x.emoji, count: 0, userIds: [] }));
    e.count++;
    e.userIds.push(x.user_id);
  }
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    text: r.text,
    context: r.context,
    authorId: r.author_id,
    authorName: r.author_name,
    pinnedBy: r.pinned_by,
    momentAt: r.moment_at,
    createdAt: r.created_at,
    attachment: attachmentById(r.attachment_id),
    reactions,
  };
}

const legendRow = (id: string) => db.prepare("SELECT * FROM legends WHERE id = ?").get(id) as LegendRow | undefined;

export default async function legendRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/servers/:id/legends", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    if (!accessOf(me, req.params.id)) return reply.code(404).send({ error: "Serveur introuvable." });
    const rows = db.prepare("SELECT * FROM legends WHERE server_id = ? ORDER BY created_at DESC LIMIT 200").all(req.params.id) as LegendRow[];
    return rows.map(toLegend);
  });

  /** Épingler un message (citation, ou image s'il en a une). */
  app.post<{ Params: { id: string }; Body: { messageId?: unknown; title?: unknown } }>("/servers/:id/legends", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const serverId = req.params.id;
    const role = accessOf(me, serverId);
    if (!role || role === "guest") return reply.code(404).send({ error: "Serveur introuvable." });
    const count = (db.prepare("SELECT COUNT(*) AS n FROM legends WHERE server_id = ?").get(serverId) as { n: number }).n;
    if (count >= MAX_PER_SERVER) return reply.code(400).send({ error: "Le mur est plein : retire d'anciennes légendes." });
    const title = req.body?.title === undefined || req.body?.title === "" ? null : cleanLabel(req.body.title, 80);
    if (req.body?.title && !title) return reply.code(400).send({ error: "Titre invalide (80 caractères maximum)." });

    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : "";
    const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as
      | { id: string; scope: string; target: string; author_id: string; author_name: string; guest: number; content: string; created_at: number }
      | undefined;
    if (!msg) return reply.code(404).send({ error: "Message introuvable." });
    // Le message doit venir d'un fil ou d'une pièce de CE serveur.
    const place =
      msg.scope === "channel"
        ? (db.prepare("SELECT server_id, name FROM channels WHERE id = ?").get(msg.target) as { server_id: string; name: string } | undefined)
        : msg.scope === "room"
          ? (db.prepare("SELECT server_id, label AS name FROM rooms WHERE id = ?").get(msg.target) as { server_id: string; name: string } | undefined)
          : undefined;
    if (!place || place.server_id !== serverId) return reply.code(404).send({ error: "Message introuvable." });
    if (db.prepare("SELECT 1 FROM legends WHERE message_id = ?").get(msg.id)) return reply.code(409).send({ error: "Déjà sur le mur." });

    const id = randomUUID();
    const image = db.prepare("SELECT id FROM attachments WHERE message_id = ? AND kind = 'image' ORDER BY created_at LIMIT 1").get(msg.id) as
      | { id: string }
      | undefined;
    const copy = image ? copyAttachment(image.id, `legend:${id}`) : null;
    const text = msg.content.replace(/<@[^>]+>/g, "@…").trim() || null;
    if (!copy && !text) return reply.code(400).send({ error: "Rien à épingler dans ce message." });
    db.prepare(
      `INSERT INTO legends (id, server_id, kind, title, text, context, author_id, author_name, attachment_id, message_id, pinned_by, moment_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      serverId,
      copy ? "image" : "quote",
      title,
      text,
      msg.scope === "channel" ? `#${place.name}` : place.name,
      msg.guest ? null : msg.author_id,
      msg.author_name,
      copy?.id ?? null,
      msg.id,
      me.id,
      msg.created_at,
      Date.now(),
    );
    const legend = toLegend(legendRow(id)!);
    sendToServer(serverId, { type: "legends", serverId });
    return legend;
  });

  /** Mettre un clip au mur (fichier .wav envoyé juste avant). */
  app.post<{ Params: { id: string }; Body: { attachmentId?: unknown; title?: unknown; momentAt?: unknown } }>(
    "/servers/:id/legends/clip",
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const serverId = req.params.id;
      const role = accessOf(me, serverId);
      if (!role || role === "guest") return reply.code(404).send({ error: "Serveur introuvable." });
      const title = cleanLabel(req.body?.title, 80);
      if (!title) return reply.code(400).send({ error: "Donne un titre au clip (80 caractères maximum)." });
      const id = randomUUID();
      const att = claimForHolder(me.id, String(req.body?.attachmentId ?? ""), `legend:${id}`, ["audio"]);
      if (typeof att === "string") return reply.code(400).send({ error: att });
      const momentAt = typeof req.body?.momentAt === "number" && req.body.momentAt < Date.now() + 60_000 ? Math.floor(req.body.momentAt) : Date.now();
      const name = (db.prepare("SELECT COALESCE(display_name, username) AS n FROM users WHERE id = ?").get(me.id) as { n: string }).n;
      db.prepare(
        `INSERT INTO legends (id, server_id, kind, title, text, context, author_id, author_name, attachment_id, message_id, pinned_by, moment_at, created_at)
         VALUES (?, ?, 'clip', ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(id, serverId, title, me.id, name, att.id, me.id, momentAt, Date.now());
      sendToServer(serverId, { type: "legends", serverId });
      return toLegend(legendRow(id)!);
    },
  );

  app.delete<{ Params: { legendId: string } }>("/legends/:legendId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const r = legendRow(req.params.legendId);
    const role = r ? accessOf(me, r.server_id) : undefined;
    if (!r || !role) return reply.code(404).send({ error: "Légende introuvable." });
    if (r.pinned_by !== me.id && r.author_id !== me.id && !isManager(role))
      return reply.code(403).send({ error: "Seuls celui qui a épinglé, l'auteur et les admins peuvent retirer une légende." });
    db.prepare("DELETE FROM legend_reactions WHERE legend_id = ?").run(r.id);
    db.prepare("DELETE FROM legends WHERE id = ?").run(r.id);
    sweepAttachments();
    sendToServer(r.server_id, { type: "legends", serverId: r.server_id });
    return { ok: true };
  });

  app.post<{ Params: { legendId: string }; Body: { emoji?: unknown } }>("/legends/:legendId/reactions", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const r = legendRow(req.params.legendId);
    if (!r || !accessOf(me, r.server_id)) return reply.code(404).send({ error: "Légende introuvable." });
    const emoji = typeof req.body?.emoji === "string" ? req.body.emoji : "";
    if (!EMOJI_RE.test(emoji)) return reply.code(400).send({ error: "Réaction invalide (un emoji)." });
    const had = db.prepare("SELECT 1 FROM legend_reactions WHERE legend_id = ? AND user_id = ? AND emoji = ?").get(r.id, me.id, emoji);
    if (had) db.prepare("DELETE FROM legend_reactions WHERE legend_id = ? AND user_id = ? AND emoji = ?").run(r.id, me.id, emoji);
    else {
      const distinct = (db.prepare("SELECT COUNT(DISTINCT emoji) AS n FROM legend_reactions WHERE legend_id = ?").get(r.id) as { n: number }).n;
      if (distinct >= 20) return reply.code(400).send({ error: "Trop de réactions différentes sur ce message." });
      db.prepare("INSERT INTO legend_reactions (legend_id, user_id, emoji) VALUES (?, ?, ?)").run(r.id, me.id, emoji);
    }
    sendToServer(r.server_id, { type: "legends", serverId: r.server_id });
    return toLegend(r);
  });
}
