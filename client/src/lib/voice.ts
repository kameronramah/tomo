import { ConnectionQuality, Room, RoomEvent, Track, type LocalAudioTrack, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { onCameraSubscribed } from "./camera";
import type { Api } from "./api";
import { getSettings, loadDevices, onSettingsChange } from "./prefs";
import { SpatialEngine, type Pose } from "./spatial";
import { ClipRecorder } from "./clips";
import { VoiceLeveler } from "./leveler";
import { onGameLink } from "./gameLink";
import { currentGame, gamePrefs } from "./games";
import { publishMyLang } from "./captions";
import { applyMicProcessing, watchMicProcessing } from "./denoise";
import { t } from "./i18n";
import { watchPtt } from "./ptt";
import { speakingDetector } from "./speaking";

/** Volumes choisis par personne (par pseudo), gardés le temps de la session. */
export const volumeMemory = new Map<string, number>();
let deafened = false;
/** « Baisser les autres quand je parle » : facteur appliqué aux voix (1 = normal). */
let duck = 1;
let activeRoom: Room | null = null;

const volumeKey = (p: RemoteParticipant) => p.name || p.identity;

/** Volume du son des partages d'écran, par personne. */
export const screenVolumeMemory = new Map<string, number>();
/** Le partage d'écran que je regarde : on n'entend que le son de celui-là. */
let watchedShare: string | null = null;

function applyVolume(p: RemoteParticipant) {
  const master = getSettings().audio.outputVolume;
  p.setVolume(deafened ? 0 : (volumeMemory.get(volumeKey(p)) ?? 1) * master * duck);
  const screen = watchedShare === p.identity ? (screenVolumeMemory.get(volumeKey(p)) ?? 1) : 0;
  p.setVolume(deafened ? 0 : screen * master, Track.Source.ScreenShareAudio);
}

/** Choisir le partage regardé (null = aucun) : seul son son est joué. */
export function setWatchedShare(room: Room | null, identity: string | null) {
  watchedShare = identity;
  room?.remoteParticipants.forEach(applyVolume);
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
  ex.room.localParticipant.setAttributes({ ...ex.room.localParticipant.attributes, clips: ex.recorder ? "1" : "0" }).catch(() => {});
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
    onGameLink((raw) => {
      // Audio spatial coupé pour ce jeu (Paramètres › Jeux) : on reste sur la carte.
      const running = currentGame();
      const g = raw && !(running && !gamePrefs(running.id).spatial) ? raw : null;
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

  // Baisser les autres quand je parle (option) : le son des partages d'écran n'est pas touché.
  const me = room.localParticipant.identity;
  let restore: ReturnType<typeof setTimeout> | undefined;
  const setDuck = (v: number) => {
    if (v === duck) return;
    duck = v;
    room.remoteParticipants.forEach(applyVolume);
  };
  ex.offs.push(
    speakingDetector(room).onChange((set) => {
      const a = getSettings().audio;
      clearTimeout(restore);
      if (a.duck && set.has(me)) setDuck(1 - a.duckAmount);
      else restore = setTimeout(() => setDuck(1), 350); // retour en douceur après la phrase
    }),
    onSettingsChange((s) => {
      if (!s.audio.duck) setDuck(1);
      else if (duck !== 1) setDuck(1 - s.audio.duckAmount);
    }),
    () => {
      clearTimeout(restore);
      duck = 1;
    },
  );
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
    // Pas d'« adaptive stream » : il choisissait la qualité d'un partage d'écran d'après la taille
    // de la vidéo affichée (4K reçu en 360p dans une fenêtre normale). Partages d'écran : ScreenView
    // demande la meilleure qualité pour celui qu'on regarde et met les autres en pause. Caméras :
    // version 360p demandée à la réception (camera.ts). Le serveur baisse si la connexion ne suit pas.
    adaptiveStream: false,
    dynacast: true,
    webAudioMix: { audioContext: ctx },
    audioCaptureDefaults: {
      deviceId: devices.input,
      echoCancellation: audio.echoCancellation,
      noiseSuppression: audio.denoise === "light",
      autoGainControl: audio.autoGain,
    },
    audioOutput: devices.output ? { deviceId: devices.output } : undefined,
  });
  // Suppression de bruit avancée / porte de bruit : suit les réglages en direct.
  const stopWatch = watchMicProcessing(room);
  // Appuyer pour parler : la piste micro reste coupée tant que la touche n'est pas tenue.
  const stopPtt = watchPtt(room);
  const stopDevices = watchMicConstraints(room);

  room
    .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      // Un partage d'écran ne se télécharge que quand on le regarde (ScreenView le réactive).
      if (track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) pub.setEnabled(false);
      if (track.kind === Track.Kind.Video && pub.source === Track.Source.Camera) onCameraSubscribed(pub as RemoteTrackPublication);
      if (track.kind === Track.Kind.Audio) {
        audioContainer().appendChild(track.attach());
        applyVolume(participant);
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    })
    .on(RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.source === Track.Source.Microphone) void applyMicProcessing(room);
    })
    .on(RoomEvent.Disconnected, () => {
      stopWatch();
      stopPtt();
      stopDevices();
      if (activeRoom === room) activeRoom = null;
      watchedShare = null;
      void stopExtras(room);
    });

  await room.connect(url, token);
  activeRoom = room;
  measureEarlyPing(room);
  publishMyLang(room); // pour les sous-titres des autres (langue de transcription)
  await startExtras(room, ctx);

  let warning: string | undefined;
  if (opts.micEnabled) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      warning = t("Micro indisponible : tu peux écouter, mais pas parler. Vérifie l'autorisation du micro.");
    }
  }
  return { room, warning };
}

