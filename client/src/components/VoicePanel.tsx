import { useEffect, useReducer, useRef, useState } from "react";
import { Room, RoomEvent, ConnectionState, type Participant, type RemoteParticipant } from "livekit-client";
import { loadDevices, saveDevices } from "../lib/storage";

type Props = {
  room: Room;
  roomLabel: string;
  serverName: string;
  warning?: string;
  onLeave: () => void;
  onMicChange: (enabled: boolean) => void;
  /** Appelé si la connexion est coupée (par le serveur ou le réseau). */
  onDisconnected: (room: Room) => void;
};

/** Événements après lesquels on redessine la liste des participants. */
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
] as const;

/** Volumes par pseudo, gardés le temps de la session (survivent aux changements de salon). */
const volumeMemory = new Map<string, number>();

export default function VoicePanel(props: Props) {
  const { room, roomLabel, serverName, warning, onLeave } = props;
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string>();
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    REFRESH_EVENTS.forEach((ev) => room.on(ev, refresh));
    const onDisconnected = () => callbacks.current.onDisconnected(room);
    room.on(RoomEvent.Disconnected, onDisconnected);

    // Réapplique les volumes mémorisés aux nouveaux venus.
    const applyVolume = (p: RemoteParticipant) => {
      const v = volumeMemory.get(p.name || p.identity);
      if (v !== undefined) p.setVolume(v);
    };
    room.remoteParticipants.forEach(applyVolume);
    const onSubscribed = (_t: unknown, _pub: unknown, p: RemoteParticipant) => applyVolume(p);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);

    const loadDeviceList = async () => {
      setInputs(await Room.getLocalDevices("audioinput", false).catch(() => []));
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
    };
    loadDeviceList();
    room.on(RoomEvent.MediaDevicesChanged, loadDeviceList);

    return () => {
      REFRESH_EVENTS.forEach((ev) => room.off(ev, refresh));
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.MediaDevicesChanged, loadDeviceList);
    };
  }, [room]);

  const me = room.localParticipant;
  const micOn = me.isMicrophoneEnabled;
  const participants: Participant[] = [me, ...room.remoteParticipants.values()];

  async function toggleMic() {
    setError(undefined);
    try {
      await me.setMicrophoneEnabled(!micOn);
      callbacks.current.onMicChange(!micOn);
    } catch {
      setError("Impossible d'activer le micro. Vérifie l'autorisation du micro.");
    }
    refresh();
  }

  async function switchDevice(kind: "audioinput" | "audiooutput", id: string) {
    setError(undefined);
    try {
      await room.switchActiveDevice(kind, id);
      const saved = loadDevices();
      saveDevices(kind === "audioinput" ? { ...saved, input: id } : { ...saved, output: id });
    } catch {
      setError("Impossible de changer de périphérique.");
    }
    refresh();
  }

  function setVolume(p: RemoteParticipant, v: number) {
    p.setVolume(v);
    volumeMemory.set(p.name || p.identity, v);
    refresh();
  }

  const stateLabel =
    room.state === ConnectionState.Connected
      ? "Connecté"
      : room.state === ConnectionState.Reconnecting
        ? "Reconnexion…"
        : "Connexion…";

  return (
    <section className="voice">
      <header>
        <div>
          <h2>🔊 {roomLabel}</h2>
          <span className="muted small">{serverName}</span> · <span className={`status ${room.state}`}>{stateLabel}</span>
        </div>
        <button className="danger" onClick={onLeave}>
          Quitter le salon
        </button>
      </header>

      {warning && <p className="warning">{warning}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="participants">
        {participants.map((p) => {
          const isMe = p === me;
          const remote = p as RemoteParticipant;
          const label = p.name || p.identity;
          return (
            <li key={p.identity} className={p.isSpeaking ? "speaking" : ""}>
              <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
              <span className="name">
                {label}
                {isMe && <span className="muted"> (toi)</span>}
              </span>
              {!p.isMicrophoneEnabled && <span title="Micro coupé">🔇</span>}
              {!isMe && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volumeMemory.get(label) ?? 1}
                  onChange={(e) => setVolume(remote, Number(e.target.value))}
                  title="Volume"
                  aria-label={`Volume de ${label}`}
                />
              )}
            </li>
          );
        })}
      </ul>

      <footer className="card controls">
        <button onClick={toggleMic} className={micOn ? "" : "off"}>
          {micOn ? "🎙️ Micro actif" : "🔇 Micro coupé"}
        </button>
        <label>
          Micro
          <select value={room.getActiveDevice("audioinput") ?? ""} onChange={(e) => switchDevice("audioinput", e.target.value)}>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Micro"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sortie
          <select value={room.getActiveDevice("audiooutput") ?? ""} onChange={(e) => switchDevice("audiooutput", e.target.value)}>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Haut-parleurs"}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </section>
  );
}
