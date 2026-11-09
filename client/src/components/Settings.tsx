import { useEffect, useState, type ReactNode } from "react";
import type { Room } from "livekit-client";
import type { Api, ServerSummary, SessionInfo, User } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { getSettings, loadDevices, onSettingsChange, saveDevices, updateSettings, type Settings as S } from "../lib/prefs";
import { playSound, type SoundName } from "../lib/sounds";
import { errorMessage } from "../lib/ui";
import { Icon, NetworkBadge, UserAvatar, type IconName } from "./Brand";
import { MyProfileSection, PrivacySection } from "./SettingsProfile";
import SettingsGames from "./SettingsGames";
import SettingsOverlay from "./SettingsOverlay";
import { GameAccountsSection } from "./GameStats";
import { autostartEnabled, inTauri, setAutostart } from "../lib/desktop";
import { MicTester } from "./Home";
import { CLIP_CHOICES, clipBlob, clipUrl, clipsSupported, deleteClip, listClips, openClipsFolder, type ClipFile } from "../lib/clips";
import { gameLinkSupported, onGameLink, type GameLink } from "../lib/gameLink";
import { SCREEN_PRESETS } from "../lib/screen";
import { APP_VERSION, checkForUpdate, getUpdateState, onUpdateState, restartNow, type UpdateState } from "../lib/updater";
import { LANGS, lang, locale, setLang, t, type Lang } from "../lib/i18n";
import { DuckCard, MicMode, ShortcutsSection } from "./SettingsVoice";
import { switchDevice } from "../lib/voice";
import { isRecordingShortcut } from "../lib/hotkeys";
import { EmailSettings } from "./EmailAccount";

type Section =
  | "profile"
  | "account"
  | "privacy"
  | "audio"
  | "spatial"
  | "clips"
  | "screen"
  | "games"
  | "overlay"
  | "accounts"
  | "sounds"
  | "appearance"
  | "startup"
  | "shortcuts"
  | "network"
  | "about";

const GROUPS: { title: string; items: { id: Section; label: string; icon: IconName }[] }[] = [
  {
    title: t("Compte"),
    items: [
      { id: "profile", label: t("Mon profil"), icon: "user" },
      { id: "account", label: t("Compte et sécurité"), icon: "lock" },
      { id: "privacy", label: t("Confidentialité"), icon: "shield" },
      { id: "accounts", label: t("Comptes de jeu"), icon: "gamepad" },
    ],
  },
  {
    title: t("Vocal"),
    items: [
      { id: "audio", label: t("Audio et micro"), icon: "mic" },
      { id: "spatial", label: t("Audio spatial"), icon: "orbit" },
      { id: "clips", label: t("Clips"), icon: "rewind" },
      { id: "screen", label: t("Partage d'écran"), icon: "screenShare" },
      { id: "games", label: t("Jeux"), icon: "gamepad" },
      { id: "overlay", label: t("Overlay en jeu"), icon: "layers" },
    ],
  },
  {
    title: t("Appli"),
    items: [
      { id: "sounds", label: t("Sons et notifications"), icon: "bell" },
      { id: "appearance", label: t("Apparence"), icon: "monitor" },
      { id: "startup", label: t("Démarrage"), icon: "power" },
      { id: "shortcuts", label: t("Raccourcis clavier"), icon: "keyboard" },
      { id: "network", label: t("Réseau"), icon: "signal" },
      { id: "about", label: t("À propos"), icon: "info" },
    ],
  },
];

type Props = {
  api: Api;
  user: User;
  realtime: Realtime | null;
  voiceRoom: Room | null;
  onLogout: () => void;
  onLogoutAll: () => void;
  onClose: () => void;
  /** Section ouverte au départ */
  initialSection?: string;
  /** Mon profil a changé (photo, nom…) */
  onProfileChanged: () => void;
};

function useSettings(): S {
  const [s, set] = useState(getSettings());
  useEffect(() => onSettingsChange(set), []);
  return s;
}

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

