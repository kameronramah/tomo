import { useState } from "react";
import type { ServerSummary, Session } from "../lib/api";
import { useServerLayout, type Folder } from "../lib/folders";
import { formatExpiry } from "../lib/ui";
import { Avatar, Icon, Logo, ServerBadge } from "./Brand";

export type Mode = "servers" | "messages";

type Props = {
  session: Session;
  instance: string;
  displayName: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  servers: ServerSummary[];
  activeId: string | null;
  /** Serveur où je suis en vocal */
  voiceServerId: string | null;
  messagesBadge: number;
  onSelectServer: (id: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenDev?: () => void;
};

/** Colonne de gauche : Messages, serveurs (rangés en dossiers), moi. */
export default function ServerRail(props: Props) {
  const { session, servers, activeId, mode } = props;
  const isGuest = session.kind === "guest";
  const layout = useServerLayout(props.instance, servers.map((s) => s.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const collapsed = layout.collapsed;
  const byId = new Map(servers.map((s) => [s.id, s]));

  const dragProps = (id: string) =>
    isGuest
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/tomo-server", id);
            e.dataTransfer.effectAllowed = "move";
            setDragging(id);
          },
          onDragEnd: () => (setDragging(null), setOver(null)),
        };

  const dropZone = (zone: string, onDrop: (dragged: string) => void) =>
    dragging
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(zone);
          },
          onDragLeave: () => setOver((o) => (o === zone ? null : o)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData("text/tomo-server") || dragging;
            setDragging(null);
            setOver(null);
            if (id) onDrop(id);
          },
        }
      : {};

  function serverRow(s: ServerSummary, nested: boolean) {
    const active = mode === "servers" && s.id === activeId;
    const here = props.voiceServerId === s.id;
    const sub = here ? `${s.inVoice} en vocal · tu y es` : s.inVoice > 0 ? `${s.inVoice} en vocal` : "";
    return (
      <button
        key={s.id}
        className={`rail-server${active ? " active" : ""}${nested ? " nested" : ""}${over === `s:${s.id}` ? " drop-target" : ""}`}
        onClick={() => props.onSelectServer(s.id)}
        title={collapsed ? `${s.name}${sub ? ` · ${sub}` : ""}` : undefined}
        aria-current={active ? "true" : undefined}
        {...dragProps(s.id)}
        {...(nested ? {} : dropZone(`s:${s.id}`, (d) => layout.dropOnServer(d, s.id)))}
      >
        <span className="rail-badge">
          <ServerBadge name={s.name} size={nested ? 30 : 34} />
          {collapsed && s.inVoice > 0 && <span className={`rail-dot ${here ? "teal" : "amber"}`} />}
        </span>
        {!collapsed && (
          <span className="grow col left rail-text">
            <span className="ellipsis">{s.name}</span>
            {sub && <span className={`rail-sub ${here ? "teal" : "amber"}`}>{sub}</span>}
          </span>
        )}
      </button>
    );
  }

  function folderBlock(f: Folder) {
    const items = f.servers.map((id) => byId.get(id)).filter((s): s is ServerSummary => !!s);
    const live = items.some((s) => s.inVoice > 0);
    const containsActive = items.some((s) => s.id === activeId);
    return (
      <div key={f.id} className={`rail-folder${f.open ? " open" : ""}${over === `f:${f.id}` ? " drop-target" : ""}`} {...dropZone(`f:${f.id}`, (d) => layout.dropOnFolder(d, f.id))}>
        <div className="rail-folder-head">
          <button
            className={`rail-server folder${containsActive && !f.open ? " active" : ""}`}
            onClick={() => layout.toggleFolder(f.id)}
            aria-expanded={f.open}
            title={collapsed ? f.name : undefined}
          >
            <span className="rail-badge">
              {f.open ? (
                <span className="folder-icon">
                  <Icon name="folder" size={17} />
                </span>
              ) : (
                <span className="folder-mini" aria-hidden="true">
                  {items.slice(0, 4).map((s) => (
                    <ServerBadge key={s.id} name={s.name} size={12} />
                  ))}
                </span>
              )}
              {collapsed && live && !f.open && <span className="rail-dot amber" />}
            </span>
            {!collapsed &&
              (renaming === f.id ? (
                <input
                  className="rail-rename"
                  defaultValue={f.name}
                  autoFocus
                  maxLength={32}
                  aria-label="Nom du dossier"
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => (layout.renameFolder(f.id, e.target.value), setRenaming(null))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <span className="grow ellipsis left strong-ish folder-name">{f.name}</span>
                  {live && !f.open && <span className="rail-dot inline amber" title="Quelqu'un est en vocal dans ce dossier" />}
                  {!f.open && <span className="muted small">{items.length}</span>}
                  <Icon name={f.open ? "chevronDown" : "chevronRight"} size={15} />
                </>
              ))}
          </button>
          {!collapsed && (
            <button className="icon-btn sm rail-more" aria-label={`Options du dossier ${f.name}`} onClick={() => setMenu(menu === f.id ? null : f.id)}>
              <Icon name="more" size={15} />
            </button>
          )}
          {menu === f.id && (
            <>
              <div className="click-away" onClick={() => setMenu(null)} />
              <div className="popover room-menu" role="menu">
                <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), setRenaming(f.id))}>
                  <Icon name="edit" size={16} /> Renommer
                </button>
                <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), layout.ungroup(f.id))}>
                  <Icon name="folder" size={16} /> Défaire le dossier
                </button>
              </div>
            </>
          )}
        </div>
        {f.open && <div className="rail-folder-items">{items.map((s) => serverRow(s, true))}</div>}
      </div>
    );
  }

  return (
    <nav className={`rail${collapsed ? " collapsed" : ""}`} aria-label="Navigation">
      <div className="rail-brand">
        <Logo size={28} cut="var(--rail)" />
        {!collapsed && <span className="wordmark grow">tomo</span>}
        <button
          className="icon-btn sm"
          onClick={() => layout.setCollapsed(!collapsed)}
          aria-label={collapsed ? "Afficher les noms des serveurs" : "Réduire la colonne en icônes"}
          title={collapsed ? "Afficher les noms" : "Réduire"}
        >
          <Icon name="sidebar" size={16} />
        </button>
      </div>

      {!isGuest && (
        <button className={`rail-server${mode === "messages" ? " active" : ""}`} onClick={() => props.onMode("messages")} title={collapsed ? "Messages" : undefined}>
          <span className="rail-badge">
            <span className="rail-icon">
              <Icon name="chat" size={17} />
            </span>
            {collapsed && props.messagesBadge > 0 && <span className="rail-count">{props.messagesBadge}</span>}
          </span>
          {!collapsed && (
            <>
              <span className="grow left">Messages</span>
              {props.messagesBadge > 0 && <span className="badge amber-badge-fill">{props.messagesBadge}</span>}
            </>
          )}
        </button>
      )}

      <div className="rail-section">
        {!collapsed && <span className="section-title">Serveurs</span>}
        {!isGuest && (
          <div className="relative">
            <button className="icon-btn sm" onClick={() => setAddOpen(!addOpen)} aria-label="Créer ou rejoindre un serveur" aria-expanded={addOpen}>
              <Icon name="plus" size={15} />
            </button>
            {addOpen && (
              <>
                <div className="click-away" onClick={() => setAddOpen(false)} />
                <div className="popover rail-add-menu" role="menu">
                  <button role="menuitem" className="menu-item" onClick={() => (setAddOpen(false), props.onCreateServer())}>
                    <Icon name="plus" size={16} /> Créer un serveur
                  </button>
                  <button role="menuitem" className="menu-item" onClick={() => (setAddOpen(false), props.onJoinServer())}>
                    <Icon name="login" size={16} /> Rejoindre avec un code
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rail-list" {...dropZone("end", (d) => layout.dropBefore(d, null))}>
        {layout.entries.map((e) => {
          if (e.kind === "folder") return folderBlock(e);
          const s = byId.get(e.id);
          return s ? serverRow(s, false) : null;
        })}
        {dragging && !collapsed && <span className={`rail-drop-end${over === "end" ? " on" : ""}`}>Lâche ici pour sortir du dossier</span>}
        {!isGuest && !collapsed && servers.length > 1 && !dragging && !layout.entries.some((e) => e.kind === "folder") && (
          <span className="rail-hint">Glisse un serveur sur un autre pour créer un dossier</span>
        )}
      </div>

      <div className="rail-me">
        <button className="rail-me-main" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen} aria-label="Mon compte">
          <span className="avatar-wrap">
            <Avatar name={props.displayName} size={34} />
            <span className="status-dot" />
          </span>
          {!collapsed && (
            <span className="grow col gap-2 left">
              <span className="strong ellipsis">{props.displayName}</span>
              <span className="muted small ellipsis">
                {isGuest ? `Invité · jusqu'à ${formatExpiry(session.guest.expiresAt).replace(/^aujourd'hui à /, "")}` : "En ligne"}
              </span>
            </span>
          )}
        </button>
        {!collapsed && props.onOpenDev && (
          <button className="icon-btn sm dev-btn" onClick={props.onOpenDev} aria-label="Outils de test" title="Outils de test">
            <Icon name="flask" size={16} />
          </button>
        )}
        {!collapsed && !isGuest && (
          <button className="icon-btn sm" onClick={props.onOpenSettings} aria-label="Paramètres" title="Paramètres (Ctrl+,)">
            <Icon name="settings" size={16} />
          </button>
        )}
        {profileOpen && (
          <>
            <div className="click-away" onClick={() => setProfileOpen(false)} />
            <div className="popover profile-menu" role="menu">
              {!isGuest && (
                <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onOpenSettings())}>
                  <Icon name="settings" size={16} /> Paramètres
                </button>
              )}
              {props.onOpenDev && (
                <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onOpenDev!())}>
                  <Icon name="flask" size={16} /> Outils de test
                </button>
              )}
              <button role="menuitem" className="menu-item danger" onClick={() => (setProfileOpen(false), props.onLogout())}>
                <Icon name="logout" size={16} /> {isGuest ? "Quitter la soirée" : "Se déconnecter"}
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
