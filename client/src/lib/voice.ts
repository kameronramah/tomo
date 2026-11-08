import { ConnectionQuality, Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { Api } from "./api";
import { getSettings, loadDevices, onSettingsChange } from "./prefs";
import { SpatialEngine, type Pose } from "./spatial";
import { ClipRecorder } from "./clips";
import { VoiceLeveler } from "./leveler";
import { onGameLink } from "./gameLink";

/** Volumes choisis par personne (par pseudo), gardés le temps de la session. */
export const volumeMemory = new Map<string, number>();
let deafened = false;
let activeRoom: Room | null = null;

const volumeKey = (p: RemoteParticipant) => p.name || p.identity;

/** Volume du son des partages d'écran, par personne. */
export const screenVolumeMemory = new Map<string, number>();

function applyVolume(p: RemoteParticipant) {
  const master = getSettings().audio.outputVolume;
  p.setVolume(deafened ? 0 : (volumeMemory.get(volumeKey(p)) ?? 1) * master);
  p.setVolume(deafened ? 0 : (screenVolumeMemory.get(volumeKey(p)) ?? 1) * master, Track.Source.ScreenShareAudio);
}

export function setScreenVolume(p: RemoteParticipant, v: number) {
  screenVolumeMemory.set(volumeKey(p), v);
  applyVolume(p);
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

// ---------------------------------------------------------------------------
// Extras de la connexion vocale en cours : audio spatial + clip
// ---------------------------------------------------------------------------
type Extras = {
  room: Room;
  spatial: SpatialEngine;
  leveler: VoiceLeveler;
  recorder: ClipRecorder | null;
  ctx: AudioContext;
  offs: (() => void)[];
};
let extras: Extras | null = null;
const extrasListeners = new Set<() => void>();

export const getSpatial = () => extras?.spatial ?? null;
export const getLeveler = () => extras?.leveler ?? null;
export const getRecorder = () => extras?.recorder ?? null;

// Mode développement uniquement : accès console pour déboguer l'audio (absent du build final).
if (import.meta.env.DEV) (window as unknown as { __tomo: object }).__tomo = { getSpatial, getRecorder, getLeveler };
export function onExtrasChange(fn: () => void) {
  extrasListeners.add(fn);
  return () => void extrasListeners.delete(fn);
}

async function setClips(ex: Extras, on: boolean) {
  if (on && !ex.recorder) {
    const rec = new ClipRecorder(ex.room);
    try {
      await rec.start();
      ex.recorder = rec;
    } catch {
      ex.recorder = null;
    }
  } else if (!on && ex.recorder) {
    await ex.recorder.stop();
    ex.recorder = null;
  }
  // Visible par tous : « clips activés » sur ma tuile
  ex.room.localParticipant.setAttributes({ clips: ex.recorder ? "1" : "0" }).catch(() => {});
  extrasListeners.forEach((l) => l());
}

async function startExtras(room: Room, ctx: AudioContext) {
  const leveler = new VoiceLeveler(ctx);
  const spatial = new SpatialEngine(room, ctx, leveler);
  const ex: Extras = { room, spatial, leveler, recorder: null, ctx, offs: [] };
  extras = ex;

  // Position du jeu (Mumble Link) prioritaire sur la carte quand un jeu compatible tourne.
  let mapPose: Pose = spatial.me;
  ex.offs.push(
    onGameLink((g) => {
      if (g) {
        if (spatial.mySource === "map") mapPose = spatial.me;
        const yaw = Math.atan2(g.front[0], g.front[2]);
        spatial.setMyPose({ x: g.pos[0], y: g.pos[2], yaw }, "game", `${g.game}|${g.context}`, g.game);
      } else if (spatial.mySource === "game") {
        spatial.setMyPose(mapPose, "map");
      }
    }),
  );

  let clipsWanted = getSettings().clips.enabled;
  let clipLength = getSettings().clips.seconds;
  ex.offs.push(
    onSettingsChange((s) => {
      if (s.clips.enabled !== clipsWanted) {
        clipsWanted = s.clips.enabled;
        setClips(ex, clipsWanted);
      } else if (s.clips.seconds !== clipLength && clipsWanted) {
        // Nouvelle durée : on recrée le tampon (les secondes déjà gardées repartent de zéro)
        clipLength = s.clips.seconds;
        void setClips(ex, false).then(() => setClips(ex, true));
      }
    }),
  );
  await setClips(ex, clipsWanted);
}

async function stopExtras(room: Room) {
  const ex = extras;
  if (!ex || ex.room !== room) return;
  extras = null;
  ex.offs.forEach((f) => f());
  ex.spatial.dispose();
  ex.leveler.dispose();
  await ex.recorder?.stop();
  await ex.ctx.close().catch(() => {});
  extrasListeners.forEach((l) => l());
}

/** Connexion vocale générique (salon d'un serveur ou appel privé). */
export async function connectVoice(url: string, token: string, opts: { micEnabled: boolean }) {
  const devices = loadDevices();
  const audio = getSettings().audio;
  // Toutes les voix passent par ce contexte audio : c'est lui qui permet l'audio spatial.
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: { audioContext: ctx },
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
      void stopExtras(room);
    });

  await room.connect(url, token);
  activeRoom = room;
  await startExtras(room, ctx);

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
