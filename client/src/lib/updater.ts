/**
 * Mise à jour automatique : tomo regarde la dernière version publiée sur GitHub
 * (fichier latest.json signé), la télécharge en arrière-plan et propose de redémarrer.
 * Pas de canal bêta : uniquement les versions publiées.
 */
import conf from "../../src-tauri/tauri.conf.json";
import { inTauri } from "./desktop";
import { getSettings } from "./prefs";

export const APP_VERSION: string = conf.version;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "ready"; version: string; notes: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
const listeners = new Set<(s: UpdateState) => void>();
const set = (s: UpdateState) => {
  state = s;
  listeners.forEach((l) => l(s));
};

export const getUpdateState = () => state;
export function onUpdateState(fn: (s: UpdateState) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

let running = false;
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

/** Cherche une mise à jour ; si elle existe, la télécharge et l'installe au prochain redémarrage. */
export async function checkForUpdate(manual = false) {
  if (!inTauri || running || state.kind === "ready") return;
  running = true;
  if (manual) set({ kind: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      set(manual ? { kind: "none" } : { kind: "idle" });
      return;
    }
    // Sans le réglage « automatique », on ne télécharge que si on l'a demandé.
    if (!manual && !getSettings().updates.auto) {
      set({ kind: "idle" });
      return;
    }
    let total = 0;
    let done = 0;
    set({ kind: "downloading", version: update.version, progress: 0 });
    // On télécharge seulement : l'installation (qui ferme tomo sur Windows) attend le clic sur « Redémarrer ».
    await update.download((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        done += e.data.chunkLength;
        set({ kind: "downloading", version: update.version, progress: total ? done / total : 0 });
      }
    });
    pending = update;
    set({ kind: "ready", version: update.version, notes: update.body ?? "" });
  } catch (e) {
    set(manual ? { kind: "error", message: "Impossible de vérifier les mises à jour pour l'instant." } : { kind: "idle" });
    console.warn("mise à jour", e);
  } finally {
    running = false;
  }
}

export async function restartNow() {
  await pending?.install();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Vérifie au démarrage puis toutes les 6 heures. */
export function startUpdateChecks() {
  if (!inTauri) return () => {};
  const first = window.setTimeout(() => void checkForUpdate(), 15_000);
  const every = window.setInterval(() => void checkForUpdate(), 6 * 3600_000);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(every);
  };
}
