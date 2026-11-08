/**
 * Profils, statuts, confidentialité, blocages et liste des membres d'un serveur.
 *
 * - Profil : nom affiché, photo, bannière, petite phrase, couleur. Le pseudo de connexion ne change pas.
 * - Statut choisi : online | idle | dnd | invisible (+ statut personnalisé avec fin optionnelle).
 *   Vu par les autres : voir presenceOf() (l'invisible apparaît hors ligne, l'inactivité est automatique).
 * - Confidentialité : qui peut m'écrire / m'appeler / m'ajouter, « joue à », « vu il y a ».
 * - Blocage : coupe messages, appels et demandes d'ami dans les deux sens, et retire l'amitié.
 */
import type { FastifyInstance } from "fastify";
import { db } from "./db.js";
import { accessOf, areFriends, isBlocked, pair, shareServer } from "./access.js";
import { authenticate, cleanLabel, requireUser, type Principal } from "./security.js";
import { attachmentUrl, claimProfileImage, sweepAttachments } from "./attachments.js";
import { gameOf, presenceOf, refreshGame, refreshPresence, sendToAudience, sendToUser, isConnected, type Game, type Presence } from "./realtime.js";
import { identityOf, liveParticipants } from "./livekit.js";

export type DmPolicy = "friends" | "servers" | "everyone";
export type CallPolicy = "friends" | "servers";
export type FriendPolicy = "everyone" | "servers" | "nobody";

type UserRow = {
  id: string;
  username: string;
  created_at: number;
  display_name: string | null;
  bio: string | null;
  accent: string | null;
  avatar_id: string | null;
  banner_id: string | null;
  status: string;
  custom_status: string | null;
  custom_status_until: number | null;
  last_seen: number | null;
  dm_policy: DmPolicy;
  call_policy: CallPolicy;
  friend_policy: FriendPolicy;
  show_game: number;
  show_last_seen: number;
  is_test: number;
};

export type LightProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accent: string | null;
  status: Presence;
  customStatus: string | null;
  /** « Joue à … » (si la personne l'autorise) */
  game: Game | null;
};

const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const BIO_MAX = 190;
const CUSTOM_MAX = 60;

export function userRow(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

const customOf = (u: UserRow) => (u.custom_status && (!u.custom_status_until || u.custom_status_until > Date.now()) ? u.custom_status : null);

export function displayNameOf(userId: string): string | null {
  const u = userRow(userId);
  return u ? u.display_name || u.username : null;
}

export function lightProfile(u: UserRow): LightProfile {
  const status = presenceOf(u.id);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    avatarUrl: attachmentUrl(u.avatar_id),
    accent: u.accent,
    status,
    // Un statut personnalisé ne s'affiche pas quand la personne apparaît hors ligne.
    customStatus: status === "offline" ? null : customOf(u),
    game: gameOf(u.id),
  };
}

// ---------------------------------------------------------------------------
// Règles de confidentialité
// ---------------------------------------------------------------------------
/** `from` peut-il écrire à `to` ? (amis toujours ; sinon selon le réglage de `to`) */
export function canMessage(from: string, to: string): boolean {
  if (from === to || isBlocked(from, to)) return false;
  if (areFriends(from, to)) return true;
  // Conversation déjà acceptée par le destinataire : on peut continuer.
  if (dmState(to, from) === "accepted") return true;
  const policy = userRow(to)?.dm_policy ?? "servers";
  if (policy === "everyone") return true;
  if (policy === "servers") return shareServer(from, to);
  return false;
}

export function canCall(from: string, to: string): boolean {
  if (from === to || isBlocked(from, to)) return false;
  if (areFriends(from, to)) return true;
  return userRow(to)?.call_policy === "servers" && shareServer(from, to);
}

export function canAddFriend(from: string, to: string): boolean {
  if (from === to || isBlocked(from, to)) return false;
  const policy = userRow(to)?.friend_policy ?? "everyone";
  if (policy === "everyone") return true;
  if (policy === "servers") return shareServer(from, to);
  return false;
}

