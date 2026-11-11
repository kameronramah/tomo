import type { ReactNode } from "react";
import type { Channel, Person, RoomInfo, ServerDetail } from "../lib/api";
import { STATUS_LABEL, getPerson, usePeople, userIdOf } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";
import { t } from "../lib/i18n";

type Props = {
  /** Membres du serveur (présence, pièce, jeu) */
  people: Person[];
  myId: string;
  onOpenProfile: (userId: string) => void;
  detail: ServerDetail;
  isManager: boolean;
  isGuest: boolean;
  /** Pièce où je suis (dans ce serveur), et mon identité vocale */
  voice: { roomId: string; identity: string } | null;
  myName: string;
  speaking: ReadonlySet<string>;
  unread: Record<string, number>;
  /** Mentions non lues (pastille rouge « @n ») */
  mentions?: Record<string, number>;
  /** Ce qui est ouvert à droite */
  openRoomId?: string;
  openChannelId?: string;
  joiningRoomId?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenHome: () => void;
  onJoinRoom: (room: RoomInfo) => void;
  onOpenChannel: (c: Channel) => void;
  onAddRoom: () => void;
  onManage: () => void;
  /** Contrôles du vocal en cours (en bas du plan) */
  footer?: ReactNode;
};

/**
 * Plan du serveur : reste visible quand on est dans une pièce vocale ou un fil,
 * pour voir qui est où, qui parle, et les fils avec du nouveau.
 */
