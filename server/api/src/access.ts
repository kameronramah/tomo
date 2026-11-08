/** Droits d'accès partagés par les routes. */
import { db, type Role } from "./db.js";
import type { Principal } from "./security.js";

export function roleOf(serverId: string, userId: string): Role | undefined {
  const row = db.prepare("SELECT role FROM members WHERE server_id = ? AND user_id = ?").get(serverId, userId) as
    | { role: Role }
    | undefined;
  return row?.role;
}

/** Rôle sur le serveur ("guest" pour un invité), ou undefined si pas d'accès. */
export function accessOf(p: Principal, serverId: string): Role | "guest" | undefined {
  if (p.kind === "guest") return p.serverId === serverId ? "guest" : undefined;
  return roleOf(serverId, p.id);
}

export const isManager = (role: string | undefined) => role === "owner" || role === "admin";

/** Identifiants des membres (comptes) d'un serveur. */
export function memberIds(serverId: string): string[] {
  return (db.prepare("SELECT user_id FROM members WHERE server_id = ?").all(serverId) as { user_id: string }[]).map(
    (r) => r.user_id,
  );
}

/** Paire triée pour les amitiés et les messages privés. */
export function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function areFriends(a: string, b: string): boolean {
  const [x, y] = pair(a, b);
  return !!db.prepare("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'").get(x, y);
}

export function friendIds(userId: string): string[] {
  return (
    db
      .prepare(
        "SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'",
      )
      .all(userId, userId, userId) as { id: string }[]
  ).map((r) => r.id);
}