export function dmState(userId: string, otherId: string): "accepted" | "ignored" | null {
  const r = db.prepare("SELECT state FROM dm_state WHERE user_id = ? AND other_id = ?").get(userId, otherId) as { state: string } | undefined;
  return (r?.state as "accepted" | "ignored" | undefined) ?? null;
}

export function setDmState(userId: string, otherId: string, state: "accepted" | "ignored" | null) {
  if (state === null) db.prepare("DELETE FROM dm_state WHERE user_id = ? AND other_id = ?").run(userId, otherId);
  else
    db.prepare("INSERT INTO dm_state (user_id, other_id, state) VALUES (?, ?, ?) ON CONFLICT(user_id, other_id) DO UPDATE SET state = excluded.state").run(
      userId,
      otherId,
      state,
    );
}

/** Peut-on voir le profil complet ? (même instance, pas bloqué par la personne) */
function friendshipOf(me: string, other: string): "friend" | "incoming" | "outgoing" | "none" {
  const [a, b] = pair(me, other);
  const r = db.prepare("SELECT status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b) as
    | { status: string; requested_by: string }
    | undefined;
  if (!r) return "none";
  if (r.status === "accepted") return "friend";
  return r.requested_by === me ? "outgoing" : "incoming";
}

function fullProfile(viewer: Principal, u: UserRow) {
  const base = lightProfile(u);
  const isUser = viewer.kind === "user";
  const self = isUser && viewer.id === u.id;
  const common = isUser
    ? (db
        .prepare("SELECT COUNT(*) AS n FROM members m1 JOIN members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = ? AND m2.user_id = ?")
        .get(viewer.id, u.id) as { n: number }).n
    : 1;
  return {
    ...base,
    bio: u.bio,
    bannerUrl: attachmentUrl(u.banner_id),
    createdAt: u.created_at,
    lastSeen: base.status === "offline" && u.show_last_seen ? u.last_seen : null,
    self,
    friendship: isUser && !self ? friendshipOf(viewer.id, u.id) : "none",
    blockedByMe: isUser && !self ? !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewer.id, u.id) : false,
    commonServers: common,
    canMessage: isUser && !self ? canMessage(viewer.id, u.id) : false,
    canCall: isUser && !self ? canCall(viewer.id, u.id) && isConnected(u.id) && base.status !== "offline" : false,
    canAddFriend: isUser && !self ? canAddFriend(viewer.id, u.id) && friendshipOf(viewer.id, u.id) === "none" : false,
  };
}

/** Le profil de `target` est-il visible pour `viewer` ? (amis, serveur en commun, ou conversation existante) */
function canSee(viewer: Principal, targetId: string): boolean {
  if (viewer.kind === "guest") return !!db.prepare("SELECT 1 FROM members WHERE server_id = ? AND user_id = ?").get(viewer.serverId, targetId);
  if (viewer.id === targetId) return true;
  if (areFriends(viewer.id, targetId) || shareServer(viewer.id, targetId)) return true;
  if (friendshipOf(viewer.id, targetId) !== "none") return true;
  return !!db.prepare("SELECT 1 FROM messages WHERE scope = 'dm' AND target = ? LIMIT 1").get(pair(viewer.id, targetId).join(":"));
}

const POLICIES = {
  dm: ["friends", "servers", "everyone"],
  call: ["friends", "servers"],
  friend: ["everyone", "servers", "nobody"],
} as const;

