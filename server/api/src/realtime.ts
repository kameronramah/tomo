/**
 * Passerelle temps réel (WebSocket) : nouveaux messages, amis, présence, appels.
 * Le client se connecte sur /ws?token=<jeton d'accès> ; le serveur envoie des événements
 * (toutes les actions passent par l'API REST). Seule exception : le client signale ici
 * s'il est inactif (aucune activité clavier/souris depuis 10 min) pour le statut « Inactif ».
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { verifyAccessToken, type Principal } from "./security.js";
import { coMemberIds, friendIds, memberIds } from "./access.js";
import { db } from "./db.js";
import { handleTyping } from "./typing.js";

/** Jeu en cours, signalé par l'appli de bureau (détection locale des programmes lancés). */
export type Game = { name: string; since: number };
type Conn = { socket: WebSocket; who: Principal; idle: boolean; game: Game | null };
const conns = new Set<Conn>();

export type RealtimeEvent = { type: string; [key: string]: unknown };
/** Statut vu par les autres. */
export type Presence = "online" | "idle" | "dnd" | "offline";

function send(c: Conn, event: RealtimeEvent) {
  if (c.socket.readyState === c.socket.OPEN) c.socket.send(JSON.stringify(event));
}

function userConns(userId: string) {
  return [...conns].filter((c) => c.who.kind === "user" && c.who.id === userId);
}

/** Connecté sur au moins un appareil (même en invisible). */
export function isConnected(userId: string): boolean {
  return userConns(userId).length > 0;
}

/** Statut affiché aux autres : l'invisible apparaît hors ligne. */
export function presenceOf(userId: string): Presence {
  const mine = userConns(userId);
  if (mine.length === 0) return "offline";
  const row = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status: string } | undefined;
  const chosen = row?.status ?? "online";
  if (chosen === "invisible") return "offline";
  if (chosen === "dnd") return "dnd";
  if (chosen === "idle") return "idle";
  return mine.every((c) => c.idle) ? "idle" : "online";
}

/** « Joue à … » vu par les autres : rien si hors ligne / invisible ou si l'option est coupée. */
export function gameOf(userId: string): Game | null {
  if (presenceOf(userId) === "offline") return null;
  const row = db.prepare("SELECT show_game FROM users WHERE id = ?").get(userId) as { show_game: number } | undefined;
  if (!row?.show_game) return null;
  return userConns(userId).find((c) => c.game)?.game ?? null;
}

const lastGame = new Map<string, string>();
/** Prévient les potes si le jeu affiché a changé. */
export function refreshGame(userId: string) {
  const g = gameOf(userId);
  const key = g ? `${g.name}|${g.since}` : "";
  if ((lastGame.get(userId) ?? "") === key) return;
  lastGame.set(userId, key);
  sendToAudience(userId, { type: "game", userId, game: g });
}

/** En ligne aux yeux des autres (pour les amis, les appels…). */
export const isOnline = (userId: string) => presenceOf(userId) !== "offline";

export function sendToUser(userId: string, event: RealtimeEvent) {
  for (const c of userConns(userId)) send(c, event);
}

/** À tous les membres d'un serveur (et aux invités connectés à ce serveur). */
export function sendToServer(serverId: string, event: RealtimeEvent) {
  const members = new Set(memberIds(serverId));
  for (const c of conns) {
    if ((c.who.kind === "user" && members.has(c.who.id)) || (c.who.kind === "guest" && c.who.serverId === serverId))
      send(c, event);
  }
}

/** Ceux qui voient mon statut et mon profil : mes amis et les membres de mes serveurs. */
export function audienceOf(userId: string): Set<string> {
  return new Set([...friendIds(userId), ...coMemberIds(userId)]);
}

/** Invités connectés à un des serveurs de userId (ils voient aussi la liste des membres). */
function guestConnsFor(userId: string) {
  const servers = new Set(
    (db.prepare("SELECT server_id FROM members WHERE user_id = ?").all(userId) as { server_id: string }[]).map((r) => r.server_id),
  );
  return [...conns].filter((c) => c.who.kind === "guest" && servers.has(c.who.serverId));
}

export function sendToAudience(userId: string, event: RealtimeEvent, includeSelf = true) {
  for (const id of audienceOf(userId)) sendToUser(id, event);
  for (const c of guestConnsFor(userId)) send(c, event);
  if (includeSelf) sendToUser(userId, event);
}

const lastPresence = new Map<string, Presence>();

/** Recalcule le statut et prévient tout le monde s'il a changé. */
export function refreshPresence(userId: string, force = false) {
  const now = presenceOf(userId);
  if (!force && lastPresence.get(userId) === now) return;
  lastPresence.set(userId, now);
  sendToAudience(userId, { type: "presence", userId, status: now, online: now !== "offline" });
  refreshGame(userId);
}

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket, req) => {
    const who = req.query.token ? await verifyAccessToken(req.query.token) : null;
    if (!who) {
      socket.close(4401, "unauthorized");
      return;
    }
    const conn: Conn = { socket, who, idle: false, game: null };
    conns.add(conn);
    if (who.kind === "user") refreshPresence(who.id);
    send(conn, { type: "hello" });

    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        // Ping applicatif : le client mesure la latence de l'API avec {type:"ping"}.
        if (msg?.type === "ping") send(conn, { type: "pong", t: msg.t });
        // Inactivité détectée par le client (10 min sans clavier ni souris).
        if (msg?.type === "idle" && typeof msg.idle === "boolean" && msg.idle !== conn.idle) {
          conn.idle = msg.idle;
          if (who.kind === "user") refreshPresence(who.id);
        }
        // « est en train d'écrire… » (relayé seulement à ceux qui voient la conversation)
        if (msg?.type === "typing") handleTyping(who, msg);
        // Jeu lancé / quitté (null = plus de jeu). Nom nettoyé, 40 caractères max.
        if (msg?.type === "game" && who.kind === "user") {
          const name = typeof msg.game?.name === "string" ? msg.game.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "";
          const since = typeof msg.game?.since === "number" && msg.game.since <= Date.now() + 60_000 ? Math.floor(msg.game.since) : Date.now();
          conn.game = name ? { name, since } : null;
          refreshGame(who.id);
        }
      } catch {
        // message illisible : ignoré
      }
    });

    socket.on("close", () => {
      conns.delete(conn);
      if (who.kind === "user" && !isConnected(who.id)) {
        db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(Date.now(), who.id);
      }
      if (who.kind === "user") {
        refreshPresence(who.id);
        refreshGame(who.id);
      }
    });
  });
}
