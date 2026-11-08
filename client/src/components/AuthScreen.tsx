import { useEffect, useState } from "react";
import type { Api, Session } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Icon, Logo, Wordmark } from "./Brand";

type Mode = "login" | "register" | "guest";

type Props = {
  api: Api;
  notice?: string;
  onSession: (s: Session) => void;
  onChangeInstance: (url: string) => void;
};

const PASSWORD_MIN = 12;

/** Force indicative du mot de passe, de 0 à 4. */
function strength(pw: string): number {
  if (pw.length < PASSWORD_MIN) return pw.length >= 8 ? 1 : 0;
  let score = 2;
  if (pw.length >= 16) score++;
  if (/[^a-zA-Z]/.test(pw) && /[a-z]/i.test(pw)) score++;
  return Math.min(score, 4);
}
const STRENGTH_LABEL = ["Trop court", "Trop court", "Correct", "Solide", "Très solide"];

export default function AuthScreen({ api, notice, onSession, onChangeInstance }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<"open" | "closed">("open");
  const [editInstance, setEditInstance] = useState(false);
  const [instance, setInstance] = useState(api.baseUrl);

  useEffect(() => {
    api.authConfig().then((c) => setRegistration(c.registration)).catch(() => {});
  }, [api]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(undefined);
    setPassword("");
    setConfirm("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (mode === "register" && password !== confirm) return setError("Les deux mots de passe ne sont pas identiques.");
    if (mode === "register" && password.length < PASSWORD_MIN)
      return setError(`Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
    setBusy(true);
    try {
      const session =
        mode === "login"
          ? await api.login(username.trim(), password, remember)
          : mode === "register"
            ? await api.register(username.trim(), password, remember)
            : await api.joinAsGuest(code.trim(), username.trim());
      onSession(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const score = strength(password);

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="row gap-12">
          <Logo size={40} />
          <Wordmark size={22} />
        </div>

        <div className="col gap-28">
          <h1 className="display">Le vocal pensé pour jouer entre potes.</h1>
          <ul className="feature-list">
            <li>
              <span className="feature-icon teal">
                <Icon name="orbit" />
              </span>
              Audio spatial, activable en un clic
            </li>
            <li>
              <span className="feature-icon amber">
                <Icon name="rewind" />
              </span>
              Garde les 60 dernières secondes en un raccourci
            </li>
            <li>
              <span className="feature-icon">
                <Icon name="lock" />
              </span>
              Auto-hébergé, gratuit, tes données restent chez vous
            </li>
          </ul>
        </div>

        <span className="muted small">Tomo v0.2 · open source</span>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="col gap-6">
            <h2 className="title">
              {mode === "login" ? "Content de te revoir" : mode === "register" ? "Créer un compte" : "Entrer comme invité"}
            </h2>
            <span className="muted">
              {mode === "login"
                ? "Connecte-toi pour retrouver tes serveurs."
                : mode === "register"
                  ? "Ensuite, crée ton serveur ou rejoins celui de tes potes."
                  : "Un ami t'a donné un code invité ? Entre sans compte, le temps d'une soirée."}
            </span>
          </div>

          {notice && <p className="notice">{notice}</p>}

          {mode === "guest" && (
            <label className="field">
              Code invité
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                className="code-input"
                required
                autoFocus
              />
            </label>
          )}

          <label className="field">
            Pseudo
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
              autoFocus={mode !== "guest"}
            />
            {mode !== "login" && <span className="hint">3 à 32 caractères, visible par tes potes</span>}
          </label>

          {mode !== "guest" && (
            <label className="field">
              Mot de passe
              <span className="input-with-action">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  <Icon name={showPw ? "eyeOff" : "eye"} />
                </button>
              </span>
              {mode === "register" && (
                <>
                  <span className="strength" aria-hidden="true">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className={i <= score ? (score >= 2 ? "on" : "weak") : ""} />
                    ))}
                  </span>
                  <span className="hint">
                    <strong className={score >= 2 ? "teal" : "amber"}>{STRENGTH_LABEL[score]}</strong> · {PASSWORD_MIN} caractères
                    minimum, une phrase marche très bien
                  </span>
                </>
              )}
            </label>
          )}

          {mode === "register" && (
            <label className="field">
              Confirmer le mot de passe
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}

          {mode !== "guest" && (
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Rester connecté sur cet appareil
            </label>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn primary lg" disabled={busy}>
            {busy
              ? "Un instant…"
              : mode === "login"
                ? "Se connecter"
                : mode === "register"
                  ? "Créer mon compte"
                  : "Rejoindre la soirée"}
          </button>

          <div className="divider">ou</div>

          {mode === "login" ? (
            <div className="col gap-10">
              {registration === "open" && (
                <button type="button" className="btn outline lg" onClick={() => switchMode("register")}>
                  Créer un compte
                </button>
              )}
              <button type="button" className="btn ghost" onClick={() => switchMode("guest")}>
                J'ai un code invité
              </button>
            </div>
          ) : (
            <button type="button" className="btn outline lg" onClick={() => switchMode("login")}>
              J'ai déjà un compte
            </button>
          )}

          <div className="instance">
            {editInstance ? (
              <span className="row gap-8">
                <input value={instance} onChange={(e) => setInstance(e.target.value)} aria-label="Adresse de l'instance Tomo" />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    onChangeInstance(instance);
                    setEditInstance(false);
                  }}
                >
                  OK
                </button>
              </span>
            ) : (
              <span className="row gap-8 muted small">
                <Icon name="lock" size={14} />
                Instance : {api.baseUrl.replace(/^https?:\/\//, "")}
                <button type="button" className="link" onClick={() => setEditInstance(true)}>
                  modifier
                </button>
              </span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
