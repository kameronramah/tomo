/**
 * Passerelle temps réel (WebSocket) : nouveaux messages, amis, présence, appels.
 * Le client se connecte sur /ws?token=<jeton d'accès> ; le serveur ne fait qu'envoyer
 * des événements (toutes les actions passent par l'API REST).
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { verifyAccessToken, type Principal } from "./security.js";
import { friendIds, memberIds } from "./access.js";

type Conn = { socket: WebSocket; who: Principal };
const conns = new Set<Conn>();

export type RealtimeEvent = { type: string; [key: string]: unknown };

function send(c: Conn, event: RealtimeEvent) {
  if (c.socket.readyState === c.socket.OPEN) c.socket.send(JSON.stringify(event));
}

export function isOnline(userId: string): boolean {
  for (const c of conns) if (c.who.kind === "user" && c.who.id === userId) return true;
  return false;
}

export function sendToUser(userId: string, event: RealtimeEvent) {
  for (const c of conns) if (c.who.kind === "user" && c.who.id === userId) send(c, event);
}

/** À tous les membres d'un serveur (et aux invités connectés à ce serveur). */
export function sendToServer(serverId: string, event: RealtimeEvent) {
  const members = new Set(memberIds(serverId));
  for (const c of conns) {
    if ((c.who.kind === "user" && members.has(c.who.id)) || (c.who.kind === "guest" && c.who.serverId === serverId))
      send(c, event);
  }
}

function notifyPresence(userId: string, online: boolean) {
  for (const friend of friendIds(userId)) sendToUser(friend, { type: "presence", userId, online });
}

export default async function realtimeRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>("/ws", { websocket: true }, async (socket, req) => {
    const who = req.query.token ? await verifyAccessToken(req.query.token) : null;
    if (!who) {
      socket.close(4401, "unauthorized");
      return;
    }
    const conn: Conn = { socket, who };
    const firstConnection = who.kind === "user" && !isOnline(who.id);
    conns.add(conn);
    if (firstConnection) notifyPresence(who.id, true);
    send(conn, { type: "hello" });

    // Ping applicatif : le client mesure la latence de l'API avec {type:"ping"}.
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === "ping") send(conn, { type: "pong", t: msg.t });
      } catch {
        // message illisible : ignoré
      }
    });

    socket.on("close", () => {
      conns.delete(conn);
      if (who.kind === "user" && !isOnline(who.id)) notifyPresence(who.id, false);
    });
  });
}
