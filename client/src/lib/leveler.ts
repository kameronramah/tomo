/**
 * Volume uniformisé : chaque voix reçue est ramenée au même niveau, sans rien régler.
 *
 * Pour chaque personne :
 *  1. on mesure son niveau de voix toutes les 100 ms, UNIQUEMENT quand elle parle
 *     (le bruit de fond et les silences ne comptent pas, sinon on gonflerait le souffle) ;
 *  2. on en garde une moyenne glissante (~2 s) : le réglage suit la personne sans « pomper » ;
 *  3. un gain ramène cette moyenne vers un niveau cible commun (de -12 dB à +15 dB maximum) ;
 *  4. un compresseur doux puis un limiteur évitent qu'un cri ou un rire fasse sursauter.
 * Le volume choisi à la main par personne s'applique ensuite, par-dessus.
 */
import { getSettings, onSettingsChange } from "./prefs";

/** Niveau visé pour une voix « normale » (dBFS, mesure RMS). */
const TARGET_DB = -21;
/** En dessous : silence ou bruit de fond, on n'en tient pas compte. */
const GATE_DB = -52;
const MIN_GAIN_DB = -12;
const MAX_GAIN_DB = 18;
const TICK_MS = 100;
/** Vitesse d'adaptation de la moyenne (0,05 → ~2 s de parole pour converger). */
const SMOOTH = 0.05;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Remontée automatique appliquée par un compresseur Web Audio (formule de la norme : 0,6 × réduction à 0 dBFS). */
function makeupDb({ threshold, ratio }: { threshold: number; ratio: number }) {
  const outAtFullScale = threshold + -threshold / ratio;
  return -0.6 * outAtFullScale;
}

type Chain = {
  tap: GainNode; // entrée : alimente aussi la mesure
  input: GainNode; // gain automatique
  analyser: AnalyserNode; // mesure avant le gain
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  trim: GainNode;
  buf: Float32Array<ArrayBuffer>;
  /** Niveau moyen de la voix (dBFS), null tant qu'on ne l'a pas entendue parler. */
  level: number | null;
  gainDb: number;
};

export class VoiceLeveler {
  private chains = new Map<string, Chain>();
  private timer: ReturnType<typeof setInterval>;
  private enabled = getSettings().audio.normalize;
  private off: () => void;
  /** Appelé quand l'option est activée / coupée : il faut rebrancher les voix. */
  onToggle: (() => void) | null = null;

  constructor(private ctx: AudioContext) {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.off = onSettingsChange((s) => {
      if (s.audio.normalize !== this.enabled) {
        this.enabled = s.audio.normalize;
        this.onToggle?.();
      }
    });
  }

  get isEnabled() {
    return this.enabled;
  }

  /** Les nœuds à placer sur la voix de cette personne (vide si l'option est coupée). */
  nodesFor(id: string): AudioNode[] {
    if (!this.enabled) return [];
    let c = this.chains.get(id);
    if (!c) {
      const tap = new GainNode(this.ctx, { gain: 1 });
      const analyser = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
      // On mesure ce qui ENTRE (avant correction) : la mesure ne dépend pas de notre propre gain.
      // (branchement à nous ; LiveKit ne débranche que les liens qu'il crée lui-même)
      tap.connect(analyser);
      const input = new GainNode(this.ctx, { gain: 1 });
      const comp = { threshold: -26, knee: 12, ratio: 3 };
      const lim = { threshold: -3, knee: 0, ratio: 20 };
      const compressor = new DynamicsCompressorNode(this.ctx, { ...comp, attack: 0.005, release: 0.25 });
      const limiter = new DynamicsCompressorNode(this.ctx, { ...lim, attack: 0.001, release: 0.1 });
      // Le compresseur du navigateur remonte tout seul le volume (« makeup gain ») : on l'annule,
      // sinon les voix fortes ne baisseraient pas.
      // (+8 dB mesurés : la compression douce en dessous du seuil retire déjà une partie du gain)
      const trim = new GainNode(this.ctx, { gain: dbToGain(-(makeupDb(comp) + makeupDb(lim)) + 8) });
      c = { tap, input, analyser, compressor, limiter, trim, buf: new Float32Array(analyser.fftSize), level: null, gainDb: 0 };
      this.chains.set(id, c);
    }
    // LiveKit relie ces nœuds en ligne droite : voix → tap → gain auto → compresseur → limiteur → correction → (suite)
    return [c.tap, c.input, c.compressor, c.limiter, c.trim];
  }

  /** La personne est partie : on oublie son réglage. */
  forget(id: string) {
    const c = this.chains.get(id);
    if (!c) return;
    c.tap.disconnect();
    c.input.disconnect();
    c.compressor.disconnect();
    c.limiter.disconnect();
    c.trim.disconnect();
    this.chains.delete(id);
  }

  /** Niveau mesuré et correction appliquée (pour l'affichage / le débogage). */
  stats(id: string) {
    const c = this.chains.get(id);
    return c ? { levelDb: c.level, gainDb: Math.round(c.gainDb * 10) / 10 } : null;
  }

  private tick() {
    for (const c of this.chains.values()) {
      c.analyser.getFloatTimeDomainData(c.buf);
      let sum = 0;
      for (const v of c.buf) sum += v * v;
      const db = 10 * Math.log10(sum / c.buf.length + 1e-12);
      if (db < GATE_DB) continue; // silence : on garde le réglage actuel
      c.level = c.level === null ? db : c.level + (db - c.level) * SMOOTH;
      const wanted = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, TARGET_DB - c.level));
      if (Math.abs(wanted - c.gainDb) < 0.25) continue;
      c.gainDb = wanted;
      c.input.gain.setTargetAtTime(dbToGain(wanted), this.ctx.currentTime, 0.4);
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.off();
    for (const id of [...this.chains.keys()]) this.forget(id);
  }
}
