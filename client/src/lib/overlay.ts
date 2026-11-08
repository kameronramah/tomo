/**
 * Overlay en jeu : une petite fenêtre transparente, toujours au-dessus, que les clics traversent.
 * Elle montre qui parle (et qui a coupé son micro), les derniers messages du chat de la pièce
 * et les sous-titres. Marche avec les jeux en « plein écran fenêtré » / « fenêtré sans bordure »
 * (un jeu en plein écran exclusif passe par-dessus toutes les fenêtres).
 *
 * La fenêtre principale calcule l'état et l'envoie à la fenêtre « overlay » (événement Tauri).
 */
import type { Room } from "livekit-client";
import { inTauri } from "./desktop";
import { getSettings, type Settings } from "./prefs";
import { currentGame, gamePrefs } from "./games";
import { speakingDetector } from "./speaking";
import { getCaptions } from "./captions";
import { colorFor } from "./ui";

export type OverlayState = {
  room: string;
  voices: { id: string; name: string; speaking: boolean; muted: boolean; color: string }[];
  chat: { id: string; name: string; text: string }[];
  captions: { id: string; name: string; text: string; translated: boolean }[];
  prefs: Settings["overlay"];
};

const W = 340;
const H = 440;
const CHAT_MS = 15_000;
const CAPTION_MS = 8_000;

type OverlayWindow = {
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  setPosition(p: unknown): Promise<void>;
  setIgnoreCursorEvents(v: boolean): Promise<void>;
  once(ev: string, cb: () => void): Promise<unknown>;
};
let win: OverlayWindow | null = null;
let creating: Promise<OverlayWindow | null> | null = null;
let shownCorner = "";
let shown = false;
const recentChat: { id: string; name: string; text: string; at: number }[] = [];

/** Message du chat de la pièce (affiché quelques secondes dans l'overlay). */
export function overlayChat(id: string, name: string, text: string) {
  recentChat.push({ id, name, text: text.replace(/<@[^>]+>/g, "@…").slice(0, 140), at: Date.now() });
  if (recentChat.length > 10) recentChat.shift();
}

async function cornerPosition(corner: Settings["overlay"]["corner"]) {
  const { primaryMonitor, LogicalPosition } = await import("@tauri-apps/api/window");
  const m = await primaryMonitor();
  const scale = m?.scaleFactor ?? 1;
  const mx = (m?.position.x ?? 0) / scale;
  const my = (m?.position.y ?? 0) / scale;
  const mw = (m?.size.width ?? 1920) / scale;
  const mh = (m?.size.height ?? 1080) / scale;
  const x = corner.endsWith("r") ? mx + mw - W - 16 : mx + 16;
  const y = corner.startsWith("b") ? my + mh - H - 56 : my + 16;
  return new LogicalPosition(x, y);
}

async function ensureWindow(): Promise<OverlayWindow | null> {
  if (win) return win;
  if (creating) return creating;
  creating = (async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("overlay");
      const pos = await cornerPosition(getSettings().overlay.corner);
      const w = (existing ??
        new WebviewWindow("overlay", {
          url: "/?overlay=1",
          title: "tomo overlay",
          transparent: true,
          decorations: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          focus: false,
          resizable: false,
          shadow: false,
          visible: false,
          width: W,
          height: H,
          x: pos.x,
          y: pos.y,
        })) as unknown as OverlayWindow;
      if (!existing) await new Promise<void>((r) => void w.once("tauri://created", () => r()));
      await w.setIgnoreCursorEvents(true); // les clics traversent : l'overlay ne gêne jamais la partie
      shownCorner = getSettings().overlay.corner;
      win = w;
      return w;
    } catch (e) {
      console.warn("overlay indisponible", e);
      return null;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

function wanted(): boolean {
  const o = getSettings().overlay;
  if (o.mode === "off") return false;
  if (o.mode === "always") return true;
  const g = currentGame();
  return !!g && gamePrefs(g.id).overlay;
}

function stateFor(room: Room, label: string): OverlayState {
  const speaking = speakingDetector(room).speaking;
  const people = [room.localParticipant, ...room.remoteParticipants.values()];
  const now = Date.now();
  const captions = getCaptions()
    ?.lines.filter((l) => !l.pending && now - l.at < CAPTION_MS)
    .slice(-2)
    .map((l) => ({ id: l.id, name: l.name, text: l.text, translated: !!l.original && l.original !== l.text }));
  return {
    room: label,
    voices: people.map((p) => ({
      id: p.identity,
      name: p.name || p.identity,
      speaking: speaking.has(p.identity),
      muted: !p.isMicrophoneEnabled,
      color: colorFor(p.name || p.identity).bg,
    })),
    chat: recentChat.filter((m) => now - m.at < CHAT_MS).slice(-2),
    captions: captions ?? [],
    prefs: getSettings().overlay,
  };
}

/** Démarre l'overlay pour la pièce vocale en cours. Renvoie la fonction d'arrêt. */
export function startOverlay(room: Room, label: () => string) {
  if (!inTauri) return () => {};
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const want = wanted();
    if (!want) {
      if (shown && win) await win.hide().catch(() => {});
      shown = false;
      return;
    }
    const w = await ensureWindow();
    if (!w || stopped) return;
    const prefs = getSettings().overlay;
    if (prefs.corner !== shownCorner) {
      shownCorner = prefs.corner;
      await w.setPosition(await cornerPosition(prefs.corner)).catch(() => {});
    }
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("overlay", "overlay:state", stateFor(room, label())).catch(() => {});
    if (!shown) {
      await w.show().catch(() => {});
      await w.setIgnoreCursorEvents(true).catch(() => {});
      shown = true;
    }
  };
  const timer = window.setInterval(() => void tick(), 200);
  void tick();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    recentChat.length = 0;
    if (win) void win.hide().catch(() => {});
    shown = false;
  };
}
