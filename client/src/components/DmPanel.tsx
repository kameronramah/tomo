import type { Api } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { STATUS_LABEL, getPerson, usePeople } from "../lib/people";
import { Icon, UserAvatar } from "./Brand";
import ChatView from "./ChatView";

const dmTarget = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

type Props = {
  api: Api;
  realtime: Realtime | null;
  myId: string;
  userId: string;
  friend: boolean;
  /** Demande de message pas encore acceptée */
  request: boolean;
  inCall: boolean;
  onCall: () => void;
  onGoToCall: () => void;
  onAccept: () => void;
  onIgnore: () => void;
  onBlock: () => void;
  onOpenProfile: () => void;
};

/** Conversation privée (ami ou non). Une demande s'affiche masquée jusqu'à acceptation. */
export default function DmPanel(p: Props) {
  usePeople([p.userId]);
  const person = getPerson(p.userId);
  const name = person?.displayName ?? "…";
  const status = person?.status ?? "offline";
  return (
    <ChatView
      key={p.userId}
      api={p.api}
      realtime={p.realtime}
      scope="dm"
      target={p.userId}
      storedTarget={dmTarget(p.myId, p.userId)}
      myId={p.myId}
      masked={p.request}
      hideComposer={p.request}
      placeholder={`Écrire à ${name}`}
      emptyText={`C'est le début de ta conversation avec ${name}.`}
      onOpenProfile={p.onOpenProfile}
      mentionables={[{ id: p.userId, name }]}
      header={
        <>
          <header className="chat-header">
            <button className="row gap-10 grow left plain-btn" onClick={p.onOpenProfile} title="Voir le profil">
              <UserAvatar userId={p.userId} name={name} size={36} showStatus />
              <span className="col gap-2" style={{ minWidth: 0 }}>
                <strong className="ellipsis">{name}</strong>
                <span className="muted small ellipsis">
                  {person?.customStatus ? `« ${person.customStatus} »` : STATUS_LABEL[status]}
                  {!p.friend && " · pas ton ami"}
                </span>
              </span>
            </button>
            {!p.request &&
              (p.inCall ? (
                <button className="btn pill active" onClick={p.onGoToCall}>
                  <Icon name="phone" size={16} /> Retour à l'appel
                </button>
              ) : (
                <button className="btn pill" onClick={p.onCall} disabled={status === "offline"} title={status === "offline" ? "Hors ligne" : "Appeler"}>
                  <Icon name="phone" size={16} /> Appeler
                </button>
              ))}
          </header>
          {p.request && (
            <div className="request-banner">
              <strong>{name} veut te parler</strong>
              <span className="muted small">
                Vous n'êtes pas amis. {name} ne sait pas si tu as lu ses messages tant que tu n'acceptes pas ; les liens et les fichiers restent masqués d'ici là.
              </span>
              <div className="row gap-8">
                <button className="btn primary" onClick={p.onAccept}>
                  Accepter
                </button>
                <button className="btn" onClick={p.onIgnore}>
                  Ignorer
                </button>
                <button className="btn danger" onClick={p.onBlock}>
                  Bloquer
                </button>
              </div>
            </div>
          )}
        </>
      }
    />
  );
}
