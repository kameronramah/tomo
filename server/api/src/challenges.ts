/**
 * Défis à points, pour le fun (aucun argent, aucune mise : pas de paris pour l'instant).
 *
 * Parcours : quelqu'un lance un défi (« le plus de kills sur 3 parties », 100 points) →
 * les autres le relèvent → un participant déclare avoir gagné → les AUTRES participants votent ;
 * la majorité valide (il gagne les points) ou conteste (le défi reprend).
 * Classement du mois par serveur (remis à zéro chaque mois : on ne compte que le mois en cours).
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { db, tx } from "./db.js";
import { accessOf, isManager } from "./access.js";
import { requireUser, cleanLabel, authenticate, type Principal } from "./security.js";
import { sendToServer } from "./realtime.js";

db.exec(`
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  reward      INTEGER NOT NULL,
  ends_at     INTEGER,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | claimed | done | cancelled
  claimed_by  TEXT,
  winner_id   TEXT,
  closed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS challenges_by_server ON challenges (server_id, created_at);
CREATE TABLE IF NOT EXISTS challenge_players (
  challenge_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE IF NOT EXISTS challenge_votes (
  challenge_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  approve      INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE IF NOT EXISTS points (
  server_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS points_by_server ON points (server_id, created_at);
`);

type Row = {
  id: string;
  server_id: string;
  title: string;
  reward: number;
  ends_at: number | null;
  created_by: string;
  created_at: number;
  status: "open" | "claimed" | "done" | "cancelled";
  claimed_by: string | null;
  winner_id: string | null;
  closed_at: number | null;
};

const REWARDS = [25, 50, 100, 200, 500];
const MAX_OPEN = 30;

const row = (id: string) => db.prepare("SELECT * FROM challenges WHERE id = ?").get(id) as Row | undefined;
const players = (id: string) =>
  (db.prepare("SELECT user_id FROM challenge_players WHERE challenge_id = ? ORDER BY joined_at").all(id) as { user_id: string }[]).map((r) => r.user_id);

function view(r: Row) {
  const votes = db.prepare("SELECT user_id, approve FROM challenge_votes WHERE challenge_id = ?").all(r.id) as { user_id: string; approve: number }[];
  const ps = players(r.id);
  const expired = r.status === "open" && r.ends_at !== null && r.ends_at < Date.now();
  return {
    id: r.id,
    title: r.title,
    reward: r.reward,
    endsAt: r.ends_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    status: expired ? ("expired" as const) : r.status,
    claimedBy: r.claimed_by,
    winnerId: r.winner_id,
    players: ps,
    /** Votes nécessaires pour valider : majorité des autres participants */
    needed: r.claimed_by ? Math.floor((ps.length - 1) / 2) + 1 : 0,
    approvals: votes.filter((v) => v.approve).map((v) => v.user_id),
    rejections: votes.filter((v) => !v.approve).map((v) => v.user_id),
  };
}

