/**
 * Codes à 6 chiffres (vérification d'adresse, mot de passe oublié, code de secours de l'admin).
 * Stockés hachés, à usage unique, 5 essais maximum, durée limitée.
 */
import { createHash, randomInt } from "node:crypto";
import { db } from "./db.js";

export type Purpose = "verify" | "reset" | "rescue";
const MAX_ATTEMPTS = 5;

const hashCode = (userId: string, purpose: Purpose, code: string) =>
  createHash("sha256").update(`${userId}|${purpose}|${code}`).digest("hex");

/** Crée un nouveau code (l'ancien du même type ne marche plus). */
export function newCode(userId: string, purpose: Purpose, ttlMs: number): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO email_codes (user_id, purpose, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(userId, purpose, hashCode(userId, purpose, code), now + ttlMs, now);
  return code;
}

/** Depuis quand le dernier code de ce type a été créé (ms), ou Infinity. */
export function codeAge(userId: string, purpose: Purpose): number {
  const row = db.prepare("SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = ?").get(userId, purpose) as
    | { created_at: number }
    | undefined;
  return row ? Date.now() - row.created_at : Infinity;
}

/** Vérifie un code ; s'il est bon, il est effacé (usage unique). Un mauvais essai est compté. */
export function useCode(userId: string, purpose: Purpose, code: unknown): boolean {
  const clean = typeof code === "string" ? code.replace(/\D/g, "") : "";
  const row = db.prepare("SELECT code_hash, expires_at, attempts FROM email_codes WHERE user_id = ? AND purpose = ?").get(userId, purpose) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row) return false;
  if (row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?").run(userId, purpose);
    return false;
  }
  if (clean.length !== 6 || hashCode(userId, purpose, clean) !== row.code_hash) {
    db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?").run(userId, purpose);
    return false;
  }
  db.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?").run(userId, purpose);
  return true;
}

/** Adresse e-mail nettoyée (minuscules), ou null si elle n'a pas l'air valide. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}
