/**
 * Audio spatial : chaque voix est placée en 3D (HRTF) selon la position de son auteur.
 *
 * Positions (en mètres, vue de dessus) :
 *  - « carte » : chacun déplace son avatar sur la carte du salon (marche avec tous les jeux) ;
 *  - « jeu »   : position lue dans le jeu via Mumble Link (Minecraft avec mod, GW2, Arma…).
 * Chaque client publie SA position (canal de données LiveKit, ~10/s) et place les autres.
 * Repli automatique : sans position récente (> 3 s), ou sources incompatibles, la voix
 * revient au centre, à plein volume.
 */
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteAudioTrack } from "livekit-client";
import { getSettings, onSettingsChange } from "./prefs";
import type { VoiceLeveler } from "./leveler";

export type Pose = { x: number; y: number; yaw: number };
export type PoseSource = "map" | "game";
export type RemotePose = Pose & { src: PoseSource; ctx: string; at: number; name: string };

export const MAP_HALF = 30; // la carte fait 60 m × 60 m
const STALE_MS = 3000;
const SEND_EVERY_MS = 100;
const HEARTBEAT_MS = 1000;
const TOPIC = "pos";

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SpatialEngine {
  enabled = false;
  me: Pose = { x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 16, yaw: 0 };
  mySource: PoseSource = "map";
  myCtx = "";
  gameName = "";
  remotes = new Map<string, RemotePose>();
  private panners = new Map<string, PannerNode>();
  private tracks = new Map<string, RemoteAudioTrack>();
  private lastSent = 0;
  private sendTimer: number | undefined;
  private heartbeat: number | undefined;
  private staleTimer: number | undefined;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];

  constructor(
    private room: Room,
    private ctx: AudioContext,
    /** Volume uniformisé : placé AVANT la spatialisation sur chaque voix. */
    private leveler: VoiceLeveler | null = null,
  ) {
    const onSub = (track: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      // Seule la voix (micro) est traitée ; le son d'un partage d'écran reste tel quel.
      if (track.kind !== Track.Kind.Audio || track.source !== Track.Source.Microphone) return;
      this.tracks.set(p.identity, track as RemoteAudioTrack);
      this.applyPlugins(p.identity);
    };
    const onUnsub = (t: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (t.source !== Track.Source.Microphone) return;
      this.tracks.delete(p.identity);
      this.panners.delete(p.identity);
      this.leveler?.forget(p.identity);
    };
    if (leveler) leveler.onToggle = () => this.tracks.forEach((_, id) => this.applyPlugins(id));
    const onLeft = (p: RemoteParticipant) => {
      this.remotes.delete(p.identity);
      this.emit();
    };
    const onData = (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== TOPIC || !p) return;
      try {
        const d = JSON.parse(dec.decode(payload));
        if (typeof d.x !== "number" || typeof d.y !== "number") return;
        this.remotes.set(p.identity, {
          x: d.x,
          y: d.y,
          yaw: Number(d.yaw) || 0,
          src: d.src === "game" ? "game" : "map",
          ctx: String(d.ctx ?? ""),
          at: Date.now(),
          name: p.name || p.identity,
        });
        this.updatePanner(p.identity);
        this.emit();
      } catch {
        // message illisible
      }
    };
    room
      .on(RoomEvent.TrackSubscribed, onSub)
      .on(RoomEvent.TrackUnsubscribed, onUnsub)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(RoomEvent.DataReceived, onData);
    this.offs.push(() =>
      room
        .off(RoomEvent.TrackSubscribed, onSub)
        .off(RoomEvent.TrackUnsubscribed, onUnsub)
        .off(RoomEvent.ParticipantDisconnected, onLeft)
        .off(RoomEvent.DataReceived, onData),
    );
    this.offs.push(onSettingsChange(() => this.panners.forEach((_, id) => this.updatePanner(id))));

    // Pistes déjà présentes
    room.remoteParticipants.forEach((p) =>
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track && pub.source === Track.Source.Microphone) this.tracks.set(p.identity, pub.track as RemoteAudioTrack);
      }),
    );
    this.tracks.forEach((_, id) => this.applyPlugins(id));
  }

  // ---- Activation ----------------------------------------------------------
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.tracks.forEach((_, id) => this.applyPlugins(id));
    clearInterval(this.heartbeat);
    clearInterval(this.staleTimer);
    if (on) {
      this.updateListener();
      this.send(true);
      this.heartbeat = window.setInterval(() => this.send(true), HEARTBEAT_MS);
      this.staleTimer = window.setInterval(() => {
        this.panners.forEach((_, id) => this.updatePanner(id));
        this.emit();
      }, 1000);
    }
    this.emit();
  }

  private applyPlugins(id: string) {
    const track = this.tracks.get(id);
    if (!track) return;
    const level = this.leveler?.nodesFor(id) ?? [];
    if (!this.enabled) {
      track.setWebAudioPlugins(level);
      return;
    }
    let panner = this.panners.get(id);
    if (!panner) {
      panner = new PannerNode(this.ctx, {
        panningModel: "HRTF",
        distanceModel: "linear",
        refDistance: 2,
        rolloffFactor: 1,
        coneInnerAngle: 360,
      });
      this.panners.set(id, panner);
    }
    this.updatePanner(id);
    track.setWebAudioPlugins([...level, panner]);
  }

  // ---- Positions -------------------------------------------------------------
  /**
   * Pourquoi une voix n'est PAS spatialisée (null si elle l'est).
   * Les positions « carte » et « jeu » ne se mélangent jamais, ni deux jeux / serveurs de jeu différents.
   */
  unplacedReason(id: string): string | null {
    const r = this.remotes.get(id);
    if (!r || Date.now() - r.at > STALE_MS) return "pas de position";
    if (r.src !== this.mySource) return r.src === "map" ? "est sur la carte, toi dans le jeu" : "est dans un jeu, toi sur la carte";
    if (r.src === "game" && r.ctx !== this.myCtx) return "pas dans le même jeu ou serveur";
    return null;
  }

  /** Une voix est-elle vraiment spatialisée (position récente et compatible) ? */
  isPlaced(id: string): boolean {
    return this.unplacedReason(id) === null;
  }

  distanceTo(id: string): number | null {
    const r = this.remotes.get(id);
    return r ? Math.hypot(r.x - this.me.x, r.y - this.me.y) : null;
  }

  private updatePanner(id: string) {
    const panner = this.panners.get(id);
    if (!panner) return;
    panner.maxDistance = Math.max(5, getSettings().spatial.range);
    const r = this.remotes.get(id);
    const t = this.ctx.currentTime + 0.05;
    if (r && this.isPlaced(id)) {
      // Repère audio : X = est, -Z = nord (vue de dessus)
      panner.positionX.linearRampToValueAtTime(r.x, t);
      panner.positionY.linearRampToValueAtTime(0, t);
      panner.positionZ.linearRampToValueAtTime(-r.y, t);
    } else {
      // Repli : la voix est « sur » l'auditeur → au centre, plein volume
      panner.positionX.linearRampToValueAtTime(this.me.x, t);
      panner.positionY.linearRampToValueAtTime(0, t);
      panner.positionZ.linearRampToValueAtTime(-this.me.y, t);
    }
  }

  private updateListener() {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime + 0.05;
    const fx = Math.sin(this.me.yaw);
    const fz = -Math.cos(this.me.yaw);
    if (l.positionX) {
      l.positionX.linearRampToValueAtTime(this.me.x, t);
      l.positionY.linearRampToValueAtTime(0, t);
      l.positionZ.linearRampToValueAtTime(-this.me.y, t);
      l.forwardX.linearRampToValueAtTime(fx, t);
      l.forwardY.linearRampToValueAtTime(0, t);
      l.forwardZ.linearRampToValueAtTime(fz, t);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(this.me.x, 0, -this.me.y);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Ma position change (glisser sur la carte, ou position du jeu). */
  setMyPose(pose: Pose, src: PoseSource, ctx = "", gameName = "") {
    const sourceChanged = src !== this.mySource || ctx !== this.myCtx;
    this.me = pose;
    this.mySource = src;
    this.myCtx = ctx;
    this.gameName = gameName;
    if (!this.enabled) return this.emit();
    this.updateListener();
    if (sourceChanged) this.panners.forEach((_, id) => this.updatePanner(id));
    this.send();
    this.emit();
  }

  private send(force = false) {
    if (!this.enabled) return;
    const now = Date.now();
    const doSend = () => {
      this.lastSent = Date.now();
      const msg = { x: round(this.me.x), y: round(this.me.y), yaw: round(this.me.yaw), src: this.mySource, ctx: this.myCtx };
      this.room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: false, topic: TOPIC }).catch(() => {});
    };
    if (force || now - this.lastSent >= SEND_EVERY_MS) {
      clearTimeout(this.sendTimer);
      doSend();
    } else {
      clearTimeout(this.sendTimer);
      this.sendTimer = window.setTimeout(doSend, SEND_EVERY_MS - (now - this.lastSent));
    }
  }

  // ---- Abonnements (carte) ---------------------------------------------------
  on(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  dispose() {
    this.setEnabled(false);
    clearTimeout(this.sendTimer);
    this.offs.forEach((f) => f());
    this.listeners.clear();
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
