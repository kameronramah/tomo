/**
 * Enregistrement d'un message vocal (micro → WebM/Opus, ~32 kb/s : 1 min ≈ 250 Ko).
 * Pendant l'enregistrement on mesure le niveau pour animer l'onde, et on garde un résumé
 * (48 niveaux de 0 à 9) que les autres verront sous forme d'onde.
 */
import { getSettings, loadDevices } from "./prefs";

export const MAX_VOICE_MS = 2 * 60 * 1000;
const BARS = 48;

export type VoiceNote = { blob: Blob; durationMs: number; waveform: string };

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private samples: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private done: ((n: VoiceNote | null) => void) | null = null;
  /** Appelé ~20 fois par seconde avec le niveau (0-1) et la durée écoulée. */
  onLevel: ((level: number, elapsedMs: number) => void) | null = null;
  /** Appelé si l'enregistrement s'arrête tout seul (durée maximale atteinte). */
  onAutoStop: (() => void) | null = null;

  async start() {
    const audio = getSettings().audio;
    const device = loadDevices().input;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(device ? { deviceId: { ideal: device } } : {}),
        echoCancellation: audio.echoCancellation,
        noiseSuppression: audio.denoise !== "off",
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    this.recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 32000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => this.finish();
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.timer = setInterval(() => this.measure(), 50);
  }

  private measure() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const db = 10 * Math.log10(sum / this.buf.length + 1e-12);
    const level = Math.min(1, Math.max(0, (db + 60) / 50)); // -60 dB → 0, -10 dB → 1
    this.samples.push(level);
    const elapsed = performance.now() - this.startedAt;
    this.onLevel?.(level, elapsed);
    if (elapsed >= MAX_VOICE_MS) {
      this.onAutoStop?.();
    }
  }

  private waveform(): string {
    const s = this.samples;
    if (s.length === 0) return "0".repeat(BARS);
    let out = "";
    for (let i = 0; i < BARS; i++) {
      const from = Math.floor((i * s.length) / BARS);
      const to = Math.max(from + 1, Math.floor(((i + 1) * s.length) / BARS));
      const peak = Math.max(...s.slice(from, to));
      out += String(Math.min(9, Math.round(peak * 9)));
    }
    return out;
  }

  private finish() {
    const durationMs = performance.now() - this.startedAt;
    const note: VoiceNote = { blob: new Blob(this.chunks, { type: "audio/webm" }), durationMs, waveform: this.waveform() };
    this.cleanup();
    this.done?.(note.blob.size > 0 && durationMs > 400 ? note : null);
    this.done = null;
  }

  /** Arrête et renvoie le message vocal (ou null s'il est trop court). */
  stop(): Promise<VoiceNote | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") return resolve(null);
      this.done = resolve;
      this.recorder.stop();
    });
  }

  /** Abandonne l'enregistrement. */
  cancel() {
    this.done = null;
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
