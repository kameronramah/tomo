/**
 * Outils de test — enregistrés UNIQUEMENT quand DEV_TOOLS=1 (jamais en production).
 * Réservés aux comptes marqués is_dev (le compte de test créé au démarrage).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { db, tx } from "./db.js";
import { config } from "./config.js";
import { hashPassword, requireUser } from "./security.js";
import { devMailbox } from "./mail.js";

/** Crée ou met à jour le compte de test (mot de passe et drapeau is_dev) au démarrage. */
export async function seedDevUser(log: (msg: string) => void) {
  if (!config.devTools || !config.devUser) return;
  const { username, password } = config.devUser;
  const hash = await hashPassword(password);
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, is_dev = 1 WHERE id = ?").run(hash, existing.id);
  } else {
    db.prepare("INSERT INTO users (id, username, password_hash, created_at, is_dev) VALUES (?, ?, ?, ?, 1)").run(
      randomUUID(),
      username,
      hash,
      Date.now(),
    );
  }
  log(`Compte de test prêt : ${username} (outils de test activés)`);
}

async function requireDev(req: FastifyRequest, reply: FastifyReply) {
  const me = await requireUser(req, reply);
  if (!me) return null;
  const row = db.prepare("SELECT is_dev FROM users WHERE id = ?").get(me.id) as { is_dev: number } | undefined;
  if (row?.is_dev !== 1) {
    reply.code(403).send({ error: "Réservé au compte de test." });
    return null;
  }
  return me;
}

const FIRST_NAMES = ["Alex", "Sam", "Nico", "Jules", "Léa", "Max", "Inès", "Tom", "Zoé", "Hugo", "Lina", "Noah", "Emma", "Yanis", "Sarah"];

export default async function devRoutes(app: FastifyInstance) {
  /** Boîte de test : dernier code « envoyé » à une adresse (serveur de dev sans SMTP, pour les tests). */
  app.get<{ Querystring: { to?: string } }>("/dev/mailbox", async (req, reply) => {
    const mail = devMailbox.get(String(req.query.to ?? "").toLowerCase());
    if (!mail) return reply.code(404).send({ error: "Aucun mail." });
    return mail;
  });

  /** Jeton LiveKit pour un faux joueur (« bot ») dans un salon accessible au compte de test. */
  app.post<{ Body: { roomId?: unknown; name?: unknown } }>("/dev/bot-token", async (req, reply) => {
    const me = await requireDev(req, reply);
    if (!me) return;
    const roomId = typeof req.body?.roomId === "string" ? req.body.roomId : "";
    const room = db
      .prepare("SELECT r.id FROM rooms r JOIN members m ON m.server_id = r.server_id WHERE r.id = ? AND m.user_id = ?")
      .get(roomId, me.id);
    if (!room) return reply.code(404).send({ error: "Salon introuvable." });
    const name = typeof req.body?.name === "string" && req.body.name.length <= 32 ? req.body.name : "Bot";
    const identity = `bot:${randomUUID()}`;
    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity, name, ttl: "2h" });
    token.addGrant({ room: roomId, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: false, canUpdateOwnMetadata: true });
    return { url: config.livekit.url, token: await token.toJwt(), identity };
  });

  /** Ajoute des faux membres (comptes sans mot de passe utilisable) à un serveur. */
  app.post<{ Params: { id: string }; Body: { count?: unknown } }>("/dev/servers/:id/fake-members", async (req, reply) => {
    const me = await requireDev(req, reply);
    if (!me) return;
    const member = db.prepare("SELECT 1 FROM members WHERE server_id = ? AND user_id = ?").get(req.params.id, me.id);
    if (!member) return reply.code(404).send({ error: "Serveur introuvable." });
    const count = Math.min(Math.max(Math.floor(Number(req.body?.count) || 5), 1), 50);
    const created: string[] = [];
    tx(() => {
      for (let i = 0; i < count; i++) {
        const username = `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]}-test-${randomBytes(2).toString("hex")}`;
        const id = randomUUID();
        // "disabled" n'est pas un hash scrypt : impossible de se connecter avec ces comptes.
        db.prepare("INSERT INTO users (id, username, password_hash, created_at, is_test) VALUES (?, ?, 'disabled', ?, 1)").run(
          id,
          username,
          Date.now(),
        );
        db.prepare("INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(
          req.params.id,
          id,
          Date.now(),
        );
        created.push(username);
      }
    });
    return { created };
  });

  /** Supprime tous les faux membres générés. */
  app.delete("/dev/fake-members", async (req, reply) => {
    const me = await requireDev(req, reply);
    if (!me) return;
    const result = db.prepare("DELETE FROM users WHERE is_test = 1").run();
    return { deleted: Number(result.changes) };
  });

  /** Quelques chiffres sur l'instance. */
  app.get("/dev/stats", async (req, reply) => {
    const me = await requireDev(req, reply);
    if (!me) return;
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    return {
      users: count("SELECT COUNT(*) AS n FROM users WHERE is_test = 0"),
      fakeMembers: count("SELECT COUNT(*) AS n FROM users WHERE is_test = 1"),
      servers: count("SELECT COUNT(*) AS n FROM servers"),
      rooms: count("SELECT COUNT(*) AS n FROM rooms"),
      sessions: count("SELECT COUNT(*) AS n FROM sessions"),
      activeInvites: (db.prepare("SELECT COUNT(*) AS n FROM invites WHERE expires_at > ?").get(Date.now()) as { n: number }).n,
      registration: config.registration,
    };
  });
}
