/**
 * Comptes de jeu et stats (Steam, Riot / League of Legends).
 *
 * - Steam : liaison par la connexion officielle Steam (OpenID 2.0) — tomo ne voit jamais le mot
 *   de passe. Stats : heures jouées ces 2 dernières semaines (profil Steam public nécessaire).
 *   Clé gratuite : https://steamcommunity.com/dev/apikey → STEAM_API_KEY.
 * - Riot : la connexion officielle (RSO) est réservée aux applis validées par Riot ; on lie donc
 *   avec le Riot ID (Pseudo#TAG). Stats League of Legends : niveau, rang, dernières parties.
 *   Clé gratuite : https://developer.riotgames.com → RIOT_API_KEY (la clé « development »
 *   expire toutes les 24 h ; demander une clé « personal » pour un usage durable).
 *   Valorant : l'API n'est ouverte qu'aux applis « production » validées par Riot.
 * Les réponses sont gardées 10 min en mémoire pour ne pas dépasser les limites des API.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { areFriends, shareServer } from "./access.js";
import { authenticate, requireUser } from "./security.js";
import { sendToUser } from "./realtime.js";

db.exec(`
CREATE TABLE IF NOT EXISTS game_accounts (
  user_id          TEXT PRIMARY KEY,
  steam_id         TEXT,
  riot_puuid       TEXT,
  riot_name        TEXT,
  riot_region      TEXT,
  stats_visibility TEXT NOT NULL DEFAULT 'servers',  -- everyone | servers | nobody
  show_rank        INTEGER NOT NULL DEFAULT 1
);
`);

const STEAM_KEY = process.env.STEAM_API_KEY?.trim() || null;
const RIOT_KEY = process.env.RIOT_API_KEY?.trim() || null;

type AccountRow = {
  user_id: string;
  steam_id: string | null;
  riot_puuid: string | null;
  riot_name: string | null;
  riot_region: string | null;
  stats_visibility: "everyone" | "servers" | "nobody";
  show_rank: number;
};

const accountOf = (userId: string) => db.prepare("SELECT * FROM game_accounts WHERE user_id = ?").get(userId) as AccountRow | undefined;
function upsert(userId: string, patch: Partial<Omit<AccountRow, "user_id">>) {
  db.prepare("INSERT OR IGNORE INTO game_accounts (user_id) VALUES (?)").run(userId);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length) db.prepare(`UPDATE game_accounts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE user_id = ?`).run(...keys.map((k) => patch[k] ?? null), userId);
}

/** Plateformes LoL acceptées → routage régional (compte, parties). */
const REGIONS: Record<string, { account: string; match: string; label: string }> = {
  euw1: { account: "europe", match: "europe", label: "EUW" },
  eun1: { account: "europe", match: "europe", label: "EUNE" },
  tr1: { account: "europe", match: "europe", label: "TR" },
  ru: { account: "europe", match: "europe", label: "RU" },
  na1: { account: "americas", match: "americas", label: "NA" },
  br1: { account: "americas", match: "americas", label: "BR" },
  la1: { account: "americas", match: "americas", label: "LAN" },
  la2: { account: "americas", match: "americas", label: "LAS" },
  kr: { account: "asia", match: "asia", label: "KR" },
  jp1: { account: "asia", match: "asia", label: "JP" },
  oc1: { account: "americas", match: "sea", label: "OCE" },
};

// ---------------------------------------------------------------------------
// Petit cache mémoire
// ---------------------------------------------------------------------------
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return data;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const pendingSteam = new Map<string, { userId: string; at: number }>();

function baseUrl(req: FastifyRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  return `${proto}://${req.headers.host}`;
}

async function steamStats(steamId: string) {
  if (!STEAM_KEY) return { linked: true, error: "Stats Steam indisponibles : clé Steam manquante sur le serveur." };
  return cached(`steam:${steamId}`, 10 * 60_000, async () => {
    const [sum, recent] = await Promise.all([
      getJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${steamId}`),
      getJson(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&count=5`),
    ]);
    const player = sum?.response?.players?.[0];
    const games = ((recent?.response?.games ?? []) as { name: string; playtime_2weeks?: number; appid: number }[])
      .filter((g) => g.playtime_2weeks)
      .map((g) => ({ name: g.name, appId: g.appid, minutes2w: g.playtime_2weeks! }));
    return {
      linked: true,
      name: player?.personaname ?? null,
      profileUrl: player?.profileurl ?? null,
      // communityvisibilitystate 3 = profil public
      private: player ? player.communityvisibilitystate !== 3 : false,
      minutes2w: games.reduce((n, g) => n + g.minutes2w, 0),
      games,
    };
  });
}

