/**
 * Paramètres du micro (« Quand je parle » / « Appuyer pour parler », seuil de voix,
 * baisser les autres) et des raccourcis clavier.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadDevices, updateSettings, type Settings as S } from "../lib/prefs";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";
import {
  ACTIONS,
  askInputPermission,
  conflictWith,
  formatShortcut,
  hotkeysGlobal,
  recordShortcut,
  resetShortcuts,
  setShortcut,
  shortcutOf,
  type ActionDef,
  type ActionId,
} from "../lib/hotkeys";
import { inTauri } from "../lib/desktop";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="setting-row">
      <span className="col gap-2 grow">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-card">
      <h3 className="dev-title">{title}</h3>
      {children}
    </div>
  );
}

/** Enregistre une nouvelle touche pour une action, en prévenant si elle est déjà prise. */
function useRecorder() {
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [conflict, setConflict] = useState<{ id: ActionId; keys: string[]; other: ActionDef } | null>(null);
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelRef.current?.(), []);

  async function record(id: ActionId) {
    cancelRef.current?.();
    setConflict(null);
    setRecording(id);
    const { result, cancel } = recordShortcut();
    cancelRef.current = cancel;
    const keys = await result;
    cancelRef.current = undefined;
    setRecording(null);
    if (!keys) return;
    const other = conflictWith(id, keys);
    if (other) setConflict({ id, keys, other });
    else setShortcut(id, keys);
  }

  function confirm() {
    if (!conflict) return;
    setShortcut(conflict.other.id, null);
    setShortcut(conflict.id, conflict.keys);
    setConflict(null);
  }

  return { recording, conflict, record, confirm, dismiss: () => setConflict(null), cancel: () => cancelRef.current?.() };
}

