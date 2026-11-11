/**
 * Sous-titres en direct (+ traduction), calculés sur le PC.
 *
 * Pour chaque voix reçue : on écoute à 16 kHz, on découpe en phrases (silence de 0,6 s ; passé
 * 7 s, à la première respiration ; 15 s au plus), en gardant le tout début de la phrase (les
 * 300 ms d'avant le premier son), puis le fil de calcul (captions.worker.ts) transcrit avec
 * Whisper dans la langue de la personne (attribut LiveKit `lang`, sa langue de tomo).
 * Une phrase coupée en route est recollée à la suivante : c'est la phrase entière qui est
 * affichée, et traduite si la personne parle une autre langue que moi (français ⇄ anglais).
 * Rien n'est envoyé ailleurs ; la transcription s'efface quand on quitte la pièce.
 */
import { RoomEvent, Track, type RemoteAudioTrack, type RemoteParticipant, type RemoteTrack, type Room } from "livekit-client";
import { lang as myLang } from "./i18n";
import { getSettings } from "./prefs";

export type Line = {
  id: string;
  identity: string;
  name: string;
  at: number;
  text: string;
  /** Texte d'origine quand la ligne a été traduite */
  original?: string;
  from?: string;
  pending: boolean;
  /** Coupée en pleine phrase : le morceau suivant s'y recolle */
  cont?: boolean;
  /** Morceau précédent de la même phrase (s'il a été coupé en route) */
  joinTo?: string;
  /** Numéro de la traduction en cours (une traduction dépassée est ignorée) */
  rev?: number;
};

export type CaptionsStatus = {
  state: "off" | "loading" | "ready" | "error";
  progress: number;
  message?: string;
  /** Téléchargement du modèle de traduction en cours (0 – 100), sinon absent */
  translation?: number;
};

const SAMPLE_RATE = 16000;
/** Silence qui termine une phrase */
const SILENCE_MS = 600;
/** Passé cette durée, on coupe à la première respiration… */
const SOFT_MS = 7_000;
const PAUSE_MS = 220;
/** … et de toute façon ici (Whisper travaille par tranches de 30 s au plus) */
const MAX_MS = 15_000;
/** Moins de voix que ça = un clic, une touche de clavier : on ne transcrit pas (Whisper inventerait une phrase) */
const MIN_VOICE_MS = 180;
/** Ce qu'on garde d'avant le premier son : l'attaque des mots (« s », « f », « ch »…) est sous le seuil */
const PRE_MS = 300;
const THRESHOLD = 0.01;
/** Une phrase recollée ne dépasse pas cette longueur (sinon nouvelle ligne) */
const JOIN_MAX = 240;

