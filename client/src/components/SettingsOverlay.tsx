import { useEffect, useState } from "react";
import { getSettings, onSettingsChange, updateSettings, type Settings } from "../lib/prefs";
import { inTauri } from "../lib/desktop";
import { t } from "../lib/i18n";

const CORNERS: { id: Settings["overlay"]["corner"]; label: string }[] = [
  { id: "tl", label: t("En haut à gauche") },
  { id: "tr", label: t("En haut à droite") },
  { id: "bl", label: t("En bas à gauche") },
  { id: "br", label: t("En bas à droite") },
];

/** Paramètres › Overlay en jeu. */
export default function SettingsOverlay() {
  const [s, setS] = useState(getSettings());
  useEffect(() => onSettingsChange(setS), []);
  const o = s.overlay;
  const row = (key: "voices" | "chat" | "captions", label: string, hint: string) => (
    <label className="setting-row">
      <span className="col gap-2 grow">
        <span>{label}</span>
        <span className="hint">{hint}</span>
      </span>
      <input type="checkbox" className="toggle" checked={o[key]} onChange={(e) => updateSettings("overlay", { [key]: e.target.checked })} />
    </label>
  );
  return (
    <>
      <h1 className="title">{t("Overlay en jeu")}</h1>
      <p className="muted text">
        {t("Une petite fenêtre transparente par-dessus ton jeu : qui parle, le chat de la pièce, les sous-titres. Les clics la traversent, elle ne gêne jamais la partie. Mets ton jeu en « plein écran fenêtré » (ou « fenêtré sans bordure ») : un plein écran exclusif passe par-dessus tout.")}
      </p>
      <div className="settings-card">
        <h3 className="dev-title">{t("Quand l'afficher")}</h3>
        <select value={o.mode} onChange={(e) => updateSettings("overlay", { mode: e.target.value as Settings["overlay"]["mode"] })}>
          <option value="game">{t("En vocal, par-dessus le jeu quand il est devant (réglable par jeu dans Paramètres › Jeux)")}</option>
          <option value="always">{t("Toujours quand je suis en vocal")}</option>
          <option value="off">{t("Jamais")}</option>
        </select>
        <label className="setting-row">
          <span className="grow">{t("Position")}</span>
          <select value={o.corner} onChange={(e) => updateSettings("overlay", { corner: e.target.value as Settings["overlay"]["corner"] })}>
            {CORNERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span className="grow">{t("Opacité")}</span>
          <input type="range" min={0.4} max={1} step={0.05} value={o.opacity} onChange={(e) => updateSettings("overlay", { opacity: Number(e.target.value) })} aria-label={t("Opacité")} />
          <span className="value">{Math.round(o.opacity * 100)} %</span>
        </label>
        {!inTauri && <span className="hint">{t("Disponible dans l'application de bureau.")}</span>}
      </div>
      <div className="settings-card">
        <h3 className="dev-title">{t("Ce qui s'affiche")}</h3>
        {row("voices", t("Qui parle"), t("Les personnes de la pièce, en surbrillance quand elles parlent, et qui a coupé son micro."))}
        {row("chat", t("Messages du chat"), t("Les nouveaux messages de la pièce, pendant 15 secondes."))}
        {row("captions", t("Sous-titres"), t("Quand les sous-titres sont activés dans la pièce."))}
      </div>
    </>
  );
}
