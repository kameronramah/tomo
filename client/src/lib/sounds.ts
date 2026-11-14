/**
 * Sons d'interface de Tomo, synthétisés à la volée (aucun fichier audio, aucune licence).
 *
 * Direction artistique : des « galets » ronds et feutrés, comme une goutte ou un maillet en
 * feutre sur du bois — chaleureux, jamais pointus.
 * - Toutes les notes viennent de la même gamme (mi bémol majeur pentatonique, registre médium)
 *   → les sons vont ensemble et restent doux à l'oreille.
 * - Chaque note : quelques « modes » (fondamentale + harmoniques légèrement inharmoniques),
 *   une attaque arrondie de quelques millisecondes (pas de clic), une chute naturelle
 *   (exponentielle) et un petit « pop » de hauteur au départ : c'est ce qui donne le côté
 *   organique, comme un objet réel qu'on touche.
 * - Un filtre qui se referme pendant la note : brillant à l'impact, feutré ensuite.
 * - Légères variations à chaque lecture (hauteur, volume, temps) et placement stéréo :
 *   jamais deux fois exactement le même son, comme un vrai instrument.
 * - Une réverbération commune (petite pièce boisée, aigus amortis) et un compresseur doux.
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
  | "clip" // clip enregistré
  | "pttOn" // appuyer pour parler : touche enfoncée
  | "pttOff"; // touche relâchée

type TimbreDef = {
  /** Rapports de fréquence des modes (1 = fondamentale). */
  partials: number[];
  /** Volume de chaque mode. */
  gains: number[];
  /** Durée relative de chaque mode (les aigus s'éteignent plus vite). */
  decays: number[];
  /** Attaque (s) : assez longue pour ne jamais claquer. */
  attack: number;
  /** « Pop » : la note part à f × pop et rejoint f (constante de temps popTau). */
  pop: number;
  popTau: number;
  /** Filtre : ouvert à l'impact (lpStart), puis se referme vers lpEnd. */
  lpStart: number;
  lpEnd: number;
};

const TIMBRES = {
  /** Galet : rond, chaud, maillet en feutre sur du bois (arrivées, départs, appels). */
  pebble: { partials: [1, 2, 3.92], gains: [1, 0.16, 0.045], decays: [1, 0.45, 0.22], attack: 0.006, pop: 1.16, popTau: 0.012, lpStart: 4200, lpEnd: 1700 },
  /** Goutte : la hauteur remonte un peu au départ, comme une goutte d'eau (messages). */
  drop: { partials: [1, 2.01, 3.03], gains: [1, 0.12, 0.03], decays: [1, 0.5, 0.3], attack: 0.005, pop: 0.82, popTau: 0.018, lpStart: 5500, lpEnd: 2400 },
  /** Tap : court et mat, bout du doigt sur une table (micro, casque, appuyer pour parler). */
  tap: { partials: [1, 2.32, 4.1], gains: [1, 0.18, 0.05], decays: [1, 0.35, 0.18], attack: 0.004, pop: 1.45, popTau: 0.006, lpStart: 3000, lpEnd: 1100 },
  /** Cloche douce : plus longue et plus claire, pour la sonnerie et les clips. */
  bell: { partials: [1, 2, 3, 4.18], gains: [1, 0.22, 0.07, 0.035], decays: [1, 0.6, 0.38, 0.25], attack: 0.008, pop: 1.02, popTau: 0.02, lpStart: 6500, lpEnd: 2800 },
  /** Sous-grave : une rondeur discrète sous les sons importants. */
  sub: { partials: [1], gains: [1], decays: [1], attack: 0.014, pop: 1.0, popTau: 0.01, lpStart: 900, lpEnd: 600 },
} satisfies Record<string, TimbreDef>;
type Timbre = keyof typeof TIMBRES;

// Gamme : mi bémol majeur pentatonique (mi♭, fa, sol, si♭, do).
const N = {
  Eb3: 155.56, Bb3: 233.08,
  Eb4: 311.13, F4: 349.23, G4: 392.0, Bb4: 466.16, C5: 523.25,
  Eb5: 622.25, F5: 698.46, G5: 783.99, Bb5: 932.33, C6: 1046.5,
  Eb6: 1244.51, G6: 1567.98,
};

type Note = {
  f: number; // hauteur (Hz)
  t: number; // départ (s)
  d: number; // durée de résonance (s) : le son est quasi éteint à ce moment
  timbre?: Timbre;
  g?: number; // volume relatif
  pan?: number; // -1 (gauche) … 1 (droite)
};

type Sound = { notes: Note[]; reverb?: number; noise?: { t: number; d: number; g: number; freq: number } };

