/**
 * Adresse e-mail du compte (obligatoire, vérifiée par un code) et mot de passe oublié.
 * L'adresse sert seulement à récupérer son compte : elle n'est jamais montrée aux autres.
 */
import type { FastifyInstance } from "fastify";
import { db } from "./db.js";
import { cleanEmail, codeAge, newCode, useCode } from "./codes.js";
import { mailEnabled, sendCode } from "./mail.js";
import { clearLoginFailuresFor, hashPassword, requireUser, verifyPassword } from "./security.js";
import { checkPassword, devFlag, openSession } from "./routes-auth.js";

const CODE_TTL = 30 * 60_000;
const RESEND_AFTER = 60_000;

type Row = { id: string; username: string; password_hash: string; is_dev: number; email: string | null; email_verified: number };
const COLS = "id, username, password_hash, is_dev, email, email_verified";

export const emailTaken = (email: string, exceptUserId = "") =>
  !!db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, exceptUserId);

/** Envoie un code de vérification à l'adresse du compte (si l'envoi de mails est configuré). */
export async function sendVerifyCode(user: { id: string; username: string; email: string }) {
  const code = newCode(user.id, "verify", CODE_TTL);
  return sendCode(user.email, "verify", code, user.username);
}

/** Compte par pseudo ou par adresse e-mail. */
function findByLogin(login: unknown): Row | undefined {
  if (typeof login !== "string" || !login.trim() || login.length > 254) return undefined;
  const value = login.normalize("NFKC").trim();
  if (value.includes("@")) {
    const email = cleanEmail(value);
    return email ? (db.prepare(`SELECT ${COLS} FROM users WHERE email = ?`).get(email) as Row | undefined) : undefined;
  }
  return db.prepare(`SELECT ${COLS} FROM users WHERE username = ?`).get(value) as Row | undefined;
}

export default async function accountRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  /** Ajouter ou changer son adresse (demande le mot de passe actuel). */
  app.post<{ Body: { email?: unknown; password?: unknown } }>("/me/email", strict, async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const row = db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(me.id) as Row | undefined;
    if (!row || typeof req.body?.password !== "string" || !(await verifyPassword(req.body.password, row.password_hash)))
      return reply.code(403).send({ error: "Mot de passe actuel incorrect." });
    const email = cleanEmail(req.body?.email);
    if (!email) return reply.code(400).send({ error: "Adresse e-mail invalide." });
    if (emailTaken(email, me.id)) return reply.code(409).send({ error: "Cette adresse e-mail est déjà utilisée par un autre compte." });
    if (email !== row.email || !row.email_verified) {
      db.prepare("UPDATE users SET email = ?, email_verified = 0 WHERE id = ?").run(email, me.id);
      await sendVerifyCode({ id: me.id, username: row.username, email });
    }
    return { email, emailVerified: email === row.email && row.email_verified === 1 };
  });

  /** Renvoyer le code de vérification (une fois par minute au plus). */
  app.post("/me/email/resend", strict, async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const row = db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(me.id) as Row | undefined;
    if (!row?.email) return reply.code(400).send({ error: "Ajoute d'abord une adresse e-mail." });
    if (row.email_verified) return { ok: true };
    const age = codeAge(me.id, "verify");
    if (age < RESEND_AFTER) return reply.code(429).send({ error: "Attends une minute avant de redemander un code.", retryIn: Math.ceil((RESEND_AFTER - age) / 1000) });
    const sent = await sendVerifyCode({ id: me.id, username: row.username, email: row.email });
    if (!sent) return reply.code(503).send({ error: "L'envoi de mails n'est pas disponible sur ce serveur." });
    return { ok: true };
  });

  /** Vérifier l'adresse avec le code reçu. */
  app.post<{ Body: { code?: unknown } }>("/me/email/verify", strict, async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!useCode(me.id, "verify", req.body?.code)) return reply.code(400).send({ error: "Code incorrect ou expiré." });
    db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(me.id);
    return { emailVerified: true };
  });

  /**
   * Mot de passe oublié : envoie un code si le compte existe et a une adresse vérifiée.
   * Réponse identique dans tous les cas (on ne révèle pas si un compte existe).
   */
  app.post<{ Body: { login?: unknown } }>("/auth/forgot", strict, async (req) => {
    const row = findByLogin(req.body?.login);
    if (row?.email && row.email_verified && codeAge(row.id, "reset") >= RESEND_AFTER) {
      const code = newCode(row.id, "reset", CODE_TTL);
      // En arrière-plan : le temps de réponse ne doit pas trahir l'existence du compte.
      void sendCode(row.email, "reset", code, row.username);
    }
    return { ok: true };
  });

  /** Nouveau mot de passe avec le code reçu par mail (ou le code de secours de l'admin). */
  app.post<{ Body: { login?: unknown; code?: unknown; password?: unknown } }>("/auth/reset", strict, async (req, reply) => {
    const pwError = checkPassword(req.body?.password);
    if (pwError) return reply.code(400).send({ error: pwError });
    const row = findByLogin(req.body?.login);
    const generic = { error: "Code incorrect ou expiré." };
    if (!row) return reply.code(400).send(generic);
    const byMail = useCode(row.id, "reset", req.body?.code);
    const byRescue = !byMail && useCode(row.id, "rescue", req.body?.code);
    if (!byMail && !byRescue) return reply.code(400).send(generic);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(req.body!.password as string), row.id);
    // Le code reçu par mail prouve que l'adresse est bien la sienne.
    if (byMail) db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    db.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose IN ('reset', 'rescue')").run(row.id);
    clearLoginFailuresFor(row.username);
    return openSession({ id: row.id, username: row.username, isDev: devFlag(row.is_dev) }, req.headers["user-agent"]);
  });
}