function ConflictNote({ c, onConfirm, onCancel }: { c: { keys: string[]; other: ActionDef }; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="key-conflict" role="alert">
      <span>{t("{0} sert déjà à « {1} ».", { 0: formatShortcut(c.keys), 1: c.other.label })}</span>
      <div className="row gap-8">
        <button className="btn small amber" onClick={onConfirm}>
          {t("Remplacer")}
        </button>
        <button className="btn small" onClick={onCancel}>
          {t("Annuler")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio et micro
// ---------------------------------------------------------------------------
export function MicMode({ s }: { s: S }) {
  const a = s.audio;
  const rec = useRecorder();
  const pttKeys = shortcutOf("ptt");
  const recording = rec.recording === "ptt";

  return (
    <Card title={t("Quand mon micro s'ouvre")}>
      <div className="mic-modes" role="radiogroup" aria-label={t("Quand mon micro s'ouvre")}>
        <button role="radio" aria-checked={a.mode === "voice"} className={`mic-mode${a.mode === "voice" ? " on" : ""}`} onClick={() => updateSettings("audio", { mode: "voice" })}>
          <Icon name="mic" />
          <span className="col gap-2">
            <strong>{t("Quand je parle")}</strong>
            <span className="muted small">{t("Le micro s'ouvre tout seul au-dessus du seuil.")}</span>
          </span>
        </button>
        <button role="radio" aria-checked={a.mode === "ptt"} className={`mic-mode${a.mode === "ptt" ? " on" : ""}`} onClick={() => updateSettings("audio", { mode: "ptt" })}>
          <Icon name="keyboard" />
          <span className="col gap-2">
            <strong>{t("Appuyer pour parler")}</strong>
            <span className="muted small">{t("Le micro ne s'ouvre que pendant que tu tiens une touche.")}</span>
          </span>
        </button>
      </div>

      {a.mode === "voice" ? (
        <>
          <Toggle
            label={t("Seuil de voix automatique")}
            hint={t("Laisse la suppression de bruit décider. Coupe-le pour régler toi-même le niveau à partir duquel on t'entend.")}
            checked={!a.gate}
            onChange={(v) => updateSettings("audio", { gate: !v })}
          />
          {a.gate && <VoiceThreshold threshold={a.gateThreshold} />}
        </>
      ) : (
        <>
          <div className="setting-row">
            <span className="grow col gap-2">
              <span>{t("Touche")}</span>
              <span className="hint">{t("Marche aussi quand tu es dans le jeu. Une touche du clavier ou un bouton de souris.")}</span>
            </span>
            <span className={`key-chip${recording ? " rec" : pttKeys ? "" : " empty"}`}>{recording ? t("Appuie sur une touche…") : formatShortcut(pttKeys)}</span>
            <button className="btn small" onClick={() => (recording ? rec.cancel() : void rec.record("ptt"))}>
              {recording ? t("Annuler") : t("Changer")}
            </button>
          </div>
          {rec.conflict && <ConflictNote c={rec.conflict} onConfirm={rec.confirm} onCancel={rec.dismiss} />}
          {!pttKeys && !recording && <span className="hint warn">{t("Choisis une touche : sans elle, ton micro reste fermé.")}</span>}
          <label className="setting-row">
            <span className="grow col gap-2">
              <span>{t("Délai avant de couper")}</span>
              <span className="hint">{t("Garde le micro ouvert un instant après avoir lâché, pour ne pas couper la fin des mots.")}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={50}
              value={a.pttDelay}
              onChange={(e) => updateSettings("audio", { pttDelay: Number(e.target.value) })}
              aria-label={t("Délai avant de couper")}
            />
            <span className="value">{(a.pttDelay / 1000).toFixed(2).replace(/0$/, "")} s</span>
          </label>
          <Toggle label={t("Petit son à l'appui et au relâchement")} checked={a.pttSound} onChange={(v) => updateSettings("audio", { pttSound: v })} />
          <GlobalNote />
        </>
      )}
    </Card>
  );
}

/** Seuil de voix réglable, avec le niveau du micro en direct (pendant le test). */
function VoiceThreshold({ threshold }: { threshold: number }) {
  const [db, setDb] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopRef.current?.(), []);
  const MIN = -70;
  const MAX = -20;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100));

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: loadDevices().input } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      let shown = -100;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const level = 10 * Math.log10(sum / buf.length + 1e-12);
        shown = Math.max(level, shown - 1.5); // redescend doucement
        setDb(shown);
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx.close();
        setDb(null);
        stopRef.current = undefined;
      };
    } catch {
      setDb(null);
    }
  }

  const above = db !== null && db >= threshold;
  return (
    <div className="col gap-8">
      <div className="setting-row">
        <span className="grow">{t("Seuil de voix")}</span>
        <button className="btn small" onClick={() => (stopRef.current ? stopRef.current() : void start())}>
          {db === null ? t("Tester") : t("Arrêter")}
        </button>
      </div>
      <div className="threshold">
        <div className="threshold-track" aria-hidden="true">
          {db !== null && <span className={`threshold-level${above ? " on" : ""}`} style={{ width: `${pct(db)}%` }} />}
          <span className="threshold-mark" style={{ left: `${pct(threshold)}%` }} />
        </div>
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={threshold}
          onChange={(e) => updateSettings("audio", { gateThreshold: Number(e.target.value) })}
          aria-label={t("Seuil de voix")}
        />
        <span className="value">
          {threshold} {t("dB")}
        </span>
      </div>
      <span className="hint">{t("Clique sur Tester et parle : la barre devient turquoise quand ta voix passe le seuil (trait ambre). En dessous, on ne t'entend pas.")}</span>
    </div>
  );
}

export function DuckCard({ s }: { s: S }) {
  return (
    <Card title={t("Les autres pendant que je parle")}>
      <Toggle
        label={t("Baisser les autres quand je parle")}
        hint={t("Les voix des autres baissent pendant que tu parles, puis reviennent doucement. Le son des partages d'écran n'est pas baissé.")}
        checked={s.audio.duck}
        onChange={(v) => updateSettings("audio", { duck: v })}
      />
      <label className={`setting-row${s.audio.duck ? "" : " disabled"}`}>
        <span className="grow">{t("Baisser de")}</span>
        <input
          type="range"
          min={0.2}
          max={0.9}
          step={0.05}
          disabled={!s.audio.duck}
          value={s.audio.duckAmount}
          onChange={(e) => updateSettings("audio", { duckAmount: Number(e.target.value) })}
          aria-label={t("Baisser les autres de")}
        />
        <span className="value">{Math.round(s.audio.duckAmount * 100)} %</span>
      </label>
    </Card>
  );
}

