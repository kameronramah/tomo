/**
 * Sons d'interface de Tomo, synthétisés à la volée (aucun fichier audio, aucune licence).
 *
 * Direction artistique commune : des « bulles » douces, entre le marimba et le verre.
 * - Toutes les notes viennent de la même gamme (ré majeur pentatonique) → les sons vont ensemble.
 * - Chaque note = une fondamentale + quelques harmoniques qui s'éteignent plus vite (timbre riche,
 *   pas de « bip » d'ordinateur), une attaque très courte et une légère glissade de hauteur.
 * - Une petite réverbération commune (pièce douce) et un compresseur donnent de la cohérence.
 * - Montée = on arrive / on active ; descente = on part / on coupe.
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

/** Timbres : rapports d'harmoniques, leur volume et leur durée relative. */
const TIMBRES = {
  /** Bulle : rond et chaud (marimba doux). */
  bubble: { partials: [1, 2, 3.01, 4.16], gains: [1, 0.32, 0.1, 0.04], decays: [1, 0.55, 0.3, 0.18], cutoff: 5200 },
  /** Verre : clair, légèrement inharmonique, plus long (messages). */
  glass: { partials: [1, 2.32, 4.25, 6.3], gains: [1, 0.28, 0.12, 0.05], decays: [1, 0.7, 0.45, 0.3], cutoff: 9000 },
  /** Bois : court et mat (micro / casque). */
  wood: { partials: [1, 2.76, 5.4], gains: [1, 0.25, 0.08], decays: [1, 0.4, 0.2], cutoff: 2600 },
} as const;
type Timbre = keyof typeof TIMBRES;

// Gamme : ré majeur pentatonique (ré, mi, fa#, la, si) sur plusieurs octaves.
const N = {
  D4: 293.66, A4: 440, B4: 493.88,
  D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77,
  D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760,
};

type Note = {
  f: number; // hauteur (Hz)
  t: number; // départ (s)
  d: number; // durée de résonance (s)
  timbre?: Timbre;
  g?: number; // volume relatif
  /** Glissade de départ : la note commence à f × glide et rejoint f en 50 ms. */
  glide?: number;
};

type Sound = { notes: Note[]; reverb?: number; noise?: { t: number; d: number; g: number; freq: number } };

const SOUNDS: Record<SoundName, Sound> = {
  // Arriver : deux bulles qui montent, la seconde s'ouvre.
  join: { notes: [{ f: N.D5, t: 0, d: 0.35, glide: 0.94 }, { f: N.A5, t: 0.085, d: 0.6, glide: 0.97, g: 0.9 }], reverb: 0.22 },
  // Partir : le même motif à l'envers, plus feutré.
  leave: { notes: [{ f: N.A5, t: 0, d: 0.3, g: 0.8 }, { f: N.D5, t: 0.09, d: 0.55, glide: 1.03, g: 0.75 }], reverb: 0.2 },
  // Quelqu'un arrive / part : une seule bulle, discrète.
  userJoin: { notes: [{ f: N.Fs5, t: 0, d: 0.28, glide: 0.9, g: 0.55 }, { f: N.B5, t: 0.05, d: 0.32, g: 0.3 }], reverb: 0.2 },
  userLeave: { notes: [{ f: N.B5, t: 0, d: 0.22, g: 0.35 }, { f: N.E5, t: 0.05, d: 0.32, glide: 1.06, g: 0.5 }], reverb: 0.2 },
  // Micro / casque : petits « toc » en bois, aigu = activé, grave = coupé.
  mute: { notes: [{ f: N.A4, t: 0, d: 0.16, timbre: "wood", glide: 1.04, g: 0.8 }], reverb: 0.08 },
  unmute: { notes: [{ f: N.D5, t: 0, d: 0.16, timbre: "wood", glide: 0.96, g: 0.8 }], reverb: 0.08 },
  deafen: { notes: [{ f: N.D5, t: 0, d: 0.14, timbre: "wood", g: 0.7 }, { f: N.A4, t: 0.075, d: 0.2, timbre: "wood", g: 0.75 }], reverb: 0.08 },
  undeafen: { notes: [{ f: N.A4, t: 0, d: 0.14, timbre: "wood", g: 0.7 }, { f: N.D5, t: 0.075, d: 0.2, timbre: "wood", g: 0.75 }], reverb: 0.08 },
  // Message : deux gouttes de verre, légères.
  message: { notes: [{ f: N.Fs6, t: 0, d: 0.4, timbre: "glass", g: 0.45 }, { f: N.A6, t: 0.07, d: 0.55, timbre: "glass", g: 0.35 }], reverb: 0.3 },
  // Appel entrant : un petit arpège chaleureux (répété tant qu'on ne décroche pas).
  ring: {
    notes: [
      { f: N.D5, t: 0, d: 0.45, g: 0.8 },
      { f: N.Fs5, t: 0.13, d: 0.45, g: 0.75 },
      { f: N.A5, t: 0.26, d: 0.5, g: 0.75 },
      { f: N.D6, t: 0.39, d: 0.8, timbre: "glass", g: 0.5 },
      { f: N.A5, t: 0.62, d: 0.5, g: 0.55 },
      { f: N.D6, t: 0.75, d: 0.9, timbre: "glass", g: 0.45 },
    ],
    reverb: 0.28,
  },
  // Fin d'appel : trois bulles qui descendent et se posent.
  callEnd: { notes: [{ f: N.A5, t: 0, d: 0.3, g: 0.7 }, { f: N.Fs5, t: 0.1, d: 0.32, g: 0.65 }, { f: N.D5, t: 0.2, d: 0.7, glide: 1.02, g: 0.7 }], reverb: 0.22 },
  // Clip : un « clic » d'obturateur très doux puis un éclat de verre.
  clip: { notes: [{ f: N.E6, t: 0.03, d: 0.35, timbre: "glass", g: 0.4 }, { f: N.B5, t: 0.03, d: 0.4, g: 0.35 }], reverb: 0.25, noise: { t: 0, d: 0.04, g: 0.25, freq: 3500 } },
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

// ---------------------------------------------------------------------------
// Chaîne audio commune : notes → (sec + réverbération) → compresseur → sortie
// ---------------------------------------------------------------------------
type Chain = { ctx: AudioContext; master: GainNode; dry: GainNode; reverb: ConvolverNode };
let chain: Chain | null = null;

/** Réponse impulsionnelle synthétique : une petite pièce douce (~1 s), stéréo. */
function makeImpulse(ctx: AudioContext, seconds = 1.1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.2) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}

