import { useEffect, useReducer, useRef, useState } from "react";
import { Room, RoomEvent, ConnectionState, type Participant, type RemoteParticipant } from "livekit-client";

type Props = { room: Room; warning?: string; onLeave: () => void };

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

export default function RoomView({ room, warning, onLeave }: Props) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string>();
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    REFRESH_EVENTS.forEach((ev) => room.on(ev, refresh));
    const onDisconnected = () => onLeaveRef.current();
    room.on(RoomEvent.Disconnected, onDisconnected);

    const loadDevices = async () => {
      setInputs(await Room.getLocalDevices("audioinput", false).catch(() => []));
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
    };
    loadDevices();
    room.on(RoomEvent.MediaDevicesChanged, loadDevices);

    return () => {
      REFRESH_EVENTS.forEach((ev) => room.off(ev, refresh));
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.MediaDevicesChanged, loadDevices);
    };
  }, [room]);

  const me = room.localParticipant;
  const micOn = me.isMicrophoneEnabled;
  const participants: Participant[] = [me, ...room.remoteParticipants.values()];

  async function toggleMic() {
    setError(undefined);
    try {
      await me.setMicrophoneEnabled(!micOn);
    } catch {
      setError("Impossible d'activer le micro.");
    }
    refresh();
  }

  async function switchDevice(kind: MediaDeviceKind, id: string) {
    setError(undefined);
    try {
      await room.switchActiveDevice(kind, id);
    } catch {
      setError("Impossible de changer de périphérique.");
    }
    refresh();
  }

  function setVolume(p: RemoteParticipant, v: number) {
    p.setVolume(v);
    setVolumes({ ...volumes, [p.identity]: v });
  }

  return (
    <main className="room">
      <header>
        <div>
          <h2># {room.name}</h2>
          <span className={`status ${room.state}`}>
            {room.state === ConnectionState.Connected ? "Connecté" : room.state === ConnectionState.Reconnecting ? "Reconnexion…" : room.state}
          </span>
        </div>
        <button className="danger" onClick={onLeave}>
          Quitter
        </button>
      </header>

      {warning && <p className="warning">{warning}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="participants">
        {participants.map((p) => {
          const isMe = p === me;
          const remote = p as RemoteParticipant;
          return (
            <li key={p.identity} className={p.isSpeaking ? "speaking" : ""}>
              <span className="avatar">{(p.name || p.identity).slice(0, 1).toUpperCase()}</span>
              <span className="name">
                {p.name || p.identity}
                {isMe && <span className="muted"> (toi)</span>}
              </span>
              {!p.isMicrophoneEnabled && <span title="Micro coupé">🔇</span>}
              {!isMe && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volumes[p.identity] ?? 1}
                  onChange={(e) => setVolume(remote, Number(e.target.value))}
                  title="Volume"
                  aria-label={`Volume de ${p.name || p.identity}`}
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
    </main>
  );
}
