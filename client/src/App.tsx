import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import {
  Api,
  type Channel,
  type ChosenStatus,
  type DmSummary,
  type MyProfile,
  type Friend,
  type Message,
  type RoomInfo,
  type ServerDetail,
  type ServerSummary,
  type Session,
} from "./lib/api";
import { Realtime, type RealtimeEvent } from "./lib/realtime";
import { getSettings, loadInstance, loadLastServer, normalizeInstance, onSettingsChange, saveInstance, saveLastServer } from "./lib/prefs";
import { connectVoice, getRecorder, getSpatial, joinRoom, setDeafened as applyDeafen } from "./lib/voice";
import { clipFileName, clipsSupported, encodeWav, openClipsFolder, saveClip } from "./lib/clips";
import { playSound, setQuietMode, startRinging } from "./lib/sounds";
import { putPeople, setPeopleApi, watchPeople } from "./lib/people";
import { applyStartupMinimize, inQuietHours, inTauri, notify } from "./lib/desktop";
import { updateAtLaunch } from "./lib/updater";
import { currentGame, gamePrefs, onGame, publicGame, startGameWatch, type RunningGame } from "./lib/games";
import GameCard from "./components/GameCard";
import { overlayChat, startOverlay, toggleOverlayHidden } from "./lib/overlay";
import { startHotkeys } from "./lib/hotkeys";
import { setPttHeld } from "./lib/ptt";
import { getCaptions, startCaptions, stopCaptions } from "./lib/captions";
import { startCoachScreen } from "./lib/coachScreen";
import LegendsView from "./components/LegendsView";
import ChallengesView from "./components/ChallengesView";
import UpdateCard from "./components/UpdateCard";
import { flashIcon, setAppBadge } from "./lib/badge";
import { mentionsMe } from "./components/MessageParts";
import ProfileCard from "./components/ProfileCard";
import { EmailGate } from "./components/EmailAccount";
import { speakingDetector } from "./lib/speaking";
import { errorMessage } from "./lib/ui";
import { useMedia } from "./lib/useMedia";
import { removeAllBots, setLoopback } from "./lib/dev";
import AuthScreen from "./components/AuthScreen";
import ServerRail, { type Mode } from "./components/ServerRail";
import MessagesView, { RequestsView, type DmView } from "./components/MessagesView";
import DmPanel from "./components/DmPanel";
import MemberList, { useServerPeople } from "./components/MemberList";
import ServerPlan from "./components/ServerPlan";
import VoiceIsland from "./components/VoiceIsland";
import { NetworkBadge } from "./components/Brand";

