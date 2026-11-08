/**
 * Connexion temps réel à l'API (WebSocket) : messages, amis, présence, appels.
 * Se reconnecte toute seule et mesure la latence de l'API (ping applicatif).
 */
import type { Api } from "./api";

export type RealtimeEvent = { type: string; [key: string]: any };
const IDLE_AFTER_MS = 10 * 60 * 1000;
type Listener = (e: RealtimeEvent) => void;

export class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private closed = false;
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  /** Latence de l'API en ms (aller-retour WebSocket). */
  apiPing: number | null = null;
  connected = false;

  /** Inactif = aucune activité clavier / souris depuis 10 min (statut « Inactif » automatique). */
  private idle = false;
  private lastActivity = Date.now();
  private idleTimer: number | undefined;
  private onActivity = () => {
    this.lastActivity = Date.now();
    if (this.idle) this.setIdle(false);
  };

  constructor(private api: Api) {}

  /** Jeu en cours (renvoyé à chaque reconnexion). */
  private game: { name: string; since: number } | null = null;
  setGame(game: { name: string; since: number } | null) {
    this.game = game;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "game", game }));
  }

  private setIdle(v: boolean) {
    this.idle = v;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "idle", idle: v }));
  }

  private watchIdle() {
    if (this.idleTimer) return;
    for (const ev of ["pointermove", "keydown", "pointerdown", "wheel"]) window.addEventListener(ev, this.onActivity, { passive: true });
    this.idleTimer = window.setInterval(() => {
      if (!this.idle && Date.now() - this.lastActivity > IDLE_AFTER_MS) this.setIdle(true);
    }, 30_000);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(e: RealtimeEvent) {
    this.listeners.forEach((l) => l(e));
  }

  async start() {
    this.closed = false;
    const token = await this.api.freshAccessToken();
    if (!token || this.closed) return;
    const url = `${this.api.baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.emit({ type: "connection", connected: true });
      this.pingTimer = window.setInterval(() => this.ping(), 10_000);
      this.ping();
      this.watchIdle();
      if (this.idle) ws.send(JSON.stringify({ type: "idle", idle: true }));
      if (this.game) ws.send(JSON.stringify({ type: "game", game: this.game }));
    };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as RealtimeEvent;
        if (e.type === "pong") {
          this.apiPing = Math.round(performance.now() - e.t);
          this.emit({ type: "ping", ms: this.apiPing });
        } else this.emit(e);
      } catch {
        // message illisible
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.connected = false;
      this.emit({ type: "connection", connected: false });
      if (this.closed) return;
      // Reconnexion progressive : 1 s, 2 s, 4 s… jusqu'à 30 s.
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => this.start(), delay);
    };
  }

  private ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping", t: performance.now() }));
  }

  stop() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.idleTimer);
    this.idleTimer = undefined;
    for (const ev of ["pointermove", "keydown", "pointerdown", "wheel"]) window.removeEventListener(ev, this.onActivity);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
