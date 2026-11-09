import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";
import {
  DUMMY_HASH,
  PASSWORD_MAX,
  PASSWORD_MIN,
  cleanName,
  clearLoginFailures,
  hashPassword,
  loginLockedFor,
  newRefreshToken,
  recordLoginFailure,
  requireUser,
  sha256,
  signAccessToken,
  signGuestToken,
  verifyPassword,
} from "./security.js";

const SESSION_DAYS = 30;
const GUEST_MAX_HOURS = 12;

type UserRow = { id: string; username: string; password_hash: string; is_dev: number };

/** Le compte a-t-il les outils de test ? (uniquement si le serveur est en mode dev) */
export const devFlag = (isDev: number | undefined) => config.devTools && isDev === 1;

/** Ouvre une session : jeton d'accès court + jeton de renouvellement (stocké haché). */
async function openSession(user: { id: string; username: string; isDev: boolean }, userAgent?: string) {
  const { token, hash } = newRefreshToken();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), user.id, hash, now, now + SESSION_DAYS * 86400_000, userAgent?.slice(0, 200) ?? null);
  return {
    accessToken: await signAccessToken(user),
    refreshToken: token,
    user: { id: user.id, username: user.username, isDev: user.isDev },
  };
}

function checkPassword(password: unknown): string | null {
  if (typeof password !== "string") return "Mot de passe manquant.";
  if (password.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`;
  if (password.length > PASSWORD_MAX) return `Le mot de passe doit faire au plus ${PASSWORD_MAX} caractères.`;
  return null;
}

export default async function authRoutes(app: FastifyInstance) {
  // Limite stricte sur les routes sensibles : 10 essais / minute / IP.
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/auth/config", async () => ({ registration: config.registration }));

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/auth/register", strict, async (req, reply) => {
    if (config.registration === "closed") return reply.code(403).send({ error: "Les inscriptions sont fermées." });
    const username = cleanName(req.body?.username);
    if (!username)
      return reply.code(400).send({ error: "Pseudo invalide : 3 à 32 caractères (lettres, chiffres, espace, . _ -)." });
    const pwError = checkPassword(req.body?.password);
    if (pwError) return reply.code(400).send({ error: pwError });

    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) return reply.code(409).send({ error: "Ce pseudo est déjà pris." });

    const user = { id: randomUUID(), username, isDev: false };
    const passwordHash = await hashPassword(req.body!.password as string);
    try {
      db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
        user.id,
        username,
        passwordHash,
        Date.now(),
      );
    } catch {
      return reply.code(409).send({ error: "Ce pseudo est déjà pris." });
    }
    return openSession(user, req.headers["user-agent"]);
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/auth/login", strict, async (req, reply) => {
    const username = typeof req.body?.username === "string" ? req.body.username.normalize("NFKC").trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const generic = { error: "Pseudo ou mot de passe incorrect." };

    const locked = loginLockedFor(username, req.ip);
    if (locked) {
      return reply
        .code(429)
        .send({ error: `Trop d'essais. Réessaie dans ${Math.ceil(locked / 60000)} min.` });
    }

    const row = db.prepare("SELECT id, username, password_hash, is_dev FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    // On vérifie toujours un hash (même factice) pour ne pas révéler si le pseudo existe.
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      recordLoginFailure(username, req.ip);
      return reply.code(401).send(generic);
    }
    clearLoginFailures(username, req.ip);
    return openSession({ id: row.id, username: row.username, isDev: devFlag(row.is_dev) }, req.headers["user-agent"]);
  });

  /** Échange un jeton de renouvellement contre une nouvelle paire (rotation : l'ancien ne marche plus). */
  app.post<{ Body: { refreshToken?: unknown } }>("/auth/refresh", strict, async (req, reply) => {
    const token = req.body?.refreshToken;
    if (typeof token !== "string") return reply.code(400).send({ error: "Jeton manquant." });
    const session = db
      .prepare(
        "SELECT s.id, s.expires_at, u.id AS user_id, u.username, u.is_dev FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
      )
      .get(sha256(token)) as
      | { id: string; expires_at: number; user_id: string; username: string; is_dev: number }
      | undefined;
    if (!session || session.expires_at < Date.now()) {
      if (session) db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      return reply.code(401).send({ error: "Session expirée, reconnecte-toi.", code: "unauthorized" });
    }
    const next = newRefreshToken();
    db.prepare("UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?").run(
      next.hash,
      Date.now() + SESSION_DAYS * 86400_000,
      session.id,
    );
    const user = { id: session.user_id, username: session.username, isDev: devFlag(session.is_dev) };
    return { accessToken: await signAccessToken(user), refreshToken: next.token, user };
  });

  app.post<{ Body: { refreshToken?: unknown } }>("/auth/logout", async (req) => {
    if (typeof req.body?.refreshToken === "string")
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(req.body.refreshToken));
    return { ok: true };
  });

  /** Déconnecte tous les appareils de l'utilisateur. */
  app.post("/auth/logout-all", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(me.id);
    return { ok: true };
  });

  /** Changer son mot de passe : déconnecte tous les autres appareils et renvoie une nouvelle session. */
  app.post<{ Body: { current?: unknown; next?: unknown } }>("/me/password", strict, async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const row = db.prepare("SELECT id, username, password_hash, is_dev FROM users WHERE id = ?").get(me.id) as UserRow | undefined;
    if (!row || typeof req.body?.current !== "string" || !(await verifyPassword(req.body.current, row.password_hash)))
      return reply.code(401).send({ error: "Mot de passe actuel incorrect." });
    const pwError = checkPassword(req.body?.next);
    if (pwError) return reply.code(400).send({ error: pwError });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(req.body!.next as string), me.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(me.id);
    return openSession({ id: row.id, username: row.username, isDev: devFlag(row.is_dev) }, req.headers["user-agent"]);
  });

  /** Nombre de sessions ouvertes (appareils connectés). */
  app.get("/me/sessions", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    return db
      .prepare("SELECT created_at AS createdAt, expires_at AS expiresAt, user_agent AS userAgent FROM sessions WHERE user_id = ? ORDER BY created_at DESC")
      .all(me.id);
  });

  app.get("/me", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const row = db.prepare("SELECT is_dev FROM users WHERE id = ?").get(me.id) as { is_dev: number } | undefined;
    return { id: me.id, username: me.name, isDev: devFlag(row?.is_dev) };
  });

  // -------------------------------------------------------------------------
  // Invités : rejoindre un serveur sans compte, le temps d'une soirée
  // -------------------------------------------------------------------------
  app.post<{ Body: { code?: unknown; name?: unknown } }>("/auth/guest", strict, async (req, reply) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    const name = cleanName(req.body?.name);
    if (!name) return reply.code(400).send({ error: "Pseudo invalide : 3 à 32 caractères." });

    const invite = db
      .prepare(
        "SELECT i.code, i.server_id, i.max_uses, i.uses, i.expires_at, s.name AS server_name FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = ? AND i.kind = 'guest'",
      )
      .get(code) as
      | { code: string; server_id: string; max_uses: number | null; uses: number; expires_at: number; server_name: string }
      | undefined;
    if (!invite || invite.expires_at < Date.now() || (invite.max_uses !== null && invite.uses >= invite.max_uses)) {
      return reply.code(404).send({ error: "Code invité invalide ou expiré." });
    }
    db.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ?").run(code);

    const expiresAt = Math.min(invite.expires_at, Date.now() + GUEST_MAX_HOURS * 3600_000);
    const guest = { id: `guest-${randomUUID()}`, name, serverId: invite.server_id, expiresAt };
    return {
      accessToken: await signGuestToken(guest),
      guest: { id: guest.id, name, expiresAt, server: { id: invite.server_id, name: invite.server_name } },
    };
  });
}
