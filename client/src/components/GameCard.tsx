import { useEffect, useState } from "react";
import type { RunningGame } from "../lib/games";
import type { Person } from "../lib/api";
import { getSettings } from "../lib/prefs";
import { t } from "../lib/i18n";
import { initials } from "../lib/ui";

/**
 * « Minecraft détecté : Mila et Noé sont dans Minecraft SMP. Les rejoindre ? »
 * S'affiche une fois par lancement de jeu, si des potes y jouent déjà en vocal.
 */
export default function GameCard({ game, mates, inVoice, onJoin }: { game: RunningGame | null; mates: Person[]; inVoice: boolean; onJoin: (roomId: string) => void }) {
  const [closedFor, setClosedFor] = useState<number | null>(null);
  useEffect(() => setClosedFor(null), [game?.since]);
  if (!game || inVoice || !mates.length || closedFor === game.since || !getSettings().games.propose) return null;
  const room = mates[0].room!;
  const names = mates.slice(0, 3).map((m) => m.displayName);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${t("et")} ${names[names.length - 1]}` : names[0];
  return (
    <div className="update-card game-card" role="status">
      <span className="game-badge">{initials(game.name)}</span>
      <div className="col gap-4 grow" style={{ minWidth: 0 }}>
        <strong>{t("{0} détecté", { 0: game.name })}</strong>
        <span className="muted small">
          {t(mates.length > 1 ? "{0} sont dans « {1} ». Les rejoindre ?" : "{0} est dans « {1} ». Le rejoindre ?", { 0: who, 1: room.label })}
        </span>
        <div className="row gap-8">
          <button
            className="btn primary small"
            onClick={() => {
              setClosedFor(game.since);
              onJoin(room.id);
            }}
          >
            {t("Rejoindre")}
          </button>
          <button className="btn small" onClick={() => setClosedFor(game.since)}>
            {t("Plus tard")}
          </button>
        </div>
      </div>
    </div>
  );
}