function getChain(): Chain {
  if (chain) return chain;
  const ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(comp);
  const dry = ctx.createGain();
  dry.connect(master);
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  reverb.connect(master);
  chain = { ctx, master, dry, reverb };
  return chain;
}

function playNote(c: Chain, n: Note, start: number, out: AudioNode) {
  const { ctx } = c;
  const tb = TIMBRES[n.timbre ?? "bubble"];
  const t0 = start + n.t;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tb.cutoff;
  filter.Q.value = 0.3;
  filter.connect(out);
  const noteGain = n.g ?? 1;
  tb.partials.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    const f = n.f * ratio;
    if (n.glide) {
      osc.frequency.setValueAtTime(f * n.glide, t0);
      osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
    } else {
      osc.frequency.setValueAtTime(f, t0);
    }
    // léger désaccord des harmoniques : plus vivant
    if (i > 0) osc.detune.value = (i % 2 ? 1 : -1) * 4;
    const peak = tb.gains[i] * noteGain;
    const d = Math.max(0.04, n.d * tb.decays[i]);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(g).connect(filter);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
}

function playNoise(c: Chain, nz: NonNullable<Sound["noise"]>, start: number, out: AudioNode) {
  const { ctx } = c;
  const len = Math.floor(ctx.sampleRate * nz.d);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = nz.freq;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = nz.g;
  src.connect(bp).connect(g).connect(out);
  src.start(start + nz.t);
}

/** « Ne pas déranger » : plus de sons de messages ni d'appels (les sons du vocal restent). */
let quiet = false;
export const setQuietMode = (v: boolean) => void (quiet = v);
export const isQuietMode = () => quiet;

export function playSound(name: SoundName, force = false) {
  const s = getSettings().sounds;
  if (!force && (!s.enabled || !s[CATEGORY[name]])) return;
  if (!force && quiet && CATEGORY[name] !== "voice") return;
  try {
    const c = getChain();
    if (c.ctx.state === "suspended") void c.ctx.resume();
    c.master.gain.value = 0.32 * s.volume;
    const sound = SOUNDS[name];
    const start = c.ctx.currentTime + 0.01;
    // Bus propre au son : une part sèche + une part envoyée dans la réverbération.
    const bus = c.ctx.createGain();
    bus.connect(c.dry);
    const send = c.ctx.createGain();
    send.gain.value = sound.reverb ?? 0.15;
    bus.connect(send).connect(c.reverb);
    for (const n of sound.notes) playNote(c, n, start, bus);
    if (sound.noise) playNoise(c, sound.noise, start, bus);
  } catch {
    // audio indisponible : pas de son, pas grave
  }
}

/** Sonnerie répétée tant que l'appel n'est pas décroché. Renvoie la fonction d'arrêt. */
export function startRinging(): () => void {
  playSound("ring");
  const t = setInterval(() => playSound("ring"), 2400);
  return () => clearInterval(t);
}
