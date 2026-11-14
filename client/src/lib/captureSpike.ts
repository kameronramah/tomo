/**
 * Banc d'essai de la capture maison (dev seulement, voir nativeCapture.ts).
 *
 * Déclenché en déposant un fichier `%TEMP%\tomo-capture-spike.go` contenant par exemple
 * `{"fps":60,"bitrate":8000000,"scale":1,"seconds":12}` ; le résultat est écrit dans
 * `%TEMP%\tomo-capture-spike.json`.
 *
 * Il mesure la chaîne complète sans compte ni salon : capture → piste vidéo → encodage H.264
 * (comme un vrai partage) → décodage, entre deux connexions WebRTC locales.
 */
import { invoke } from "@tauri-apps/api/core";
import { listCaptureSources, startNativeCapture } from "./nativeCapture";

type Config = { warmup?: number; keepRes?: boolean; source?: "canvas"; sourceId?: string; maxWidth?: number; maxHeight?: number; action?: "sources"; fps?: number; bitrate?: number; scale?: number; seconds?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cpu = () => invoke<number>("capture_cpu_ms");

/** Quelque chose qui bouge à l'écran : Windows ne donne des images que quand l'écran change. */
function animation() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999;pointer-events:none";
  canvas.width = 1280;
  canvas.height = 720;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  let on = true;
  let painted = 0;
  const draw = (t: number) => {
    if (!on) return;
    painted += 1;
    ctx.fillStyle = "#0E0D10";
    ctx.fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i % 2 ? "#2DD4BF" : "#FFB020";
      const x = ((t * (0.2 + i * 0.03) + i * 90) % 1400) - 60;
      ctx.fillRect(x, i * 30, 60, 22);
    }
    ctx.fillStyle = "#F4F0EA";
    ctx.font = "28px sans-serif";
    ctx.fillText("Essai de capture en cours…", 40, 700);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return { painted: () => painted, stop: () => { on = false; canvas.remove(); } };
}

/** Repère : une image 1080p fabriquée dans la page (sans capture), pour isoler le coût de l'encodage. */
function canvasSource(fps: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  let frames = 0;
  let on = true;
  const draw = (t: number) => {
    if (!on) return;
    frames += 1;
    ctx.fillStyle = "#0E0D10";
    ctx.fillRect(0, 0, 1920, 1080);
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i % 2 ? "#2DD4BF" : "#FFB020";
      ctx.fillRect(((t * (0.3 + i * 0.045) + i * 135) % 2100) - 90, i * 45, 90, 33);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  const track = canvas.captureStream(fps).getVideoTracks()[0];
  return { track, counters: () => ({ frames, avgMs: 0 }), stop: async () => { on = false; track.stop(); return null; } };
}

async function loopback(track: MediaStreamTrack, cfg: { fps: number; bitrate: number; scale: number }, keepRes: boolean) {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const video = document.createElement("video");
  video.muted = true;
  b.ontrack = (e) => {
    video.srcObject = new MediaStream([e.track]);
    void video.play().catch(() => {});
  };
  track.contentHint = "motion";
  const tr = a.addTransceiver(track, {
    direction: "sendonly",
    sendEncodings: [{ maxBitrate: cfg.bitrate, maxFramerate: cfg.fps, scaleResolutionDownBy: cfg.scale }],
  });
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const h264 = codecs.filter((c) => c.mimeType === "video/H264");
  if (keepRes) {
    const p = tr.sender.getParameters();
    p.degradationPreference = "maintain-resolution";
    await tr.sender.setParameters(p);
  }
  tr.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== "video/H264")]);
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription!);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription!);

  const read = async () => {
    const out: Record<string, unknown> = {};
    (await a.getStats()).forEach((s) => {
      if (s.type === "outbound-rtp") Object.assign(out, {
        framesEncoded: s.framesEncoded, encoder: s.encoderImplementation, hardware: s.powerEfficientEncoder,
        totalEncodeTime: s.totalEncodeTime, limit: s.qualityLimitationReason, width: s.frameWidth,
        height: s.frameHeight, bytesSent: s.bytesSent,
      });
    });
    (await b.getStats()).forEach((s) => {
      if (s.type === "inbound-rtp") Object.assign(out, { framesDecoded: s.framesDecoded, framesDropped: s.framesDropped });
    });
    return out as Record<string, number> & { encoder?: string; limit?: string; hardware?: boolean };
  };
  return { read, close: () => { a.close(); b.close(); } };
}

