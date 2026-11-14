import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import { gamePrefs, onGame, setGamePrefs, type RunningGame } from "../lib/games";
import { inTauri } from "../lib/desktop";
import { getSettings, onSettingsChange, updateSettings, type Settings } from "../lib/prefs";
import { t } from "../lib/i18n";
import { initials } from "../lib/ui";

type RoomChoice = { serverId: string; roomId: string; label: string };

/** Paramètres › Jeux : détection, « joue à … », et réglages par jeu. */
export default function SettingsGames({ api }: { api: Api }) {
  const [s, setS] = useState<Settings>(getSettings());
  useEffect(() => onSettingsChange(setS), []);
  const [running, setRunning] = useState<RunningGame | null>(null);
  useEffect(() => onGame(setRunning), []);
  const [showGame, setShowGame] = useState<boolean | null>(null);
  const [rooms, setRooms] = useState<RoomChoice[]>([]);
  const [newName, setNewName] = useState("");
  const [newExe, setNewExe] = useState("");

  useEffect(() => {
    api.myProfile().then((p) => setShowGame(p.privacy.showGame)).catch(() => {});
    // Pièces de tous mes serveurs (pour la « pièce auto »)
    api
      .servers()
      .then((list) => Promise.all(list.map((x) => api.server(x.id).catch(() => null))))
      .then((details) =>
        setRooms(details.flatMap((d) => (d ? d.rooms.map((r) => ({ serverId: d.id, roomId: r.id, label: `${d.name} › ${r.label}` })) : []))),
      )
      .catch(() => {});
  }, [api]);

  const games = [...s.games.seen];
  for (const c of s.games.custom) {
    const id = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!games.some((g) => g.id === id)) games.push({ id, name: c.name });
  }

  function addGame() {
    const exe = newExe.trim().toLowerCase().replace(/^.*[\\/]/, "");
    const name = newName.trim().slice(0, 40);
    if (!exe || !name) return;
    updateSettings("games", { custom: [...s.games.custom.filter((c) => c.exe !== exe), { exe, name }] });
    setNewName("");
    setNewExe("");
  }

  return (
    <>
      <h1 className="title">{t("Jeux")}</h1>
      <div className="settings-card">
        <h3 className="dev-title">{t("Détection")}</h3>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Détecter les jeux lancés")}</span>
            <span className="hint">{t("Tomo regarde la liste des programmes ouverts (rien d'autre). Aucun envoi tant que « Montrer à quoi je joue » est coupé.")}</span>
          </span>
          <input type="checkbox" className="toggle" checked={s.games.detect} onChange={(e) => updateSettings("games", { detect: e.target.checked })} />
        </label>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Montrer à quoi je joue")}</span>
            <span className="hint">{t("« Joue à … » sur ton profil, dans la liste des membres et sur la carte de la pièce.")}</span>
          </span>
          <input
            type="checkbox"
            className="toggle"
            checked={!!showGame}
            disabled={showGame === null}
            onChange={async (e) => {
              const v = e.target.checked;
              setShowGame(v);
              await api.setPrivacy({ showGame: v }).catch(() => setShowGame(!v));
            }}
          />
        </label>
        <label className="setting-row">
          <span className="col gap-2 grow">
            <span>{t("Proposer de rejoindre mes potes")}</span>
            <span className="hint">{t("Quand tu lances un jeu et que des potes y jouent déjà en vocal.")}</span>
          </span>
          <input type="checkbox" className="toggle" checked={s.games.propose} onChange={(e) => updateSettings("games", { propose: e.target.checked })} />
        </label>
        {!inTauri && <span className="hint">{t("Disponible dans l'application de bureau.")}</span>}
      </div>

      <div className="settings-card">
        <h3 className="dev-title">{t("Mes jeux · {0} détectés", { 0: games.length })}</h3>
        {games.length === 0 && <p className="muted small">{t("Lance un jeu : il apparaîtra ici avec ses réglages.")}</p>}
        {games.map((g) => {
          const p = gamePrefs(g.id);
          const auto = p.autoRoom ? `${p.autoRoom.serverId}|${p.autoRoom.roomId}` : "";
          return (
            <div key={g.id} className={`game-row${p.hidden ? " hidden" : ""}`}>
              <span className="game-badge">{initials(g.name)}</span>
              <div className="col gap-8 grow" style={{ minWidth: 0 }}>
                <strong>
                  {g.name}
                  {running?.id === g.id && <span className="teal-soft small"> · {t("en cours")}</span>}
                </strong>
                <div className="game-opts">
                  <label>
                    {t("Audio spatial")}
                    <select value={p.spatial ? "on" : "off"} onChange={(e) => setGamePrefs(g.id, { spatial: e.target.value === "on" })}>
                      <option value="on">{t("activé (Mumble Link)")}</option>
                      <option value="off">{t("coupé")}</option>
                    </select>
                  </label>
                  <label>
                    {t("Overlay")}
                    <select value={p.overlay ? "on" : "off"} onChange={(e) => setGamePrefs(g.id, { overlay: e.target.value === "on" })}>
                      <option value="on">{t("activé")}</option>
                      <option value="off">{t("coupé")}</option>
                    </select>
                  </label>
                  <label>
                    {t("Pièce auto")}
                    <select
                      value={auto}
                      onChange={(e) => {
                        const r = rooms.find((x) => `${x.serverId}|${x.roomId}` === e.target.value);
                        setGamePrefs(g.id, { autoRoom: r ?? null });
                      }}
                    >
                      <option value="">{t("aucune")}</option>
                      {rooms.map((r) => (
                        <option key={r.roomId} value={`${r.serverId}|${r.roomId}`}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="row gap-6">
                    <input type="checkbox" checked={p.focus} onChange={(e) => setGamePrefs(g.id, { focus: e.target.checked })} />
                    {t("Mode focus")}
                  </label>
                  <label className="row gap-6">
                    <input type="checkbox" checked={p.hidden} onChange={(e) => setGamePrefs(g.id, { hidden: e.target.checked })} />
                    {t("Masquer")}
                  </label>
                </div>
              </div>
            </div>
          );
        })}
        <div className="game-add">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("Nom du jeu")} aria-label={t("Nom du jeu")} />
          <input value={newExe} onChange={(e) => setNewExe(e.target.value)} placeholder={t("programme, ex. : eldenring.exe")} aria-label={t("Nom du programme")} />
          <button className="btn small" onClick={addGame} disabled={!newName.trim() || !newExe.trim()}>
            {t("Ajouter un jeu")}
          </button>
        </div>
        <span className="hint">
          {t("« Pièce auto » : quand tu lances ce jeu, Tomo te met dans cette pièce (si tu n'es pas déjà en vocal). « Mode focus » : coupe les notifications sauf tes coéquipiers tant que le jeu tourne. « Masquer » : ne s'affiche jamais dans « joue à … ».")}
        </span>
      </div>
    </>
  );
}
