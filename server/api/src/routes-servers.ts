import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { db, tx, type Role } from "./db.js";
import { config } from "./config.js";
import { authenticate, cleanLabel, newInviteCode, requireUser, type Principal } from "./security.js";
import { closeRooms, identityOf, kickFromRooms, liveParticipants, pushRoomSpatial, voiceToken } from "./livekit.js";
import { sendToServer } from "./realtime.js";

type RoomRow = { id: string; server_id: string; label: string; position: number; spatial: number };

const MAX_SERVERS_PER_USER = 20;
const MAX_ROOMS_PER_SERVER = 30;

// ---------------------------------------------------------------------------
// Droits
// ---------------------------------------------------------------------------
function roleOf(serverId: string, userId: string): Role | undefined {
  const row = db.prepare("SELECT role FROM members WHERE server_id = ? AND user_id = ?").get(serverId, userId) as
    | { role: Role }
    | undefined;
  return row?.role;
}

/** Rôle de la personne sur le serveur ("guest" pour un invité), ou undefined si elle n'y a pas accès. */
function accessOf(p: Principal, serverId: string): Role | "guest" | undefined {
  if (p.kind === "guest") return p.serverId === serverId ? "guest" : undefined;
  return roleOf(serverId, p.id);
}

const isManager = (role: string | undefined) => role === "owner" || role === "admin";

/** Nouvel ordre des pièces (admins) : la liste complète des identifiants, dans l'ordre voulu. */
export function reorderRooms(serverId: string, ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((x) => typeof x === "string")) return "Liste invalide.";
  const existing = (db.prepare("SELECT id FROM rooms WHERE server_id = ?").all(serverId) as { id: string }[]).map((r) => r.id);
  const wanted = new Set(ids as string[]);
  if (wanted.size !== ids.length || wanted.size !== existing.length || !existing.every((id) => wanted.has(id))) {
    return "La liste ne correspond pas aux pièces du serveur (quelqu'un vient d'en ajouter ou d'en retirer ?).";
  }
  const update = db.prepare("UPDATE rooms SET position = ? WHERE id = ? AND server_id = ?");
  tx(() => (ids as string[]).forEach((id, i) => update.run(i, id, serverId)));
  return null;
}

/** Prévient les membres connectés : la liste des pièces / fils a changé. */
const changed = (serverId: string) => sendToServer(serverId, { type: "channels", serverId });

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "Serveur introuvable ou accès refusé." });
}

function forbidden(reply: FastifyReply, msg = "Seuls les admins du serveur peuvent faire ça.") {
  return reply.code(403).send({ error: msg });
}

function roomsOf(serverId: string): RoomRow[] {
  return db.prepare("SELECT * FROM rooms WHERE server_id = ? ORDER BY position, rowid").all(serverId) as RoomRow[];
}

function roomWithAccess(p: Principal, roomId: string) {
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as RoomRow | undefined;
  if (!room) return null;
  const role = accessOf(p, room.server_id);
  return role ? { room, role } : null;
}

