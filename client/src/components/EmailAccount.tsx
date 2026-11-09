/**
 * Adresse e-mail du compte : obligatoire (pour récupérer son compte), vérifiée par un code.
 * - EmailGate : fenêtre au démarrage tant que l'adresse manque (ou n'est pas vérifiée).
 * - EmailSettings : Paramètres › Compte et sécurité.
 */
import { useEffect, useState } from "react";
import type { Api, User } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";

const RESEND_SECONDS = 60;

/** Ajouter ou changer l'adresse (avec le mot de passe actuel). */
function AddressForm({ api, initial, onSaved, onCancel }: { api: Api; initial?: string; onSaved: (email: string, verified: boolean) => void; onCancel?: () => void }) {
  const [email, setEmail] = useState(initial ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.setEmail(email.trim(), password);
      onSaved(r.email, r.emailVerified);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="col gap-12" onSubmit={save}>
      <label className="field">
        {t("Adresse e-mail")}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required autoFocus />
      </label>
      <label className="field">
        {t("Ton mot de passe actuel")}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="row gap-8">
        <button type="submit" className="btn primary grow" disabled={busy}>
          {busy ? t("Un instant…") : t("Enregistrer")}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t("Annuler")}
          </button>
        )}
      </div>
    </form>
  );
}

/** Taper le code reçu par mail. */
function VerifyForm({ api, email, onVerified, onChange, initialWait = RESEND_SECONDS }: { api: Api; email: string; onVerified: () => void; onChange: () => void; initialWait?: number }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(initialWait);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.verifyEmail(code);
      onVerified();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(undefined);
    try {
      await api.resendEmailCode();
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="col gap-12" onSubmit={verify}>
      <p className="muted small">{t("Un code à 6 chiffres a été envoyé à {0} (regarde aussi les indésirables).", { 0: email })}</p>
      <label className="field">
        {t("Code à 6 chiffres")}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="code-input digits"
          placeholder="000000"
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>
        {busy ? t("Un instant…") : t("Vérifier")}
      </button>
      <div className="row gap-8 wrap">
        <button type="button" className="btn ghost small" disabled={wait > 0} onClick={resend}>
          {wait > 0 ? t("Renvoyer le code (dans {0} s)", { 0: wait }) : t("Renvoyer le code")}
        </button>
        <button type="button" className="btn ghost small" onClick={onChange}>
          {t("Changer d'adresse")}
        </button>
      </div>
    </form>
  );
}

/**
 * Fenêtre au démarrage : l'adresse est obligatoire.
 * Sans adresse : impossible de continuer (sauf se déconnecter). Adresse non vérifiée : « Plus tard » possible.
 */
export function EmailGate({ api, user, mailOn, onUser, onLogout }: { api: Api; user: User; mailOn: boolean; onUser: (u: User) => void; onLogout: () => void }) {
  const [step, setStep] = useState<"add" | "verify">(user.email ? "verify" : "add");
  const [later, setLater] = useState(false);
  const missing = !user.email;
  const unverified = !!user.email && !user.emailVerified && mailOn;
  if ((!missing && !unverified) || later) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal email-gate" role="dialog" aria-modal="true" aria-label={t("Ton adresse e-mail")}>
        <header className="modal-header">
          <div className="row gap-12">
            <span className="feature-icon teal">
              <Icon name="mail" />
            </span>
            <div className="col gap-4">
              <h2 className="title-sm">{step === "add" ? t("Ajoute ton adresse e-mail") : t("Vérifie ton adresse e-mail")}</h2>
              <span className="muted small">
                {t("Elle sert seulement à récupérer ton compte si tu oublies ton mot de passe. Personne d'autre ne la voit.")}
              </span>
            </div>
          </div>
        </header>
        {step === "add" ? (
          <AddressForm
            api={api}
            initial={user.email ?? ""}
            onSaved={(email, verified) => {
              onUser({ ...user, email, emailVerified: verified });
              if (!verified && mailOn) setStep("verify");
            }}
          />
        ) : (
          <VerifyForm
            api={api}
            email={user.email ?? ""}
            initialWait={0}
            onVerified={() => onUser({ ...user, emailVerified: true })}
            onChange={() => setStep("add")}
          />
        )}
        <div className="row gap-8 email-gate-foot">
          {!missing && (
            <button type="button" className="btn ghost small" onClick={() => setLater(true)}>
              {t("Plus tard")}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost small" onClick={onLogout}>
            {t("Se déconnecter")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Paramètres › Compte et sécurité : l'adresse, son état, la changer. */
export function EmailSettings({ api, mailOn }: { api: Api; mailOn: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState<"view" | "edit" | "verify">("view");
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    api.me().then(setUser).catch(() => {});
  }, [api]);

  if (!user) return null;
  return (
    <div className="col gap-12">
      <span className="hint">{t("Sert seulement à récupérer ton compte si tu oublies ton mot de passe. Personne d'autre ne la voit.")}</span>
      {step === "edit" ? (
        <AddressForm
          api={api}
          initial={user.email ?? ""}
          onCancel={() => setStep("view")}
          onSaved={(email, verified) => {
            setUser({ ...user, email, emailVerified: verified });
            setJustSent(!verified);
            setStep(!verified && mailOn ? "verify" : "view");
          }}
        />
      ) : step === "verify" ? (
        <VerifyForm
          api={api}
          email={user.email ?? ""}
          initialWait={justSent ? 60 : 0}
          onVerified={() => {
            setUser({ ...user, emailVerified: true });
            setStep("view");
          }}
          onChange={() => setStep("edit")}
        />
      ) : (
        <div className="setting-row">
          <span className="grow col gap-2" style={{ minWidth: 0 }}>
            <span className="ellipsis">{user.email ?? t("Aucune adresse")}</span>
            {user.email && (
              <span className={`small ${user.emailVerified ? "teal-soft" : "amber"}`}>
                {user.emailVerified ? t("Vérifiée") : mailOn ? t("À vérifier") : t("Non vérifiée (envoi de mails pas configuré sur ce serveur)")}
              </span>
            )}
          </span>
          {user.email && !user.emailVerified && mailOn && (
            <button className="btn small primary" onClick={() => (setJustSent(false), setStep("verify"))}>
              {t("Vérifier")}
            </button>
          )}
          <button className="btn small" onClick={() => setStep("edit")}>
            {user.email ? t("Changer") : t("Ajouter")}
          </button>
        </div>
      )}
    </div>
  );
}
