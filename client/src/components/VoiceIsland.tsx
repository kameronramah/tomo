import type { Room } from "livekit-client";
import { Icon, NetworkBadge } from "./Brand";
import { t } from "../lib/i18n";
import { usePtt } from "../lib/ptt";
import { shortcutHint } from "../lib/hotkeys";
import { CoachPending } from "./CoachLayer";

type Props = {
  room: Room;
  label: string;
  isCall: boolean;
  micOn: boolean;
  deafened: boolean;
  onOpen: () => void;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
  /** island : flottante en bas de l'écran · panel : en bas du plan du serveur · mini : plan réduit */
  variant?: "island" | "panel" | "mini";
};

/** Le vocal en cours suit partout (île flottante, ou en bas du plan du serveur). */
export default function VoiceIsland(p: Props) {
  const variant = p.variant ?? "island";
  const ptt = usePtt();
  const mic = (
    <button
      className={`island-btn${p.micOn ? (ptt.ptt && !ptt.open ? " ptt-idle" : " mic-on") : " off"}`}
      onClick={p.onToggleMic}
      aria-label={p.micOn ? t("Couper le micro") : t("Activer le micro")}
      title={(p.micOn ? t("Couper le micro") : t("Activer le micro")) + shortcutHint("mute")}
    >
      <Icon name={p.micOn ? "mic" : "micOff"} size={variant === "island" ? 18 : 16} />
    </button>
  );
  const deaf = (
    <button
      className={`island-btn${p.deafened ? " off" : ""}`}
      onClick={p.onToggleDeafen}
      aria-label={p.deafened ? t("Rétablir le son") : t("Couper le son")}
      title={(p.deafened ? t("Rétablir le son") : t("Couper le son")) + shortcutHint("deafen")}
    >
      <Icon name={p.deafened ? "headphonesOff" : "headphones"} size={variant === "island" ? 18 : 16} />
    </button>
  );

  if (variant === "mini") {
    return (
      <div className="voice-mini" role="region" aria-label={t("Vocal en cours")}>
        <button className="island-btn" onClick={p.onOpen} title={t("Revenir à {0}", { 0: p.label })} aria-label={t("Revenir à {0}", { 0: p.label })}>
          <span className="island-dot" aria-hidden="true" />
        </button>
        <CoachPending room={p.room} onOpen={p.onOpen} compact />
        {mic}
        {deaf}
        <button className="island-btn leave" onClick={p.onLeave} aria-label={p.isCall ? t("Raccrocher") : t("Quitter")} title={p.isCall ? t("Raccrocher") : t("Quitter")}>
          <Icon name={p.isCall ? "phoneOff" : "leave"} size={16} />
        </button>
      </div>
    );
  }

  if (variant === "panel") {
    return (
      <div className="voice-panel" role="region" aria-label={t("Vocal en cours")}>
        <button className="voice-panel-info" onClick={p.onOpen} title={t("Revenir à la pièce")}>
          <span className="island-dot" aria-hidden="true" />
          <span className="col gap-2 grow left" style={{ minWidth: 0 }}>
            <strong className="ellipsis">{t("En vocal ·")} {p.label}</strong>
            <span className="muted small row gap-6">
              <NetworkBadge room={p.room} />
            </span>
          </span>
        </button>
        <CoachPending room={p.room} onOpen={p.onOpen} />
        <div className="row gap-6">
          {mic}
          {deaf}
          <button className="voice-panel-leave" onClick={p.onLeave}>
            {p.isCall ? t("Raccrocher") : t("Quitter")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="island-wrap">
      <div className="island" role="region" aria-label={t("Vocal en cours")}>
        <button className="island-info" onClick={p.onOpen} title={t("Revenir à la pièce")}>
          <span className="island-dot" aria-hidden="true" />
          <span className="strong ellipsis">{p.label}</span>
          <NetworkBadge room={p.room} />
        </button>
        <CoachPending room={p.room} onOpen={p.onOpen} compact />
        {mic}
        {deaf}
        <button className="island-leave" onClick={p.onLeave}>
          {p.isCall ? t("Raccrocher") : t("Quitter")}
        </button>
      </div>
    </div>
  );
}