export default async function serverRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Serveurs
  // -------------------------------------------------------------------------

  /** Mes serveurs, avec le nombre de personnes en vocal. Un invité ne voit que le sien. */
  app.get("/servers", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const servers = (
      me.kind === "guest"
        ? db.prepare("SELECT id, name, 'guest' AS role FROM servers WHERE id = ?").all(me.serverId)
        : db
            .prepare(
              "SELECT s.id, s.name, m.role FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY m.joined_at",
            )
            .all(me.id)
    ) as { id: string; name: string; role: string }[];

    const rooms = servers.flatMap((s) => roomsOf(s.id));
    const live = await liveParticipants(rooms.map((r) => r.id));
    return servers.map((s) => ({
      ...s,
      inVoice: rooms.filter((r) => r.server_id === s.id).reduce((n, r) => n + (live.get(r.id)?.length ?? 0), 0),
    }));
  });

  app.post<{ Body: { name?: unknown } }>("/servers", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const name = cleanLabel(req.body?.name, 40);
    if (!name) return reply.code(400).send({ error: "Nom de serveur invalide (1 à 40 caractères)." });
    const owned = db.prepare("SELECT COUNT(*) AS n FROM servers WHERE owner_id = ?").get(me.id) as { n: number };
    if (owned.n >= MAX_SERVERS_PER_USER)
      return reply.code(400).send({ error: `Tu as déjà créé ${MAX_SERVERS_PER_USER} serveurs.` });

    const server = { id: randomUUID(), name, role: "owner" as const, inVoice: 0 };
    const now = Date.now();
    tx(() => {
      db.prepare("INSERT INTO servers (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)").run(server.id, name, me.id, now);
      db.prepare("INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(
        server.id,
        me.id,
        now,
      );
      // Un premier salon pour démarrer ; l'admin peut le renommer ou le supprimer.
      db.prepare("INSERT INTO rooms (id, server_id, label, position) VALUES (?, ?, 'Général', 0)").run(
        randomUUID(),
        server.id,
      );
      db.prepare("INSERT INTO channels (id, server_id, name, position) VALUES (?, ?, 'général', 0)").run(
        randomUUID(),
        server.id,
      );
    });
    return server;
  });

  /** Détail d'un serveur : salons, occupants, mon rôle. */
  app.get<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const role = accessOf(me, req.params.id);
    if (!role) return notFound(reply);
    const server = db.prepare("SELECT id, name FROM servers WHERE id = ?").get(req.params.id) as { id: string; name: string };
    const rooms = roomsOf(server.id);
    const live = await liveParticipants(rooms.map((r) => r.id));
    return {
      ...server,
      role,
      rooms: rooms.map((r) => ({ id: r.id, label: r.label, spatial: !!r.spatial, participants: live.get(r.id) ?? [] })),
      channels: db.prepare("SELECT id, name FROM channels WHERE server_id = ? ORDER BY position, rowid").all(server.id),
    };
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>("/servers/:id", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (!isManager(role)) return forbidden(reply);
    const name = cleanLabel(req.body?.name, 40);
    if (!name) return reply.code(400).send({ error: "Nom de serveur invalide (1 à 40 caractères)." });
    db.prepare("UPDATE servers SET name = ? WHERE id = ?").run(name, req.params.id);
    return { id: req.params.id, name };
  });

  app.delete<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (role !== "owner") return forbidden(reply, "Seul le créateur du serveur peut le supprimer.");
    const roomIds = roomsOf(req.params.id).map((r) => r.id);
    db.prepare("DELETE FROM servers WHERE id = ?").run(req.params.id);
    await closeRooms(roomIds);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/servers/:id/members", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    if (!roleOf(req.params.id, me.id)) return notFound(reply);
    return db
      .prepare(
        "SELECT u.id, u.username, m.role, m.joined_at AS joinedAt FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username",
      )
      .all(req.params.id);
  });

  /** Nommer ou retirer un admin (réservé au créateur). */
  app.patch<{ Params: { id: string; userId: string }; Body: { role?: unknown } }>(
    "/servers/:id/members/:userId",
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const myRole = roleOf(req.params.id, me.id);
      if (!myRole) return notFound(reply);
      if (myRole !== "owner") return forbidden(reply, "Seul le créateur du serveur peut gérer les admins.");
      const role = req.body?.role;
      if (role !== "admin" && role !== "member") return reply.code(400).send({ error: "Rôle invalide." });
      const target = roleOf(req.params.id, req.params.userId);
      if (!target || target === "owner") return reply.code(400).send({ error: "Impossible de modifier ce membre." });
      db.prepare("UPDATE members SET role = ? WHERE server_id = ? AND user_id = ?").run(role, req.params.id, req.params.userId);
      return { ok: true };
    },
  );

  /** Exclure un membre (admins ; un admin ne peut pas exclure un autre admin). */
  app.delete<{ Params: { id: string; userId: string } }>("/servers/:id/members/:userId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const myRole = roleOf(req.params.id, me.id);
    if (!myRole) return notFound(reply);
    if (!isManager(myRole)) return forbidden(reply);
    const target = roleOf(req.params.id, req.params.userId);
    if (!target) return reply.code(404).send({ error: "Membre introuvable." });
    if (target === "owner" || (target === "admin" && myRole !== "owner"))
      return forbidden(reply, "Tu ne peux pas exclure ce membre.");
    db.prepare("DELETE FROM members WHERE server_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
    await kickFromRooms(`u:${req.params.userId}`, roomsOf(req.params.id).map((r) => r.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/servers/:id/leave", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (role === "owner")
      return reply.code(400).send({ error: "Tu as créé ce serveur : supprime-le plutôt que de le quitter." });
    db.prepare("DELETE FROM members WHERE server_id = ? AND user_id = ?").run(req.params.id, me.id);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Salons
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { label?: unknown } }>("/servers/:id/rooms", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (!isManager(role)) return forbidden(reply);
    const label = cleanLabel(req.body?.label, 32);
    if (!label) return reply.code(400).send({ error: "Nom de salon invalide (1 à 32 caractères)." });
    const rooms = roomsOf(req.params.id);
    if (rooms.length >= MAX_ROOMS_PER_SERVER) return reply.code(400).send({ error: "Trop de salons sur ce serveur." });
    const room = { id: randomUUID(), label, spatial: false, participants: [] };
    const position = rooms.reduce((max, r) => Math.max(max, r.position), -1) + 1;
    db.prepare("INSERT INTO rooms (id, server_id, label, position) VALUES (?, ?, ?, ?)").run(room.id, req.params.id, label, position);
    changed(req.params.id);
    return room;
  });

  /** Ranger les pièces (glisser-déposer). */
  app.put<{ Params: { id: string }; Body: { ids?: unknown } }>("/servers/:id/rooms/order", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (!isManager(role)) return forbidden(reply);
    const error = reorderRooms(req.params.id, req.body?.ids);
    if (error) return reply.code(409).send({ error });
    changed(req.params.id);
    return { ok: true };
  });

  /** Renommer (admins) ou basculer l'audio spatial (tous les membres). */
  app.patch<{ Params: { roomId: string }; Body: { label?: unknown; spatial?: unknown } }>(
    "/rooms/:roomId",
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const found = roomWithAccess(me, req.params.roomId);
      if (!found) return reply.code(404).send({ error: "Salon introuvable." });
      const { label, spatial } = req.body ?? {};
      if (label !== undefined) {
        if (!isManager(found.role)) return forbidden(reply);
        const clean = cleanLabel(label, 32);
        if (!clean) return reply.code(400).send({ error: "Nom de salon invalide (1 à 32 caractères)." });
        db.prepare("UPDATE rooms SET label = ? WHERE id = ?").run(clean, found.room.id);
        changed(found.room.server_id);
      }
      if (spatial !== undefined) {
        if (typeof spatial !== "boolean") return reply.code(400).send({ error: "Valeur invalide." });
        db.prepare("UPDATE rooms SET spatial = ? WHERE id = ?").run(spatial ? 1 : 0, found.room.id);
        await pushRoomSpatial(found.room.id, spatial);
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { roomId: string } }>("/rooms/:roomId", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const found = roomWithAccess(me, req.params.roomId);
    if (!found) return reply.code(404).send({ error: "Salon introuvable." });
    if (!isManager(found.role)) return forbidden(reply);
    db.prepare("DELETE FROM rooms WHERE id = ?").run(found.room.id);
    await closeRooms([found.room.id]);
    changed(found.room.server_id);
    return { ok: true };
  });

  /** Jeton pour entrer dans un salon vocal (membres et invités du serveur). */
  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/token", async (req, reply) => {
    const me = await authenticate(req, reply);
    if (!me) return;
    const found = roomWithAccess(me, req.params.roomId);
    if (!found) return reply.code(404).send({ error: "Salon introuvable." });
    return {
      url: config.livekit.url,
      token: await voiceToken(me, found.room.id),
      identity: identityOf(me),
      spatial: !!found.room.spatial,
    };
  });

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /**
   * Créer une invitation.
   * - member : pour un ami qui a (ou va créer) un compte. Tous les membres peuvent en créer.
   * - guest  : sans compte, pour une soirée (1 à 24 h). Tous les membres peuvent aussi en créer.
   */
  app.post<{ Params: { id: string }; Body: { kind?: unknown; hours?: unknown; maxUses?: unknown } }>(
    "/servers/:id/invites",
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const role = roleOf(req.params.id, me.id);
      if (!role) return notFound(reply);
      const kind = req.body?.kind === "guest" ? "guest" : "member";

      const hoursRaw = Number(req.body?.hours ?? (kind === "guest" ? 6 : 168));
      const hours = kind === "guest" ? Math.min(Math.max(hoursRaw, 1), 24) : Math.min(Math.max(hoursRaw, 1), 24 * 30);
      const maxUsesRaw = req.body?.maxUses;
      const maxUses =
        maxUsesRaw === null || maxUsesRaw === undefined
          ? kind === "guest"
            ? 10
            : null
          : Math.min(Math.max(Math.floor(Number(maxUsesRaw)) || 1, 1), 100);

      const invite = {
        code: newInviteCode(),
        kind,
        expiresAt: Date.now() + hours * 3600_000,
        maxUses,
        uses: 0,
      };
      db.prepare(
        "INSERT INTO invites (code, server_id, created_by, kind, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(invite.code, req.params.id, me.id, kind, maxUses, invite.expiresAt, Date.now());
      return invite;
    },
  );

  /** Invitations actives (admins). */
  app.get<{ Params: { id: string } }>("/servers/:id/invites", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const role = roleOf(req.params.id, me.id);
    if (!role) return notFound(reply);
    if (!isManager(role)) return forbidden(reply);
    return db
      .prepare(
        "SELECT i.code, i.kind, i.max_uses AS maxUses, i.uses, i.expires_at AS expiresAt, u.username AS createdBy FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.server_id = ? AND i.expires_at > ? ORDER BY i.created_at DESC",
      )
      .all(req.params.id, Date.now());
  });

  app.delete<{ Params: { code: string } }>("/invites/:code", async (req, reply) => {
    const me = await requireUser(req, reply);
    if (!me) return;
    const invite = db.prepare("SELECT server_id FROM invites WHERE code = ?").get(req.params.code.toUpperCase()) as
      | { server_id: string }
      | undefined;
    if (!invite) return reply.code(404).send({ error: "Invitation introuvable." });
    if (!isManager(roleOf(invite.server_id, me.id))) return forbidden(reply);
    db.prepare("DELETE FROM invites WHERE code = ?").run(req.params.code.toUpperCase());
    return { ok: true };
  });

  /** Rejoindre un serveur avec un code membre. */
  app.post<{ Params: { code: string } }>(
    "/invites/:code/accept",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const me = await requireUser(req, reply);
      if (!me) return;
      const code = req.params.code.trim().toUpperCase();
      const invite = db
        .prepare(
          "SELECT i.*, s.name AS server_name FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = ?",
        )
        .get(code) as
        | { code: string; server_id: string; kind: string; max_uses: number | null; uses: number; expires_at: number; server_name: string }
        | undefined;
      if (!invite || invite.expires_at < Date.now() || (invite.max_uses !== null && invite.uses >= invite.max_uses))
        return reply.code(404).send({ error: "Code invalide ou expiré." });
      if (invite.kind === "guest")
        return reply.code(400).send({ error: "C'est un code invité : il sert à rejoindre sans compte, depuis l'écran de connexion." });

      const already = roleOf(invite.server_id, me.id);
      if (!already) {
        tx(() => {
          db.prepare("INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(
            invite.server_id,
            me.id,
            Date.now(),
          );
          db.prepare("UPDATE invites SET uses = uses + 1 WHERE code = ?").run(code);
        });
      }
      return { id: invite.server_id, name: invite.server_name, role: already ?? "member", inVoice: 0 };
    },
  );
}
