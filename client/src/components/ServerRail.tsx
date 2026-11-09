import { useState } from "react";
import type { ChosenStatus, MyProfile, ServerSummary, Session } from "../lib/api";
import { useServerLayout, type Folder } from "../lib/folders";
import { STATUS_LABEL } from "../lib/people";
import { formatExpiry } from "../lib/ui";
import { Avatar, Icon, Logo, ServerBadge, StatusDot, Wordmark } from "./Brand";
import { t } from "../lib/i18n";

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
  /** Serveurs avec des nouveaux messages non lus (point gris) */
  serverDots: Set<string>;
  onSelectServer: (id: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onOpenDev?: () => void;
  /** Mon profil (null pour un invité) */
  me: MyProfile | null;
  onSetStatus: (p: { status?: ChosenStatus; customStatus?: string | null; customStatusUntil?: number | null }) => void;
  onOpenMyProfile: () => void;
};

const STATUS_OPTIONS: { id: ChosenStatus; label: string; hint: string }[] = [
  { id: "online", label: t("En ligne"), hint: t("Tout le monde te voit dispo") },
  { id: "idle", label: t("Inactif"), hint: t("Mis tout seul après 10 min sans bouger") },
  { id: "dnd", label: t("Ne pas déranger"), hint: t("Plus de sons de messages ni d'appels") },
  { id: "invisible", label: t("Invisible"), hint: t("Tu vois tout, on te voit hors ligne") },
];

/** Fin du statut personnalisé : dans 1 h, ce soir (4 h du matin), jamais. */
function untilFor(choice: "1h" | "tonight" | "never"): number | null {
  if (choice === "never") return null;
  if (choice === "1h") return Date.now() + 3600_000;
  const d = new Date();
  if (d.getHours() >= 4) d.setDate(d.getDate() + 1);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}

