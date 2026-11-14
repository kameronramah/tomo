import { useEffect, useReducer, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import type { Api, DevStats, ServerSummary, User } from "../lib/api";
import { loadDevices } from "../lib/prefs";
import { addBot, addCameraBot, addScreenBot, botCount, botsChatty, loopbackOn, onBotsChange, removeAllBots, setBotsChatty, setLoopback } from "../lib/dev";
import { errorMessage } from "../lib/ui";
import { Icon } from "./Brand";

type Props = {
  api: Api;
  user: User;
  room: Room | null;
  roomId?: string;
  roomLabel?: string;
  server?: ServerSummary;
  onChanged: () => void;
  onClose: () => void;
};

type LogLine = { t: string; msg: string; kind?: "ok" | "warn" | "err" };

/** Événements LiveKit affichés dans le journal. */
const LOGGED_EVENTS: [RoomEvent, string][] = [
  [RoomEvent.ParticipantConnected, "participant arrivé"],
  [RoomEvent.ParticipantDisconnected, "participant parti"],
  [RoomEvent.Reconnecting, "reconnexion…"],
  [RoomEvent.Reconnected, "reconnecté"],
  [RoomEvent.SignalReconnecting, "signal : reconnexion…"],
  [RoomEvent.Disconnected, "déconnecté"],
  [RoomEvent.TrackSubscribed, "piste reçue"],
  [RoomEvent.TrackUnsubscribed, "piste retirée"],
  [RoomEvent.TrackMuted, "micro coupé"],
  [RoomEvent.TrackUnmuted, "micro activé"],
  [RoomEvent.RoomMetadataChanged, "métadonnées du salon"],
  [RoomEvent.MediaDevicesError, "erreur de périphérique"],
];

const now = () => new Date().toLocaleTimeString("fr-FR");

export default function DevPanel({ api, user, room, roomId, roomLabel, server, onChanged, onClose }: Props) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState<DevStats>();
  const [busy, setBusy] = useState<string>();

  const push = (msg: string, kind?: LogLine["kind"]) => setLog((l) => [{ t: now(), msg, kind }, ...l].slice(0, 60));

  // Rafraîchit les infos chaque seconde + suit les bots.
  useEffect(() => {
    const t = setInterval(tick, 1000);
    const off = onBotsChange(tick);
    return () => {
      clearInterval(t);
      off();
    };
  }, []);

  // Journal des événements du salon.
  useEffect(() => {
    if (!room) return;
    const handlers = LOGGED_EVENTS.map(([ev, label]) => {
      const h = (...args: unknown[]) => {
        const who = args.find((a) => a && typeof a === "object" && "identity" in (a as object)) as { name?: string; identity: string } | undefined;
        push(`${label}${who ? ` · ${who.name || who.identity}` : ""}`, ev === RoomEvent.Disconnected || ev === RoomEvent.MediaDevicesError ? "err" : ev === RoomEvent.Reconnected ? "ok" : undefined);
      };
      room.on(ev, h);
      return [ev, h] as const;
    });
    push(`connecté au salon « ${roomLabel ?? room.name} »`, "ok");
    return () => handlers.forEach(([ev, h]) => room.off(ev, h));
  }, [room]);

  const loadStats = () => api.devStats().then(setStats).catch((e) => push(errorMessage(e), "err"));
  useEffect(() => {
    loadStats();
  }, []);

  async function run(label: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(label);
    try {
      await fn();
      push(success ?? label, "ok");
    } catch (err) {
      push(`${label} : ${errorMessage(err)}`, "err");
    } finally {
      setBusy(undefined);
      tick();
    }
  }

  const engine = (room as unknown as { engine?: { client?: { rtt?: number } } } | null)?.engine;
  const rtt = engine?.client?.rtt;
  const info: [string, string][] = [
    ["Instance", api.baseUrl.replace(/^https?:\/\//, "")],
    ["Compte", `${user.username} (test)`],
    ["Rester connecté", api.debugInfo.remember ? "oui (coffre-fort)" : "non"],
    ["Serveur", server ? `${server.name} · ${server.role}` : "—"],
    ["Salon", room ? (roomLabel ?? room.name) : "pas en vocal"],
    ["Identité", room?.localParticipant.identity ?? "—"],
    ["État", room?.state ?? "—"],
    ["Qualité", room?.localParticipant.connectionQuality ?? "—"],
    ["Ping signal", rtt ? `${Math.round(rtt)} ms` : "—"],
    ["Participants", room ? String(room.numParticipants || room.remoteParticipants.size + 1) : "—"],
    ["LiveKit", room?.serverInfo ? `${room.serverInfo.version ?? "?"}${room.serverInfo.region ? ` · ${room.serverInfo.region}` : ""}` : "—"],
  ];

  const inVoice = !!room && !!roomId;

  return (
    <aside className="dev-panel" aria-label="Outils de test">
      <header className="row space-between">
        <span className="row gap-8">
          <span className="feature-icon amber">
            <Icon name="flask" />
          </span>
          <span className="col gap-2">
            <strong>Outils de test</strong>
            <span className="muted small">Compte de test · serveur en mode dev</span>
          </span>
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer les outils de test">
          <Icon name="x" />
        </button>
      </header>

      <section>
        <h3 className="dev-title">Infos</h3>
        <dl className="dev-info">
          {info.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="ellipsis" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="dev-title">Faux joueurs {botCount() > 0 && <span className="teal">· {botCount()} connecté{botCount() > 1 ? "s" : ""}</span>}</h3>
        <p className="muted small">Des bots entrent dans ton salon et émettent un bip doux quand ils « parlent ».</p>
        <div className="dev-actions">
          <button className="btn small" disabled={!inVoice || !!busy} onClick={() => run("+1 bot", () => addBot(api, roomId!), "un bot a rejoint le salon")}>
            +1 bot
          </button>
          <button
            className="btn small"
            disabled={!inVoice || !!busy}
            onClick={() =>
              run("+3 bots", async () => {
                for (let i = 0; i < 3; i++) await addBot(api, roomId!);
              }, "3 bots ont rejoint le salon")
            }
          >
            +3 bots
          </button>
          <button
            className="btn small"
            disabled={!inVoice || !!busy}
            onClick={() => run("bot écran", () => addScreenBot(api, roomId!), "un bot partage un faux écran (1080p 60 i/s)")}
          >
            Bot qui partage un écran
          </button>
          <button
            className="btn small"
            disabled={!inVoice || !!busy}
            onClick={() => run("bot caméra", () => addCameraBot(api, roomId!), "un bot allume une fausse caméra")}
          >
            Bot avec caméra
          </button>
          <button className="btn small" disabled={botCount() === 0 || !!busy} onClick={() => run("retirer les bots", removeAllBots, "bots retirés")}>
            Tout retirer
          </button>
        </div>
        <label className="check small">
          <input type="checkbox" checked={botsChatty()} onChange={(e) => setBotsChatty(e.target.checked)} />
          Les bots parlent
        </label>
        {!inVoice && <p className="hint">Rejoins un salon pour ajouter des bots.</p>}
      </section>

      <section>
        <h3 className="dev-title">Audio</h3>
        <label className="check small">
          <input
            type="checkbox"
            checked={loopbackOn()}
            onChange={(e) =>
              run(e.target.checked ? "retour micro activé" : "retour micro coupé", () => setLoopback(e.target.checked, loadDevices().input))
            }
          />
          M'entendre (retour micro, casque conseillé)
        </label>
      </section>

      <section>
        <h3 className="dev-title">Réseau</h3>
        <div className="dev-actions">
          <button
            className="btn small"
            disabled={!inVoice || !!busy}
            onClick={() => run("reconnexion rapide", () => (room as any).simulateScenario("signal-reconnect"), "coupure signal simulée")}
          >
            Coupure courte
          </button>
          <button
            className="btn small"
            disabled={!inVoice || !!busy}
            onClick={() => run("reconnexion complète", () => (room as any).simulateScenario("full-reconnect"), "reconnexion complète simulée")}
          >
            Reconnexion complète
          </button>
        </div>
      </section>

      <section>
        <h3 className="dev-title">Session</h3>
        <div className="dev-actions">
          <button
            className="btn small"
            disabled={!!busy}
            onClick={() =>
              run("jeton expiré", async () => {
                api.debugBreakAccessToken();
                await api.servers();
              }, "jeton cassé puis session renouvelée automatiquement ✓")
            }
          >
            Jeton expiré
          </button>
          <button className="btn small danger" disabled={!!busy} onClick={() => api.debugLoseSession()}>
            Session perdue
          </button>
        </div>
      </section>

      <section>
        <h3 className="dev-title">Données</h3>
        {stats && (
          <div className="dev-stats">
            <span>
              <strong>{stats.users}</strong> comptes
            </span>
            <span>
              <strong>{stats.fakeMembers}</strong> faux membres
            </span>
            <span>
              <strong>{stats.servers}</strong> serveurs
            </span>
            <span>
              <strong>{stats.rooms}</strong> salons
            </span>
            <span>
              <strong>{stats.sessions}</strong> sessions
            </span>
            <span>
              <strong>{stats.activeInvites}</strong> invitations
            </span>
          </div>
        )}
        <div className="dev-actions">
          <button
            className="btn small"
            disabled={!server || !!busy}
            onClick={() =>
              run("faux membres", async () => {
                const r = await api.devFakeMembers(server!.id, 5);
                push(`ajoutés : ${r.created.join(", ")}`);
                onChanged();
                await loadStats();
              }, `5 faux membres ajoutés à ${server?.name}`)
            }
          >
            +5 faux membres
          </button>
          <button
            className="btn small"
            disabled={!!busy}
            onClick={() =>
              run("suppression", async () => {
                const r = await api.devDeleteFakeMembers();
                push(`${r.deleted} faux membre(s) supprimé(s)`);
                onChanged();
                await loadStats();
              }, "faux membres supprimés")
            }
          >
            Supprimer les faux membres
          </button>
        </div>
      </section>

      <section className="grow-section">
        <div className="row space-between">
          <h3 className="dev-title">Journal</h3>
          <button className="link small" onClick={() => setLog([])}>
            vider
          </button>
        </div>
        <ol className="dev-log">
          {log.length === 0 && <li className="muted">Rien pour l'instant.</li>}
          {log.map((l, i) => (
            <li key={i} className={l.kind ?? ""}>
              <time>{l.t}</time> {l.msg}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
