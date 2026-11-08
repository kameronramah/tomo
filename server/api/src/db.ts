import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, "tomo.sqlite"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Sessions = jetons de renouvellement (stockés hachés, jamais en clair).
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);

CREATE TABLE IF NOT EXISTS servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- role : owner | admin | member
CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id        TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  INTEGER NOT NULL,
  spatial   INTEGER NOT NULL DEFAULT 0
);

-- kind : member (rejoindre avec un compte) | guest (une soirée, sans compte)
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  kind       TEXT NOT NULL,
  max_uses   INTEGER,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

db.exec(`
-- Salons textuels d'un serveur
CREATE TABLE IF NOT EXISTS channels (
  id        TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL
);

-- Messages : scope = channel (salon textuel) | room (chat d'un salon vocal) | dm (message privé)
-- target = id du salon textuel, du salon vocal, ou "idA:idB" (paire triée) pour un dm
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  target      TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  guest       INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_target ON messages (scope, target, created_at);

-- Amitiés : user_a < user_b (paire unique) ; status pending | accepted
CREATE TABLE IF NOT EXISTS friendships (
  user_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);
`);

// Migrations : colonnes ajoutées après coup (ignorées si elles existent déjà).
for (const sql of [
  "ALTER TABLE users ADD COLUMN is_dev INTEGER NOT NULL DEFAULT 0", // compte de test avec outils
  "ALTER TABLE users ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0", // faux membre généré
  // --- Profil (v0.7) ---
  "ALTER TABLE users ADD COLUMN display_name TEXT", // nom affiché (le pseudo de connexion ne change pas)
  "ALTER TABLE users ADD COLUMN bio TEXT", // petite phrase de profil
  "ALTER TABLE users ADD COLUMN accent TEXT", // couleur du profil (#RRGGBB)
  "ALTER TABLE users ADD COLUMN avatar_id TEXT", // pièce jointe (image) servant de photo
  "ALTER TABLE users ADD COLUMN banner_id TEXT", // pièce jointe (image) servant de bannière
  // --- Statut ---
  "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'", // online | idle | dnd | invisible (choisi)
  "ALTER TABLE users ADD COLUMN custom_status TEXT",
  "ALTER TABLE users ADD COLUMN custom_status_until INTEGER", // null = sans fin
  "ALTER TABLE users ADD COLUMN last_seen INTEGER",
  // --- Confidentialité ---
  "ALTER TABLE users ADD COLUMN dm_policy TEXT NOT NULL DEFAULT 'servers'", // friends | servers | everyone
  "ALTER TABLE users ADD COLUMN call_policy TEXT NOT NULL DEFAULT 'friends'", // friends | servers
  "ALTER TABLE users ADD COLUMN friend_policy TEXT NOT NULL DEFAULT 'everyone'", // everyone | servers | nobody
  "ALTER TABLE users ADD COLUMN show_game INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE users ADD COLUMN show_last_seen INTEGER NOT NULL DEFAULT 1",
  // --- Messages (v0.7) ---
  "ALTER TABLE messages ADD COLUMN edited_at INTEGER", // dernière modification
]) {
  try {
    db.exec(sql);
  } catch {
    // colonne déjà présente
  }
}

db.exec(`
-- Personnes bloquées : plus de messages, d'appels ni de demandes d'ami dans les deux sens.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
-- Réactions aux messages (une ligne par personne et par emoji)
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS reactions_by_message ON message_reactions (message_id);
-- Conversations privées avec quelqu'un qui n'est pas ami : acceptée ou ignorée par user_id.
CREATE TABLE IF NOT EXISTS dm_state (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state    TEXT NOT NULL, -- accepted | ignored
  PRIMARY KEY (user_id, other_id)
);
`);

// Les serveurs créés avant l'arrivée des salons textuels en reçoivent un.
for (const s of db.prepare("SELECT id FROM servers WHERE id NOT IN (SELECT server_id FROM channels)").all() as { id: string }[]) {
  db.prepare("INSERT INTO channels (id, server_id, name, position) VALUES (?, ?, 'général', 0)").run(crypto.randomUUID(), s.id);
}

export type Role = "owner" | "admin" | "member";

/** Exécute fn dans une transaction (tout ou rien). */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
