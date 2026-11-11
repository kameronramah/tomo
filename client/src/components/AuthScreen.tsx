import { useEffect, useState } from "react";
import type { Api, Session } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Icon, Logo, Wordmark } from "./Brand";
import { t } from "../lib/i18n";
import { APP_VERSION } from "../lib/updater";
import { INSTANCE_EDITABLE } from "../lib/prefs";

/** forgot : demander un code par e-mail · reset : taper le code et le nouveau mot de passe */
type Mode = "login" | "register" | "guest" | "forgot" | "reset";

type Props = {
  api: Api;
  notice?: string;
  onSession: (s: Session) => void;
  onChangeInstance: (url: string) => void;
};

const PASSWORD_MIN = 12;
const RESEND_SECONDS = 60;

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<"open" | "closed">("open");
  const [mailOn, setMailOn] = useState(true);
  const [editInstance, setEditInstance] = useState(false);
  const [instance, setInstance] = useState(api.baseUrl);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    api
      .authConfig()
      .then((c) => {
        setRegistration(c.registration);
        setMailOn(c.mail !== false);
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(undefined);
    setInfo(undefined);
    setPassword("");
    setConfirm("");
    setResetCode("");
  }

  async function askCode() {
    setBusy(true);
    setError(undefined);
    try {
      await api.forgotPassword(username.trim());
      setResendIn(RESEND_SECONDS);
      switchMode("reset");
      setInfo(t("Si un compte correspond et que son adresse est vérifiée, un code vient d'y être envoyé (regarde aussi les indésirables). Il marche 30 minutes."));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (mode === "forgot") return askCode();
    const choosing = mode === "register" || mode === "reset";
    if (choosing && password !== confirm) return setError(t("Les deux mots de passe ne sont pas identiques."));
    if (choosing && password.length < PASSWORD_MIN) return setError(t("Le mot de passe doit faire au moins {0} caractères.", { 0: PASSWORD_MIN }));
    setBusy(true);
    try {
      const session =
        mode === "login"
          ? await api.login(username.trim(), password, remember)
          : mode === "register"
            ? await api.register(username.trim(), password, email.trim(), remember)
            : mode === "reset"
              ? await api.resetPassword(username.trim(), resetCode, password, remember)
              : await api.joinAsGuest(code.trim(), username.trim());
      onSession(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const score = strength(password);
  const recovering = mode === "forgot" || mode === "reset";

  const title =
    mode === "login"
      ? t("Content de te revoir")
      : mode === "register"
        ? t("Créer un compte")
        : recovering
          ? t("Mot de passe oublié")
          : t("Entrer comme invité");
  const subtitle =
    mode === "login"
      ? t("Connecte-toi pour retrouver tes serveurs.")
      : mode === "register"
        ? t("Ensuite, crée ton serveur ou rejoins celui de tes potes.")
        : mode === "forgot"
          ? mailOn
            ? t("Tape ton pseudo ou ton adresse e-mail. Si ton compte a une adresse vérifiée, on t'envoie un code à 6 chiffres.")
            : t("L'envoi de mails n'est pas encore configuré sur ce serveur : demande un code de secours à l'admin de ton serveur tomo.")
          : mode === "reset"
            ? t("Tape le code reçu et choisis un nouveau mot de passe. Tous tes appareils seront déconnectés.")
            : t("Un ami t'a donné un code invité ? Entre sans compte, le temps d'une soirée.");

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="row gap-16">
          <Logo size={72} />
          <Wordmark size={44} />
        </div>

        <div className="col gap-28">
          <h1 className="display">{t("Le vocal pensé pour jouer entre potes.")}</h1>
          <ul className="feature-list">
            <li>
              <span className="feature-icon teal">
                <Icon name="orbit" />
              </span>
              {t("Audio spatial, activable en un clic")}
            </li>
            <li>
              <span className="feature-icon amber">
                <Icon name="rewind" />
              </span>
              {t("Garde les dernières secondes du salon en un raccourci")}
            </li>
            <li>
              <span className="feature-icon">
                <Icon name="lock" />
              </span>
              {t("Auto-hébergé, gratuit, tes données restent chez vous")}
            </li>
          </ul>
        </div>

        <span className="muted small">tomo {APP_VERSION} · open source</span>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-compact-brand row gap-10">
            <Logo size={52} cut="var(--bg)" />
            <Wordmark size={32} />
          </div>

          {recovering && (
            <div className="auth-steps" aria-hidden="true">
              <span className={mode === "forgot" ? "on" : "done"}>
                <span className="auth-step-dot">{mode === "forgot" ? "1" : <Icon name="check" size={12} />}</span>
                {t("Ton compte")}
              </span>
              <span className={mode === "reset" ? "on" : ""}>
                <span className="auth-step-dot">2</span>
                {t("Nouveau mot de passe")}
              </span>
            </div>
          )}

          <div className="col gap-6">
            <h2 className="title">{title}</h2>
            <span className="muted">{subtitle}</span>
          </div>

          {notice && !recovering && <p className="notice">{notice}</p>}
          {info && <p className="notice">{info}</p>}

          {mode === "guest" && (
            <label className="field">
              {t("Code invité")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t("ABCD-EFGH")}
                className="code-input"
                required
                autoFocus
              />
            </label>
          )}

          <label className="field">
            {recovering ? t("Pseudo ou e-mail") : t("Pseudo")}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete={recovering ? "username email" : "username"}
              minLength={3}
              maxLength={recovering ? 254 : 32}
              required
              autoFocus={mode !== "guest" && mode !== "reset"}
            />
            {(mode === "register" || mode === "guest") && <span className="hint">{t("3 à 32 caractères, visible par tes potes")}</span>}
          </label>

          {mode === "register" && (
            <label className="field">
              {t("Adresse e-mail")}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
              <span className="hint">{t("Sert seulement à récupérer ton compte si tu oublies ton mot de passe. Personne d'autre ne la voit.")}</span>
            </label>
          )}

          {mode === "reset" && (
            <label className="field">
              {t("Code à 6 chiffres")}
              <input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="code-input digits"
                placeholder="000000"
                required
                autoFocus
              />
            </label>
          )}

          {mode !== "guest" && mode !== "forgot" && (
            <label className="field">
              <span className="row space-between">
                {mode === "reset" ? t("Nouveau mot de passe") : t("Mot de passe")}
                {mode === "login" && (
                  <button type="button" className="link small" onClick={() => switchMode("forgot")}>
                    {t("Mot de passe oublié ?")}
                  </button>
                )}
              </span>
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
                  aria-label={showPw ? t("Masquer le mot de passe") : t("Afficher le mot de passe")}
                >
                  <Icon name={showPw ? "eyeOff" : "eye"} />
                </button>
              </span>
              {(mode === "register" || mode === "reset") && (
                <>
                  <span className="strength" aria-hidden="true">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className={i <= score ? (score >= 2 ? "on" : "weak") : ""} />
                    ))}
                  </span>
                  <span className="hint">
                    <strong className={score >= 2 ? "teal" : "amber"}>{t(STRENGTH_LABEL[score])}</strong> · {PASSWORD_MIN} {t("caractères minimum, une phrase marche très bien")}
                  </span>
                </>
              )}
            </label>
          )}

          {(mode === "register" || mode === "reset") && (
            <label className="field">
              {t("Confirmer le mot de passe")}
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}

          {mode !== "guest" && mode !== "forgot" && (
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t("Rester connecté sur cet appareil")}
            </label>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn primary lg" disabled={busy || (mode === "forgot" && !mailOn)}>
            {busy
              ? t("Un instant…")
              : mode === "login"
                ? t("Se connecter")
                : mode === "register"
                  ? t("Créer mon compte")
                  : mode === "forgot"
                    ? t("Envoyer le code")
                    : mode === "reset"
                      ? t("Changer et me connecter")
                      : t("Rejoindre la soirée")}
          </button>

          {mode === "forgot" && (
            <button type="button" className="btn ghost" onClick={() => switchMode("reset")}>
              {t("J'ai déjà un code")}
            </button>
          )}
          {mode === "reset" && mailOn && (
            <button type="button" className="btn ghost" disabled={busy || resendIn > 0 || !username.trim()} onClick={askCode}>
              {resendIn > 0 ? t("Renvoyer le code (dans {0} s)", { 0: resendIn }) : t("Renvoyer le code")}
            </button>
          )}

          <div className="divider">{t("ou")}</div>

          {mode === "login" ? (
            <div className="col gap-10">
              {registration === "open" && (
                <button type="button" className="btn outline lg" onClick={() => switchMode("register")}>
                  {t("Créer un compte")}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={() => switchMode("guest")}>
                {t("J'ai un code invité")}
              </button>
            </div>
          ) : (
            <button type="button" className="btn outline lg" onClick={() => switchMode("login")}>
              {recovering ? t("Retour à la connexion") : t("J'ai déjà un compte")}
            </button>
          )}

          {recovering && (
            <p className="hint center">{t("Pas d'adresse e-mail, ou plus accès à ta boîte ? Demande à l'admin de ton serveur tomo : il peut te donner un code de secours.")}</p>
          )}

          {INSTANCE_EDITABLE && (
          <div className="instance">
            {editInstance ? (
              <span className="row gap-8">
                <input value={instance} onChange={(e) => setInstance(e.target.value)} aria-label={t("Adresse de l'instance tomo")} />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    onChangeInstance(instance);
                    setEditInstance(false);
                  }}
                >
                  {t("OK")}
                </button>
              </span>
            ) : (
              <span className="row gap-8 muted small">
                <Icon name="lock" size={14} />
                {t("Instance :")} {api.baseUrl.replace(/^https?:\/\//, "")}
                <button type="button" className="link" onClick={() => setEditInstance(true)}>
                  {t("modifier")}
                </button>
              </span>
            )}
          </div>
          )}
        </form>
      </section>
    </div>
  );
}
