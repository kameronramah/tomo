/**
 * Mode coach, côté celui qui partage : les traits des potes s'affichent DIRECTEMENT sur son
 * écran (par-dessus son bureau ou son jeu), dans une fenêtre transparente plein écran que les
 * clics traversent. Elle est posée sur l'écran partagé (reconnu à sa taille).
 *
 * Partage d'une seule fenêtre : on ne sait pas où elle est sur l'écran, les traits restent
 * alors visibles uniquement dans tomo.
 */
import { RoomEvent, Track, type LocalTrackPublication, type Room } from "livekit-client";
import { inTauri, notify } from "./desktop";
import { overlayShown } from "./overlay";
import { coachActive, coachFor, type Mark, type CoachRequest } from "./coach";

export type CoachScreenState = { marks: Mark[]; requests: CoachRequest[] };

type Win = {
  show(): Promise<void>;
  hide(): Promise<void>;
  setPosition(p: unknown): Promise<void>;
  setSize(s: unknown): Promise<void>;
  setIgnoreCursorEvents(v: boolean): Promise<void>;
  once(ev: string, cb: () => void): Promise<unknown>;
};
let win: Win | null = null;
let creating: Promise<Win | null> | null = null;
let placedFor = "";

/** Écran partagé : celui dont la taille correspond à l'image envoyée (sinon l'écran principal). */
async function targetMonitor(width: number, height: number) {
  const { availableMonitors, primaryMonitor } = await import("@tauri-apps/api/window");
  const list = await availableMonitors().catch(() => []);
  return list.find((m) => m.size.width === width && m.size.height === height) ?? (await primaryMonitor()) ?? list[0] ?? null;
}

async function ensureWindow(): Promise<Win | null> {
  if (win) return win;
  if (creating) return creating;
  creating = (async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const w = ((await WebviewWindow.getByLabel("coach-screen")) ??
        new WebviewWindow("coach-screen", {
          url: "/?coach=1",
          title: "Tomo coach",
          transparent: true,
          decorations: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          focus: false,
          resizable: false,
          shadow: false,
          visible: false,
          width: 800,
          height: 600,
        })) as unknown as Win;
      await new Promise<void>((r) => {
        void w.once("tauri://created", () => r());
        setTimeout(r, 1500); // déjà créée : pas d'événement
      });
      await w.setIgnoreCursorEvents(true);
      win = w;
      return w;
    } catch (e) {
      console.warn("annotations à l'écran indisponibles", e);
      return null;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

function myScreenPub(room: Room): LocalTrackPublication | undefined {
  return room.localParticipant.getTrackPublication(Track.Source.ScreenShare) as LocalTrackPublication | undefined;
}

/** Démarre l'affichage des annotations sur mon écran pendant que je partage. */
export function startCoachScreen(room: Room) {
  if (!inTauri) return () => {};
  const coach = coachFor(room);
  let stopped = false;
  let shown = false;
  let lastSent = "";
  let knownRequests = new Set<string>();

  // Nouvelle demande : notification système (Tomo est souvent derrière le jeu)
  const offReq = coach.on(() => {
    for (const r of coach.requests)
      if (!knownRequests.has(r.identity)) void notify(`${r.name} veut annoter ton écran`, "Ouvre Tomo pour autoriser ou refuser.");
    knownRequests = new Set(coach.requests.map((r) => r.identity));
  });

  // Fin de mon partage : toutes les autorisations sont retirées
  const onUnpub = (pub: LocalTrackPublication) => {
    if (pub.source === Track.Source.ScreenShare) void coach.stopSharing();
  };
  room.on(RoomEvent.LocalTrackUnpublished, onUnpub);

  const tick = async () => {
    if (stopped) return;
    const me = room.localParticipant;
    const pub = myScreenPub(room);
    const settings = pub?.track?.mediaStreamTrack.getSettings() as (MediaTrackSettings & { displaySurface?: string }) | undefined;
    const wholeScreen = !!settings && settings.displaySurface !== "window" && settings.displaySurface !== "browser";
    // Traits : seulement si tout l'écran est partagé (sinon on ne sait pas où les poser).
    // Demandes en attente : toujours affichées par-dessus, sauf si l'overlay en jeu les montre déjà.
    const marks = wholeScreen ? coach.visible(me.identity) : [];
    const requests = overlayShown() ? [] : coach.requests.map((r) => ({ ...r, name: coach.requestName(r) }));
    const want = !!pub && ((wholeScreen && (coachActive(me) || marks.length > 0)) || requests.length > 0);
    if (!want) {
      if (shown && win) await win.hide().catch(() => {});
      shown = false;
      return;
    }
    const w = await ensureWindow();
    if (!w || stopped) return;
    const key = `${settings?.width}x${settings?.height}`;
    if (key !== placedFor) {
      placedFor = key;
      const m = await targetMonitor(settings?.width ?? 0, settings?.height ?? 0);
      if (m) {
        const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
        await w.setPosition(new PhysicalPosition(m.position.x, m.position.y)).catch(() => {});
        await w.setSize(new PhysicalSize(m.size.width, m.size.height)).catch(() => {});
      }
    }
    const state: CoachScreenState = { marks, requests };
    const json = JSON.stringify(state);
    if (json !== lastSent || marks.length) {
      lastSent = json;
      const { emitTo } = await import("@tauri-apps/api/event");
      await emitTo("coach-screen", "coach:state", state).catch(() => {});
    }
    if (!shown) {
      await w.show().catch(() => {});
      await w.setIgnoreCursorEvents(true).catch(() => {});
      shown = true;
    }
  };
  const timer = window.setInterval(() => void tick(), 50);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    offReq();
    room.off(RoomEvent.LocalTrackUnpublished, onUnpub);
    if (win) void win.hide().catch(() => {});
  };
}
