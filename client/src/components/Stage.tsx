import { useEffect, useReducer, useState, type ReactNode } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
} from "livekit-client";
import { getSettings, loadDevices, onSettingsChange, saveDevices, updateSettings } from "../lib/prefs";
import { getRecorder, getSpatial, onExtrasChange, setParticipantVolume, volumeMemory } from "../lib/voice";
import { Icon, NetworkBadge, SpeakingBars, UserAvatar } from "./Brand";
import { useSpeaking } from "../lib/speaking";
import MapView from "./MapView";
import ScreenView from "./ScreenView";
import { SCREEN_PRESETS, listShares, screenShareError, startScreenShare, stopScreenShare, type ScreenPresetId } from "../lib/screen";

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
  /** Enregistrer les 60 dernières secondes. */
  onClip?: () => void;
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
    <div className="popover share-menu" role="dialog" aria-label="Partager mon écran">
      <span className="section-title">Qualité du partage</span>
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
        Partager aussi le son du PC (jeu, vidéo…)
      </label>
      <button className="btn primary" onClick={() => onStart(preset, audio)}>
        <Icon name="screenShare" size={16} /> Choisir l'écran à partager
      </button>
    </div>
  );
}

export default function Stage(props: Props) {
  const { room } = props;
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string>();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  async function startShare(preset: ScreenPresetId, audio: boolean) {
    setShareOpen(false);
    updateSettings("screen", { preset, audio });
    setShareBusy(true);
    try {
      await startScreenShare(room, preset, audio);
    } catch (err) {
      const msg = screenShareError(err);
      if (msg) props.onNotice?.(msg);
    } finally {
      setShareBusy(false);
      refresh();
    }
  }

  async function stopShare() {
    await stopScreenShare(room).catch(() => {});
    refresh();
  }

  useEffect(() => {
    REFRESH_EVENTS.forEach((ev) => room.on(ev, refresh));
    const loadDeviceList = async () => {
      setInputs(await Room.getLocalDevices("audioinput", false).catch(() => []));
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
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
      setDeviceError("Impossible de changer de périphérique.");
    }
    refresh();
  }

  const speaking = useSpeaking(room);
  const me = room.localParticipant;
  const participants: Participant[] = [me, ...room.remoteParticipants.values()];
  const engine = getSpatial();
  const showMap = props.spatial && !props.isCall && !!engine && getSettings().spatial.showMap;
  const clipsReady = !!getRecorder();
  const shares = listShares(room);
  const sharing = me.isScreenShareEnabled;
  const screenPrefs = getSettings().screen;

  return (
    <section className={`stage${props.chatOpen && props.chat ? " with-chat" : ""}`}>
      <div className="stage-main">
      <header className="stage-header">
        <div className="col gap-4">
          <div className="row gap-8">
            {props.onBack && (
              <button className="icon-btn sm stage-back" onClick={props.onBack} aria-label="Retour" title="Retour">
                <Icon name="chevronLeft" size={18} />
              </button>
            )}
            <h1 className="title">{props.roomLabel}</h1>
          </div>
          <span className="muted small">
            {props.serverName} · {participants.length} participant{participants.length > 1 ? "s" : ""} ·{" "}
            {room.state === ConnectionState.Reconnecting ? <span className="amber">reconnexion…</span> : <NetworkBadge room={room} showLabel />}
          </span>
        </div>
        <div className="row gap-8">
          {props.chat && (
            <button
              className={`btn pill${props.chatOpen ? " active" : ""}`}
              onClick={props.onToggleChat}
              aria-pressed={!!props.chatOpen}
              aria-label="Chat du salon"
            >
              <Icon name="chat" size={16} /> <span className="pill-label">Chat</span>
              {!props.chatOpen && !!props.chatUnread && <span className="badge">{props.chatUnread}</span>}
            </button>
          )}
          {!props.isCall && (
          <button
            className={`btn pill${props.spatial ? " active" : ""}`}
            onClick={props.onToggleSpatial}
            disabled={!props.canToggleSpatial}
            aria-pressed={props.spatial}
            aria-label="Audio spatial"
            title={props.canToggleSpatial ? "Active ou coupe l'audio spatial pour tout le salon" : "Réservé aux membres"}
          >
            <Icon name="orbit" size={16} />
            <span className="pill-label">Audio spatial</span>
            <span className={`switch${props.spatial ? " on" : ""}`} aria-hidden="true">
              <span />
            </span>
          </button>
          )}
          {props.canInvite && (
            <button className="btn pill" onClick={props.onInvite} aria-label="Inviter">
              <Icon name="userPlus" size={16} /> <span className="pill-label">Inviter</span>
            </button>
          )}
        </div>
      </header>

      {props.warning && <p className="warning banner">{props.warning}</p>}

      {shares.length > 0 ? (
        <ScreenView room={room} shares={shares} onStopMine={stopShare} />
      ) : showMap && engine ? (
        <MapView room={room} engine={engine} />
      ) : (
      <div className="tiles">
        {props.spatial && !props.isCall && !getSettings().spatial.showMap && (
          <button className="link small tiles-map-link" onClick={() => updateSettings("spatial", { showMap: true })}>
            Afficher la carte de l'audio spatial
          </button>
        )}
        {participants.map((p) => {
          const isMe = p === me;
          const label = p.name || p.identity;
          const muted = !p.isMicrophoneEnabled;
          const guest = p.identity.startsWith("g:");
          const bot = p.identity.startsWith("bot:");
          const talking = speaking.has(p.identity);
          return (
            <div key={p.identity} className={`tile${talking ? " speaking" : ""}`}>
              {muted && (
                <span className="tile-badge amber-badge">
                  <Icon name="micOff" size={13} /> Micro coupé
                </span>
              )}
              {guest && !muted && <span className="tile-badge">Invité</span>}
              {bot && !muted && <span className="tile-badge">Bot de test</span>}
              {p.isScreenShareEnabled && (
                <span className="tile-share" title="Partage son écran">
                  <Icon name="screenShare" size={13} /> En direct
                </span>
              )}
              {p.attributes?.clips === "1" && (
                <span className="tile-clip" title="Clips activés : cette personne peut enregistrer les dernières secondes du salon">
                  <Icon name="rewind" size={12} label="Clips activés" />
                </span>
              )}
              {props.spatial && engine && !isMe && (
                <span className="tile-distance">{engine.isPlaced(p.identity) ? `${Math.round(engine.distanceTo(p.identity) ?? 0)} m` : (engine.unplacedReason(p.identity) ?? "")}</span>
              )}
              <button
                className="plain-btn"
                onClick={() => p.identity.startsWith("u:") && props.onOpenProfile?.(p.identity.slice(2))}
                aria-label={`Profil de ${label}`}
                disabled={!p.identity.startsWith("u:")}
              >
                <UserAvatar identity={p.identity} name={label} size={92} speaking={talking} className="big" />
              </button>
              <span className="tile-name">
                {label}
                {isMe && <span className="muted"> (toi)</span>}
                {talking && <SpeakingBars />}
              </span>
              {!isMe && (
                <label className="volume">
                  Volume
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
                    aria-label={`Volume de ${label}`}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* ---- Dock ---- */}
      <div className="dock-wrap">
        <div className="dock">
          <button
            className={`dock-btn${props.micOn ? " on" : " off"}`}
            onClick={props.onToggleMic}
            aria-label={props.micOn ? "Couper le micro" : "Activer le micro"}
            title={props.micOn ? "Couper le micro" : "Activer le micro"}
          >
            <Icon name={props.micOn ? "mic" : "micOff"} size={22} />
          </button>
          <button
            className={`dock-btn${props.deafened ? " off" : ""}`}
            onClick={props.onToggleDeafen}
            aria-label={props.deafened ? "Rétablir le son" : "Couper le son"}
            title={props.deafened ? "Rétablir le son" : "Couper le son"}
          >
            <Icon name={props.deafened ? "headphonesOff" : "headphones"} size={22} />
          </button>
          <button
            className="dock-btn wide"
            onClick={props.onClip}
            disabled={!clipsReady || !props.onClip}
            title={clipsReady ? `Enregistrer les ${getSettings().clips.seconds} dernières secondes (Ctrl+Maj+C)` : "Clips désactivés (Paramètres > Clips)"}
            aria-label={`Enregistrer les ${getSettings().clips.seconds} dernières secondes`}
          >
            <span className="amber">
              <Icon name="rewind" size={20} />
            </span>
            <span className="dock-label">Clip {getSettings().clips.seconds} s</span>
          </button>
          <div className="relative">
            <button
              className={`dock-btn${sharing ? " live" : ""}`}
              onClick={() => (sharing ? stopShare() : setShareOpen(!shareOpen))}
              disabled={shareBusy}
              aria-label={sharing ? "Arrêter le partage d'écran" : "Partager mon écran"}
              title={sharing ? "Arrêter le partage d'écran" : "Partager mon écran"}
              aria-expanded={shareOpen}
            >
              <Icon name="screenShare" size={22} />
            </button>
            {shareOpen && (
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
              aria-label="Micro et sortie audio"
              title="Micro et sortie audio"
              aria-expanded={devicesOpen}
            >
              <Icon name="sliders" size={22} />
            </button>
            {devicesOpen && (
              <>
                <div className="click-away" onClick={() => setDevicesOpen(false)} />
                <div className="popover devices">
                  <label className="field">
                    Micro
                    <select value={room.getActiveDevice("audioinput") ?? ""} onChange={(e) => switchDevice("audioinput", e.target.value)}>
                      {inputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Micro"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Sortie audio
                    <select value={room.getActiveDevice("audiooutput") ?? ""} onChange={(e) => switchDevice("audiooutput", e.target.value)}>
                      {outputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Haut-parleurs"}
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
          <button className="dock-btn wide leave" onClick={props.onLeave} aria-label={props.isCall ? "Raccrocher" : "Quitter le salon"}>
            <Icon name={props.isCall ? "phoneOff" : "leave"} size={20} />{" "}
            <span className="dock-label">{props.isCall ? "Raccrocher" : "Quitter"}</span>
          </button>
        </div>
      </div>
      </div>
      {props.chatOpen && props.chat && <aside className="stage-chat">{props.chat}</aside>}
    </section>
  );
}
