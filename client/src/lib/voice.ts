import { Room, RoomEvent, Track } from "livekit-client";

export type Settings = {
  apiUrl: string;
  name: string;
  invite: string;
  room: string;
};

const SETTINGS_KEY = "t2m.settings";

export function loadSettings(): Settings {
  const defaults: Settings = { apiUrl: "http://localhost:3000", name: "", invite: "", room: "general" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // stockage indisponible : pas grave
  }
}

/** Demande un token à l'API Talk2Mates. */
async function fetchToken(s: Settings): Promise<{ url: string; token: string }> {
  let res: Response;
  try {
    res = await fetch(`${s.apiUrl.replace(/\/+$/, "")}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: s.name, room: s.room, invite: s.invite }),
    });
  } catch {
    throw new Error("Serveur injoignable. Vérifie l'adresse du serveur.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur serveur (${res.status})`);
  return body;
}

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
 * Crée le salon, branche la lecture audio et se connecte.
 * Renvoie le salon connecté et un éventuel avertissement (ex. micro indisponible).
 */
export async function joinRoom(s: Settings): Promise<{ room: Room; warning?: string }> {
  const { url, token } = await fetchToken(s);

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
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
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch {
    warning = "Micro indisponible : tu peux écouter, mais pas parler. Vérifie l'autorisation du micro.";
  }
  return { room, warning };
}
