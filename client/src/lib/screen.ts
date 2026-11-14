/**
 * Partage d'écran haute qualité.
 *
 * Profils :
 *  - jeu      : 1080p 60 i/s, H.264 (encodage matériel par la carte graphique → le PC reste libre pour jouer)
 *  - netteté  : 1440p 30 i/s, H.264 (texte, code, cartes), on garde la résolution
 *  - maximum  : 4K 30 i/s, H.264, gros débit (connexion fibre conseillée)
 *  - économie : 720p 30 i/s, H.264, pour une petite connexion
 * Chaque partage part en 3 versions (simulcast) : chaque spectateur reçoit la meilleure que sa
 * connexion supporte (ex. 4K → 1440p → 1080p). Tout en H.264 : encodage par la carte graphique.
 * (VP9 a été essayé : LiveKit n'autorise pas ses « étages » pour un partage d'écran et son
 * encodage par le processeur s'essoufflait en 4K → les spectateurs restaient en 720p / 1080p.)
 */
import {
  AudioPresets,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPreset,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrackPublication,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from "livekit-client";
import { t } from "./i18n";
import { startNativeCapture, stopNativeCapture } from "./nativeCapture";

export type ScreenPresetId = "game" | "sharp" | "max" | "eco";

export type ScreenPreset = {
  id: ScreenPresetId;
  label: string;
  detail: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number; // bits/s
  codec: "h264" | "vp9";
  hint: "motion" | "detail";
  /** Versions plus légères envoyées en plus (de la plus petite à la plus grande). */
  layers: VideoPreset[];
};

// Rangés du plus léger au plus lourd ; « Jeu fluide » reste le choix par défaut (voir presetById).
export const SCREEN_PRESETS: ScreenPreset[] = [
  { id: "eco", label: t("Économie"), detail: t("720p · 30 i/s · petite connexion"), width: 1280, height: 720, fps: 30, bitrate: 2_500_000, codec: "h264", hint: "motion", layers: [ScreenSharePresets.h720fps15] },
  { id: "game", label: t("Jeu fluide"), detail: t("1080p · 60 i/s"), width: 1920, height: 1080, fps: 60, bitrate: 8_000_000, codec: "h264", hint: "motion", layers: [ScreenSharePresets.h720fps15, ScreenSharePresets.h1080fps30] },
  { id: "sharp", label: t("Netteté"), detail: t("1440p · 30 i/s · texte, code"), width: 2560, height: 1440, fps: 30, bitrate: 10_000_000, codec: "h264", hint: "detail", layers: [new VideoPreset(1280, 720, 2_500_000, 30), new VideoPreset(1920, 1080, 5_000_000, 30)] },
  { id: "max", label: t("Maximum"), detail: t("4K · 30 i/s · grosse connexion"), width: 3840, height: 2160, fps: 30, bitrate: 18_000_000, codec: "h264", hint: "detail", layers: [new VideoPreset(1920, 1080, 5_000_000, 30), new VideoPreset(2560, 1440, 9_000_000, 30)] },
];

export const presetById = (id: string) =>
  SCREEN_PRESETS.find((p) => p.id === id) ?? SCREEN_PRESETS.find((p) => p.id === "game")!;

/**
 * `sourceId` (appli Windows) : écran ou fenêtre choisi dans le sélecteur de Tomo, capturé par nous.
 * Sans lui, c'est la fenêtre de partage du système qui s'ouvre (navigateur, Mac, ou partage avec le son du PC).
 */
export async function startScreenShare(room: Room, presetId: ScreenPresetId, withAudio: boolean, sourceId?: string) {
  const p = presetById(presetId);
  if (sourceId) {
    const cap = await startNativeCapture({
      source: sourceId,
      fps: p.fps,
      maxWidth: p.width,
      maxHeight: p.height,
      onClosed: () => void stopScreenShare(room).catch(() => {}),
    });
    cap.track.contentHint = p.hint;
    try {
      await room.localParticipant.publishTrack(cap.track, { source: Track.Source.ScreenShare, ...screenPublishOptions(p) });
    } catch (err) {
      await stopNativeCapture();
      throw err;
    }
    // Salon quitté ou partage retiré d'une autre façon : on arrête aussi la capture.
    const off = () => {
      if (room.localParticipant.isScreenShareEnabled && room.state === "connected") return;
      room.off(RoomEvent.LocalTrackUnpublished, off);
      room.off(RoomEvent.Disconnected, off);
      void stopNativeCapture();
    };
    room.on(RoomEvent.LocalTrackUnpublished, off);
    room.on(RoomEvent.Disconnected, off);
    return;
  }
  const capture: ScreenShareCaptureOptions = {
    audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    systemAudio: withAudio ? "include" : "exclude",
    resolution: { width: p.width, height: p.height, frameRate: p.fps },
    contentHint: p.hint,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  };
  await room.localParticipant.setScreenShareEnabled(true, capture, screenPublishOptions(p));
}

/** Réglages d'envoi d'un partage (aussi utilisés par le bot de test, pour qu'il se comporte pareil). */
export function screenPublishOptions(p: ScreenPreset): TrackPublishOptions {
  return {
    videoCodec: p.codec,
    backupCodec: { codec: "vp8" },
    screenShareEncoding: { maxBitrate: p.bitrate, maxFramerate: p.fps, priority: "high" },
    // Versions plus légères pour les spectateurs à faible débit (le serveur choisit pour chacun)
    screenShareSimulcastLayers: p.layers,
    degradationPreference: p.hint === "motion" ? "maintain-framerate" : "maintain-resolution",
    audioPreset: AudioPresets.musicHighQualityStereo,
    dtx: false,
    red: false,
  };
}

export async function stopScreenShare(room: Room) {
  await room.localParticipant.setScreenShareEnabled(false);
  await stopNativeCapture();
}

export const isSharing = (room: Room) => room.localParticipant.isScreenShareEnabled;

export type Share = {
  participant: Participant;
  publication: RemoteTrackPublication | LocalTrackPublication;
  hasAudio: boolean;
  isLocal: boolean;
};

/** Tous les partages d'écran en cours dans le salon (le mien en premier). */
export function listShares(room: Room): Share[] {
  const shares: Share[] = [];
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  for (const p of all) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub && pub.track) {
      shares.push({
        participant: p,
        publication: pub as RemoteTrackPublication | LocalTrackPublication,
        hasAudio: !!p.getTrackPublication(Track.Source.ScreenShareAudio)?.track,
        isLocal: p === room.localParticipant,
      });
    }
  }
  return shares;
}

