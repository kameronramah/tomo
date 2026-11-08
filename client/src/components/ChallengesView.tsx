import { useCallback, useEffect, useState } from "react";
import type { Api, Challenge, ChallengeBoard } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { getPerson, usePeople } from "../lib/people";
import { locale, t } from "../lib/i18n";
import { errorMessage } from "../lib/ui";
import { Icon, UserAvatar } from "./Brand";

const REWARDS = [25, 50, 100, 200, 500];
const DURATIONS: { label: string; ms: number | null }[] = [
  { label: t("Sans fin"), ms: null },
  { label: t("Ce soir (6 h)"), ms: 6 * 3600_000 },
  { label: t("24 h"), ms: 24 * 3600_000 },
  { label: t("7 jours"), ms: 7 * 86400_000 },
];

const nameOf = (id: string) => getPerson(id)?.displayName ?? "…";
const endLabel = (ts: number) => {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? t("finit à {0}", { 0: d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
    : t("finit le {0}", { 0: d.toLocaleDateString(locale(), { day: "numeric", month: "short" }) });
};

/** Défis à points d'un serveur (pour le fun : pas d'argent, pas de mise). */
export default function ChallengesView({
  api,
  realtime,
  serverId,
  myId,
  isManager,
  onBack,
}: {
  api: Api;
  realtime: Realtime | null;
  serverId: string;
  serverName: string;
  myId: string;
  isManager: boolean;
  onBack: () => void;
}) {
  const [board, setBoard] = useState<ChallengeBoard | null>(null);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [reward, setReward] = useState(100);
  const [duration, setDuration] = useState<number | null>(null);

  const load = useCallback(() => api.challenges(serverId).then(setBoard).catch((e) => setError(errorMessage(e))), [api, serverId]);
  useEffect(() => {
    void load();
    return realtime?.on((e) => e.type === "challenges" && e.serverId === serverId && void load());
  }, [load, realtime, serverId]);
  usePeople([...(board?.challenges.flatMap((c) => c.players) ?? []), ...(board?.leaderboard.map((l) => l.userId) ?? [])]);

  async function act(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await act(() => api.createChallenge(serverId, title.trim(), reward, duration ? Date.now() + duration : undefined));
    setTitle("");
    setCreating(false);
  }

  const myPoints = board?.leaderboard.find((l) => l.userId === myId)?.points ?? 0;
  const month = board ? new Date(board.monthStart).toLocaleDateString(locale(), { month: "long" }) : "";

  return (
    <section className="panel challenges">
      <header className="chat-header">
        <button className="icon-btn" onClick={onBack} aria-label={t("Retour aux pièces")} title={t("Retour aux pièces")}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="col gap-2 grow" style={{ minWidth: 0 }}>
          <strong>{t("Défis")}</strong>
          <span className="muted small ellipsis">{t("Pour le fun : des points, jamais d'argent réel.")}</span>
        </span>
        <span className="points-pill" title={t("Mes points ce mois-ci")}>
          <Icon name="trophy" size={14} /> {myPoints}
        </span>
        <button className="btn primary small" onClick={() => setCreating(!creating)}>
          <Icon name="plus" size={15} /> {t("Nouveau défi")}
        </button>
      </header>

      <div className="challenges-body">
        <div className="col gap-12 grow" style={{ minWidth: 0 }}>
          {creating && (
            <form className="challenge new" onSubmit={create}>
              <label className="field">
                {t("Le défi")}
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder={t("Ex. : le plus de kills sur 3 parties")} autoFocus />
              </label>
              <div className="row gap-12 wrap">
                <label className="field">
                  {t("Récompense")}
                  <select value={reward} onChange={(e) => setReward(Number(e.target.value))}>
                    {REWARDS.map((r) => (
                      <option key={r} value={r}>
                        {t("{0} points", { 0: r })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t("Durée")}
                  <select value={duration ?? ""} onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}>
                    {DURATIONS.map((d) => (
                      <option key={d.label} value={d.ms ?? ""}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <span className="hint">{t("Le gagnant déclare sa victoire, les autres participants valident à la majorité.")}</span>
              <div className="row gap-8">
                <button className="btn primary small" disabled={!title.trim()}>
                  {t("Lancer le défi")}
                </button>
                <button type="button" className="btn small" onClick={() => setCreating(false)}>
                  {t("Annuler")}
                </button>
              </div>
            </form>
          )}
          {error && <p className="error small">{error}</p>}
          {board?.challenges.length === 0 && !creating && <p className="muted">{t("Aucun défi pour l'instant. Lance le premier !")}</p>}
          {board?.challenges.map((c) => (
            <ChallengeCard key={c.id} c={c} myId={myId} isManager={isManager} act={act} api={api} />
          ))}
        </div>

        <aside className="leaderboard">
          <span className="section-title">{t("Classement de {0}", { 0: month })}</span>
          {board?.leaderboard.length === 0 && <p className="muted small">{t("Personne n'a encore de points ce mois-ci.")}</p>}
          {board?.leaderboard.map((l, i) => (
            <div key={l.userId} className={`rank${l.userId === myId ? " me" : ""}`}>
              <span className="rank-n">{i + 1}</span>
              <UserAvatar userId={l.userId} name={nameOf(l.userId)} size={28} />
              <span className="grow ellipsis">
                {nameOf(l.userId)}
                {l.userId === myId && <span className="muted small"> {t("(toi)")}</span>}
              </span>
              <strong>{l.points}</strong>
            </div>
          ))}
          <span className="hint">{t("Le classement repart à zéro le 1er de chaque mois.")}</span>
        </aside>
      </div>
    </section>
  );
}

function ChallengeCard({ c, myId, isManager, act, api }: { c: Challenge; myId: string; isManager: boolean; act: (fn: () => Promise<unknown>) => Promise<void>; api: Api }) {
  const joined = c.players.includes(myId);
  const canVote = c.status === "claimed" && joined && c.claimedBy !== myId;
  const myVote = c.approvals.includes(myId) ? true : c.rejections.includes(myId) ? false : null;
  const label =
    c.status === "claimed"
      ? t("à valider")
      : c.status === "done"
        ? t("terminé")
        : c.status === "cancelled"
          ? t("annulé")
          : c.status === "expired"
            ? t("temps écoulé")
            : c.endsAt
              ? endLabel(c.endsAt)
              : t("ouvert");
  return (
    <article className={`challenge ${c.status}`}>
      <div className="row gap-8">
        <span className={`chip ${c.status === "claimed" ? "amber" : c.status === "open" ? "teal" : ""}`}>{t("DÉFI")}</span>
        <span className="muted small grow">{label}</span>
        <span className="points-pill sm">
          <Icon name="trophy" size={12} /> {c.reward}
        </span>
      </div>
      <strong className="challenge-title">{c.title}</strong>
      {c.status === "claimed" && c.claimedBy && (
        <p className="small">
          {t("{0} déclare avoir gagné. {1} vote(s) sur {2} pour valider.", { 0: nameOf(c.claimedBy), 1: c.approvals.length, 2: c.needed })}
        </p>
      )}
      {c.status === "done" && c.winnerId && <p className="small teal-soft">{t("{0} a gagné {1} points", { 0: nameOf(c.winnerId), 1: c.reward })}</p>}
      <div className="row gap-8 wrap">
        <span className="avatars">
          {c.players.slice(0, 6).map((id) => (
            <UserAvatar key={id} userId={id} name={nameOf(id)} size={24} />
          ))}
        </span>
        <span className="muted small grow">{t("{0} inscrit(s)", { 0: c.players.length })}</span>
        {c.status === "open" && !joined && (
          <button className="btn primary small" onClick={() => void act(() => api.joinChallenge(c.id))}>
            {t("Je relève")}
          </button>
        )}
        {c.status === "open" && joined && (
          <>
            <button className="btn small" onClick={() => void act(() => api.claimChallenge(c.id))} disabled={c.players.length < 2} title={c.players.length < 2 ? t("Il faut au moins un autre participant pour valider.") : undefined}>
              {t("J'ai gagné")}
            </button>
            {c.createdBy !== myId && (
              <button className="btn small" onClick={() => void act(() => api.leaveChallenge(c.id))}>
                {t("Me retirer")}
              </button>
            )}
          </>
        )}
        {canVote && (
          <>
            <button className={`btn small ${myVote === true ? "primary" : ""}`} onClick={() => void act(() => api.voteChallenge(c.id, true))}>
              {t("Valider {0}", { 0: nameOf(c.claimedBy!) })}
            </button>
            <button className={`btn small ${myVote === false ? "danger" : ""}`} onClick={() => void act(() => api.voteChallenge(c.id, false))}>
              {t("Contester")}
            </button>
          </>
        )}
        {(c.status === "open" || c.status === "claimed" || c.status === "expired") && (c.createdBy === myId || isManager) && (
          <button className="icon-btn sm" onClick={() => void act(() => api.cancelChallenge(c.id))} aria-label={t("Annuler le défi")} title={t("Annuler le défi")}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
    </article>
  );
}
