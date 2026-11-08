import { Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { Api } from "./api";
import { loadDevices } from "./prefs";

/** Volumes choisis par personne (par pseudo), gardés le temps de la session. */
export const volumeMemory = new Map<string, number>();
let deafened = false;

const volumeKey = (p: RemoteParticipant) => p.name || p.identity;

function applyVolume(p: RemoteParticipant) {
  p.setVolume(deafened ? 0 : volumeMemory.get(volumeKey(p)) ?? 1);
}

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

export async function joinRoom(api: Api, roomId: string, opts: { micEnabled: boolean }) {
  const { url, token } = await api.roomToken(roomId);
  const devices = loadDevices();
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      deviceId: devices.input,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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
    });

  await room.connect(url, token);

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
