import { ConnectionQuality, Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { Api } from "./api";
import { getSettings, loadDevices, onSettingsChange } from "./prefs";

/** Volumes choisis par personne (par pseudo), gardés le temps de la session. */
export const volumeMemory = new Map<string, number>();
let deafened = false;
let activeRoom: Room | null = null;

const volumeKey = (p: RemoteParticipant) => p.name || p.identity;

function applyVolume(p: RemoteParticipant) {
  const master = getSettings().audio.outputVolume;
  p.setVolume(deafened ? 0 : (volumeMemory.get(volumeKey(p)) ?? 1) * master);
}

// Le volume général (Paramètres) s'applique tout de suite.
onSettingsChange(() => activeRoom?.remoteParticipants.forEach(applyVolume));

export function setParticipantVolume(p: RemoteParticipant, v: number) {
  volumeMemory.set(volumeKey(p), v);
  applyVolume(p);
}

/** Couper le son : plus rien n'est entendu (le micro est géré à part). */
export function setDeafened(room: Room | null, value: boolean) {
  deafened = value;
  room?.remoteParticipants.forEach(applyVolume);
}

/** Conteneur caché qui reçoit les éléments <audio> des voix des autres. */
function audioContainer(): HTMLElement {
  let el = document.getElementById("tomo-audio");
  if (!el) {
    el = document.createElement("div");
    el.id = "tomo-audio";
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
}

/** Connexion vocale générique (salon d'un serveur ou appel privé). */
export async function connectVoice(url: string, token: string, opts: { micEnabled: boolean }) {
  const devices = loadDevices();
  const audio = getSettings().audio;
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      deviceId: devices.input,
      echoCancellation: audio.echoCancellation,
      noiseSuppression: audio.noiseSuppression,
      autoGainControl: audio.autoGain,
    },
    audioOutput: devices.output ? { deviceId: devices.output } : undefined,
  });

  room
    .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind === Track.Kind.Audio) {
        audioContainer().appendChild(track.attach());
        applyVolume(participant);
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    })
    .on(RoomEvent.Disconnected, () => {
      if (activeRoom === room) activeRoom = null;
    });

  await room.connect(url, token);
  activeRoom = room;

  let warning: string | undefined;
  if (opts.micEnabled) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      warning = "Micro indisponible : tu peux écouter, mais pas parler. Vérifie l'autorisation du micro.";
    }
  }
  return { room, warning };
}

export async function joinRoom(api: Api, roomId: string, opts: { micEnabled: boolean }) {
  const { url, token } = await api.roomToken(roomId);
  return connectVoice(url, token, opts);
}

// ---------------------------------------------------------------------------
// Qualité réseau
// ---------------------------------------------------------------------------
export type NetworkInfo = { rtt: number | null; level: 0 | 1 | 2 | 3; label: string };

/** Ping (aller-retour vers le serveur vocal) et qualité estimée par LiveKit. */
export function networkInfo(room: Room | null): NetworkInfo {
  if (!room) return { rtt: null, level: 0, label: "hors ligne" };
  const raw = (room as unknown as { engine?: { client?: { rtt?: number } } }).engine?.client?.rtt;
  const rtt = typeof raw === "number" && raw > 0 ? Math.round(raw) : null;
  const q = room.localParticipant.connectionQuality;
  let level: NetworkInfo["level"] =
    q === ConnectionQuality.Excellent ? 3 : q === ConnectionQuality.Good ? 2 : q === ConnectionQuality.Poor ? 1 : 0;
  // Si LiveKit n'a pas encore d'avis, on se base sur le ping.
  if (level === 0 && rtt !== null) level = rtt < 80 ? 3 : rtt < 180 ? 2 : 1;
  const label = level === 3 ? "excellente" : level === 2 ? "bonne" : level === 1 ? "faible" : "en cours…";
  return { rtt, level, label };
}