export default function Settings({ api, user, realtime, voiceRoom, onLogout, onLogoutAll, onClose, initialSection, onProfileChanged }: Props) {
  const [section, setSection] = useState<Section>(
    GROUPS.some((g) => g.items.some((i) => i.id === initialSection)) ? (initialSection as Section) : "profile",
  );
  const s = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !isRecordingShortcut() && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label={t("Paramètres")}>
      <nav className="settings-nav">
        {GROUPS.map((g) => (
          <div key={g.title} className="col gap-2 settings-group">
            <span className="section-title">{g.title}</span>
            {g.items.map((x) => (
              <button key={x.id} className={`nav-item${section === x.id ? " open" : ""}`} onClick={() => setSection(x.id)}>
                <Icon name={x.icon} size={17} />
                <span className="grow left">{x.label}</span>
              </button>
            ))}
          </div>
        ))}
        <span className="menu-sep" />
        <button className="nav-item danger-text" onClick={onLogout}>
          <Icon name="logout" size={17} />
          <span className="grow left">{t("Se déconnecter")}</span>
        </button>
      </nav>

      <div className="settings-body">
        <button className="settings-close" onClick={onClose} aria-label={t("Fermer les paramètres")} title={t("Fermer (Échap)")}>
          <Icon name="x" />
          <span>{t("Échap")}</span>
        </button>
        <div className={`settings-content${section === "profile" ? " wide" : ""}`}>
          {section === "profile" && <MyProfileSection api={api} onChanged={onProfileChanged} />}
          {section === "privacy" && <PrivacySection api={api} />}
          {section === "account" && <Account api={api} user={user} onLogoutAll={onLogoutAll} />}
          {section === "audio" && <Audio s={s} />}
          {section === "spatial" && <Spatial s={s} />}
          {section === "clips" && <Clips s={s} api={api} />}
          {section === "screen" && <ScreenSettings s={s} />}
          {section === "games" && <SettingsGames api={api} />}
          {section === "overlay" && <SettingsOverlay />}
          {section === "accounts" && <GameAccountsSection api={api} realtime={realtime} />}
          {section === "sounds" && <Sounds s={s} />}
          {section === "appearance" && <Appearance s={s} />}
          {section === "startup" && <Startup s={s} />}
          {section === "shortcuts" && <ShortcutsSection s={s} />}
          {section === "network" && <Network api={api} realtime={realtime} voiceRoom={voiceRoom} />}
          {section === "about" && <About s={s} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Account({ api, user, onLogoutAll }: { api: Api; user: User; onLogoutAll: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [mailOn, setMailOn] = useState(true);

  useEffect(() => {
    api.sessions().then(setSessions).catch(() => {});
    api.authConfig().then((c) => setMailOn(c.mail !== false)).catch(() => {});
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(undefined);
    if (next !== confirm) return setMsg({ ok: false, text: t("Les deux nouveaux mots de passe ne sont pas identiques.") });
    if (next.length < 12) return setMsg({ ok: false, text: t("Le nouveau mot de passe doit faire au moins 12 caractères.") });
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: t("Mot de passe changé. Tes autres appareils ont été déconnectés.") });
      api.sessions().then(setSessions).catch(() => {});
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <h1 className="title">{t("Compte et sécurité")}</h1>
      <div className="account-hero">
        <UserAvatar userId={user.id} name={user.username} size={64} />
        <div className="col gap-4">
          <strong className="title-sm">{user.username}</strong>
          <span className="muted small">
            {t("Pseudo de connexion ·")} {user.isDev ? t("compte de test, outils de test activés") : t("compte tomo")}
          </span>
        </div>
      </div>

      <Card title={t("Adresse e-mail")}>
        <EmailSettings api={api} mailOn={mailOn} />
      </Card>

      <Card title={t("Changer le mot de passe")}>
        <form className="col gap-12" onSubmit={changePassword}>
          <label className="field">
            {t("Mot de passe actuel")}
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="grid-2">
            <label className="field">
              {t("Nouveau mot de passe")}
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
            </label>
            <label className="field">
              {t("Confirmer")}
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          </div>
          <span className="hint">{t("12 caractères minimum. Changer de mot de passe déconnecte tes autres appareils.")}</span>
          {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
          <div>
            <button className="btn primary" disabled={!current || !next || !confirm}>
              {t("Changer le mot de passe")}
            </button>
          </div>
        </form>
      </Card>

      <Card title={t("Appareils connectés · {0}", { 0: sessions.length })}>
        <ul className="list">
          {sessions.map((x, i) => (
            <li key={i}>
              <Icon name="monitor" />
              <span className="grow col gap-2">
                <span className="ellipsis">{x.userAgent?.includes("Windows") ? t("Windows") : x.userAgent?.split(" ")[0] ?? t("Appareil inconnu")}</span>
                <span className="muted small">{t("Connecté le")} {new Date(x.createdAt).toLocaleDateString(locale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
            </li>
          ))}
        </ul>
        <div>
          <button className="btn danger" onClick={onLogoutAll}>
            <Icon name="lock" size={16} /> {t("Déconnecter tous mes appareils")}
          </button>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function Audio({ s }: { s: S }) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [devices, setDevices] = useState(loadDevices());

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        setInputs(list.filter((d) => d.kind === "audioinput"));
        setOutputs(list.filter((d) => d.kind === "audiooutput"));
      })
      .catch(() => {});
  }, []);

  function pick(kind: "input" | "output", id: string) {
    const d = { ...devices, [kind]: id || undefined };
    setDevices(d);
    saveDevices(d);
    // En vocal : le changement s'applique tout de suite
    void switchDevice(kind === "input" ? "audioinput" : "audiooutput", id || undefined);
  }

  return (
    <>
      <h1 className="title">{t("Audio et micro")}</h1>
      <Card title={t("Périphériques")}>
        <div className="grid-2">
          <label className="field">
            {t("Micro")}
            <select value={devices.input ?? ""} onChange={(e) => pick("input", e.target.value)}>
              <option value="">{t("Par défaut (Windows)")}</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t("Micro")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Sortie audio")}
            <select value={devices.output ?? ""} onChange={(e) => pick("output", e.target.value)}>
              <option value="">{t("Par défaut (Windows)")}</option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t("Haut-parleurs")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="hint">{t("S'applique tout de suite, même en vocal.")}</span>
        <MicTester />
      </Card>

      <Card title={t("Volume")}>
        <label className="setting-row">
          <span className="grow">{t("Volume général des voix")}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={s.audio.outputVolume}
            onChange={(e) => updateSettings("audio", { outputVolume: Number(e.target.value) })}
            aria-label={t("Volume général des voix")}
          />
          <span className="value">{Math.round(s.audio.outputVolume * 100)} %</span>
        </label>
        <Toggle
          label={t("Volume uniformisé")}
          hint={t("Tout le monde au même niveau : les voix trop faibles sont remontées, les trop fortes baissées, sans rien régler. S'applique tout de suite.")}
          checked={s.audio.normalize}
          onChange={(v) => updateSettings("audio", { normalize: v })}
        />
      </Card>

      <MicMode s={s} />
      <DuckCard s={s} />

      <Card title={t("Traitement du micro")}>
        <span className="setting-label">{t("Suppression du bruit")}</span>
        {DENOISE.map((d) => (
          <label key={d.id} className={`share-option${s.audio.denoise === d.id ? " on" : ""}`}>
            <input type="radio" name="denoise" checked={s.audio.denoise === d.id} onChange={() => updateSettings("audio", { denoise: d.id })} />
            <span className="col gap-2 grow">
              <strong>{d.label}</strong>
              <span className="muted small">{d.detail}</span>
            </span>
          </label>
        ))}
        <ListenTest s={s} />
        <Toggle
          label={t("Annulation d'écho")}
          hint={t("Utile sans casque : évite que tes potes s'entendent dans tes haut-parleurs.")}
          checked={s.audio.echoCancellation}
          onChange={(v) => updateSettings("audio", { echoCancellation: v })}
        />
        <Toggle
          label={t("Contrôle automatique du volume du micro")}
          hint={t("Ajuste ton niveau quand tu parles fort ou doucement.")}
          checked={s.audio.autoGain}
          onChange={(v) => updateSettings("audio", { autoGain: v })}
        />
        <span className="hint">
          {t("Tous ces réglages s'appliquent tout de suite, même en vocal.")}
        </span>
      </Card>
      <CaptionsSettings s={s} />
    </>
  );
}

const CAPTION_MODELS = [
  { id: "onnx-community/whisper-tiny", label: t("Rapide"), detail: t("≈ 40 Mo · le plus réactif, un peu moins juste") },
  { id: "onnx-community/whisper-base", label: t("Équilibré (recommandé)"), detail: t("≈ 80 Mo · bon compromis") },
  { id: "onnx-community/whisper-small", label: t("Précis"), detail: t("≈ 250 Mo · plus juste, demande une bonne carte graphique") },
];

/** Paramètres des sous-titres (dans Audio et micro). */
function CaptionsSettings({ s }: { s: S }) {
  return (
    <Card title={t("Sous-titres en direct")}>
      <span className="hint">
        {t("Bouton « Sous-titres » en haut d'une pièce vocale. La reconnaissance (Whisper) et la traduction (Opus-MT) tournent sur ton PC : le modèle est téléchargé une seule fois, rien d'autre ne sort.")}
      </span>
      {CAPTION_MODELS.map((m) => (
        <label key={m.id} className={`share-option${s.captions.model === m.id ? " on" : ""}`}>
          <input type="radio" name="captions-model" checked={s.captions.model === m.id} onChange={() => updateSettings("captions", { model: m.id })} />
          <span className="col gap-2 grow">
            <strong>{m.label}</strong>
            <span className="muted small">{m.detail}</span>
          </span>
        </label>
      ))}
      <Toggle
        label={t("Traduire dans ma langue")}
        hint={t("Quand un pote parle une autre langue que toi (français ou anglais pour l'instant).")}
        checked={s.captions.translate}
        onChange={(v) => updateSettings("captions", { translate: v })}
      />
    </Card>
  );
}

const DENOISE: { id: S["audio"]["denoise"]; label: string; detail: string }[] = [
  { id: "off", label: t("Aucune"), detail: t("Ton micro tel quel. Pour un micro de studio dans une pièce calme.") },
  { id: "light", label: t("Légère"), detail: t("Le filtre du navigateur : enlève le souffle et le ventilateur.") },
  { id: "advanced", label: t("Avancée (recommandée)"), detail: t("Une petite IA calculée sur ton PC : efface clavier, souris, chien, aspirateur. Rien ne sort de ton PC.") },
];

/** « S'écouter » : renvoie le micro dans le casque, avec ou sans le traitement, pour comparer. */
function ListenTest({ s }: { s: S }) {
  const [mode, setMode] = useState<"off" | "raw" | "clean">("off");
  useEffect(() => {
    if (mode === "off") return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      const { buildChain } = await import("../lib/denoise");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: loadDevices().input, echoCancellation: false, noiseSuppression: mode === "clean" && s.audio.denoise === "light", autoGainControl: false },
      });
      const ctx = new AudioContext({ sampleRate: 48000 });
      const src = ctx.createMediaStreamSource(stream);
      const chain = mode === "clean" ? await buildChain(ctx, s.audio) : null;
      if (chain) {
        src.connect(chain.input);
        chain.output.connect(ctx.destination);
      } else src.connect(ctx.destination);
      stop = () => {
        chain?.dispose();
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      if (cancelled) stop();
    })().catch(() => setMode("off"));
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode, s.audio]);

  return (
    <div className="setting-row">
      <span className="grow col gap-2">
        <span>{t("S'écouter")}</span>
        <span className="muted small">{t("Mets un casque, tape sur ton clavier en parlant, et compare.")}</span>
      </span>
      <div className="segmented" role="group" aria-label={t("S'écouter")}>
        <button className={mode === "raw" ? "on" : ""} onClick={() => setMode(mode === "raw" ? "off" : "raw")}>
          {t("Sans")}
        </button>
        <button className={mode === "clean" ? "on" : ""} onClick={() => setMode(mode === "clean" ? "off" : "clean")}>
          {t("Avec")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const PREVIEWS: [SoundName, string][] = [
  ["join", "Rejoindre"],
  ["leave", "Quitter"],
  ["userJoin", "Quelqu'un arrive"],
  ["mute", "Micro coupé"],
  ["message", "Message"],
  ["ring", "Sonnerie"],
];

function Sounds({ s }: { s: S }) {
  return (
    <>
      <h1 className="title">{t("Sons et notifications")}</h1>
      <Card title={t("Sons de l'interface")}>
        <Toggle label={t("Activer les sons")} checked={s.sounds.enabled} onChange={(v) => updateSettings("sounds", { enabled: v })} />
        <label className="setting-row">
          <span className="grow">{t("Volume des sons")}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.sounds.volume}
            disabled={!s.sounds.enabled}
            onChange={(e) => updateSettings("sounds", { volume: Number(e.target.value) })}
            onMouseUp={() => playSound("message")}
            aria-label={t("Volume des sons")}
          />
          <span className="value">{Math.round(s.sounds.volume * 100)} %</span>
        </label>
      </Card>
      <Card title={t("Quand jouer un son")}>
        <Toggle
          label={t("Vocal")}
          hint={t("Rejoindre / quitter un salon, arrivées et départs, micro et son coupés.")}
          checked={s.sounds.voice}
          onChange={(v) => updateSettings("sounds", { voice: v })}
        />
        <Toggle label={t("Messages privés")} hint={t("Nouveau message d'un ami.")} checked={s.sounds.messages} onChange={(v) => updateSettings("sounds", { messages: v })} />
        <Toggle label={t("Appels")} hint={t("Sonnerie d'appel entrant et fin d'appel.")} checked={s.sounds.calls} onChange={(v) => updateSettings("sounds", { calls: v })} />
      </Card>
      <Card title={t("Notifications du système")}>
        <Toggle
          label={t("Notifications quand tomo est en arrière-plan")}
          hint={t("Messages privés, demandes de message et d'ami, appels entrants. Rien quand tomo est au premier plan.")}
          checked={s.notifications.desktop}
          onChange={(v) => updateSettings("notifications", { desktop: v })}
        />
        <Toggle
          label={t("Montrer le contenu du message")}
          hint={t("Sinon : seulement « Nouveau message », pratique en partage d'écran.")}
          checked={s.notifications.desktopPreview}
          onChange={(v) => updateSettings("notifications", { desktopPreview: v })}
        />
        {!inTauri && <span className="hint">{t("Disponible dans l'application de bureau.")}</span>}
      </Card>
      <Card title={t("Heures calmes")}>
        <Toggle
          label={t("Couper sons et notifications sur un créneau")}
          hint={t("Comme « Ne pas déranger », mais tout seul chaque jour (le vocal n'est pas touché).")}
          checked={s.notifications.quietEnabled}
          onChange={(v) => updateSettings("notifications", { quietEnabled: v })}
        />
        <div className="row gap-12 wrap">
          <label className="field">
            {t("De")}
            <input type="time" value={s.notifications.quietFrom} disabled={!s.notifications.quietEnabled} onChange={(e) => updateSettings("notifications", { quietFrom: e.target.value })} />
          </label>
          <label className="field">
            {t("À")}
            <input type="time" value={s.notifications.quietTo} disabled={!s.notifications.quietEnabled} onChange={(e) => updateSettings("notifications", { quietTo: e.target.value })} />
          </label>
        </div>
      </Card>
      <Card title={t("Écouter")}>
        <div className="chips">
          {PREVIEWS.map(([name, label]) => (
            <button key={name} className="chip" onClick={() => playSound(name, true)}>
              <Icon name="volume" size={14} /> {label}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function Appearance({ s }: { s: S }) {
  return (
    <>
      <h1 className="title">{t("Apparence")}</h1>
      <Card title={t("Langue")}>
        <label className="setting-row">
          <span className="grow col gap-2">
            <span>{t("Langue de tomo")}</span>
            <span className="hint">{t("tomo redémarre la fenêtre pour changer de langue.")}</span>
          </span>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("Langue de tomo")}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </Card>
      <Card title={t("Taille de l'interface")}>
        <label className="setting-row">
          <span className="grow">{t("Zoom")}</span>
          <input
            type="range"
            min={0.8}
            max={1.3}
            step={0.05}
            value={s.appearance.zoom}
            onChange={(e) => updateSettings("appearance", { zoom: Number(e.target.value) })}
            aria-label={t("Zoom de l'interface")}
          />
          <span className="value">{Math.round(s.appearance.zoom * 100)} %</span>
        </label>
        <div>
          <button className="btn small" onClick={() => updateSettings("appearance", { zoom: 1 })}>
            {t("Réinitialiser")}
          </button>
        </div>
      </Card>
      <Card title={t("Affichage")}>
        <Toggle
          label={t("Mode compact")}
          hint={t("Tuiles et listes plus serrées, pour voir plus de monde à l'écran.")}
          checked={s.appearance.compact}
          onChange={(v) => updateSettings("appearance", { compact: v })}
        />
        <Toggle
          label={t("Réduire les animations")}
          hint={t("Désactive les barres animées et les transitions.")}
          checked={s.appearance.reducedMotion}
          onChange={(v) => updateSettings("appearance", { reducedMotion: v })}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function Startup({ s }: { s: S }) {
  const [auto, setAuto] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => void autostartEnabled().then(setAuto), []);
  return (
    <>
      <h1 className="title">{t("Démarrage")}</h1>
      <Card title={t("Au démarrage de l'ordinateur")}>
        <Toggle
          label={t("Lancer tomo avec Windows / macOS")}
          hint={t("tomo s'ouvre tout seul quand tu allumes ton PC : tes potes te voient en ligne.")}
          checked={!!auto}
          onChange={async (v) => {
            setError(undefined);
            try {
              await setAutostart(v);
              setAuto(await autostartEnabled());
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
        <Toggle
          label={t("Démarrer réduit")}
          hint={t("Quand tomo se lance avec l'ordinateur, la fenêtre reste dans la barre des tâches.")}
          checked={s.startup.minimized}
          onChange={(v) => updateSettings("startup", { minimized: v })}
        />
        {!inTauri && <span className="hint">{t("Disponible dans l'application de bureau.")}</span>}
        {error && <p className="error small">{error}</p>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
function Network({ api, realtime, voiceRoom }: { api: Api; realtime: Realtime | null; voiceRoom: Room | null }) {
  const [ping, setPing] = useState(realtime?.apiPing ?? null);
  const [connected, setConnected] = useState(realtime?.connected ?? false);
  useEffect(() => {
    if (!realtime) return;
    return realtime.on((e) => {
      if (e.type === "ping") setPing(e.ms);
      if (e.type === "connection") setConnected(e.connected);
    });
  }, [realtime]);

  return (
    <>
      <h1 className="title">{t("Réseau")}</h1>
      <Card title={t("Connexion")}>
        <ul className="list">
          <li>
            <span className="grow">{t("Instance tomo")}</span>
            <span className="muted">{api.baseUrl.replace(/^https?:\/\//, "")}</span>
          </li>
          <li>
            <span className="grow">{t("Temps réel (messages, appels)")}</span>
            <span className={connected ? "ok" : "warning"}>{connected ? t("connecté") : "reconnexion…"}</span>
          </li>
          <li>
            <span className="grow">{t("Ping de l'API")}</span>
            <span className={ping === null ? "muted" : ping < 100 ? "ok" : ping < 250 ? "warning" : "error"}>{ping === null ? "—" : `${ping} ms`}</span>
          </li>
          <li>
            <span className="grow">{t("Vocal")}</span>
            {voiceRoom ? <NetworkBadge room={voiceRoom} showLabel /> : <span className="muted">{t("pas en vocal")}</span>}
          </li>
        </ul>
        <span className="hint">{t("Moins de 80 ms : excellent pour jouer. Au-delà de 200 ms, un léger décalage dans les conversations est possible.")}</span>
      </Card>
    </>
  );
}

function About(_: { s: S }) {
  const [up, setUp] = useState<UpdateState>(getUpdateState());
  useEffect(() => onUpdateState(setUp), []);
  const desktop = inTauri;
  return (
    <>
      <h1 className="title">{t("À propos")}</h1>
      <Card title={t("Mises à jour")}>
        <div className="setting-row">
          <span className="grow col gap-2">
            <span>{t("tomo")} {APP_VERSION}</span>
            <span className="muted small">
              {!desktop
                ? t("Version navigateur : toujours à jour.")
                : up.kind === "checking"
                  ? t("Recherche en cours…")
                  : up.kind === "none"
                    ? t("Tu as la dernière version.")
                    : up.kind === "downloading"
                      ? t("Téléchargement de tomo {0}… {1} %", { 0: up.version, 1: Math.round(up.progress * 100) })
                      : up.kind === "ready"
                        ? t("tomo {0} est prête : redémarre pour l'installer.", { 0: up.version })
                        : up.kind === "error"
                          ? up.message
                          : t("tomo vérifie à chaque lancement (la mise à jour s'installe alors d'office) puis toutes les 30 minutes.")}
            </span>
          </span>
          {desktop &&
            (up.kind === "ready" ? (
              <button className="btn primary small" onClick={() => void restartNow()}>
                {t("Redémarrer")}
              </button>
            ) : (
              <button className="btn small" disabled={up.kind === "checking" || up.kind === "downloading"} onClick={() => void checkForUpdate(true)}>
                {t("Rechercher")}
              </button>
            ))}
        </div>
        <span className="hint">
          {t("Les mises à jour sont obligatoires : tes potes et toi avez toujours la même version. Pendant l'utilisation, tomo te propose de l'installer, jamais pendant un vocal.")}
        </span>
      </Card>
      <Card title={t("tomo")}>
        <p className="text">{t("Le vocal pensé pour jouer entre potes. Gratuit, auto-hébergé, open source (licence MIT).")}</p>
        <ul className="list">
          <li>
            <span className="grow">{t("Version")}</span>
            <span className="muted">{APP_VERSION}</span>
          </li>
          <li>
            <span className="grow">{t("Télécharger l'installateur")}</span>
            <a href="https://github.com/kameronramah/tomo/releases/latest" target="_blank" rel="noreferrer">
              {t("Dernière version (Windows, Mac)")}
            </a>
          </li>
          <li>
            <span className="grow">{t("Code source")}</span>
            <a href="https://github.com/kameronramah/tomo" target="_blank" rel="noreferrer">
              {t("github.com/kameronramah/tomo")}
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function Spatial({ s }: { s: S }) {
  const [game, setGame] = useState<GameLink | null>(null);
  useEffect(() => onGameLink(setGame), []);
  return (
    <>
      <h1 className="title">{t("Audio spatial")}</h1>
      <p className="muted text">
        {t("Quand un salon a l'audio spatial activé, chaque voix vient de la direction de la personne et baisse avec la distance. Un casque est fortement conseillé.")}
      </p>
      <Card title={t("Portée")}>
        <label className="setting-row">
          <span className="grow">{t("Distance maximale d'écoute")}</span>
          <input
            type="range"
            min={8}
            max={60}
            step={1}
            value={s.spatial.range}
            onChange={(e) => updateSettings("spatial", { range: Number(e.target.value) })}
            aria-label={t("Portée d'écoute en mètres")}
          />
          <span className="value">{s.spatial.range} {t("m")}</span>
        </label>
        <Toggle
          label={t("Afficher la carte du salon")}
          hint={t("Sinon, les tuiles habituelles restent affichées (avec la distance de chacun).")}
          checked={s.spatial.showMap}
          onChange={(v) => updateSettings("spatial", { showMap: v })}
        />
      </Card>
      <Card title={t("Position dans le jeu (Mumble Link)")}>
        {!gameLinkSupported ? (
          <p className="muted">{t("Disponible dans l'application de bureau.")}</p>
        ) : game ? (
          <p className="ok">
            {t("Jeu détecté :")} <strong>{game.game || t("jeu compatible")}</strong> {t("— ta position en jeu est utilisée automatiquement.")}
          </p>
        ) : (
          <p className="muted">{t("Aucun jeu compatible détecté pour l'instant. Sans jeu, la carte du salon est utilisée.")}</p>
        )}
        <span className="hint">
          {t("Compatibles : Minecraft (avec un mod « MumbleLink »), Guild Wars 2, Arma 3, Star Citizen, et tous les jeux ou mods qui prennent en charge Mumble Link. Pour que deux joueurs s'entendent en 3D, ils doivent être dans le même jeu et sur le même serveur de jeu.")}
        </span>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function Clips({ s, api }: { s: S; api: Api }) {
  const [clips, setClips] = useState<ClipFile[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [pinning, setPinning] = useState<{ name: string; title: string; serverId: string } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => void api.servers().then(setServers).catch(() => {}), [api]);
  const [playing, setPlaying] = useState<{ name: string; url: string } | null>(null);
  const [error, setError] = useState<string>();
  const reload = () => listClips().then(setClips).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    reload();
  }, []);
  useEffect(
    () => () => {
      if (playing) URL.revokeObjectURL(playing.url);
    },
    [playing],
  );

  return (
    <>
      <h1 className="title">{t("Clips")}</h1>
      <Card title={t("Garder les {0} dernières secondes", { 0: s.clips.seconds })}>
        <Toggle
          label={t("Activer les clips")}
          hint={t("tomo garde en mémoire les {0} dernières secondes du salon (toutes les voix + ton micro). Rien n'est enregistré tant que tu n'appuies pas sur le bouton Clip ou Ctrl+Maj+C.", { 0: s.clips.seconds })}
          checked={s.clips.enabled}
          onChange={(v) => updateSettings("clips", { enabled: v })}
        />
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Durée du clip")}</span>
            <span className="hint">{t("Plus long = un peu plus de mémoire utilisée (2 min ≈ 46 Mo).")}</span>
          </span>
          <select value={s.clips.seconds} onChange={(e) => updateSettings("clips", { seconds: Number(e.target.value) as 30 | 60 | 120 })}>
            {CLIP_CHOICES.map((x) => (
              <option key={x} value={x}>
                {x < 60 ? t("{0} secondes", { 0: x }) : x > 60 ? t("{0} minutes", { 0: x / 60 }) : t("1 minute")}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {t("Par respect pour tes potes, une petite icône ⏪ s'affiche sur ta tuile tant que les clips sont activés. Les clips restent sur ton PC (dossier Musique\\tomo Clips).")}
        </span>
      </Card>
      <Card title={t("Mes clips · {0}", { 0: clips.length })}>
        {!clipsSupported ? (
          <p className="muted">{t("Dans le navigateur, les clips sont téléchargés directement. La liste est disponible dans l'application de bureau.")}</p>
        ) : clips.length === 0 ? (
          <p className="muted">{t("Aucun clip pour l'instant. En vocal, clique sur « Clip » dans le dock.")}</p>
        ) : (
          <ul className="list">
            {clips.map((c) => (
              <li key={c.name}>
                <button
                  className="icon-btn round"
                  aria-label={t("Écouter {0}", { 0: c.name })}
                  onClick={async () => {
                    try {
                      setPlaying({ name: c.name, url: await clipUrl(c.name) });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  <Icon name="volume" />
                </button>
                <span className="grow col gap-2">
                  <span className="ellipsis">{c.name.replace(/\.wav$/, "")}</span>
                  <span className="muted small">{(c.size / 1024 / 1024).toFixed(1)} {t("Mo")}</span>
                </span>
                <button className="btn small" onClick={() => setPinning({ name: c.name, title: "", serverId: servers[0]?.id ?? "" })} disabled={!servers.length}>
                  <Icon name="star" size={14} /> {t("Mettre au mur")}
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={t("Supprimer {0}", { 0: c.name })}
                  title={t("Supprimer")}
                  onClick={() => deleteClip(c.name).then(reload).catch((e) => setError(errorMessage(e)))}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {pinning && (
          <form
            className="pin-clip"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              try {
                const { blob, durationMs } = await clipBlob(pinning.name);
                const att = await api.uploadAttachment(blob, { name: pinning.name, durationMs });
                await api.pinClip(pinning.serverId, att.id, pinning.title.trim());
                setPinning(null);
                setPinned(pinning.name);
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <strong className="small">{t("Mettre « {0} » au mur des légendes", { 0: pinning.name.replace(/\.wav$/, "") })}</strong>
            <div className="row gap-8 wrap">
              <input value={pinning.title} onChange={(e) => setPinning({ ...pinning, title: e.target.value })} maxLength={80} placeholder={t("Titre, ex. : le clutch à 1 contre 4")} autoFocus />
              <select value={pinning.serverId} onChange={(e) => setPinning({ ...pinning, serverId: e.target.value })} aria-label={t("Serveur")}>
                {servers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <button className="btn primary small" disabled={!pinning.title.trim() || !pinning.serverId}>
                {t("Épingler")}
              </button>
              <button type="button" className="btn small" onClick={() => setPinning(null)}>
                {t("Annuler")}
              </button>
            </div>
          </form>
        )}
        {pinned && <p className="ok small">{t("« {0} » est sur le mur des légendes.", { 0: pinned.replace(/\.wav$/, "") })}</p>}
        {playing && (
          <div className="col gap-4">
            <span className="small muted">{playing.name}</span>
            <audio src={playing.url} controls autoPlay className="clip-player" />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {clipsSupported && (
          <div>
            <button className="btn" onClick={() => openClipsFolder().catch((e) => setError(errorMessage(e)))}>
              {t("Ouvrir le dossier des clips")}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
// ---------------------------------------------------------------------------
function ScreenSettings({ s }: { s: S }) {
  return (
    <>
      <h1 className="title">{t("Partage d'écran")}</h1>
      <p className="muted text">
        {t("Clique sur l'icône d'écran dans le dock d'un salon vocal pour partager un écran ou une fenêtre. Ces choix sont proposés par défaut.")}
      </p>
      <Card title={t("Qualité par défaut")}>
        {SCREEN_PRESETS.map((p) => (
          <label key={p.id} className={`share-option${s.screen.preset === p.id ? " on" : ""}`}>
            <input type="radio" name="default-preset" checked={s.screen.preset === p.id} onChange={() => updateSettings("screen", { preset: p.id })} />
            <span className="col gap-2 grow">
              <strong>{p.label}</strong>
              <span className="muted small">
                {p.detail} {t("· environ")} {Math.round(p.bitrate / 1_000_000)} {t("Mbit/s ·")} {p.codec === "h264" ? t("H.264 (carte graphique)") : t("VP9 (plus net)")}
              </span>
            </span>
          </label>
        ))}
        <span className="hint">
          {t("« Jeu fluide » utilise l'encodage matériel de ta carte graphique : ton processeur reste libre pour jouer. Les potes avec une connexion plus faible reçoivent automatiquement une version allégée.")}
        </span>
      </Card>
      <Card title={t("Son")}>
        <Toggle
          label={t("Partager aussi le son du PC")}
          hint={t("Le son du jeu ou de la vidéo est envoyé avec l'image (écran entier). Tes potes peuvent régler son volume à part.")}
          checked={s.screen.audio}
          onChange={(v) => updateSettings("screen", { audio: v })}
        />
      </Card>
      <Card title={t("Bon à savoir")}>
        <span className="hint">
          {t("Chaque spectateur reçoit le flux depuis le serveur : en « Maximum » (4K), compte jusqu'à 16 Mbit/s en envoi pour toi, et autant par spectateur côté serveur. Vérifie la bande passante du VPS avant de partager en 4K à plusieurs.")}
        </span>
      </Card>
    </>
  );
}