export default function ServerPlan(p: Props) {
  const { detail } = p;
  const ids = detail.rooms.flatMap((r) => r.participants.map((x) => userIdOf(x.identity)));
  usePeople(ids);

  if (p.collapsed) {
    return (
      <aside className="plan collapsed" aria-label={t("Plan du serveur (réduit)")}>
        <button className="icon-btn sm" onClick={p.onToggleCollapsed} aria-label={t("Afficher le plan du serveur")} title={t("Afficher le plan du serveur")}>
          <Icon name="chevronRight" size={16} />
        </button>
        {detail.rooms
          .filter((r) => r.participants.length > 0 || r.id === p.voice?.roomId)
          .map((r) => (
            <button key={r.id} className={`plan-mini${r.id === p.openRoomId ? " on" : ""}`} onClick={() => p.onJoinRoom(r)} title={t("{0} · {1} en vocal", { 0: r.label, 1: r.participants.length })}>
              <span className="plan-mini-count">{r.participants.length}</span>
            </button>
          ))}
        <div className="grow" />
        {p.footer && <div className="plan-footer mini">{p.footer}</div>}
      </aside>
    );
  }

  return (
    <aside className="plan" aria-label={t("Plan du serveur")}>
      <div className="plan-head">
        <button className="plan-title ellipsis" onClick={p.onOpenHome} title={t("Accueil du serveur")}>
          {detail.name}
        </button>
        {!p.isGuest && (
          <button className="icon-btn sm" onClick={p.onManage} aria-label={t("Gérer le serveur")} title={t("Gérer le serveur")}>
            <Icon name="settings" size={16} />
          </button>
        )}
        <button className="icon-btn sm" onClick={p.onToggleCollapsed} aria-label={t("Réduire le plan")} title={t("Réduire le plan")}>
          <Icon name="chevronLeft" size={16} />
        </button>
      </div>

      <div className="plan-scroll">
        <span className="section-title">{t("Pièces")}</span>
        {detail.rooms.map((room) => {
          const here = p.voice?.roomId === room.id;
          const others = room.participants.filter((x) => x.identity !== p.voice?.identity);
          const people = here && p.voice ? [{ identity: p.voice.identity, name: p.myName, guest: p.isGuest }, ...others] : others;
          const chat = p.unread[`room:${room.id}`] ?? 0;
          return (
            <button
              key={room.id}
              className={`plan-room${here ? " here" : ""}${room.id === p.openRoomId ? " open" : ""}${people.length ? "" : " empty"}`}
              onClick={() => p.onJoinRoom(room)}
              disabled={p.joiningRoomId === room.id}
              aria-current={room.id === p.openRoomId ? "page" : undefined}
            >
              <span className="plan-room-head">
                {here && <span className="live-dot" aria-hidden="true" />}
                <strong className="grow ellipsis">{room.label}</strong>
                {chat > 0 && <span className="count amber">{chat}</span>}
                <span className={`plan-room-state small ${here ? "teal-soft" : room.spatial ? "amber" : "muted"}`}>
                  {p.joiningRoomId === room.id ? "…" : here ? t("tu es ici") : room.spatial ? t("spatial") : people.length ? "" : t("vide")}
                </span>
                {!here && p.joiningRoomId !== room.id && (
                  <span className="plan-join" aria-hidden="true">
                    {t("Rejoindre")}
                  </span>
                )}
              </span>
              {people.length > 0 && (
                <span className="plan-people">
                  {people.map((x) => (
                    <span key={x.identity} className="plan-person">
                      <UserAvatar identity={x.identity} name={x.name} size={24} speaking={p.speaking.has(x.identity)} />
                      <span className="ellipsis">{getPerson(userIdOf(x.identity))?.displayName ?? x.name}</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
        {p.isManager && (
          <button className="plan-add" onClick={p.onAddRoom}>
            <Icon name="plus" size={15} /> {t("Nouvelle pièce")}
          </button>
        )}

        <span className="section-title">{t("Fils")}</span>
        {detail.channels.map((c) => {
          const n = p.unread[`channel:${c.id}`] ?? 0;
          const at = p.mentions?.[`channel:${c.id}`] ?? 0;
          return (
            <button key={c.id} className={`plan-fil${c.id === p.openChannelId ? " open" : ""}${n ? " unread" : ""}`} onClick={() => p.onOpenChannel(c)} aria-current={c.id === p.openChannelId ? "page" : undefined}>
              <span className="fil-hash sm">#</span>
              <span className="grow ellipsis">{c.name}</span>
              {at > 0 ? <span className="count red">@{at}</span> : n > 0 && <span className="count amber">{n > 99 ? "99+" : n}</span>}
            </button>
          );
        })}
        <PlanOnline people={p.people} myId={p.myId} onOpenProfile={p.onOpenProfile} />
      </div>

      {p.footer && <div className="plan-footer">{p.footer}</div>}
    </aside>
  );
}

/** « En ligne, pas en vocal » : qui est là et à quoi il joue, sans quitter le vocal. */
function PlanOnline(p: { people: Person[]; myId: string; onOpenProfile: (userId: string) => void }) {
  const get = usePeople();
  const online = p.people
    .map((x) => ({ ...x, ...(x.guest ? {} : get(x.id)) }))
    .filter((x) => !x.room && x.status !== "offline" && x.id !== p.myId)
    .sort((a, b) => Number(!!b.game) - Number(!!a.game) || a.displayName.localeCompare(b.displayName));
  if (online.length === 0) return null;
  const shown = online.slice(0, 5);
  return (
    <section className="plan-online" aria-label={t("En ligne, pas en vocal")}>
      <span className="plan-online-title">{t("En ligne, pas en vocal")}</span>
      {shown.map((x) => (
        <button key={x.id} className="plan-online-row" onClick={() => !x.guest && p.onOpenProfile(x.id)} disabled={x.guest}>
          <UserAvatar userId={x.guest ? null : x.id} name={x.displayName} size={28} />
          <span className="grow ellipsis strong-ish">{x.displayName}</span>
          <span className={`small ellipsis plan-online-sub${x.game ? "" : x.status === "idle" ? " amber" : " muted"}`}>
            {x.game ? x.game.name : (x.customStatus ?? STATUS_LABEL[x.status])}
          </span>
        </button>
      ))}
      {online.length > shown.length && <span className="muted small pad">{t("et {0} autres", { 0: online.length - shown.length })}</span>}
    </section>
  );
}
