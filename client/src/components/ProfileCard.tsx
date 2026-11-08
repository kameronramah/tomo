import { useEffect, useState } from "react";
import type { RemoteParticipant, Room } from "livekit-client";
import type { Api, FullProfile } from "../lib/api";
import { STATUS_LABEL, putPeople } from "../lib/people";
import { setParticipantVolume, volumeMemory } from "../lib/voice";
import { errorMessage, initials } from "../lib/ui";
import { sinceLabel } from "../lib/games";
import { Avatar, Icon } from "./Brand";
import { locale, t } from "../lib/i18n";

const monthYear = (ts: number) => new Date(ts).toLocaleDateString(locale(), { month: "long", year: "numeric" });

function lastSeenLabel(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 2) return t("à l'instant");
  if (min < 60) return t("il y a {0} min", { 0: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("il y a {0} h", { 0: h });
  return t("le {0}", { 0: new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "long" }) });
}

/** Contenu d'une fiche profil (aussi utilisé comme aperçu dans Paramètres > Mon profil). */
export function ProfileView({ p, children }: { p: FullProfile; children?: React.ReactNode }) {
  const banner = p.bannerUrl ? { backgroundImage: `url("${p.bannerUrl}")` } : { background: p.accent ?? "var(--teal-bg)" };
  return (
    <>
      <div className="profile-banner" style={banner} role="img" aria-label={t("Bannière de {0}", { 0: p.displayName })} />
      <div className="profile-body">
        <div className="profile-top">
          <Avatar name={p.displayName} src={p.avatarUrl} size={88} status={p.status} />
        </div>
        <div className="col gap-4">
          <span className="profile-name">{p.displayName}</span>
          <span className="muted small">
            {p.username !== p.displayName && <>{p.username} · </>}
            {STATUS_LABEL[p.status]}
            {p.customStatus && <> · « {p.customStatus} »</>}
            {p.status === "offline" && p.lastSeen ? <> {t("· vu")} {lastSeenLabel(p.lastSeen)}</> : null}
          </span>
        </div>
        {p.game && (
          <div className="profile-game">
            <span className="game-badge sm">{initials(p.game.name)}</span>
            <span className="col gap-2">
              <strong>{t("Joue à {0}", { 0: p.game.name })}</strong>
              <span className="muted small">{t("depuis {0}", { 0: sinceLabel(p.game.since) })}</span>
            </span>
          </div>
        )}
        {p.bio && <p className="profile-bio">{p.bio}</p>}
        <div className="profile-meta">
          <span>
            <strong>{t("Sur tomo")}</strong> {t("depuis")} {monthYear(p.createdAt)}
          </span>
          {!p.self && p.commonServers > 0 && (
            <span>
              <strong>{p.commonServers}</strong> {t("serveur")}{p.commonServers > 1 ? "s" : ""} {t("en commun")}
            </span>
          )}
        </div>
        {children}
      </div>
    </>
  );
}

type Props = {
  api: Api;
  userId: string;
  /** Salon vocal en cours (pour régler le volume de la personne si elle y est) */
  room?: Room | null;
  onClose: () => void;
  onMessage: (userId: string) => void;
  onCall: (userId: string, name: string) => void;
  onEditMine: () => void;
  onChanged: () => void;
};

