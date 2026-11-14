/**
 * Mises à jour de tomo.
 *
 * Appli de bureau (versions publiées sur GitHub, fichier latest.json signé) :
 *  - au lancement, une mise à jour disponible est IMPOSÉE (écran « Mise à jour en cours… », puis relance) ;
 *  - pendant l'utilisation, on vérifie toutes les 30 min et on télécharge en arrière-plan ; une pop-up
 *    propose d'installer, jamais pendant un vocal ; Tomo ne redémarre jamais tout seul.
 * Version navigateur : le serveur écrit /version.json à chaque mise à jour ; si la valeur change,
 *  même pop-up avec « Recharger ». Au prochain chargement, la nouvelle version est utilisée d'office.
 * Si GitHub ou le réseau ne répondent pas, on laisse entrer : rien ne doit bloquer l'appli.
 */
import conf from "../../src-tauri/tauri.conf.json";
import { inTauri } from "./desktop";
import { t } from "./i18n";

export const APP_VERSION: string = conf.version;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "ready"; version: string; notes: string; web?: boolean }
  /** Le serveur n'accepte plus cette version : il faut mettre à jour pour continuer. */
  | { kind: "required"; minVersion: string }
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

/** « 0.10.0 » < « 0.9.2 » ? Comparaison chiffre par chiffre. */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("délai dépassé")), ms))]);
}

// ---------------------------------------------------------------------------
// Au lancement (appli de bureau) : mise à jour imposée
// ---------------------------------------------------------------------------
/**
 * Renvoie true si une mise à jour s'installe (Tomo va se relancer), false sinon (on continue).
 * onProgress reçoit la version et l'avancement (0..1) pour l'écran « Mise à jour en cours… ».
 */
export async function updateAtLaunch(onProgress: (version: string, progress: number) => void): Promise<boolean> {
  if (!inTauri) return false;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await withTimeout(check(), 8000);
    if (!update) return false;
    let total = 0;
    let done = 0;
    onProgress(update.version, 0);
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        done += e.data.chunkLength;
        onProgress(update.version, total ? done / total : 0);
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return true;
  } catch (e) {
    // Pas de réseau, GitHub injoignable… : on laisse entrer.
    console.warn("mise à jour au lancement", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pendant l'utilisation
// ---------------------------------------------------------------------------
let running = false;
let pending: import("@tauri-apps/plugin-updater").Update | null = null;

/** Cherche une mise à jour ; si elle existe, la télécharge (l'installation attend le clic). */
export async function checkForUpdate(manual = false) {
  if (!inTauri || running || state.kind === "ready" || state.kind === "required") return;
  running = true;
  if (manual) set({ kind: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      set(manual ? { kind: "none" } : { kind: "idle" });
      return;
    }
    let total = 0;
    let done = 0;
    set({ kind: "downloading", version: update.version, progress: 0 });
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
    set(manual ? { kind: "error", message: t("Impossible de vérifier les mises à jour pour l'instant.") } : { kind: "idle" });
    console.warn("mise à jour", e);
  } finally {
    running = false;
  }
}

/** Installer maintenant (bureau) ou recharger la page (navigateur). */
export async function restartNow() {
  if (!inTauri) {
    location.reload();
    return;
  }
  if (!pending) {
    // Mise à jour imposée par le serveur et pas encore téléchargée : on la récupère d'abord.
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    if (!pending) return location.reload();
  }
  await pending.install();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Version navigateur : la valeur de /version.json au chargement, puis surveillée. */
let webVersion: string | null = null;
async function checkWebVersion() {
  if (inTauri || state.kind === "ready") return;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return; // pas de fichier (dev) : rien à faire
    const data = (await res.json()) as { commit?: string };
    if (!data.commit) return;
    if (webVersion === null) webVersion = data.commit;
    else if (data.commit !== webVersion) set({ kind: "ready", version: data.commit, notes: "", web: true });
  } catch {
    // pas grave : on réessaiera
  }
}

// Mode développement : relancer la vérification depuis la console (absent du build final).
if (import.meta.env.DEV) (window as unknown as { __tomoCheckWeb: () => Promise<void> }).__tomoCheckWeb = checkWebVersion;

/** Le serveur impose-t-il une version minimale de l'appli ? (GET /version → { minClient }) */
async function checkMinClient(apiBase: string) {
  try {
    const res = await fetch(`${apiBase}/version`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { minClient?: string };
    if (data.minClient && olderThan(APP_VERSION, data.minClient)) set({ kind: "required", minVersion: data.minClient });
  } catch {
    // serveur injoignable : on ne bloque pas
  }
}

/** Vérifications régulières : bureau toutes les 30 min, navigateur toutes les 10 min, version minimale toutes les 30 min. */
export function startUpdateChecks(apiBase: string) {
  const timers: number[] = [];
  void checkMinClient(apiBase);
  timers.push(window.setInterval(() => void checkMinClient(apiBase), 30 * 60_000));
  if (inTauri) {
    timers.push(window.setTimeout(() => void checkForUpdate(), 60_000));
    timers.push(window.setInterval(() => void checkForUpdate(), 30 * 60_000));
  } else {
    void checkWebVersion();
    timers.push(window.setInterval(() => void checkWebVersion(), 10 * 60_000));
  }
  return () => timers.forEach((id) => (window.clearTimeout(id), window.clearInterval(id)));
}
