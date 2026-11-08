import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import { Api, type RoomInfo, type ServerDetail, type ServerSummary, type Session } from "./lib/api";
import { loadInstance, loadLastServer, normalizeInstance, saveInstance, saveLastServer } from "./lib/prefs";
import { joinRoom, setDeafened as applyDeafen } from "./lib/voice";
import { errorMessage } from "./lib/ui";
import AuthScreen from "./components/AuthScreen";
import Sidebar from "./components/Sidebar";
import Stage from "./components/Stage";
import { ServerHome, Welcome } from "./components/Home";
import { ConfirmDialog, InviteDialog, ManageServerDialog, PromptDialog } from "./components/Dialogs";
import { Logo } from "./components/Brand";
import "./App.css";

type Voice = {
  room: Room;
  serverId: string;
  serverName: string;
  roomId: string;
  roomLabel: string;
  warning?: string;
};

type Dialog =
  | { kind: "createServer" }
  | { kind: "joinServer" }
  | { kind: "invite"; server: { id: string; name: string }; guests: boolean }
  | { kind: "manage"; server: ServerSummary }
  | { kind: "addRoom"; serverId: string }
  | { kind: "renameRoom"; room: RoomInfo }
  | { kind: "deleteRoom"; room: RoomInfo };

const SERVERS_POLL_MS = 10_000;
const DETAIL_POLL_MS = 3_000;