/** Phrases que Whisper invente sur du silence ou du bruit (souvenirs de sous-titres de vidéos). */
const INVENTED =
  /sous-titr(es|age)\b.*(amara|st' ?501|soci[eé]t[eé] radio|communaut[eé])|merci d'avoir regard[eé]|abonnez-vous|thanks? (you )?for watching|subtitles by|amara\.org|please subscribe/i;

/** Nettoie une transcription : bruits entre crochets, phrases inventées, boucles. Vide = à jeter. */
export function cleanTranscript(raw: string): string {
  const text = raw
    .replace(/[[(][^\])]*[\])]/g, " ") // « [Musique] », « (rires) »…
    .replace(/\s+/g, " ")
    .trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return "";
  if (INVENTED.test(text)) return "";
  // le modèle qui déraille répète le même bout en boucle
  if (/([\p{L}\p{N}][\p{L}\p{N}' -]{1,40}?)(?:[\s,.!?]+\1){5,}/iu.test(text)) return "";
  return text;
}

/** Recolle deux morceaux d'une même phrase (Whisper met un point à la fin de chaque morceau). */
export function joinTranscripts(a: string, b: string): string {
  return `${a.replace(/\s*(\.{3}|…|\.)$/, "")} ${b}`;
}

const WORKLET = `
class Grab extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("tomo-grab", Grab);`;

// ---------------------------------------------------------------------------
// Sous-titres actifs (un seul à la fois : la pièce où je suis)
// ---------------------------------------------------------------------------
let active: Captions | null = null;
const activeListeners = new Set<() => void>();
const emitActive = () => activeListeners.forEach((l) => l());
let offActive: (() => void) | null = null;

export const getCaptions = () => active;
/** Prévient à chaque changement (activation, nouvelle ligne, chargement du modèle). */
export function onCaptions(fn: () => void) {
  activeListeners.add(fn);
  return () => void activeListeners.delete(fn);
}
export function startCaptions(room: Room) {
  stopCaptions();
  active = new Captions(room);
  offActive = active.on(emitActive);
  emitActive();
}
export function stopCaptions() {
  offActive?.();
  offActive = null;
  active?.dispose();
  active = null;
  emitActive();
}

/** Publie ma langue (pour que les autres sachent dans quelle langue me transcrire). */
export function publishMyLang(room: Room) {
  void room.localParticipant.setAttributes({ ...room.localParticipant.attributes, lang: myLang }).catch(() => {});
}

/**
 * Un seul fil de calcul pour toute la session : le modèle reste chargé en mémoire quand on
 * change de pièce ou qu'on rallume les sous-titres (plus de rechargement à chaque fois).
 */
let sharedWorker: Worker | null = null;
function captionsWorker(): Worker {
  sharedWorker ??= new Worker(new URL("./captions.worker.ts", import.meta.url), { type: "module" });
  return sharedWorker;
}

export class Captions {
  lines: Line[] = [];
  status: CaptionsStatus = { state: "off", progress: 0 };
  private worker: Worker;
  private ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  private grabs = new Map<string, () => void>();
  private listeners = new Set<() => void>();
  private offRoom: () => void;
  private moduleReady: Promise<void>;
  private translateTo: string | null;
  /** Morceaux recollés : identifiant du morceau disparu → ligne qui le contient */
  private merged = new Map<string, string>();
  /** Dernière ligne de chacun, si elle a été coupée en pleine phrase */
  private open = new Map<string, string>();

  constructor(private room: Room) {
    this.translateTo = getSettings().captions.translate ? myLang : null;
    this.worker = captionsWorker();
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.status = { state: "loading", progress: 0 };
    this.worker.postMessage({ type: "load", model: getSettings().captions.model });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    this.moduleReady = this.ctx.audioWorklet.addModule(url);

    const onSub = (track: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio && track.source === Track.Source.Microphone) void this.listen(p, track as RemoteAudioTrack);
    };
    const onUnsub = (track: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (track.source === Track.Source.Microphone) this.stop(p.identity);
    };
    room.on(RoomEvent.TrackSubscribed, onSub).on(RoomEvent.TrackUnsubscribed, onUnsub);
    this.offRoom = () => room.off(RoomEvent.TrackSubscribed, onSub).off(RoomEvent.TrackUnsubscribed, onUnsub);
    room.remoteParticipants.forEach((p) =>
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track && pub.source === Track.Source.Microphone) void this.listen(p, pub.track as RemoteAudioTrack);
      }),
    );
    // Les autres voient l'icône CC sur ma bulle
    void room.localParticipant.setAttributes({ ...room.localParticipant.attributes, cc: "1" }).catch(() => {});
  }

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  setTranslate(on: boolean) {
    this.translateTo = on ? myLang : null;
  }

  dispose() {
    this.offRoom();
    this.grabs.forEach((stop) => stop());
    this.grabs.clear();
    this.worker.onmessage = null; // le fil reste prêt pour la prochaine fois
    void this.ctx.close().catch(() => {});
    void this.room.localParticipant.setAttributes({ ...this.room.localParticipant.attributes, cc: "" }).catch(() => {});
    this.listeners.clear();
  }

  private stop(identity: string) {
    this.grabs.get(identity)?.();
    this.grabs.delete(identity);
    this.open.delete(identity);
  }

  private langOf(p: RemoteParticipant) {
    return p.attributes?.lang === "en" ? "en" : p.attributes?.lang === "fr" ? "fr" : myLang;
  }

  private async listen(p: RemoteParticipant, track: RemoteAudioTrack) {
    this.stop(p.identity);
    await this.moduleReady;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const node = new AudioWorkletNode(this.ctx, "tomo-grab");
    src.connect(node);
    // Le modèle de traduction se prépare dès qu'on sait qu'il servira (pas à la première phrase)
    const from = this.langOf(p);
    if (this.translateTo && from !== this.translateTo) this.worker.postMessage({ type: "preload", from, to: this.translateTo });

    let chunks: Float32Array[] = [];
    let length = 0;
    let silentFor = 0;
    let voiceMs = 0;
    let voiced = false;
    /** Les derniers instants avant que la personne parle */
    let pre: Float32Array[] = [];
    let preLength = 0;
    const flush = (cont: boolean) => {
      if (voiceMs >= MIN_VOICE_MS) {
        const audio = new Float32Array(length);
        let o = 0;
        for (const c of chunks) (audio.set(c, o), (o += c.length));
        this.submit(p, audio, cont);
      } else {
        this.open.delete(p.identity); // un bruit : la phrase d'avant est bien finie
      }
      chunks = [];
      length = 0;
      silentFor = 0;
      voiceMs = 0;
      voiced = false;
    };
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data;
      let sum = 0;
      for (const v of frame) sum += v * v;
      const loud = Math.sqrt(sum / frame.length) > THRESHOLD;
      const ms = (frame.length / SAMPLE_RATE) * 1000;
      if (!voiced) {
        if (!loud) {
          pre.push(frame);
          preLength += frame.length;
          while (preLength - pre[0].length >= (SAMPLE_RATE * PRE_MS) / 1000) preLength -= pre.shift()!.length;
          return; // on attend que la personne parle
        }
        chunks = pre;
        length = preLength;
        pre = [];
        preLength = 0;
        voiced = true;
      }
      chunks.push(frame);
      length += frame.length;
      if (loud) (voiceMs += ms), (silentFor = 0);
      else silentFor += ms;
      const total = (length / SAMPLE_RATE) * 1000;
      if (silentFor >= SILENCE_MS) flush(false);
      else if ((total >= SOFT_MS && silentFor >= PAUSE_MS) || total >= MAX_MS) flush(true);
    };
    this.grabs.set(p.identity, () => {
      node.port.onmessage = null;
      src.disconnect();
      node.disconnect();
    });
  }

  private submit(p: RemoteParticipant, audio: Float32Array, cont: boolean) {
    // Une voix faible est remontée à un niveau normal : Whisper entend mal ce qui est trop bas
    let peak = 0;
    for (const v of audio) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.01 && peak < 0.5) {
      const gain = 0.7 / peak;
      for (let i = 0; i < audio.length; i++) audio[i] *= gain;
    }
    const id = crypto.randomUUID();
    const from = this.langOf(p);
    const joinTo = this.open.get(p.identity);
    if (cont) this.open.set(p.identity, id);
    else this.open.delete(p.identity);
    this.lines.push({ id, identity: p.identity, name: p.name || p.identity, at: Date.now(), text: "", from, pending: true, cont, joinTo });
    if (this.lines.length > 300) this.lines.splice(0, this.lines.length - 300);
    this.emit();
    this.worker.postMessage({ type: "transcribe", id, audio, lang: from, at: Date.now() }, [audio.buffer]);
  }

  /** Affiche le texte d'une ligne, en le faisant traduire s'il le faut. */
  private setText(line: Line, text: string) {
    if (this.translateTo && line.from && line.from !== this.translateTo) {
      line.original = text;
      line.text ||= text; // en attendant : la langue d'origine, ou la traduction du début de la phrase
      line.pending = true;
      line.rev = (line.rev ?? 0) + 1;
      this.worker.postMessage({ type: "translate", id: `${line.id}|${line.rev}`, text, from: line.from, to: this.translateTo });
    } else {
      line.original = undefined;
      line.text = text;
      line.pending = false;
    }
  }

  private drop(id: string) {
    this.lines = this.lines.filter((l) => l.id !== id);
  }

  private onWorker(m: { type: string; id?: string; text?: string; progress?: number; status?: string; message?: string; what?: string }) {
    if (m.type === "progress" && m.what === "asr" && m.status === "progress") {
      this.status = { ...this.status, state: "loading", progress: Math.round(m.progress ?? 0) };
      this.emit();
    } else if (m.type === "progress" && m.what === "translate" && m.status === "progress") {
      this.status = { ...this.status, translation: Math.round(m.progress ?? 0) };
      this.emit();
    } else if (m.type === "ready" && m.what === "translate") {
      this.status = { ...this.status, translation: undefined };
      this.emit();
    } else if (m.type === "ready") {
      this.status = { ...this.status, state: "ready", progress: 100 };
      this.emit();
    } else if (m.type === "error" && !m.id) {
      this.status = { state: "error", progress: 0, message: m.message };
      this.emit();
    } else if (m.type === "text" && m.id) {
      const line = this.lines.find((l) => l.id === m.id);
      if (!line) return;
      const text = cleanTranscript(m.text ?? "");
      // Suite d'une phrase coupée en route : on la recolle à la ligne d'avant
      const prevId = line.joinTo && (this.merged.get(line.joinTo) ?? line.joinTo);
      const prev = prevId ? this.lines.find((l) => l.id === prevId) : undefined;
      const prevText = prev && (prev.original ?? prev.text);
      if (!text) {
        this.drop(line.id);
        if (prev && line.cont) this.merged.set(line.id, prev.id); // la suite ira à la ligne d'avant
      } else if (prev && prevText && prevText.length + text.length <= JOIN_MAX) {
        this.drop(line.id);
        this.merged.set(line.id, prev.id);
        prev.at = line.at;
        this.setText(prev, joinTranscripts(prevText, text));
      } else {
        this.setText(line, text);
      }
      this.emit();
    } else if (m.type === "translated" && m.id) {
      const [id, rev] = m.id.split("|");
      const line = this.lines.find((l) => l.id === id);
      if (!line || String(line.rev) !== rev) return; // la phrase s'est allongée entre-temps
      line.text = m.text || line.original || line.text;
      line.pending = false;
      this.emit();
    } else if (m.type === "error" && m.id) {
      const [id, rev] = m.id.split("|");
      const line = this.lines.find((l) => l.id === id);
      if (!line) return;
      if (rev === undefined) {
        this.drop(id);
      } else if (String(line.rev) === rev) {
        // traduction impossible : on garde la phrase d'origine
        line.text = line.original ?? line.text;
        line.original = undefined;
        line.pending = false;
      }
      this.emit();
    }
  }

  /** Texte brut de la transcription (pour l'enregistrer). */
  export() {
    return this.lines
      .filter((l) => !l.pending)
      .map((l) => `[${new Date(l.at).toLocaleTimeString()}] ${l.name} : ${l.text}${l.original && l.original !== l.text ? `  (« ${l.original} »)` : ""}`)
      .join("\n");
  }
}
