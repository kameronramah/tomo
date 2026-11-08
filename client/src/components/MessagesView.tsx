import type { ReactNode } from "react";
import type { Friend } from "../lib/api";
import { Avatar, Icon } from "./Brand";

export type DmView = { type: "friends" } | { type: "dm"; userId: string } | { type: "call" };

type Props = {
  friends: Friend[];
  dmOrder: string[];
  dmView: DmView;
  unread: Record<string, number>;
  onOpenFriends: () => void;
  onOpenDm: (userId: string) => void;
  children: ReactNode;
};

/** Espace Messages : la liste des conversations à gauche, la conversation (ou les amis) à droite. */
export default function MessagesView(p: Props) {
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
        <span className="section-title conv-section">Conversations</span>
        {p.dmOrder.length === 0 && <p className="muted small pad">Ajoute des amis pour discuter avec eux.</p>}
        {p.dmOrder.map((id) => {
          const f = p.friends.find((x) => x.id === id);
          if (!f) return null;
          const open = p.dmView.type === "dm" && p.dmView.userId === id;
          const n = p.unread[`dm:${id}`] ?? 0;
          return (
            <button key={id} className={`conv${open ? " open" : ""}${n ? " unread" : ""}`} onClick={() => p.onOpenDm(id)}>
              <span className="avatar-wrap">
                <Avatar name={f.username} size={40} />
                <span className={`status-dot${f.online ? "" : " off"}`} />
              </span>
              <span className="grow col gap-2 left" style={{ minWidth: 0 }}>
                <span className="ellipsis strong-ish">{f.username}</span>
                <span className="small muted">{f.online ? "en ligne" : "hors ligne"}</span>
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
