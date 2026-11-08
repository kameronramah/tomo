import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { config } from "./config.js";
import type { Principal } from "./security.js";

const roomService = new RoomServiceClient(config.livekit.httpUrl, config.livekit.apiKey, config.livekit.apiSecret);

export type LiveParticipant = { identity: string; name: string; guest: boolean };

/** Identité LiveKit : stable par compte (u:…), unique par invité (g:…). */
export const identityOf = (p: Principal) => (p.kind === "user" ? `u:${p.id}` : `g:${p.id}`);

/** Occupants actuels de chaque salon demandé (les salons vides sont absents). */
export async function liveParticipants(roomIds: string[]): Promise<Map<string, LiveParticipant[]>> {
  const result = new Map<string, LiveParticipant[]>();
  if (roomIds.length === 0) return result;
  try {
    const live = await roomService.listRooms(roomIds);
    await Promise.all(
      live
        .filter((r) => r.numParticipants > 0)
        .map(async (r) => {
          const ps = await roomService.listParticipants(r.name);
          result.set(
            r.name,
            ps.map((p) => ({ identity: p.identity, name: p.name || p.identity, guest: p.identity.startsWith("g:") })),
          );
        }),
    );
  } catch {
    // LiveKit injoignable : on affiche les salons sans occupants.
  }
  return result;
}

export async function voiceToken(principal: Principal, roomId: string): Promise<string> {
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: identityOf(principal),
    name: principal.name,
    ttl: "6h",
    metadata: JSON.stringify({ guest: principal.kind === "guest" }),
  });
  token.addGrant({ room: roomId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}

/** Synchronise l'état « audio spatial » dans les métadonnées du salon s'il est actif. */
export async function pushRoomSpatial(roomId: string, spatial: boolean) {
  try {
    const [room] = await roomService.listRooms([roomId]);
    if (room) await roomService.updateRoomMetadata(roomId, JSON.stringify({ spatial }));
  } catch {
    // salon inactif ou LiveKit injoignable : l'état est en base, il sera lu à la connexion
  }
}

/** Ferme des salons vocaux (salon supprimé, serveur supprimé). */
export async function closeRooms(roomIds: string[]) {
  await Promise.all(roomIds.map((id) => roomService.deleteRoom(id).catch(() => {})));
}

/** Retire une personne des salons vocaux donnés (membre exclu). */
export async function kickFromRooms(identity: string, roomIds: string[]) {
  await Promise.all(roomIds.map((id) => roomService.removeParticipant(id, identity).catch(() => {})));
}