/** Dans le navigateur ou sur Mac sans autorisation, les raccourcis ne marchent que dans tomo. */
function GlobalNote() {
  const [ok, setOk] = useState(hotkeysGlobal());
  if (ok) return null;
  if (!inTauri) return <span className="hint">{t("Version navigateur : les raccourcis ne marchent que quand Tomo est au premier plan.")}</span>;
  return (
    <div className="key-conflict">
      <span>{t("Pour que les raccourcis marchent en jeu, autorise Tomo dans Réglages Système › Confidentialité › Surveillance de l'entrée.")}</span>
      <button className="btn small" onClick={() => void askInputPermission().then(setOk)}>
        {t("Autoriser")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raccourcis clavier
// ---------------------------------------------------------------------------
const GROUPS: { id: ActionDef["group"]; label: string }[] = [
  { id: "voice", label: t("Vocal") },
  { id: "game", label: t("En jeu") },
  { id: "app", label: t("Dans Tomo") },
];

export function ShortcutsSection(_: { s: S }) {
  const rec = useRecorder();

  return (
    <>
      <div className="row gap-12 wrap" style={{ alignItems: "center", paddingRight: 56 }}>
        <h1 className="title grow">{t("Raccourcis clavier")}</h1>
        <button className="btn small" onClick={resetShortcuts}>
          {t("Tout remettre par défaut")}
        </button>
      </div>
      <p className="hint">
        {t("Clique sur une touche pour la changer, puis appuie sur la combinaison voulue (Échap pour annuler).")}{" "}
        <span className="chip teal">{t("En jeu")}</span> {t("= marche même quand Tomo est en arrière-plan, sans bloquer la touche pour le jeu.")}
      </p>
      <GlobalNote />
      {rec.conflict && <ConflictNote c={rec.conflict} onConfirm={rec.confirm} onCancel={rec.dismiss} />}

      {GROUPS.map((g) => (
        <Card key={g.id} title={g.label}>
          <ul className="shortcut-list">
            {ACTIONS.filter((a) => a.group === g.id).map((a) => {
              const keys = shortcutOf(a.id);
              const recording = rec.recording === a.id;
              return (
                <li key={a.id}>
                  <span className="grow col gap-2">
                    <span>{a.label}</span>
                    {a.hint && <span className="hint">{a.hint}</span>}
                  </span>
                  <span className={`chip ${a.global ? "teal" : ""}`}>{a.global ? t("En jeu") : t("Dans Tomo")}</span>
                  <button
                    className={`key-chip${recording ? " rec" : keys ? "" : " empty"}`}
                    onClick={() => (recording ? rec.cancel() : void rec.record(a.id))}
                    aria-label={t("Changer le raccourci de « {0} »", { 0: a.label })}
                  >
                    {recording ? t("Appuie sur une touche…") : formatShortcut(keys)}
                  </button>
                  {keys ? (
                    <button className="icon-btn sm" onClick={() => setShortcut(a.id, null)} aria-label={t("Effacer le raccourci de « {0} »", { 0: a.label })} title={t("Effacer")}>
                      <Icon name="x" size={14} />
                    </button>
                  ) : (
                    <span className="icon-btn-space" />
                  )}
                </li>
              );
            })}
            {g.id === "app" && (
              <>
                <li>
                  <span className="grow">{t("Aller au serveur n°1 à 9")}</span>
                  <span className="chip">{t("Dans Tomo")}</span>
                  <kbd>Ctrl + 1 … 9</kbd>
                  <span className="icon-btn-space" />
                </li>
                <li>
                  <span className="grow">{t("Envoyer un message")}</span>
                  <span className="chip">{t("Dans Tomo")}</span>
                  <kbd>{t("Entrée")}</kbd>
                  <span className="icon-btn-space" />
                </li>
                <li>
                  <span className="grow">{t("Retour à la ligne dans un message")}</span>
                  <span className="chip">{t("Dans Tomo")}</span>
                  <kbd>{t("Maj + Entrée")}</kbd>
                  <span className="icon-btn-space" />
                </li>
                <li>
                  <span className="grow">{t("Fermer une fenêtre ou les paramètres")}</span>
                  <span className="chip">{t("Dans Tomo")}</span>
                  <kbd>{t("Échap")}</kbd>
                  <span className="icon-btn-space" />
                </li>
              </>
            )}
          </ul>
        </Card>
      ))}
      <span className="hint">{t("Les boutons de souris sur le côté (Souris 4, Souris 5) sont acceptés.")}</span>
    </>
  );
}
