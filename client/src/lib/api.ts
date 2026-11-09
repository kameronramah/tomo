import { secretDelete, secretGet, secretSet } from "./secure";
import { t } from "./i18n";

// ---------------------------------------------------------------------------
// Types renvoyés par l'API
// ---------------------------------------------------------------------------
export type Role = "owner" | "admin" | "member" | "guest";
/** email / emailVerified : seulement pour son propre compte (jamais ceux des autres). */
export type User = { id: string; username: string; isDev?: boolean; email?: string | null; emailVerified?: boolean };
export type DevStats = {
  users: number;
  fakeMembers: number;
  servers: number;
  rooms: number;
  sessions: number;
  activeInvites: number;
  registration: string;
};
export type Guest = { id: string; name: string; expiresAt: number; server: { id: string; name: string } };
export type Session = { kind: "user"; user: User } | { kind: "guest"; guest: Guest };

export type ServerSummary = { id: string; name: string; role: Role; inVoice: number };
export type Participant = { identity: string; name: string; guest: boolean };
export type RoomInfo = { id: string; label: string; spatial: boolean; participants: Participant[] };
export type Channel = { id: string; name: string };
export type ServerDetail = { id: string; name: string; role: Role; rooms: RoomInfo[]; channels: Channel[] };
export type Message = {
  id: string;
  scope: "channel" | "room" | "dm";
  target: string;
  authorId: string;
  authorName: string;
  guest: boolean;
  content: string;
  createdAt: number;
  editedAt?: number;
  attachments?: Attachment[];
  reactions?: Reaction[];
};
export type Reaction = { emoji: string; count: number; userIds: string[] };
export type Attachment = {
  id: string;
  kind: "image" | "audio" | "file";
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Message vocal : niveaux 0-9 pour dessiner l'onde. */
  waveform?: string;
  /** Chemin relatif à l'instance (voir Api.fileUrl). */
  url: string;
};
export type GifMedia = { url: string; width: number; height: number };
export type Gif = { id: string; title: string; preview: GifMedia; full: GifMedia };
export type UploadMeta = { name: string; durationMs?: number; width?: number; height?: number; waveform?: string };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Statut vu par les autres. */
export type Presence = "online" | "idle" | "dnd" | "offline";
/** Statut choisi (l'invisible apparaît « offline » aux autres). */
export type ChosenStatus = "online" | "idle" | "dnd" | "invisible";
export type LightProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accent: string | null;
  status: Presence;
  customStatus: string | null;
  /** « Joue à … » (absent sur les vieux serveurs) */
  game?: { name: string; since: number } | null;
};
export type FullProfile = LightProfile & {
  bio: string | null;
  bannerUrl: string | null;
  createdAt: number;
  lastSeen: number | null;
  self: boolean;
  friendship: "friend" | "incoming" | "outgoing" | "none";
  blockedByMe: boolean;
  commonServers: number;
  canMessage: boolean;
  canCall: boolean;
  canAddFriend: boolean;
};
export type Privacy = {
  dm: "friends" | "servers" | "everyone";
  call: "friends" | "servers";
  friend: "everyone" | "servers" | "nobody";
  showGame: boolean;
  showLastSeen: boolean;
};
export type MyProfile = FullProfile & {
  chosenStatus: ChosenStatus;
  customStatusRaw: string | null;
  customStatusUntil: number | null;
  privacy: Privacy;
};
export type GameLinks = {
  steam: { steamId: string } | null;
  riot: { riotId: string; region: string } | null;
  visibility: "everyone" | "servers" | "nobody";
  showRank: boolean;
  available: { steam: boolean; riot: boolean };
  regions: { id: string; label: string }[];
};
export type SteamStats = {
  linked: true;
  error?: string;
  name?: string | null;
  profileUrl?: string | null;
  private?: boolean;
  minutes2w?: number;
  games?: { name: string; appId: number; minutes2w: number }[];
};
export type RiotStats = {
  linked: true;
  error?: string;
  riotId: string | null;
  region?: string;
  level?: number | null;
  ranks?: { queue: string; tier: string; division: string; lp: number; winRate: number | null }[];
  matches?: { win: boolean; champion: string; kills: number; deaths: number; assists: number; endedAt: number; mode: string }[];
};
export type UserStats = { steam: SteamStats | null; riot: RiotStats | null; hidden?: boolean };
export type Legend = {
  id: string;
  kind: "clip" | "quote" | "image";
  title: string | null;
  text: string | null;
  context: string | null;
  authorId: string | null;
  authorName: string;
  pinnedBy: string;
  momentAt: number;
  createdAt: number;
  attachment: Attachment | null;
  reactions: Reaction[];
};
export type Challenge = {
  id: string;
  title: string;
  reward: number;
  endsAt: number | null;
  createdBy: string;
  createdAt: number;
  status: "open" | "claimed" | "done" | "cancelled" | "expired";
  claimedBy: string | null;
  winnerId: string | null;
  players: string[];
  needed: number;
  approvals: string[];
  rejections: string[];
};
export type ChallengeBoard = { challenges: Challenge[]; leaderboard: { userId: string; points: number }[]; monthStart: number };
export type Person = LightProfile & {
  role: Role;
  guest: boolean;
  room: { id: string; label: string } | null;
  lastSeen: number | null;
};
export type Friend = {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  status: "friend" | "incoming" | "outgoing";
  presence?: Presence;
  customStatus?: string | null;
  online: boolean;
  since: number;
};
export type DmSummary = {
  userId: string;
  lastMessageAt: number;
  request?: boolean;
  ignored?: boolean;
  friend?: boolean;
  profile?: LightProfile;
};
export type Blocked = { id: string; username: string; displayName: string; avatarUrl: string | null };
export type CallInfo = { callId: string; url: string; token: string; with: { id: string; name: string } };
export type SessionInfo = { createdAt: number; expiresAt: number; userAgent: string | null };
export type Member = { id: string; username: string; role: Role; joinedAt: number };
export type Invite = {
  code: string;
  kind: "member" | "guest";
  expiresAt: number;
  maxUses: number | null;
  uses: number;
  createdBy?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type AuthResult = { accessToken: string; refreshToken: string; user: User };

/**
 * Client de l'API tomo.
 * - Jeton d'accès (15 min) gardé en mémoire uniquement.
 * - Jeton de renouvellement : en mémoire, et dans le coffre-fort si « rester connecté ».
 * - Sur une réponse 401, renouvelle la session une fois puis rejoue la requête.
 */
export class Api {
  private access: string | null = null;
  private refresh: string | null = null;
  private remember = false;
  private refreshing: Promise<boolean> | null = null;
  /** Appelé quand la session est perdue (expirée, révoquée). */
  onSessionLost: (() => void) | null = null;

  constructor(public readonly baseUrl: string) {}

  private get storeKey() {
    return `session:${this.baseUrl}`;
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.access ? { Authorization: `Bearer ${this.access}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(t("Serveur tomo injoignable. Vérifie ta connexion."), 0);
    }
    if (res.status === 401 && retry && this.refresh && !path.startsWith("/auth/")) {
      if (await this.renew()) return this.request<T>(method, path, body, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith("/auth/login")) this.onSessionLost?.();
      throw new ApiError(data.error ?? `Erreur serveur (${res.status})`, res.status);
    }
    return this.absolutize(data) as T;
  }

  /** Les photos et bannières arrivent en chemins relatifs (/files/…) : on y ajoute l'adresse de l'instance. */
  private absolutize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.absolutize(x));
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if ((k === "avatarUrl" || k === "bannerUrl") && typeof o[k] === "string" && (o[k] as string).startsWith("/")) o[k] = this.baseUrl + o[k];
        else if (o[k] && typeof o[k] === "object") o[k] = this.absolutize(o[k]);
      }
    }
    return v;
  }

  /** Renouvelle la session (une seule fois même si plusieurs requêtes échouent en même temps). */
  private renew(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const r = await this.request<AuthResult>("POST", "/auth/refresh", { refreshToken: this.refresh }, false);
          await this.setTokens(r);
          return true;
        } catch {
          await this.clear();
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  private async setTokens(r: AuthResult) {
    this.access = r.accessToken;
    this.refresh = r.refreshToken;
    if (this.remember) await secretSet(this.storeKey, r.refreshToken);
  }

  private async clear() {
    this.access = null;
    this.refresh = null;
    await secretDelete(this.storeKey);
  }

  // ---- Session -----------------------------------------------------------
  /** Reprend la session gardée dans le coffre-fort, s'il y en a une. */
  async restore(): Promise<Session | null> {
    const saved = await secretGet(this.storeKey);
    if (!saved) return null;
    this.refresh = saved;
    this.remember = true;
    if (!(await this.renew())) return null;
    const user = await this.request<User>("GET", "/me");
    return { kind: "user", user };
  }

  /** Après connexion : le profil complet (avec l'état de l'adresse e-mail). */
  private async startSession(r: AuthResult, remember: boolean): Promise<Session> {
    this.remember = remember;
    await this.setTokens(r);
    const user = await this.request<User>("GET", "/me").catch(() => r.user);
    return { kind: "user", user };
  }

  async login(username: string, password: string, remember: boolean): Promise<Session> {
    const r = await this.request<AuthResult>("POST", "/auth/login", { username, password }, false);
    return this.startSession(r, remember);
  }

  async register(username: string, password: string, email: string, remember: boolean): Promise<Session> {
    const r = await this.request<AuthResult>("POST", "/auth/register", { username, password, email }, false);
    return this.startSession(r, remember);
  }

  // ---- Adresse e-mail et mot de passe oublié -------------------------------
  me = () => this.request<User>("GET", "/me");
  setEmail = (email: string, password: string) =>
    this.request<{ email: string; emailVerified: boolean }>("POST", "/me/email", { email, password });
  resendEmailCode = () => this.request<{ ok: true }>("POST", "/me/email/resend", {});
  verifyEmail = (code: string) => this.request<{ emailVerified: boolean }>("POST", "/me/email/verify", { code });
  forgotPassword = (login: string) => this.request<{ ok: true }>("POST", "/auth/forgot", { login }, false);
  async resetPassword(login: string, code: string, password: string, remember: boolean): Promise<Session> {
    const r = await this.request<AuthResult>("POST", "/auth/reset", { login, code, password }, false);
    return this.startSession(r, remember);
  }

  async joinAsGuest(code: string, name: string): Promise<Session> {
    const r = await this.request<{ accessToken: string; guest: Guest }>("POST", "/auth/guest", { code, name }, false);
    this.remember = false;
    this.access = r.accessToken;
    this.refresh = null;
    return { kind: "guest", guest: r.guest };
  }

  async logout() {
    const token = this.refresh;
    if (token) await this.request("POST", "/auth/logout", { refreshToken: token }, false).catch(() => {});
    await this.clear();
  }

  async logoutAll() {
    await this.request("POST", "/auth/logout-all", {});
    await this.clear();
  }

  /** mail : le serveur sait envoyer des e-mails (vérification, mot de passe oublié). */
  authConfig = () => this.request<{ registration: "open" | "closed"; mail?: boolean }>("GET", "/auth/config");

  // ---- Serveurs ----------------------------------------------------------
  servers = () => this.request<ServerSummary[]>("GET", "/servers");
  server = (id: string) => this.request<ServerDetail>("GET", `/servers/${id}`);
  createServer = (name: string) => this.request<ServerSummary>("POST", "/servers", { name });
  renameServer = (id: string, name: string) => this.request("PATCH", `/servers/${id}`, { name });
  deleteServer = (id: string) => this.request("DELETE", `/servers/${id}`);
  leaveServer = (id: string) => this.request("POST", `/servers/${id}/leave`, {});

  members = (id: string) => this.request<Member[]>("GET", `/servers/${id}/members`);
  setRole = (id: string, userId: string, role: "admin" | "member") =>
    this.request("PATCH", `/servers/${id}/members/${userId}`, { role });
  kick = (id: string, userId: string) => this.request("DELETE", `/servers/${id}/members/${userId}`);

  // ---- Salons ------------------------------------------------------------
  createRoom = (serverId: string, label: string) => this.request<RoomInfo>("POST", `/servers/${serverId}/rooms`, { label });
  renameRoom = (roomId: string, label: string) => this.request("PATCH", `/rooms/${roomId}`, { label });
  setSpatial = (roomId: string, spatial: boolean) => this.request("PATCH", `/rooms/${roomId}`, { spatial });
  deleteRoom = (roomId: string) => this.request("DELETE", `/rooms/${roomId}`);
  /** Ranger les pièces / les fils : liste complète des identifiants dans le nouvel ordre (admins). */
  reorderRooms = (serverId: string, ids: string[]) => this.request("PUT", `/servers/${serverId}/rooms/order`, { ids });
  reorderChannels = (serverId: string, ids: string[]) => this.request("PUT", `/servers/${serverId}/channels/order`, { ids });
  roomToken = (roomId: string) =>
    this.request<{ url: string; token: string; identity: string; spatial: boolean }>("POST", `/rooms/${roomId}/token`, {});

  // ---- Invitations -------------------------------------------------------
  createInvite = (serverId: string, kind: "member" | "guest", hours: number, maxUses: number | null) =>
    this.request<Invite>("POST", `/servers/${serverId}/invites`, { kind, hours, maxUses });
  invites = (serverId: string) => this.request<Invite[]>("GET", `/servers/${serverId}/invites`);
  revokeInvite = (code: string) => this.request("DELETE", `/invites/${encodeURIComponent(code)}`);
  acceptInvite = (code: string) =>
    this.request<ServerSummary>("POST", `/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`, {});

  // ---- Compte -------------------------------------------------------------
  async changePassword(current: string, next: string) {
    const r = await this.request<AuthResult>("POST", "/me/password", { current, next });
    await this.setTokens(r);
  }
  sessions = () => this.request<SessionInfo[]>("GET", "/me/sessions");

  /** Jeton d'accès valide (renouvelé si besoin), pour la connexion temps réel. */
  async freshAccessToken(): Promise<string | null> {
    if (this.refresh) await this.request("GET", "/me").catch(() => {});
    return this.access;
  }

  // ---- Salons textuels et messages ----------------------------------------
  createChannel = (serverId: string, name: string) => this.request<Channel>("POST", `/servers/${serverId}/channels`, { name });
  renameChannel = (channelId: string, name: string) => this.request("PATCH", `/channels/${channelId}`, { name });
  deleteChannel = (channelId: string) => this.request("DELETE", `/channels/${channelId}`);

  /** Messages d'un salon textuel, du chat d'un salon vocal ou d'une conversation privée. */
  messages(scope: Message["scope"], target: string, before?: number) {
    const base = scope === "channel" ? `/channels/${target}` : scope === "room" ? `/rooms/${target}` : `/dm/${target}`;
    return this.request<Message[]>("GET", `${base}/messages${before ? `?before=${before}` : ""}`);
  }
  sendMessage(scope: Message["scope"], target: string, content: string, attachments: string[] = []) {
    const base = scope === "channel" ? `/channels/${target}` : scope === "room" ? `/rooms/${target}` : `/dm/${target}`;
    return this.request<Message>("POST", `${base}/messages`, attachments.length ? { content, attachments } : { content });
  }

  /** Envoie un fichier (corps binaire brut) ; renvoie la pièce jointe à mettre dans un message. */
  async uploadAttachment(file: Blob, meta: UploadMeta, retry = true): Promise<Attachment> {
    if (file.size > MAX_FILE_BYTES) throw new ApiError(t("Fichier trop lourd (25 Mo maximum)."), 413);
    const q = new URLSearchParams({ name: meta.name });
    if (meta.durationMs) q.set("durationMs", String(Math.round(meta.durationMs)));
    if (meta.width) q.set("width", String(meta.width));
    if (meta.height) q.set("height", String(meta.height));
    if (meta.waveform) q.set("waveform", meta.waveform);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/attachments?${q}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(this.access ? { Authorization: `Bearer ${this.access}` } : {}),
        },
        body: file,
      });
    } catch {
      throw new ApiError(t("Envoi du fichier impossible. Vérifie ta connexion."), 0);
    }
    if (res.status === 401 && retry && this.refresh && (await this.renew())) return this.uploadAttachment(file, meta, false);
    const data = await res.json().catch(() => ({}));
    if (res.status === 413) throw new ApiError(t("Fichier trop lourd (25 Mo maximum)."), 413);
    if (!res.ok) throw new ApiError(data.error ?? `Erreur serveur (${res.status})`, res.status);
    return data as Attachment;
  }

  /** GIF : tendances (sans recherche) ou résultats d'une recherche, via Klipy. */
  gifs = (q: string, page = 1) =>
    this.request<{ gifs: Gif[]; hasNext: boolean }>("GET", `/gifs?${new URLSearchParams({ q, page: String(page) })}`);
  /** Le serveur récupère le GIF choisi et le range comme pièce jointe. */
  attachGif = (g: Gif) =>
    this.request<Attachment>("POST", "/gifs/attach", { url: g.full.url, title: g.title, width: g.full.width, height: g.full.height });

  /** Adresse complète d'une pièce jointe. */
  fileUrl = (a: Attachment) => `${this.baseUrl}${a.url}`;
  deleteMessage = (id: string) => this.request("DELETE", `/messages/${id}`);
  editMessage = (id: string, content: string) => this.request<Message>("PATCH", `/messages/${id}`, { content });
  react = (id: string, emoji: string) => this.request<{ reactions: Reaction[] }>("POST", `/messages/${id}/reactions`, { emoji });

  // ---- Comptes de jeu et stats -------------------------------------------------
  links = () => this.request<GameLinks>("GET", "/me/links");
  setLinks = (p: { visibility?: GameLinks["visibility"]; showRank?: boolean }) => this.request("PATCH", "/me/links", p);
  steamLinkStart = () => this.request<{ url: string }>("POST", "/me/links/steam/start");
  unlinkSteam = () => this.request("DELETE", "/me/links/steam");
  linkRiot = (riotId: string, region: string) => this.request<{ riotId: string; region: string }>("POST", "/me/links/riot", { riotId, region });
  unlinkRiot = () => this.request("DELETE", "/me/links/riot");
  stats = (userId: string) => this.request<UserStats>("GET", `/users/${userId}/stats`);

  // ---- Mur des légendes et défis ---------------------------------------------
  legends = (serverId: string) => this.request<Legend[]>("GET", `/servers/${serverId}/legends`);
  pinLegend = (serverId: string, messageId: string, title?: string) =>
    this.request<Legend>("POST", `/servers/${serverId}/legends`, { messageId, ...(title ? { title } : {}) });
  pinClip = (serverId: string, attachmentId: string, title: string, momentAt?: number) =>
    this.request<Legend>("POST", `/servers/${serverId}/legends/clip`, { attachmentId, title, momentAt });
  unpinLegend = (id: string) => this.request("DELETE", `/legends/${id}`);
  reactLegend = (id: string, emoji: string) => this.request<Legend>("POST", `/legends/${id}/reactions`, { emoji });
  challenges = (serverId: string) => this.request<ChallengeBoard>("GET", `/servers/${serverId}/challenges`);
  createChallenge = (serverId: string, title: string, reward: number, endsAt?: number) =>
    this.request<Challenge>("POST", `/servers/${serverId}/challenges`, { title, reward, ...(endsAt ? { endsAt } : {}) });
  joinChallenge = (id: string) => this.request<Challenge>("POST", `/challenges/${id}/join`);
  leaveChallenge = (id: string) => this.request<Challenge>("DELETE", `/challenges/${id}/join`);
  claimChallenge = (id: string) => this.request<Challenge>("POST", `/challenges/${id}/claim`);
  voteChallenge = (id: string, approve: boolean) => this.request<Challenge>("POST", `/challenges/${id}/vote`, { approve });
  cancelChallenge = (id: string) => this.request("DELETE", `/challenges/${id}`);

  // ---- Amis, messages privés, appels ---------------------------------------
  friends = () => this.request<Friend[]>("GET", "/friends");
  addFriend = (username: string) => this.request<{ status: string }>("POST", "/friends", { username });
  acceptFriend = (userId: string) => this.request("POST", `/friends/${userId}/accept`, {});
  removeFriend = (userId: string) => this.request("DELETE", `/friends/${userId}`);
  dmList = () => this.request<DmSummary[]>("GET", "/dm");
  startCall = (userId: string) => this.request<CallInfo>("POST", `/calls/${userId}`, {});
  acceptCall = (callId: string) => this.request<CallInfo>("POST", `/calls/${callId}/accept`, {});
  declineCall = (callId: string) => this.request("POST", `/calls/${callId}/decline`, {});
  endCall = (callId: string) => this.request("POST", `/calls/${callId}/end`, {});

  // ---- Profils, statut, confidentialité, blocage --------------------------
  myProfile = () => this.request<MyProfile>("GET", "/me/profile");
  updateProfile = (p: { displayName?: string | null; bio?: string | null; accent?: string | null; avatarId?: string | null; bannerId?: string | null }) =>
    this.request<LightProfile>("PATCH", "/me/profile", p);
  setStatus = (p: { status?: ChosenStatus; customStatus?: string | null; customStatusUntil?: number | null }) =>
    this.request<LightProfile>("PATCH", "/me/status", p);
  setPrivacy = (p: Partial<Privacy>) => this.request("PATCH", "/me/privacy", p);
  userProfile = (id: string) => this.request<FullProfile>("GET", `/users/${id}/profile`);
  usersBatch = (ids: string[]) => this.request<LightProfile[]>("POST", "/users/batch", { ids });
  people = (serverId: string) => this.request<Person[]>("GET", `/servers/${serverId}/people`);
  blocks = () => this.request<Blocked[]>("GET", "/blocks");
  block = (userId: string) => this.request("POST", `/blocks/${userId}`, {});
  unblock = (userId: string) => this.request("DELETE", `/blocks/${userId}`);
  acceptDm = (userId: string) => this.request("POST", `/dm/${userId}/accept`, {});
  ignoreDm = (userId: string) => this.request("POST", `/dm/${userId}/ignore`, {});

  // ---- Outils de test (compte de test, serveur en mode dev uniquement) ----
  devBotToken = (roomId: string, name: string) =>
    this.request<{ url: string; token: string; identity: string }>("POST", "/dev/bot-token", { roomId, name });
  devFakeMembers = (serverId: string, count: number) =>
    this.request<{ created: string[] }>("POST", `/dev/servers/${serverId}/fake-members`, { count });
  devDeleteFakeMembers = () => this.request<{ deleted: number }>("DELETE", "/dev/fake-members");
  devStats = () => this.request<DevStats>("GET", "/dev/stats");

  /** Rend le jeton d'accès invalide : la prochaine requête doit renouveler la session toute seule. */
  debugBreakAccessToken() {
    this.access = "jeton.volontairement.invalide";
  }
  /** Simule une session perdue (révoquée côté serveur). */
  debugLoseSession() {
    this.onSessionLost?.();
  }
  get debugInfo() {
    return { instance: this.baseUrl, remember: this.remember, hasRefresh: !!this.refresh };
  }
}