// ---------------------------------------------------------------------------
// Riot (League of Legends)
// ---------------------------------------------------------------------------
const riot = (host: string, path: string) => getJson(`https://${host}.api.riotgames.com${path}`, { "X-Riot-Token": RIOT_KEY! });

async function riotStats(a: AccountRow) {
  if (!RIOT_KEY) return { linked: true, riotId: a.riot_name, error: "Stats Riot indisponibles : clé Riot manquante sur le serveur." };
  const region = REGIONS[a.riot_region ?? ""] ?? REGIONS.euw1;
  const platform = a.riot_region ?? "euw1";
  return cached(`riot:${a.riot_puuid}`, 10 * 60_000, async () => {
    const [summoner, entries, matchIds] = await Promise.all([
      riot(platform, `/lol/summoner/v4/summoners/by-puuid/${a.riot_puuid}`),
      riot(platform, `/lol/league/v4/entries/by-puuid/${a.riot_puuid}`),
      riot(region.match, `/lol/match/v5/matches/by-puuid/${a.riot_puuid}/ids?count=3`),
    ]);
    const ranks = ((entries ?? []) as { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number }[]).map((e) => ({
      queue: e.queueType === "RANKED_SOLO_5x5" ? "Solo/Duo" : e.queueType === "RANKED_FLEX_SR" ? "Flex" : e.queueType,
      tier: e.tier,
      division: e.rank,
      lp: e.leaguePoints,
      winRate: e.wins + e.losses ? Math.round((e.wins / (e.wins + e.losses)) * 100) : null,
    }));
    const matches = [];
    for (const id of ((matchIds ?? []) as string[]).slice(0, 3)) {
      const m = await riot(region.match, `/lol/match/v5/matches/${id}`).catch(() => null);
      const p = m?.info?.participants?.find((x: { puuid: string }) => x.puuid === a.riot_puuid);
      if (!p) continue;
      matches.push({ win: !!p.win, champion: p.championName as string, kills: p.kills, deaths: p.deaths, assists: p.assists, endedAt: m.info.gameEndTimestamp as number, mode: m.info.gameMode as string });
    }
    return { linked: true, riotId: a.riot_name, region: region.label, level: summoner?.summonerLevel ?? null, ranks, matches };
  });
}

// ---------------------------------------------------------------------------
function canSeeStats(viewerId: string | null, owner: AccountRow) {
  if (viewerId === owner.user_id) return true;
  if (!viewerId || owner.stats_visibility === "nobody") return false;
  if (owner.stats_visibility === "everyone") return true;
  return areFriends(viewerId, owner.user_id) || shareServer(viewerId, owner.user_id);
}

