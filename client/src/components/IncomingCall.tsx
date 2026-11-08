import { Avatar, Icon } from "./Brand";

/** Fenêtre d'appel entrant (sonnerie gérée par App). */
export default function IncomingCall({ from, onAccept, onDecline }: { from: string; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="call-card" role="alertdialog" aria-label={`Appel de ${from}`}>
        <div className="call-avatar">
          <Avatar name={from} size={88} speaking />
        </div>
        <div className="col gap-4 center">
          <strong className="title-sm">{from}</strong>
          <span className="muted">t'appelle…</span>
        </div>
        <div className="row gap-16">
          <button className="call-btn decline" onClick={onDecline} aria-label="Refuser l'appel">
            <Icon name="phoneOff" size={24} />
          </button>
          <button className="call-btn accept" onClick={onAccept} aria-label="Accepter l'appel">
            <Icon name="phone" size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
