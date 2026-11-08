/**
 * Clip « après coup » : garde en mémoire les 60 dernières secondes du salon
 * (toutes les voix + ton micro), et les enregistre en .wav sur demande.
 * Rien ne quitte ton PC : le tampon est en mémoire, le fichier va dans Musique\tomo Clips.
 */
import { invoke } from "@tauri-apps/api/core";
import { Room, RoomEvent, Track, type LocalTrackPublication, type RemoteTrack } from "livekit-client";
import { getSettings } from "./prefs";

/** Durée gardée en mémoire (réglable : Paramètres > Clips). */
export const clipSeconds = () => getSettings().clips.seconds;
export const CLIP_CHOICES = [30, 60, 120] as const;
const SAMPLE_RATE = 48000;
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Processeur audio : additionne les entrées et envoie des blocs de 4096 échantillons.
const WORKLET = `
class TomoTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const input = inputs[0];
    const a = input && input[0];
    if (a) {
      const b = input[1];
      for (let i = 0; i < a.length; i++) {
        this.buf[this.n++] = b ? (a[i] + b[i]) * 0.5 : a[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(4096); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("tomo-tap", TomoTap);
`;

export class ClipRecorder {
  private ctx: AudioContext;
  private mix: GainNode;
  private ring = new Float32Array(clipSeconds() * SAMPLE_RATE);
  private write = 0;
  private filled = 0;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private node: AudioWorkletNode | null = null;
  private offs: (() => void)[] = [];

  constructor(private room: Room) {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.mix = this.ctx.createGain();
  }

  async start() {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, "tomo-tap", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 });
    this.node.port.onmessage = (e) => this.push(e.data as Float32Array);
    this.mix.connect(this.node);
    await this.ctx.resume().catch(() => {});

    // Pistes déjà présentes
    this.room.remoteParticipants.forEach((p) =>
      p.audioTrackPublications.forEach((pub) => pub.track && this.add(pub.trackSid, pub.track.mediaStreamTrack)),
    );
    this.room.localParticipant.audioTrackPublications.forEach((pub) => pub.track && this.add(pub.trackSid, pub.track.mediaStreamTrack));

    // Pistes qui arrivent / partent
    const onSub = (track: RemoteTrack) => track.kind === Track.Kind.Audio && track.sid && this.add(track.sid, track.mediaStreamTrack);
    const onUnsub = (track: RemoteTrack) => track.sid && this.remove(track.sid);
    const onLocal = (pub: LocalTrackPublication) => pub.kind === Track.Kind.Audio && pub.track && this.add(pub.trackSid, pub.track.mediaStreamTrack);
    const onLocalOff = (pub: LocalTrackPublication) => this.remove(pub.trackSid);
    this.room
      .on(RoomEvent.TrackSubscribed, onSub)
      .on(RoomEvent.TrackUnsubscribed, onUnsub)
      .on(RoomEvent.LocalTrackPublished, onLocal)
      .on(RoomEvent.LocalTrackUnpublished, onLocalOff);
    this.offs.push(() =>
      this.room
        .off(RoomEvent.TrackSubscribed, onSub)
        .off(RoomEvent.TrackUnsubscribed, onUnsub)
        .off(RoomEvent.LocalTrackPublished, onLocal)
        .off(RoomEvent.LocalTrackUnpublished, onLocalOff),
    );
  }

  private add(id: string, track: MediaStreamTrack) {
    if (this.sources.has(id)) return;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    src.connect(this.mix);
    this.sources.set(id, src);
  }

  private remove(id: string) {
    this.sources.get(id)?.disconnect();
    this.sources.delete(id);
  }

  private push(block: Float32Array) {
    const n = this.ring.length;
    for (let i = 0; i < block.length; i++) {
      this.ring[this.write] = block[i];
      this.write = (this.write + 1) % n;
    }
    this.filled = Math.min(n, this.filled + block.length);
  }

  /** Secondes réellement disponibles (moins de 60 s si on vient d'arriver). */
  get seconds() {
    return this.filled / SAMPLE_RATE;
  }

  /** Les dernières secondes, dans l'ordre chronologique. */
  snapshot(): Float32Array {
    const n = this.ring.length;
    const out = new Float32Array(this.filled);
    const start = (this.write - this.filled + n) % n;
    for (let i = 0; i < this.filled; i++) out[i] = this.ring[(start + i) % n];
    return out;
  }

  async stop() {
    this.offs.forEach((f) => f());
    this.sources.forEach((s) => s.disconnect());
    this.sources.clear();
    this.node?.disconnect();
    await this.ctx.close().catch(() => {});
  }
}

/** PCM float → fichier WAV 16 bits mono (léger : ~5,8 Mo pour 60 s). */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  // Normalisation douce : on remonte le niveau si le clip est très bas, sans saturer.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 && peak < 0.5 ? Math.min(4, 0.9 / peak) : 1;

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function clipFileName(label: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const safe = label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 40) || "salon";
  return `tomo ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())} - ${safe}.wav`;
}

// ---------------------------------------------------------------------------
// Fichiers de clips (appli de bureau : dossier Musique\tomo Clips)
// ---------------------------------------------------------------------------
export type ClipFile = { name: string; size: number; modified: number };

/** Enregistre le clip. Renvoie le chemin du fichier (bureau) ou null (navigateur : téléchargement). */
export async function saveClip(name: string, wav: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (inTauri) return invoke<string>("save_clip", wav, { headers: { "x-clip-name": name } });
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

export const clipsSupported = inTauri;
export const listClips = () => (inTauri ? invoke<ClipFile[]>("list_clips") : Promise.resolve([]));
export const deleteClip = (name: string) => invoke("delete_clip", { name });
export const openClipsFolder = () => invoke("open_clips_folder");
/** Fichier d'un clip (pour l'envoyer au mur des légendes) + sa durée lue dans l'en-tête WAV. */
export async function clipBlob(name: string): Promise<{ blob: Blob; durationMs: number }> {
  const bytes = await invoke<ArrayBuffer>("read_clip", { name });
  const view = new DataView(bytes);
  const byteRate = bytes.byteLength > 44 ? view.getUint32(28, true) : 0;
  const durationMs = byteRate ? Math.round(((bytes.byteLength - 44) / byteRate) * 1000) : 0;
  return { blob: new Blob([bytes], { type: "audio/wav" }), durationMs };
}

export async function clipUrl(name: string): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("read_clip", { name });
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