async function run(raw: Config) {
  const cfg = { fps: raw.fps ?? 60, bitrate: raw.bitrate ?? 8_000_000, scale: raw.scale ?? 1, seconds: raw.seconds ?? 12 };
  const anim = animation();
  try {
    // 1. Repère : l'appli avec l'animation seule, sans capture
    await sleep(1500);
    const c0 = await cpu();
    const p0 = anim.painted();
    await sleep(6000);
    const idleCpu = ((await cpu()) - c0) / 6000;
    const screenFps = (anim.painted() - p0) / 6;

    // 2. Capture maison + encodage
    const cap = raw.source === "canvas" ? canvasSource(cfg.fps) : await startNativeCapture({ source: raw.sourceId ?? (await listCaptureSources()).find((s) => s.kind === "screen" && s.primary)!.id, fps: cfg.fps, maxWidth: raw.maxWidth ?? 9999, maxHeight: raw.maxHeight ?? 9999 });
    const link = await loopback(cap.track, cfg, !!raw.keepRes);
    await sleep(raw.warmup ?? 4000); // le débit monte
    const s0 = await link.read();
    const n0 = cap.counters().frames;
    const r0 = await invoke<{ captured: number; sent: number }>("capture_stats");
    const c1 = await cpu();
    const t0 = performance.now();
    await sleep(cfg.seconds * 1000);
    const secs = (performance.now() - t0) / 1000;
    const s1 = await link.read();
    const r1 = await invoke<{ captured: number; sent: number }>("capture_stats");
    const busyCpu = ((await cpu()) - c1) / (secs * 1000);
    const pageFrames = cap.counters().frames - n0;
    const pageAvgMs = cap.counters().avgMs;
    link.close();
    const rust = await cap.stop();

    const encoded = s1.framesEncoded - s0.framesEncoded;
    return {
      config: cfg,
      cores: navigator.hardwareConcurrency,
      screenFps: +screenFps.toFixed(1),
      capturedFps: +((r1.captured - r0.captured) / secs).toFixed(1),
      sentFps: +((r1.sent - r0.sent) / secs).toFixed(1),
      pageFps: +(pageFrames / secs).toFixed(1),
      encodedFps: +(encoded / secs).toFixed(1),
      decodedFps: +((s1.framesDecoded - s0.framesDecoded) / secs).toFixed(1),
      encodeMsPerFrame: +(((s1.totalEncodeTime - s0.totalEncodeTime) / Math.max(1, encoded)) * 1000).toFixed(2),
      pageMsPerFrame: +pageAvgMs.toFixed(2),
      mbps: +(((s1.bytesSent - s0.bytesSent) * 8) / secs / 1e6).toFixed(2),
      encoder: s1.encoder, hardware: s1.hardware, limit: s1.limit,
      encodedSize: `${s1.width}x${s1.height}`,
      // en « cœurs occupés » (1 = un cœur à 100 %)
      cpuIdleCores: +idleCpu.toFixed(2),
      cpuCaptureCores: +busyCpu.toFixed(2),
      rust,
    };
  } finally {
    anim.stop();
  }
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  const text = await invoke<string | null>("capture_spike_poll").catch(() => null);
  if (text == null) return;
  busy = true;
  let report: unknown;
  try {
    const cfg: Config = text.trim() ? JSON.parse(text) : {};
    report = cfg.action === "sources"
      ? (await listCaptureSources()).map((s) => ({ ...s, thumb: s.thumb ? s.thumb.length : null }))
      : await run(cfg);
  } catch (e) {
    report = { error: String(e), stack: (e as Error)?.stack };
  }
  await invoke("capture_spike_report", { json: JSON.stringify(report, null, 2) }).catch(() => {});
  busy = false;
}, 2000);
