/// <reference lib="webworker" />
/**
 * Calcul des sous-titres et des traductions, dans un fil séparé (l'interface ne rame pas).
 * Modèles ouverts téléchargés une fois depuis Hugging Face puis gardés en cache :
 *  - Whisper (OpenAI, libre) pour la reconnaissance vocale ;
 *  - Opus-MT (université d'Helsinki, libre) pour la traduction français ⇄ anglais.
 * Tout tourne sur le PC (WebGPU si la carte graphique le permet, sinon le processeur).
 * Les demandes sont traitées une par une, dans l'ordre : deux calculs en même temps sur le
 * même modèle se marchent dessus.
 */
import { pipeline as rawPipeline, env, type AutomaticSpeechRecognitionPipeline, type TranslationPipeline } from "@huggingface/transformers";

// Signature simplifiée (le typage complet de la bibliothèque est trop lourd pour TypeScript).
const pipeline = rawPipeline as unknown as (task: string, model: string, options: object) => Promise<unknown>;

env.allowLocalModels = false;
// Pas d'avertissements techniques d'onnxruntime dans la console
if (env.backends.onnx) (env.backends.onnx as { logLevel?: string }).logLevel = "error";

type In =
  | { type: "load"; model: string }
  | { type: "preload"; from: string; to: string }
  | { type: "transcribe"; id: string; audio: Float32Array; lang: string; at?: number }
  | { type: "translate"; id: string; text: string; from: string; to: string };

/** Une phrase qui a attendu plus longtemps que ça n'est plus « en direct » : on la saute pour rattraper le retard. */
const STALE_MS = 25_000;

const BASE = "onnx-community/whisper-base";
const SMALL = "onnx-community/whisper-small";

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let asrModel = "";
const translators = new Map<string, Promise<TranslationPipeline>>();
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function device(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return gpu && (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function createAsr(model: string, dev: "webgpu" | "wasm") {
  // « auto » : le modèle précis si la carte graphique peut le faire tourner, sinon l'équilibré
  const name = model === "auto" ? (dev === "webgpu" ? SMALL : BASE) : model;
  // L'encodeur (l'« oreille ») supporte mal d'être compressé : on le garde en pleine précision
  // sur la carte graphique (demi-précision pour le très gros modèle, sinon 2,4 Go).
  const dtype = dev === "webgpu" ? { encoder_model: name.includes("large") ? "fp16" : "fp32", decoder_model_merged: "q4" } : "q8";
  return pipeline("automatic-speech-recognition", name, {
    device: dev,
    dtype,
    progress_callback: (p: { status: string; progress?: number; file?: string }) => post({ type: "progress", what: "asr", ...p }),
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
}

function loadAsr(model: string) {
  if (asr && asrModel === model) return asr;
  asrModel = model;
  asr = device().then((dev) =>
    createAsr(model, dev).catch((e) => {
      // La carte graphique n'a pas suivi (mémoire, pilote…) : on retombe sur le processeur
      if (dev !== "webgpu") throw e;
      return createAsr(model, "wasm");
    }),
  );
  asr.catch((e) => {
    if (asrModel === model) (asr = null), (asrModel = "");
    post({ type: "error", message: String(e) });
  });
  return asr;
}

function loadTranslator(from: string, to: string) {
  const key = `${from}-${to}`;
  let p = translators.get(key);
  if (!p) {
    // Version compressée (q8, ≈ 100 Mo) : comparée à la pleine précision (≈ 400 Mo) sur des phrases
    // de jeu, elle donne les mêmes traductions.
    p = pipeline("translation", `Xenova/opus-mt-${from}-${to}`, {
      dtype: "q8",
      progress_callback: (x: { status: string; progress?: number }) => post({ type: "progress", what: "translate", ...x }),
    }) as Promise<TranslationPipeline>;
    p.then(() => post({ type: "ready", what: "translate" })).catch(() => translators.delete(key));
    translators.set(key, p);
  }
  return p;
}

const LANG_NAME: Record<string, string> = { fr: "french", en: "english" };

async function handle(m: In) {
  try {
    if (m.type === "load") {
      await loadAsr(m.model);
      post({ type: "ready", what: "asr" });
    } else if (m.type === "preload") {
      await loadTranslator(m.from, m.to);
    } else if (m.type === "transcribe") {
      if (m.at && Date.now() - m.at > STALE_MS) return post({ type: "error", id: m.id, message: "stale" });
      const run = await (asr ?? loadAsr("auto"));
      // Phrases de 15 s au plus : pas de découpage, et une limite de longueur qui coupe court
      // aux boucles (« merci merci merci… ») quand le modèle déraille sur du bruit.
      const out = (await run(m.audio, { language: LANG_NAME[m.lang] ?? null, task: "transcribe", max_new_tokens: 200 })) as { text: string };
      post({ type: "text", id: m.id, text: out.text.trim() });
    } else if (m.type === "translate") {
      const tr = await loadTranslator(m.from, m.to);
      const out = (await tr(m.text, { max_new_tokens: 256 } as never)) as { translation_text: string }[];
      post({ type: "translated", id: m.id, text: out[0]?.translation_text ?? "" });
    }
  } catch (err) {
    post({ type: "error", id: "id" in m ? m.id : undefined, message: String(err) });
  }
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<In>) => {
  queue = queue.then(() => handle(e.data));
};