/** focus : message à montrer en arrivant (résultat de recherche). */
type MessageFocus = { id: string; at: number };
type ServerView = { type: "home" } | { type: "voice" } | { type: "channel"; id: string; focus?: MessageFocus } | { type: "legends" } | { type: "challenges" };
import Stage from "./components/Stage";
import ChatView from "./components/ChatView";
import ServerSearch from "./components/ServerSearch";
import type { SearchHit } from "./lib/api";
import FriendsView from "./components/FriendsView";
import Settings from "./components/Settings";
import IncomingCall from "./components/IncomingCall";
import DevPanel from "./components/DevPanel";
import { ServerHome, Welcome } from "./components/Home";
import { ConfirmDialog, InviteDialog, ManageServerDialog, PromptDialog } from "./components/Dialogs";
import { Icon, Logo } from "./components/Brand";
import { t } from "./lib/i18n";
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
  const dmsRef = useRef<DmSummary[]>([]);
  dmsRef.current = dms;

  const [voice, setVoice] = useState<Voice | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  /** Recherche dans le serveur ouvert (membres + messages). */
  const [searchOpen, setSearchOpen] = useState(false);
  /** Message du chat de la pièce à montrer (résultat de recherche). */
  const [roomFocus, setRoomFocus] = useState<MessageFocus | undefined>();
  const [incoming, setIncoming] = useState<{ callId: string; from: { id: string; name: string } } | null>(null);
  const [callRinging, setCallRinging] = useState(false); // appel sortant pas encore décroché

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<{ text: string; ok?: boolean; action?: { label: string; run: () => void } }>();
  const [devOpen, setDevOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>();
  // Bloc « Membres » à droite d'un vocal ou d'un fil (fermé par défaut, choix retenu)
  const [membersOpen, setMembersOpenState] = useState(() => {
    try {
      return localStorage.getItem("tomo.membersOpen") === "1";
    } catch {
      return false;
    }
  });
  const toggleMembers = () => {
    const v = !membersOpen;
    setMembersOpenState(v);
    try {
      localStorage.setItem("tomo.membersOpen", v ? "1" : "0");
    } catch {
      // pas de mémoire : tant pis
    }
  };
  const [planCollapsed, setPlanCollapsedState] = useState(() => {
    try {
      return localStorage.getItem("tomo.planCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const setPlanCollapsed = (v: boolean) => {
    setPlanCollapsedState(v);
    try {
      localStorage.setItem("tomo.planCollapsed", v ? "1" : "0");
    } catch {
      // pas de mémoire : tant pis
    }
  };
  // Fenêtre étroite : le plan se replie tout seul ; on peut l'ouvrir par-dessus le reste (planPeek).
  const smallWindow = useMedia("(max-width: 900px)");
  const mediumWindow = useMedia("(max-width: 1100px)");
  const wideWindow = !useMedia("(max-width: 1500px)");
  const [planPeek, setPlanPeek] = useState(false);

  const voiceRef = useRef<Voice | null>(null);
  voiceRef.current = voice;
  const stopRingRef = useRef<(() => void) | null>(null);

  const myId = session?.kind === "user" ? session.user.id : session?.kind === "guest" ? session.guest.id : "";
  const showError = useCallback((err: unknown) => setToast({ text: errorMessage(err) }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), toast.action ? 9000 : 5000);
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

  // Mise à jour imposée au lancement (appli de bureau). Pas de réseau / GitHub injoignable : on entre quand même.
  const [launchChecked, setLaunchChecked] = useState(!inTauri);
  const [launchUpdate, setLaunchUpdate] = useState<{ version: string; progress: number } | null>(null);
  useEffect(() => {
    if (launchChecked) return;
    void updateAtLaunch((version, progress) => setLaunchUpdate({ version, progress })).then((installing) => {
      if (!installing) setLaunchChecked(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le serveur sait-il envoyer des e-mails ? (sinon, pas d'étape de vérification d'adresse)
  const [mailOn, setMailOn] = useState(true);
  useEffect(() => {
    api.authConfig().then((c) => setMailOn(c.mail !== false)).catch(() => {});
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
    setPeopleApi(api);
    const offPeople = watchPeople(rt);
    rt.start();
    // Jeu lancé → « joue à … » pour les potes (si on l'autorise)
    const stopGames = startGameWatch();
    const sendGame = () => rt.setGame(publicGame(currentGame()));
    const offGame = onGame(sendGame);
    const offGameSettings = onSettingsChange(sendGame);
    return () => {
      offGame();
      offGameSettings();
      stopGames();
      offPeople();
      rt.stop();
      setRealtime(null);
      setPeopleApi(null);
    };
  }, [session, api]);

  // ---- Mon profil (photo, statut, confidentialité) ---------------------------------
  const [me, setMe] = useState<MyProfile | null>(null);
  const loadMe = useCallback(async () => {
    if (session?.kind !== "user") return setMe(null);
    try {
      const p = await api.myProfile();
      setMe(p);
      putPeople([p]);
    } catch {
      // réessayé au prochain changement
    }
  }, [api, session]);
  useEffect(() => void loadMe(), [loadMe]);
  // « Ne pas déranger » ou heures calmes : plus de sons de messages ni d'appels, plus de notifications
  useEffect(() => {
    const apply = () => setQuietMode(me?.chosenStatus === "dnd" || inQuietHours());
    apply();
    const t = setInterval(apply, 60_000);
    const off = onSettingsChange(apply);
    return () => (clearInterval(t), off());
  }, [me?.chosenStatus]);
  // Lancé avec l'ordinateur : démarrer réduit si demandé
  useEffect(() => void applyStartupMinimize(), []);
  const [profileId, setProfileId] = useState<string | null>(null);

  async function changeStatus(p: { status?: ChosenStatus; customStatus?: string | null; customStatusUntil?: number | null }) {
    try {
      await api.setStatus(p);
      await loadMe();
    } catch (err) {
      showError(err);
    }
  }

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
    setServerView({ type: "home" });
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

  /** Conversations : amis + non-amis déjà acceptés (les demandes sont à part). */
  const dmOrder = useMemo(() => {
    const last = new Map(dms.map((d) => [d.userId, d.lastMessageAt]));
    const ids = new Set(friends.filter((f) => f.status === "friend").map((f) => f.id));
    for (const d of dms) if (!d.request && !d.ignored) ids.add(d.userId);
    return [...ids].sort((a, b) => (last.get(b) ?? 0) - (last.get(a) ?? 0));
  }, [friends, dms]);
  const dmRequests = useMemo(() => dms.filter((d) => d.request && !d.ignored), [dms]);
  useEffect(() => putPeople(dms.flatMap((d) => (d.profile ? [d.profile] : []))), [dms]);

  /** Ce qui t'attend vraiment : messages privés non lus + demandes (ami, message). */
  const messagesBadge =
    dmOrder.reduce((n, id) => n + (unread[`dm:${id}`] ?? 0), 0) +
    friends.filter((f) => f.status === "incoming").length +
    dmRequests.length;
  /** Mentions non lues (@toi, @tous, @vocal) par fil / pièce. */
  const [mentions, setMentions] = useState<Record<string, number>>({});
  const mentionTotal = Object.values(mentions).reduce((a, b) => a + b, 0);
  useEffect(() => void setAppBadge(messagesBadge + mentionTotal), [messagesBadge, mentionTotal]);

  /** Membres du serveur ouvert (pour proposer les @mentions). */
  const serverPeople = useServerPeople(api, realtime, detail?.id);
  // Changer de serveur ferme sa recherche
  useEffect(() => setSearchOpen(false), [detail?.id]);
  const mentionables = useMemo(
    () =>
      serverPeople
        .filter((p) => !p.guest)
        .sort((a, b) => Number(!!b.room) - Number(!!a.room) || a.displayName.localeCompare(b.displayName))
        .map((p) => ({ id: p.id, name: p.displayName, hint: p.room ? t("en vocal") : p.status === "offline" ? t("hors ligne") : undefined })),
    [serverPeople],
  );

  // ---- Overlay en jeu : actif tant que je suis en vocal ----------------------------
  const voiceRoom = voice?.room;
  const voiceLabelRef = useRef("");
  voiceLabelRef.current = voice ? voice.roomLabel : "";
  useEffect(() => (voiceRoom ? startOverlay(voiceRoom, () => voiceLabelRef.current) : undefined), [voiceRoom]);
  // Mode coach : les annotations des potes s'affichent sur mon écran quand je le partage
  useEffect(() => (voiceRoom ? startCoachScreen(voiceRoom) : undefined), [voiceRoom]);

  /** Épingler un message au mur des légendes du serveur. */
  async function pinLegend(serverId: string, messageId: string) {
    try {
      await api.pinLegend(serverId, messageId);
      setToast({ text: t("Épinglé au mur des légendes."), ok: true });
    } catch (err) {
      showError(err);
    }
  }

  // ---- Jeu lancé : pièce automatique et proposition de rejoindre les potes ----------
  const [game, setGame] = useState<RunningGame | null>(null);
  useEffect(() => onGame(setGame), []);
  const autoJoinRef = useRef<{ serverId: string; roomId: string } | null>(null);
  useEffect(() => {
    if (!game || voiceRef.current) return;
    const auto = gamePrefs(game.id).autoRoom;
    if (auto && servers.some((s) => s.id === auto.serverId)) {
      autoJoinRef.current = { serverId: auto.serverId, roomId: auto.roomId };
      if (activeId !== auto.serverId) selectServer(auto.serverId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);
  useEffect(() => {
    const want = autoJoinRef.current;
    if (!want || !detail || detail.id !== want.serverId) return;
    autoJoinRef.current = null;
    const room = detail.rooms.find((r) => r.id === want.roomId);
    if (room && !voiceRef.current) void enterRoom(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  /** Potes en vocal dans ce serveur qui jouent au même jeu que moi. */
  const gameMates = useMemo(
    () => (game ? serverPeople.filter((p) => p.id !== myId && p.room && p.game?.name === game.name) : []),
    [game, serverPeople, myId],
  );

  /** Serveur de chaque clé de non-lus (pour le point gris sur la colonne des serveurs). */
  const keyServerRef = useRef<Record<string, string>>({});
  const serverDots = useMemo(() => {
    const s = new Set<string>();
    for (const [key, n] of Object.entries(unread)) if (n > 0 && keyServerRef.current[key]) s.add(keyServerRef.current[key]);
    return s;
  }, [unread]);

  // ---- Ce que l'utilisateur regarde (pour les non-lus) ---------------------------
  const stageVisible =
    !!voice &&
    ((voice.kind === "room" && mode === "servers" && voice.serverId === detail?.id && serverView.type === "voice") ||
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
    if (viewingKey && mentions[viewingKey]) setMentions((x) => ({ ...x, [viewingKey]: 0 }));
  }, [viewingKey, unread, mentions]);

  // ---- Événements temps réel -----------------------------------------------------
  const handleEvent = useCallback(
    (e: RealtimeEvent) => {
      switch (e.type) {
        case "message": {
          const m = e.message as Message;
          if (m.authorId === myId) return;
          const key = m.scope === "dm" ? dmKey(myId, m) : `${m.scope}:${m.target}`;
          if (m.scope === "dm") {
            const other = key.slice(3);
            // Quelqu'un d'inconnu : on recharge la liste pour savoir si c'est une demande.
            if (!dmsRef.current.some((d) => d.userId === other)) loadFriends();
            setDms((list) => {
              const prev = list.find((d) => d.userId === other);
              return [{ ...prev, userId: other, lastMessageAt: m.createdAt }, ...list.filter((d) => d.userId !== other)];
            });
          }
          if (typeof e.serverId === "string") keyServerRef.current[key] = e.serverId;
          // Chat de la pièce où je suis : affiché aussi dans l'overlay en jeu
          if (m.scope === "room" && voiceRef.current?.kind === "room" && voiceRef.current.roomId === m.target && m.content)
            overlayChat(m.id, m.authorName, m.content);
          // Mention (@toi, @tous, ou @vocal si je suis en vocal dans ce serveur)
          const v = voiceRef.current;
          const inVoiceThere = v?.kind === "room" && v.serverId === e.serverId;
          // Mode focus : pendant un jeu, seuls mes coéquipiers (même pièce vocale) me dérangent.
          const g = currentGame();
          const focused = !!g && gamePrefs(g.id).focus && !(v?.room.remoteParticipants.has(`u:${m.authorId}`) ?? false);
          if (focused) {
            if (viewingRef.current !== key) setUnread((u) => ({ ...u, [key]: (u[key] ?? 0) + 1 }));
            return;
          }
          if (m.scope !== "dm" && mentionsMe(m.content, myId, inVoiceThere)) {
            if (viewingRef.current !== key || !document.hasFocus()) {
              setMentions((x) => ({ ...x, [key]: (x[key] ?? 0) + 1 }));
              playSound("message");
              void flashIcon();
              void notify(`${m.authorName} t'a mentionné`, m.content.replace(/<@[^>]+>/g, "@…"));
            }
          }
          if (viewingRef.current === key && document.hasFocus()) return;
          if (viewingRef.current !== key) setUnread((u) => ({ ...u, [key]: (u[key] ?? 0) + 1 }));
          if (m.scope === "dm") {
            playSound("message");
            void flashIcon();
            const known = dmsRef.current.find((d) => d.userId === key.slice(3));
            if (known?.request) void notify(`Demande de message de ${m.authorName}`, "Ouvre Tomo pour lire et accepter.");
            else void notify(m.authorName, m.content || (m.attachments?.length ? "a envoyé un fichier" : ""));
          }
          return;
        }
        case "channels":
          if (e.serverId === activeId || e.serverId === detail?.id) loadDetail();
          loadServers(); // nom ou image du serveur changés : la colonne de gauche suit
          return;
        case "friends":
          loadFriends();
          if (e.request) {
            setToast({ text: t("{0} veut être ton ami", { 0: e.request.from }), ok: true });
            playSound("message");
            void notify("Demande d'ami", `${e.request.from} veut être ton ami`);
          }
          if (e.accepted) setToast({ text: t("{0} a accepté ta demande d'ami 🎉", { 0: e.accepted.by }), ok: true });
          return;
        case "presence":
          setFriends((list) => list.map((f) => (f.id === e.userId ? { ...f, online: e.online, presence: e.status } : f)));
          return;
        case "profile":
          if (e.userId === myId) loadMe();
          return;
        case "callIncoming":
          setIncoming({ callId: e.callId, from: e.from });
          stopRinging();
          stopRingRef.current = startRinging();
          void notify("Appel entrant", `${e.from.name} t'appelle`);
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
            if (reason === "declined") setToast({ text: t("{0} n'a pas décroché.", { 0: v.peer?.name }) });
            else if (reason === "missed") setToast({ text: t("Pas de réponse de {0}.", { 0: v.peer?.name }) });
            else setToast({ text: t("Appel terminé."), ok: true });
            setDmView(v.peer ? { type: "dm", userId: v.peer.id } : { type: "friends" });
          } else if (e.reason === "cancelled" || e.reason === "missed") {
            playSound("callEnd");
          }
          return;
        }
      }
    },
    [myId, activeId, detail?.id, loadDetail, loadServers, loadFriends, loadMe],
  );

  useEffect(() => {
    if (!realtime) return;
    return realtime.on(handleEvent);
  }, [realtime, handleEvent]);

  // ---- Audio spatial : suit l'interrupteur du salon ---------------------------------
  const spatialFlag = voice?.kind === "room" ? !!detail?.rooms.find((r) => r.id === voice.roomId)?.spatial : false;
  useEffect(() => {
    getSpatial()?.setEnabled(spatialFlag);
  }, [voice, spatialFlag]);

  // ---- Clip des 60 dernières secondes ---------------------------------------------
  async function takeClip() {
    const rec = getRecorder();
    if (!rec) {
      setToast({ text: t("Les clips sont désactivés. Active-les dans Paramètres > Clips.") });
      return;
    }
    if (rec.seconds < 1) {
      setToast({ text: t("Rien à enregistrer pour l'instant : attends quelques secondes.") });
      return;
    }
    const seconds = Math.round(rec.seconds);
    const name = clipFileName(voiceRef.current?.roomLabel ?? "salon");
    try {
      await saveClip(name, encodeWav(rec.snapshot()));
      playSound("clip");
      setToast({
        text: t("Clip enregistré : {0} s.", { 0: seconds }),
        ok: true,
        action: clipsSupported ? { label: t("Ouvrir le dossier"), run: () => openClipsFolder().catch(showError) } : undefined,
      });
    } catch (err) {
      showError(err);
    }
  }

  // ---- Raccourcis clavier -------------------------------------------------------
  // Raccourcis configurables (Paramètres › Raccourcis clavier), qui marchent aussi en jeu.
  useEffect(() => {
    const inVoice = () => !!voiceRef.current;
    void startHotkeys({
      ptt: (down) => setPttHeld(down),
      mute: () => inVoice() && void toggleMic(),
      deafen: () => inVoice() && void toggleDeafen(),
      clip: () => inVoice() && void takeClip(),
      spatial: () => voiceRef.current?.kind === "room" && void toggleSpatial(),
      captions: () => {
        const room = voiceRef.current?.room;
        if (!room) return;
        if (getCaptions()) stopCaptions();
        else startCaptions(room);
      },
      leave: () => inVoice() && void leaveVoice(),
      overlay: () => toggleOverlayHidden(),
      settings: () => session?.kind === "user" && setSettingsOpen(true),
    });
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      if (!e.shiftKey && (e.key === "f" || e.key === "F" || e.key === "k" || e.key === "K") && mode === "servers" && detail && !settingsOpen) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (!e.shiftKey) {
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
    // « Qui parle » mesuré localement (instantané), pas l'info lissée du serveur.
    const detector = speakingDetector(room);
    setSpeaking(new Set(detector.speaking));
    const offSpeaking = detector.onChange((s) => setSpeaking(new Set(s)));
    const onDisconnected = () => setVoice((v) => (v?.room === room ? null : v));
    const onJoin = () => playSound("userJoin");
    const onLeave = () => playSound("userLeave");
    room
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.ParticipantConnected, onJoin)
      .on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      offSpeaking();
      room
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
  async function callFriend(f: { id: string }) {
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

  /** Résultat de recherche : ouvrir le fil (ou le chat de la pièce si j'y suis) sur ce message. */
  function openSearchHit(hit: SearchHit) {
    const focus = { id: hit.id, at: hit.createdAt };
    if (hit.place.kind === "channel") {
      setSearchOpen(false);
      setServerView({ type: "channel", id: hit.place.id, focus });
    } else if (voice?.kind === "room" && voice.roomId === hit.place.id) {
      setSearchOpen(false);
      setRoomFocus(focus);
      setChatOpen(true);
      goToVoice();
    } else {
      setToast({ text: t("Ce message est dans le chat de la pièce {0} : rejoins-la pour voir la discussion.", { 0: hit.place.name }) });
    }
  }

  // ---- Rendu -------------------------------------------------------------------------
  if (!launchChecked) {
    // Appli de bureau : une mise à jour disponible au lancement est installée d'office.
    return (
      <div className="splash">
        <Logo size={56} cut="var(--bg)" />
        {launchUpdate && (
          <div className="col gap-8 center launch-update" role="status">
            <strong>{t("Mise à jour en cours…")}</strong>
            <span className="muted small">{t("Tomo {0} s'installe, puis se relance tout seul.", { 0: launchUpdate.version })}</span>
            <span className="launch-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(launchUpdate.progress * 100)}%` }} />
            </span>
          </div>
        )}
      </div>
    );
  }

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
  const openInvite = () => active && setDialog({ kind: "invite", server: active, guests: true });
  const openChannel = serverView.type === "channel" ? detail?.channels.find((c) => c.id === serverView.id) : undefined;
  const dmFriend = dmView.type === "dm" ? friends.find((f) => f.id === dmView.userId) : undefined;
  // Plan du serveur : visible dans une pièce vocale ou un fil (pas sur l'accueil, qui montre déjà tout)
  const planVisible = mode === "servers" && !!detail && ((stageVisible && voice?.kind === "room") || !!openChannel);
  // Le chat du salon ouvert prend de la place : le plan se replie plus tôt.
  // Chat du salon + bloc Membres ouverts : il faut un grand écran pour garder le plan déplié.
  const planNarrow = smallWindow || (stageVisible && chatOpen && (mediumWindow || (membersOpen && !wideWindow)));
  const planIsCollapsed = planNarrow ? !planPeek : planCollapsed;

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
        onBack={() => (voice.kind === "room" ? setServerView({ type: "home" }) : setDmView({ type: "friends" }))}
        onOpenProfile={setProfileId}
        onClip={takeClip}
        onCapture={
          voice.kind === "room" && !isGuest
            ? async (png) => {
                try {
                  const att = await api.uploadAttachment(png, { name: "coach.png" });
                  await api.sendMessage("room", voice.roomId, "", [att.id]);
                  setToast({ text: t("Image annotée envoyée dans le chat de la pièce."), ok: true });
                } catch (err) {
                  showError(err);
                }
              }
            : undefined
        }
        onNotice={(text) => setToast({ text })}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
        membersOpen={membersOpen}
        onToggleMembers={voice.kind === "room" && planVisible ? toggleMembers : undefined}
        chatUnread={voice.kind === "room" ? unread[`room:${voice.roomId}`] : undefined}
        chat={
          voice.kind === "room" ? (
            <ChatView
              api={api}
              realtime={realtime}
              scope="room"
              target={voice.roomId}
              focus={roomFocus}
              myId={myId}
              canModerate={isManager}
              onOpenProfile={setProfileId}
              mentionables={mentionables}
              inVoiceHere
              onPinLegend={isGuest || !voice.serverId ? undefined : (id) => void pinLegend(voice.serverId!, id)}
              placeholder={t("Écrire dans {0}", { 0: voiceRoomInfo?.label ?? voice.roomLabel })}
              emptyText={t("Le chat du salon : liens, infos de partie… Les messages restent pour les prochaines fois.")}
              compact
              header={
                <header className="chat-header compact">
                  <Icon name="chat" size={16} /> <strong>{t("Chat du salon")}</strong>
                </header>
              }
            />
          ) : undefined
        }
      />
    );
  } else if (mode === "messages") {
    const peerId = dmView.type === "dm" ? dmView.userId : null;
    const peerDm = peerId ? dms.find((d) => d.userId === peerId) : undefined;
    const inner =
      peerId ? (
        <DmPanel
          key={peerId}
          api={api}
          realtime={realtime}
          myId={myId}
          userId={peerId}
          friend={!!dmFriend}
          request={!!peerDm?.request && !peerDm.ignored}
          inCall={voice?.kind === "call" && voice.peer?.id === peerId}
          onCall={() => callFriend({ id: peerId })}
          onGoToCall={goToVoice}
          onOpenProfile={() => setProfileId(peerId)}
          onAccept={() => api.acceptDm(peerId).then(loadFriends).catch(showError)}
          onIgnore={() =>
            api
              .ignoreDm(peerId)
              .then(() => (setDmView({ type: "friends" }), loadFriends()))
              .catch(showError)
          }
          onBlock={() =>
            api
              .block(peerId)
              .then(() => (setDmView({ type: "friends" }), loadFriends()))
              .catch(showError)
          }
        />
      ) : dmView.type === "requests" ? (
        <RequestsView
          requests={dmRequests}
          onOpen={(userId) => setDmView({ type: "dm", userId })}
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
    main = (
      <MessagesView
        friends={friends}
        dmOrder={dmOrder}
        requests={dmRequests.length}
        dmView={dmView}
        unread={unread}
        onOpenFriends={() => setDmView({ type: "friends" })}
        onOpenRequests={() => setDmView({ type: "requests" })}
        onOpenDm={(userId) => setDmView({ type: "dm", userId })}
      >
        {inner}
      </MessagesView>
    );
  } else if (openChannel && detail) {
    main = (
      <section className="panel">
      <ChatView
        key={openChannel.id}
        api={api}
        realtime={realtime}
        scope="channel"
        target={openChannel.id}
        focus={serverView.type === "channel" ? serverView.focus : undefined}
        myId={myId}
        canModerate={isManager}
        onOpenProfile={setProfileId}
        mentionables={mentionables}
        inVoiceHere={voice?.kind === "room" && voice.serverId === detail.id}
        onPinLegend={isGuest ? undefined : (id) => void pinLegend(detail.id, id)}
        placeholder={t("Écrire dans #{0}", { 0: openChannel.name })}
        emptyText={t("Bienvenue dans #{0} ! Lance la conversation.", { 0: openChannel.name })}
        header={
          <header className="chat-header">
            <button className="icon-btn" onClick={() => setServerView({ type: "home" })} aria-label={t("Retour aux pièces")} title={t("Retour aux pièces")}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <span className="fil-hash sm">#</span>
            <strong className="grow">{openChannel.name}</strong>
            <span className="muted small">{detail.name}</span>
            <button
              className={`btn pill${membersOpen ? " active" : ""}`}
              onClick={toggleMembers}
              aria-pressed={membersOpen}
              aria-label={t("Membres")}
              title={membersOpen ? t("Masquer les membres") : t("Afficher les membres")}
            >
              <Icon name="users" size={16} /> <span className="pill-label">{t("Membres")}</span>
            </button>
          </header>
        }
      />
      </section>
    );
  } else if (detail && serverView.type === "legends") {
    main = (
      <LegendsView
        api={api}
        realtime={realtime}
        serverId={detail.id}
        serverName={detail.name}
        myId={myId}
        isManager={isManager}
        onBack={() => setServerView({ type: "home" })}
        onOpenProfile={setProfileId}
      />
    );
  } else if (detail && serverView.type === "challenges") {
    main = (
      <ChallengesView
        api={api}
        realtime={realtime}
        serverId={detail.id}
        serverName={detail.name}
        myId={myId}
        isManager={isManager}
        onBack={() => setServerView({ type: "home" })}
      />
    );
  } else if (detail) {
    main = (
      <ServerHome
        detail={detail}
        isGuest={isGuest}
        isManager={isManager}
        voice={
          voice?.kind === "room" && voice.serverId === detail.id
            ? { roomId: voice.roomId, identity: voice.room.localParticipant.identity, ping: <NetworkBadge room={voice.room} /> }
            : null
        }
        myName={displayName}
        speaking={speaking}
        unread={unread}
        mentions={mentions}
        members={<MemberList api={api} realtime={realtime} serverId={detail.id} myId={myId} onOpenProfile={setProfileId} />}
        joiningRoomId={joiningRoomId}
        onJoin={enterRoom}
        onInvite={openInvite}
        onManage={() => active && setDialog({ kind: "manage", server: active })}
        onAddRoom={() => setDialog({ kind: "addRoom", serverId: detail.id })}
        onRenameRoom={(room) => setDialog({ kind: "renameRoom", room })}
        onDeleteRoom={(room) => setDialog({ kind: "deleteRoom", room })}
        onOpenChannel={(c) => setServerView({ type: "channel", id: c.id })}
        onOpenLegends={() => setServerView({ type: "legends" })}
        onOpenChallenges={() => setServerView({ type: "challenges" })}
        onSearch={() => setSearchOpen(true)}
        onAddChannel={() => setDialog({ kind: "addChannel", serverId: detail.id })}
        onRenameChannel={(channel) => setDialog({ kind: "renameChannel", channel })}
        onDeleteChannel={(channel) => setDialog({ kind: "deleteChannel", channel })}
        onReorderRooms={(ids) =>
          api.reorderRooms(detail.id, ids).then(loadDetail, (err) => {
            showError(err);
            loadDetail();
            throw err;
          })
        }
        onReorderChannels={(ids) =>
          api.reorderChannels(detail.id, ids).then(loadDetail, (err) => {
            showError(err);
            loadDetail();
            throw err;
          })
        }
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
      <UpdateCard inVoice={!!voice} apiBase={api.baseUrl} />
      <GameCard
        game={game}
        mates={gameMates}
        inVoice={!!voice}
        onJoin={(roomId) => {
          const room = detail?.rooms.find((r) => r.id === roomId);
          if (room) void enterRoom(room);
        }}
      />
      <ServerRail
        session={session}
        instance={api.baseUrl}
        displayName={displayName}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          if (m === "messages" && dmView.type === "call" && voice?.kind !== "call") setDmView({ type: "friends" });
        }}
        servers={servers}
        activeId={active?.id ?? null}
        voiceServerId={voice?.kind === "room" ? voice.serverId : null}
        messagesBadge={messagesBadge}
        serverDots={serverDots}
        onSelectServer={selectServer}
        onCreateServer={() => setDialog({ kind: "createServer" })}
        onJoinServer={() => setDialog({ kind: "joinServer" })}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={logout}
        onOpenDev={session.kind === "user" && session.user.isDev ? () => setDevOpen(!devOpen) : undefined}
        me={me}
        onSetStatus={changeStatus}
        onOpenMyProfile={() => (setSettingsSection("profile"), setSettingsOpen(true))}
      />

      {profileId && (
        <ProfileCard
          api={api}
          userId={profileId}
          room={voice?.room ?? null}
          onClose={() => setProfileId(null)}
          onMessage={(id) => (setProfileId(null), setMode("messages"), setDmView({ type: "dm", userId: id }))}
          onCall={(id) => (setProfileId(null), callFriend({ id }))}
          onEditMine={() => (setProfileId(null), setSettingsSection("profile"), setSettingsOpen(true))}
          onChanged={loadFriends}
        />
      )}

      <div className={`content-wrap${voice && !stageVisible && !planVisible ? " with-island" : ""}`}>
        {planVisible && detail ? (
          <div className={`with-plan${planNarrow ? " narrow" : ""}${planNarrow && planPeek ? " peek" : ""}`}>
            {planNarrow && planPeek && <div className="plan-peek-away" onClick={() => setPlanPeek(false)} />}
            <ServerPlan
              people={serverPeople}
              myId={myId}
              onOpenProfile={setProfileId}
              detail={detail}
              isManager={isManager}
              isGuest={isGuest}
              voice={
                voice?.kind === "room" && voice.serverId === detail.id
                  ? { roomId: voice.roomId, identity: voice.room.localParticipant.identity }
                  : null
              }
              myName={me?.displayName ?? displayName}
              speaking={speaking}
              unread={unread}
              mentions={mentions}
              openRoomId={stageVisible && voice?.kind === "room" ? voice.roomId : undefined}
              openChannelId={openChannel?.id}
              joiningRoomId={joiningRoomId}
              collapsed={planIsCollapsed}
              onToggleCollapsed={() => (planNarrow ? setPlanPeek(!planPeek) : setPlanCollapsed(!planCollapsed))}
              onOpenHome={() => (setPlanPeek(false), setServerView({ type: "home" }))}
              onJoinRoom={(r) => (setPlanPeek(false), enterRoom(r))}
              onOpenChannel={(c) => (setPlanPeek(false), setServerView({ type: "channel", id: c.id }))}
              onAddRoom={() => setDialog({ kind: "addRoom", serverId: detail.id })}
              onManage={() => active && setDialog({ kind: "manage", server: active })}
              onSearch={() => setSearchOpen(true)}
              footer={
                voice && !stageVisible ? (
                  <VoiceIsland
                    variant={planIsCollapsed ? "mini" : "panel"}
                    room={voice.room}
                    label={voice.kind === "call" ? t("Appel · {0}", { 0: voice.roomLabel }) : (voiceRoomInfo?.label ?? voice.roomLabel)}
                    isCall={voice.kind === "call"}
                    micOn={micOn}
                    deafened={deafened}
                    onOpen={goToVoice}
                    onToggleMic={toggleMic}
                    onToggleDeafen={toggleDeafen}
                    onLeave={leaveVoice}
                  />
                ) : undefined
              }
            />
            <main className="content">{main}</main>
            {membersOpen && (
              <aside className="side-members" aria-label={t("Membres")}>
                <MemberList api={api} realtime={realtime} serverId={detail.id} myId={myId} onOpenProfile={setProfileId} onClose={toggleMembers} />
              </aside>
            )}
          </div>
        ) : (
          <main className="content">{main}</main>
        )}
        {voice && !stageVisible && !planVisible && (
          <VoiceIsland
            room={voice.room}
            label={voice.kind === "call" ? t("Appel · {0}", { 0: voice.roomLabel }) : (voiceRoomInfo?.label ?? voice.roomLabel)}
            isCall={voice.kind === "call"}
            micOn={micOn}
            deafened={deafened}
            onOpen={goToVoice}
            onToggleMic={toggleMic}
            onToggleDeafen={toggleDeafen}
            onLeave={leaveVoice}
          />
        )}
      </div>

      {searchOpen && mode === "servers" && detail && (
        <ServerSearch
          api={api}
          detail={detail}
          people={serverPeople}
          myId={myId}
          onOpenProfile={setProfileId}
          onOpenMessage={openSearchHit}
          onClose={() => setSearchOpen(false)}
        />
      )}

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

      {/* Adresse e-mail obligatoire (sauf compte de test du serveur de dev) */}
      {session.kind === "user" && !session.user.isDev && (
        <EmailGate api={api} user={session.user} mailOn={mailOn} onUser={(user) => setSession({ kind: "user", user })} onLogout={logout} />
      )}

      {settingsOpen && session.kind === "user" && (
        <Settings
          api={api}
          user={session.user}
          realtime={realtime}
          voiceRoom={voice?.room ?? null}
          onLogout={logout}
          onLogoutAll={logoutAll}
          onClose={() => (setSettingsOpen(false), setSettingsSection(undefined))}
          initialSection={settingsSection}
          onProfileChanged={loadMe}
        />
      )}

      {incoming && <IncomingCall from={incoming.from.name} fromId={incoming.from.id} onAccept={acceptCall} onDecline={declineCall} />}

      {toast && (
        <div className={`toast${toast.ok ? " ok" : ""}`} role="alert" onClick={() => setToast(undefined)}>
          {toast.text}
          {toast.action && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                toast.action!.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {dialog?.kind === "createServer" && (
        <PromptDialog
          title={t("Créer un serveur")}
          subtitle={t("Tu en seras l'admin. Un salon textuel « général » et un salon vocal « Général » sont créés pour toi.")}
          label={t("Nom du serveur")}
          placeholder={t("Les potes")}
          confirmLabel={t("Créer")}
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
          title={t("Rejoindre un serveur")}
          subtitle={t("Colle le code qu'un membre du serveur t'a envoyé.")}
          label={t("Code d'invitation")}
          placeholder={t("ABCD-EFGH")}
          confirmLabel={t("Rejoindre")}
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
          title={t("Nouveau salon vocal")}
          label={t("Nom du salon")}
          placeholder={t("Valorant")}
          confirmLabel={t("Créer")}
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
          title={t("Renommer le salon")}
          label={t("Nom du salon")}
          initial={dialog.room.label}
          confirmLabel={t("Enregistrer")}
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
          title={t("Supprimer « {0} » ?", { 0: dialog.room.label })}
          message={t("Les personnes connectées dans ce salon seront déconnectées.")}
          confirmLabel={t("Supprimer")}
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
          title={t("Nouveau salon textuel")}
          label={t("Nom du salon")}
          placeholder={t("mèmes")}
          confirmLabel={t("Créer")}
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
          title={t("Renommer le salon textuel")}
          label={t("Nom du salon")}
          initial={dialog.channel.name}
          confirmLabel={t("Enregistrer")}
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
          title={t("Supprimer #{0} ?", { 0: dialog.channel.name })}
          message={t("Tous les messages de ce salon seront supprimés définitivement.")}
          confirmLabel={t("Supprimer")}
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
