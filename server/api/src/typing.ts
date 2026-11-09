/**
 * « X est en train d'écrire… » : le client prévient (au plus toutes les 3 s pendant qu'on tape),
 * le serveur relaie à ceux qui voient la conversation. Rien n'est enregistré.
 */
import { db } from "./db.js";
import { accessOf, isBlocked } from "./access.js";
import { canMessage } from "./profiles.js";
import { sendToServer, sendToUser } from "./realtime.js";
import type { Principal } from "./security.js";

const last = new Map<string, number>();

export function handleTyping(who: Principal, msg: { scope?: unknown; target?: unknown }) {
  const scope = msg.scope;
  const target = typeof msg.target === "string" ? msg.target.slice(0, 64) : "";
  if (!target || (scope !== "channel" && scope !== "room" && scope !== "dm")) return;

  // Anti-inondation : un événement toutes les 2 s par personne et par conversation
  const key = `${who.id}|${scope}|${target}`;
  const now = Date.now();
  if (now - (last.get(key) ?? 0) < 2000) return;
  last.set(key, now);
  if (last.size > 20000) for (const [k, t] of last) if (now - t > 60_000) last.delete(k);

  const event = { type: "typing", scope, target, userId: who.id, name: who.name };
  if (scope === "dm") {
    if (who.kind !== "user" || target === who.id) return;
    if (isBlocked(target, who.id) || isBlocked(who.id, target) || !canMessage(who.id, target)) return;
    // Pour le destinataire, la conversation est celle avec moi
    sendToUser(target, { ...event, target: who.id });
    return;
  }
  const table = scope === "channel" ? "channels" : "rooms";
  const row = db.prepare(`SELECT server_id FROM ${table} WHERE id = ?`).get(target) as { server_id: string } | undefined;
  if (!row || !accessOf(who, row.server_id)) return;
  sendToServer(row.server_id, { ...event, serverId: row.server_id });
}
