/**
 * Intégration au système : notifications Windows / Mac, lancement au démarrage,
 * heures calmes. Sans effet dans la version navigateur (dev).
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getSettings } from "./prefs";
import { isQuietMode } from "./sounds";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Sommes-nous dans les heures calmes réglées (ex. 23:00 → 08:00) ? */
export function inQuietHours(now = new Date()): boolean {
  const n = getSettings().notifications;
  if (!n.quietEnabled) return false;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMin(n.quietFrom);
  const to = toMin(n.quietTo);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

let permission: boolean | null = null;

/**
 * Notification système, seulement si tomo n'est pas au premier plan, hors « Ne pas déranger »
 * et hors heures calmes.
 */
export async function notify(title: string, body: string) {
  const n = getSettings().notifications;
  if (!inTauri || !n.desktop || isQuietMode()) return;
  if (document.hasFocus()) return;
  try {
    if (permission === null) permission = await isPermissionGranted();
    if (!permission) permission = (await requestPermission()) === "granted";
    if (permission) sendNotification({ title, body: n.desktopPreview ? body : "Nouveau message" });
  } catch {
    // notifications indisponibles : tant pis
  }
}

export async function autostartEnabled(): Promise<boolean> {
  if (!inTauri) return false;
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setAutostart(on: boolean) {
  if (!inTauri) return;
  if (on) await enable();
  else await disable();
}

/** Lancé avec l'ordinateur + option « Démarrer réduit » : on réduit la fenêtre. */
export async function applyStartupMinimize() {
  if (!inTauri || !getSettings().startup.minimized) return;
  try {
    if (await invoke<boolean>("launched_at_login")) await getCurrentWindow().minimize();
  } catch {
    // pas grave
  }
}
