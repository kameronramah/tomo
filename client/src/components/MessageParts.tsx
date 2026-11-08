/**
 * Morceaux de la discussion : texte avec mentions, réactions, barre d'actions au survol,
 * sélecteur d'emoji et suggestions de @mentions.
 *
 * Mentions : dans les messages, une mention est un jeton <@id-du-compte>, <@vocal> ou <@tous>.
 * Dans le champ d'écriture on voit « @Sora » ; la conversion se fait à l'envoi (toTokens).
 */
import { useEffect, useState } from "react";
import type { Reaction } from "../lib/api";
import { getPerson, usePeople } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";
import { t } from "../lib/i18n";

export const QUICK_REACTIONS = ["👍", "😂", "🔥"];
export const EMOJIS = [
  "👍", "👎", "😂", "🤣", "😍", "😮", "😢", "😡", "🔥", "💀", "🎉", "👏",
  "🙏", "💯", "❤️", "👀", "🤔", "😎", "🥲", "🫡", "✅", "❌", "👑", "🍿",
  "😴", "🤯", "🥶", "🤝", "💪", "🎯", "🏆", "⚡",
];

const TOKEN_RE = /<@([0-9a-f-]{36}|vocal|tous)>/g;

/** Le message me concerne-t-il ? (mention directe, @tous, ou @vocal si je suis en vocal) */
export function mentionsMe(text: string, myId: string, inVoiceHere = false) {
  return text.includes(`<@${myId}>`) || text.includes("<@tous>") || (inVoiceHere && text.includes("<@vocal>"));
}

/** Champ d'écriture → message : « @Sora » (choisi dans la liste) devient <@id>. */
export function toTokens(text: string, chosen: Map<string, string>) {
  let out = text;
  const names = [...chosen.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) out = out.split(`@${name}`).join(`<@${chosen.get(name)}>`);
  return out.replace(/(^|\s)@(vocal|tous)\b/g, "$1<@$2>");
}

/** Message → champ d'écriture (pour le modifier) : <@id> redevient « @Nom ». */
export function fromTokens(text: string, chosen: Map<string, string>) {
  return text.replace(TOKEN_RE, (_m, id: string) => {
    if (id === "vocal" || id === "tous") return `@${id}`;
    const name = getPerson(id)?.displayName ?? "quelqu'un";
    chosen.set(name, id);
    return `@${name}`;
  });
}

/** Texte d'un message : liens cliquables, mentions en pastilles, rien d'autre (pas de HTML). */
export function MessageText({ text, myId, masked, onOpenProfile }: { text: string; myId: string; masked?: boolean; onOpenProfile?: (id: string) => void }) {
  const ids = [...text.matchAll(TOKEN_RE)].map((m) => m[1]).filter((x) => x !== "vocal" && x !== "tous");
  usePeople(ids);
  const parts = text.split(/(<@(?:[0-9a-f-]{36}|vocal|tous)>|https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^<@([0-9a-f-]{36}|vocal|tous)>$/.exec(p);
        if (m) {
          const id = m[1];
          if (id === "vocal" || id === "tous") return <span key={i} className="mention all">@{id}</span>;
          const name = getPerson(id)?.displayName ?? "quelqu'un";
          return (
            <button key={i} className={`mention${id === myId ? " me" : ""}`} onClick={() => onOpenProfile?.(id)}>
              @{name}
            </button>
          );
        }
        if (/^https?:\/\//.test(p) && !masked)
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer noopener">
              {p}
            </a>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Réactions sous un message. */
export function Reactions({ reactions, myId, onToggle, onAdd }: { reactions: Reaction[]; myId: string; onToggle: (emoji: string) => void; onAdd: () => void }) {
  usePeople(reactions.flatMap((r) => r.userIds));
  if (reactions.length === 0) return null;
  return (
    <div className="reactions">
      {reactions.map((r) => {
        const mine = r.userIds.includes(myId);
        const who = r.userIds.map((id) => (id === myId ? "toi" : getPerson(id)?.displayName ?? "quelqu'un")).join(", ");
        return (
          <button key={r.emoji} className={`react${mine ? " mine" : ""}`} aria-pressed={mine} title={who} onClick={() => onToggle(r.emoji)}>
            <span className="react-emoji">{r.emoji}</span> {r.count}
          </button>
        );
      })}
      <button className="react add" onClick={onAdd} aria-label={t("Ajouter une réaction")} title={t("Ajouter une réaction")}>
        <Icon name="smile" size={14} />+
      </button>
    </div>
  );
}

/** Sélecteur d'emoji (petite grille). */
export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="click-away" onClick={onClose} />
      <div className="popover emoji-picker" role="dialog" aria-label={t("Choisir une réaction")}>
        {EMOJIS.map((e) => (
          <button key={e} className="emoji-cell" onClick={() => onPick(e)} aria-label={t("Réagir {0}", { 0: e })}>
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

/** Barre d'actions au survol d'un message. */
export function MessageToolbar({
  mine,
  canDelete,
  onReact,
  onMore,
  onEdit,
  onDelete,
  onMention,
}: {
  mine: boolean;
  canDelete: boolean;
  onReact: (emoji: string) => void;
  onMore: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMention?: () => void;
}) {
  return (
    <div className="msg-toolbar" role="toolbar" aria-label={t("Actions sur le message")}>
      {QUICK_REACTIONS.map((e) => (
        <button key={e} className="tb-btn" onClick={() => onReact(e)} aria-label={t("Réagir {0}", { 0: e })}>
          {e}
        </button>
      ))}
      <button className="tb-btn" onClick={onMore} aria-label={t("Plus de réactions")} title={t("Plus de réactions")}>
        <Icon name="smile" size={16} />
      </button>
      <span className="tb-sep" />
      {!mine && onMention && (
        <button className="tb-btn" onClick={onMention} aria-label={t("Mentionner")} title={t("Mentionner")}>
          @
        </button>
      )}
      {mine && (
        <button className="tb-btn" onClick={onEdit} aria-label={t("Modifier")} title={t("Modifier")}>
          <Icon name="edit" size={15} />
        </button>
      )}
      {canDelete && (
        <button className="tb-btn danger" onClick={onDelete} aria-label={t("Supprimer")} title={t("Supprimer")}>
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );
}

export type Mentionable = { id: string; name: string; hint?: string };

/** Liste de suggestions quand on tape « @… ». */
export function MentionSuggest({
  items,
  index,
  onPick,
}: {
  items: Mentionable[];
  index: number;
  onPick: (m: Mentionable) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="mention-suggest" role="listbox" aria-label={t("Mentionner quelqu'un")}>
      {items.map((m, i) => (
        <button
          key={m.id}
          role="option"
          aria-selected={i === (hover ?? index)}
          className={`mention-opt${i === (hover ?? index) ? " on" : ""}`}
          onMouseEnter={() => setHover(i)}
          onMouseDown={(e) => (e.preventDefault(), onPick(m))}
        >
          {m.id === "vocal" || m.id === "tous" ? (
            <span className={`mention-group ${m.id}`}>@</span>
          ) : (
            <UserAvatar userId={m.id} name={m.name} size={26} />
          )}
          <span className="grow ellipsis">{m.id === "vocal" || m.id === "tous" ? `@${m.id}` : m.name}</span>
          {m.hint && <span className="small muted">{m.hint}</span>}
        </button>
      ))}
      <span className="mention-help">{t("↑ ↓ pour choisir · Tab ou Entrée pour insérer")}</span>
    </div>
  );
}
