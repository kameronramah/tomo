import { useEffect, useState, type ReactNode } from "react";
import type { Api, Invite, Member, Role, ServerSummary } from "../lib/api";
import { errorMessage, formatExpiry, ROLE_LABEL } from "../lib/ui";
import { Avatar, Icon } from "./Brand";
import { t } from "../lib/i18n";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div className="col gap-4">
            <h2 className="title-sm">{title}</h2>
            {subtitle && <span className="muted">{subtitle}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("Fermer")}>
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Une seule question texte (créer un serveur, nommer un salon, rejoindre avec un code…). */
export function PromptDialog({
  title,
  subtitle,
  label,
  initial = "",
  placeholder,
  confirmLabel,
  maxLength = 40,
  transform,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  maxLength?: number;
  transform?: (v: string) => string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(value.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form className="col gap-16" onSubmit={submit}>
        <label className="field">
          {label}
          <input
            value={value}
            onChange={(e) => setValue(transform ? transform(e.target.value) : e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            required
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annuler")}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !value.trim()}>
            {busy ? t("Un instant…") : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text">{message}</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          {t("Annuler")}
        </button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inviter
// ---------------------------------------------------------------------------
const MEMBER_DURATIONS = [
  { hours: 24, label: t("1 jour") },
  { hours: 168, label: t("7 jours") },
  { hours: 720, label: t("30 jours") },
];
const GUEST_DURATIONS = [
  { hours: 3, label: t("3 h") },
  { hours: 6, label: t("6 h") },
  { hours: 12, label: t("12 h") },
  { hours: 24, label: t("24 h") },
];

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-box">
      <span className="code">{code}</span>
      <button
        className="btn small"
        onClick={async () => {
          await navigator.clipboard?.writeText(code).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={16} />
        {copied ? t("Copié") : t("Copier")}
      </button>
    </div>
  );
}

export function InviteDialog({
  api,
  server,
  canInviteGuests,
  onClose,
}: {
  api: Api;
  server: { id: string; name: string };
  canInviteGuests: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"member" | "guest">("member");
  const [hours, setHours] = useState(168);
  const [invite, setInvite] = useState<Invite>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function pick(k: "member" | "guest") {
    setKind(k);
    setHours(k === "member" ? 168 : 6);
    setInvite(undefined);
  }

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      setInvite(await api.createInvite(server.id, kind, hours, kind === "guest" ? 10 : null));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const durations = kind === "member" ? MEMBER_DURATIONS : GUEST_DURATIONS;

  return (
    <Modal title={t("Inviter sur {0}", { 0: server.name })} onClose={onClose}>
      {canInviteGuests && (
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={kind === "member"} className={kind === "member" ? "on" : ""} onClick={() => pick("member")}>
            <Icon name="users" size={16} /> {t("Un ami avec un compte")}
          </button>
          <button role="tab" aria-selected={kind === "guest"} className={kind === "guest" ? "on" : ""} onClick={() => pick("guest")}>
            <Icon name="key" size={16} /> {t("Un invité d'un soir")}
          </button>
        </div>
      )}

      <p className="text muted">
        {kind === "member"
          ? t("Ton ami crée son compte, puis « Rejoindre un serveur » et colle ce code. Il devient membre du serveur.")
          : t("Pas besoin de compte : sur l'écran de connexion, « J'ai un code invité », puis un pseudo. Son accès s'arrête tout seul.")}
      </p>

      <div className="col gap-8">
        <span className="label">{t("Valable")}</span>
        <div className="chips">
          {durations.map((d) => (
            <button
              key={d.hours}
              className={`chip${hours === d.hours ? " on" : ""}`}
              onClick={() => {
                setHours(d.hours);
                setInvite(undefined);
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
        {kind === "guest" && <span className="hint">{t("10 personnes maximum par code.")}</span>}
      </div>

      {invite ? (
        <div className="col gap-8">
          <CopyCode code={invite.code} />
          <span className="hint">{t("Expire")} {formatExpiry(invite.expiresAt)}.</span>
        </div>
      ) : (
        <button className="btn primary" onClick={create} disabled={busy}>
          {busy ? t("Création…") : t("Créer le code")}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Gérer un serveur
// ---------------------------------------------------------------------------
type Tab = "general" | "members" | "invites";

export function ManageServerDialog({
  api,
  server,
  myId,
  onChanged,
  onGone,
  onClose,
}: {
  api: Api;
  server: ServerSummary;
  myId: string;
  onChanged: () => void;
  onGone: () => void;
  onClose: () => void;
}) {
  const isOwner = server.role === "owner";
  const isManager = isOwner || server.role === "admin";
  const [tab, setTab] = useState<Tab>("general");
  const [name, setName] = useState(server.name);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; run: () => Promise<void> }>(null);

  const loadMembers = () => api.members(server.id).then(setMembers).catch((e) => setError(errorMessage(e)));
  const loadInvites = () => api.invites(server.id).then(setInvites).catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    setError(undefined);
    if (tab === "members") loadMembers();
    if (tab === "invites" && isManager) loadInvites();
  }, [tab]);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setError(undefined);
    setInfo(undefined);
    try {
      await fn();
      after?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const canKick = (target: Role) => target !== "owner" && (isOwner || (server.role === "admin" && target === "member"));

  return (
    <Modal title={server.name} subtitle={t("Tu es {0} de ce serveur", { 0: ROLE_LABEL[server.role].toLowerCase() })} onClose={onClose} wide>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === "general"} className={tab === "general" ? "on" : ""} onClick={() => setTab("general")}>
          {t("Général")}
        </button>
        <button role="tab" aria-selected={tab === "members"} className={tab === "members" ? "on" : ""} onClick={() => setTab("members")}>
          {t("Membres")}
        </button>
        {isManager && (
          <button role="tab" aria-selected={tab === "invites"} className={tab === "invites" ? "on" : ""} onClick={() => setTab("invites")}>
            {t("Invitations")}
          </button>
        )}
      </div>

      {tab === "general" && (
        <div className="col gap-20">
          {isManager && (
            <form
              className="row gap-8 align-end"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => api.renameServer(server.id, name.trim()), () => {
                  setInfo("Nom enregistré.");
                  onChanged();
                });
              }}
            >
              <label className="field grow">
                {t("Nom du serveur")}
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
              </label>
              <button className="btn" type="submit" disabled={!name.trim() || name.trim() === server.name}>
                {t("Enregistrer")}
              </button>
            </form>
          )}
          <div className="danger-zone">
            {isOwner ? (
              <>
                <div className="col gap-4">
                  <strong>{t("Supprimer le serveur")}</strong>
                  <span className="muted small">{t("Tous les salons et invitations disparaissent. Irréversible.")}</span>
                </div>
                <button
                  className="btn danger"
                  onClick={() =>
                    setConfirm({
                      title: t("Supprimer le serveur ?"),
                      message: t("« {0} » sera supprimé pour tout le monde. Cette action est irréversible.", { 0: server.name }),
                      label: t("Supprimer définitivement"),
                      run: async () => {
                        await api.deleteServer(server.id);
                        onGone();
                      },
                    })
                  }
                >
                  {t("Supprimer")}
                </button>
              </>
            ) : (
              <>
                <div className="col gap-4">
                  <strong>{t("Quitter le serveur")}</strong>
                  <span className="muted small">{t("Tu pourras revenir avec un nouveau code d'invitation.")}</span>
                </div>
                <button
                  className="btn danger"
                  onClick={() =>
                    setConfirm({
                      title: t("Quitter le serveur ?"),
                      message: t("Tu ne verras plus « {0} » dans ta liste.", { 0: server.name }),
                      label: t("Quitter"),
                      run: async () => {
                        await api.leaveServer(server.id);
                        onGone();
                      },
                    })
                  }
                >
                  {t("Quitter")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "members" && (
        <ul className="list">
          {members.map((m) => (
            <li key={m.id}>
              <Avatar name={m.username} size={32} />
              <span className="grow">
                {m.username}
                {m.id === myId && <span className="muted"> {t("(toi)")}</span>}
              </span>
              <span className={`role-tag ${m.role}`}>{ROLE_LABEL[m.role]}</span>
              {isOwner && m.role !== "owner" && (
                <button
                  className="btn small"
                  onClick={() => act(() => api.setRole(server.id, m.id, m.role === "admin" ? "member" : "admin"), loadMembers)}
                >
                  {m.role === "admin" ? t("Retirer admin") : t("Nommer admin")}
                </button>
              )}
              {canKick(m.role) && m.id !== myId && (
                <button
                  className="icon-btn danger"
                  aria-label={t("Exclure {0}", { 0: m.username })}
                  title={t("Exclure")}
                  onClick={() =>
                    setConfirm({
                      title: t("Exclure {0} ?", { 0: m.username }),
                      message: t("Il sera retiré du serveur et des salons vocaux. Il pourra revenir avec un nouveau code."),
                      label: t("Exclure"),
                      run: async () => {
                        await api.kick(server.id, m.id);
                        setConfirm(null);
                        loadMembers();
                      },
                    })
                  }
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "invites" && (
        <>
          {invites.length === 0 ? (
            <p className="muted">{t("Aucune invitation active.")}</p>
          ) : (
            <ul className="list">
              {invites.map((i) => (
                <li key={i.code}>
                  <span className="code small-code">{i.code}</span>
                  <span className="grow col gap-2">
                    <span>{i.kind === "guest" ? t("Invité d'un soir") : t("Membre")}</span>
                    <span className="muted small">
                      {i.uses}
                      {i.maxUses ? ` / ${i.maxUses}` : ""} {t("utilisation")}{i.uses > 1 ? "s" : ""} {t("· expire")} {formatExpiry(i.expiresAt)}
                      {i.createdBy ? t(" · par {0}", { 0: i.createdBy }) : ""}
                    </span>
                  </span>
                  <button className="btn small" onClick={() => act(() => api.revokeInvite(i.code), loadInvites)}>
                    {t("Révoquer")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {info && <p className="ok">{info}</p>}
      {error && <p className="error">{error}</p>}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
