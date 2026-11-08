import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Api, Attachment, Gif, Message } from "../lib/api";
import GifPicker from "./GifPicker";
import type { Realtime } from "../lib/realtime";
import { errorMessage } from "../lib/ui";
import { VoiceRecorder, formatDuration, formatSize, MAX_VOICE_MS } from "../lib/voiceNote";
import { Avatar, Icon } from "./Brand";
import { AttachmentView, Lightbox } from "./Attachments";

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
const MAX_ATTACHMENTS = 10;

type Pending = {
  key: string;
  name: string;
  size: number;
  preview?: string;
  status: "uploading" | "ready" | "error";
  att?: Attachment;
  error?: string;
};

/** Dimensions d'une image (pour réserver sa place dans la discussion). */
function imageSize(src: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [recLevels, setRecLevels] = useState<number[]>([]);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifSending, setGifSending] = useState(false);

  async function sendGif(g: Gif) {
    setGifOpen(false);
    setGifSending(true);
    setError(undefined);
    try {
      const att = await api.attachGif(g);
      await post("", [att.id]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGifSending(false);
      inputRef.current?.focus();
    }
  }

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

  // ---- Pièces jointes en attente d'envoi ---------------------------------------
  function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (pending.length + list.length > MAX_ATTACHMENTS) {
      setError(`${MAX_ATTACHMENTS} pièces jointes maximum par message.`);
      return;
    }
    setError(undefined);
    for (const file of list) {
      const key = `${Date.now()}-${Math.random()}`;
      const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
      const preview = isImage ? URL.createObjectURL(file) : undefined;
      setPending((p) => [...p, { key, name: file.name || "image.png", size: file.size, preview, status: "uploading" }]);
      const update = (patch: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      (async () => {
        const dims = preview ? await imageSize(preview) : undefined;
        return api.uploadAttachment(file, { name: file.name || "image.png", ...dims });
      })()
        .then((att) => update({ status: "ready", att }))
        .catch((e) => update({ status: "error", error: errorMessage(e) }));
    }
    inputRef.current?.focus();
  }

  function removePending(key: string) {
    setPending((p) => {
      const item = p.find((x) => x.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return p.filter((x) => x.key !== key);
    });
  }

  async function post(content: string, attachmentIds: string[]) {
    stickToBottom.current = true;
    const msg = await api.sendMessage(scope, target, content, attachmentIds);
    setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
  }

  async function send() {
    const content = draft.trim();
    if (pending.some((p) => p.status === "uploading")) return;
    const ready = pending.filter((p) => p.status === "ready" && p.att);
    if (!content && ready.length === 0) return;
    const before = pending;
    setDraft("");
    setPending([]);
    setError(undefined);
    try {
      await post(content, ready.map((p) => p.att!.id));
      before.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    } catch (err) {
      setDraft(content);
      setPending(before);
      setError(errorMessage(err));
    }
  }

  // ---- Message vocal -------------------------------------------------------
  async function startRecording() {
    setError(undefined);
    const rec = new VoiceRecorder();
    rec.onLevel = (level, ms) => {
      setRecLevels((l) => [...l.slice(-39), level]);
      setRecMs(ms);
    };
    rec.onAutoStop = () => void stopRecording(true);
    try {
      await rec.start();
      recorder.current = rec;
      setRecMs(0);
      setRecLevels([]);
      setRecording(true);
    } catch {
      setError("Micro indisponible : vérifie qu'il est branché et autorisé.");
    }
  }

  async function stopRecording(sendIt: boolean) {
    const rec = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!rec) return;
    if (!sendIt) return rec.cancel();
    const note = await rec.stop();
    if (!note) return setError("Message vocal trop court.");
    try {
      const att = await api.uploadAttachment(note.blob, { name: "message-vocal.webm", durationMs: note.durationMs, waveform: note.waveform });
      await post("", [att.id]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Quitter la conversation pendant un enregistrement l'annule.
  useEffect(() => () => recorder.current?.cancel(), [scope, target]);

  // Regroupe les messages consécutifs d'une même personne
  const rows: ReactNode[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
    if (newDay) rows.push(<div key={`d-${m.id}`} className="day-sep"><span>{dayLabel(m.createdAt)}</span></div>);
    const grouped = !newDay && prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_MS;
    const canDelete = m.authorId === myId || props.canModerate;
    rows.push(
      <div key={m.id} className={`msg${grouped ? " grouped" : ""}${m.authorId === myId ? " mine" : ""}`}>
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
          {m.content && <div className="msg-text">{renderContent(m.content)}</div>}
          {!!m.attachments?.length && (
            <div className="msg-attachments">
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} api={api} att={a} onOpenImage={(src, name) => setLightbox({ src, name })} />
              ))}
            </div>
          )}
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

  const uploading = pending.some((p) => p.status === "uploading");
  const canSend = !uploading && (!!draft.trim() || pending.some((p) => p.status === "ready"));

  return (
    <section
      className={`chat${props.compact ? " compact" : ""}${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="drop-hint" aria-hidden="true">
          <Icon name="paperclip" size={22} /> Lâche pour joindre
        </div>
      )}
      {lightbox && <Lightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />}
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
      {pending.length > 0 && (
        <div className="pending-list" aria-label="Pièces jointes à envoyer">
          {pending.map((p) => (
            <div key={p.key} className={`pending ${p.status}`} title={p.error ?? p.name}>
              {p.preview ? <img src={p.preview} alt="" /> : <Icon name="file" size={18} />}
              <span className="col gap-2 grow" style={{ minWidth: 0 }}>
                <span className="ellipsis small strong-ish">{p.name}</span>
                <span className={`small ${p.status === "error" ? "error" : "muted"}`}>
                  {p.status === "uploading" ? "envoi…" : p.status === "error" ? p.error : formatSize(p.size)}
                </span>
              </span>
              <button type="button" className="icon-btn sm" onClick={() => removePending(p.key)} aria-label={`Retirer ${p.name}`}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {gifOpen && <GifPicker api={api} onPick={sendGif} onClose={() => setGifOpen(false)} />}

      {recording ? (
        <div className="composer recording" role="group" aria-label="Enregistrement d'un message vocal">
          <button type="button" className="icon-btn rec-cancel" onClick={() => stopRecording(false)} aria-label="Annuler l'enregistrement" title="Annuler">
            <Icon name="trash" size={18} />
          </button>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-time">{formatDuration(recMs)}</span>
          <span className="rec-wave" aria-hidden="true">
            {recLevels.map((l, i) => (
              <span key={i} style={{ height: `${4 + l * 22}px` }} />
            ))}
          </span>
          <span className="muted small rec-left">{formatDuration(MAX_VOICE_MS - recMs)} restantes</span>
          <button type="button" className="icon-btn send ready" onClick={() => stopRecording(true)} aria-label="Envoyer le message vocal" title="Envoyer">
            <Icon name="send" size={18} />
          </button>
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Joindre un fichier ou une image" title="Joindre un fichier (ou glisse-le ici)">
            <Icon name="paperclip" size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
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
          <button
            type="button"
            className={`gif-btn${gifOpen ? " on" : ""}`}
            onClick={() => setGifOpen(!gifOpen)}
            disabled={gifSending}
            aria-label="Choisir un GIF"
            aria-expanded={gifOpen}
            title="GIF"
          >
            {gifSending ? "…" : "GIF"}
          </button>
          {canSend || uploading ? (
            <button type="submit" className="icon-btn send ready" disabled={!canSend} aria-label="Envoyer" title={uploading ? "Envoi des fichiers…" : "Envoyer (Entrée)"}>
              <Icon name="send" size={18} />
            </button>
          ) : (
            <button type="button" className="icon-btn send" onClick={startRecording} aria-label="Enregistrer un message vocal" title="Message vocal">
              <Icon name="mic" size={18} />
            </button>
          )}
        </form>
      )}
    </section>
  );
}
