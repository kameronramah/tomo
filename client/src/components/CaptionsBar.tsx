import { useEffect, useReducer } from "react";
import { getCaptions, onCaptions } from "../lib/captions";
import { updateSettings, getSettings } from "../lib/prefs";
import { t } from "../lib/i18n";
import { Icon } from "./Brand";

/** Bandeau des sous-titres en direct (dernières phrases), sous la scène vocale. */
export default function CaptionsBar() {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onCaptions(tick), []);
  const c = getCaptions();
  if (!c) return null;
  const lines = c.lines.slice(-3);

  function save() {
    const blob = new Blob([c!.export()], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tomo-transcription-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="captions-bar" aria-live="polite">
      <div className="captions-head">
        <span className="cc-badge">CC</span>
        <span className="muted small grow">
          {c.status.state === "loading"
            ? t("Préparation des sous-titres… {0} % (une seule fois, le modèle est gardé ensuite)", { 0: c.status.progress })
            : c.status.state === "error"
              ? t("Sous-titres indisponibles sur ce PC.")
              : t("Calculé sur ton PC : rien n'est envoyé ailleurs.")}
        </span>
        <label className="row gap-6 small">
          <input
            type="checkbox"
            checked={getSettings().captions.translate}
            onChange={(e) => {
              updateSettings("captions", { translate: e.target.checked });
              c.setTranslate(e.target.checked);
              tick();
            }}
          />
          {t("Traduire")}
        </label>
        <button className="icon-btn sm" onClick={save} disabled={!c.lines.length} aria-label={t("Enregistrer la transcription")} title={t("Enregistrer la transcription")}>
          <Icon name="download" size={15} />
        </button>
      </div>
      {lines.length === 0 && c.status.state === "ready" && <p className="muted small">{t("Les phrases de tes potes s'afficheront ici.")}</p>}
      {lines.map((l) => (
        <p key={l.id} className={`caption-line${l.pending ? " pending" : ""}`}>
          <strong>{l.name}</strong>
          {l.original && l.original !== l.text && <span className="muted small"> {t("(traduit)")}</span>} :{" "}
          {l.pending && !l.text ? <span className="muted">…</span> : l.text}
        </p>
      ))}
    </div>
  );
}
