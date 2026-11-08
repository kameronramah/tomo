import { useState } from "react";
import type { RoomInfo, ServerDetail, ServerSummary, Session } from "../lib/api";
import { formatExpiry } from "../lib/ui";
import { Avatar, Icon, Logo, ServerBadge, Wordmark } from "./Brand";

export type VoiceInfo = {
  serverId: string;
  serverName: string;
  roomId: string;
  roomLabel: string;
  identity: string;
  speaking: Set<string>;
};

type Props = {
  session: Session;
  displayName: string;
  servers: ServerSummary[];
  active?: ServerSummary;
  detail: ServerDetail | null;
  voice: VoiceInfo | null;
  joiningRoomId?: string;
  micOn: boolean;
  deafened: boolean;
  onSelectServer: (id: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  onManageServer: () => void;
  onJoinRoom: (room: RoomInfo) => void;
  onAddRoom: () => void;
  onRenameRoom: (room: RoomInfo) => void;
  onDeleteRoom: (room: RoomInfo) => void;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onLeaveVoice: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
};

export default function Sidebar(props: Props) {
  const { session, servers, active, detail, voice, displayName } = props;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [roomMenu, setRoomMenu] = useState<string | null>(null);
  const isGuest = session.kind === "guest";
  const isManager = active?.role === "owner" || active?.role === "admin";

  return (
    <aside className="sidebar">
      <div className="row gap-10 brand-line">
        <Logo size={28} />
        <Wordmark />
      </div>

      {/* ---- Sélecteur de serveur ---- */}
      {active && (
        <div className="switcher-wrap">
          <button
            className={`switcher${switcherOpen ? " open" : ""}`}
            onClick={() => !isGuest && setSwitcherOpen(!switcherOpen)}
            aria-expanded={switcherOpen}
            aria-haspopup={!isGuest}
          >
            <ServerBadge name={active.name} />
            <span className="grow col gap-2 left">
              <span className="strong ellipsis">{active.name}</span>
              <span className="muted small">
                {active.inVoice > 0 ? (
                  <>
                    <span className="teal">●</span> {active.inVoice} en vocal
                  </>
                ) : (
                  "Personne en vocal"
                )}
              </span>
            </span>
            {!isGuest && <Icon name={switcherOpen ? "chevronUp" : "chevronDown"} />}
          </button>

          {switcherOpen && (
            <>
              <div className="click-away" onClick={() => setSwitcherOpen(false)} />
              <div className="popover switcher-menu" role="menu" aria-label="Mes serveurs">
                <span className="section-title">Mes serveurs</span>
                {servers.map((s, i) => (
                  <button
                    key={s.id}
                    role="menuitem"
                    className={`menu-item${s.id === active.id ? " current" : ""}`}
                    onClick={() => {
                      props.onSelectServer(s.id);
                      setSwitcherOpen(false);
                    }}
                  >
                    <ServerBadge name={s.name} size={34} />
                    <span className="grow col gap-2 left">
                      <span className="strong ellipsis">{s.name}</span>
                      <span className="muted small">{s.inVoice > 0 ? `${s.inVoice} en vocal` : "Personne en vocal"}</span>
                    </span>
                    {i < 9 && <kbd>Ctrl {i + 1}</kbd>}
                  </button>
                ))}
                <span className="menu-sep" />
                <button role="menuitem" className="menu-item accent" onClick={() => (setSwitcherOpen(false), props.onCreateServer())}>
                  <span className="dashed-badge">
                    <Icon name="plus" size={16} />
                  </span>
                  Créer un serveur
                </button>
                <button role="menuitem" className="menu-item accent" onClick={() => (setSwitcherOpen(false), props.onJoinServer())}>
                  <span className="dashed-badge">
                    <Icon name="login" size={16} />
                  </span>
                  Rejoindre avec un code
                </button>
              </div>
            </>
          )}

          {!isGuest && servers.length > 1 && (
            <div className="quick-switch" aria-label="Accès rapide aux serveurs">
              {servers.slice(0, 7).map((s) => (
                <button
                  key={s.id}
                  className={`quick${s.id === active.id ? " on" : ""}`}
                  onClick={() => props.onSelectServer(s.id)}
                  title={s.name}
                  aria-label={s.name}
                >
                  <ServerBadge name={s.name} size={30} />
                  {voice?.serverId === s.id && <span className="dot teal-dot" />}
                  {voice?.serverId !== s.id && s.inVoice > 0 && <span className="dot amber-dot" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Salons ---- */}
      <div className="rooms">
        {detail && (
          <>
            <div className="row space-between">
              <span className="section-title">Salons vocaux</span>
              <span className="row gap-4">
                {isManager && (
                  <button className="icon-btn sm" onClick={props.onAddRoom} aria-label="Créer un salon" title="Créer un salon">
                    <Icon name="plus" size={16} />
                  </button>
                )}
                {!isGuest && (
                  <button className="icon-btn sm" onClick={props.onManageServer} aria-label="Gérer le serveur" title="Gérer le serveur">
                    <Icon name="settings" size={16} />
                  </button>
                )}
              </span>
            </div>

            {detail.rooms.length === 0 && <p className="muted small pad">Aucun salon. {isManager ? "Crée-en un avec +." : ""}</p>}

            {detail.rooms.map((room) => {
              const here = voice?.serverId === detail.id && voice.roomId === room.id;
              const others = room.participants.filter((p) => p.identity !== voice?.identity);
              const people = here && voice ? [{ identity: voice.identity, name: displayName, guest: isGuest }, ...others] : others;
              return (
                <div key={room.id} className={`room-card${here ? " here" : ""}${people.length ? " busy" : ""}`}>
                  <button
                    className="room-main"
                    onClick={() => props.onJoinRoom(room)}
                    disabled={props.joiningRoomId === room.id}
                    title={here ? "Tu es dans ce salon" : `Rejoindre ${room.label}`}
                  >
                    <span className={here ? "teal" : "muted"}>
                      <Icon name={here ? "speakerLoud" : "speaker"} />
                    </span>
                    <span className="grow ellipsis strong-ish">{room.label}</span>
                    {room.spatial && (
                      <span className="muted" title="Audio spatial activé">
                        <Icon name="orbit" size={15} label="Audio spatial" />
                      </span>
                    )}
                    {here && <span className="here-tag">Tu es ici</span>}
                    {props.joiningRoomId === room.id && <span className="muted small">…</span>}
                  </button>
                  {isManager && (
                    <button
                      className="icon-btn sm room-more"
                      aria-label={`Options du salon ${room.label}`}
                      aria-expanded={roomMenu === room.id}
                      onClick={() => setRoomMenu(roomMenu === room.id ? null : room.id)}
                    >
                      <Icon name="more" size={16} />
                    </button>
                  )}
                  {roomMenu === room.id && (
                    <>
                      <div className="click-away" onClick={() => setRoomMenu(null)} />
                      <div className="popover room-menu" role="menu">
                        <button role="menuitem" className="menu-item" onClick={() => (setRoomMenu(null), props.onRenameRoom(room))}>
                          <Icon name="edit" size={16} /> Renommer
                        </button>
                        <button role="menuitem" className="menu-item danger" onClick={() => (setRoomMenu(null), props.onDeleteRoom(room))}>
                          <Icon name="trash" size={16} /> Supprimer
                        </button>
                      </div>
                    </>
                  )}
                  {people.length > 0 && (
                    <div className="occupants">
                      <span className="stack">
                        {people.slice(0, 5).map((p) => (
                          <Avatar key={p.identity} name={p.name} size={24} speaking={voice?.speaking.has(p.identity)} />
                        ))}
                      </span>
                      <span className="small soft ellipsis">
                        {people.map((p) => p.name + (p.guest ? " (invité)" : "")).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ---- Profil ---- */}
      <div className="profile">
        {voice && voice.serverId !== detail?.id && (
          <button className="voice-elsewhere" onClick={() => props.onSelectServer(voice.serverId)}>
            <span className="teal">●</span>
            <span className="grow ellipsis left">
              En vocal · {voice.roomLabel} / {voice.serverName}
            </span>
          </button>
        )}
        <div className="profile-card">
          <span className="avatar-wrap">
            <Avatar name={displayName} size={36} />
            <span className="status-dot" />
          </span>
          <span className="grow col gap-2 left">
            <span className="strong ellipsis">{displayName}</span>
            <span className="muted small ellipsis">
              {isGuest
                ? `Invité · jusqu'à ${formatExpiry(session.guest.expiresAt).replace(/^aujourd'hui à /, "")}`
                : voice
                  ? `En vocal · ${voice.roomLabel}`
                  : "En ligne"}
            </span>
          </span>
          {voice && (
            <>
              <button
                className={`icon-btn${props.micOn ? "" : " warn"}`}
                onClick={props.onToggleMic}
                aria-label={props.micOn ? "Couper le micro" : "Activer le micro"}
                title={props.micOn ? "Couper le micro" : "Activer le micro"}
              >
                <Icon name={props.micOn ? "mic" : "micOff"} />
              </button>
              <button
                className={`icon-btn${props.deafened ? " warn" : ""}`}
                onClick={props.onToggleDeafen}
                aria-label={props.deafened ? "Rétablir le son" : "Couper le son"}
                title={props.deafened ? "Rétablir le son" : "Couper le son"}
              >
                <Icon name={props.deafened ? "headphonesOff" : "headphones"} />
              </button>
            </>
          )}
          <button className="icon-btn" onClick={() => setProfileOpen(!profileOpen)} aria-label="Mon compte" aria-expanded={profileOpen}>
            <Icon name="more" />
          </button>
          {profileOpen && (
            <>
              <div className="click-away" onClick={() => setProfileOpen(false)} />
              <div className="popover profile-menu" role="menu">
                {voice && (
                  <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onLeaveVoice())}>
                    <Icon name="leave" size={16} /> Quitter le vocal
                  </button>
                )}
                <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onLogout())}>
                  <Icon name="logout" size={16} /> {isGuest ? "Quitter la soirée" : "Se déconnecter"}
                </button>
                {!isGuest && (
                  <button role="menuitem" className="menu-item danger" onClick={() => (setProfileOpen(false), props.onLogoutAll())}>
                    <Icon name="lock" size={16} /> Déconnecter tous mes appareils
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
