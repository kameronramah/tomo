import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
  type VideoTrack,
} from "livekit-client";
import { getSettings, loadDevices, onSettingsChange, saveDevices, updateSettings } from "../lib/prefs";
import { getRecorder, getSpatial, onExtrasChange, setParticipantVolume, setWatchedShare, volumeMemory } from "../lib/voice";
import { Icon, NetworkBadge, SpeakingBars, UserAvatar } from "./Brand";
import { useSpeaking } from "../lib/speaking";
import MapView from "./MapView";
import ScreenView from "./ScreenView";
import ShareStrip from "./ShareStrip";
import SharePicker from "./SharePicker";
import { nativeCaptureAvailable } from "../lib/nativeCapture";
import {
  SCREEN_PRESETS,
  listShares,
  screenShareError,
  setWatching,
  startScreenShare,
  stopScreenShare,
  switchScreenSource,
  watchingOf,
  type ScreenPresetId,
} from "../lib/screen";
import { t } from "../lib/i18n";
import { getCaptions, onCaptions, startCaptions, stopCaptions } from "../lib/captions";
import CaptionsBar from "./CaptionsBar";
import { usePtt } from "../lib/ptt";
import { formatShortcut, shortcutHint, shortcutOf } from "../lib/hotkeys";
import { CoachRequests } from "./CoachLayer";
import { cameraError, cameraOf, startCamera, stopCamera, switchCamera } from "../lib/camera";

/** Image d'une caméra dans une bulle (la mienne en miroir, comme dans une glace). */
function CamVideo({ track, mirror }: { track: VideoTrack; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => void track.detach(el);
  }, [track]);
  return <video ref={ref} className={`tile-cam${mirror ? " mirror" : ""}`} autoPlay playsInline muted />;
}

const REFRESH_EVENTS = [
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ConnectionStateChanged,
  RoomEvent.ConnectionQualityChanged,
  RoomEvent.ParticipantAttributesChanged,
] as const;

type Props = {
  room: Room;
  roomLabel: string;
  serverName: string;
  spatial: boolean;
  warning?: string;
  micOn: boolean;
  deafened: boolean;
  canToggleSpatial: boolean;
  canInvite: boolean;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleSpatial: () => void;
  onInvite: () => void;
  onLeave: () => void;
  /** Revenir à l'accueil du serveur (sans quitter le vocal). */
  onBack?: () => void;
  /** Clic sur une bulle : fiche profil de la personne */
  onOpenProfile?: (userId: string) => void;
  /** Appel privé : pas d'audio spatial ni d'invitation. */
  isCall?: boolean;
  /** Chat du salon (affiché à droite quand il est ouvert). */
  chat?: ReactNode;
  chatUnread?: number;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  /** Bloc « Membres » du serveur (affiché à droite par App). */
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  /** Enregistrer les 60 dernières secondes. */
  onClip?: () => void;
  /** Mode coach : image annotée à envoyer dans le chat de la pièce */
  onCapture?: (png: Blob) => void;
  /** Message à afficher (ex. erreur de partage d'écran). */
  onNotice?: (text: string) => void;
};

/** Choix de la qualité avant de partager son écran. */
function ShareMenu({
  initialPreset,
  initialAudio,
  onStart,
}: {
  initialPreset: ScreenPresetId;
  initialAudio: boolean;
  onStart: (preset: ScreenPresetId, audio: boolean) => void;
}) {
  const [preset, setPreset] = useState<ScreenPresetId>(initialPreset);
  const [audio, setAudio] = useState(initialAudio);
  return (
    <div className="popover share-menu" role="dialog" aria-label={t("Partager mon écran")}>
      <span className="section-title">{t("Qualité du partage")}</span>
      {SCREEN_PRESETS.map((p) => (
        <label key={p.id} className={`share-option${preset === p.id ? " on" : ""}`}>
          <input type="radio" name="screen-preset" checked={preset === p.id} onChange={() => setPreset(p.id)} />
          <span className="col gap-2 grow">
            <strong>{p.label}</strong>
            <span className="muted small">{p.detail}</span>
          </span>
        </label>
      ))}
      <label className="check small share-audio">
        <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
        {t("Partager aussi le son du PC (jeu, vidéo…)")}
      </label>
      <button className="btn primary" onClick={() => onStart(preset, audio)}>
        <Icon name="screenShare" size={16} /> {t("Choisir l'écran à partager")}
      </button>
    </div>
  );
}

