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

type Conn = { socket: WebSocket; who: Principal; idle: boolean };
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
}

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket, req) => {
    const who = req.query.token ? await verifyAccessToken(req.query.token) : null;
    if (!who) {
      socket.close(4401, "unauthorized");
      return;
    }
    const conn: Conn = { socket, who, idle: false };
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
      } catch {
        // message illisible : ignoré
      }
    });

    socket.on("close", () => {
      conns.delete(conn);
      if (who.kind === "user" && !isConnected(who.id)) {
        db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(Date.now(), who.id);
      }
      if (who.kind === "user") refreshPresence(who.id);
    });
  });
}