/** Début du mois en cours (heure du serveur). */
function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export default async function challengeRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/servers/:id/challenges", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    if (!accessOf(me, req.params.id)) return reply.code(404).send({ error: "Serveur introuvable." });
    const rows = db
      .prepare(
        `SELECT * FROM challenges WHERE server_id = ? AND (status IN ('open','claimed') OR closed_at > ?)
         ORDER BY CASE status WHEN 'claimed' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, created_at DESC LIMIT 60`,
      )
      .all(req.params.id, Date.now() - 14 * 86400_000) as Row[];
    const leaderboard = db
      .prepare(
        `SELECT p.user_id AS userId, SUM(p.amount) AS points FROM points p
         JOIN members m ON m.server_id = p.server_id AND m.user_id = p.user_id
         WHERE p.server_id = ? AND p.created_at >= ? GROUP BY p.user_id ORDER BY points DESC LIMIT 20`,
      )
      .all(req.params.id, monthStart()) as { userId: string; points: number }[];
    return { challenges: rows.map(view), leaderboard, monthStart: monthStart() };
  });

  app.post<{ Params: { id: string }; Body: { title?: unknown; reward?: unknown; endsAt?: unknown } }>("/servers/:id/challenges", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const serverId = req.params.id;
    const role = accessOf(me, serverId);
    if (!role || role === "guest") return reply.code(404).send({ error: "Serveur introuvable." });
    const title = cleanLabel(req.body?.title, 100);
    if (!title) return reply.code(400).send({ error: "Décris le défi (100 caractères maximum)." });
    const reward = Number(req.body?.reward);
    if (!REWARDS.includes(reward)) return reply.code(400).send({ error: "Récompense invalide." });
    const endsAt = req.body?.endsAt;
    if (endsAt !== undefined && endsAt !== null && (typeof endsAt !== "number" || endsAt < Date.now() || endsAt > Date.now() + 31 * 86400_000))
      return reply.code(400).send({ error: "Date de fin invalide (dans les 31 jours)." });
    const open = (db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE server_id = ? AND status IN ('open','claimed')").get(serverId) as { n: number }).n;
    if (open >= MAX_OPEN) return reply.code(400).send({ error: "Trop de défis en cours sur ce serveur." });
    const id = randomUUID();
    const now = Date.now();
    tx(() => {
      db.prepare("INSERT INTO challenges (id, server_id, title, reward, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        serverId,
        title,
        reward,
        typeof endsAt === "number" ? Math.floor(endsAt) : null,
        me.id,
        now,
      );
      db.prepare("INSERT INTO challenge_players (challenge_id, user_id, joined_at) VALUES (?, ?, ?)").run(id, me.id, now);
    });
    sendToServer(serverId, { type: "challenges", serverId });
    return view(row(id)!);
  });

  /** Vérifie que le défi existe, qu'on est membre du serveur, et renvoie la ligne. */
  async function load(req: { params: { challengeId: string } }, me: Principal, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const r = row(req.params.challengeId);
    const role = r ? accessOf(me, r.server_id) : undefined;
    if (!r || !role || role === "guest") {
      reply.code(404).send({ error: "Défi introuvable." });
      return null;
    }
    return { r, role };
  }

  app.post<{ Params: { challengeId: string } }>("/challenges/:challengeId/join", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const got = await load(req, me, reply);
    if (!got) return;
    const v = view(got.r);
    if (v.status !== "open") return reply.code(400).send({ error: "Ce défi n'est plus ouvert." });
    if (v.players.length >= 50) return reply.code(400).send({ error: "Trop de participants." });
    db.prepare("INSERT OR IGNORE INTO challenge_players (challenge_id, user_id, joined_at) VALUES (?, ?, ?)").run(got.r.id, me.id, Date.now());
    sendToServer(got.r.server_id, { type: "challenges", serverId: got.r.server_id });
    return view(row(got.r.id)!);
  });

  app.delete<{ Params: { challengeId: string } }>("/challenges/:challengeId/join", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const got = await load(req, me, reply);
    if (!got) return;
    if (got.r.status !== "open") return reply.code(400).send({ error: "Trop tard : le résultat est en cours de validation." });
    db.prepare("DELETE FROM challenge_players WHERE challenge_id = ? AND user_id = ?").run(got.r.id, me.id);
    sendToServer(got.r.server_id, { type: "challenges", serverId: got.r.server_id });
    return view(row(got.r.id)!);
  });

  /** « J'ai gagné » : il faut au moins un autre participant pour valider. */
  app.post<{ Params: { challengeId: string } }>("/challenges/:challengeId/claim", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const got = await load(req, me, reply);
    if (!got) return;
    const v = view(got.r);
    if (v.status !== "open") return reply.code(400).send({ error: "Ce défi n'est plus ouvert." });
    if (!v.players.includes(me.id)) return reply.code(403).send({ error: "Relève d'abord le défi." });
    if (v.players.length < 2) return reply.code(400).send({ error: "Il faut au moins un autre participant pour valider." });
    db.prepare("UPDATE challenges SET status = 'claimed', claimed_by = ? WHERE id = ?").run(me.id, got.r.id);
    db.prepare("DELETE FROM challenge_votes WHERE challenge_id = ?").run(got.r.id);
    sendToServer(got.r.server_id, { type: "challenges", serverId: got.r.server_id });
    return view(row(got.r.id)!);
  });

  /** Vote des autres participants : la majorité valide ou conteste. */
  app.post<{ Params: { challengeId: string }; Body: { approve?: unknown } }>("/challenges/:challengeId/vote", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const got = await load(req, me, reply);
    if (!got) return;
    const { r } = got;
    if (r.status !== "claimed") return reply.code(400).send({ error: "Rien à valider pour l'instant." });
    const ps = players(r.id);
    if (!ps.includes(me.id) || me.id === r.claimed_by) return reply.code(403).send({ error: "Seuls les autres participants votent." });
    if (typeof req.body?.approve !== "boolean") return reply.code(400).send({ error: "Vote invalide." });
    db.prepare(
      "INSERT INTO challenge_votes (challenge_id, user_id, approve) VALUES (?, ?, ?) ON CONFLICT(challenge_id, user_id) DO UPDATE SET approve = excluded.approve",
    ).run(r.id, me.id, req.body.approve ? 1 : 0);
    const v = view(row(r.id)!);
    const others = ps.length - 1;
    if (v.approvals.length >= v.needed) {
      tx(() => {
        db.prepare("UPDATE challenges SET status = 'done', winner_id = claimed_by, closed_at = ? WHERE id = ?").run(Date.now(), r.id);
        db.prepare("INSERT INTO points (server_id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(
          r.server_id,
          r.claimed_by,
          r.reward,
          `défi:${r.id}`,
          Date.now(),
        );
      });
    } else if (v.rejections.length > others - v.needed) {
      // La validation n'est plus possible : le défi reprend.
      db.prepare("UPDATE challenges SET status = 'open', claimed_by = NULL WHERE id = ?").run(r.id);
      db.prepare("DELETE FROM challenge_votes WHERE challenge_id = ?").run(r.id);
    }
    sendToServer(r.server_id, { type: "challenges", serverId: r.server_id });
    return view(row(r.id)!);
  });

  /** Annuler (celui qui l'a lancé, ou un admin), tant que les points n'ont pas été donnés. */
  app.delete<{ Params: { challengeId: string } }>("/challenges/:challengeId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const got = await load(req, me, reply);
    if (!got) return;
    if (got.r.created_by !== me.id && !isManager(got.role)) return reply.code(403).send({ error: "Seuls celui qui l'a lancé et les admins peuvent l'annuler." });
    if (got.r.status === "done") return reply.code(400).send({ error: "Ce défi est terminé." });
    db.prepare("UPDATE challenges SET status = 'cancelled', closed_at = ? WHERE id = ?").run(Date.now(), got.r.id);
    sendToServer(got.r.server_id, { type: "challenges", serverId: got.r.server_id });
    return { ok: true };
  });
}
