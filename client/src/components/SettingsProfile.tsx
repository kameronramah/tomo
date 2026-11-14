import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Api, Blocked, FullProfile, MyProfile, Privacy } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Avatar, Icon } from "./Brand";
import { ProfileView } from "./ProfileCard";
import { t } from "../lib/i18n";

const ACCENTS = ["#2DD4BF", "#FFB020", "#5B8DEF", "#A78BFA", "#F472B6", "#34323A"];
const BIO_MAX = 190;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-card">
      <h3 className="dev-title">{title}</h3>
      {children}
    </div>
  );
}

/** Dimensions d'une image locale (pour l'envoi). */
export function imageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => (resolve({ width: img.naturalWidth, height: img.naturalHeight }), URL.revokeObjectURL(url));
    img.onerror = () => (resolve(undefined), URL.revokeObjectURL(url));
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Paramètres > Mon profil
// ---------------------------------------------------------------------------
export function MyProfileSection({ api, onChanged }: { api: Api; onChanged: () => void }) {
  const [me, setMe] = useState<MyProfile | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [accent, setAccent] = useState<string | null>(null);
  const [busy, setBusy] = useState<"avatar" | "banner" | "save" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    const p = await api.myProfile();
    setMe(p);
    setName(p.displayName === p.username ? "" : p.displayName);
    setBio(p.bio ?? "");
    setAccent(p.accent);
  };
  useEffect(() => void load().catch((e) => setMsg({ ok: false, text: errorMessage(e) })), []);

  async function uploadImage(kind: "avatar" | "banner", file: File) {
    setMsg(undefined);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return setMsg({ ok: false, text: t("Choisis une image PNG, JPG, GIF ou WebP.") });
    if (file.size > 8 * 1024 * 1024) return setMsg({ ok: false, text: t("Image trop lourde (8 Mo maximum).") });
    setBusy(kind);
    try {
      const att = await api.uploadAttachment(file, { name: file.name, ...(await imageSize(file)) });
      await api.updateProfile(kind === "avatar" ? { avatarId: att.id } : { bannerId: att.id });
      await load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function removeImage(kind: "avatar" | "banner") {
    setBusy(kind);
    try {
      await api.updateProfile(kind === "avatar" ? { avatarId: null } : { bannerId: null });
      await load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setMsg(undefined);
    try {
      await api.updateProfile({ displayName: name.trim() || null, bio: bio.trim() || null, accent });
      await load();
      onChanged();
      setMsg({ ok: true, text: t("Profil enregistré.") });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!me) return <p className="muted">{msg?.text ?? t("Chargement…")}</p>;

  const dirty = (name.trim() || null) !== (me.displayName === me.username ? null : me.displayName) || (bio.trim() || null) !== me.bio || accent !== me.accent;
  // Aperçu en direct (avec ce qui est en cours de saisie)
  const preview: FullProfile = { ...me, displayName: name.trim() || me.username, bio: bio.trim() || null, accent, self: true };

  return (
    <>
      <h1 className="title">{t("Mon profil")}</h1>
      <div className="profile-editor">
        <div className="col gap-16">
          <Card title={t("Images")}>
            <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadImage("banner", e.target.files[0])} />
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadImage("avatar", e.target.files[0])} />
            <button
              type="button"
              className={`banner-drop${me.bannerUrl ? " has-image" : ""}`}
              style={me.bannerUrl ? { backgroundImage: `url("${me.bannerUrl}")` } : undefined}
              onClick={() => bannerInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) uploadImage("banner", f);
              }}
              disabled={busy === "banner"}
            >
              <Icon name="image" size={20} />
              {busy === "banner" ? t("Envoi…") : me.bannerUrl ? t("Changer la bannière") : t("Clique ou glisse une image pour ta bannière (1500×500 conseillé, GIF accepté)")}
            </button>
            {me.bannerUrl && (
              <div>
                <button className="btn ghost small" onClick={() => removeImage("banner")}>
                  {t("Retirer la bannière")}
                </button>
              </div>
            )}
            <div className="row gap-16">
              <Avatar name={me.displayName} src={me.avatarUrl} size={76} />
              <div className="col gap-6">
                <div className="row gap-8 wrap">
                  <button className="btn small" onClick={() => avatarInput.current?.click()} disabled={busy === "avatar"}>
                    {busy === "avatar" ? t("Envoi…") : me.avatarUrl ? t("Changer la photo") : t("Ajouter une photo")}
                  </button>
                  {me.avatarUrl && (
                    <button className="btn ghost small" onClick={() => removeImage("avatar")}>
                      {t("Retirer")}
                    </button>
                  )}
                </div>
                <span className="hint">{t("Image carrée de préférence (affichée en rond). GIF accepté. 8 Mo maximum.")}</span>
              </div>
            </div>
          </Card>

          <Card title={t("À propos de moi")}>
            <label className="field">
              {t("Nom affiché")}
              <input value={name} maxLength={32} placeholder={me.username} onChange={(e) => setName(e.target.value)} />
              <span className="hint">{t("Ton pseudo de connexion reste «")} {me.username} {t("». Le nom affiché se change quand tu veux.")}</span>
            </label>
            <label className="field">
              {t("Petite phrase de profil")}
              <textarea value={bio} maxLength={BIO_MAX} rows={3} placeholder={t("Ex. : toujours partant pour un ranked.")} onChange={(e) => setBio(e.target.value)} />
              <span className="counter">
                {bio.length} / {BIO_MAX}
              </span>
            </label>
            <div className="field">
              {t("Couleur de mon profil")}
              <div className="swatches" role="radiogroup" aria-label={t("Couleur de mon profil")}>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={accent?.toLowerCase() === c.toLowerCase()}
                    aria-label={c}
                    className={`swatch${accent?.toLowerCase() === c.toLowerCase() ? " on" : ""}`}
                    style={{ background: c }}
                    onClick={() => setAccent(c)}
                  />
                ))}
                <span className="hint">{t("Sert de fond de bannière si tu n'as pas d'image.")}</span>
              </div>
            </div>
          </Card>

          {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" disabled={!dirty || busy === "save"} onClick={() => load()}>
              {t("Annuler")}
            </button>
            <button className="btn primary" disabled={!dirty || busy === "save"} onClick={save}>
              {busy === "save" ? t("Enregistrement…") : t("Enregistrer")}
            </button>
          </div>
        </div>

        <aside className="profile-preview" aria-label={t("Aperçu de mon profil")}>
          <span className="section-title">{t("Aperçu — ce que les autres voient")}</span>
          <div className="pcard">
            <ProfileView p={preview} />
          </div>
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paramètres > Confidentialité
// ---------------------------------------------------------------------------
const DM_OPTIONS: { id: Privacy["dm"]; label: string; hint: string }[] = [
  { id: "friends", label: t("Mes amis seulement"), hint: t("Personne d'autre ne peut t'écrire.") },
  { id: "servers", label: t("Mes amis + les membres de mes serveurs"), hint: t("Un non-ami arrive dans « Demandes de message » : rien ne s'affiche tant que tu n'acceptes pas.") },
  { id: "everyone", label: t("Tout le monde sur ce serveur Tomo"), hint: t("Passe aussi par « Demandes de message » la première fois.") },
];

export function PrivacySection({ api }: { api: Api }) {
  const [p, setP] = useState<Privacy | null>(null);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.myProfile().then((x) => setP(x.privacy)).catch((e) => setError(errorMessage(e)));
    api.blocks().then(setBlocked).catch(() => {});
  }, []);

  async function change(patch: Partial<Privacy>) {
    if (!p) return;
    const prev = p;
    setP({ ...p, ...patch });
    try {
      await api.setPrivacy(patch);
    } catch (e) {
      setP(prev);
      setError(errorMessage(e));
    }
  }

  if (!p) return <p className="muted">{error ?? t("Chargement…")}</p>;
  return (
    <>
      <h1 className="title">{t("Confidentialité")}</h1>
      <Card title={t("Qui peut m'envoyer un message privé ?")}>
        <div className="col gap-8" role="radiogroup">
          {DM_OPTIONS.map((o) => (
            <label key={o.id} className={`radio-card${p.dm === o.id ? " on" : ""}`}>
              <input type="radio" name="dm" checked={p.dm === o.id} onChange={() => change({ dm: o.id })} />
              <span className="col gap-2">
                <strong>
                  {o.label} {o.id === "servers" && <span className="small teal-soft">{t("· conseillé")}</span>}
                </strong>
                <span className="hint">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card title={t("Appels, amis et visibilité")}>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Qui peut m'appeler")}</span>
            <span className="hint">{t("Un appel fait sonner ton PC.")}</span>
          </span>
          <select value={p.call} onChange={(e) => change({ call: e.target.value as Privacy["call"] })}>
            <option value="friends">{t("Mes amis seulement")}</option>
            <option value="servers">{t("Amis + membres de mes serveurs")}</option>
          </select>
        </label>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Qui peut m'ajouter en ami")}</span>
            <span className="hint">{t("« Personne » : toi seul peux envoyer des demandes.")}</span>
          </span>
          <select value={p.friend} onChange={(e) => change({ friend: e.target.value as Privacy["friend"] })}>
            <option value="everyone">{t("Tout le monde")}</option>
            <option value="servers">{t("Membres de mes serveurs")}</option>
            <option value="nobody">{t("Personne")}</option>
          </select>
        </label>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Montrer « vu il y a… »")}</span>
            <span className="hint">{t("Ta dernière connexion dans la liste des membres et sur ta fiche.")}</span>
          </span>
          <input type="checkbox" className="toggle" checked={p.showLastSeen} onChange={(e) => change({ showLastSeen: e.target.checked })} />
        </label>
      </Card>

      <Card title={t("Personnes bloquées · {0}", { 0: blocked.length })}>
        {blocked.length === 0 ? (
          <span className="hint">{t("Personne. Pour bloquer quelqu'un : ouvre sa fiche profil, menu « ⋯ ».")}</span>
        ) : (
          <ul className="list">
            {blocked.map((b) => (
              <li key={b.id}>
                <Avatar name={b.displayName} src={b.avatarUrl} size={32} />
                <span className="grow">{b.displayName}</span>
                <button
                  className="btn small"
                  onClick={() =>
                    api
                      .unblock(b.id)
                      .then(() => setBlocked((l) => l.filter((x) => x.id !== b.id)))
                      .catch((e) => setError(errorMessage(e)))
                  }
                >
                  {t("Débloquer")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <p className="error">{error}</p>}
    </>
  );
}
