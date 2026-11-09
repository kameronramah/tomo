/**
 * Sous-titres en direct (+ traduction), calculés sur le PC.
 *
 * Pour chaque voix reçue : on écoute à 16 kHz, on découpe en phrases (silence de 0,7 s ou
 * 10 s maximum), puis le fil de calcul (captions.worker.ts) transcrit avec Whisper dans la
 * langue de la personne (attribut LiveKit `lang`, sa langue de tomo). Si elle parle une autre
 * langue que moi, la phrase est traduite (français ⇄ anglais).
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
};

export type CaptionsStatus = { state: "off" | "loading" | "ready" | "error"; progress: number; message?: string };

const SAMPLE_RATE = 16000;
const SILENCE_MS = 700;
const MAX_MS = 10_000;
const MIN_MS = 400;
const THRESHOLD = 0.012;

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
  }

  private async listen(p: RemoteParticipant, track: RemoteAudioTrack) {
    this.stop(p.identity);
    await this.moduleReady;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const node = new AudioWorkletNode(this.ctx, "tomo-grab");
    src.connect(node);
    let chunks: Float32Array[] = [];
    let length = 0;
    let silentFor = 0;
    let voiced = false;
    const flush = () => {
      if (voiced && length >= (SAMPLE_RATE * MIN_MS) / 1000) {
        const audio = new Float32Array(length);
        let o = 0;
        for (const c of chunks) (audio.set(c, o), (o += c.length));
        this.submit(p, audio);
      }
      chunks = [];
      length = 0;
      silentFor = 0;
      voiced = false;
    };
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data;
      let sum = 0;
      for (const v of frame) sum += v * v;
      const loud = Math.sqrt(sum / frame.length) > THRESHOLD;
      if (!voiced && !loud) return; // on attend que la personne parle
      voiced ||= loud;
      chunks.push(frame);
      length += frame.length;
      silentFor = loud ? 0 : silentFor + (frame.length / SAMPLE_RATE) * 1000;
      if (silentFor >= SILENCE_MS || (length / SAMPLE_RATE) * 1000 >= MAX_MS) flush();
    };
    this.grabs.set(p.identity, () => {
      node.port.onmessage = null;
      src.disconnect();
      node.disconnect();
    });
  }

  private submit(p: RemoteParticipant, audio: Float32Array) {
    const id = crypto.randomUUID();
    const from = p.attributes?.lang === "en" ? "en" : p.attributes?.lang === "fr" ? "fr" : myLang;
    this.lines.push({ id, identity: p.identity, name: p.name || p.identity, at: Date.now(), text: "", from, pending: true });
    if (this.lines.length > 300) this.lines.splice(0, this.lines.length - 300);
    this.emit();
    this.worker.postMessage({ type: "transcribe", id, audio, lang: from }, [audio.buffer]);
  }

  private onWorker(m: { type: string; id?: string; text?: string; progress?: number; status?: string; message?: string; what?: string }) {
    if (m.type === "progress" && m.what === "asr" && m.status === "progress") {
      this.status = { state: "loading", progress: Math.round(m.progress ?? 0) };
      this.emit();
    } else if (m.type === "ready") {
      this.status = { state: "ready", progress: 100 };
      this.emit();
    } else if (m.type === "error" && !m.id) {
      this.status = { state: "error", progress: 0, message: m.message };
      this.emit();
    } else if (m.type === "text" && m.id) {
      const line = this.lines.find((l) => l.id === m.id);
      if (!line) return;
      const text = (m.text ?? "").replace(/^\s*[[(].*[\])]\s*$/, "").trim(); // « [Musique] », « (rires) »…
      if (!text) {
        this.lines = this.lines.filter((l) => l.id !== m.id);
      } else if (this.translateTo && line.from && line.from !== this.translateTo) {
        line.original = text;
        line.text = text;
        this.worker.postMessage({ type: "translate", id: line.id, text, from: line.from, to: this.translateTo });
      } else {
        line.text = text;
        line.pending = false;
      }
      this.emit();
    } else if (m.type === "translated" && m.id) {
      const line = this.lines.find((l) => l.id === m.id);
      if (!line) return;
      line.text = m.text || line.text;
      line.pending = false;
      this.emit();
    } else if (m.type === "error" && m.id) {
      this.lines = this.lines.filter((l) => l.id !== m.id);
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
