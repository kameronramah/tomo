import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /** Où afficher le menu d'un dossier (clic droit) : en coordonnées de la fenêtre */
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Dossier fermé survolé : petite fiche à droite avec ses serveurs */
  const [peek, setPeek] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Petit délai avant de fermer la fiche : le temps d'y amener la souris pour cliquer un serveur */
  const peekTimer = useRef<number | undefined>(undefined);
  const keepPeek = () => window.clearTimeout(peekTimer.current);
  const closePeekSoon = () => {
    keepPeek();
    peekTimer.current = window.setTimeout(() => setPeek(null), 180);
  };
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // v0.12 : la colonne reste toujours fine (des ronds), pour laisser la place au reste.
  const collapsed = true;
  const byId = new Map(servers.map((s) => [s.id, s]));

  /*
   * Glisser-déposer fait maison (pas celui du navigateur, qui montre un rectangle et une copie
   * de l'icône) : l'icône quitte sa place et suit la souris.
   * Ce qu'on fait glisser : « s:<id> » (un serveur) ou « f:<id> » (un dossier entier).
   */
  const listRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  /** Position de l'icône qui suit la souris (coin haut gauche) */
  const ghostPos = useRef({ x: 0, y: 0 });

  type Pos = "before" | "after" | "into";
  type Hit = { id: string; kind: "server" | "nested" | "folder"; pos: Pos } | "end" | null;

  /**
   * Ce qu'il y a sous la souris. Sur un serveur : le bord haut / bas le place avant / après
   * (ranger), le milieu crée un dossier. Sur un dossier : le bord haut / bas le place avant /
   * après, le milieu (ou n'importe où dans un dossier ouvert) l'y fait entrer.
   */
  function hitTest(key: string, x: number, y: number): Hit {
    const folderDrag = key.startsWith("f:");
    const at = document.elementFromPoint(x, y);
    let el = at?.closest<HTMLElement>("[data-drop-id]") ?? null;
    // un dossier ne va pas dans un dossier : ses serveurs renvoient au bloc du dossier
    if (el && folderDrag && el.dataset.dropKind === "nested") el = el.parentElement?.closest<HTMLElement>("[data-drop-id]") ?? null;
    if (!el) return at && listRef.current?.contains(at) ? "end" : null;
    const id = el.dataset.dropId!;
    const kind = el.dataset.dropKind as "server" | "nested" | "folder";
    if (key === `${kind === "folder" ? "f" : "s"}:${id}`) return null;
    const ref = kind === "folder" && !folderDrag ? (el.querySelector(".rail-folder-head") ?? el) : el;
    const r = ref.getBoundingClientRect();
    const ry = (y - r.top) / r.height;
    if (folderDrag || kind === "nested") return { id, kind, pos: ry < 0.5 ? "before" : "after" };
    if (ry < 0.28) return { id, kind, pos: "before" };
    if (ry > 0.72 && !(kind === "folder" && el.dataset.dropOpen)) return { id, kind, pos: "after" };
    return { id, kind, pos: "into" };
  }

  function applyDrop(key: string, hit: Exclude<Hit, null>) {
    const dragged = key.slice(2);
    const folderDrag = key.startsWith("f:");
    if (hit === "end") return folderDrag ? layout.moveFolder(dragged, null, true) : layout.dropBefore(dragged, null);
    if (folderDrag) layout.moveFolder(dragged, hit.id, hit.pos === "after");
    else if (hit.pos !== "into") layout.placeNear(dragged, hit.id, hit.pos === "after");
    else if (hit.kind === "folder") layout.dropOnFolder(dragged, hit.id);
    else layout.dropOnServer(dragged, hit.id);
  }

  const placeGhost = () => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate(${ghostPos.current.x}px, ${ghostPos.current.y}px)`;
  };

  /** Appuyer puis bouger de quelques pixels : le glisser commence (sinon c'est un simple clic). */
  const startDrag = (key: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (isGuest || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    // l'icône garde l'endroit où on l'a attrapée
    const badge = (e.currentTarget.querySelector(".rail-badge") ?? e.currentTarget).getBoundingClientRect();
    const dx = sx - badge.left;
    const dy = sy - badge.top;
    let started = false;
    let hit: Hit = null;
    let scroll = 0;
    let raf = 0;

    const scrollLoop = () => {
      if (scroll && listRef.current) listRef.current.scrollTop += scroll;
      raf = requestAnimationFrame(scrollLoop);
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
        started = true;
        setPeek(null);
        document.body.classList.add("rail-dragging");
        setDragging(key);
        raf = requestAnimationFrame(scrollLoop);
      }
      ghostPos.current = { x: ev.clientX - dx, y: ev.clientY - dy };
      placeGhost();
      // près du haut / du bas de la liste : elle défile toute seule
      const lr = listRef.current?.getBoundingClientRect();
      scroll = lr ? (ev.clientY < lr.top + 28 ? -6 : ev.clientY > lr.bottom - 28 ? 6 : 0) : 0;
      hit = hitTest(key, ev.clientX, ev.clientY);
      const o = hit === null ? null : hit === "end" ? "end" : `${hit.pos}:${hit.id}`;
      setOver((p) => (p === o ? p : o));
    };
    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc, true);
      if (!started) return;
      cancelAnimationFrame(raf);
      document.body.classList.remove("rail-dragging");
      setDragging(null);
      setOver(null);
      // Relâché sur place (main qui a un peu bougé pendant le clic) : c'est un vrai clic,
      // on le laisse passer (déplier le dossier, ouvrir le serveur).
      if (!commit || !hit) return;
      // sinon le relâcher ne doit pas compter comme un clic
      const swallow = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      applyDrop(key, hit);
    };
    const up = () => stop(true);
    const cancel = () => stop(false);
    const esc = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !started) return;
      k.stopPropagation();
      stop(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc, true);
  };

  // l'icône qui suit la souris est créée au premier mouvement : on la place tout de suite
  useLayoutEffect(placeGhost, [dragging]);

  const dropClass = (id: string) =>
    over === `into:${id}` ? " drop-target" : over === `before:${id}` ? " drop-before" : over === `after:${id}` ? " drop-after" : "";

  /** L'icône qui suit la souris pendant le glisser */
  function ghost() {
    if (!dragging) return null;
    const id = dragging.slice(2);
    let inner: React.ReactNode = null;
    if (dragging.startsWith("s:")) {
      const s = byId.get(id);
      inner = s ? <ServerBadge name={s.name} src={s.iconUrl} size={34} /> : null;
    } else {
      const f = layout.entries.find((e): e is Folder => e.kind === "folder" && e.id === id);
      inner = f ? folderPreview(f.servers.map((sid) => byId.get(sid)).filter((s): s is ServerSummary => !!s)) : null;
    }
    return createPortal(
      <div ref={ghostRef} className={`rail-ghost${over?.startsWith("into:") ? " merging" : ""}`} aria-hidden="true">
        <div className="rail-ghost-in">{inner}</div>
      </div>,
      document.body,
    );
  }

  function serverRow(s: ServerSummary, nested: boolean) {
    const active = mode === "servers" && s.id === activeId;
    const here = props.voiceServerId === s.id;
    const sub = here ? (s.inVoice > 0 ? `${s.inVoice} en vocal · tu y es` : "tu y es") : s.inVoice > 0 ? `${s.inVoice} en vocal` : "";
    return (
      <button
        key={s.id}
        className={`rail-server${active ? " active" : ""}${nested ? " nested" : ""}${dropClass(s.id)}${dragging === `s:${s.id}` ? " drag-origin" : ""}`}
        onClick={() => props.onSelectServer(s.id)}
        title={collapsed && !dragging ? `${s.name}${sub ? ` · ${sub}` : ""}` : undefined}
        aria-label={s.name}
        aria-current={active ? "true" : undefined}
        data-drop-id={s.id}
        data-drop-kind={nested ? "nested" : "server"}
        onPointerDown={startDrag(`s:${s.id}`)}
      >
        <span className="rail-badge">
          <ServerBadge name={s.name} src={s.iconUrl} size={nested ? 30 : 34} />
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

  /**
   * Dossier fermé : une tuile avec les premiers serveurs en petit (image ou initiales lisibles).
   * Au-delà de 4, la dernière case dit combien il en reste.
   */
  function folderPreview(items: ServerSummary[]) {
    const extra = items.length > 4 ? items.length - 3 : 0;
    const shown = extra ? items.slice(0, 3) : items.slice(0, 4);
    return (
      <span className={`folder-mini n${Math.min(items.length, 4)}`} aria-hidden="true">
        {shown.map((s) => (
          <ServerBadge key={s.id} name={s.name} src={s.iconUrl} size={items.length === 1 ? 24 : 15} />
        ))}
        {extra > 0 && <span className="folder-more">+{extra}</span>}
      </span>
    );
  }

  /** Fiche du dossier survolé : son nom et ses serveurs (avec qui est en vocal). */
  function peekCard() {
    if (!peek || dragging) return null;
    const f = layout.entries.find((e): e is Folder => e.kind === "folder" && e.id === peek.id);
    if (!f || f.open) return null;
    const items = f.servers.map((id) => byId.get(id)).filter((s): s is ServerSummary => !!s);
    return createPortal(
      <div
        className="popover folder-peek"
        style={{ left: peek.x, top: peek.y }}
        role="menu"
        aria-label={f.name}
        onMouseEnter={keepPeek}
        onMouseLeave={closePeekSoon}
      >
        <span className="folder-peek-title">
          <Icon name="folder" size={14} />
          <span className="ellipsis">{f.name}</span>
          <span className="muted small">{items.length}</span>
        </span>
        <div className="folder-peek-list">
          {items.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className={`folder-peek-item${mode === "servers" && s.id === activeId ? " on" : ""}`}
              onClick={() => (setPeek(null), props.onSelectServer(s.id))}
            >
              <ServerBadge name={s.name} src={s.iconUrl} size={22} />
              <span className="grow ellipsis">{s.name}</span>
              {s.inVoice > 0 && <span className={`rail-sub ${props.voiceServerId === s.id ? "teal" : "amber"}`}>{s.inVoice}</span>}
            </button>
          ))}
        </div>
        {!isGuest && <span className="hint">{t("Clic sur le dossier : le déplier · clic droit : renommer")}</span>}
      </div>,
      document.body,
    );
  }

  function folderBlock(f: Folder) {
    const items = f.servers.map((id) => byId.get(id)).filter((s): s is ServerSummary => !!s);
    const live = items.some((s) => s.inVoice > 0);
    const containsActive = items.some((s) => s.id === activeId);
    return (
      <div
        key={f.id}
        className={`rail-folder${f.open ? " open" : ""}${dropClass(f.id)}${dragging === `f:${f.id}` ? " drag-origin" : ""}`}
        data-drop-id={f.id}
        data-drop-kind="folder"
        data-drop-open={f.open ? "1" : undefined}
      >
        <div className="rail-folder-head">
          <button
            className={`rail-server folder${containsActive && !f.open ? " active" : ""}`}
            onClick={() => (setPeek(null), layout.toggleFolder(f.id))}
            aria-expanded={f.open}
            onPointerDown={startDrag(`f:${f.id}`)}
            aria-label={t("Dossier {0} : {1}", { 0: f.name, 1: items.map((s) => s.name).join(", ") })}
            onMouseEnter={(e) => {
              if (f.open || dragging || menu) return;
              keepPeek();
              const r = e.currentTarget.getBoundingClientRect();
              setPeek({ id: f.id, x: r.right + 6, y: r.top + r.height / 2 });
            }}
            onMouseLeave={closePeekSoon}
            onContextMenu={(e) => {
              if (isGuest) return;
              e.preventDefault();
              setPeek(null);
              setMenuPos({ x: e.clientX, y: e.clientY });
              setMenu(f.id);
            }}
          >
            <span className="rail-badge">
              {f.open ? (
                <span className="folder-icon">
                  <Icon name="folder" size={17} />
                </span>
              ) : (
                folderPreview(items)
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
              <div className="click-away" onClick={() => (setMenu(null), setRenaming(null))} />
              <div className="popover rail-folder-menu" role="menu" style={{ left: menuPos.x + 8, top: menuPos.y }}>
                {renaming === f.id ? (
                  <input
                    className="rail-rename"
                    defaultValue={f.name}
                    autoFocus
                    maxLength={32}
                    aria-label={t("Nom du dossier")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        layout.renameFolder(f.id, (e.target as HTMLInputElement).value);
                        setRenaming(null);
                        setMenu(null);
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenaming(null);
                        setMenu(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <span className="section-title">{f.name}</span>
                    <button role="menuitem" className="menu-item" onClick={() => setRenaming(f.id)}>
                      <Icon name="edit" size={16} /> {t("Renommer")}
                    </button>
                    <button role="menuitem" className="menu-item" onClick={() => (setMenu(null), layout.ungroup(f.id))}>
                      <Icon name="folder" size={16} /> {t("Défaire le dossier")}
                    </button>
                  </>
                )}
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
        <Logo size={30} />
        {!collapsed && (
          <span className="grow">
            <Wordmark size={18} />
          </span>
        )}
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

      <div className="rail-list" ref={listRef}>
        {ghost()}
        {peekCard()}
        {layout.entries.map((e) => {
          if (e.kind === "folder") return folderBlock(e);
          const s = byId.get(e.id);
          return s ? serverRow(s, false) : null;
        })}
        {dragging && (
          <span className={`rail-drop-end${over === "end" ? " on" : ""}`} title={t("Lâche ici pour sortir du dossier")}>
            {collapsed ? <Icon name="plus" size={15} /> : t("Lâche ici pour sortir du dossier")}
          </span>
        )}
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
        {props.onOpenDev && (
          <button className="icon-btn sm dev-btn" onClick={props.onOpenDev} aria-label={t("Outils de test")} title={t("Outils de test")}>
            <Icon name="flask" size={16} />
          </button>
        )}
        {!isGuest && (
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
