import type { ReactNode } from "react";
import type { Channel, RoomInfo, ServerDetail } from "../lib/api";
import { getPerson, usePeople, userIdOf } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";

type Props = {
  detail: ServerDetail;
  isManager: boolean;
  isGuest: boolean;
  /** Pièce où je suis (dans ce serveur), et mon identité vocale */
  voice: { roomId: string; identity: string } | null;
  myName: string;
  speaking: ReadonlySet<string>;
  unread: Record<string, number>;
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
      <aside className="plan collapsed" aria-label="Plan du serveur (réduit)">
        <button className="icon-btn sm" onClick={p.onToggleCollapsed} aria-label="Afficher le plan du serveur" title="Afficher le plan du serveur">
          <Icon name="chevronRight" size={16} />
        </button>
        {detail.rooms
          .filter((r) => r.participants.length > 0 || r.id === p.voice?.roomId)
          .map((r) => (
            <button key={r.id} className={`plan-mini${r.id === p.openRoomId ? " on" : ""}`} onClick={() => p.onJoinRoom(r)} title={`${r.label} · ${r.participants.length} en vocal`}>
              <span className="plan-mini-count">{r.participants.length}</span>
            </button>
          ))}
        <div className="grow" />
        {p.footer && <div className="plan-footer mini">{p.footer}</div>}
      </aside>
    );
  }

  return (
    <aside className="plan" aria-label="Plan du serveur">
      <div className="plan-head">
        <button className="plan-title ellipsis" onClick={p.onOpenHome} title="Accueil du serveur">
          {detail.name}
        </button>
        {!p.isGuest && (
          <button className="icon-btn sm" onClick={p.onManage} aria-label="Gérer le serveur" title="Gérer le serveur">
            <Icon name="settings" size={16} />
          </button>
        )}
        <button className="icon-btn sm" onClick={p.onToggleCollapsed} aria-label="Réduire le plan" title="Réduire le plan">
          <Icon name="chevronLeft" size={16} />
        </button>
      </div>

      <div className="plan-scroll">
        <span className="section-title">Pièces</span>
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
                <span className={`small ${here ? "teal-soft" : room.spatial ? "amber" : "muted"}`}>
                  {p.joiningRoomId === room.id ? "…" : here ? "tu es ici" : room.spatial ? "spatial" : people.length ? "" : "vide"}
                </span>
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
            <Icon name="plus" size={15} /> Nouvelle pièce
          </button>
        )}

        <span className="section-title">Fils</span>
        {detail.channels.map((c) => {
          const n = p.unread[`channel:${c.id}`] ?? 0;
          return (
            <button key={c.id} className={`plan-fil${c.id === p.openChannelId ? " open" : ""}${n ? " unread" : ""}`} onClick={() => p.onOpenChannel(c)} aria-current={c.id === p.openChannelId ? "page" : undefined}>
              <span className="fil-hash sm">#</span>
              <span className="grow ellipsis">{c.name}</span>
              {n > 0 && <span className="count amber">{n > 99 ? "99+" : n}</span>}
            </button>
          );
        })}
      </div>

      {p.footer && <div className="plan-footer">{p.footer}</div>}
    </aside>
  );
}
