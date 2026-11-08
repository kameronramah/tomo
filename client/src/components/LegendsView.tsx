import { useCallback, useEffect, useState } from "react";
import type { Api, Legend } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { locale, t } from "../lib/i18n";
import { errorMessage } from "../lib/ui";
import { Icon, UserAvatar } from "./Brand";
import { VoicePlayer, openExternal } from "./Attachments";
import { EmojiPicker, Reactions } from "./MessageParts";

type Filter = "all" | "clip" | "quote" | "image";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: t("Tout") },
  { id: "clip", label: t("Clips") },
  { id: "quote", label: t("Citations") },
  { id: "image", label: t("Images") },
];

const dateLabel = (ts: number) => new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short" });

/** Mur des légendes d'un serveur : clips, citations cultes, captures. */
export default function LegendsView({
  api,
  realtime,
  serverId,
  serverName,
  myId,
  isManager,
  onBack,
  onOpenProfile,
}: {
  api: Api;
  realtime: Realtime | null;
  serverId: string;
  serverName: string;
  myId: string;
  isManager: boolean;
  onBack: () => void;
  onOpenProfile: (id: string) => void;
}) {
  const [items, setItems] = useState<Legend[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => api.legends(serverId).then(setItems).catch((e) => setError(errorMessage(e))), [api, serverId]);
  useEffect(() => {
    void load();
    return realtime?.on((e) => e.type === "legends" && e.serverId === serverId && void load());
  }, [load, realtime, serverId]);

  async function react(id: string, emoji: string) {
    setPickerFor(null);
    try {
      const l = await api.reactLegend(id, emoji);
      setItems((list) => list?.map((x) => (x.id === id ? l : x)) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function remove(id: string) {
    try {
      await api.unpinLegend(id);
      setItems((list) => list?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const shown = (items ?? []).filter((l) => filter === "all" || l.kind === filter);

  return (
    <section className="panel legends">
      <header className="chat-header">
        <button className="icon-btn" onClick={onBack} aria-label={t("Retour aux pièces")} title={t("Retour aux pièces")}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="col gap-2 grow" style={{ minWidth: 0 }}>
          <strong>{t("Mur des légendes")}</strong>
          <span className="muted small ellipsis">{t("Les meilleurs moments du groupe : clips, citations cultes, captures.")}</span>
        </span>
        <span className="muted small">{serverName}</span>
      </header>
      <div className="legends-body">
        <div className="segmented legends-filter" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {error && <p className="error small">{error}</p>}
        {items === null && <p className="muted">{t("Chargement…")}</p>}
        {items && shown.length === 0 && (
          <div className="legends-empty">
            <Icon name="star" size={28} />
            <strong>{t("Le mur est encore vide")}</strong>
            <span className="muted small">
              {t("Sur un message : bouton étoile « Épingler au mur des légendes ». Sur un clip : Paramètres › Clips › « Mettre au mur ».")}
            </span>
          </div>
        )}
        <div className="legends-grid">
          {shown.map((l) => {
            const canRemove = l.pinnedBy === myId || l.authorId === myId || isManager;
            const src = l.attachment ? api.fileUrl(l.attachment) : "";
            return (
              <article key={l.id} className={`legend ${l.kind}`}>
                <span className="legend-kind">
                  {l.kind === "clip" ? t("Clip") : l.kind === "quote" ? t("Citation") : t("Image")}
                  {l.kind === "clip" && l.attachment?.durationMs ? ` · ${Math.round(l.attachment.durationMs / 1000)} s` : ""}
                  {l.context ? ` · ${l.context}` : ""}
                </span>
                {l.title && <strong className="legend-title">{l.title}</strong>}
                {l.kind === "quote" && l.text && <blockquote className="legend-quote">« {l.text} »</blockquote>}
                {l.kind === "image" && l.attachment && (
                  <button className="legend-image plain-btn" onClick={() => openExternal(src)} aria-label={t("Agrandir")}>
                    <img src={src} alt={l.title ?? l.text ?? ""} loading="lazy" />
                  </button>
                )}
                {l.kind === "image" && l.text && <p className="small soft">{l.text}</p>}
                {l.kind === "clip" && l.attachment && <VoicePlayer src={src} durationMs={l.attachment.durationMs} waveform={l.attachment.waveform} />}
                <div className="legend-foot">
                  <button className="row gap-6 plain-btn grow left" onClick={() => l.authorId && onOpenProfile(l.authorId)} disabled={!l.authorId}>
                    <UserAvatar userId={l.authorId} name={l.authorName} size={22} />
                    <span className="small ellipsis">
                      {l.authorName} · {dateLabel(l.momentAt)}
                    </span>
                  </button>
                  <button className="icon-btn sm" onClick={() => setPickerFor(l.id)} aria-label={t("Ajouter une réaction")} title={t("Ajouter une réaction")}>
                    <Icon name="smile" size={15} />
                  </button>
                  {canRemove && (
                    <button className="icon-btn sm" onClick={() => void remove(l.id)} aria-label={t("Retirer du mur")} title={t("Retirer du mur")}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
                <Reactions reactions={l.reactions} myId={myId} onToggle={(e) => void react(l.id, e)} onAdd={() => setPickerFor(l.id)} />
                {pickerFor === l.id && <EmojiPicker onPick={(e) => void react(l.id, e)} onClose={() => setPickerFor(null)} />}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
