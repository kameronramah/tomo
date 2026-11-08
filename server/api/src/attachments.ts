/**
 * Pièces jointes des messages : images (dont GIF animés), messages vocaux, fichiers.
 *
 * Parcours : le client envoie d'abord le fichier (POST /attachments, corps binaire brut),
 * reçoit un identifiant, puis envoie son message avec la liste des identifiants.
 *
 * Sécurité :
 * - le type est déduit des premiers octets du fichier, jamais de ce que dit le client ;
 * - seuls PNG / JPEG / GIF / WebP sont affichés comme images (pas de SVG : il peut contenir du script) ;
 * - tout le reste est servi en téléchargement (« attachment » + nosniff) ;
 * - l'adresse d'un fichier contient une signature HMAC : impossible à deviner, sans jeton à
 *   passer dans <img src> ; elle n'est connue que des gens qui peuvent lire le message ;
 * - un fichier non rattaché à un message après 24 h, ou dont le message a été supprimé, est effacé.
 */
import type { FastifyInstance } from "fastify";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, createReadStream, existsSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./db.js";
import { config } from "./config.js";
import { authenticate, type Principal } from "./security.js";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PER_MESSAGE = 10;
const MAX_VOICE_MS = 5 * 60 * 1000;
const UNLINKED_TTL_MS = 24 * 60 * 60 * 1000;

const uploadDir = join(config.dataDir, "uploads");
mkdirSync(uploadDir, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  message_id  TEXT,
  kind        TEXT NOT NULL,   -- image | audio | file
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  waveform    TEXT,            -- message vocal : 48 niveaux 0-9, pour dessiner l'onde
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_by_message ON attachments (message_id);
`);

export type Attachment = {
  id: string;
  kind: "image" | "audio" | "file";
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: string;
  /** Chemin relatif à l'adresse de l'instance. */
  url: string;
};

type Row = {
  id: string;
  owner_id: string;
  message_id: string | null;
  kind: Attachment["kind"];
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  waveform: string | null;
  created_at: number;
};

const sign = (id: string) => createHmac("sha256", config.jwtSecret).update(`file:${id}`).digest("base64url").slice(0, 32);

function validSig(id: string, sig: string) {
  const a = Buffer.from(sign(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const toAttachment = (r: Row): Attachment => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  mime: r.mime,
  size: r.size,
  ...(r.width ? { width: r.width } : {}),
  ...(r.height ? { height: r.height } : {}),
  ...(r.duration_ms ? { durationMs: r.duration_ms } : {}),
  ...(r.waveform ? { waveform: r.waveform } : {}),
  url: `/files/${r.id}/${sign(r.id)}/${encodeURIComponent(r.name)}`,
});

/** Type réel du fichier d'après ses premiers octets. */
function sniff(buf: Buffer): { kind: Attachment["kind"]; mime: string } {
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return { kind: "image", mime: "image/png" };
  if (hex.startsWith("ffd8ff")) return { kind: "image", mime: "image/jpeg" };
  if (hex.startsWith("474946383761") || hex.startsWith("474946383961")) return { kind: "image", mime: "image/gif" };
  if (hex.startsWith("52494646") && buf.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  if (hex.startsWith("1a45dfa3")) return { kind: "audio", mime: "audio/webm" }; // WebM (Opus) : messages vocaux
  if (hex.startsWith("4f676753")) return { kind: "audio", mime: "audio/ogg" };
  return { kind: "file", mime: "application/octet-stream" };
}

/** Nom de fichier affichable : pas de chemin, pas de caractères de contrôle, 120 caractères max. */
function cleanName(v: unknown, fallback: string) {
  const raw = typeof v === "string" ? v : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim().slice(0, 120);
  return name || fallback;
}

const intOrNull = (v: unknown, max: number) => {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
};

/** Pièces jointes de plusieurs messages d'un coup (pour l'affichage d'une page de messages). */
export function attachmentsFor(messageIds: string[]): Map<string, Attachment[]> {
  const out = new Map<string, Attachment[]>();
  if (messageIds.length === 0) return out;
  const rows = db
    .prepare(`SELECT * FROM attachments WHERE message_id IN (${messageIds.map(() => "?").join(",")}) ORDER BY created_at`)
    .all(...messageIds) as Row[];
  for (const r of rows) {
    const list = out.get(r.message_id!) ?? [];
    list.push(toAttachment(r));
    out.set(r.message_id!, list);
  }
  return out;
}

/**
 * Vérifie que les pièces jointes demandées appartiennent à l'auteur et ne sont pas déjà utilisées.
 * Renvoie un message d'erreur, ou la liste des lignes à rattacher.
 */
export function checkAttachments(who: Principal, ids: unknown): Row[] | string {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) return "Pièces jointes invalides.";
  const unique = [...new Set(ids as string[])];
  if (unique.length > MAX_PER_MESSAGE) return `${MAX_PER_MESSAGE} pièces jointes maximum par message.`;
  const rows: Row[] = [];
  for (const id of unique) {
    const r = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Row | undefined;
    if (!r || r.owner_id !== who.id || r.message_id) return "Pièce jointe introuvable (renvoie le fichier).";
    rows.push(r);
  }
  return rows;
}

export function linkAttachments(messageId: string, rows: Row[]): Attachment[] {
  const stmt = db.prepare("UPDATE attachments SET message_id = ? WHERE id = ?");
  for (const r of rows) stmt.run(messageId, r.id);
  return rows.map((r) => toAttachment({ ...r, message_id: messageId }));
}

/** Enregistre un fichier reçu (envoi direct, ou GIF récupéré chez Klipy). */
export async function saveAttachment(
  me: Principal,
  body: Buffer,
  meta: { name?: string; durationMs?: string; width?: string; height?: string; waveform?: string },
): Promise<Attachment> {
  const { kind, mime } = sniff(body);
  const id = randomUUID();
  const name = cleanName(meta.name, kind === "audio" ? "message-vocal.webm" : "fichier");
  const waveform = kind === "audio" && /^[0-9]{1,96}$/.test(meta.waveform ?? "") ? meta.waveform! : null;
  const row: Row = {
    id,
    owner_id: me.id,
    message_id: null,
    kind,
    name,
    mime,
    size: body.length,
    width: kind === "image" ? intOrNull(meta.width, 20000) : null,
    height: kind === "image" ? intOrNull(meta.height, 20000) : null,
    duration_ms: kind === "audio" ? intOrNull(meta.durationMs, MAX_VOICE_MS) : null,
    waveform,
    created_at: Date.now(),
  };
  await writeFile(join(uploadDir, id), body);
  db.prepare(
    `INSERT INTO attachments (id, owner_id, message_id, kind, name, mime, size, width, height, duration_ms, waveform, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, me.id, kind, name, mime, row.size, row.width, row.height, row.duration_ms, waveform, row.created_at);
  return toAttachment(row);
}