export default async function profileRoutes(app: FastifyInstance) {
  // ---- Mon profil et mes réglages -----------------------------------------
  app.get("/me/profile", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const u = userRow(me.id)!;
    return {
      ...fullProfile(me, u),
      chosenStatus: u.status,
      customStatusRaw: u.custom_status,
      customStatusUntil: u.custom_status_until,
      privacy: {
        dm: u.dm_policy,
        call: u.call_policy,
        friend: u.friend_policy,
        showGame: !!u.show_game,
        showLastSeen: !!u.show_last_seen,
      },
    };
  });

  app.patch<{ Body: { displayName?: unknown; bio?: unknown; accent?: unknown; avatarId?: unknown; bannerId?: unknown } }>(
    "/me/profile",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const b = req.body ?? {};
      const sets: string[] = [];
      const vals: (string | null)[] = [];
      if (b.displayName !== undefined) {
        const name = b.displayName === null || b.displayName === "" ? null : cleanLabel(b.displayName, 32);
        if (b.displayName && !name) return reply.code(400).send({ error: "Nom affiché invalide (1 à 32 caractères)." });
        sets.push("display_name = ?");
        vals.push(name);
      }
      if (b.bio !== undefined) {
        if (b.bio !== null && typeof b.bio !== "string") return reply.code(400).send({ error: "Phrase de profil invalide." });
        const bio = typeof b.bio === "string" ? b.bio.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, "").trim() : "";
        if (bio.length > BIO_MAX) return reply.code(400).send({ error: `Phrase de profil trop longue (${BIO_MAX} caractères maximum).` });
        sets.push("bio = ?");
        vals.push(bio || null);
      }
      if (b.accent !== undefined) {
        if (b.accent !== null && (typeof b.accent !== "string" || !ACCENT_RE.test(b.accent)))
          return reply.code(400).send({ error: "Couleur invalide." });
        sets.push("accent = ?");
        vals.push((b.accent as string | null) ?? null);
      }
      for (const [field, column] of [
        ["avatarId", "avatar_id"],
        ["bannerId", "banner_id"],
      ] as const) {
        const v = b[field];
        if (v === undefined) continue;
        if (v !== null) {
          if (typeof v !== "string") return reply.code(400).send({ error: "Image invalide." });
          const err = claimProfileImage(me.id, v);
          if (err) return reply.code(400).send({ error: err });
        }
        sets.push(`${column} = ?`);
        vals.push((v as string | null) ?? null);
      }
      if (sets.length) {
        db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, me.id);
        sweepAttachments(); // l'ancienne photo / bannière part
        sendToAudience(me.id, { type: "profile", userId: me.id });
      }
      return lightProfile(userRow(me.id)!);
    },
  );

  app.patch<{ Body: { status?: unknown; customStatus?: unknown; customStatusUntil?: unknown } }>("/me/status", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const b = req.body ?? {};
    if (b.status !== undefined) {
      if (!["online", "idle", "dnd", "invisible"].includes(b.status as string)) return reply.code(400).send({ error: "Statut invalide." });
      db.prepare("UPDATE users SET status = ? WHERE id = ?").run(b.status as string, me.id);
    }
    if (b.customStatus !== undefined) {
      const text = b.customStatus === null || b.customStatus === "" ? null : cleanLabel(b.customStatus, CUSTOM_MAX);
      if (b.customStatus && !text) return reply.code(400).send({ error: `Statut personnalisé invalide (${CUSTOM_MAX} caractères maximum).` });
      const until = typeof b.customStatusUntil === "number" && b.customStatusUntil > Date.now() ? Math.floor(b.customStatusUntil) : null;
      db.prepare("UPDATE users SET custom_status = ?, custom_status_until = ? WHERE id = ?").run(text, text ? until : null, me.id);
    }
    refreshPresence(me.id);
    sendToAudience(me.id, { type: "profile", userId: me.id });
    return lightProfile(userRow(me.id)!);
  });

  app.patch<{ Body: { dm?: unknown; call?: unknown; friend?: unknown; showGame?: unknown; showLastSeen?: unknown } }>(
    "/me/privacy",
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const b = req.body ?? {};
      const sets: string[] = [];
      const vals: (string | number)[] = [];
      for (const [key, column] of [
        ["dm", "dm_policy"],
        ["call", "call_policy"],
        ["friend", "friend_policy"],
      ] as const) {
        const v = b[key];
        if (v === undefined) continue;
        if (!(POLICIES[key] as readonly string[]).includes(v as string)) return reply.code(400).send({ error: "Réglage invalide." });
        sets.push(`${column} = ?`);
        vals.push(v as string);
      }
      for (const [key, column] of [
        ["showGame", "show_game"],
        ["showLastSeen", "show_last_seen"],
      ] as const) {
        const v = b[key];
        if (v === undefined) continue;
        if (typeof v !== "boolean") return reply.code(400).send({ error: "Réglage invalide." });
        sets.push(`${column} = ?`);
        vals.push(v ? 1 : 0);
      }
      if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, me.id);
      refreshGame(me.id);
      return { ok: true };
    },
  );

  // ---- Profils des autres --------------------------------------------------
  app.get<{ Params: { id: string } }>("/users/:id/profile", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const u = userRow(req.params.id);
    if (!u || !canSee(me, u.id)) return reply.code(404).send({ error: "Profil introuvable." });
    return fullProfile(me, u);
  });

  /** Profils résumés de plusieurs personnes d'un coup (noms, photos, statuts). */
  app.post<{ Body: { ids?: unknown } }>("/users/batch", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const ids = Array.isArray(req.body?.ids) ? (req.body!.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    return ids
      .map((id) => userRow(id))
      .filter((u): u is UserRow => !!u && canSee(me, u.id))
      .map(lightProfile);
  });

  // ---- Membres d'un serveur, avec statut ------------------------------------
  app.get<{ Params: { id: string } }>("/servers/:id/people", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    if (!accessOf(me, req.params.id)) return reply.code(404).send({ error: "Serveur introuvable." });
    const rows = db
      .prepare("SELECT u.*, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ?")
      .all(req.params.id) as (UserRow & { role: string })[];
    const rooms = db.prepare("SELECT id, label FROM rooms WHERE server_id = ?").all(req.params.id) as { id: string; label: string }[];
    const live = await liveParticipants(rooms.map((r) => r.id));
    const roomOf = new Map<string, { id: string; label: string }>();
    for (const r of rooms) for (const p of live.get(r.id) ?? []) roomOf.set(p.identity, r);
    const people = rows.map((u) => ({
      ...lightProfile(u),
      role: u.role,
      guest: false,
      room: roomOf.get(identityOf({ kind: "user", id: u.id, name: "" })) ?? null,
      lastSeen: presenceOf(u.id) === "offline" && u.show_last_seen ? u.last_seen : null,
    }));
    // Invités présents en vocal (ils n'ont pas de compte)
    for (const r of rooms)
      for (const p of live.get(r.id) ?? [])
        if (p.guest)
          people.push({
            id: p.identity,
            username: p.name,
            displayName: p.name,
            avatarUrl: null,
            accent: null,
            status: "online",
            customStatus: null,
            game: null,
            role: "guest",
            guest: true,
            room: r,
            lastSeen: null,
          });
    return people;
  });

  // ---- Blocage ---------------------------------------------------------------
  app.get("/blocks", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const rows = db.prepare("SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC").all(me.id) as UserRow[];
    return rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name || u.username, avatarUrl: attachmentUrl(u.avatar_id) }));
  });

  app.post<{ Params: { userId: string } }>("/blocks/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const other = req.params.userId;
    if (other === me.id || !userRow(other)) return reply.code(404).send({ error: "Compte introuvable." });
    db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(me.id, other, Date.now());
    const [a, b] = pair(me.id, other);
    db.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").run(a, b);
    setDmState(me.id, other, "ignored");
    sendToUser(other, { type: "friends" });
    sendToUser(me.id, { type: "friends" });
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>("/blocks/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(me.id, req.params.userId);
    setDmState(me.id, req.params.userId, null);
    sendToUser(me.id, { type: "friends" });
    return { ok: true };
  });
}