/** Fiche profil d'une personne (clic sur un avatar, un membre, un nom…). */
export default function ProfileCard(props: Props) {
  const { api, userId } = props;
  const [p, setP] = useState<FullProfile | null>(null);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const load = () =>
    api
      .userProfile(userId)
      .then((x) => (setP(x), putPeople([x])))
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    setP(null);
    setError(undefined);
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userId]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setMenu(false);
    try {
      await fn();
      props.onChanged();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const participant = props.room?.remoteParticipants.get(`u:${userId}`) as RemoteParticipant | undefined;
  const volKey = participant ? participant.name || participant.identity : "";

  return (
    <div className="profile-backdrop" onClick={props.onClose}>
      <section className="pcard" role="dialog" aria-label={p ? t("Profil de {0}", { 0: p.displayName }) : t("Profil")} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sm profile-close" onClick={props.onClose} aria-label={t("Fermer")}>
          <Icon name="x" size={16} />
        </button>
        {!p ? (
          <p className="muted pad" style={{ padding: 24 }}>
            {error ?? t("Chargement…")}
          </p>
        ) : (
          <ProfileView p={p}>
            {participant && (
              <label className="setting-row" style={{ gap: 12 }}>
                <Icon name="volume" size={18} />
                <span className="soft">{t("Volume")}</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  style={{ flex: 1, width: "auto" }}
                  value={volumeMemory.get(volKey) ?? 1}
                  onChange={(e) => {
                    setParticipantVolume(participant, Number(e.target.value));
                    setTick((t) => t + 1);
                  }}
                  aria-label={t("Volume de {0}", { 0: p.displayName })}
                />
                <span className="value">{Math.round((volumeMemory.get(volKey) ?? 1) * 100)} %</span>
              </label>
            )}
            {error && <p className="error small">{error}</p>}
            {p.self ? (
              <button className="btn" onClick={props.onEditMine}>
                <Icon name="edit" size={16} /> {t("Modifier mon profil")}
              </button>
            ) : p.blockedByMe ? (
              <button className="btn" disabled={busy} onClick={() => act(() => api.unblock(p.id))}>
                {t("Débloquer")}
              </button>
            ) : (
              <>
                <div className="profile-actions">
                  {p.canMessage && (
                    <button className="btn primary" onClick={() => props.onMessage(p.id)}>
                      <Icon name="chat" size={16} /> {t("Message")}
                    </button>
                  )}
                  {p.canCall && (
                    <button className="btn" onClick={() => props.onCall(p.id, p.displayName)}>
                      <Icon name="phone" size={16} /> {t("Appeler")}
                    </button>
                  )}
                  {p.friendship === "incoming" && (
                    <button className="btn" disabled={busy} onClick={() => act(() => api.acceptFriend(p.id))}>
                      <Icon name="userCheck" size={16} /> {t("Accepter en ami")}
                    </button>
                  )}
                  {p.canAddFriend && (
                    <button className="btn" disabled={busy} onClick={() => act(() => api.addFriend(p.username))}>
                      <Icon name="userPlus" size={16} /> {t("Ajouter en ami")}
                    </button>
                  )}
                  {p.friendship === "outgoing" && (
                    <button className="btn" disabled>
                      {t("Demande envoyée")}
                    </button>
                  )}
                  <span className="relative">
                    <button className="icon-btn" aria-label={t("Plus d'options")} aria-expanded={menu} onClick={() => setMenu(!menu)}>
                      <Icon name="more" />
                    </button>
                    {menu && (
                      <>
                        <div className="click-away" onClick={() => setMenu(false)} />
                        <div className="popover profile-menu-pop" role="menu">
                          <button role="menuitem" className="menu-item" onClick={() => (navigator.clipboard?.writeText(p.username), setMenu(false))}>
                            <Icon name="copy" size={16} /> {t("Copier le pseudo")}
                          </button>
                          {p.friendship === "friend" && (
                            <button role="menuitem" className="menu-item" onClick={() => act(() => api.removeFriend(p.id))}>
                              <Icon name="users" size={16} /> {t("Retirer des amis")}
                            </button>
                          )}
                          <button role="menuitem" className="menu-item danger" onClick={() => act(() => api.block(p.id))}>
                            <Icon name="lock" size={16} /> {t("Bloquer")}
                          </button>
                        </div>
                      </>
                    )}
                  </span>
                </div>
                {p.friendship === "friend" && (
                  <span className="small teal-soft">
                    <Icon name="check" size={13} /> {t("Vous êtes amis")}
                  </span>
                )}
              </>
            )}
          </ProfileView>
        )}
      </section>
    </div>
  );
}