/** Adresse d'une pièce jointe (photo de profil, bannière…), ou null si elle n'existe plus. */
export function attachmentUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  const r = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Row | undefined;
  return r ? toAttachment(r).url : null;
}

/**
 * Réserve une image envoyée pour le profil (photo / bannière) : elle ne sera plus effacée
 * tant qu'elle sert. Renvoie un message d'erreur, ou null si c'est bon.
 */
export function claimProfileImage(userId: string, attachmentId: string): string | null {
  const r = db.prepare("SELECT * FROM attachments WHERE id = ?").get(attachmentId) as Row | undefined;
  if (!r || r.owner_id !== userId || r.message_id) return "Image introuvable (renvoie-la).";
  if (r.kind !== "image") return "Ce fichier n'est pas une image (PNG, JPG, GIF ou WebP).";
  if (r.size > 8 * 1024 * 1024) return "Image trop lourde pour un profil (8 Mo maximum).";
  db.prepare("UPDATE attachments SET message_id = ? WHERE id = ?").run(`profile:${userId}`, attachmentId);
  return null;
}

/** Efface les fichiers orphelins : message supprimé, image de profil remplacée, ou jamais envoyé après 24 h. */
export function sweepAttachments() {
  const rows = db
    .prepare(
      `SELECT id FROM attachments
       WHERE (message_id IS NOT NULL AND message_id NOT LIKE 'profile:%' AND message_id NOT IN (SELECT id FROM messages))
          OR (message_id LIKE 'profile:%' AND id NOT IN (
                SELECT avatar_id FROM users WHERE avatar_id IS NOT NULL
                UNION SELECT banner_id FROM users WHERE banner_id IS NOT NULL))
          OR (message_id IS NULL AND created_at < ?)`,
    )
    .all(Date.now() - UNLINKED_TTL_MS) as { id: string }[];
  for (const { id } of rows) {
    try {
      unlinkSync(join(uploadDir, id));
    } catch {
      // déjà absent
    }
    db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  }
  return rows.length;
}

export default async function attachmentRoutes(app: FastifyInstance) {
  sweepAttachments();
  const timer = setInterval(sweepAttachments, 60 * 60 * 1000);
  timer.unref();

  // Corps binaire brut, uniquement pour cette route (le reste de l'API n'accepte que du JSON léger).
  await app.register(async (sub) => {
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_FILE_BYTES }, (_req, body, done) => done(null, body));

    sub.post<{ Querystring: { name?: string; durationMs?: string; width?: string; height?: string; waveform?: string } }>(
      "/attachments",
      { bodyLimit: MAX_FILE_BYTES, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const me = await authenticate(req, reply);
        if (!me) return;
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "Fichier vide." });
        return saveAttachment(me, body, req.query);
      },
    );
  });

  // Lecture d'un fichier : l'adresse signée suffit (utilisable directement dans <img> / <audio>).
  app.get<{ Params: { id: string; sig: string; name: string } }>("/files/:id/:sig/:name", async (req, reply) => {
    const { id, sig } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id) || !validSig(id, sig)) return reply.code(404).send({ error: "Fichier introuvable." });
    const r = db.prepare("SELECT * FROM attachments WHERE id = ? AND message_id IS NOT NULL").get(id) as Row | undefined;
    const path = join(uploadDir, id);
    if (!r || !existsSync(path)) return reply.code(404).send({ error: "Fichier introuvable." });
    reply
      .header("Content-Type", r.mime)
      .header("Content-Length", r.size)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header(
        "Content-Disposition",
        `${r.kind === "file" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(r.name)}`,
      );
    return reply.send(createReadStream(path));
  });
}