export default async function gameStatsRoutes(app: FastifyInstance) {
  // ---- Mes comptes ----------------------------------------------------------------
  app.get("/me/links", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const a = accountOf(me.id);
    return {
      steam: a?.steam_id ? { steamId: a.steam_id } : null,
      riot: a?.riot_puuid ? { riotId: a.riot_name, region: a.riot_region } : null,
      visibility: a?.stats_visibility ?? "servers",
      showRank: a ? !!a.show_rank : true,
      available: { steam: !!STEAM_KEY, riot: !!RIOT_KEY },
      regions: Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label })),
    };
  });

  app.patch<{ Body: { visibility?: unknown; showRank?: unknown } }>("/me/links", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const b = req.body ?? {};
    if (b.visibility !== undefined) {
      if (!["everyone", "servers", "nobody"].includes(b.visibility as string)) return reply.code(400).send({ error: "Réglage invalide." });
      upsert(me.id, { stats_visibility: b.visibility as AccountRow["stats_visibility"] });
    }
    if (b.showRank !== undefined) {
      if (typeof b.showRank !== "boolean") return reply.code(400).send({ error: "Réglage invalide." });
      upsert(me.id, { show_rank: b.showRank ? 1 : 0 });
    }
    return { ok: true };
  });

  // ---- Steam (OpenID) ---------------------------------------------------------------
  app.post("/me/links/steam/start", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    for (const [k, v] of pendingSteam) if (Date.now() - v.at > 10 * 60_000) pendingSteam.delete(k);
    const state = randomBytes(18).toString("base64url");
    pendingSteam.set(state, { userId: me.id, at: Date.now() });
    const base = baseUrl(req);
    const q = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${base}/links/steam/callback?state=${state}`,
      "openid.realm": base,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return { url: `${STEAM_OPENID}?${q}` };
  });

  /** Retour de Steam (dans le navigateur) : on vérifie la signature auprès de Steam. */
  app.get<{ Querystring: Record<string, string> }>("/links/steam/callback", async (req, reply) => {
    const page = (ok: boolean, text: string) =>
      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        .send(
          `<!doctype html><meta charset="utf-8"><title>tomo</title><body style="font-family:system-ui;background:#0E1014;color:#ECEEF3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:${ok ? "#2DD4BF" : "#E5484D"}">${ok ? "Compte Steam lié" : "Liaison impossible"}</h1><p>${text}</p></div></body>`,
        );
    const q = req.query;
    const pending = pendingSteam.get(q.state ?? "");
    pendingSteam.delete(q.state ?? "");
    if (!pending || Date.now() - pending.at > 10 * 60_000) return page(false, "Lien expiré : recommence depuis tomo.");
    const expectedReturn = `${baseUrl(req)}/links/steam/callback?state=${q.state}`;
    if (q["openid.return_to"] !== expectedReturn) return page(false, "Réponse de Steam inattendue.");
    const check = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (k.startsWith("openid.")) check.set(k, v);
    check.set("openid.mode", "check_authentication");
    try {
      const res = await fetch(STEAM_OPENID, { method: "POST", body: check, signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      const id = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q["openid.claimed_id"] ?? "")?.[1];
      if (!/is_valid\s*:\s*true/.test(text) || !id) return page(false, "Steam n'a pas confirmé la connexion.");
      upsert(pending.userId, { steam_id: id });
      cache.delete(`steam:${id}`);
      sendToUser(pending.userId, { type: "links" });
      return page(true, "Tu peux fermer cette page et revenir dans tomo.");
    } catch {
      return page(false, "Steam ne répond pas. Réessaie dans un moment.");
    }
  });

  app.delete("/me/links/steam", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    upsert(me.id, { steam_id: null });
    return { ok: true };
  });

  // ---- Riot (Riot ID) -----------------------------------------------------------------
  app.post<{ Body: { riotId?: unknown; region?: unknown } }>("/me/links/riot", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!RIOT_KEY) return reply.code(400).send({ error: "La liaison Riot n'est pas activée sur ce serveur (clé Riot manquante)." });
    const m = /^(.{3,16})#([A-Za-z0-9]{2,5})$/u.exec(typeof req.body?.riotId === "string" ? req.body.riotId.trim() : "");
    if (!m) return reply.code(400).send({ error: "Riot ID invalide : écris-le sous la forme Pseudo#TAG." });
    const region = typeof req.body?.region === "string" && REGIONS[req.body.region] ? req.body.region : null;
    if (!region) return reply.code(400).send({ error: "Région invalide." });
    try {
      const acc = await riot(REGIONS[region].account, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`);
      if (!acc?.puuid) return reply.code(404).send({ error: "Aucun compte Riot avec ce Riot ID." });
      upsert(me.id, { riot_puuid: acc.puuid, riot_name: `${acc.gameName}#${acc.tagLine}`, riot_region: region });
      return { riotId: `${acc.gameName}#${acc.tagLine}`, region };
    } catch {
      return reply.code(502).send({ error: "Riot ne répond pas (ou la clé Riot du serveur a expiré)." });
    }
  });

  app.delete("/me/links/riot", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    upsert(me.id, { riot_puuid: null, riot_name: null, riot_region: null });
    return { ok: true };
  });

  // ---- Stats de quelqu'un --------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/users/:id/stats", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const a = accountOf(req.params.id);
    if (!a || (!a.steam_id && !a.riot_puuid)) return { steam: null, riot: null };
    if (!canSeeStats(me.kind === "user" ? me.id : null, a)) return { steam: null, riot: null, hidden: true };
    const [steam, riotData] = await Promise.all([
      a.steam_id ? steamStats(a.steam_id).catch(() => ({ linked: true, error: "Steam ne répond pas pour l'instant." })) : null,
      a.riot_puuid ? riotStats(a).catch(() => ({ linked: true, riotId: a.riot_name, error: "Riot ne répond pas (clé expirée ?)." })) : null,
    ]);
    // « Montrer mon rang » coupé : on garde les parties, pas le rang (copie : le cache reste intact).
    const self = me.kind === "user" && me.id === a.user_id;
    const riotShown = riotData && "ranks" in riotData && !a.show_rank && !self ? { ...riotData, ranks: [] } : riotData;
    return { steam, riot: riotShown };
  });
}