const SOUNDS: Record<SoundName, Sound> = {
  // Arriver : trois galets qui montent et s'ouvrent, avec une rondeur dessous.
  join: {
    notes: [
      { f: N.Eb5, t: 0, d: 0.32, g: 0.75, pan: -0.12 },
      { f: N.G5, t: 0.06, d: 0.34, g: 0.7, pan: 0 },
      { f: N.Bb5, t: 0.12, d: 0.6, g: 0.75, pan: 0.12 },
      { f: N.Eb4, t: 0, d: 0.35, timbre: "sub", g: 0.22 },
    ],
    reverb: 0.26,
  },
  // Partir : le même motif à l'envers, plus feutré et plus bas.
  leave: {
    notes: [
      { f: N.Bb5, t: 0, d: 0.28, g: 0.6, pan: 0.12 },
      { f: N.G5, t: 0.07, d: 0.3, g: 0.6, pan: 0 },
      { f: N.Eb5, t: 0.14, d: 0.55, g: 0.65, pan: -0.12 },
      { f: N.Eb4, t: 0.14, d: 0.35, timbre: "sub", g: 0.18 },
    ],
    reverb: 0.24,
  },
  // Quelqu'un arrive / part : deux petits galets, discrets.
  userJoin: { notes: [{ f: N.G5, t: 0, d: 0.24, g: 0.45, pan: -0.08 }, { f: N.C6, t: 0.055, d: 0.36, g: 0.4, pan: 0.08 }], reverb: 0.24 },
  userLeave: { notes: [{ f: N.C6, t: 0, d: 0.22, g: 0.35, pan: 0.08 }, { f: N.F5, t: 0.06, d: 0.34, g: 0.42, pan: -0.08 }], reverb: 0.24 },
  // Micro : un « tap » feutré, plus haut = activé, plus bas = coupé.
  mute: { notes: [{ f: N.Bb4, t: 0, d: 0.16, timbre: "tap", g: 0.75 }], reverb: 0.1 },
  unmute: { notes: [{ f: N.Eb5, t: 0, d: 0.16, timbre: "tap", g: 0.75 }], reverb: 0.1 },
  // Casque : deux taps (descendant = coupé, montant = rétabli).
  deafen: { notes: [{ f: N.Eb5, t: 0, d: 0.13, timbre: "tap", g: 0.65 }, { f: N.Bb4, t: 0.07, d: 0.2, timbre: "tap", g: 0.7 }], reverb: 0.1 },
  undeafen: { notes: [{ f: N.Bb4, t: 0, d: 0.13, timbre: "tap", g: 0.65 }, { f: N.Eb5, t: 0.07, d: 0.2, timbre: "tap", g: 0.7 }], reverb: 0.1 },
  // Appuyer pour parler : deux taps très courts et très discrets (on peut l'entendre souvent).
  pttOn: { notes: [{ f: N.F5, t: 0, d: 0.07, timbre: "tap", g: 0.32 }], reverb: 0.04 },
  pttOff: { notes: [{ f: N.C5, t: 0, d: 0.07, timbre: "tap", g: 0.28 }], reverb: 0.04 },
  // Message : deux gouttes qui montent, légères.
  message: { notes: [{ f: N.Bb5, t: 0, d: 0.3, timbre: "drop", g: 0.5, pan: -0.06 }, { f: N.Eb6, t: 0.075, d: 0.45, timbre: "drop", g: 0.42, pan: 0.06 }], reverb: 0.3 },
  // Appel entrant : un arpège chaleureux qui se balance (répété tant qu'on ne décroche pas).
  ring: {
    notes: [
      { f: N.Eb5, t: 0, d: 0.5, g: 0.7, pan: -0.15 },
      { f: N.G5, t: 0.14, d: 0.5, g: 0.65, pan: -0.05 },
      { f: N.Bb5, t: 0.28, d: 0.55, g: 0.65, pan: 0.05 },
      { f: N.Eb6, t: 0.42, d: 0.9, timbre: "bell", g: 0.42, pan: 0.15 },
      { f: N.Eb4, t: 0, d: 0.5, timbre: "sub", g: 0.16 },
      { f: N.Bb5, t: 0.7, d: 0.5, g: 0.45, pan: 0.05 },
      { f: N.Eb6, t: 0.84, d: 1.0, timbre: "bell", g: 0.36, pan: 0.15 },
    ],
    reverb: 0.3,
  },
  // Fin d'appel : trois galets qui descendent et se posent.
  callEnd: {
    notes: [
      { f: N.Bb5, t: 0, d: 0.28, g: 0.6, pan: 0.1 },
      { f: N.G5, t: 0.09, d: 0.3, g: 0.58, pan: 0 },
      { f: N.Eb5, t: 0.18, d: 0.7, g: 0.65, pan: -0.1 },
      { f: N.Eb4, t: 0.18, d: 0.45, timbre: "sub", g: 0.18 },
    ],
    reverb: 0.26,
  },
  // Clip : un déclic d'obturateur feutré puis un petit éclat de cloche.
  clip: {
    notes: [
      { f: N.Eb6, t: 0.035, d: 0.45, timbre: "bell", g: 0.34, pan: 0.08 },
      { f: N.Bb5, t: 0.035, d: 0.4, g: 0.38, pan: -0.08 },
    ],
    reverb: 0.28,
    noise: { t: 0, d: 0.035, g: 0.18, freq: 2600 },
  },
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
  pttOn: "voice",
  pttOff: "voice",
};

