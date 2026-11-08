import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Api, Attachment, Gif, Message } from "../lib/api";
import GifPicker from "./GifPicker";
import type { Realtime } from "../lib/realtime";
import { errorMessage } from "../lib/ui";
import { VoiceRecorder, formatDuration, formatSize, MAX_VOICE_MS } from "../lib/voiceNote";
import { Icon, UserAvatar, useDisplayName } from "./Brand";

/** Nom de l'auteur, à jour (nom affiché du profil), cliquable pour ouvrir sa fiche. */
function AuthorName({ id, name, onOpen }: { id: string | null; name: string; onOpen?: (id: string) => void }) {
  const shown = useDisplayName(id, name);
  if (!id || !onOpen) return <strong>{shown}</strong>;
  return (
    <button className="plain-btn author" onClick={() => onOpen(id)}>
      <strong>{shown}</strong>
    </button>
  );
}
import { AttachmentView, Lightbox } from "./Attachments";
import {
  EmojiPicker,
  MentionSuggest,
  MessageText,
  MessageToolbar,
  Reactions,
  fromTokens,
  mentionsMe,
  toTokens,
  type Mentionable,
} from "./MessageParts";

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
  /** Demande de message : liens désactivés, fichiers masqués */
  masked?: boolean;
  /** Pas de champ d'écriture (demande pas encore acceptée) */
  hideComposer?: boolean;
  /** Clic sur l'avatar ou le nom de quelqu'un */
  onOpenProfile?: (userId: string) => void;
  /** Personnes qu'on peut @mentionner ici */
  mentionables?: Mentionable[];
  /** Je suis en vocal dans ce serveur (les @vocal me concernent) */
  inVoiceHere?: boolean;
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
      if (e.type === "messageEdited" && e.message.scope === scope && e.message.target === stored) {
        setMessages((list) => list.map((m) => (m.id === e.message.id ? e.message : m)));
      }
      if (e.type === "reactions" && e.scope === scope && e.target === stored) {
        setMessages((list) => list.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)));
      }
    });
  }, [realtime, scope, stored]);

  // ---- Réactions, modification, mentions -------------------------------------
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const chosen = useRef(new Map<string, string>()); // « Nom » → id, pour les mentions choisies
  const [suggest, setSuggest] = useState<{ query: string; start: number; index: number } | null>(null);

  async function react(messageId: string, emoji: string) {
    setPickerFor(null);
    try {
      const r = await api.react(messageId, emoji);
      setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, reactions: r.reactions } : m)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function startEdit(m: Message) {
    setEditing({ id: m.id, text: fromTokens(m.content, chosen.current) });
  }

  async function saveEdit() {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    try {
      const msg = await api.editMessage(id, toTokens(text.trim(), chosen.current));
      setMessages((list) => list.map((m) => (m.id === id ? msg : m)));
    } catch (e) {
      setError(errorMessage(e));
    }
    inputRef.current?.focus();
  }

  const mentionables: Mentionable[] = [
    ...(props.mentionables ?? []).filter((m) => m.id !== myId),
    ...(scope === "dm" ? [] : [{ id: "vocal", name: "vocal", hint: "ceux en vocal" }]),
    ...(scope !== "dm" && props.canModerate ? [{ id: "tous", name: "tous", hint: "tout le serveur" }] : []),
  ];
  const suggestions = suggest
    ? mentionables.filter((m) => m.name.toLowerCase().startsWith(suggest.query.toLowerCase())).slice(0, 6)
    : [];

  /** Repère « @mot » juste avant le curseur pour proposer des mentions. */
  function updateSuggest(value: string, caret: number) {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\p{L}\p{N}_.\- ]{0,24})$/u.exec(before);
    if (!m || m[2].includes("  ")) return setSuggest(null);
    setSuggest({ query: m[2], start: caret - m[2].length - 1, index: 0 });
  }

  function insertMention(m: Mentionable) {
    if (!suggest) return;
    const label = m.id === "vocal" || m.id === "tous" ? m.id : m.name;
    if (m.id !== "vocal" && m.id !== "tous") chosen.current.set(m.name, m.id);
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, suggest.start)}@${label} ${draft.slice(caret)}`;
    setDraft(next);
    setSuggest(null);
    requestAnimationFrame(() => {
      const pos = suggest.start + label.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  function mentionAuthor(m: Message) {
    const name = props.mentionables?.find((x) => x.id === m.authorId)?.name ?? m.authorName;
    chosen.current.set(name, m.authorId);
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${name} `);
    inputRef.current?.focus();
  }

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
    const content = toTokens(draft.trim(), chosen.current);
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
    const mine = m.authorId === myId;
    const canDelete = mine || !!props.canModerate;
    const isEditing = editing?.id === m.id;
    const forMe = !mine && mentionsMe(m.content, myId, props.inVoiceHere);
    const remove = () => api.deleteMessage(m.id).then(() => setMessages((l) => l.filter((x) => x.id !== m.id))).catch((e) => setError(errorMessage(e)));
    rows.push(
      <div key={m.id} className={`msg${grouped ? " grouped" : ""}${mine ? " mine" : ""}${forMe ? " for-me" : ""}`}>
        {grouped ? (
          <span className="msg-time-gutter">{timeLabel(m.createdAt)}</span>
        ) : (
          <button className="plain-btn" onClick={() => !m.guest && props.onOpenProfile?.(m.authorId)} aria-label={`Profil de ${m.authorName}`} tabIndex={m.guest ? -1 : 0}>
            <UserAvatar userId={m.guest ? null : m.authorId} name={m.authorName} size={36} />
          </button>
        )}
        <div className="msg-body">
          {!grouped && (
            <div className="msg-head">
              <AuthorName id={m.guest ? null : m.authorId} name={m.authorName} onOpen={props.onOpenProfile} />
              {m.guest && <span className="role-tag">Invité</span>}
              <time>{timeLabel(m.createdAt)}</time>
            </div>
          )}
          {isEditing ? (
            <div className="msg-edit">
              <textarea
                value={editing.text}
                autoFocus
                maxLength={2000}
                aria-label="Modifier le message"
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), saveEdit());
                  if (e.key === "Escape") setEditing(null);
                }}
              />
              <span className="small muted">Entrée pour enregistrer · Échap pour annuler</span>
            </div>
          ) : (
            m.content && (
              <div className={`msg-text${props.masked ? " masked" : ""}`}>
                <MessageText text={m.content} myId={myId} masked={props.masked} onOpenProfile={props.onOpenProfile} />
              </div>
            )
          )}
          {m.editedAt && !isEditing && <span className="edited">modifié</span>}
          {props.masked && !!m.attachments?.length && (
            <span className="masked-note">
              {m.attachments.length} fichier{m.attachments.length > 1 ? "s" : ""} masqué{m.attachments.length > 1 ? "s" : ""} jusqu'à ce que tu acceptes
            </span>
          )}
          {!props.masked && !!m.attachments?.length && (
            <div className="msg-attachments">
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} api={api} att={a} onOpenImage={(src, name) => setLightbox({ src, name })} />
              ))}
            </div>
          )}
          {!props.masked && (
            <Reactions reactions={m.reactions ?? []} myId={myId} onToggle={(e) => react(m.id, e)} onAdd={() => setPickerFor(m.id)} />
          )}
          {pickerFor === m.id && <EmojiPicker onPick={(e) => react(m.id, e)} onClose={() => setPickerFor(null)} />}
        </div>
        {!props.masked && !isEditing && (
          <MessageToolbar
            mine={mine}
            canDelete={canDelete}
            onReact={(e) => react(m.id, e)}
            onMore={() => setPickerFor(m.id)}
            onEdit={() => startEdit(m)}
            onDelete={remove}
            onMention={!m.guest && !props.hideComposer ? () => mentionAuthor(m) : undefined}
          />
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
      {!props.hideComposer && pending.length > 0 && (
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

      {props.hideComposer ? null : recording ? (
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
          {suggest && suggestions.length > 0 && <MentionSuggest items={suggestions} index={suggest.index} onPick={insertMention} />}
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
            onChange={(e) => {
              setDraft(e.target.value);
              updateSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onBlur={() => setSuggest(null)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              // Suggestions de mentions ouvertes : flèches pour choisir, Tab / Entrée pour insérer
              if (suggest && suggestions.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setSuggest({ ...suggest, index: (suggest.index + d + suggestions.length) % suggestions.length });
                  return;
                }
                if (e.key === "Tab" || e.key === "Enter") {
                  e.preventDefault();
                  insertMention(suggestions[suggest.index] ?? suggestions[0]);
                  return;
                }
                if (e.key === "Escape") return setSuggest(null);
              }
              // Flèche ↑ dans un champ vide : modifier mon dernier message
              if (e.key === "ArrowUp" && !draft) {
                const last = [...messages].reverse().find((m) => m.authorId === myId && m.content);
                if (last) {
                  e.preventDefault();
                  startEdit(last);
                  return;
                }
              }
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
