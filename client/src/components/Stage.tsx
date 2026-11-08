import { useEffect, useReducer, useState, type ReactNode } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
} from "livekit-client";
import { loadDevices, saveDevices } from "../lib/prefs";
import { setParticipantVolume, volumeMemory } from "../lib/voice";
import { Avatar, Icon, NetworkBadge, SpeakingBars } from "./Brand";

const REFRESH_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ConnectionStateChanged,
  RoomEvent.ConnectionQualityChanged,
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
  /** Appel privé : pas d'audio spatial ni d'invitation. */
  isCall?: boolean;
  /** Chat du salon (affiché à droite quand il est ouvert). */
  chat?: ReactNode;
  chatUnread?: number;
  chatOpen?: boolean;
  onToggleChat?: () => void;
};

export default function Stage(props: Props) {
  const { room } = props;
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string>();

  useEffect(() => {
    REFRESH_EVENTS.forEach((ev) => room.on(ev, refresh));
    const loadDeviceList = async () => {
      setInputs(await Room.getLocalDevices("audioinput", false).catch(() => []));
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
    };
    loadDeviceList();
    room.on(RoomEvent.MediaDevicesChanged, loadDeviceList);
    return () => {
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

  const me = room.localParticipant;
  const participants: Participant[] = [me, ...room.remoteParticipants.values()];

  return (
    <section className={`stage${props.chatOpen && props.chat ? " with-chat" : ""}`}>
      <div className="stage-main">
      <header className="stage-header">
        <div className="col gap-4">
          <h1 className="title">{props.roomLabel}</h1>
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

      <div className="tiles">
        {participants.map((p) => {
          const isMe = p === me;
          const label = p.name || p.identity;
          const muted = !p.isMicrophoneEnabled;
          const guest = p.identity.startsWith("g:");
          const bot = p.identity.startsWith("bot:");
          return (
            <div key={p.identity} className={`tile${p.isSpeaking ? " speaking" : ""}`}>
              {muted && (
                <span className="tile-badge amber-badge">
                  <Icon name="micOff" size={13} /> Micro coupé
                </span>
              )}
              {guest && !muted && <span className="tile-badge">Invité</span>}
              {bot && !muted && <span className="tile-badge">Bot de test</span>}
              <Avatar name={label} size={92} speaking={p.isSpeaking} className="big" />
              <span className="tile-name">
                {label}
                {isMe && <span className="muted"> (toi)</span>}
                {p.isSpeaking && <SpeakingBars />}
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
          <button className="dock-btn wide" disabled title="Bientôt : garder les 60 dernières secondes" aria-label="Clip 60 secondes (bientôt)">
            <span className="amber">
              <Icon name="rewind" size={20} />
            </span>
            <span className="dock-label">Clip 60 s</span>
          </button>
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
