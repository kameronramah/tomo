import Fastify from "fastify";
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

const PORT = Number(process.env.PORT ?? 3000);
const LIVEKIT_URL = requireEnv("LIVEKIT_URL"); // wss://... (donné aux clients)
const LIVEKIT_API_KEY = requireEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = requireEnv("LIVEKIT_API_SECRET");
const INVITE_CODE = requireEnv("INVITE_CODE");

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
const ROOM_RE = /^[a-z0-9_-]{1,32}$/;

function inviteIsValid(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(INVITE_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const app = Fastify({ logger: true });

// Le client de bureau (origine tauri.localhost) et le serveur de dev (localhost:1420)
// appellent l'API depuis un autre domaine. L'accès reste protégé par le code d'invitation.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

/**
 * POST /token
 * Body : { name: string, room: string, invite: string }
 * Réponse : { url, token }  → à passer à `room.connect(url, token)` côté client.
 */
app.post<{ Body: { name?: unknown; room?: unknown; invite?: unknown } }>(
  "/token",
  async (req, reply) => {
    const { name, room, invite } = req.body ?? {};

    if (!inviteIsValid(invite)) {
      return reply.code(401).send({ error: "Code d'invitation invalide" });
    }
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 32) {
      return reply.code(400).send({ error: "Pseudo invalide (1 à 32 caractères)" });
    }
    if (typeof room !== "string" || !ROOM_RE.test(room)) {
      return reply.code(400).send({ error: "Nom de salon invalide (a-z, 0-9, - et _)" });
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
  },
);

/**
 * POST /rooms/:room/spatial
 * Body : { enabled: boolean, invite: string }
 * Active/désactive l'audio spatial pour tout le salon (stocké dans les métadonnées
 * du salon, donc vu aussi par ceux qui arrivent plus tard).
 */
app.post<{ Params: { room: string }; Body: { enabled?: unknown; invite?: unknown } }>(
  "/rooms/:room/spatial",
  async (req, reply) => {
    const { room } = req.params;
    const { enabled, invite } = req.body ?? {};

    if (!inviteIsValid(invite)) {
      return reply.code(401).send({ error: "Code d'invitation invalide" });
    }
    if (!ROOM_RE.test(room) || typeof enabled !== "boolean") {
      return reply.code(400).send({ error: "Requête invalide" });
    }

    try {
      const [current] = await roomService.listRooms([room]);
      if (!current) {
        return reply.code(404).send({ error: "Salon introuvable (personne n'y est connecté)" });
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
