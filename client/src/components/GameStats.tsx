import { useEffect, useState } from "react";
import type { Api, GameLinks, UserStats } from "../lib/api";
import type { Realtime } from "../lib/realtime";
import { t } from "../lib/i18n";
import { errorMessage } from "../lib/ui";
import { openExternal } from "./Attachments";
import { sinceLabel } from "../lib/games";

const hours = (min: number) => (min >= 60 ? t("{0} h", { 0: Math.round(min / 60) }) : t("{0} min", { 0: min }));
const TIER: Record<string, string> = {
  IRON: "Fer",
  BRONZE: "Bronze",
  SILVER: "Argent",
  GOLD: "Or",
  PLATINUM: "Platine",
  EMERALD: "Émeraude",
  DIAMOND: "Diamant",
  MASTER: "Maître",
  GRANDMASTER: "Grand maître",
  CHALLENGER: "Challenger",
};

/** Bloc « Stats » de la fiche profil (Steam, League of Legends). */
export function StatsBlock({ api, userId }: { api: Api; userId: string }) {
  const [s, setS] = useState<UserStats | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .stats(userId)
      .then((x) => alive && setS(x))
      .catch(() => {});
    return () => void (alive = false);
  }, [api, userId]);
  if (!s || (!s.steam && !s.riot)) return null;
  return (
    <div className="stats-block">
      {s.riot && (
        <div className="stat-card">
          <div className="row gap-8">
            <span className="game-badge sm">LoL</span>
            <span className="col gap-2 grow">
              <strong>League of Legends</strong>
              <span className="muted small">
                {t("via Riot")} · {s.riot.riotId}
                {s.riot.level ? ` · ${t("niveau {0}", { 0: s.riot.level })}` : ""}
              </span>
            </span>
          </div>
          {s.riot.error && <span className="muted small">{t(s.riot.error)}</span>}
          {s.riot.ranks?.map((r) => (
            <div key={r.queue} className="stat-line">
              <span className="muted small">{r.queue}</span>
              <strong>
                {t(TIER[r.tier] ?? r.tier)} {r.division} · {r.lp} LP
              </strong>
              {r.winRate !== null && <span className="small">{t("{0} % de victoires", { 0: r.winRate })}</span>}
            </div>
          ))}
          {s.riot.matches?.map((m) => (
            <div key={m.endedAt} className={`stat-line match ${m.win ? "win" : "loss"}`}>
              <span className="small strong-ish">{m.win ? t("Victoire") : t("Défaite")}</span>
              <span className="small">
                {m.champion} · {m.kills} / {m.deaths} / {m.assists}
              </span>
              <span className="muted small">{t("il y a {0}", { 0: sinceLabel(m.endedAt) })}</span>
            </div>
          ))}
        </div>
      )}
      {s.steam && (
        <div className="stat-card">
          <div className="row gap-8">
            <span className="game-badge sm">ST</span>
            <span className="col gap-2 grow">
              <strong>Steam</strong>
              <span className="muted small">
                {s.steam.minutes2w !== undefined ? t("{0} ces 2 dernières semaines", { 0: hours(s.steam.minutes2w) }) : s.steam.name ?? ""}
              </span>
            </span>
            {s.steam.profileUrl && (
              <button className="btn small" onClick={() => openExternal(s.steam!.profileUrl!)}>
                {t("Profil")}
              </button>
            )}
          </div>
          {s.steam.error && <span className="muted small">{t(s.steam.error)}</span>}
          {s.steam.private && <span className="muted small">{t("Les détails de jeu de ce profil Steam sont privés.")}</span>}
          {s.steam.games?.map((g) => (
            <div key={g.appId} className="stat-line">
              <span className="small grow">{g.name}</span>
              <strong className="small">{hours(g.minutes2w)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Paramètres › Comptes de jeu. */
export function GameAccountsSection({ api, realtime }: { api: Api; realtime: Realtime | null }) {
  const [links, setLinks] = useState<GameLinks | null>(null);
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("euw1");
  const [error, setError] = useState<string>();
  const [waitingSteam, setWaitingSteam] = useState(false);

  const load = () => api.links().then(setLinks).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
    return realtime?.on((e) => {
      if (e.type === "links") {
        setWaitingSteam(false);
        void load();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, realtime]);

  async function run(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!links) return <h1 className="title">{t("Comptes de jeu")}</h1>;
  return (
    <>
      <h1 className="title">{t("Comptes de jeu")}</h1>
      <div className="settings-card">
        <div className="link-row">
          <span className="game-badge">ST</span>
          <span className="col gap-2 grow">
            <strong>Steam</strong>
            <span className="muted small">{links.steam ? t("Lié") : t("Pas lié")}</span>
          </span>
          {links.steam ? (
            <button className="btn small" onClick={() => void run(() => api.unlinkSteam())}>
              {t("Délier")}
            </button>
          ) : (
            <button
              className="btn primary small"
              onClick={() =>
                void run(async () => {
                  const { url } = await api.steamLinkStart();
                  setWaitingSteam(true);
                  openExternal(url);
                })
              }
            >
              {t("Lier mon compte Steam")}
            </button>
          )}
        </div>
        <span className="hint">
          {waitingSteam
            ? t("Connecte-toi sur la page Steam qui vient de s'ouvrir, puis reviens ici.")
            : t("Connexion officielle Steam : Tomo ne voit jamais ton mot de passe. Il faut que les détails de jeu de ton profil Steam soient publics.")}
        </span>
        {!links.available.steam && <span className="hint">{t("Ce serveur Tomo n'a pas de clé Steam : la liaison marche, mais pas encore les stats.")}</span>}
      </div>

      <div className="settings-card">
        <div className="link-row">
          <span className="game-badge">RI</span>
          <span className="col gap-2 grow">
            <strong>Riot Games (League of Legends)</strong>
            <span className="muted small">{links.riot ? `${links.riot.riotId} · ${links.regions.find((r) => r.id === links.riot!.region)?.label ?? ""}` : t("Pas lié")}</span>
          </span>
          {links.riot && (
            <button className="btn small" onClick={() => void run(() => api.unlinkRiot())}>
              {t("Délier")}
            </button>
          )}
        </div>
        {!links.riot &&
          (links.available.riot ? (
            <form
              className="row gap-8 wrap"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.linkRiot(riotId, region));
              }}
            >
              <input value={riotId} onChange={(e) => setRiotId(e.target.value)} placeholder={t("Riot ID, ex. : Kaze#EUW")} aria-label={t("Riot ID")} />
              <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={t("Région")}>
                {links.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button className="btn primary small" disabled={!riotId.includes("#")}>
                {t("Lier mon compte Riot")}
              </button>
            </form>
          ) : (
            <span className="hint">{t("Ce serveur Tomo n'a pas de clé Riot : la liaison Riot n'est pas disponible.")}</span>
          ))}
        <span className="hint">
          {t("Riot réserve sa connexion officielle aux applis validées : on lie donc avec ton Riot ID. Valorant n'est pas encore accessible (API réservée aux applis validées par Riot).")}
        </span>
      </div>

      <div className="settings-card">
        <h3 className="dev-title">{t("Qui voit mes stats")}</h3>
        <select value={links.visibility} onChange={(e) => void run(() => api.setLinks({ visibility: e.target.value as GameLinks["visibility"] }))}>
          <option value="everyone">{t("Tout le monde")}</option>
          <option value="servers">{t("Amis + membres de mes serveurs")}</option>
          <option value="nobody">{t("Personne")}</option>
        </select>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Montrer mon rang")}</span>
            <span className="hint">{t("Sinon : seulement les heures jouées et les parties récentes.")}</span>
          </span>
          <input type="checkbox" className="toggle" checked={links.showRank} onChange={(e) => void run(() => api.setLinks({ showRank: e.target.checked }))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

