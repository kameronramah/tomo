import { useState } from "react";
import type { Room } from "livekit-client";
import type { Channel, Friend, RoomInfo, ServerDetail, ServerSummary, Session } from "../lib/api";
import { formatExpiry } from "../lib/ui";
import { Avatar, Icon, Logo, NetworkBadge, ServerBadge, Wordmark } from "./Brand";

export type VoiceInfo = {
  kind: "room" | "call";
  serverId: string | null;
  serverName: string;
  roomId: string;
  roomLabel: string;
  identity: string;
  speaking: Set<string>;
  room: Room;
};

export type Mode = "servers" | "messages";
export type ServerView = { type: "home" } | { type: "voice" } | { type: "channel"; id: string };
export type DmView = { type: "friends" } | { type: "dm"; userId: string } | { type: "call" };

type Props = {
  session: Session;
  displayName: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  unread: Record<string, number>;
  // serveurs
  servers: ServerSummary[];
  active?: ServerSummary;
  detail: ServerDetail | null;
  serverView: ServerView;
  joiningRoomId?: string;
  onSelectServer: (id: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  onManageServer: () => void;
  onJoinRoom: (room: RoomInfo) => void;
  onAddRoom: () => void;
  onRenameRoom: (room: RoomInfo) => void;
  onDeleteRoom: (room: RoomInfo) => void;
  onOpenChannel: (c: Channel) => void;
  onAddChannel: () => void;
  onRenameChannel: (c: Channel) => void;
  onDeleteChannel: (c: Channel) => void;
  // messages
  friends: Friend[];
  dmOrder: string[];
  dmView: DmView;
  onOpenFriends: () => void;
  onOpenDm: (userId: string) => void;
  // vocal
  voice: VoiceInfo | null;
  micOn: boolean;
  deafened: boolean;
  onGoToVoice: () => void;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onLeaveVoice: () => void;
  // compte
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenDev?: () => void;
};

export default function Sidebar(props: Props) {
  const { session, servers, active, detail, voice, displayName, mode, unread } = props;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const isGuest = session.kind === "guest";
  const isManager = active?.role === "owner" || active?.role === "admin";
  const dmUnread = props.friends.reduce((n, f) => n + (unread[`dm:${f.id}`] ?? 0), 0);
  const pendingIn = props.friends.filter((f) => f.status === "incoming").length;
  const serverUnread = (detail?.channels ?? []).some((c) => unread[`channel:${c.id}`]);

  return (
    <aside className="sidebar">
      <div className="row gap-10 brand-line">
        <Logo size={28} />
        <Wordmark />
      </div>

      {!isGuest && (
        <div className="mode-switch" role="tablist" aria-label="Section">
          <button role="tab" aria-selected={mode === "servers"} className={mode === "servers" ? "on" : ""} onClick={() => props.onMode("servers")}>
            <Icon name="speaker" size={16} /> Serveurs
            {mode !== "servers" && serverUnread && <span className="badge-dot" />}
          </button>
          <button role="tab" aria-selected={mode === "messages"} className={mode === "messages" ? "on" : ""} onClick={() => props.onMode("messages")}>
            <Icon name="chat" size={16} /> Messages
            {dmUnread + pendingIn > 0 && <span className="badge">{dmUnread + pendingIn}</span>}
          </button>
        </div>
      )}

      {mode === "servers" ? (
        <>
          {/* ---- Sélecteur de serveur ---- */}
          {active ? (
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
          ) : (
            !isGuest && (
              <div className="col gap-8">
                <button className="btn primary" onClick={props.onCreateServer}>
                  <Icon name="plus" size={16} /> Créer un serveur
                </button>
                <button className="btn outline" onClick={props.onJoinServer}>
                  Rejoindre avec un code
                </button>
              </div>
            )
          )}

          <div className="rooms">
            {detail && (
              <>
                {/* ---- Salons textuels ---- */}
                <div className="row space-between">
                  <span className="section-title">Salons textuels</span>
                  <span className="row gap-4">
                    {isManager && (
                      <button className="icon-btn sm" onClick={props.onAddChannel} aria-label="Créer un salon textuel" title="Créer un salon textuel">
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
                {detail.channels.map((c) => {
                  const open = props.serverView.type === "channel" && props.serverView.id === c.id;
                  const count = unread[`channel:${c.id}`] ?? 0;
                  return (
                    <div key={c.id} className={`channel-row${open ? " open" : ""}${count ? " unread" : ""}`}>
                      <button className="channel-main" onClick={() => props.onOpenChannel(c)}>
                        <Icon name="hash" size={16} />
                        <span className="grow ellipsis">{c.name}</span>
                        {count > 0 && <span className="badge">{count > 99 ? "99+" : count}</span>}
                      </button>
                      {isManager && (
                        <button
                          className="icon-btn sm room-more"
                          aria-label={`Options du salon ${c.name}`}
                          aria-expanded={menu === `c:${c.id}`}
                          onClick={() => setMenu(menu === `c:${c.id}` ? null : `c:${c.id}`)}
                        >
                          <Icon name="more" size={16} />
                        </button>
                      )}
                      {menu === `c:${c.id}` && (
                        <>
                          <div className="click-away" onClick={() => setMenu(null)} />
                          <div className="popover room-menu" role="menu">
                            <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), props.onRenameChannel(c))}>
                              <Icon name="edit" size={16} /> Renommer
                            </button>
                            <button role="menuitem" className="menu-item danger" onClick={() => (setMenu(null), props.onDeleteChannel(c))}>
                              <Icon name="trash" size={16} /> Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* ---- Salons vocaux ---- */}
                <div className="row space-between section-gap">
                  <span className="section-title">Salons vocaux</span>
                  {isManager && (
                    <button className="icon-btn sm" onClick={props.onAddRoom} aria-label="Créer un salon vocal" title="Créer un salon vocal">
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </div>

                {detail.rooms.length === 0 && <p className="muted small pad">Aucun salon vocal. {isManager ? "Crée-en un avec +." : ""}</p>}

                {detail.rooms.map((room) => {
                  const here = voice?.kind === "room" && voice.serverId === detail.id && voice.roomId === room.id;
                  const others = room.participants.filter((p) => p.identity !== voice?.identity);
                  const people = here && voice ? [{ identity: voice.identity, name: displayName, guest: isGuest }, ...others] : others;
                  const chatUnread = unread[`room:${room.id}`] ?? 0;
                  return (
                    <div key={room.id} className={`room-card${here ? " here" : ""}${people.length ? " busy" : ""}`}>
                      <button
                        className="room-main"
                        onClick={() => props.onJoinRoom(room)}
                        disabled={props.joiningRoomId === room.id}
                        title={here ? "Aller au salon" : `Rejoindre ${room.label}`}
                      >
                        <span className={here ? "teal" : "muted"}>
                          <Icon name={here ? "speakerLoud" : "speaker"} />
                        </span>
                        <span className="grow ellipsis strong-ish">{room.label}</span>
                        {chatUnread > 0 && <span className="badge-dot" title="Nouveaux messages dans le chat" />}
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
                          aria-expanded={menu === `r:${room.id}`}
                          onClick={() => setMenu(menu === `r:${room.id}` ? null : `r:${room.id}`)}
                        >
                          <Icon name="more" size={16} />
                        </button>
                      )}
                      {menu === `r:${room.id}` && (
                        <>
                          <div className="click-away" onClick={() => setMenu(null)} />
                          <div className="popover room-menu" role="menu">
                            <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), props.onRenameRoom(room))}>
                              <Icon name="edit" size={16} /> Renommer
                            </button>
                            <button role="menuitem" className="menu-item danger" onClick={() => (setMenu(null), props.onDeleteRoom(room))}>
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
                          <span className="small soft ellipsis">{people.map((p) => p.name + (p.guest ? " (invité)" : "")).join(", ")}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      ) : (
        /* ---- Messages privés ---- */
        <div className="rooms">
          <button className={`nav-item${props.dmView.type === "friends" ? " open" : ""}`} onClick={props.onOpenFriends}>
            <Icon name="users" />
            <span className="grow left">Amis</span>
            {pendingIn > 0 && <span className="badge">{pendingIn}</span>}
          </button>
          <span className="section-title section-gap">Messages privés</span>
          {props.dmOrder.length === 0 && <p className="muted small pad">Ajoute des amis pour discuter avec eux.</p>}
          {props.dmOrder.map((id) => {
            const f = props.friends.find((x) => x.id === id);
            if (!f) return null;
            const open = props.dmView.type === "dm" && props.dmView.userId === id;
            const count = unread[`dm:${id}`] ?? 0;
            return (
              <button key={id} className={`nav-item dm${open ? " open" : ""}${count ? " unread" : ""}`} onClick={() => props.onOpenDm(id)}>
                <span className="avatar-wrap">
                  <Avatar name={f.username} size={30} />
                  <span className={`status-dot sm${f.online ? "" : " off"}`} />
                </span>
                <span className="grow ellipsis left">{f.username}</span>
                {count > 0 && <span className="badge">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Vocal en cours + profil ---- */}
      <div className="profile">
        {voice && (
          <div className="voice-card">
            <button className="voice-card-info" onClick={props.onGoToVoice} title="Aller au salon">
              <span className="row gap-6">
                <span className="ok small strong">● {voice.kind === "call" ? "En appel" : "En vocal"}</span>
                <NetworkBadge room={voice.room} />
              </span>
              <span className="small soft ellipsis">
                {voice.roomLabel}
                {voice.kind === "room" ? ` / ${voice.serverName}` : ""}
              </span>
            </button>
            <button
              className={`icon-btn${props.micOn ? "" : " warn"}`}
              onClick={props.onToggleMic}
              aria-label={props.micOn ? "Couper le micro" : "Activer le micro"}
              title={props.micOn ? "Couper le micro (Ctrl+Maj+M)" : "Activer le micro (Ctrl+Maj+M)"}
            >
              <Icon name={props.micOn ? "mic" : "micOff"} />
            </button>
            <button
              className={`icon-btn${props.deafened ? " warn" : ""}`}
              onClick={props.onToggleDeafen}
              aria-label={props.deafened ? "Rétablir le son" : "Couper le son"}
              title={props.deafened ? "Rétablir le son (Ctrl+Maj+D)" : "Couper le son (Ctrl+Maj+D)"}
            >
              <Icon name={props.deafened ? "headphonesOff" : "headphones"} />
            </button>
            <button className="icon-btn danger" onClick={props.onLeaveVoice} aria-label={voice.kind === "call" ? "Raccrocher" : "Quitter le vocal"} title={voice.kind === "call" ? "Raccrocher" : "Quitter le vocal"}>
              <Icon name={voice.kind === "call" ? "phoneOff" : "leave"} />
            </button>
          </div>
        )}
        <div className="profile-card">
          <span className="avatar-wrap">
            <Avatar name={displayName} size={36} />
            <span className="status-dot" />
          </span>
          <span className="grow col gap-2 left">
            <span className="strong ellipsis">{displayName}</span>
            <span className="muted small ellipsis">
              {isGuest ? `Invité · jusqu'à ${formatExpiry(session.guest.expiresAt).replace(/^aujourd'hui à /, "")}` : "En ligne"}
            </span>
          </span>
          {props.onOpenDev && (
            <button className="icon-btn dev-btn" onClick={props.onOpenDev} aria-label="Outils de test" title="Outils de test">
              <Icon name="flask" />
            </button>
          )}
          {!isGuest && (
            <button className="icon-btn" onClick={props.onOpenSettings} aria-label="Paramètres" title="Paramètres (Ctrl+,)">
              <Icon name="settings" />
            </button>
          )}
          <button className="icon-btn" onClick={() => setProfileOpen(!profileOpen)} aria-label="Mon compte" aria-expanded={profileOpen}>
            <Icon name="more" />
          </button>
          {profileOpen && (
            <>
              <div className="click-away" onClick={() => setProfileOpen(false)} />
              <div className="popover profile-menu" role="menu">
                {!isGuest && (
                  <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onOpenSettings())}>
                    <Icon name="settings" size={16} /> Paramètres
                  </button>
                )}
                <button role="menuitem" className="menu-item danger" onClick={() => (setProfileOpen(false), props.onLogout())}>
                  <Icon name="logout" size={16} /> {isGuest ? "Quitter la soirée" : "Se déconnecter"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