function StatusMenu({ me, onSet, onClose, onProfile, onSettings, onLogout, onDev }: {
  me: MyProfile;
  onSet: Props["onSetStatus"];
  onClose: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
  onDev?: () => void;
}) {
  const [text, setText] = useState(me.customStatusRaw ?? "");
  const [until, setUntil] = useState<"1h" | "tonight" | "never">("never");
  const saveCustom = () => {
    const t = text.trim();
    if (t === (me.customStatusRaw ?? "")) return;
    onSet({ customStatus: t || null, customStatusUntil: t ? untilFor(until) : null });
  };
  return (
    <>
      <div className="click-away" onClick={() => (saveCustom(), onClose())} />
      <div className="popover status-menu" role="menu" aria-label={t("Mon statut")}>
        <span className="section-title">{t("Mon statut")}</span>
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.id}
            role="menuitemradio"
            aria-checked={me.chosenStatus === o.id}
            className={`status-opt${me.chosenStatus === o.id ? " on" : ""}`}
            onClick={() => onSet({ status: o.id })}
          >
            <StatusDot status={o.id === "invisible" ? "invisible" : o.id} size={12} inline />
            <span className="grow">
              {o.label}
              <span className="hint">{o.hint}</span>
            </span>
            {me.chosenStatus === o.id && <Icon name="check" size={16} />}
          </button>
        ))}
        <span className="menu-sep" />
        <label className="custom-status">
          <Icon name="edit" size={16} />
          <input
            value={text}
            maxLength={60}
            placeholder={t("Statut perso (ex. dispo pour un ranked)")}
            aria-label={t("Statut personnalisé")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveCustom()}
            onBlur={saveCustom}
          />
        </label>
        <div className="chips" role="group" aria-label={t("Effacer le statut perso")}>
          {(
            [
              ["1h", "Effacer dans 1 h"],
              ["tonight", "Ce soir"],
              ["never", "Jamais"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`chip-btn${until === id ? " on" : ""}`} onClick={() => setUntil(id)}>
              {label}
            </button>
          ))}
          {me.customStatusRaw && (
            <button className="chip-btn" onClick={() => (setText(""), onSet({ customStatus: null }))}>
              {t("Retirer")}
            </button>
          )}
        </div>
        <span className="menu-sep" />
        <button role="menuitem" className="menu-item" onClick={() => (onClose(), onProfile())}>
          <Icon name="user" size={16} /> {t("Mon profil")}
        </button>
        <button role="menuitem" className="menu-item" onClick={() => (onClose(), onSettings())}>
          <Icon name="settings" size={16} /> {t("Paramètres")}
        </button>
        {onDev && (
          <button role="menuitem" className="menu-item" onClick={() => (onClose(), onDev())}>
            <Icon name="flask" size={16} /> {t("Outils de test")}
          </button>
        )}
        <button role="menuitem" className="menu-item danger" onClick={() => (onClose(), onLogout())}>
          <Icon name="logout" size={16} /> {t("Se déconnecter")}
        </button>
      </div>
    </>
  );
}

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
    const sub = here ? (s.inVoice > 0 ? `${s.inVoice} en vocal · tu y es` : "tu y es") : s.inVoice > 0 ? `${s.inVoice} en vocal` : "";
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
          {props.serverDots.has(s.id) && !active ? (
            <span className="new-dot" title={t("Nouveaux messages")} />
          ) : (
            collapsed && s.inVoice > 0 && <span className={`rail-dot ${here ? "teal" : "amber"}`} />
          )}
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
                  aria-label={t("Nom du dossier")}
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
                  {live && !f.open && <span className="rail-dot inline amber" title={t("Quelqu'un est en vocal dans ce dossier")} />}
                  {!f.open && <span className="muted small">{items.length}</span>}
                  <Icon name={f.open ? "chevronDown" : "chevronRight"} size={15} />
                </>
              ))}
          </button>
          {!collapsed && (
            <button className="icon-btn sm rail-more" aria-label={t("Options du dossier {0}", { 0: f.name })} onClick={() => setMenu(menu === f.id ? null : f.id)}>
              <Icon name="more" size={15} />
            </button>
          )}
          {menu === f.id && (
            <>
              <div className="click-away" onClick={() => setMenu(null)} />
              <div className="popover room-menu" role="menu">
                <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), setRenaming(f.id))}>
                  <Icon name="edit" size={16} /> {t("Renommer")}
                </button>
                <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), layout.ungroup(f.id))}>
                  <Icon name="folder" size={16} /> {t("Défaire le dossier")}
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
    <nav className={`rail${collapsed ? " collapsed" : ""}`} aria-label={t("Navigation")}>
      <div className="rail-brand">
        <Logo size={28} cut="var(--rail)" />
        {!collapsed && (
          <span className="grow">
            <Wordmark size={18} />
          </span>
        )}
        <button
          className="icon-btn sm"
          onClick={() => layout.setCollapsed(!collapsed)}
          aria-label={collapsed ? t("Afficher les noms des serveurs") : t("Réduire la colonne en icônes")}
          title={collapsed ? t("Afficher les noms") : t("Réduire")}
        >
          <Icon name="sidebar" size={16} />
        </button>
      </div>

      {!isGuest && (
        <button className={`rail-server${mode === "messages" ? " active" : ""}`} onClick={() => props.onMode("messages")} title={collapsed ? t("Messages") : undefined}>
          <span className="rail-badge">
            <span className="rail-icon">
              <Icon name="chat" size={17} />
            </span>
            {props.messagesBadge > 0 && <span className="count red">{props.messagesBadge > 99 ? "99+" : props.messagesBadge}</span>}
          </span>
          {!collapsed && <span className="grow left">{t("Messages")}</span>}
        </button>
      )}

      <div className="rail-section">
        {!collapsed && <span className="section-title">{t("Serveurs")}</span>}
        {!isGuest && (
          <div className="relative">
            <button className="icon-btn sm" onClick={() => setAddOpen(!addOpen)} aria-label={t("Créer ou rejoindre un serveur")} aria-expanded={addOpen}>
              <Icon name="plus" size={15} />
            </button>
            {addOpen && (
              <>
                <div className="click-away" onClick={() => setAddOpen(false)} />
                <div className="popover rail-add-menu" role="menu">
                  <button role="menuitem" className="menu-item" onClick={() => (setAddOpen(false), props.onCreateServer())}>
                    <Icon name="plus" size={16} /> {t("Créer un serveur")}
                  </button>
                  <button role="menuitem" className="menu-item" onClick={() => (setAddOpen(false), props.onJoinServer())}>
                    <Icon name="login" size={16} /> {t("Rejoindre avec un code")}
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
        {dragging && !collapsed && <span className={`rail-drop-end${over === "end" ? " on" : ""}`}>{t("Lâche ici pour sortir du dossier")}</span>}
        {!isGuest && !collapsed && servers.length > 1 && !dragging && !layout.entries.some((e) => e.kind === "folder") && (
          <span className="rail-hint">{t("Glisse un serveur sur un autre pour créer un dossier")}</span>
        )}
      </div>

      <div className="rail-me">
        <button className="rail-me-main" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen} aria-label={t("Mon compte et mon statut")}>
          <Avatar
            name={props.me?.displayName ?? props.displayName}
            src={props.me?.avatarUrl}
            size={34}
            status={props.me ? (props.me.chosenStatus === "invisible" ? "offline" : props.me.chosenStatus === "online" ? "online" : props.me.chosenStatus) : "online"}
          />
          {!collapsed && (
            <span className="grow col gap-2 left" style={{ minWidth: 0 }}>
              <span className="strong ellipsis">{props.me?.displayName ?? props.displayName}</span>
              <span className="muted small ellipsis">
                {isGuest
                  ? t("Invité · jusqu'à {0}", { 0: formatExpiry(session.guest.expiresAt).replace(/^aujourd'hui à /, "") })
                  : props.me?.customStatusRaw && (!props.me.customStatusUntil || props.me.customStatusUntil > Date.now())
                    ? props.me.customStatusRaw
                    : STATUS_LABEL[props.me?.chosenStatus ?? "online"]}
              </span>
            </span>
          )}
        </button>
        {!collapsed && props.onOpenDev && (
          <button className="icon-btn sm dev-btn" onClick={props.onOpenDev} aria-label={t("Outils de test")} title={t("Outils de test")}>
            <Icon name="flask" size={16} />
          </button>
        )}
        {!collapsed && !isGuest && (
          <button className="icon-btn sm" onClick={props.onOpenSettings} aria-label={t("Paramètres")} title={t("Paramètres (Ctrl+,)")}>
            <Icon name="settings" size={16} />
          </button>
        )}
        {profileOpen && props.me && (
          <StatusMenu
            me={props.me}
            onSet={props.onSetStatus}
            onClose={() => setProfileOpen(false)}
            onProfile={props.onOpenMyProfile}
            onSettings={props.onOpenSettings}
            onLogout={props.onLogout}
            onDev={props.onOpenDev}
          />
        )}
        {profileOpen && !props.me && (
          <>
            <div className="click-away" onClick={() => setProfileOpen(false)} />
            <div className="popover profile-menu" role="menu">
              {!isGuest && (
                <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onOpenSettings())}>
                  <Icon name="settings" size={16} /> {t("Paramètres")}
                </button>
              )}
              {props.onOpenDev && (
                <button role="menuitem" className="menu-item" onClick={() => (setProfileOpen(false), props.onOpenDev!())}>
                  <Icon name="flask" size={16} /> {t("Outils de test")}
                </button>
              )}
              <button role="menuitem" className="menu-item danger" onClick={() => (setProfileOpen(false), props.onLogout())}>
                <Icon name="logout" size={16} /> {isGuest ? t("Quitter la soirée") : t("Se déconnecter")}
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
