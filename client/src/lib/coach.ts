/**
 * Mode coach : annotations sur un partage d'écran (crayon, flèche, ping).
 *
 * - Celui qui partage décide : annotations ouvertes à tous, ou désactivées
 *   (attribut LiveKit `coach` = "all" | absent).
 * - Les traits passent par le canal de données LiveKit (sujet « coach »), en coordonnées
 *   0..1 de l'image partagée : ils tombent au bon endroit quelle que soit la taille d'écran.
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
type Msg =
  | { t: "mark"; id: string; share: string; tool: Tool; pts: [number, number][] }
  | { t: "clear"; share: string };

const TOPIC = "coach";
export const FADE_MS = 10_000;
export const PING_MS = 1_600;

export const coachOpen = (p: Participant | undefined) => p?.attributes?.coach === "all";

export async function setCoachOpen(room: Room, open: boolean) {
  await room.localParticipant.setAttributes({ ...room.localParticipant.attributes, coach: open ? "all" : "" });
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Annotations reçues et envoyées dans une pièce. */
export class Coach {
  marks = new Map<string, Mark>();
  private listeners = new Set<() => void>();
  private off: () => void;

  constructor(private room: Room) {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      try {
        const msg = JSON.parse(dec.decode(payload)) as Msg;
        const sharer = msg.share === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(msg.share);
        // Annotations fermées par celui qui partage : on ignore.
        if (!coachOpen(sharer)) return;
        if (msg.t === "clear") this.clearFrom(msg.share, participant.identity);
        else if (msg.t === "mark" && Array.isArray(msg.pts) && msg.pts.length <= 400) this.put({ id: msg.id, share: msg.share, by: participant.identity, tool: msg.tool, pts: msg.pts, color: colorFor(participant.name || participant.identity).bg, at: Date.now() });
      } catch {
        // message illisible
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    this.off = () => room.off(RoomEvent.DataReceived, onData);
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

  private put(m: Mark) {
    this.marks.set(m.id, m);
    this.emit();
  }

  private clearFrom(share: string, by: string) {
    for (const [id, m] of this.marks) if (m.share === share && m.by === by) this.marks.delete(id);
    this.emit();
  }

  /** Mon trait (envoyé à chaque mise à jour, ~15 fois par seconde pendant qu'on dessine). */
  send(share: string, id: string, tool: Tool, pts: [number, number][]) {
    const me = this.room.localParticipant;
    this.put({ id, share, by: me.identity, tool, pts, color: colorFor(me.name || me.identity).bg, at: Date.now() });
    const msg: Msg = { t: "mark", id, share, tool, pts: pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) };
    void me.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC }).catch(() => {});
  }

  clearMine(share: string) {
    this.clearFrom(share, this.room.localParticipant.identity);
    void this.room.localParticipant.publishData(enc.encode(JSON.stringify({ t: "clear", share } satisfies Msg)), { reliable: true, topic: TOPIC }).catch(() => {});
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

/** Dessine les marques sur un canvas de la taille (w, h). */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], w: number, h: number, now = Date.now()) {
  const scale = Math.max(1, Math.min(w, h) / 540);
  for (const m of marks) {
    const life = m.tool === "ping" ? PING_MS : FADE_MS;
    const age = now - m.at;
    // Fondu sur la dernière seconde (ou toute la durée pour un ping)
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
