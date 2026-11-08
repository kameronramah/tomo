import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import {
  Api,
  type Channel,
  type DmSummary,
  type Friend,
  type Message,
  type RoomInfo,
  type ServerDetail,
  type ServerSummary,
  type Session,
} from "./lib/api";
import { Realtime, type RealtimeEvent } from "./lib/realtime";
import { getSettings, loadInstance, loadLastServer, normalizeInstance, onSettingsChange, saveInstance, saveLastServer } from "./lib/prefs";
import { connectVoice, joinRoom, setDeafened as applyDeafen } from "./lib/voice";
import { playSound, startRinging } from "./lib/sounds";
import { errorMessage } from "./lib/ui";
import { removeAllBots, setLoopback } from "./lib/dev";
import AuthScreen from "./components/AuthScreen";
import Sidebar, { type DmView, type Mode, type ServerView } from "./components/Sidebar";
import Stage from "./components/Stage";
import ChatView from "./components/ChatView";
import FriendsView from "./components/FriendsView";
import Settings from "./components/Settings";
import IncomingCall from "./components/IncomingCall";
import DevPanel from "./components/DevPanel";
import { ServerHome, Welcome } from "./components/Home";
import { ConfirmDialog, InviteDialog, ManageServerDialog, PromptDialog } from "./components/Dialogs";
import { Avatar, Icon, Logo } from "./components/Brand";
import "./App.css";

type Voice = {
  room: Room;
  kind: "room" | "call";
  serverId: string | null;
  serverName: string;
  roomId: string;
  roomLabel: string;
  warning?: string;
  callId?: string;
  peer?: { id: string; name: string };
};

type Dialog =
  | { kind: "createServer" }
  | { kind: "joinServer" }
  | { kind: "invite"; server: { id: string; name: string }; guests: boolean }
  | { kind: "manage"; server: ServerSummary }
  | { kind: "addRoom"; serverId: string }
  | { kind: "renameRoom"; room: RoomInfo }
  | { kind: "deleteRoom"; room: RoomInfo }
  | { kind: "addChannel"; serverId: string }
  | { kind: "renameChannel"; channel: Channel }
  | { kind: "deleteChannel"; channel: Channel };

const SERVERS_POLL_MS = 10_000;
const DETAIL_POLL_MS = 3_000;

