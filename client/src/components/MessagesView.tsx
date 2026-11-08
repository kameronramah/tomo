import type { ReactNode } from "react";
import type { DmSummary, Friend } from "../lib/api";
import { STATUS_LABEL, getPerson, usePeople } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";

export type DmView = { type: "friends" } | { type: "requests" } | { type: "dm"; userId: string } | { type: "call" };

type Props = {
  friends: Friend[];
  dmOrder: string[];
  requests: number;
  dmView: DmView;
  unread: Record<string, number>;
  onOpenFriends: () => void;
  onOpenRequests: () => void;
  onOpenDm: (userId: string) => void;
  children: ReactNode;
};

/** Espace Messages : la liste des conversations à gauche, la conversation (ou les amis) à droite. */
export default function MessagesView(p: Props) {
  usePeople(p.dmOrder);
  const pendingIn = p.friends.filter((f) => f.status === "incoming").length;
  return (
    <div className="messages">
      <aside className="conv-list" aria-label="Conversations">
        <h1 className="title-sm conv-title">Messages</h1>
        <button className={`conv${p.dmView.type === "friends" ? " open" : ""}`} onClick={p.onOpenFriends}>
          <span className="conv-icon">
            <Icon name="users" size={18} />
          </span>
          <span className="grow left strong-ish">Amis</span>
          {pendingIn > 0 && <span className="badge amber-badge-fill">{pendingIn}</span>}
        </button>
        {p.requests > 0 && (
          <button className={`conv${p.dmView.type === "requests" ? " open" : ""}`} onClick={p.onOpenRequests}>
            <span className="conv-icon amber-icon">
              <Icon name="mail" size={18} />
            </span>
            <span className="grow col gap-2 left">
              <span className="strong-ish">Demandes de message</span>
              <span className="small muted">De gens qui ne sont pas tes amis</span>
            </span>
            <span className="badge amber-badge-fill">{p.requests}</span>
          </button>
        )}
        <span className="section-title conv-section">Conversations</span>
        {p.dmOrder.length === 0 && <p className="muted small pad">Ajoute des amis pour discuter avec eux.</p>}
        {p.dmOrder.map((id) => {
          const person = getPerson(id);
          const f = p.friends.find((x) => x.id === id);
          const name = person?.displayName ?? f?.username ?? "…";
          const open = p.dmView.type === "dm" && p.dmView.userId === id;
          const n = p.unread[`dm:${id}`] ?? 0;
          return (
            <button key={id} className={`conv${open ? " open" : ""}${n ? " unread" : ""}`} onClick={() => p.onOpenDm(id)}>
              <UserAvatar userId={id} name={name} size={40} showStatus />
              <span className="grow col gap-2 left" style={{ minWidth: 0 }}>
                <span className="ellipsis strong-ish">{name}</span>
                <span className="small muted ellipsis">
                  {person?.customStatus ? person.customStatus : STATUS_LABEL[person?.status ?? "offline"].toLowerCase()}
                </span>
              </span>
              {n > 0 && <span className="badge amber-badge-fill">{n}</span>}
            </button>
          );
        })}
      </aside>
      <section className="panel conv-panel">{p.children}</section>
    </div>
  );
}

/** Liste des demandes de message (gens qui ne sont pas amis). */
export function RequestsView({ requests, onOpen }: { requests: DmSummary[]; onOpen: (userId: string) => void }) {
  usePeople(requests.map((r) => r.userId));
  return (
    <div className="friends">
      <header className="chat-header">
        <span className="conv-icon amber-icon">
          <Icon name="mail" size={18} />
        </span>
        <span className="col gap-2">
          <strong>Demandes de message</strong>
          <span className="muted small">Personne ne sait que tu as lu tant que tu n'acceptes pas.</span>
        </span>
      </header>
      <div className="col gap-4" style={{ padding: 16 }}>
        {requests.length === 0 && <p className="muted">Aucune demande en attente.</p>}
        {requests.map((r) => {
          const person = getPerson(r.userId) ?? r.profile;
          return (
            <button key={r.userId} className="conv" onClick={() => onOpen(r.userId)}>
              <UserAvatar userId={r.userId} name={person?.displayName ?? "…"} size={40} />
              <span className="grow col gap-2 left">
                <span className="strong-ish">{person?.displayName ?? "…"}</span>
                <span className="small muted">Pas ton ami · ouvre pour lire</span>
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
