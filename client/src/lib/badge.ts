/**
 * Pastille de notification de l'appli : ce qui t'attend vraiment (messages privés non lus,
 * demandes d'ami et de message). Les nouveaux messages des fils ne comptent pas.
 *
 * - Windows : pastille rouge en surimpression sur l'icône de la barre des tâches (« 9+ » au-delà).
 * - Mac : pastille du Dock.
 * - Navigateur : « (4) tomo » dans le titre de l'onglet + point rouge sur l'icône de l'onglet.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./desktop";

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
let last = -1;

/** Dessine le logo tomo (deux bulles) dans un canvas, avec ou sans point rouge. */
function drawFavicon(withDot: boolean): string {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  const teal = new Path2D("M5 13a8 8 0 0 1 8-8h3a8 8 0 0 1 0 16h-5l-4 3v-4.5A8 8 0 0 1 5 13z");
  const amber = new Path2D("M27 19a6 6 0 0 0-6-6h-1a6 6 0 0 0 0 12h3l3 2v-3.2A6 6 0 0 0 27 19z");
  g.fillStyle = "#FFB020";
  g.fill(amber);
  g.fillStyle = "#2DD4BF";
  g.fill(teal);
  if (withDot) {
    g.beginPath();
    g.arc(24, 24, 7.5, 0, Math.PI * 2);
    g.fillStyle = "#0E1014";
    g.fill();
    g.beginPath();
    g.arc(24, 24, 5.5, 0, Math.PI * 2);
    g.fillStyle = "#E5484D";
    g.fill();
  }
  return c.toDataURL("image/png");
}

/** Petite image ronde rouge avec le chiffre (surimpression de la barre des tâches Windows). */
async function overlayPng(n: number): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fillStyle = "#E5484D";
  g.fill();
  g.fillStyle = "#fff";
  const text = n > 9 ? "9+" : String(n);
  g.font = `700 ${text.length > 1 ? 15 : 19}px Inter, "Segoe UI", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 16, 17);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob!.arrayBuffer());
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

/** Met à jour la pastille partout (n = 0 pour l'enlever). */
export async function setAppBadge(n: number) {
  if (n === last) return;
  last = n;
  document.title = n > 0 ? `(${n > 99 ? "99+" : n}) tomo` : "tomo";
  setFavicon(drawFavicon(n > 0));
  if (!inTauri) return;
  const win = getCurrentWindow();
  try {
    if (isWindows) await win.setOverlayIcon(n > 0 ? await overlayPng(n) : undefined);
    else await win.setBadgeCount(n > 0 ? n : undefined);
  } catch {
    // pas pris en charge sur ce système : le titre et l'onglet suffisent
  }
}

/** Fait clignoter l'icône une fois (nouveau message privé alors que tomo est en arrière-plan). */
export async function flashIcon() {
  if (!inTauri || document.hasFocus()) return;
  try {
    await getCurrentWindow().requestUserAttention(2); // 2 = informatif (un clignotement)
  } catch {
    // pas grave
  }
}