const dmKey = (myId: string, m: Message) => `dm:${m.target.split(":").find((id) => id !== myId)}`;
const dmTarget = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export default function App() {
  const [api, setApi] = useState(() => new Api(loadInstance()));
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string>();
  const [realtime, setRealtime] = useState<Realtime | null>(null);

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(loadLastServer);
  const [detail, setDetail] = useState<ServerDetail | null>(null);

  const [mode, setMode] = useState<Mode>("servers");
  const [serverView, setServerView] = useState<ServerView>({ type: "home" });
  const [dmView, setDmView] = useState<DmView>({ type: "friends" });
  const [friends, setFriends] = useState<Friend[]>([]);
  const [dms, setDms] = useState<DmSummary[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});

  const [voice, setVoice] = useState<Voice | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const [incoming, setIncoming] = useState<{ callId: string; from: { id: string; name: string } } | null>(null);
  const [callRinging, setCallRinging] = useState(false); // appel sortant pas encore décroché

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<{ text: string; ok?: boolean }>();
  const [devOpen, setDevOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const voiceRef = useRef<Voice | null>(null);
  voiceRef.current = voice;
  const stopRingRef = useRef<(() => void) | null>(null);

  const myId = session?.kind === "user" ? session.user.id : session?.kind === "guest" ? session.guest.id : "";
  const showError = useCallback((err: unknown) => setToast({ text: errorMessage(err) }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Apparence (zoom, compact, animations) --------------------------------
  useEffect(() => {
    const apply = () => {
      const a = getSettings().appearance;
      (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(a.zoom);
      document.documentElement.classList.toggle("compact", a.compact);
      document.documentElement.classList.toggle("reduce-motion", a.reducedMotion);
    };
    apply();
    return onSettingsChange(apply);
  }, []);

  // ---- Session ---------------------------------------------------------------
  const stopRinging = () => {
    stopRingRef.current?.();
    stopRingRef.current = null;
  };

  const endSession = useCallback(async (message?: string) => {
    const v = voiceRef.current;
    setVoice(null);
    await v?.room.disconnect();
    await removeAllBots();
    await setLoopback(false);
    stopRinging();
    setIncoming(null);
    setDevOpen(false);
    setSettingsOpen(false);
    setSession(null);
    setServers([]);
    setDetail(null);
    setFriends([]);
    setDms([]);
    setUnread({});
    setMode("servers");
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

  // ---- Temps réel -------------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    const rt = new Realtime(api);
    setRealtime(rt);
    rt.start();
    return () => {
      rt.stop();
      setRealtime(null);
    };
  }, [session, api]);

  // ---- Serveurs ------------------------------------------------------------------
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

  // Changer de serveur : on revient à son accueil (ou à son salon vocal si on y est).
  function selectServer(id: string) {
    setActiveId(id);
    setMode("servers");
    setServerView({ type: voiceRef.current?.serverId === id ? "voice" : "home" });
  }

  // ---- Amis et messages privés ---------------------------------------------------
  const loadFriends = useCallback(async () => {
    if (session?.kind !== "user") return;
    try {
      const [f, d] = await Promise.all([api.friends(), api.dmList()]);
      setFriends(f);
      setDms(d);
    } catch {
      // réessayé au prochain événement
    }
  }, [api, session]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  const dmOrder = useMemo(() => {
    const last = new Map(dms.map((d) => [d.userId, d.lastMessageAt]));
    return friends
      .filter((f) => f.status === "friend")
      .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0) || a.username.localeCompare(b.username))
      .map((f) => f.id);
  }, [friends, dms]);

  // ---- Ce que l'utilisateur regarde (pour les non-lus) ---------------------------
  const stageVisible =
    !!voice &&
    ((voice.kind === "room" && mode === "servers" && voice.serverId === detail?.id && serverView.type !== "channel") ||
      (voice.kind === "call" && mode === "messages" && dmView.type === "call"));

  const viewingKey =
    mode === "servers" && serverView.type === "channel"
      ? `channel:${serverView.id}`
      : mode === "messages" && dmView.type === "dm"
        ? `dm:${dmView.userId}`
        : stageVisible && chatOpen && voice?.kind === "room"
          ? `room:${voice.roomId}`
          : null;
  const viewingRef = useRef(viewingKey);
  viewingRef.current = viewingKey;

  useEffect(() => {
    if (viewingKey && unread[viewingKey]) setUnread((u) => ({ ...u, [viewingKey]: 0 }));
  }, [viewingKey, unread]);

  // ---- Événements temps réel -----------------------------------------------------
  const handleEvent = useCallback(
    (e: RealtimeEvent) => {
      switch (e.type) {
        case "message": {
          const m = e.message as Message;
          if (m.authorId === myId) return;
          const key = m.scope === "dm" ? dmKey(myId, m) : `${m.scope}:${m.target}`;
          if (m.scope === "dm") {
            setDms((list) => {
              const other = key.slice(3);
              return [{ userId: other, lastMessageAt: m.createdAt }, ...list.filter((d) => d.userId !== other)];
            });
          }
          if (viewingRef.current === key) return;
          setUnread((u) => ({ ...u, [key]: (u[key] ?? 0) + 1 }));
          if (m.scope === "dm") playSound("message");
          return;
        }
        case "channels":
          if (e.serverId === activeId || e.serverId === detail?.id) loadDetail();
          return;
        case "friends":
          loadFriends();
          if (e.request) {
            setToast({ text: `${e.request.from} veut être ton ami`, ok: true });
            playSound("message");
          }
          if (e.accepted) setToast({ text: `${e.accepted.by} a accepté ta demande d'ami 🎉`, ok: true });
          return;
        case "presence":
          setFriends((list) => list.map((f) => (f.id === e.userId ? { ...f, online: e.online } : f)));
          return;
        case "callIncoming":
          setIncoming({ callId: e.callId, from: e.from });
          stopRinging();
          stopRingRef.current = startRinging();
          return;
        case "callAccepted":
          if (voiceRef.current?.callId === e.callId) {
            stopRinging();
            setCallRinging(false);
            playSound("join");
          }
          return;
        case "callEnded": {
          setIncoming((c) => (c?.callId === e.callId ? null : c));
          stopRinging();
          setCallRinging(false);
          const v = voiceRef.current;
          if (v && v.callId === e.callId) {
            setVoice(null);
            v.room.disconnect();
            playSound("callEnd");
            const reason = e.reason as string;
            if (reason === "declined") setToast({ text: `${v.peer?.name} n'a pas décroché.` });
            else if (reason === "missed") setToast({ text: `Pas de réponse de ${v.peer?.name}.` });
            else setToast({ text: "Appel terminé.", ok: true });
            setDmView(v.peer ? { type: "dm", userId: v.peer.id } : { type: "friends" });
          } else if (e.reason === "cancelled" || e.reason === "missed") {
            playSound("callEnd");
          }
          return;
        }
      }
    },
    [myId, activeId, detail?.id, loadDetail, loadFriends],
  );

  useEffect(() => {
    if (!realtime) return;
    return realtime.on(handleEvent);
  }, [realtime, handleEvent]);

  // ---- Raccourcis clavier -------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      if (e.shiftKey && e.key.toLowerCase() === "m" && voiceRef.current) {
        e.preventDefault();
        toggleMic();
      } else if (e.shiftKey && e.key.toLowerCase() === "d" && voiceRef.current) {
        e.preventDefault();
        toggleDeafen();
      } else if (!e.shiftKey && e.key === "," && session?.kind === "user") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (!e.shiftKey) {
        const n = Number(e.key);
        if (n >= 1 && n <= 9 && servers[n - 1]) {
          e.preventDefault();
          selectServer(servers[n - 1].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Vocal ---------------------------------------------------------------------
  useEffect(() => {
    if (!voice) {
      setSpeaking(new Set());
      return;
    }
    const room = voice.room;
    const onSpeakers = () => setSpeaking(new Set(room.activeSpeakers.map((p) => p.identity)));
    const onDisconnected = () => setVoice((v) => (v?.room === room ? null : v));
    const onJoin = () => playSound("userJoin");
    const onLeave = () => playSound("userLeave");
    room
      .on(RoomEvent.ActiveSpeakersChanged, onSpeakers)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.ParticipantConnected, onJoin)
      .on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      room
        .off(RoomEvent.ActiveSpeakersChanged, onSpeakers)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.ParticipantConnected, onJoin)
        .off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [voice]);

  /** Quitte la connexion vocale actuelle (salon ou appel), sans son. */
  async function disconnectVoice() {
    const v = voiceRef.current;
    if (!v) return;
    setVoice(null);
    if (v.kind === "call" && v.callId) api.endCall(v.callId).catch(() => {});
    await v.room.disconnect();
    await removeAllBots();
    setCallRinging(false);
    stopRinging();
  }

  async function enterRoom(room: RoomInfo) {
    if (!active || !detail) return;
    setMode("servers");
    setServerView({ type: "voice" });
    if (voice?.kind === "room" && voice.roomId === room.id) return;
    setJoiningRoomId(room.id);
    try {
      await disconnectVoice();
      const joined = await joinRoom(api, room.id, { micEnabled: micOn && !deafened });
      applyDeafen(joined.room, deafened);
      if (joined.warning) setMicOn(false);
      setVoice({
        room: joined.room,
        kind: "room",
        serverId: detail.id,
        serverName: detail.name,
        roomId: room.id,
        roomLabel: room.label,
        warning: joined.warning,
      });
      setChatOpen(false);
      playSound("join");
      loadDetail();
    } catch (err) {
      showError(err);
    } finally {
      setJoiningRoomId(undefined);
    }
  }

  async function leaveVoice() {
    const wasCall = voiceRef.current?.kind === "call";
    await disconnectVoice();
    playSound(wasCall ? "callEnd" : "leave");
    loadDetail();
  }

  async function toggleMic() {
    const next = !micOn;
    try {
      await voiceRef.current?.room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      playSound(next ? "unmute" : "mute");
      if (next && deafened) {
        setDeafened(false);
        applyDeafen(voiceRef.current?.room ?? null, false);
      }
    } catch {
      showError("Impossible d'activer le micro. Vérifie l'autorisation du micro.");
    }
  }

  async function toggleDeafen() {
    const next = !deafened;
    setDeafened(next);
    applyDeafen(voiceRef.current?.room ?? null, next);
    playSound(next ? "deafen" : "undeafen");
    if (next && micOn) {
      await voiceRef.current?.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
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

  // ---- Appels privés ---------------------------------------------------------------
  async function callFriend(f: Friend) {
    try {
      await disconnectVoice();
      const info = await api.startCall(f.id);
      const joined = await connectVoice(info.url, info.token, { micEnabled: micOn && !deafened });
      if (joined.warning) setMicOn(false);
      setVoice({
        room: joined.room,
        kind: "call",
        serverId: null,
        serverName: "Appel privé",
        roomId: info.callId,
        roomLabel: `Appel avec ${info.with.name}`,
        warning: joined.warning,
        callId: info.callId,
        peer: info.with,
      });
      setCallRinging(true);
      setMode("messages");
      setDmView({ type: "call" });
      stopRinging();
      stopRingRef.current = startRinging();
    } catch (err) {
      showError(err);
    }
  }

  async function acceptCall() {
    if (!incoming) return;
    const callId = incoming.callId;
    stopRinging();
    setIncoming(null);
    try {
      await disconnectVoice();
      const info = await api.acceptCall(callId);
      const joined = await connectVoice(info.url, info.token, { micEnabled: micOn && !deafened });
      if (joined.warning) setMicOn(false);
      setVoice({
        room: joined.room,
        kind: "call",
        serverId: null,
        serverName: "Appel privé",
        roomId: callId,
        roomLabel: `Appel avec ${info.with.name}`,
        warning: joined.warning,
        callId,
        peer: info.with,
      });
      setMode("messages");
      setDmView({ type: "call" });
      playSound("join");
    } catch (err) {
      showError(err);
    }
  }

  function declineCall() {
    if (!incoming) return;
    stopRinging();
    api.declineCall(incoming.callId).catch(() => {});
    setIncoming(null);
  }

  function goToVoice() {
    if (!voice) return;
    if (voice.kind === "call") {
      setMode("messages");
      setDmView({ type: "call" });
    } else if (voice.serverId) {
      setActiveId(voice.serverId);
      setMode("servers");
      setServerView({ type: "voice" });
    }
  }

  // ---- Rendu -------------------------------------------------------------------------
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
  const voiceRoomInfo = voice?.kind === "room" ? detail?.rooms.find((r) => r.id === voice.roomId) : undefined;
  const openInvite = () => active && setDialog({ kind: "invite", server: active, guests: isManager });
  const openChannel = serverView.type === "channel" ? detail?.channels.find((c) => c.id === serverView.id) : undefined;
  const dmFriend = dmView.type === "dm" ? friends.find((f) => f.id === dmView.userId) : undefined;

  // ---- Zone principale ----
  let main: React.ReactNode;
  if (stageVisible && voice) {
    main = (
      <Stage
        key={voice.room.name}
        room={voice.room}
        roomLabel={voice.kind === "room" ? (voiceRoomInfo?.label ?? voice.roomLabel) : voice.roomLabel}
        serverName={voice.kind === "call" ? (callRinging ? "Ça sonne…" : "Appel privé") : voice.serverName}
        spatial={voiceRoomInfo?.spatial ?? false}
        warning={voice.warning}
        micOn={micOn}
        deafened={deafened}
        isCall={voice.kind === "call"}
        canToggleSpatial={!isGuest}
        canInvite={!isGuest && voice.kind === "room"}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onToggleSpatial={toggleSpatial}
        onInvite={openInvite}
        onLeave={leaveVoice}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
        chatUnread={voice.kind === "room" ? unread[`room:${voice.roomId}`] : undefined}
        chat={
          voice.kind === "room" ? (
            <ChatView
              api={api}
              realtime={realtime}
              scope="room"
              target={voice.roomId}
              myId={myId}
              canModerate={isManager}
              placeholder={`Écrire dans ${voiceRoomInfo?.label ?? voice.roomLabel}`}
              emptyText="Le chat du salon : liens, infos de partie… Les messages restent pour les prochaines fois."
              compact
              header={
                <header className="chat-header compact">
                  <Icon name="chat" size={16} /> <strong>Chat du salon</strong>
                </header>
              }
            />
          ) : undefined
        }
      />
    );
  } else if (mode === "messages") {
    main =
      dmView.type === "dm" && dmFriend ? (
        <ChatView
          key={dmFriend.id}
          api={api}
          realtime={realtime}
          scope="dm"
          target={dmFriend.id}
          storedTarget={dmTarget(myId, dmFriend.id)}
          myId={myId}
          placeholder={`Écrire à ${dmFriend.username}`}
          emptyText={`C'est le début de ta conversation avec ${dmFriend.username}.`}
          header={
            <header className="chat-header">
              <span className="avatar-wrap">
                <Avatar name={dmFriend.username} size={32} />
                <span className={`status-dot sm${dmFriend.online ? "" : " off"}`} />
              </span>
              <span className="grow col gap-2">
                <strong>{dmFriend.username}</strong>
                <span className="muted small">{dmFriend.online ? "En ligne" : "Hors ligne"}</span>
              </span>
              {voice?.kind === "call" && voice.peer?.id === dmFriend.id ? (
                <button className="btn pill active" onClick={goToVoice}>
                  <Icon name="phone" size={16} /> Retour à l'appel
                </button>
              ) : (
                <button className="btn pill" onClick={() => callFriend(dmFriend)} disabled={!dmFriend.online} title={dmFriend.online ? "Appeler" : "Hors ligne"}>
                  <Icon name="phone" size={16} /> Appeler
                </button>
              )}
            </header>
          }
        />
      ) : (
        <FriendsView
          api={api}
          friends={friends}
          onChanged={loadFriends}
          onMessage={(f) => setDmView({ type: "dm", userId: f.id })}
          onCall={callFriend}
        />
      );
  } else if (openChannel && detail) {
    main = (
      <ChatView
        key={openChannel.id}
        api={api}
        realtime={realtime}
        scope="channel"
        target={openChannel.id}
        myId={myId}
        canModerate={isManager}
        placeholder={`Écrire dans #${openChannel.name}`}
        emptyText={`Bienvenue dans #${openChannel.name} ! Lance la conversation.`}
        header={
          <header className="chat-header">
            <span className="muted">
              <Icon name="hash" size={20} />
            </span>
            <strong className="grow">{openChannel.name}</strong>
            <span className="muted small">{detail.name}</span>
          </header>
        }
      />
    );
  } else if (detail) {
    main = (
      <ServerHome
        name={displayName}
        detail={detail}
        canInvite={!isGuest}
        joiningRoomId={joiningRoomId}
        onJoin={enterRoom}
        onInvite={openInvite}
      />
    );
  } else if (servers.length === 0 && !isGuest) {
    main = <Welcome name={displayName} onCreate={() => setDialog({ kind: "createServer" })} onJoin={() => setDialog({ kind: "joinServer" })} />;
  } else {
    main = (
      <div className="splash inline">
        <Logo size={40} cut="var(--bg)" />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        session={session}
        displayName={displayName}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          if (m === "messages" && dmView.type === "call" && voice?.kind !== "call") setDmView({ type: "friends" });
        }}
        unread={unread}
        servers={servers}
        active={active}
        detail={detail}
        serverView={serverView}
        joiningRoomId={joiningRoomId}
        onSelectServer={selectServer}
        onCreateServer={() => setDialog({ kind: "createServer" })}
        onJoinServer={() => setDialog({ kind: "joinServer" })}
        onManageServer={() => active && setDialog({ kind: "manage", server: active })}
        onJoinRoom={enterRoom}
        onAddRoom={() => active && setDialog({ kind: "addRoom", serverId: active.id })}
        onRenameRoom={(room) => setDialog({ kind: "renameRoom", room })}
        onDeleteRoom={(room) => setDialog({ kind: "deleteRoom", room })}
        onOpenChannel={(c) => {
          setMode("servers");
          setServerView({ type: "channel", id: c.id });
        }}
        onAddChannel={() => active && setDialog({ kind: "addChannel", serverId: active.id })}
        onRenameChannel={(channel) => setDialog({ kind: "renameChannel", channel })}
        onDeleteChannel={(channel) => setDialog({ kind: "deleteChannel", channel })}
        friends={friends}
        dmOrder={dmOrder}
        dmView={dmView}
        onOpenFriends={() => setDmView({ type: "friends" })}
        onOpenDm={(userId) => setDmView({ type: "dm", userId })}
        voice={
          voice
            ? {
                kind: voice.kind,
                serverId: voice.serverId,
                serverName: voice.serverName,
                roomId: voice.roomId,
                roomLabel: voice.roomLabel,
                identity: voice.room.localParticipant.identity,
                speaking,
                room: voice.room,
              }
            : null
        }
        micOn={micOn}
        deafened={deafened}
        onGoToVoice={goToVoice}
        onToggleMic={toggleMic}
        onToggleDeafen={toggleDeafen}
        onLeaveVoice={leaveVoice}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={logout}
        onOpenDev={session.kind === "user" && session.user.isDev ? () => setDevOpen(!devOpen) : undefined}
      />

      <main className="content">{main}</main>

      {devOpen && session.kind === "user" && session.user.isDev && (
        <DevPanel
          api={api}
          user={session.user}
          room={voice?.room ?? null}
          roomId={voice?.kind === "room" ? voice.roomId : undefined}
          roomLabel={voice?.roomLabel}
          server={active}
          onChanged={() => {
            loadServers();
            loadDetail();
          }}
          onClose={() => setDevOpen(false)}
        />
      )}

      {settingsOpen && session.kind === "user" && (
        <Settings
          api={api}
          user={session.user}
          realtime={realtime}
          voiceRoom={voice?.room ?? null}
          onLogout={logout}
          onLogoutAll={logoutAll}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {incoming && <IncomingCall from={incoming.from.name} onAccept={acceptCall} onDecline={declineCall} />}

      {toast && (
        <div className={`toast${toast.ok ? " ok" : ""}`} role="alert" onClick={() => setToast(undefined)}>
          {toast.text}
        </div>
      )}

      {dialog?.kind === "createServer" && (
        <PromptDialog
          title="Créer un serveur"
          subtitle="Tu en seras l'admin. Un salon textuel « général » et un salon vocal « Général » sont créés pour toi."
          label="Nom du serveur"
          placeholder="Les potes"
          confirmLabel="Créer"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const s = await api.createServer(name);
            await loadServers();
            selectServer(s.id);
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
            selectServer(s.id);
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
            setServerView({ type: "home" });
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

      {dialog?.kind === "addChannel" && (
        <PromptDialog
          title="Nouveau salon textuel"
          label="Nom du salon"
          placeholder="mèmes"
          confirmLabel="Créer"
          maxLength={32}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const c = await api.createChannel(dialog.serverId, name);
            await loadDetail();
            setServerView({ type: "channel", id: c.id });
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "renameChannel" && (
        <PromptDialog
          title="Renommer le salon textuel"
          label="Nom du salon"
          initial={dialog.channel.name}
          confirmLabel="Enregistrer"
          maxLength={32}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api.renameChannel(dialog.channel.id, name);
            await loadDetail();
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "deleteChannel" && (
        <ConfirmDialog
          title={`Supprimer #${dialog.channel.name} ?`}
          message="Tous les messages de ce salon seront supprimés définitivement."
          confirmLabel="Supprimer"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteChannel(dialog.channel.id);
            if (serverView.type === "channel" && serverView.id === dialog.channel.id) setServerView({ type: "home" });
            await loadDetail();
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
