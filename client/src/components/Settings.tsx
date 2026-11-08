import { useEffect, useState, type ReactNode } from "react";
import type { Room } from "livekit-client";
import type { Api, SessionInfo, User } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { getSettings, loadDevices, onSettingsChange, saveDevices, updateSettings, type Settings as S } from "../lib/prefs";
import { playSound, type SoundName } from "../lib/sounds";
import { errorMessage } from "../lib/ui";
import { Avatar, Icon, NetworkBadge, type IconName } from "./Brand";
import { MicTester } from "./Home";

type Section = "account" | "audio" | "sounds" | "appearance" | "shortcuts" | "network" | "about";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "account", label: "Mon compte", icon: "user" },
  { id: "audio", label: "Audio et micro", icon: "mic" },
  { id: "sounds", label: "Sons et notifications", icon: "bell" },
  { id: "appearance", label: "Apparence", icon: "monitor" },
  { id: "shortcuts", label: "Raccourcis clavier", icon: "keyboard" },
  { id: "network", label: "Réseau", icon: "signal" },
  { id: "about", label: "À propos", icon: "info" },
];

type Props = {
  api: Api;
  user: User;
  realtime: Realtime | null;
  voiceRoom: Room | null;
  onLogout: () => void;
  onLogoutAll: () => void;
  onClose: () => void;
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

export default function Settings({ api, user, realtime, voiceRoom, onLogout, onLogoutAll, onClose }: Props) {
  const [section, setSection] = useState<Section>("account");
  const s = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Paramètres">
      <nav className="settings-nav">
        <span className="section-title">Paramètres</span>
        {SECTIONS.map((x) => (
          <button key={x.id} className={`nav-item${section === x.id ? " open" : ""}`} onClick={() => setSection(x.id)}>
            <Icon name={x.icon} size={17} />
            <span className="grow left">{x.label}</span>
          </button>
        ))}
        <span className="menu-sep" />
        <button className="nav-item danger-text" onClick={onLogout}>
          <Icon name="logout" size={17} />
          <span className="grow left">Se déconnecter</span>
        </button>
      </nav>

      <div className="settings-body">
        <button className="settings-close" onClick={onClose} aria-label="Fermer les paramètres" title="Fermer (Échap)">
          <Icon name="x" />
          <span>Échap</span>
        </button>
        <div className="settings-content">
          {section === "account" && <Account api={api} user={user} onLogoutAll={onLogoutAll} />}
          {section === "audio" && <Audio s={s} />}
          {section === "sounds" && <Sounds s={s} />}
          {section === "appearance" && <Appearance s={s} />}
          {section === "shortcuts" && <Shortcuts />}
          {section === "network" && <Network api={api} realtime={realtime} voiceRoom={voiceRoom} />}
          {section === "about" && <About />}
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

  useEffect(() => {
    api.sessions().then(setSessions).catch(() => {});
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(undefined);
    if (next !== confirm) return setMsg({ ok: false, text: "Les deux nouveaux mots de passe ne sont pas identiques." });
    if (next.length < 12) return setMsg({ ok: false, text: "Le nouveau mot de passe doit faire au moins 12 caractères." });
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Mot de passe changé. Tes autres appareils ont été déconnectés." });
      api.sessions().then(setSessions).catch(() => {});
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <>
      <h1 className="title">Mon compte</h1>
      <div className="account-hero">
        <Avatar name={user.username} size={64} />
        <div className="col gap-4">
          <strong className="title-sm">{user.username}</strong>
          <span className="muted small">{user.isDev ? "Compte de test · outils de test activés" : "Compte Tomo"}</span>
        </div>
      </div>

      <Card title="Changer le mot de passe">
        <form className="col gap-12" onSubmit={changePassword}>
          <label className="field">
            Mot de passe actuel
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <div className="grid-2">
            <label className="field">
              Nouveau mot de passe
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
            </label>
            <label className="field">
              Confirmer
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          </div>
          <span className="hint">12 caractères minimum. Changer de mot de passe déconnecte tes autres appareils.</span>
          {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
          <div>
            <button className="btn primary" disabled={!current || !next || !confirm}>
              Changer le mot de passe
            </button>
          </div>
        </form>
      </Card>

      <Card title={`Appareils connectés · ${sessions.length}`}>
        <ul className="list">
          {sessions.map((x, i) => (
            <li key={i}>
              <Icon name="monitor" />
              <span className="grow col gap-2">
                <span className="ellipsis">{x.userAgent?.includes("Windows") ? "Windows" : x.userAgent?.split(" ")[0] ?? "Appareil inconnu"}</span>
                <span className="muted small">Connecté le {new Date(x.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
            </li>
          ))}
        </ul>
        <div>
          <button className="btn danger" onClick={onLogoutAll}>
            <Icon name="lock" size={16} /> Déconnecter tous mes appareils
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
  }

  return (
    <>
      <h1 className="title">Audio et micro</h1>
      <Card title="Périphériques">
        <div className="grid-2">
          <label className="field">
            Micro
            <select value={devices.input ?? ""} onChange={(e) => pick("input", e.target.value)}>
              <option value="">Par défaut (Windows)</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Micro"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sortie audio
            <select value={devices.output ?? ""} onChange={(e) => pick("output", e.target.value)}>
              <option value="">Par défaut (Windows)</option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Haut-parleurs"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="hint">Pris en compte à la prochaine connexion à un salon. En vocal, utilise le bouton réglages du dock pour changer tout de suite.</span>
        <MicTester />
      </Card>

      <Card title="Volume">
        <label className="setting-row">
          <span className="grow">Volume général des voix</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={s.audio.outputVolume}
            onChange={(e) => updateSettings("audio", { outputVolume: Number(e.target.value) })}
            aria-label="Volume général des voix"
          />
          <span className="value">{Math.round(s.audio.outputVolume * 100)} %</span>
        </label>
      </Card>

      <Card title="Traitement du micro">
        <Toggle
          label="Suppression du bruit"
          hint="Atténue clavier, ventilateur, bruits de fond."
          checked={s.audio.noiseSuppression}
          onChange={(v) => updateSettings("audio", { noiseSuppression: v })}
        />
        <Toggle
          label="Annulation d'écho"
          hint="Utile sans casque : évite que tes potes s'entendent dans tes haut-parleurs."
          checked={s.audio.echoCancellation}
          onChange={(v) => updateSettings("audio", { echoCancellation: v })}
        />
        <Toggle
          label="Contrôle automatique du volume du micro"
          hint="Ajuste ton niveau quand tu parles fort ou doucement."
          checked={s.audio.autoGain}
          onChange={(v) => updateSettings("audio", { autoGain: v })}
        />
        <span className="hint">Ces réglages s'appliquent à la prochaine connexion à un salon.</span>
      </Card>
    </>
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
      <h1 className="title">Sons et notifications</h1>
      <Card title="Sons de l'interface">
        <Toggle label="Activer les sons" checked={s.sounds.enabled} onChange={(v) => updateSettings("sounds", { enabled: v })} />
        <label className="setting-row">
          <span className="grow">Volume des sons</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.sounds.volume}
            disabled={!s.sounds.enabled}
            onChange={(e) => updateSettings("sounds", { volume: Number(e.target.value) })}
            onMouseUp={() => playSound("message")}
            aria-label="Volume des sons"
          />
          <span className="value">{Math.round(s.sounds.volume * 100)} %</span>
        </label>
      </Card>
      <Card title="Quand jouer un son">
        <Toggle
          label="Vocal"
          hint="Rejoindre / quitter un salon, arrivées et départs, micro et son coupés."
          checked={s.sounds.voice}
          onChange={(v) => updateSettings("sounds", { voice: v })}
        />
        <Toggle label="Messages privés" hint="Nouveau message d'un ami." checked={s.sounds.messages} onChange={(v) => updateSettings("sounds", { messages: v })} />
        <Toggle label="Appels" hint="Sonnerie d'appel entrant et fin d'appel." checked={s.sounds.calls} onChange={(v) => updateSettings("sounds", { calls: v })} />
      </Card>
      <Card title="Écouter">
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
      <h1 className="title">Apparence</h1>
      <Card title="Taille de l'interface">
        <label className="setting-row">
          <span className="grow">Zoom</span>
          <input
            type="range"
            min={0.8}
            max={1.3}
            step={0.05}
            value={s.appearance.zoom}
            onChange={(e) => updateSettings("appearance", { zoom: Number(e.target.value) })}
            aria-label="Zoom de l'interface"
          />
          <span className="value">{Math.round(s.appearance.zoom * 100)} %</span>
        </label>
        <div>
          <button className="btn small" onClick={() => updateSettings("appearance", { zoom: 1 })}>
            Réinitialiser
          </button>
        </div>
      </Card>
      <Card title="Affichage">
        <Toggle
          label="Mode compact"
          hint="Tuiles et listes plus serrées, pour voir plus de monde à l'écran."
          checked={s.appearance.compact}
          onChange={(v) => updateSettings("appearance", { compact: v })}
        />
        <Toggle
          label="Réduire les animations"
          hint="Désactive les barres animées et les transitions."
          checked={s.appearance.reducedMotion}
          onChange={(v) => updateSettings("appearance", { reducedMotion: v })}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
const SHORTCUTS: [string, string][] = [
  ["Ctrl + 1 … 9", "Aller au serveur n°1 à 9"],
  ["Ctrl + Maj + M", "Couper / activer le micro"],
  ["Ctrl + Maj + D", "Couper / rétablir le son"],
  ["Ctrl + ,", "Ouvrir les paramètres"],
  ["Entrée", "Envoyer un message"],
  ["Maj + Entrée", "Retour à la ligne dans un message"],
  ["Échap", "Fermer une fenêtre ou les paramètres"],
];

function Shortcuts() {
  return (
    <>
      <h1 className="title">Raccourcis clavier</h1>
      <Card title="Dans l'application">
        <ul className="list">
          {SHORTCUTS.map(([k, d]) => (
            <li key={k}>
              <span className="grow">{d}</span>
              <kbd>{k}</kbd>
            </li>
          ))}
        </ul>
        <span className="hint">Les raccourcis globaux (qui marchent pendant que tu joues, comme le push-to-talk) arrivent bientôt.</span>
      </Card>
    </>
  );
}

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
      <h1 className="title">Réseau</h1>
      <Card title="Connexion">
        <ul className="list">
          <li>
            <span className="grow">Instance Tomo</span>
            <span className="muted">{api.baseUrl.replace(/^https?:\/\//, "")}</span>
          </li>
          <li>
            <span className="grow">Temps réel (messages, appels)</span>
            <span className={connected ? "ok" : "warning"}>{connected ? "connecté" : "reconnexion…"}</span>
          </li>
          <li>
            <span className="grow">Ping de l'API</span>
            <span className={ping === null ? "muted" : ping < 100 ? "ok" : ping < 250 ? "warning" : "error"}>{ping === null ? "—" : `${ping} ms`}</span>
          </li>
          <li>
            <span className="grow">Vocal</span>
            {voiceRoom ? <NetworkBadge room={voiceRoom} showLabel /> : <span className="muted">pas en vocal</span>}
          </li>
        </ul>
        <span className="hint">Moins de 80 ms : excellent pour jouer. Au-delà de 200 ms, un léger décalage dans les conversations est possible.</span>
      </Card>
    </>
  );
}

function About() {
  return (
    <>
      <h1 className="title">À propos</h1>
      <Card title="Tomo">
        <p className="text">Le vocal pensé pour jouer entre potes. Gratuit, auto-hébergé, open source (licence MIT).</p>
        <ul className="list">
          <li>
            <span className="grow">Version</span>
            <span className="muted">0.3.0</span>
          </li>
          <li>
            <span className="grow">Code source</span>
            <a href="https://github.com/kameronramah/T2M" target="_blank" rel="noreferrer">
              github.com/kameronramah/T2M
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}
