/**
 * Mode coach : annotations sur un partage d'écran (crayon, flèche, ping).
 *
 * - Un pote **demande** à annoter ; celui qui partage **accepte ou refuse** (ou ouvre à tous).
 *   Les personnes autorisées sont dans l'attribut LiveKit `coach` du partageur :
 *   "all" (tout le monde) ou la liste des identités, séparées par des virgules.
 * - Les traits passent par le canal de données LiveKit (sujet « coach »), en coordonnées 0..1
 *   de l'image partagée. Ils s'affichent chez ceux qui regardent ET directement sur l'écran
 *   de celui qui partage (fenêtre transparente traversée par les clics, voir coachScreen.ts).
 * - Chaque trait s'efface au bout de quelques secondes ; un ping disparaît tout de suite.
 */
import { RoomEvent, type Participant, type RemoteParticipant, type Room } from "livekit-client";
import { colorFor } from "./ui";

export type Tool = "pen" | "arrow" | "ping";
export type Mark = {
  id: string;
  share: string; // identité de celui qui partage
  by: string; // identité de l'auteur
  tool: Tool;
  color: string;
  pts: [number, number][];
  at: number; // reçu à (horloge locale)
};
export type CoachRequest = { identity: string; name: string; at: number };
type Msg =
  | { t: "mark"; id: string; share: string; tool: Tool; pts: [number, number][] }
  | { t: "clear"; share: string }
  | { t: "ask"; share: string }
  | { t: "answer"; share: string; to: string; ok: boolean };

const TOPIC = "coach";
export const FADE_MS = 10_000;
export const PING_MS = 1_600;

/** Qui peut annoter le partage de `sharer` ? */
function allowedList(sharer: Participant | undefined): "all" | string[] {
  const v = sharer?.attributes?.coach ?? "";
  if (v === "all") return "all";
  return v ? v.split(",") : [];
}
export function canAnnotate(sharer: Participant | undefined, identity: string) {
  if (!sharer) return false;
  if (sharer.identity === identity) return true; // celui qui partage peut toujours dessiner
  const a = allowedList(sharer);
  return a === "all" || a.includes(identity);
}
/** Annotations ouvertes à au moins une personne ? */
export const coachActive = (sharer: Participant | undefined) => {
  const a = allowedList(sharer);
  return a === "all" || a.length > 0;
};

