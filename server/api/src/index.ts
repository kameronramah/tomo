import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return value;
}

const ROOM_RE = /^[a-z0-9_-]{1,32}$/;

type RoomDef = { id: string; label: string };

/** "general:Général,jeux:Jeux" → [{ id: "general", label: "Général" }, …] */
function parseRooms(raw: string): RoomDef[] {
  const rooms = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label] = entry.split(":");
      return { id: id.trim().toLowerCase(), label: (label ?? id).trim() };
    })
    .filter((r) => ROOM_RE.test(r.id));
  return rooms.length ? rooms : [{ id: "general", label: "Général" }];
}

const PORT = Number(process.env.PORT ?? 3000);
const LIVEKIT_URL = requireEnv("LIVEKIT_URL"); // wss://... (donné aux clients)
const LIVEKIT_API_KEY = requireEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = requireEnv("LIVEKIT_API_SECRET");
const INVITE_CODE = requireEnv("INVITE_CODE");
const SERVER_NAME = process.env.SERVER_NAME?.trim() || "Talk2Mates";
const ROOMS = parseRooms(process.env.ROOMS ?? "general:Général,jeux:Jeux,chill:Chill,afk:AFK");
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

// L'API d'administration LiveKit parle HTTP(S) sur la même adresse que le WebSocket.
// LIVEKIT_HTTP_URL permet de passer par le réseau interne (ex. http://livekit:7880 en dev).
const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HTTP_URL ?? LIVEKIT_URL.replace(/^ws/, "http"),
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
);

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function inviteIsValid(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(INVITE_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Vérifie le code d'invitation (en-tête `X-Invite-Code`, ou champ `invite` du corps).
 * Répond 401 et renvoie false s'il est invalide.
 */
function checkInvite(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers["x-invite-code"];
  const body = req.body as { invite?: unknown } | undefined;
  if (inviteIsValid(typeof header === "string" ? header : body?.invite)) return true;
  reply.code(401).send({ error: "Code d'invitation invalide" });
  return false;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const app = Fastify({ logger: true });

// Le client de bureau (origine tauri.localhost) et le serveur de dev (localhost:1420)
// appellent l'API depuis un autre domaine. L'accès reste protégé par le code d'invitation.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

/** GET /info → { name, rooms } : sert aussi à vérifier un code d'invitation. */
app.get("/info", async (req, reply) => {
  if (!checkInvite(req, reply)) return;
  return { name: SERVER_NAME, rooms: ROOMS };
});

/**
 * GET /rooms → [{ id, label, participants: [{ identity, name }] }]
 * Liste des salons avec les personnes connectées dans chacun.
 */
app.get("/rooms", async (req, reply) => {
  if (!checkInvite(req, reply)) return;
  try {
    const live = await roomService.listRooms([...ROOM_IDS]);
    const occupied = new Set(live.filter((r) => r.numParticipants > 0).map((r) => r.name));
    return await Promise.all(
      ROOMS.map(async (r) => ({
        ...r,
        participants: occupied.has(r.id)
          ? (await roomService.listParticipants(r.id)).map((p) => ({
              identity: p.identity,
              name: p.name || p.identity,
            }))
          : [],
      })),
    );
  } catch (err) {
    req.log.error(err);
    // LiveKit injoignable : on renvoie quand même les salons, sans occupants.
    return ROOMS.map((r) => ({ ...r, participants: [] }));
  }
});

/**
 * POST /token   (en-tête X-Invite-Code)
 * Body : { name: string, room: string }
 * Réponse : { url, token }  → à passer à `room.connect(url, token)` côté client.
 */
app.post<{ Body: { name?: unknown; room?: unknown } }>("/token", async (req, reply) => {
  if (!checkInvite(req, reply)) return;
  const { name, room } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length < 1 || name.length > 32) {
    return reply.code(400).send({ error: "Pseudo invalide (1 à 32 caractères)" });
  }
  if (typeof room !== "string" || !ROOM_IDS.has(room)) {
    return reply.code(404).send({ error: "Salon inconnu" });
  }

  const displayName = name.trim();
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    // Identité unique : deux amis peuvent avoir le même pseudo sans s'éjecter.
    identity: `${displayName}#${randomUUID().slice(0, 8)}`,
    name: displayName,
    ttl: "12h",
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // positions pour l'audio spatial, callouts…
  });

  return { url: LIVEKIT_URL, token: await token.toJwt() };
});

/**
 * POST /rooms/:room/spatial   (en-tête X-Invite-Code)
 * Body : { enabled: boolean }
 * Active/désactive l'audio spatial pour tout le salon (stocké dans les métadonnées
 * du salon, donc vu aussi par ceux qui arrivent plus tard).
 */
app.post<{ Params: { room: string }; Body: { enabled?: unknown } }>(
  "/rooms/:room/spatial",
  async (req, reply) => {
    if (!checkInvite(req, reply)) return;
    const { room } = req.params;
    const { enabled } = req.body ?? {};

    if (!ROOM_IDS.has(room) || typeof enabled !== "boolean") {
      return reply.code(400).send({ error: "Requête invalide" });
    }

    try {
      const [current] = await roomService.listRooms([room]);
      if (!current) {
        return reply.code(404).send({ error: "Salon vide : personne n'y est connecté" });
      }
      let metadata: Record<string, unknown> = {};
      try {
        metadata = current.metadata ? JSON.parse(current.metadata) : {};
      } catch {
        // métadonnées illisibles : on repart de zéro
      }
      metadata.spatial = enabled;
      await roomService.updateRoomMetadata(room, JSON.stringify(metadata));
      return { room, spatial: enabled };
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: "LiveKit injoignable" });
    }
  },
);

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
