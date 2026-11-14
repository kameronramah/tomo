import { useEffect, useRef } from "react";
import type { Participant, Room } from "livekit-client";
import { viewersOf, type Share } from "../lib/screen";
import { getPerson, usePeople, userIdOf } from "../lib/people";
import { colorFor } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon, UserAvatar } from "./Brand";

type Props = {
  room: Room;
  shares: Share[];
  onWatch: (identity: string) => void;
  onStopMine: () => void;
};

const nameOf = (p: Participant) => p.name || p.identity;

/** Petite pile d'avatars des spectateurs. */
function Viewers({ people }: { people: Participant[] }) {
  if (!people.length) return <span className="share-viewers none">{t("Personne ne regarde")}</span>;
  return (
    <span className="share-viewers" title={people.map(nameOf).join(", ")}>
      <span className="share-stack">
        {people.slice(0, 3).map((p) => (
          <UserAvatar key={p.identity} identity={p.identity} name={nameOf(p)} size={20} />
        ))}
      </span>
      {people.length === 1 ? t("1 regarde") : t("{0} regardent", { 0: people.length })}
    </span>
  );
}

/** Mon partage : petit aperçu (piste locale, rien n'est téléchargé) + qui me regarde. */
function MyShare({ room, share, onWatch, onStop }: { room: Room; share: Share; onWatch: () => void; onStop: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const track = share.publication.track;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    el.muted = true;
    return () => void track.detach(el);
  }, [track]);
  const viewers = viewersOf(room, share.participant.identity);
  return (
    <div className="share-card mine">
      <button className="share-thumb" onClick={onWatch} title={t("Voir ce que voient tes potes")}>
        <video ref={videoRef} autoPlay playsInline muted />
        <span className="share-live">
          <Icon name="screenShare" size={12} /> {t("En direct")}
        </span>
      </button>
      <div className="share-mine-side">
        <strong>{t("Tu partages ton écran")}</strong>
        {viewers.length ? (
          <div className="share-watchers">
            {viewers.map((p) => (
              <span key={p.identity} className="share-watcher">
                <UserAvatar identity={p.identity} name={nameOf(p)} size={24} /> <span className="ellipsis">{nameOf(p)}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="muted small">{t("Personne ne regarde pour l'instant.")}</span>
        )}
        <div className="row gap-8 wrap">
          <button className="btn pill small" onClick={onWatch}>
            <Icon name="eye" size={15} /> {t("Aperçu")}
          </button>
          <button className="btn pill small leave" onClick={onStop}>
            <Icon name="x" size={15} /> {t("Arrêter le partage")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Les partages d'écran en cours : on choisit celui qu'on veut regarder (rien ne s'ouvre tout seul). */
export default function ShareStrip({ room, shares, onWatch, onStopMine }: Props) {
  usePeople(shares.map((s) => userIdOf(s.participant.identity)));
  if (!shares.length) return null;
  return (
    <div className="share-strip" aria-label={t("Écrans partagés")}>
      <span className="share-strip-title">
        {t("Écrans partagés")} <em>{shares.length}</em>
      </span>
      <div className="share-cards">
        {shares.map((s) => {
          const id = s.participant.identity;
          if (s.isLocal) return <MyShare key={id} room={room} share={s} onWatch={() => onWatch(id)} onStop={onStopMine} />;
          const name = nameOf(s.participant);
          const game = getPerson(userIdOf(id))?.game?.name;
          const detail = [game, s.hasAudio ? t("avec le son") : null].filter(Boolean).join(" · ");
          const tint = colorFor(name);
          return (
            <div key={id} className="share-card">
              <button
                className="share-thumb placeholder"
                style={{ background: `radial-gradient(circle at 30% 30%, ${tint.bg}, #131216 75%)` }}
                onClick={() => onWatch(id)}
                aria-label={t("Regarder l'écran de {0}", { 0: name })}
              >
                <span className="share-live">
                  <Icon name="screenShare" size={12} /> {t("En direct")}
                </span>
                <span style={{ color: tint.fg }}>
                  <Icon name="monitor" size={30} />
                </span>
                <Viewers people={viewersOf(room, id)} />
              </button>
              <div className="share-info">
                <UserAvatar identity={id} name={name} size={30} />
                <span className="col grow share-info-text">
                  <strong className="ellipsis">{t("Écran de {0}", { 0: name })}</strong>
                  {detail && <span className="muted small ellipsis">{detail}</span>}
                </span>
                <button className="btn pill small primary" onClick={() => onWatch(id)}>
                  <Icon name="eye" size={15} /> {t("Regarder")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