export default function Stage(props: Props) {
  const { room } = props;
  const ptt = usePtt();
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string>();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camBusy, setCamBusy] = useState(false);

  async function toggleCamera() {
    setCamBusy(true);
    try {
      if (room.localParticipant.isCameraEnabled) await stopCamera(room);
      else await startCamera(room);
    } catch (err) {
      props.onNotice?.(cameraError(err));
    } finally {
      setCamBusy(false);
      refresh();
      // Les noms des caméras ne sont donnés qu'après l'autorisation : on relit la liste.
      setCameras(await Room.getLocalDevices("videoinput", false).catch(() => []));
    }
  }

  async function startShare(preset: ScreenPresetId, audio: boolean, sourceId?: string) {
    setShareOpen(false);
    updateSettings("screen", { preset, audio });
    setShareBusy(true);
    try {
      await startScreenShare(room, preset, audio, sourceId);
    } catch (err) {
      const msg = screenShareError(err);
      if (msg) props.onNotice?.(msg);
    } finally {
      setShareBusy(false);
      refresh();
    }
  }

  /** Changer d'écran / de fenêtre sans couper le partage. */
  async function switchShare(preset: ScreenPresetId, audio: boolean, sourceId?: string) {
    setShareOpen(false);
    setSwitchOpen(false);
    updateSettings("screen", { preset, audio });
    setShareBusy(true);
    try {
      await switchScreenSource(room, preset, audio, sourceId);
    } catch (err) {
      const msg = screenShareError(err);
      if (msg) props.onNotice?.(msg);
    } finally {
      setShareBusy(false);
      refresh();
    }
  }

  /** Bouton « Changer d'écran » : sélecteur de Tomo (appli Windows) ou fenêtre du système. */
  function askSwitch() {
    setShareOpen(false);
    if (nativeCaptureAvailable()) setSwitchOpen(true);
    else {
      const { preset, audio } = getSettings().screen;
      void switchShare(preset, audio);
    }
  }

  async function stopShare() {
    setShareOpen(false);
    await stopScreenShare(room).catch(() => {});
    refresh();
  }

  useEffect(() => {
    REFRESH_EVENTS.forEach((ev) => room.on(ev, refresh));
    const loadDeviceList = async () => {
      setInputs(await Room.getLocalDevices("audioinput", false).catch(() => []));
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
      setCameras(await Room.getLocalDevices("videoinput", false).catch(() => []));
    };
    loadDeviceList();
    room.on(RoomEvent.MediaDevicesChanged, loadDeviceList);
    const offExtras = onExtrasChange(refresh);
    const offSettings = onSettingsChange(refresh);
    return () => {
      offExtras();
      offSettings();
      REFRESH_EVENTS.forEach((ev) => room.off(ev, refresh));
      room.off(RoomEvent.MediaDevicesChanged, loadDeviceList);
    };
  }, [room]);

  async function switchDevice(kind: "audioinput" | "audiooutput", id: string) {
    setDeviceError(undefined);
    try {
      await room.switchActiveDevice(kind, id);
      const saved = loadDevices();
      saveDevices(kind === "audioinput" ? { ...saved, input: id } : { ...saved, output: id });
    } catch {
      setDeviceError(t("Impossible de changer de périphérique."));
    }
    refresh();
  }

  // Sous-titres : actifs tant qu'on reste dans cette pièce
  const [captionsOn, setCaptionsOn] = useState(!!getCaptions());
  useEffect(() => onCaptions(() => setCaptionsOn(!!getCaptions())), []);
  useEffect(() => () => stopCaptions(), [room]);

  const speaking = useSpeaking(room);
  const me = room.localParticipant;
  const participants: Participant[] = [me, ...room.remoteParticipants.values()];
  const engine = getSpatial();
  const showMap = props.spatial && !props.isCall && !!engine && getSettings().spatial.showMap;
  const clipsReady = !!getRecorder();
  const shares = listShares(room);
  const sharing = me.isScreenShareEnabled;
  const screenPrefs = getSettings().screen;

  // Partage regardé : rien ne s'ouvre tout seul, on choisit dans la bande « Écrans partagés ».
  const [watching, setWatchingId] = useState<string | null>(null);
  const watched = watching ? shares.find((s) => s.participant.identity === watching) : undefined;
  const watchedId = watched?.participant.identity ?? null;
  const watchedName = useRef("");
  if (watched) watchedName.current = watched.participant.name || watched.participant.identity;
  // Le partage regardé s'arrête : retour aux bulles, avec un petit mot.
  useEffect(() => {
    if (watching && !watched) {
      if (watching !== me.identity && watchedName.current) props.onNotice?.(t("{0} a arrêté de partager son écran.", { 0: watchedName.current }));
      setWatchingId(null);
    }
  }, [watching, watched]);
  // Les autres voient ce que je regarde ; seul le son de ce partage est joué.
  useEffect(() => {
    setWatching(room, watchedId);
    setWatchedShare(room, watchedId);
  }, [room, watchedId]);
  useEffect(
    () => () => {
      setWatchedShare(room, null);
      if (room.state === ConnectionState.Connected) setWatching(room, null);
    },
    [room],
  );

  // Quelqu'un lance un partage : petite carte « Regarder » pendant 8 s (sans rien ouvrir).
  const [newShare, setNewShare] = useState<string | null>(null);
  const knownShares = useRef<Set<string> | null>(null);
  const shareKey = shares.map((s) => s.participant.identity).join(",");
  useEffect(() => {
    const ids = new Set(shares.filter((s) => !s.isLocal).map((s) => s.participant.identity));
    const before = knownShares.current;
    knownShares.current = ids;
    if (!before) return; // partages déjà en cours quand j'arrive : seulement dans la bande
    const fresh = [...ids].find((id) => !before.has(id));
    if (fresh) setNewShare(fresh);
    else if (newShare && !ids.has(newShare)) setNewShare(null);
  }, [shareKey]);
  useEffect(() => {
    if (!newShare) return;
    const timer = setTimeout(() => setNewShare(null), 8000);
    return () => clearTimeout(timer);
  }, [newShare]);
  const toastShare = newShare && newShare !== watchedId ? shares.find((s) => s.participant.identity === newShare) : undefined;

  function watch(identity: string) {
    setWatchingId(identity);
    setNewShare(null);
  }

  return (
    <section className={`stage${props.chatOpen && props.chat ? " with-chat" : ""}`}>
      <div className="stage-main">
      <header className="stage-header">
        <div className="col gap-4">
          <div className="row gap-8">
            {props.onBack && (
              <button className="icon-btn sm stage-back" onClick={props.onBack} aria-label={t("Retour")} title={t("Retour")}>
                <Icon name="chevronLeft" size={18} />
              </button>
            )}
            <h1 className="title">{props.roomLabel}</h1>
          </div>
          <span className="muted small">
            {props.serverName} · {participants.length} {t("participant")}{participants.length > 1 ? "s" : ""} ·{" "}
            {room.state === ConnectionState.Reconnecting ? <span className="amber">{t("reconnexion…")}</span> : <NetworkBadge room={room} showLabel />}
          </span>
        </div>
        <div className="row gap-8">
          {props.chat && (
            <button
              className={`btn pill${props.chatOpen ? " active" : ""}`}
              onClick={props.onToggleChat}
              aria-pressed={!!props.chatOpen}
              aria-label={t("Chat du salon")}
            >
              <Icon name="chat" size={16} /> <span className="pill-label">{t("Chat")}</span>
              {!props.chatOpen && !!props.chatUnread && <span className="badge">{props.chatUnread}</span>}
            </button>
          )}
          {props.onToggleMembers && (
            <button
              className={`btn pill${props.membersOpen ? " active" : ""}`}
              onClick={props.onToggleMembers}
              aria-pressed={!!props.membersOpen}
              aria-label={t("Membres")}
              title={props.membersOpen ? t("Masquer les membres") : t("Afficher les membres")}
            >
              <Icon name="users" size={16} /> <span className="pill-label">{t("Membres")}</span>
            </button>
          )}
          {!props.isCall && (
          <button
            className={`btn pill${props.spatial ? " active" : ""}`}
            onClick={props.onToggleSpatial}
            disabled={!props.canToggleSpatial}
            aria-pressed={props.spatial}
            aria-label={t("Audio spatial")}
            title={props.canToggleSpatial ? t("Active ou coupe l'audio spatial pour tout le salon") : t("Réservé aux membres")}
          >
            <Icon name="orbit" size={16} />
            <span className="pill-label">{t("Audio spatial")}</span>
            <span className={`switch${props.spatial ? " on" : ""}`} aria-hidden="true">
              <span />
            </span>
          </button>
          )}
          <button
            className={`btn pill${captionsOn ? " active" : ""}`}
            onClick={() => (captionsOn ? stopCaptions() : startCaptions(room))}
            aria-pressed={captionsOn}
            aria-label={t("Sous-titres")}
            title={t("Sous-titres en direct, calculés sur ton PC")}
          >
            <Icon name="captions" size={16} /> <span className="pill-label">{t("Sous-titres")}</span>
          </button>
          {props.canInvite && (
            <button className="btn pill" onClick={props.onInvite} aria-label={t("Inviter")}>
              <Icon name="userPlus" size={16} /> <span className="pill-label">{t("Inviter")}</span>
            </button>
          )}
        </div>
      </header>

      {props.warning && <p className="warning banner">{props.warning}</p>}
      <CoachRequests room={room} />

      {toastShare && (
        <div className="share-toast" role="status">
          <div className="row gap-10">
            <UserAvatar identity={toastShare.participant.identity} name={toastShare.participant.name || toastShare.participant.identity} size={32} />
            <span className="col grow">
              <strong>{t("{0} partage son écran", { 0: toastShare.participant.name || toastShare.participant.identity })}</strong>
              <span className="muted small">{props.roomLabel}</span>
            </span>
          </div>
          <div className="row gap-8 share-toast-actions">
            <button className="btn pill small" onClick={() => setNewShare(null)}>
              {t("Plus tard")}
            </button>
            <button className="btn pill small primary" onClick={() => watch(toastShare.participant.identity)}>
              <Icon name="eye" size={15} /> {t("Regarder")}
            </button>
          </div>
        </div>
      )}

      {watched ? (
        <ScreenView
          room={room}
          shares={shares}
          selected={watched.participant.identity}
          onSelect={watch}
          onClose={() => setWatchingId(null)}
          onStopMine={stopShare}
          onSwitchMine={askSwitch}
          onCapture={props.onCapture}
        />
      ) : (
      <>
      <ShareStrip room={room} shares={shares} onWatch={watch} onStopMine={stopShare} onSwitchMine={askSwitch} />
      {showMap && engine ? (
        <MapView room={room} engine={engine} />
      ) : (
      <div className="tiles">
        {props.spatial && !props.isCall && !getSettings().spatial.showMap && (
          <button className="link small tiles-map-link" onClick={() => updateSettings("spatial", { showMap: true })}>
            {t("Afficher la carte de l'audio spatial")}
          </button>
        )}
        {participants.map((p) => {
          const isMe = p === me;
          const label = p.name || p.identity;
          const muted = !p.isMicrophoneEnabled;
          const guest = p.identity.startsWith("g:");
          const bot = p.identity.startsWith("bot:");
          const talking = speaking.has(p.identity);
          const cam = cameraOf(p);
          return (
            <div key={p.identity} className={`tile${talking ? " speaking" : ""}${cam ? " has-cam" : ""}`}>
              {muted && (
                <span className="tile-badge amber-badge">
                  <Icon name="micOff" size={13} /> {t("Micro coupé")}
                </span>
              )}
              {guest && !muted && <span className="tile-badge">{t("Invité")}</span>}
              {bot && !muted && <span className="tile-badge">{t("Bot de test")}</span>}
              {p.attributes?.cc === "1" && (
                <span className="tile-cc" title={t("Sous-titres activés chez cette personne")}>
                  CC
                </span>
              )}
              {p.attributes?.clips === "1" && (
                <span className="tile-clip" title={t("Clips activés : cette personne peut enregistrer les dernières secondes du salon")}>
                  <Icon name="rewind" size={12} label={t("Clips activés")} />
                </span>
              )}
              {props.spatial && engine && !isMe && (
                <span className="tile-distance">{engine.isPlaced(p.identity) ? `${Math.round(engine.distanceTo(p.identity) ?? 0)} m` : (engine.unplacedReason(p.identity) ?? "")}</span>
              )}
              <button
                className="plain-btn"
                onClick={() => p.identity.startsWith("u:") && props.onOpenProfile?.(p.identity.slice(2))}
                aria-label={t("Profil de {0}", { 0: label })}
                disabled={!p.identity.startsWith("u:")}
              >
                {cam ? (
                  <CamVideo track={cam} mirror={isMe} />
                ) : (
                  <UserAvatar identity={p.identity} name={label} size={92} speaking={talking} className="big" />
                )}
              </button>
              <span className="tile-name">
                {label}
                {isMe && <span className="muted"> {t("(toi)")}</span>}
                {talking && <SpeakingBars />}
              </span>
              {p.isScreenShareEnabled && (
                <button
                  className="tile-share"
                  onClick={() => watch(p.identity)}
                  title={isMe ? t("Voir ce que voient tes potes") : t("Regarder l'écran de {0}", { 0: label })}
                >
                  <Icon name="screenShare" size={13} /> {t("En direct")}
                </button>
              )}
              {(() => {
                const target = watchingOf(p);
                const sharer = target ? participants.find((x) => x.identity === target) : undefined;
                if (!sharer) return null;
                return (
                  <span className="tile-watch">
                    <Icon name="eye" size={12} /> {sharer === me ? t("regarde ton écran") : t("regarde {0}", { 0: sharer.name || sharer.identity })}
                  </span>
                );
              })()}
              {!isMe && (
                <label className="volume">
                  {t("Volume")}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumeMemory.get(label) ?? 1}
                    onChange={(e) => {
                      setParticipantVolume(p as RemoteParticipant, Number(e.target.value));
                      refresh();
                    }}
                    aria-label={t("Volume de {0}", { 0: label })}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      )}
      </>
      )}

      <CaptionsBar />

      {/* ---- Dock ---- */}
      <div className="dock-wrap">
        <div className="dock">
          <button
            className={`dock-btn${props.micOn ? (ptt.ptt && !ptt.open ? " ptt-idle" : " on") : " off"}`}
            onClick={props.onToggleMic}
            aria-label={props.micOn ? t("Couper le micro") : t("Activer le micro")}
            title={(props.micOn ? t("Couper le micro") : t("Activer le micro")) + shortcutHint("mute")}
          >
            <Icon name={props.micOn ? "mic" : "micOff"} size={22} />
          </button>
          {ptt.ptt && props.micOn && (
            <span className={`ptt-hint${ptt.open ? " open" : ""}`} aria-live="polite">
              <strong>{ptt.open ? t("On t'entend") : shortcutOf("ptt") ? t("Appuie sur {0}", { 0: formatShortcut(shortcutOf("ptt")) }) : t("Aucune touche choisie")}</strong>
              <span>{ptt.open ? t("touche tenue") : shortcutOf("ptt") ? t("pour parler") : t("Paramètres › Raccourcis")}</span>
            </span>
          )}
          <button
            className={`dock-btn${props.deafened ? " off" : ""}`}
            onClick={props.onToggleDeafen}
            aria-label={props.deafened ? t("Rétablir le son") : t("Couper le son")}
            title={(props.deafened ? t("Rétablir le son") : t("Couper le son")) + shortcutHint("deafen")}
          >
            <Icon name={props.deafened ? "headphonesOff" : "headphones"} size={22} />
          </button>
          <button
            className={`dock-btn${me.isCameraEnabled ? " cam-on" : ""}`}
            onClick={toggleCamera}
            disabled={camBusy}
            aria-pressed={me.isCameraEnabled}
            aria-label={me.isCameraEnabled ? t("Couper la caméra") : t("Allumer la caméra")}
            title={me.isCameraEnabled ? t("Couper la caméra") : t("Allumer la caméra")}
          >
            <Icon name={me.isCameraEnabled ? "camera" : "cameraOff"} size={22} />
          </button>
          <button
            className="dock-btn wide"
            onClick={props.onClip}
            disabled={!clipsReady || !props.onClip}
            title={clipsReady ? t("Enregistrer les {0} dernières secondes", { 0: getSettings().clips.seconds }) + shortcutHint("clip") : t("Clips désactivés (Paramètres > Clips)")}
            aria-label={t("Enregistrer les {0} dernières secondes", { 0: getSettings().clips.seconds })}
          >
            <span className="amber">
              <Icon name="rewind" size={20} />
            </span>
            <span className="dock-label">{t("Clip")} {getSettings().clips.seconds} {t("s")}</span>
          </button>
          <div className="relative">
            <button
              className={`dock-btn${sharing ? " live" : ""}`}
              onClick={() => setShareOpen(!shareOpen)}
              disabled={shareBusy}
              aria-label={sharing ? t("Mon partage d'écran") : t("Partager mon écran")}
              title={sharing ? t("Mon partage d'écran") : t("Partager mon écran")}
              aria-expanded={shareOpen}
            >
              <Icon name="screenShare" size={22} />
            </button>
            {shareOpen && sharing && (
              <>
                <div className="click-away" onClick={() => setShareOpen(false)} />
                <div className="popover share-menu" role="dialog" aria-label={t("Mon partage d'écran")}>
                  <button className="btn primary" onClick={askSwitch}>
                    <Icon name="screenShare" size={16} /> {t("Changer d'écran ou de fenêtre")}
                  </button>
                  <button className="btn danger" onClick={stopShare}>
                    {t("Arrêter le partage")}
                  </button>
                </div>
              </>
            )}
            {switchOpen && sharing && (
              <SharePicker
                initialPreset={screenPrefs.preset}
                initialAudio={screenPrefs.audio}
                onStart={switchShare}
                onClose={() => setSwitchOpen(false)}
              />
            )}
            {shareOpen && !sharing && nativeCaptureAvailable() && (
              <SharePicker
                initialPreset={screenPrefs.preset}
                initialAudio={screenPrefs.audio}
                onStart={startShare}
                onClose={() => setShareOpen(false)}
              />
            )}
            {shareOpen && !sharing && !nativeCaptureAvailable() && (
              <>
                <div className="click-away" onClick={() => setShareOpen(false)} />
                <ShareMenu
                  initialPreset={screenPrefs.preset}
                  initialAudio={screenPrefs.audio}
                  onStart={startShare}
                />
              </>
            )}
          </div>
          <div className="relative">
            <button
              className="dock-btn"
              onClick={() => setDevicesOpen(!devicesOpen)}
              aria-label={t("Micro, caméra et sortie audio")}
              title={t("Micro, caméra et sortie audio")}
              aria-expanded={devicesOpen}
            >
              <Icon name="sliders" size={22} />
            </button>
            {devicesOpen && (
              <>
                <div className="click-away" onClick={() => setDevicesOpen(false)} />
                <div className="popover devices">
                  <label className="field">
                    {t("Micro")}
                    <select value={room.getActiveDevice("audioinput") ?? ""} onChange={(e) => switchDevice("audioinput", e.target.value)}>
                      {inputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || t("Micro")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {t("Sortie audio")}
                    <select value={room.getActiveDevice("audiooutput") ?? ""} onChange={(e) => switchDevice("audiooutput", e.target.value)}>
                      {outputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || t("Haut-parleurs")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {t("Caméra")}
                    <select
                      value={room.getActiveDevice("videoinput") ?? loadDevices().camera ?? ""}
                      onChange={(e) => {
                        setDeviceError(undefined);
                        switchCamera(room, e.target.value)
                          .catch(() => setDeviceError(t("Impossible de changer de périphérique.")))
                          .finally(refresh);
                      }}
                      disabled={!cameras.length}
                    >
                      {!cameras.length && <option value="">{t("Aucune caméra trouvée.")}</option>}
                      {cameras.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || t("Caméra")}
                        </option>
                      ))}
                    </select>
                  </label>
                  {deviceError && <p className="error small">{deviceError}</p>}
                </div>
              </>
            )}
          </div>
          <span className="dock-sep" />
          <button className="dock-btn wide leave" onClick={props.onLeave} aria-label={props.isCall ? t("Raccrocher") : t("Quitter le salon")} title={props.isCall ? t("Raccrocher") : t("Quitter le salon")}>
            <Icon name="hangup" size={22} />
          </button>
        </div>
      </div>
      </div>
      {props.chatOpen && props.chat && (
        <aside className="stage-chat">
          {props.chat}
          {/* Visible seulement quand le chat recouvre le vocal (fenêtre très étroite) */}
          <button className="icon-btn sm stage-chat-close" onClick={props.onToggleChat} aria-label={t("Fermer le chat")} title={t("Fermer le chat")}>
            <Icon name="x" size={16} />
          </button>
        </aside>
      )}
    </section>
  );
}
