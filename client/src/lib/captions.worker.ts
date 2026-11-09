/// <reference lib="webworker" />
/**
 * Calcul des sous-titres et des traductions, dans un fil séparé (l'interface ne rame pas).
 * Modèles ouverts téléchargés une fois depuis Hugging Face puis gardés en cache :
 *  - Whisper (OpenAI, libre) pour la reconnaissance vocale ;
 *  - Opus-MT (université d'Helsinki, libre) pour la traduction français ⇄ anglais.
 * Tout tourne sur le PC (WebGPU si la carte graphique le permet, sinon le processeur).
 */
import { pipeline as rawPipeline, env, type AutomaticSpeechRecognitionPipeline, type TranslationPipeline } from "@huggingface/transformers";

// Signature simplifiée (le typage complet de la bibliothèque est trop lourd pour TypeScript).
const pipeline = rawPipeline as unknown as (task: string, model: string, options: object) => Promise<unknown>;

env.allowLocalModels = false;
// Pas d'avertissements techniques d'onnxruntime dans la console
if (env.backends.onnx) (env.backends.onnx as { logLevel?: string }).logLevel = "error";

type In =
  | { type: "load"; model: string }
  | { type: "transcribe"; id: string; audio: Float32Array; lang: string }
  | { type: "translate"; id: string; text: string; from: string; to: string };

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

function loadAsr(model: string) {
  if (asr && asrModel === model) return asr;
  asrModel = model;
  asr = device().then(
    (dev) =>
      pipeline("automatic-speech-recognition", model, {
        device: dev,
        dtype: dev === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        progress_callback: (p: { status: string; progress?: number; file?: string }) => post({ type: "progress", what: "asr", ...p }),
      }) as Promise<AutomaticSpeechRecognitionPipeline>,
  );
  asr.then(() => post({ type: "ready", what: "asr" })).catch((e) => post({ type: "error", message: String(e) }));
  return asr;
}

function loadTranslator(from: string, to: string) {
  const key = `${from}-${to}`;
  let p = translators.get(key);
  if (!p) {
    p = pipeline("translation", `Xenova/opus-mt-${from}-${to}`, {
      dtype: "q8",
      progress_callback: (x: { status: string; progress?: number }) => post({ type: "progress", what: "translate", ...x }),
    }) as Promise<TranslationPipeline>;
    translators.set(key, p);
  }
  return p;
}

const LANG_NAME: Record<string, string> = { fr: "french", en: "english" };

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      await loadAsr(m.model);
      post({ type: "ready", what: "asr" }); // aussi quand le modèle était déjà chargé
    } else if (m.type === "transcribe") {
      const run = await (asr ?? loadAsr("onnx-community/whisper-base"));
      const out = (await run(m.audio, { language: LANG_NAME[m.lang] ?? null, task: "transcribe", chunk_length_s: 30 })) as { text: string };
      post({ type: "text", id: m.id, text: out.text.trim() });
    } else if (m.type === "translate") {
      const tr = await loadTranslator(m.from, m.to);
      const out = (await tr(m.text)) as { translation_text: string }[];
      post({ type: "translated", id: m.id, text: out[0]?.translation_text ?? "" });
    }
  } catch (err) {
    post({ type: "error", id: "id" in m ? m.id : undefined, message: String(err) });
  }
};
