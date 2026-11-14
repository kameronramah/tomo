import { useEffect, useState } from "react";
import type { Api, Person } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { STATUS_LABEL, getPerson, putPeople, usePeople } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";
import { t } from "../lib/i18n";

const ROLE_TAG: Record<string, string | undefined> = { owner: "CRÉATEUR", admin: "ADMIN", guest: "INVITÉ" };

function seen(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 60) return t("vu il y a {0} min", { 0: Math.max(1, min) });
  const h = Math.round(min / 60);
  if (h < 24) return t("vu il y a {0} h", { 0: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("vu hier") : t("vu il y a {0} jours", { 0: d });
}

/** Membres d'un serveur (avec présence, pièce et jeu), rechargés toutes les 15 s et à chaque changement de présence. */
export function useServerPeople(api: Api, realtime: Realtime | null, serverId: string | null | undefined) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    if (!serverId) return setPeople([]);
    let alive = true;
    const load = () =>
      api
        .people(serverId)
        .then((list) => {
          if (!alive) return;
          setPeople(list);
          putPeople(list.filter((p) => !p.guest));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    // Quelqu'un arrive en vocal ou change de statut : on rafraîchit vite.
    const off = realtime?.on((e) => {
      if (e.type === "presence" || e.type === "profile") load();
    });
    return () => {
      alive = false;
      clearInterval(t);
      off?.();
    };
  }, [api, serverId, realtime]);
  return people;
}

/** Membres d'un serveur, rangés par « en vocal / en ligne / hors ligne » (la recherche est dans celle du serveur). */
export default function MemberList({
  api,
  realtime,
  serverId,
  myId,
  onOpenProfile,
  onClose,
}: {
  api: Api;
  realtime: Realtime | null;
  serverId: string;
  myId: string;
  onOpenProfile: (userId: string) => void;
  /** Bouton pour masquer le bloc (vocal, fils). */
  onClose?: () => void;
}) {
  const people = useServerPeople(api, realtime, serverId);
  const get = usePeople();

  const rows = people
    .map((p) => ({ ...p, ...(p.guest ? {} : get(p.id)) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const inVoice = rows.filter((p) => p.room);
  const online = rows.filter((p) => !p.room && p.status !== "offline");
  const offline = rows.filter((p) => !p.room && p.status === "offline");

  const row = (p: Person) => {
    const tag = ROLE_TAG[p.role];
    const playing = p.game ? t("joue à {0}", { 0: p.game.name }) : null;
    const sub = p.room
      ? `${p.status === "dnd" ? t("Ne pas déranger") + " · " : ""}${p.room.label}${playing ? " · " + playing : ""}`
      : playing ?? p.customStatus ?? (p.status === "offline" ? (p.lastSeen ? seen(p.lastSeen) : t("hors ligne")) : STATUS_LABEL[p.status]);
    return (
      <button key={p.id} className={`member${p.status === "offline" && !p.room ? " off" : ""}`} onClick={() => !p.guest && onOpenProfile(p.id)} disabled={p.guest}>
        <UserAvatar userId={p.guest ? null : p.id} name={p.displayName} size={36} showStatus={!p.guest} />
        <span className="grow col gap-2 left" style={{ minWidth: 0 }}>
          <span className="ellipsis strong-ish">
            {p.displayName}
            {p.id === myId && <span className="muted small"> {t("(toi)")}</span>}
            {tag && <span className={`role-tag${p.role === "admin" || p.role === "owner" ? " admin" : ""}`}> {tag}</span>}
          </span>
          <span className={`member-sub ellipsis${p.room ? " teal" : playing ? " plays" : ""}`}>{sub}</span>
        </span>
      </button>
    );
  };

  return (
    <section className="members" aria-label={t("Membres du serveur")}>
      <div className="members-head">
        <span className="side-title grow">{t("Membres")}</span>
        {onClose && (
          <button className="icon-btn sm" onClick={onClose} aria-label={t("Masquer les membres")} title={t("Masquer les membres")}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {inVoice.length > 0 && <span className="section-title">{t("En vocal ·")} {inVoice.length}</span>}
      {inVoice.map(row)}
      {online.length > 0 && <span className="section-title">{t("En ligne ·")} {online.length}</span>}
      {online.map(row)}
      {offline.length > 0 && <span className="section-title">{t("Hors ligne ·")} {offline.length}</span>}
      {offline.map(row)}
      {rows.length === 0 && <p className="muted small pad">{t("Chargement…")}</p>}
    </section>
  );
}

export { getPerson };
