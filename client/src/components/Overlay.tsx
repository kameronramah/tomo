import { useEffect, useState } from "react";
import type { OverlayState } from "../lib/overlay";
import { initials } from "../lib/ui";
import { t } from "../lib/i18n";

/** Contenu de la fenêtre overlay (transparente, par-dessus le jeu). */
export default function Overlay() {
  const [s, setS] = useState<OverlayState | null>(null);
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<OverlayState>("overlay:state", (e) => setS(e.payload)).then((u) => (off = u)),
    );
    return () => off?.();
  }, []);
  if (!s) return null;
  const p = s.prefs;
  const bottom = p.corner.startsWith("b");
  const right = p.corner.endsWith("r");
  return (
    <div className={`ov${bottom ? " bottom" : ""}${right ? " right" : ""}`} style={{ opacity: p.opacity }}>
      {p.voices && (
        <div className="ov-card">
          {s.voices.map((v) => (
            <div key={v.id} className={`ov-voice${v.speaking ? " speaking" : ""}`}>
              <span className="ov-avatar" style={{ background: v.color }}>
                {initials(v.name)}
              </span>
              <span className="ov-name">{v.name}</span>
              {v.muted && <span className="ov-muted">{t("micro coupé")}</span>}
            </div>
          ))}
          <div className="ov-room">{s.room}</div>
        </div>
      )}
      {p.chat &&
        s.chat.map((m) => (
          <div key={m.id} className="ov-card ov-chat">
            <strong>{m.name}</strong> {m.text}
          </div>
        ))}
      {p.captions &&
        s.captions.map((c) => (
          <div key={c.id} className="ov-card ov-caption">
            <strong>{c.name}</strong>
            {c.translated && <span className="ov-dim"> {t("(traduit)")}</span>} : {c.text}
          </div>
        ))}
    </div>
  );
}