/** Message clair quand le partage échoue (annulé, refusé, non supporté). */
export function screenShareError(err: unknown): string | null {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return null; // l'utilisateur a annulé la fenêtre de choix
  if (name === "NotSupportedError") return t("Le partage d'écran n'est pas pris en charge ici.");
  if (name === "NotReadableError") return t("Impossible de capturer cet écran (protégé ou indisponible).");
  return t("Le partage d'écran n'a pas pu démarrer.");
}

/*
 * « Qui regarde quoi » : attribut LiveKit `watch` = identité de celui dont je regarde l'écran
 * ("" = je ne regarde rien). Les autres s'en servent pour afficher « regarde Léo » et le nombre
 * de spectateurs. Rien n'est stocké sur le serveur.
 */
export function setWatching(room: Room, identity: string | null) {
  const me = room.localParticipant;
  const value = identity ?? "";
  if ((me.attributes?.watch ?? "") === value) return;
  void me.setAttributes({ ...me.attributes, watch: value }).catch(() => {});
}

/** Identité de l'écran que regarde cette personne (null si aucun). */
export const watchingOf = (p: Participant) => p.attributes?.watch || null;

/** Les personnes qui regardent l'écran de `identity` (sans lui-même). */
export function viewersOf(room: Room, identity: string): Participant[] {
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  return all.filter((p) => p.identity !== identity && watchingOf(p) === identity);
}
