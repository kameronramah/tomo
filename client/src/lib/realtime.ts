/**
 * Connexion temps réel à l'API (WebSocket) : messages, amis, présence, appels.
 * Se reconnecte toute seule et mesure la latence de l'API (ping applicatif).
 */
import type { Api } from "./api";

export type RealtimeEvent = { type: string; [key: string]: any };
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

  constructor(private api: Api) {}

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
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