async function setAllowed(room: Room, value: "all" | string[]) {
  const me = room.localParticipant;
  await me.setAttributes({ ...me.attributes, coach: value === "all" ? "all" : value.join(",") });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Annotations reçues et envoyées dans une pièce (un seul moteur par connexion vocale). */
export class Coach {
  marks = new Map<string, Mark>();
  /** Demandes reçues (quand je partage) */
  requests: CoachRequest[] = [];
  /** Mes demandes envoyées : identité du partageur → état */
  asked = new Map<string, "pending" | "refused">();
  private listeners = new Set<() => void>();
  private off: () => void;

  constructor(private room: Room) {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      try {
        this.onMsg(JSON.parse(dec.decode(payload)) as Msg, participant);
      } catch {
        // message illisible
      }
    };
    const onAttrs = () => {
      // Autorisation reçue : la demande n'est plus en attente
      for (const share of [...this.asked.keys()]) if (canAnnotate(this.participant(share), room.localParticipant.identity)) this.asked.delete(share);
      this.emit();
    };
    const onLeft = (p: RemoteParticipant) => {
      this.requests = this.requests.filter((r) => r.identity !== p.identity);
      this.emit();
    };
    room.on(RoomEvent.DataReceived, onData).on(RoomEvent.ParticipantAttributesChanged, onAttrs).on(RoomEvent.ParticipantDisconnected, onLeft);
    this.off = () => room.off(RoomEvent.DataReceived, onData).off(RoomEvent.ParticipantAttributesChanged, onAttrs).off(RoomEvent.ParticipantDisconnected, onLeft);
  }

  private participant(identity: string): Participant | undefined {
    return identity === this.room.localParticipant.identity ? this.room.localParticipant : this.room.remoteParticipants.get(identity);
  }

  private onMsg(msg: Msg, from: RemoteParticipant) {
    const me = this.room.localParticipant;
    if (msg.t === "ask") {
      // Demande d'annoter MON écran
      if (msg.share !== me.identity || !me.isScreenShareEnabled || canAnnotate(me, from.identity)) return;
      if (!this.requests.some((r) => r.identity === from.identity)) this.requests.push({ identity: from.identity, name: from.name || from.identity, at: Date.now() });
      this.emit();
      return;
    }
    if (msg.t === "answer") {
      if (msg.to !== me.identity || from.identity !== msg.share) return;
      if (msg.ok) this.asked.delete(msg.share);
      else this.asked.set(msg.share, "refused");
      this.emit();
      return;
    }
    // Traits : seulement ceux des personnes autorisées par celui qui partage
    if (!canAnnotate(this.participant(msg.share), from.identity)) return;
    if (msg.t === "clear") this.clearFrom(msg.share, from.identity);
    else if (msg.t === "mark" && Array.isArray(msg.pts) && msg.pts.length <= 400)
      this.put({ id: msg.id, share: msg.share, by: from.identity, tool: msg.tool, pts: msg.pts, color: colorFor(from.name || from.identity).bg, at: Date.now() });
  }

  dispose() {
    this.off();
    this.listeners.clear();
  }

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private publish(msg: Msg, to?: string[]) {
    void this.room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC, destinationIdentities: to }).catch(() => {});
  }

  private put(m: Mark) {
    this.marks.set(m.id, m);
    this.emit();
  }

  private clearFrom(share: string, by: string) {
    for (const [id, m] of this.marks) if (m.share === share && m.by === by) this.marks.delete(id);
    this.emit();
  }

  // ---- Côté spectateur ----------------------------------------------------------------
  /** Demander à celui qui partage la permission d'annoter son écran. */
  ask(share: string) {
    this.asked.set(share, "pending");
    this.publish({ t: "ask", share }, [share]);
    this.emit();
  }

  /** Mon trait (envoyé ~15 fois par seconde pendant qu'on dessine). */
  send(share: string, id: string, tool: Tool, pts: [number, number][]) {
    const me = this.room.localParticipant;
    this.put({ id, share, by: me.identity, tool, pts, color: colorFor(me.name || me.identity).bg, at: Date.now() });
    this.publish({ t: "mark", id, share, tool, pts: pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) });
  }

  clearMine(share: string) {
    this.clearFrom(share, this.room.localParticipant.identity);
    this.publish({ t: "clear", share });
  }

  // ---- Côté partageur -----------------------------------------------------------------
  async answer(identity: string, ok: boolean) {
    const me = this.room.localParticipant;
    this.requests = this.requests.filter((r) => r.identity !== identity);
    if (ok) {
      const a = allowedList(me);
      if (a !== "all" && !a.includes(identity)) await setAllowed(this.room, [...a, identity]).catch(() => {});
    }
    this.publish({ t: "answer", share: me.identity, to: identity, ok }, [identity]);
    this.emit();
  }

  /** Ouvrir à tous / tout fermer (retire aussi les autorisations individuelles). */
  async setOpenToAll(open: boolean) {
    await setAllowed(this.room, open ? "all" : []).catch(() => {});
    if (!open) for (const [id, m] of this.marks) if (m.share === this.room.localParticipant.identity && m.by !== m.share) this.marks.delete(id);
    this.emit();
  }

  /** Retirer l'autorisation d'une personne. */
  async revoke(identity: string) {
    const a = allowedList(this.room.localParticipant);
    if (a === "all") return;
    await setAllowed(
      this.room,
      a.filter((x) => x !== identity),
    ).catch(() => {});
    this.emit();
  }

  allowed() {
    return allowedList(this.room.localParticipant);
  }

  /** Fin de mon partage : tout se referme. */
  async stopSharing() {
    this.requests = [];
    await setAllowed(this.room, []).catch(() => {});
    this.emit();
  }

  /** Marques encore visibles pour un partage (les vieilles sont oubliées). */
  visible(share: string, now = Date.now()) {
    const out: Mark[] = [];
    for (const [id, m] of this.marks) {
      const life = m.tool === "ping" ? PING_MS : FADE_MS;
      if (now - m.at > life) this.marks.delete(id);
      else if (m.share === share) out.push(m);
    }
    return out;
  }
}

// Un moteur par connexion vocale
const engines = new WeakMap<Room, Coach>();
export function coachFor(room: Room): Coach {
  let c = engines.get(room);
  if (!c) {
    const created = new Coach(room);
    engines.set(room, created);
    room.once(RoomEvent.Disconnected, () => {
      created.dispose();
      engines.delete(room);
    });
    c = created;
  }
  return c;
}

/** Dessine les marques sur un canvas de la taille (w, h). */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], w: number, h: number, now = Date.now()) {
  const scale = Math.max(1, Math.min(w, h) / 540);
  for (const m of marks) {
    const life = m.tool === "ping" ? PING_MS : FADE_MS;
    const age = now - m.at;
    const alpha = m.tool === "ping" ? 1 - age / life : Math.min(1, (life - age) / 1000);
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineWidth = 4 * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const P = m.pts.map(([x, y]) => [x * w, y * h] as const);
    if (m.tool === "ping" && P[0]) {
      const r = (14 + (age / life) * 40) * scale;
      ctx.beginPath();
      ctx.arc(P[0][0], P[0][1], r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(P[0][0], P[0][1], 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (P.length < 2) continue;
    ctx.beginPath();
    if (m.tool === "arrow") {
      const [a, b] = [P[0], P[P.length - 1]];
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = 18 * scale;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45));
      ctx.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.moveTo(P[0][0], P[0][1]);
      for (const p of P.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
