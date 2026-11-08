/**
 * Sons d'interface, synthétisés à la volée (aucun fichier audio, aucune licence).
 * Chaque son = quelques notes courtes avec une enveloppe douce.
 */
import { getSettings } from "./prefs";

export type SoundName =
  | "join" // je rejoins un salon
  | "leave" // je quitte un salon
  | "userJoin" // quelqu'un arrive
  | "userLeave" // quelqu'un part
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "message" // nouveau message (privé ou salon)
  | "ring" // appel entrant
  | "callEnd"
  | "clip"; // clip enregistré

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number };

const SOUNDS: Record<SoundName, Note[]> = {
  join: [
    { f: 523.25, t: 0, d: 0.12 },
    { f: 783.99, t: 0.09, d: 0.18 },
  ],
  leave: [
    { f: 659.25, t: 0, d: 0.12 },
    { f: 440, t: 0.09, d: 0.2 },
  ],
  userJoin: [{ f: 880, t: 0, d: 0.12, g: 0.6 }],
  userLeave: [{ f: 587.33, t: 0, d: 0.14, g: 0.6 }],
  mute: [{ f: 330, t: 0, d: 0.08, type: "square", g: 0.25 }],
  unmute: [{ f: 660, t: 0, d: 0.08, type: "square", g: 0.25 }],
  deafen: [
    { f: 392, t: 0, d: 0.08, type: "square", g: 0.25 },
    { f: 262, t: 0.07, d: 0.1, type: "square", g: 0.25 },
  ],
  undeafen: [
    { f: 262, t: 0, d: 0.08, type: "square", g: 0.25 },
    { f: 392, t: 0.07, d: 0.1, type: "square", g: 0.25 },
  ],
  message: [
    { f: 987.77, t: 0, d: 0.07, g: 0.7 },
    { f: 1318.5, t: 0.06, d: 0.1, g: 0.5 },
  ],
  ring: [
    { f: 659.25, t: 0, d: 0.18 },
    { f: 830.61, t: 0.2, d: 0.18 },
    { f: 659.25, t: 0.4, d: 0.18 },
    { f: 830.61, t: 0.6, d: 0.28 },
  ],
  clip: [
    { f: 1567.98, t: 0, d: 0.05, type: "triangle", g: 0.6 },
    { f: 2093, t: 0.05, d: 0.12, type: "triangle", g: 0.5 },
  ],
  callEnd: [
    { f: 523.25, t: 0, d: 0.12 },
    { f: 392, t: 0.12, d: 0.12 },
    { f: 261.63, t: 0.24, d: 0.22 },
  ],
};

const CATEGORY: Record<SoundName, "voice" | "messages" | "calls"> = {
  join: "voice",
  leave: "voice",
  userJoin: "voice",
  userLeave: "voice",
  mute: "voice",
  unmute: "voice",
  deafen: "voice",
  undeafen: "voice",
  message: "messages",
  ring: "calls",
  callEnd: "calls",
  clip: "voice",
};

let ctx: AudioContext | null = null;

export function playSound(name: SoundName, force = false) {
  const s = getSettings().sounds;
  if (!force && (!s.enabled || !s[CATEGORY[name]])) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.18 * s.volume;
    master.connect(ctx.destination);
    const start = ctx.currentTime + 0.01;
    for (const n of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const t0 = start + n.t;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(n.g ?? 1, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + n.d + 0.02);
    }
  } catch {
    // audio indisponible : pas de son, pas grave
  }
}

/** Sonnerie répétée tant que l'appel n'est pas décroché. Renvoie la fonction d'arrêt. */
export function startRinging(): () => void {
  playSound("ring");
  const t = setInterval(() => playSound("ring"), 2000);
  return () => clearInterval(t);
}
