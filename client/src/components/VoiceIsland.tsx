import type { Room } from "livekit-client";
import { Icon, NetworkBadge } from "./Brand";

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
};

/** Le vocal en cours suit partout : petite île flottante en bas de l'écran. */
export default function VoiceIsland(p: Props) {
  return (
    <div className="island-wrap">
      <div className="island" role="region" aria-label="Vocal en cours">
        <button className="island-info" onClick={p.onOpen} title="Revenir à la pièce">
          <span className="island-dot" aria-hidden="true" />
          <span className="strong ellipsis">{p.label}</span>
          <NetworkBadge room={p.room} />
        </button>
        <button
          className={`island-btn${p.micOn ? "" : " off"}`}
          onClick={p.onToggleMic}
          aria-label={p.micOn ? "Couper le micro" : "Activer le micro"}
          title={p.micOn ? "Couper le micro (Ctrl+Maj+M)" : "Activer le micro (Ctrl+Maj+M)"}
        >
          <Icon name={p.micOn ? "mic" : "micOff"} />
        </button>
        <button
          className={`island-btn${p.deafened ? " off" : ""}`}
          onClick={p.onToggleDeafen}
          aria-label={p.deafened ? "Rétablir le son" : "Couper le son"}
          title={p.deafened ? "Rétablir le son (Ctrl+Maj+D)" : "Couper le son (Ctrl+Maj+D)"}
        >
          <Icon name={p.deafened ? "headphonesOff" : "headphones"} />
        </button>
        <button className="island-leave" onClick={p.onLeave}>
          {p.isCall ? "Raccrocher" : "Quitter"}
        </button>
      </div>
    </div>
  );
}
