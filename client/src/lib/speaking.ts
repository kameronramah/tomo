/**
 * Détection « qui parle » faite directement sur le son reçu (et sur mon micro).
 *
 * Pourquoi : l'info « qui parle » de LiveKit vient du serveur, qui lisse le niveau sonore
 * avant de prévenir → le contour turquoise arrivait en retard (souvent ~0,5 s) et restait
 * allumé après la fin de la phrase. Ici on mesure le volume de chaque voix toutes les 40 ms :
 * le contour s'allume dès le premier mot et s'éteint peu après la fin.
 */
import { useEffect, useState } from "react";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";

/** Seuil en dBFS au-dessus duquel on considère que la personne parle. */
const THRESHOLD_DB = -50;
/** Le contour reste allumé un court instant après la dernière syllabe (évite le clignotement). */
const HOLD_MS = 280;
const TICK_MS = 40;

type Probe = { track: MediaStreamTrack; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> };

export class SpeakingDetector {
  private ctx = new AudioContext();
  private probes = new Map<string, Probe>(); // clé : identité du participant
  private lastLoud = new Map<string, number>();
  private current = new Set<string>();
  private listeners = new Set<(s: ReadonlySet<string>) => void>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private room: Room) {
    void this.ctx.resume().catch(() => {});
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get speaking(): ReadonlySet<string> {
    return this.current;
  }

  onChange(fn: (s: ReadonlySet<string>) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private micTrack(p: Participant): MediaStreamTrack | null {
    const pub = p.getTrackPublication(Track.Source.Microphone);
    if (!pub || pub.isMuted || !pub.track) return null;
    // Mon micro : on écoute ce qui part vraiment (après suppression de bruit, porte, push-to-talk)
    const processed = (pub.track as { getProcessor?: () => { processedTrack?: MediaStreamTrack } | undefined }).getProcessor?.()?.processedTrack;
    const t = processed ?? pub.track.mediaStreamTrack;
    return t && t.readyState === "live" ? t : null;
  }

  private probeFor(identity: string, track: MediaStreamTrack): Probe | null {
    const old = this.probes.get(identity);
    if (old && old.track === track) return old;
    if (old) this.dropProbe(identity);
    try {
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser); // non relié aux haut-parleurs : on mesure seulement
      const probe = { track, source, analyser, buf: new Float32Array(analyser.fftSize) };
      this.probes.set(identity, probe);
      return probe;
    } catch {
      return null;
    }
  }

  private dropProbe(identity: string) {
    const p = this.probes.get(identity);
    if (!p) return;
    p.source.disconnect();
    p.analyser.disconnect();
    this.probes.delete(identity);
  }

  private tick() {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    const now = performance.now();
    const next = new Set<string>();
    const seen = new Set<string>();
    const participants: Participant[] = [this.room.localParticipant, ...this.room.remoteParticipants.values()];

    for (const p of participants) {
      seen.add(p.identity);
      const track = this.micTrack(p);
      if (!track) {
        this.dropProbe(p.identity);
        continue;
      }
      const probe = this.probeFor(p.identity, track);
      let loud: boolean;
      if (probe) {
        probe.analyser.getFloatTimeDomainData(probe.buf);
        let sum = 0;
        for (const v of probe.buf) sum += v * v;
        const db = 10 * Math.log10(sum / probe.buf.length + 1e-12);
        loud = db > THRESHOLD_DB;
      } else {
        loud = p.isSpeaking; // secours : l'info du serveur
      }
      if (loud) this.lastLoud.set(p.identity, now);
      if (now - (this.lastLoud.get(p.identity) ?? -Infinity) < HOLD_MS) next.add(p.identity);
    }

    for (const id of [...this.probes.keys()]) if (!seen.has(id)) this.dropProbe(id);
    for (const id of [...this.lastLoud.keys()]) if (!seen.has(id)) this.lastLoud.delete(id);

    if (next.size !== this.current.size || [...next].some((id) => !this.current.has(id))) {
      this.current = next;
      this.listeners.forEach((l) => l(next));
    }
  }

  dispose() {
    clearInterval(this.timer);
    for (const id of [...this.probes.keys()]) this.dropProbe(id);
    this.listeners.clear();
    void this.ctx.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Un détecteur par connexion vocale
// ---------------------------------------------------------------------------
const detectors = new WeakMap<Room, SpeakingDetector>();

export function speakingDetector(room: Room): SpeakingDetector {
  let d = detectors.get(room);
  if (!d) {
    const created = new SpeakingDetector(room);
    detectors.set(room, created);
    room.once(RoomEvent.Disconnected, () => {
      created.dispose();
      detectors.delete(room);
    });
    d = created;
  }
  return d;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Ensemble des identités qui parlent en ce moment (se met à jour tout seul). */
export function useSpeaking(room: Room | null | undefined): ReadonlySet<string> {
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    if (!room) {
      setSpeaking(EMPTY);
      return;
    }
    const d = speakingDetector(room);
    setSpeaking(d.speaking);
    return d.onChange(setSpeaking);
  }, [room]);
  return speaking;
}
