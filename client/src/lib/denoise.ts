/**
 * Suppression de bruit avancée (RNNoise, un petit réseau de neurones qui tourne sur le PC)
 * et porte de bruit (le micro se coupe tout seul sous un certain niveau).
 *
 * Branché sur la piste micro LiveKit avec `setProcessor` : ce qui part vers les autres est
 * le son nettoyé. Tout est calculé localement, rien n'est envoyé ailleurs.
 */
import { NoiseGateWorkletNode, RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorklet from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import noiseGateWorklet from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import rnnoiseWasm from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasm from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { Track, type AudioProcessorOptions, type LocalAudioTrack, type Room, type TrackProcessor } from "livekit-client";
import { getSettings, onSettingsChange, type Settings } from "./prefs";

export type DenoiseMode = "off" | "light" | "advanced";

let wasm: Promise<ArrayBuffer> | null = null;
const loadedIn = new WeakSet<BaseAudioContext>();

async function prepare(ctx: AudioContext) {
  wasm ??= loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm });
  if (!loadedIn.has(ctx)) {
    await ctx.audioWorklet.addModule(rnnoiseWorklet);
    await ctx.audioWorklet.addModule(noiseGateWorklet);
    loadedIn.add(ctx);
  }
  return wasm;
}

/** Force un nœud à recevoir un seul canal (le stéréo est mélangé, pas coupé). */
function mono(node: AudioNode) {
  node.channelCount = 1;
  node.channelCountMode = "explicit";
  node.channelInterpretation = "speakers";
}

export type Chain = { input: AudioNode; output: AudioNode; dispose: () => void };

/** Construit la chaîne de traitement (RNNoise puis porte de bruit) dans un contexte audio. */
export async function buildChain(ctx: AudioContext, audio: Settings["audio"]): Promise<Chain> {
  const binary = await prepare(ctx);
  // Le micro arrive parfois en stéréo (selon le micro / Windows). RNNoise et la porte ne traitent
  // que le 1er canal (maxChannels: 1) et laissaient le 2e muet → voix dans l'oreille gauche seulement.
  // On mélange donc tout en mono dès l'entrée ; le mono est ensuite joué des deux côtés.
  const input = new GainNode(ctx, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
  let last: AudioNode = input;
  const nodes: AudioNode[] = [input];
  let rn: RnnoiseWorkletNode | null = null;
  if (audio.denoise === "advanced") {
    rn = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
    mono(rn);
    last.connect(rn);
    last = rn;
    nodes.push(rn);
  }
  if (audio.gate) {
    const gate = new NoiseGateWorkletNode(ctx, { openThreshold: audio.gateThreshold, closeThreshold: audio.gateThreshold - 6, holdMs: 250, maxChannels: 1 });
    mono(gate);
    last.connect(gate);
    last = gate;
    nodes.push(gate);
  }
  return {
    input,
    output: last,
    dispose: () => {
      rn?.destroy();
      nodes.forEach((n) => n.disconnect());
    },
  };
}

/** Faut-il un traitement maison (sinon la piste part telle quelle) ? */
export const needsProcessing = (a: Settings["audio"]) => a.denoise === "advanced" || a.gate;

/** Processeur LiveKit : micro → chaîne → piste envoyée. */
class TomoMicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "tomo-denoise";
  processedTrack?: MediaStreamTrack;
  private ctx: AudioContext | null = null;
  private chain: Chain | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async init(opts: AudioProcessorOptions) {
    // RNNoise attend du 48 kHz : on prend notre propre contexte à cette fréquence.
    this.ctx = new AudioContext({ sampleRate: 48000 });
    await this.ctx.resume().catch(() => {});
    this.chain = await buildChain(this.ctx, getSettings().audio);
    this.source = this.ctx.createMediaStreamSource(new MediaStream([opts.track]));
    const dest = this.ctx.createMediaStreamDestination();
    this.source.connect(this.chain.input);
    this.chain.output.connect(dest);
    this.processedTrack = dest.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.source?.disconnect();
    this.chain?.dispose();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chain = null;
    this.source = null;
  }
}

function micTrack(room: Room) {
  return room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
}

/** Applique (ou retire) le traitement sur le micro publié. */
export async function applyMicProcessing(room: Room) {
  const track = micTrack(room);
  if (!track) return;
  const audio = getSettings().audio;
  try {
    if (needsProcessing(audio)) await track.setProcessor(new TomoMicProcessor());
    else if (track.getProcessor()) await track.stopProcessor();
  } catch (e) {
    console.warn("Suppression de bruit indisponible", e);
  }
}

/** Suit les réglages pendant un vocal : le changement s'applique tout de suite. */
export function watchMicProcessing(room: Room) {
  let prev = JSON.stringify(pick(getSettings().audio));
  return onSettingsChange((s) => {
    const next = JSON.stringify(pick(s.audio));
    if (next === prev) return;
    prev = next;
    void applyMicProcessing(room);
  });
}

const pick = (a: Settings["audio"]) => ({ d: a.denoise, g: a.gate, t: a.gateThreshold });
