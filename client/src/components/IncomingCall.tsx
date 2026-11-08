import { Avatar, Icon } from "./Brand";
import { t } from "../lib/i18n";

/** Fenêtre d'appel entrant (sonnerie gérée par App). */
export default function IncomingCall({ from, onAccept, onDecline }: { from: string; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="call-card" role="alertdialog" aria-label={t("Appel de {0}", { 0: from })}>
        <div className="call-avatar">
          <Avatar name={from} size={88} speaking />
        </div>
        <div className="col gap-4 center">
          <strong className="title-sm">{from}</strong>
          <span className="muted">{t("t'appelle…")}</span>
        </div>
        <div className="row gap-16">
          <button className="call-btn decline" onClick={onDecline} aria-label={t("Refuser l'appel")}>
            <Icon name="phoneOff" size={24} />
          </button>
          <button className="call-btn accept" onClick={onAccept} aria-label={t("Accepter l'appel")}>
            <Icon name="phone" size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
