import { useEffect, useMemo, useState } from "react";
import { listCaptureSources, type CaptureSource } from "../lib/nativeCapture";
import { SCREEN_PRESETS, type ScreenPresetId } from "../lib/screen";
import { isCurrentGameProgram } from "../lib/games";
import { t } from "../lib/i18n";
import { Icon } from "./Brand";

type Props = {
  initialPreset: ScreenPresetId;
  initialAudio: boolean;
  /** `sourceId` absent : partage avec le son du PC, encore par la fenêtre de Windows. */
  onStart: (preset: ScreenPresetId, audio: boolean, sourceId?: string) => void;
  onClose: () => void;
};

type Tab = "window" | "screen";

const labelOf = (s: CaptureSource) => (s.kind === "screen" ? t("Écran {0}", { 0: s.index }) : s.title);

/**
 * Choisir quoi partager (appli Windows) : remplace la fenêtre « Choisir les éléments à partager »
 * de Windows. Les miniatures sont prises sur le PC et ne quittent pas l'appli.
 */
export default function SharePicker({ initialPreset, initialAudio, onStart, onClose }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preset, setPreset] = useState<ScreenPresetId>(initialPreset);
  const [audio, setAudio] = useState(initialAudio);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listCaptureSources()
        .then((list) => alive && setSources(list))
        .catch(() => alive && setSources((old) => old ?? []));
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Le jeu en cours passe en premier
  const windows = useMemo(() => {
    const list = (sources ?? []).filter((s) => s.kind === "window");
    return [...list.filter((s) => isCurrentGameProgram(s.program)), ...list.filter((s) => !isCurrentGameProgram(s.program))];
  }, [sources]);
  const screens = useMemo(() => (sources ?? []).filter((s) => s.kind === "screen"), [sources]);

  // Premier affichage : le jeu en cours s'il y en a un, sinon l'écran principal
  useEffect(() => {
    if (!sources || tab) return;
    const game = windows.find((s) => isCurrentGameProgram(s.program));
    const screen = screens.find((s) => s.primary) ?? screens[0];
    setTab(game || !screen ? "window" : "screen");
    setPicked((game ?? screen ?? windows[0])?.id ?? null);
  }, [sources, tab, windows, screens]);

  const shown = tab === "screen" ? screens : windows;
  // La fenêtre choisie a pu être fermée entre-temps
  const current = shown.find((s) => s.id === picked) ?? null;

  const changeTab = (next: Tab) => {
    setTab(next);
    setPicked((next === "screen" ? (screens.find((s) => s.primary) ?? screens[0]) : windows[0])?.id ?? null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-picker" role="dialog" aria-modal="true" aria-label={t("Partager mon écran")}>
        <header className="modal-header">
          <div className="col gap-4">
            <h2 className="title-sm">{t("Partager mon écran")}</h2>
            <span className="muted">{t("Choisis ce que tes potes vont voir.")}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("Fermer")}>
            <Icon name="x" />
          </button>
        </header>

        <div className="chips" role="tablist">
          <button role="tab" aria-selected={tab === "window"} className={`chip share-tab${tab === "window" ? " on" : ""}`} onClick={() => changeTab("window")}>
            {t("Fenêtres")} <span className="share-tab-count">{windows.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "screen"} className={`chip share-tab${tab === "screen" ? " on" : ""}`} onClick={() => changeTab("screen")}>
            {t("Écrans")} <span className="share-tab-count">{screens.length}</span>
          </button>
        </div>

        <div className="share-sources">
          {sources === null && <span className="muted share-sources-empty">{t("Recherche des fenêtres…")}</span>}
          {sources !== null && shown.length === 0 && (
            <span className="muted share-sources-empty">
              {tab === "screen" ? t("Aucun écran trouvé.") : t("Aucune fenêtre ouverte. Les fenêtres réduites n'apparaissent pas ici.")}
            </span>
          )}
          {shown.map((s) => {
            const on = s.id === current?.id;
            const game = s.kind === "window" && isCurrentGameProgram(s.program);
            return (
              <button
                key={s.id}
                className={`share-source${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => setPicked(s.id)}
                onDoubleClick={() => !audio && onStart(preset, audio, s.id)}
                title={labelOf(s)}
              >
                <span className="share-source-thumb">
                  {s.thumb ? <img src={s.thumb} alt="" draggable={false} /> : <Icon name="monitor" size={28} />}
                  {game && <span className="share-source-tag">{t("Jeu en cours")}</span>}
                  {on && (
                    <span className="share-source-check">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </span>
                <span className="share-source-name">
                  <span className="share-source-title">{labelOf(s)}</span>
                  {s.kind === "screen" && (
                    <span className="muted small">
                      {s.width} × {s.height}
                      {s.primary && screens.length > 1 ? ` · ${t("principal")}` : ""}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="share-picker-footer">
          <div className="col gap-6">
            <span className="muted small">{t("Qualité")}</span>
            <div className="chips">
              {SCREEN_PRESETS.map((p) => (
                <button key={p.id} className={`chip${preset === p.id ? " on" : ""}`} aria-pressed={preset === p.id} title={p.detail} onClick={() => setPreset(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <button className="share-audio-toggle" role="switch" aria-checked={audio} onClick={() => setAudio(!audio)}>
            <span className={`switch${audio ? " on" : ""}`}><span /></span>
            {t("Son du PC")}
          </button>
          <span className="grow" />
          <button className="btn outline" onClick={onClose}>{t("Annuler")}</button>
          <button className="btn primary" disabled={!audio && !current} onClick={() => onStart(preset, audio, audio ? undefined : current?.id)}>
            {t("Partager")}
          </button>
        </footer>
        {audio && (
          <span className="muted small share-audio-note">
            {t("Avec le son du PC, Windows ouvre encore sa propre fenêtre pour choisir. Le choix ci-dessus ne s'applique que sans le son.")}
          </span>
        )}
      </div>
    </div>
  );
}
