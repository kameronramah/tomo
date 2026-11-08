import { useEffect, useState } from "react";
import { getServerInfo, listRooms, type RoomInfo } from "../lib/voice";
import type { SavedServer } from "../lib/storage";

export type VoiceStatus = {
  serverId: string;
  serverName: string;
  roomId: string;
  roomLabel: string;
  /** Mon identité LiveKit, pour m'afficher tout de suite dans le bon salon. */
  identity: string;
};

type Props = {
  server?: SavedServer;
  voice?: VoiceStatus;
  joiningRoomId?: string;
  profileName: string;
  onJoin: (room: RoomInfo) => void;
  onLeaveVoice: () => void;
  onRenameServer: (id: string, name: string) => void;
  onRemoveServer: (id: string) => void;
  onEditProfile: () => void;
};

const POLL_MS = 3000;

/** Colonne des salons du serveur sélectionné + barre de statut en bas. */
export default function ChannelSidebar(props: Props) {
  const { server, voice, joiningRoomId, profileName } = props;
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [error, setError] = useState<string>();

  // Liste des salons et de leurs occupants, rafraîchie régulièrement.
  useEffect(() => {
    if (!server) return;
    let alive = true;
    setRooms(null);
    setError(undefined);
    const load = async () => {
      try {
        const r = await listRooms(server);
        if (alive) {
          setRooms(r);
          setError(undefined);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // On recharge aussi tout de suite quand on change de salon.
  }, [server?.id, server?.apiUrl, server?.invite, voice?.roomId, voice?.serverId]);

  // Met à jour le nom du serveur s'il a changé côté serveur.
  useEffect(() => {
    if (!server) return;
    getServerInfo(server)
      .then((info) => info.name !== server.name && props.onRenameServer(server.id, info.name))
      .catch(() => {});
  }, [server?.id]);

  return (
    <aside className="sidebar">
      {server ? (
        <>
          <header className="sidebar-header">
            <h3 title={server.name}>{server.name}</h3>
            <button
              className="icon-btn"
              title="Quitter ce serveur"
              aria-label="Quitter ce serveur"
              onClick={() => {
                if (confirm(`Quitter le serveur « ${server.name} » ? Tu pourras le rejoindre à nouveau avec son code d'invitation.`))
                  props.onRemoveServer(server.id);
              }}
            >
              🚪
            </button>
          </header>

          <div className="channels">
            <p className="section-title">Salons vocaux</p>
            {error && <p className="error small">{error}</p>}
            {!rooms && !error && <p className="muted small">Chargement…</p>}
            {rooms?.map((room) => {
              const isCurrent = voice?.serverId === server.id && voice.roomId === room.id;
              // Sans attendre le prochain rafraîchissement : je suis dans le salon actuel, et nulle part ailleurs.
              const others = room.participants.filter((p) => p.identity !== voice?.identity);
              const participants =
                isCurrent && voice ? [{ identity: voice.identity, name: profileName }, ...others] : others;
              return (
                <div key={room.id} className="channel-block">
                  <button
                    className={`channel${isCurrent ? " current" : ""}`}
                    onClick={() => props.onJoin(room)}
                    disabled={joiningRoomId === room.id}
                    title={isCurrent ? "Tu es dans ce salon" : `Rejoindre ${room.label}`}
                  >
                    <span className="channel-icon">🔊</span>
                    <span className="channel-name">{room.label}</span>
                    {joiningRoomId === room.id && <span className="muted small">…</span>}
                  </button>
                  {participants.length > 0 && (
                    <ul className="occupants">
                      {participants.map((p) => (
                        <li key={p.identity}>
                          <span className="mini-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="channels">
          <p className="muted small">Rejoins un serveur avec le bouton « + » à gauche.</p>
        </div>
      )}

      {voice && (
        <div className="voice-status">
          <div>
            <span className="ok small">● Connecté en vocal</span>
            <div className="small muted ellipsis">
              {voice.roomLabel} / {voice.serverName}
            </div>
          </div>
          <button className="icon-btn danger" title="Quitter le vocal" aria-label="Quitter le vocal" onClick={props.onLeaveVoice}>
            📞
          </button>
        </div>
      )}

      <div className="user-bar">
        <span className="mini-avatar">{profileName.slice(0, 1).toUpperCase()}</span>
        <span className="ellipsis">{profileName}</span>
        <button className="icon-btn" title="Changer de pseudo" aria-label="Changer de pseudo" onClick={props.onEditProfile}>
          ✏️
        </button>
      </div>
    </aside>
  );
}
