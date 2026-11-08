import { useEffect, useState } from "react";
import { getUpdateState, onUpdateState, restartNow, startUpdateChecks, type UpdateState } from "../lib/updater";
import { Icon } from "./Brand";

/** Petite carte « tomo X est prête » quand une mise à jour a été téléchargée. */
export default function UpdateCard({ inVoice }: { inVoice: boolean }) {
  const [up, setUp] = useState<UpdateState>(getUpdateState());
  const [hidden, setHidden] = useState(false);
  useEffect(() => onUpdateState(setUp), []);
  useEffect(() => startUpdateChecks(), []);
  if (up.kind !== "ready" || hidden) return null;
  const notes = up.notes
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l && !l.startsWith("**") && !l.startsWith("#"))
    .slice(0, 4);
  return (
    <div className="update-card" role="status">
      <span className="feature-icon teal">
        <Icon name="download" size={18} />
      </span>
      <div className="col gap-4 grow" style={{ minWidth: 0 }}>
        <strong>tomo {up.version} est prête</strong>
        {notes.length > 0 && (
          <ul className="update-notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <span className="muted small">{inVoice ? "Tu es en vocal : installe-la quand tu auras fini." : "Redémarre pour l'installer (quelques secondes)."}</span>
        <div className="row gap-8">
          {!inVoice && (
            <button className="btn primary small" onClick={() => void restartNow()}>
              Redémarrer
            </button>
          )}
          <button className="btn small" onClick={() => setHidden(true)}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