// ---------------------------------------------------------------------------
// Chaîne audio commune :
// notes → bus du son → (sec) ───────────────────────────────┐
//                    → envoi → filtre doux → réverbération ─┴→ master → aigus adoucis → compresseur → sortie
// ---------------------------------------------------------------------------
type Chain = { ctx: AudioContext; master: GainNode; dry: GainNode; reverbIn: AudioNode };
let chain: Chain | null = null;

/**
 * Réponse impulsionnelle synthétique : petite pièce boisée (~1,3 s), stéréo.
 * Les aigus s'éteignent plus vite que les graves (filtre qui se ferme avec le temps) :
 * c'est ce qui rend la queue chaude au lieu de « souffler ».
 */
function makeImpulse(ctx: AudioContext, seconds = 1.3, preDelay = 0.012) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * preDelay);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const coef = 0.85 - 0.75 * x; // filtre de plus en plus fermé
      y += coef * (Math.random() * 2 - 1 - y);
      const fadeIn = i - pre < 300 ? (i - pre) / 300 : 1;
      data[i] = y * Math.exp(-5.5 * x) * fadeIn;
    }
  }
  return buf;
}

function getChain(): Chain {
  if (chain) return chain;
  const ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 18;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 6000;
  shelf.gain.value = -4;
  shelf.connect(comp);
  const master = ctx.createGain();
  master.connect(shelf);
  const dry = ctx.createGain();
  dry.connect(master);
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  reverb.connect(master);
  const reverbIn = ctx.createBiquadFilter();
  reverbIn.type = "lowpass";
  reverbIn.frequency.value = 4500;
  reverbIn.connect(reverb);
  chain = { ctx, master, dry, reverbIn };
  return chain;
}

/** Petite variation aléatoire autour de 1 (± amount). */
const vary = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

function playNote(c: Chain, n: Note, start: number, out: AudioNode) {
  const { ctx } = c;
  const tb: TimbreDef = TIMBRES[n.timbre ?? "pebble"];
  // Variations à chaque lecture : ± 3 ms, ± 8 cents, ± 6 % de volume.
  const t0 = Math.max(ctx.currentTime, start + n.t + (n.t > 0 ? (Math.random() * 2 - 1) * 0.003 : 0));
  const f0 = n.f * Math.pow(2, ((Math.random() * 2 - 1) * 8) / 1200);
  const noteGain = (n.g ?? 1) * vary(0.06);

  // Filtre propre à la note : brillant à l'impact, puis feutré.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.4;
  filter.frequency.setValueAtTime(tb.lpStart, t0);
  filter.frequency.setTargetAtTime(tb.lpEnd, t0 + tb.attack, 0.06);
  let dest: AudioNode = out;
  if (n.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = n.pan;
    p.connect(out);
    dest = p;
  }
  filter.connect(dest);

  let end = t0;
  tb.partials.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    const f = f0 * ratio;
    osc.frequency.setValueAtTime(f * tb.pop, t0);
    osc.frequency.setTargetAtTime(f, t0, tb.popTau);
    // léger désaccord des harmoniques : plus vivant
    if (i > 0) osc.detune.value = (i % 2 ? 1 : -1) * 5;
    const peak = tb.gains[i] * noteGain;
    const d = Math.max(0.05, n.d * tb.decays[i]);
    // Attaque arrondie (aucun clic), puis chute exponentielle naturelle.
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + tb.attack);
    g.gain.setTargetAtTime(0, t0 + tb.attack, d / 5);
    osc.connect(g).connect(filter);
    const stop = t0 + tb.attack + d * 1.7;
    osc.start(t0);
    osc.stop(stop);
    end = Math.max(end, stop);
  });
  return end;
}

function playNoise(c: Chain, nz: NonNullable<Sound["noise"]>, start: number, out: AudioNode) {
  const { ctx } = c;
  const len = Math.floor(ctx.sampleRate * nz.d);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Bruit doux : enveloppe arrondie (montée puis descente), pas de bord franc.
  for (let i = 0; i < len; i++) {
    const x = i / len;
    data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, x * 4)) * Math.pow(1 - x, 2);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = nz.freq;
  bp.Q.value = 0.9;
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
    c.master.gain.value = 0.38 * s.volume;
    const sound = SOUNDS[name];
    const start = c.ctx.currentTime + 0.01;
    // Bus propre au son : une part sèche + une part envoyée dans la réverbération.
    const bus = c.ctx.createGain();
    bus.connect(c.dry);
    const send = c.ctx.createGain();
    send.gain.value = sound.reverb ?? 0.15;
    bus.connect(send).connect(c.reverbIn);
    let end = start;
    for (const n of sound.notes) end = Math.max(end, playNote(c, n, start, bus));
    if (sound.noise) playNoise(c, sound.noise, start, bus);
    // Libère le bus une fois le son terminé.
    setTimeout(() => {
      try {
        bus.disconnect();
        send.disconnect();
      } catch {
        /* déjà libéré */
      }
    }, (end - c.ctx.currentTime) * 1000 + 300);
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