/**
 * Écho, volume auto du micro, filtre léger : s'appliquent tout de suite en vocal
 * (la piste micro est relancée avec les nouveaux réglages, en une fraction de seconde).
 */
function watchMicConstraints(room: Room) {
  const pick = () => {
    const a = getSettings().audio;
    return JSON.stringify([a.echoCancellation, a.autoGain, a.denoise === "light"]);
  };
  let prev = pick();
  return onSettingsChange(() => {
    const next = pick();
    if (next === prev) return;
    prev = next;
    const a = getSettings().audio;
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
    void track
      ?.restartTrack({
        deviceId: loadDevices().input,
        echoCancellation: a.echoCancellation,
        noiseSuppression: a.denoise === "light",
        autoGainControl: a.autoGain,
      })
      .catch(() => {});
  });
}

/** Changer de micro ou de sortie pendant un vocal (Paramètres › Audio). */
export async function switchDevice(kind: "audioinput" | "audiooutput", id: string | undefined) {
  if (!activeRoom) return;
  await activeRoom.switchActiveDevice(kind, id ?? "default").catch(() => {});
}

export async function joinRoom(api: Api, roomId: string, opts: { micEnabled: boolean }) {
  const { url, token } = await api.roomToken(roomId);
  return connectVoice(url, token, opts);
}

// ---------------------------------------------------------------------------
// Qualité réseau
// ---------------------------------------------------------------------------
export type NetworkInfo = { rtt: number | null; level: 0 | 1 | 2 | 3; label: string };

/** Ping lu dans les statistiques WebRTC, en attendant celui de LiveKit (qui arrive après ~5 s). */
const earlyRtt = new WeakMap<Room, number>();
const signalRtt = (room: Room) => (room as unknown as { engine?: { client?: { rtt?: number } } }).engine?.client?.rtt;

function measureEarlyPing(room: Room) {
  let tries = 0;
  const timer = setInterval(async () => {
    const raw = signalRtt(room);
    if ((typeof raw === "number" && raw > 0) || ++tries > 15 || room.state === "disconnected") return clearInterval(timer);
    const tracks = [room.localParticipant, ...room.remoteParticipants.values()].flatMap((p) => [...p.trackPublications.values()].map((pub) => pub.track));
    for (const track of tracks) {
      const report = await (track as { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> } | undefined)?.getRTCStatsReport?.().catch(() => undefined);
      let found: number | undefined;
      report?.forEach((s: { type?: string; state?: string; currentRoundTripTime?: number }) => {
        if (s.type === "candidate-pair" && s.state === "succeeded" && typeof s.currentRoundTripTime === "number") found = s.currentRoundTripTime * 1000;
      });
      if (found && found > 0) {
        earlyRtt.set(room, Math.round(found));
        break;
      }
    }
  }, 700);
}

/** Ping (aller-retour vers le serveur vocal) et qualité estimée par LiveKit. */
export function networkInfo(room: Room | null): NetworkInfo {
  if (!room) return { rtt: null, level: 0, label: t("hors ligne") };
  const raw = signalRtt(room);
  const rtt = typeof raw === "number" && raw > 0 ? Math.round(raw) : (earlyRtt.get(room) ?? null);
  const q = room.localParticipant.connectionQuality;
  let level: NetworkInfo["level"] =
    q === ConnectionQuality.Excellent ? 3 : q === ConnectionQuality.Good ? 2 : q === ConnectionQuality.Poor ? 1 : 0;
  // Si LiveKit n'a pas encore d'avis, on se base sur le ping.
  if (level === 0 && rtt !== null) level = rtt < 80 ? 3 : rtt < 180 ? 2 : 1;
  const label = level === 3 ? t("excellente") : level === 2 ? t("bonne") : level === 1 ? t("faible") : t("en cours…");
  return { rtt, level, label };
}
