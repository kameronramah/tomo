import { Room, RoomEvent, Track } from "livekit-client";
import { loadDevices, type SavedServer } from "./storage";

export type RoomInfo = {
  id: string;
  label: string;
  participants: { identity: string; name: string }[];
};

type ServerAccess = Pick<SavedServer, "apiUrl" | "invite">;

export function normalizeApiUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    // Serveur local → http, serveur distant → https
    const local = /^(localhost|127\.|192\.168\.|10\.)/i.test(u);
    u = `${local ? "http" : "https"}://${u}`;
  }
  return u;
}

/** Appel à l'API Talk2Mates d'un serveur, avec son code d'invitation. */
async function api<T>(server: ServerAccess, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server.apiUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Invite-Code": server.invite, ...init?.headers },
    });
  } catch {
    throw new Error("Serveur injoignable. Vérifie l'adresse.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur serveur (${res.status})`);
  return body as T;
}

export const getServerInfo = (s: ServerAccess) =>
  api<{ name: string; rooms: { id: string; label: string }[] }>(s, "/info");

export const listRooms = (s: ServerAccess) => api<RoomInfo[]>(s, "/rooms");

/** Conteneur caché qui reçoit les éléments <audio> des voix des autres. */
function audioContainer(): HTMLElement {
  let el = document.getElementById("t2m-audio");
  if (!el) {
    el = document.createElement("div");
    el.id = "t2m-audio";
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Rejoint un salon vocal d'un serveur.
 * Renvoie le salon connecté et un éventuel avertissement (ex. micro indisponible).
 */
export async function joinRoom(
  server: ServerAccess,
  name: string,
  roomId: string,
  opts: { micEnabled: boolean },
): Promise<{ room: Room; warning?: string }> {
  const { url, token } = await api<{ url: string; token: string }>(server, "/token", {
    method: "POST",
    body: JSON.stringify({ name, room: roomId }),
  });

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
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) audioContainer().appendChild(track.attach());
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
