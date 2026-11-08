import type { SavedServer } from "../lib/storage";

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

type Props = {
  servers: SavedServer[];
  activeId?: string;
  voiceServerId?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
};

/** Barre verticale des serveurs rejoints (comme la colonne de gauche de Discord). */
export default function ServerRail({ servers, activeId, voiceServerId, onSelect, onAdd }: Props) {
  return (
    <nav className="rail" aria-label="Serveurs">
      {servers.map((s) => (
        <button
          key={s.id}
          className={`rail-item${s.id === activeId ? " active" : ""}`}
          onClick={() => onSelect(s.id)}
          title={s.name}
          aria-label={s.name}
        >
          {initials(s.name)}
          {s.id === voiceServerId && <span className="voice-dot" title="Tu es en vocal sur ce serveur" />}
        </button>
      ))}
      <button className="rail-item add" onClick={onAdd} title="Rejoindre un serveur" aria-label="Rejoindre un serveur">
        +
      </button>
    </nav>
  );
}