export default function App() {
  const [api, setApi] = useState(() => new Api(loadInstance()));
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string>();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(loadLastServer);
  const [detail, setDetail] = useState<ServerDetail | null>(null);

  const [voice, setVoice] = useState<Voice | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string>();

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<string>();
  const voiceRef = useRef<Voice | null>(null);
  voiceRef.current = voice;

  const showError = useCallback((err: unknown) => setToast(errorMessage(err)), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Session -----------------------------------------------------------
  const endSession = useCallback(async (message?: string) => {
    const v = voiceRef.current;
    setVoice(null);
    await v?.room.disconnect();
    setSession(null);
    setServers([]);
    setDetail(null);
    setNotice(message);
  }, []);

  useEffect(() => {
    api.onSessionLost = () =>
      endSession(session?.kind === "guest" ? "Ton accès invité a expiré. Merci d'être passé !" : "Ta session a expiré, reconnecte-toi.");
  }, [api, session, endSession]);

  useEffect(() => {
    setBooting(true);
    api
      .restore()
      .then((s) => s && setSession(s))
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [api]);

  function onSession(s: Session) {
    setNotice(undefined);
    setSession(s);
    if (s.kind === "guest") setActiveId(s.guest.server.id);
  }

  async function logout() {
    await api.logout();
    await endSession();
  }

  async function logoutAll() {
    try {
      await api.logoutAll();
      await endSession("Tous tes appareils ont été déconnectés.");
    } catch (err) {
      showError(err);
    }
  }

  // ---- Serveurs ----------------------------------------------------------
  const loadServers = useCallback(async () => {
    try {
      const list = await api.servers();
      setServers(list);
      return list;
    } catch {
      return null;
    }
  }, [api]);

  useEffect(() => {
    if (!session) return;
    loadServers();
    const t = setInterval(loadServers, SERVERS_POLL_MS);
    return () => clearInterval(t);
  }, [session, loadServers]);

  const active = servers.find((s) => s.id === activeId) ?? servers[0];

  useEffect(() => {
    if (active) saveLastServer(active.id);
  }, [active?.id]);

  const loadDetail = useCallback(async () => {
    if (!active) return;
    try {
      setDetail(await api.server(active.id));
    } catch {
      // serveur supprimé ou accès retiré : on rafraîchit la liste
      const list = await loadServers();
      if (list && !list.some((s) => s.id === active.id)) setDetail(null);
    }
  }, [api, active?.id, loadServers]);

  useEffect(() => {
    if (!session || !active) {
      setDetail(null);
      return;
    }
    setDetail((d) => (d?.id === active.id ? d : null));
    loadDetail();
    const t = setInterval(loadDetail, DETAIL_POLL_MS);
    return () => clearInterval(t);
  }, [session, active?.id, loadDetail]);

  // Ctrl + 1…9 : changer de serveur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && servers[n - 1]) {
        e.preventDefault();
        setActiveId(servers[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [servers]);

  // ---- Vocal -------------------------------------------------------------
  useEffect(() => {
    if (!voice) {
      setSpeaking(new Set());
      return;
    }
    const room = voice.room;
    const onSpeakers = () => setSpeaking(new Set(room.activeSpeakers.map((p) => p.identity)));
    const onDisconnected = () => setVoice((v) => (v?.room === room ? null : v));
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers).on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers).off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [voice]);

  async function enterRoom(room: RoomInfo) {
    if (!active || !detail) return;
    if (voice?.roomId === room.id) return;
    setJoiningRoomId(room.id);
    try {
      if (voice) {
        const previous = voice.room;
        setVoice(null);
        await previous.disconnect();
      }
      const joined = await joinRoom(api, room.id, { micEnabled: micOn && !deafened });
      applyDeafen(joined.room, deafened);
      if (joined.warning) setMicOn(false);
      setVoice({
        room: joined.room,
        serverId: detail.id,
        serverName: detail.name,
        roomId: room.id,
        roomLabel: room.label,
        warning: joined.warning,
      });
      loadDetail();
    } catch (err) {
      showError(err);
    } finally {
      setJoiningRoomId(undefined);
    }
  }

  async function leaveVoice() {
    const v = voice;
    setVoice(null);
    await v?.room.disconnect();
    loadDetail();
  }

  async function toggleMic() {
    const next = !micOn;
    try {
      await voice?.room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      if (next && deafened) toggleDeafen();
    } catch {
      showError("Impossible d'activer le micro. Vérifie l'autorisation du micro.");
    }
  }

  async function toggleDeafen() {
    const next = !deafened;
    setDeafened(next);
    applyDeafen(voice?.room ?? null, next);
    // Comme partout : couper le son coupe aussi le micro.
    if (next && micOn) {
      await voice?.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      setMicOn(false);
    }
  }

  async function toggleSpatial() {
    const room = detail?.rooms.find((r) => r.id === voice?.roomId);
    if (!room) return;
    try {
      await api.setSpatial(room.id, !room.spatial);
      loadDetail();
    } catch (err) {
      showError(err);
    }
  }

  // ---- Rendu -------------------------------------------------------------
  if (booting) {
    return (
      <div className="splash">
        <Logo size={56} cut="var(--bg)" />
      </div>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        api={api}
        notice={notice}
        onSession={onSession}
        onChangeInstance={(url) => {
          saveInstance(url);
          setApi(new Api(normalizeInstance(url)));
        }}
      />
    );
  }

  const displayName = session.kind === "user" ? session.user.username : session.guest.name;
  const isGuest = session.kind === "guest";
  const isManager = active?.role === "owner" || active?.role === "admin";
  const voiceHere = voice && detail && voice.serverId === detail.id;
  const voiceRoomInfo = voiceHere ? detail.rooms.find((r) => r.id === voice.roomId) : undefined;
  const openInvite = () => active && setDialog({ kind: "invite", server: active, guests: isManager });

  return (
    <div className="app">
      <Sidebar
        session={session}
        displayName={displayName}
        servers={servers}
        active={active}
        detail={detail}
        voice={
          voice
            ? {
                serverId: voice.serverId,
                serverName: voice.serverName,
                roomId: voice.roomId,
                roomLabel: voice.roomLabel,
                identity: voice.room.localParticipant.identity,
                speaking,
              }
            : null
        }
        joiningRoomId={joiningRoomId}
        micOn={micOn}
        deafened={deafened}
        onSelectServer={setActiveId}
        onCreateServer={() => setDialog({ kind: "createServer" })}
        onJoinServer={() => setDialog({ kind: "joinServer" })}
        onManageServer={() => active && setDialog({ kind: "manage", server: active })}
        onJoinRoom={enterRoom}
        onAddRoom={() => active && setDialog({ kind: "addRoom", serverId: active.id })}
        onRenameRoom={(room) => setDialog({ kind: "renameRoom", room })}
        onDeleteRoom={(room) => setDialog({ kind: "deleteRoom", room })}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onLeaveVoice={leaveVoice}
        onLogout={logout}
        onLogoutAll={logoutAll}
      />

      <main className="content">
        {voiceHere ? (
          <Stage
            key={voice.room.name}
            room={voice.room}
            roomLabel={voiceRoomInfo?.label ?? voice.roomLabel}
            serverName={voice.serverName}
            spatial={voiceRoomInfo?.spatial ?? false}
            warning={voice.warning}
            micOn={micOn}
            deafened={deafened}
            canToggleSpatial={!isGuest}
            canInvite={!isGuest}
            onToggleMic={toggleMic}
            onToggleDeafen={toggleDeafen}
            onToggleSpatial={toggleSpatial}
            onInvite={openInvite}
            onLeave={leaveVoice}
          />
        ) : detail ? (
          <ServerHome
            name={displayName}
            detail={detail}
            canInvite={!isGuest}
            joiningRoomId={joiningRoomId}
            onJoin={enterRoom}
            onInvite={openInvite}
          />
        ) : servers.length === 0 && !isGuest ? (
          <Welcome
            name={displayName}
            onCreate={() => setDialog({ kind: "createServer" })}
            onJoin={() => setDialog({ kind: "joinServer" })}
          />
        ) : (
          <div className="splash inline">
            <Logo size={40} cut="var(--bg)" />
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(undefined)}>
          {toast}
        </div>
      )}

      {dialog?.kind === "createServer" && (
        <PromptDialog
          title="Créer un serveur"
          subtitle="Tu en seras l'admin. Un premier salon « Général » est créé pour toi."
          label="Nom du serveur"
          placeholder="Les potes"
          confirmLabel="Créer"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const s = await api.createServer(name);
            await loadServers();
            setActiveId(s.id);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "joinServer" && (
        <PromptDialog
          title="Rejoindre un serveur"
          subtitle="Colle le code qu'un membre du serveur t'a envoyé."
          label="Code d'invitation"
          placeholder="ABCD-EFGH"
          confirmLabel="Rejoindre"
          maxLength={9}
          transform={(v) => v.toUpperCase()}
          onClose={() => setDialog(null)}
          onSubmit={async (code) => {
            const s = await api.acceptInvite(code);
            await loadServers();
            setActiveId(s.id);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "invite" && (
        <InviteDialog api={api} server={dialog.server} canInviteGuests={dialog.guests} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === "manage" && session.kind === "user" && (
        <ManageServerDialog
          api={api}
          server={dialog.server}
          myId={session.user.id}
          onClose={() => setDialog(null)}
          onChanged={() => {
            loadServers();
            loadDetail();
          }}
          onGone={async () => {
            if (voice?.serverId === dialog.server.id) await leaveVoice();
            setDialog(null);
            const list = await loadServers();
            setActiveId(list?.[0]?.id ?? null);
          }}
        />
      )}

      {dialog?.kind === "addRoom" && (
        <PromptDialog
          title="Nouveau salon vocal"
          label="Nom du salon"
          placeholder="Valorant"
          confirmLabel="Créer"
          maxLength={32}
          onClose={() => setDialog(null)}
          onSubmit={async (label) => {
            await api.createRoom(dialog.serverId, label);
            await loadDetail();
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "renameRoom" && (
        <PromptDialog
          title="Renommer le salon"
          label="Nom du salon"
          initial={dialog.room.label}
          confirmLabel="Enregistrer"
          maxLength={32}
          onClose={() => setDialog(null)}
          onSubmit={async (label) => {
            await api.renameRoom(dialog.room.id, label);
            await loadDetail();
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "deleteRoom" && (
        <ConfirmDialog
          title={`Supprimer « ${dialog.room.label} » ?`}
          message="Les personnes connectées dans ce salon seront déconnectées."
          confirmLabel="Supprimer"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (voice?.roomId === dialog.room.id) await leaveVoice();
            await api.deleteRoom(dialog.room.id);
            await loadDetail();
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
