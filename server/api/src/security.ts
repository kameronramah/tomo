import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Mots de passe : scrypt (intégré à Node), sel aléatoire, comparaison à temps constant.
// ---------------------------------------------------------------------------
const SCRYPT = { N: 32768, r: 8, p: 1 };
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash factice : on vérifie quand même un mot de passe quand le compte n'existe pas (même durée de réponse). */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

// ---------------------------------------------------------------------------
// Règles de saisie
// ---------------------------------------------------------------------------
export const USERNAME_RE = /^[\p{L}\p{N}_.\- ]{3,32}$/u;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return USERNAME_RE.test(v) ? v : null;
}

export function cleanLabel(value: unknown, max = 40): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return v.length >= 1 && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------
export type Principal =
  | { kind: "user"; id: string; name: string }
  | { kind: "guest"; id: string; name: string; serverId: string };

const ACCESS_TTL = "15m";

export function signAccessToken(user: { id: string; username: string }): Promise<string> {
  return new SignJWT({ kind: "user", name: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(config.jwtSecret);
}

export function signGuestToken(guest: { id: string; name: string; serverId: string; expiresAt: number }) {
  return new SignJWT({ kind: "guest", name: guest.name, srv: guest.serverId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(guest.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(guest.expiresAt / 1000))
    .sign(config.jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.name !== "string") return null;
    if (payload.kind === "user") return { kind: "user", id: payload.sub, name: payload.name };
    if (payload.kind === "guest" && typeof payload.srv === "string")
      return { kind: "guest", id: payload.sub, name: payload.name, serverId: payload.srv };
    return null;
  } catch {
    return null;
  }
}

/** Jeton de renouvellement : 256 bits aléatoires ; seul son hash SHA-256 est stocké. */
export function newRefreshToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Code d'invitation lisible, sans caractères ambigus (0/O, 1/I) : ABCD-EFGH. */
export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// ---------------------------------------------------------------------------
// Garde d'authentification pour les routes
// ---------------------------------------------------------------------------
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<Principal | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const principal = token ? await verifyAccessToken(token) : null;
  if (!principal) {
    reply.code(401).send({ error: "Session expirée, reconnecte-toi.", code: "unauthorized" });
    return null;
  }
  return principal;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const p = await authenticate(req, reply);
  if (!p) return null;
  if (p.kind !== "user") {
    reply.code(403).send({ error: "Réservé aux comptes. Crée un compte pour faire ça." });
    return null;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Limite par compte (en plus de la limite par adresse IP)
//
// Sert pour l'envoi de messages : plusieurs potes derrière la même box (même IP, soirée LAN)
// ne se gênent plus, et un compte seul ne peut pas inonder un fil.
// ---------------------------------------------------------------------------
const hits = new Map<string, number[]>();

/** Vrai si le compte a déjà fait `max` actions de ce type dans la fenêtre (en ms). */
export function tooFast(bucket: string, accountId: string, max: number, windowMs: number): boolean {
  const key = `${bucket}|${accountId}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20000) for (const [k, l] of hits) if (!l.some((t) => now - t < 60_000)) hits.delete(k);
  return false;
}

/** Messages : 10 par tranche de 10 s et par compte. */
export const messageTooFast = (accountId: string) => tooFast("msg", accountId, 10, 10_000);
export const TOO_FAST = { error: "Tu envoies trop vite. Attends quelques secondes." };

// ---------------------------------------------------------------------------
// Blocage temporaire après plusieurs échecs de connexion
//
// Compté par adresse IP + pseudo : quelqu'un qui rate exprès le mot de passe d'un autre
// ne bloque que lui-même, pas le vrai propriétaire du compte (qui se connecte d'ailleurs).
// Le délai grandit à chaque série d'échecs : 1, 2, 4, 8 puis 15 min.
// En plus, beaucoup d'échecs sur un même pseudo depuis plein d'adresses (attaque répartie)
// le bloquent 5 min pour tout le monde.
// ---------------------------------------------------------------------------
const MAX_FAILS = 5;
const MAX_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_FAILS = 50;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_LOCK_MS = 5 * 60 * 1000;
type Fail = { count: number; strikes: number; lockedUntil: number; last: number };
const failures = new Map<string, Fail>();
const perUser = new Map<string, { count: number; since: number; lockedUntil: number }>();

const keyOf = (username: string, ip: string) => `${ip}|${username.toLowerCase()}`;

function prune() {
  if (failures.size < 5000 && perUser.size < 5000) return;
  const now = Date.now();
  for (const [k, f] of failures) if (f.lockedUntil < now && now - f.last > 24 * 3600_000) failures.delete(k);
  for (const [k, u] of perUser) if (u.lockedUntil < now && now - u.since > GLOBAL_WINDOW_MS) perUser.delete(k);
}

/** Temps restant (ms) avant de pouvoir réessayer, 0 si c'est permis. */
export function loginLockedFor(username: string, ip: string): number {
  const now = Date.now();
  const f = failures.get(keyOf(username, ip));
  const u = perUser.get(username.toLowerCase());
  return Math.max(f && f.lockedUntil > now ? f.lockedUntil - now : 0, u && u.lockedUntil > now ? u.lockedUntil - now : 0);
}

export function recordLoginFailure(username: string, ip: string) {
  const now = Date.now();
  const key = keyOf(username, ip);
  const f = failures.get(key) ?? { count: 0, strikes: 0, lockedUntil: 0, last: now };
  f.count += 1;
  f.last = now;
  if (f.count >= MAX_FAILS) {
    f.lockedUntil = now + Math.min(MAX_LOCK_MS, 60_000 * 2 ** f.strikes);
    f.strikes += 1;
    f.count = 0;
  }
  failures.set(key, f);

  const name = username.toLowerCase();
  const u = perUser.get(name) ?? { count: 0, since: now, lockedUntil: 0 };
  if (now - u.since > GLOBAL_WINDOW_MS) {
    u.count = 0;
    u.since = now;
  }
  u.count += 1;
  if (u.count >= GLOBAL_FAILS) {
    u.lockedUntil = now + GLOBAL_LOCK_MS;
    u.count = 0;
    u.since = now;
  }
  perUser.set(name, u);
  prune();
}

export function clearLoginFailures(username: string, ip: string) {
  failures.delete(keyOf(username, ip));
}
