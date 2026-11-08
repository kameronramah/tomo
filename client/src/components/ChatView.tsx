import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Api, Message } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { errorMessage } from "../lib/ui";
import { Avatar, Icon } from "./Brand";

type Props = {
  api: Api;
  realtime: Realtime | null;
  scope: Message["scope"];
  /** id du salon textuel / salon vocal, ou id de l'ami pour un message privé */
  target: string;
  /** clé de stockage côté serveur pour les messages privés ("idA:idB") */
  storedTarget?: string;
  myId: string;
  canModerate?: boolean;
  placeholder: string;
  header?: ReactNode;
  emptyText?: string;
  compact?: boolean;
};

const GROUP_MS = 5 * 60 * 1000;

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Rend les liens cliquables, le reste en texte brut (pas de HTML injecté). */
function renderContent(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function ChatView(props: Props) {
  const { api, realtime, scope, target, myId } = props;
  const stored = props.storedTarget ?? target;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Chargement initial
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setError(undefined);
    api
      .messages(scope, target)
      .then((m) => {
        if (!alive) return;
        setMessages(m);
        setHasMore(m.length >= 50);
        stickToBottom.current = true;
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    inputRef.current?.focus();
    return () => {
      alive = false;
    };
  }, [scope, target]);

  // Messages en direct
  useEffect(() => {
    if (!realtime) return;
    return realtime.on((e) => {
      if (e.type === "message" && e.message.scope === scope && e.message.target === stored) {
        setMessages((list) => (list.some((m) => m.id === e.message.id) ? list : [...list, e.message]));
      }
      if (e.type === "messageDeleted" && e.scope === scope && e.target === stored) {
        setMessages((list) => list.filter((m) => m.id !== e.id));
      }
    });
  }, [realtime, scope, stored]);

  // Reste collé en bas quand on y était
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const older = await api.messages(scope, target, first.createdAt).catch(() => []);
    setHasMore(older.length >= 50);
    stickToBottom.current = false;
    setMessages((list) => [...older, ...list]);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setError(undefined);
    stickToBottom.current = true;
    try {
      const msg = await api.sendMessage(scope, target, content);
      setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
    } catch (err) {
      setDraft(content);
      setError(errorMessage(err));
    }
  }

  // Regroupe les messages consécutifs d'une même personne
  const rows: ReactNode[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
    if (newDay) rows.push(<div key={`d-${m.id}`} className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>);
    const grouped = !newDay && prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_MS;
    const canDelete = m.authorId === myId || props.canModerate;
    rows.push(
      <div key={m.id} className={`msg${grouped ? " grouped" : ""}`}>
        {grouped ? (
          <span className="msg-time-gutter">{timeLabel(m.createdAt)}</span>
        ) : (
          <Avatar name={m.authorName} size={36} />
        )}
        <div className="msg-body">
          {!grouped && (
            <div className="msg-head">
              <strong>{m.authorName}</strong>
              {m.guest && <span className="role-tag">Invité</span>}
              <time>{timeLabel(m.createdAt)}</time>
            </div>
          )}
          <div className="msg-text">{renderContent(m.content)}</div>
        </div>
        {canDelete && (
          <button
            className="icon-btn sm msg-delete"
            aria-label="Supprimer le message"
            title="Supprimer"
            onClick={() => api.deleteMessage(m.id).then(() => setMessages((l) => l.filter((x) => x.id !== m.id))).catch((e) => setError(errorMessage(e)))}
          >
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>,
    );
    prev = m;
  }

  return (
    <section className={`chat${props.compact ? " compact" : ""}`}>
      {props.header}
      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {hasMore && (
          <button className="btn small load-older" onClick={loadOlder}>
            Charger les messages précédents
          </button>
        )}
        {loading && <p className="muted small pad">Chargement…</p>}
        {!loading && messages.length === 0 && <p className="chat-empty muted">{props.emptyText ?? "Aucun message pour l'instant."}</p>}
        {rows}
      </div>
      {error && <p className="error small chat-error">{error}</p>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={props.placeholder}
          rows={1}
          maxLength={2000}
          aria-label={props.placeholder}
        />
        <button type="submit" className="icon-btn send" disabled={!draft.trim()} aria-label="Envoyer" title="Envoyer (Entrée)">
          <Icon name="send" size={18} />
        </button>
      </form>
    </section>
  );
}
