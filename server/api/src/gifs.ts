/**
 * Recherche de GIF via Klipy (remplaçant de Tenor, gratuit). Clé : KLIPY_API_KEY dans .env.
 *
 * - Le serveur interroge Klipy à la place du client : la clé reste secrète et Klipy ne voit
 *   qu'un identifiant anonyme (haché) par personne, jamais le pseudo.
 * - Quand on envoie un GIF, le serveur le télécharge et le range comme une image jointe :
 *   les autres le reçoivent depuis l'instance, pas depuis Klipy.
 * - Seules les adresses de Klipy sont acceptées (pas de téléchargement d'adresses arbitraires).
 */
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { authenticate } from "./security.js";
import { saveAttachment } from "./attachments.js";

const API = "https://api.klipy.com/api/v1";
const MAX_GIF_BYTES = 15 * 1024 * 1024;

type Media = { url: string; width: number; height: number; size?: number };
type KlipyItem = { id: number | string; title?: string; slug?: string; file?: Record<string, Record<string, Media | undefined> | undefined> };

export type Gif = { id: string; title: string; preview: Media; full: Media };

const pick = (it: KlipyItem, sizes: string[], formats: string[]): Media | null => {
  for (const s of sizes) for (const f of formats) {
    const m = it.file?.[s]?.[f];
    if (m?.url) return { url: m.url, width: m.width, height: m.height, size: m.size };
  }
  return null;
};

function toGif(it: KlipyItem): Gif | null {
  const preview = pick(it, ["sm", "xs", "md"], ["webp", "gif"]);
  const full = pick(it, ["md", "sm", "hd"], ["gif"]);
  if (!preview || !full) return null;
  return { id: String(it.id), title: (it.title || it.slug || "GIF").slice(0, 80), preview, full };
}

function isKlipyUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "klipy.com" || u.hostname.endsWith(".klipy.com"));
  } catch {
    return false;
  }
}

export default async function gifRoutes(app: FastifyInstance) {
  const key = config.klipyKey;

  app.get<{ Querystring: { q?: string; page?: string } }>(
    "/gifs",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      if (!key) return reply.code(503).send({ error: "Les GIF ne sont pas activés sur ce serveur (clé Klipy manquante)." });
      const q = (req.query.q ?? "").trim().slice(0, 100);
      const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
      const params = new URLSearchParams({
        page: String(page),
        per_page: "24",
        customer_id: createHmac("sha256", config.jwtSecret).update(`klipy:${me.id}`).digest("hex").slice(0, 24),
        locale: "fr",
        content_filter: "medium",
        format_filter: "gif,webp",
      });
      if (q) params.set("q", q);
      const url = `${API}/${encodeURIComponent(key)}/gifs/${q ? "search" : "trending"}?${params}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: { data?: KlipyItem[]; has_next?: boolean } };
        const items = (json.data?.data ?? []).map(toGif).filter((g): g is Gif => !!g);
        return { gifs: items, hasNext: !!json.data?.has_next };
      } catch (err) {
        req.log.warn({ err: String(err) }, "Klipy injoignable");
        return reply.code(502).send({ error: "Recherche de GIF indisponible pour le moment." });
      }
    },
  );

  /** Récupère un GIF choisi chez Klipy et le transforme en pièce jointe. */
  app.post<{ Body: { url?: unknown; title?: unknown; width?: unknown; height?: unknown } }>(
    "/gifs/attach",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await authenticate(req, reply);
      if (!me) return;
      if (!key) return reply.code(503).send({ error: "Les GIF ne sont pas activés sur ce serveur." });
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      if (!isKlipyUrl(url)) return reply.code(400).send({ error: "GIF invalide." });
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (!res.ok || !isKlipyUrl(res.url)) throw new Error(String(res.status));
        const len = Number(res.headers.get("content-length") ?? 0);
        if (len > MAX_GIF_BYTES) return reply.code(413).send({ error: "GIF trop lourd." });
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_GIF_BYTES) return reply.code(413).send({ error: "GIF trop lourd." });
        const title = typeof req.body?.title === "string" ? req.body.title : "gif";
        const att = await saveAttachment(me, buf, {
          name: `${title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "gif"}.gif`,
          width: String(req.body?.width ?? ""),
          height: String(req.body?.height ?? ""),
        });
        if (att.kind !== "image") return reply.code(400).send({ error: "GIF invalide." });
        return att;
      } catch (err) {
        req.log.warn({ err: String(err) }, "téléchargement GIF impossible");
        return reply.code(502).send({ error: "Impossible de récupérer ce GIF." });
      }
    },
  );
}
