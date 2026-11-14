import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Api, Person, SearchFilters, SearchHit, ServerDetail } from "../lib/api";
import { STATUS_LABEL } from "../lib/people";
import { errorMessage } from "../lib/ui";
import { Icon, UserAvatar, useDisplayName, type IconName } from "./Brand";
import { MessageText } from "./MessageParts";
import { locale, t } from "../lib/i18n";

/** Minuscules sans accents, pour comparer « Léa » et « lea ». */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function when(ts: number) {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }) +
    " · " + d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

/** Texte d'un résultat, avec le mot cherché surligné (si le message est du texte simple). */
function HitText({ text, query, myId }: { text: string; query: string; myId: string }) {
  const q = fold(query.trim());
  if (!q || /<@|https?:\/\//.test(text)) return <MessageText text={text} myId={myId} />;
  // On cherche dans la version sans accents, mais on découpe le texte d'origine (même longueur lettre à lettre).
  const folded = [...text].map((c) => fold(c)).join("");
  if (folded.length !== text.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let from = 0;
  for (let i = folded.indexOf(q); i !== -1; i = folded.indexOf(q, i + q.length)) {
    out.push(text.slice(from, i), <mark key={i}>{text.slice(i, i + q.length)}</mark>);
    from = i + q.length;
  }
  out.push(text.slice(from));
  return <>{out}</>;
}

function Author({ id, name }: { id: string; name: string }) {
  return <strong className="ellipsis">{useDisplayName(id, name)}</strong>;
}

const HAS: { value: NonNullable<SearchFilters["has"]>; label: string; icon: IconName }[] = [
  { value: "image", label: "Images", icon: "image" },
  { value: "gif", label: "GIF", icon: "smile" },
  { value: "audio", label: "Vocaux et clips", icon: "mic" },
  { value: "file", label: "Fichiers", icon: "file" },
  { value: "link", label: "Liens", icon: "paperclip" },
];

type MenuOption = { value: string; label: string; group?: string; userId?: string; icon?: IconName };

/**
 * Filtre en pilule qui ouvre un petit menu (à la place d'une liste déroulante du système, pas assortie à Tomo).
 * Clavier : flèches, Entrée, Échap ; on peut taper pour filtrer quand la liste est longue.
 */
function FilterMenu({
  icon,
  label,
  value,
  anyLabel,
  options,
  searchable,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: string | undefined;
  anyLabel: string;
  options: MenuOption[];
  searchable?: boolean;
  onChange: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const fq = fold(filter.trim());
  const shown = fq ? options.filter((o) => fold(o.label).includes(fq)) : options;
  const showSearch = !!searchable && options.length > 6;

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current!.getBoundingClientRect();
    // Sous la pilule, sans sortir de la fenêtre
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 256)), top: r.bottom + 6 });
    setFilter("");
    setOpen(true);
  }

  // À l'ouverture : focus sur le choix actuel (ou le champ de filtre) ; clic ailleurs = fermer
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    (menu?.querySelector<HTMLElement>(showSearch ? "input" : ".filter-option.on") ?? menu?.querySelector<HTMLElement>(".filter-option"))?.focus();
    const away = (e: MouseEvent) => {
      if (!menu?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, showSearch]);

  function choose(v: string | undefined) {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // ferme le menu, pas toute la recherche
      setOpen(false);
      btnRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(".filter-option") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
    items[next]?.focus();
  }

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={btnRef}
        className={`search-filter${value ? " on" : ""}${open ? " open" : ""}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
      >
        <Icon name={icon} size={14} />
        <span className="ellipsis">{current?.label ?? anyLabel}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div ref={menuRef} className="filter-menu" style={{ left: pos.left, top: pos.top }} role="listbox" aria-label={label} onKeyDown={onKey}>
          {showSearch && (
            <input
              className="filter-menu-search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && shown[0] && choose(shown[0].value)}
              placeholder={t("Filtrer…")}
              aria-label={t("Filtrer…")}
            />
          )}
          <div className="filter-menu-list">
            {!fq && (
              <button className={`filter-option${!value ? " on" : ""}`} role="option" aria-selected={!value} onClick={() => choose(undefined)}>
                <span className="grow ellipsis">{anyLabel}</span>
                {!value && <Icon name="check" size={15} />}
              </button>
            )}
            {shown.map((o) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value} className="col">
                  {head && <span className="filter-menu-group">{head}</span>}
                  <button className={`filter-option${o.value === value ? " on" : ""}`} role="option" aria-selected={o.value === value} onClick={() => choose(o.value)}>
                    {o.userId && <UserAvatar userId={o.userId} name={o.label} size={22} />}
                    {o.icon && <Icon name={o.icon} size={15} />}
                    <span className="grow ellipsis">{o.label}</span>
                    {o.value === value && <Icon name="check" size={15} />}
                  </button>
                </div>
              );
            })}
            {shown.length === 0 && <span className="muted small pad">{t("Personne ne correspond.")}</span>}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Recherche dans un serveur : les membres (par nom) et les messages des fils et des chats vocaux,
 * avec des filtres (qui, où, quoi, quand, me mentionne).
 */
export default function ServerSearch({
  api,
  detail,
  people,
  myId,
  initialQuery = "",
  onOpenProfile,
  onOpenMessage,
  onClose,
}: {
  api: Api;
  detail: ServerDetail;
  people: Person[];
  myId: string;
  initialQuery?: string;
  onOpenProfile: (userId: string) => void;
  /** Aller au message (fil, ou chat d'une pièce). */
  onOpenMessage: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [f, setF] = useState<Omit<SearchFilters, "q">>({});
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = !!(f.from || f.in || f.has || f.mentions || f.when);
  const active = q.trim().length > 0 || filtered;

  // Recherche des messages, avec un petit délai (pas une requête par lettre)
  useEffect(() => {
    const id = ++reqId.current;
    setError(undefined);
    if (!active) {
      setHits([]);
      setHasMore(false);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      api
        .searchMessages(detail.id, { ...f, q: q.trim() || undefined })
        .then((r) => {
          if (id !== reqId.current) return;
          setHits(r.results);
          setHasMore(r.hasMore);
        })
        .catch((e) => id === reqId.current && setError(errorMessage(e)))
        .finally(() => id === reqId.current && setBusy(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [api, detail.id, q, f, active]);

  async function more() {
    const last = hits[hits.length - 1];
    if (!last) return;
    const id = reqId.current;
    setBusy(true);
    try {
      const r = await api.searchMessages(detail.id, { ...f, q: q.trim() || undefined }, last.createdAt);
      if (id !== reqId.current) return;
      setHits((h) => [...h, ...r.results]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }

  // Membres : seulement quand on cherche un nom (pas avec les filtres de messages)
  const fq = fold(q.trim());
  const members = fq && !filtered
    ? people
        .filter((p) => fold(p.displayName).includes(fq) || fold(p.username).includes(fq))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
    : [];

  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));
  const accounts = people.filter((p) => !p.guest).sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t("Rechercher dans {0}", { 0: detail.name })}>
        <div className="search-field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Rechercher dans {0}", { 0: detail.name })}
            aria-label={t("Rechercher des messages ou des membres")}
            maxLength={100}
          />
          {q && (
            <button className="icon-btn sm" onClick={() => (setQ(""), inputRef.current?.focus())} aria-label={t("Effacer")} title={t("Effacer")}>
              <Icon name="x" size={14} />
            </button>
          )}
          <button className="btn small soft" onClick={onClose}>
            {t("Fermer")}
          </button>
        </div>

        <div className="search-filters" role="group" aria-label={t("Filtres")}>
          <FilterMenu
            icon="users"
            label={t("Écrit par")}
            value={f.from}
            onChange={(v) => set({ from: v })}
            anyLabel={t("Tout le monde")}
            searchable
            options={accounts.map((p) => ({ value: p.id, label: p.id === myId ? t("Moi") : p.displayName, userId: p.id }))}
          />
          <FilterMenu
            icon="layers"
            label={t("Où")}
            value={f.in}
            onChange={(v) => set({ in: v })}
            anyLabel={t("Partout")}
            options={[
              ...detail.channels.map((c) => ({ value: c.id, label: `# ${c.name}`, group: t("Fils") })),
              ...detail.rooms.map((r) => ({ value: r.id, label: r.label, group: t("Chats des pièces") })),
            ]}
          />
          <FilterMenu
            icon="paperclip"
            label={t("Contient")}
            value={f.has}
            onChange={(v) => set({ has: v as SearchFilters["has"] })}
            anyLabel={t("Tous les messages")}
            options={HAS.map((h) => ({ value: h.value, label: t(h.label), icon: h.icon }))}
          />
          <FilterMenu
            icon="calendar"
            label={t("Quand")}
            value={f.when}
            onChange={(v) => set({ when: v as SearchFilters["when"] })}
            anyLabel={t("N'importe quand")}
            options={[
              { value: "day", label: t("Dernières 24 h") },
              { value: "week", label: t("7 derniers jours") },
              { value: "month", label: t("30 derniers jours") },
            ]}
          />
          <button
            className={`search-filter${f.mentions ? " on" : ""}`}
            onClick={() => set({ mentions: f.mentions ? undefined : "me" })}
            aria-pressed={!!f.mentions}
          >
            <Icon name="at" size={14} /> {t("Me mentionne")}
          </button>
          {filtered && (
            <button className="plain-btn search-reset" onClick={() => setF({})}>
              {t("Retirer les filtres")}
            </button>
          )}
        </div>

        <div className="search-results">
          {!active && (
            <div className="search-empty">
              <Icon name="search" size={22} />
              <p className="muted">{t("Cherche un membre ou un message, ou choisis un filtre (qui, où, quoi, quand).")}</p>
            </div>
          )}

          {members.length > 0 && (
            <>
              <span className="section-title">
                {t("Membres")} · {members.length}
              </span>
              <div className="search-members">
                {members.slice(0, 8).map((p) => (
                  <button key={p.id} className="search-member" onClick={() => !p.guest && onOpenProfile(p.id)} disabled={p.guest}>
                    <UserAvatar userId={p.guest ? null : p.id} name={p.displayName} size={32} showStatus={!p.guest} />
                    <span className="col left" style={{ minWidth: 0 }}>
                      <span className="ellipsis strong-ish">{p.displayName}</span>
                      <span className="muted small ellipsis">{p.room ? p.room.label : STATUS_LABEL[p.status]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {active && (
            <span className="section-title">
              {t("Messages")}
              {!busy && !error && ` · ${hits.length}${hasMore ? "+" : ""}`}
            </span>
          )}
          {error && <p className="error small">{error}</p>}
          {active && !busy && !error && hits.length === 0 && <p className="muted small pad">{t("Aucun message ne correspond.")}</p>}
          {hits.map((h) => (
            /* Pas un <button> : le texte peut contenir des @mentions cliquables (bouton dans un bouton interdit) */
            <div
              key={h.id}
              className="search-hit"
              role="button"
              tabIndex={0}
              onClick={() => onOpenMessage(h)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onOpenMessage(h))}
              title={t("Aller au message")}
            >
              <UserAvatar userId={h.guest ? null : h.authorId} name={h.authorName} size={32} />
              <span className="search-hit-body">
                <span className="search-hit-head">
                  <Author id={h.authorId} name={h.authorName} />
                  <span className="search-place">
                    {h.place.kind === "channel" ? `# ${h.place.name}` : t("Pièce {0}", { 0: h.place.name })}
                  </span>
                  <time className="muted small">{when(h.createdAt)}</time>
                </span>
                {h.content && (
                  <span className="search-hit-text">
                    <HitText text={h.content} query={q} myId={myId} />
                  </span>
                )}
                {(h.attachments ?? []).length > 0 && (
                  <span className="search-atts">
                    {(h.attachments ?? []).map((a) => (
                      <span key={a.id} className="chip">
                        <Icon name={a.kind === "image" ? "image" : a.kind === "audio" ? "mic" : "file"} size={12} />
                        {a.mime === "image/gif" ? t("GIF") : a.kind === "audio" ? t("Audio") : a.name}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          ))}
          {hasMore && (
            <button className="btn small soft search-more" onClick={more} disabled={busy}>
              {t("Voir plus")}
            </button>
          )}
          {busy && <p className="muted small pad">{t("Recherche…")}</p>}
        </div>
      </div>
    </div>
  );
}
