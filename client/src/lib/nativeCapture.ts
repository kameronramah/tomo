/**
 * Capture d'écran maison (appli Windows) — voir src-tauri/src/capture.rs.
 *
 * Sert à remplacer la fenêtre « Choisir les éléments à partager » de Windows par le sélecteur de
 * Tomo : Rust capture l'écran ou la fenêtre choisie et recopie chaque image dans une mémoire
 * partagée avec la page ; ici on en fait une piste vidéo ordinaire (`MediaStreamTrack`), que
 * LiveKit envoie comme un partage d'écran classique.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const HEADER = 64;

type WebviewHost = {
  addEventListener: (type: "sharedbufferreceived", cb: (e: { getBuffer: () => ArrayBuffer }) => void) => void;
};
const host = (window as unknown as { chrome?: { webview?: WebviewHost } }).chrome?.webview;
const inTauri = "__TAURI_INTERNALS__" in window;

let shared: ArrayBuffer | null = null;
host?.addEventListener("sharedbufferreceived", (e) => {
  shared = e.getBuffer();
});

/** Seulement dans l'appli Windows (WebView2). Ailleurs : fenêtre de partage du système. */
export const nativeCaptureAvailable = () => inTauri && !!host && "MediaStreamTrackGenerator" in window;

export type CaptureSource = {
  id: string;
  kind: "screen" | "window";
  title: string;
  /** Nom du programme (« chrome.exe ») */
  program: string;
  /** Numéro de l'écran (à partir de 1) */
  index: number;
  width: number;
  height: number;
  primary: boolean;
  thumb: string | null;
};

export const listCaptureSources = () => invoke<CaptureSource[]>("capture_sources");

export type NativeCapture = {
  track: MediaStreamTrack;
  /** Images transformées en piste, et temps moyen passé par image côté page (ms). */
  counters: () => { frames: number; avgMs: number };
  stop: () => Promise<unknown>;
};

let active: NativeCapture | null = null;

/** Arrête la capture en cours (sans effet s'il n'y en a pas). */
export async function stopNativeCapture() {
  const cap = active;
  active = null;
  await cap?.stop().catch(() => {});
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function startNativeCapture(opts: {
  source: string;
  fps: number;
  /** Taille maximale envoyée : au-delà, l'image est réduite (ex. écran 4K partagé en 1080p). */
  maxWidth: number;
  maxHeight: number;
  /** La fenêtre partagée a été fermée. */
  onClosed?: () => void;
}): Promise<NativeCapture> {
  await stopNativeCapture();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generator = new (window as any).MediaStreamTrackGenerator({ kind: "video" });
  const writer: WritableStreamDefaultWriter<VideoFrame> = generator.writable.getWriter();
  let frames = 0;
  let spent = 0;
  let last: VideoFrame | null = null;
  let lastAt = 0;
  let scaler: OffscreenCanvas | null = null;
  let first: (() => void) | null = null;
  const gotFirst = new Promise<void>((resolve) => (first = resolve));

  const push = (frame: VideoFrame) => {
    last?.close();
    last = frame.clone();
    lastAt = performance.now();
    writer.write(frame).catch(() => frame.close());
  };

  const unlistenFrame = await listen("capture:frame", () => {
    if (!shared) return;
    const t0 = performance.now();
    const hdr = new Int32Array(shared, 0, 16);
    const seq = hdr[0];
    if (seq === hdr[1]) return; // déjà lue
    const w = hdr[2];
    const h = hdr[3];
    const timestamp = Math.round(t0 * 1000);
    // Le constructeur recopie les pixels : après ça, Rust peut écrire l'image suivante.
    let frame = new VideoFrame(new Uint8Array(shared, HEADER, w * h * 4), {
      format: "BGRA",
      codedWidth: w,
      codedHeight: h,
      timestamp,
    });
    hdr[1] = seq;

    const scale = Math.min(1, opts.maxWidth / w, opts.maxHeight / h);
    if (scale < 1) {
      const tw = even(w * scale);
      const th = even(h * scale);
      if (!scaler || scaler.width !== tw || scaler.height !== th) scaler = new OffscreenCanvas(tw, th);
      scaler.getContext("2d")!.drawImage(frame, 0, 0, tw, th);
      frame.close();
      frame = new VideoFrame(scaler, { timestamp });
    }
    push(frame);
    frames += 1;
    spent += performance.now() - t0;
    first?.();
  });
  const unlistenClosed = await listen("capture:closed", () => opts.onClosed?.());

  // Windows ne donne une image que quand l'écran change : sur un écran immobile, on renvoie la
  // dernière de temps en temps, sinon quelqu'un qui arrive verrait du noir.
  const keepAlive = window.setInterval(() => {
    if (last && performance.now() - lastAt > 400) {
      push(new VideoFrame(last, { timestamp: Math.round(performance.now() * 1000) }));
    }
  }, 250);

  const cleanup = () => {
    unlistenFrame();
    unlistenClosed();
    window.clearInterval(keepAlive);
    last?.close();
    last = null;
  };

  try {
    await invoke("capture_start", { source: opts.source, fps: opts.fps });
    await Promise.race([
      gotFirst,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("capture: aucune image reçue")), 4000)),
    ]);
  } catch (err) {
    cleanup();
    await invoke("capture_stop").catch(() => {});
    generator.stop();
    throw err;
  }

  const cap: NativeCapture = {
    track: generator as MediaStreamTrack,
    counters: () => ({ frames, avgMs: frames ? spent / frames : 0 }),
    stop: async () => {
      if (active === cap) active = null;
      cleanup();
      const stats = await invoke("capture_stop");
      generator.stop();
      return stats;
    },
  };
  active = cap;
  return cap;
}
