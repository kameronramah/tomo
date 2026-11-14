/**
 * Caméra en vocal (salons et appels privés).
 *
 * Envoyée en 720p 30 i/s, avec deux versions plus légères (180p et 360p) : chaque personne reçoit
 * celle qui suffit pour la bulle affichée (360p), le serveur baisse encore si la connexion ne suit pas.
 * La caméra est toujours coupée en arrivant dans un vocal : on l'allume soi-même, à chaque fois.
 */
import {
  Room,
  Track,
  VideoPresets,
  VideoQuality,
  type Participant,
  type RemoteTrackPublication,
  type VideoTrack,
} from "livekit-client";
import { loadDevices, saveDevices } from "./prefs";
import { t } from "./i18n";

export async function startCamera(room: Room) {
  const deviceId = loadDevices().camera;
  await room.localParticipant.setCameraEnabled(
    true,
    { deviceId, resolution: VideoPresets.h720.resolution },
    { videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360], videoCodec: "vp8" },
  );
}

export async function stopCamera(room: Room) {
  await room.localParticipant.setCameraEnabled(false);
}

/** Changer de caméra (même pendant qu'elle tourne). */
export async function switchCamera(room: Room, id: string) {
  saveDevices({ ...loadDevices(), camera: id });
  if (room.localParticipant.isCameraEnabled) await room.switchActiveDevice("videoinput", id);
}

/** Image de la caméra de cette personne, si elle est allumée (et reçue). */
export function cameraOf(p: Participant): VideoTrack | undefined {
  const pub = p.getTrackPublication(Track.Source.Camera);
  if (!pub || pub.isMuted || !pub.track) return undefined;
  return pub.track as VideoTrack;
}

/** Caméra d'un autre reçue : la version 360p suffit pour une bulle. */
export function onCameraSubscribed(pub: RemoteTrackPublication) {
  pub.setVideoQuality(VideoQuality.MEDIUM);
}

/** Message clair quand la caméra ne démarre pas. */
export function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return t("Caméra refusée : vérifie l'autorisation de la caméra.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("Aucune caméra trouvée.");
  if (name === "NotReadableError") return t("La caméra est déjà utilisée par une autre appli.");
  return t("La caméra n'a pas pu démarrer.");
}
