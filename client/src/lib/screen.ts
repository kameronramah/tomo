/**
 * Partage d'écran haute qualité.
 *
 * Profils :
 *  - jeu      : 1080p 60 i/s, H.264 (encodage matériel par la carte graphique → le PC reste libre pour jouer)
 *  - netteté  : 1440p 30 i/s, VP9 (texte, code, cartes : plus net à débit égal), on garde la résolution
 *  - maximum  : 4K 30 i/s, VP9, gros débit (connexion fibre conseillée)
 *  - économie : 720p 30 i/s, H.264, pour une petite connexion
 * Les spectateurs avec une connexion faible reçoivent automatiquement une version plus légère (simulcast).
 */
import {
  AudioPresets,
  Room,
  ScreenSharePresets,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrackPublication,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from "livekit-client";
import { t } from "./i18n";

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
};

export const SCREEN_PRESETS: ScreenPreset[] = [
  { id: "game", label: t("Jeu fluide"), detail: t("1080p · 60 i/s"), width: 1920, height: 1080, fps: 60, bitrate: 8_000_000, codec: "h264", hint: "motion" },
  { id: "sharp", label: t("Netteté"), detail: t("1440p · 30 i/s · texte, code"), width: 2560, height: 1440, fps: 30, bitrate: 9_000_000, codec: "vp9", hint: "detail" },
  { id: "max", label: "Maximum", detail: "4K · 30 i/s · grosse connexion", width: 3840, height: 2160, fps: 30, bitrate: 16_000_000, codec: "vp9", hint: "detail" },
  { id: "eco", label: t("Économie"), detail: t("720p · 30 i/s · petite connexion"), width: 1280, height: 720, fps: 30, bitrate: 2_500_000, codec: "h264", hint: "motion" },
];

export const presetById = (id: string) => SCREEN_PRESETS.find((p) => p.id === id) ?? SCREEN_PRESETS[0];

export async function startScreenShare(room: Room, presetId: ScreenPresetId, withAudio: boolean) {
  const p = presetById(presetId);
  const capture: ScreenShareCaptureOptions = {
    audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    systemAudio: withAudio ? "include" : "exclude",
    resolution: { width: p.width, height: p.height, frameRate: p.fps },
    contentHint: p.hint,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  };
  const publish: TrackPublishOptions = {
    videoCodec: p.codec,
    backupCodec: { codec: "vp8" },
    screenShareEncoding: { maxBitrate: p.bitrate, maxFramerate: p.fps, priority: "high" },
    // Versions plus légères pour les spectateurs à faible débit
    screenShareSimulcastLayers: p.fps >= 60 ? [ScreenSharePresets.h1080fps30, ScreenSharePresets.h720fps15] : [ScreenSharePresets.h720fps15],
    degradationPreference: p.hint === "motion" ? "maintain-framerate" : "maintain-resolution",
    audioPreset: AudioPresets.musicHighQualityStereo,
    dtx: false,
    red: false,
  };
  await room.localParticipant.setScreenShareEnabled(true, capture, publish);
}

export async function stopScreenShare(room: Room) {
  await room.localParticipant.setScreenShareEnabled(false);
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
