import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RemoteParticipant, Room } from "livekit-client";
import type { Share } from "../lib/screen";
import { screenVolumeMemory, setScreenVolume } from "../lib/voice";
import { Avatar, Icon } from "./Brand";
import { useSpeaking } from "../lib/speaking";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Props = {
  room: Room;
  shares: Share[];
  onStopMine: () => void;
};

/** Grand écran pour regarder un partage (choix si plusieurs, plein écran, qualité reçue). */
export default function ScreenView({ room, shares, onStopMine }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [stats, setStats] = useState<{ w: number; h: number; fps: number }>({ w: 0, h: 0, fps: 0 });
  const [, setTick] = useState(0);
  const speaking = useSpeaking(room);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Par défaut : le partage d'un autre (pas le mien)
  const current =
    shares.find((s) => s.participant.identity === selected) ?? shares.find((s) => !s.isLocal) ?? shares[0];
  const track = current?.publication.track;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    el.muted = true; // le son passe par le moteur audio de Tomo, pas par l'élément vidéo
    // Images par seconde réellement affichées
    let frames = 0;
    let last = performance.now();
    let handle = 0;
    const onFrame = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setStats({ w: el.videoWidth, h: el.videoHeight, fps: Math.round((frames * 1000) / (now - last)) });
        frames = 0;
        last = now;
      }
      handle = el.requestVideoFrameCallback(onFrame);
    };
    handle = el.requestVideoFrameCallback(onFrame);
    return () => {
      el.cancelVideoFrameCallback(handle);
      track.detach(el);
    };
  }, [track]);

  // Plein écran : la vidéo couvre la fenêtre, et la fenêtre passe en plein écran.
  useEffect(() => {
    if (inTauri) getCurrentWindow().setFullscreen(full).catch(() => {});
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  useEffect(() => () => void (inTauri && getCurrentWindow().setFullscreen(false).catch(() => {})), []);

  if (!current) return null;
  const who = current.participant.name || current.participant.identity;
  const remote = current.participant as RemoteParticipant;
  const volume = screenVolumeMemory.get(who) ?? 1;
  const quality = stats.h ? `${stats.h >= 2100 ? "4K" : `${stats.h}p`} · ${stats.fps} i/s` : "connexion…";

  return (
    <div className={`screen-view${full ? " full" : ""}`}>
      <div className="screen-bar">
        <span className="row gap-8 grow">
          <Avatar name={who} size={26} speaking={speaking.has(current.participant.identity)} />
          <strong className="ellipsis">{current.isLocal ? "Ton écran" : `Écran de ${who}`}</strong>
          <span className="screen-quality" title="Qualité reçue">
            {quality}
          </span>
        </span>
        {current.hasAudio && !current.isLocal && (
          <label className="screen-volume" title="Volume du son partagé">
            <Icon name="volume" size={16} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                setScreenVolume(remote, Number(e.target.value));
                setTick((t) => t + 1);
              }}
              aria-label={`Volume du son partagé par ${who}`}
            />
          </label>
        )}
        {current.isLocal && (
          <button className="btn small danger" onClick={onStopMine}>
            Arrêter le partage
          </button>
        )}
        <button className="icon-btn" onClick={() => setFull(!full)} aria-label={full ? "Quitter le plein écran" : "Plein écran"} title={full ? "Quitter le plein écran (Échap)" : "Plein écran"}>
          <Icon name={full ? "minimize" : "maximize"} />
        </button>
      </div>

      <div className="screen-stage" onDoubleClick={() => setFull(!full)}>
        <video ref={videoRef} autoPlay playsInline muted className="screen-video" />
        {current.isLocal && <span className="screen-note">Aperçu de ce que voient tes potes</span>}
      </div>

      {shares.length > 1 && (
        <div className="screen-picker" role="tablist" aria-label="Partages en cours">
          {shares.map((s) => {
            const name = s.participant.name || s.participant.identity;
            const on = s === current;
            return (
              <button key={s.participant.identity} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => setSelected(s.participant.identity)}>
                <Icon name="monitor" size={15} /> {s.isLocal ? "Ton écran" : name}
              </button>
            );
          })}
        </div>
      )}

      {/* Les autres participants, en petit */}
      <div className="screen-people">
        {[room.localParticipant, ...room.remoteParticipants.values()].map((p) => (
          <span key={p.identity} className="screen-person" title={p.name || p.identity}>
            <Avatar name={p.name || p.identity} size={30} speaking={speaking.has(p.identity)} />
            {!p.isMicrophoneEnabled && (
              <span className="mini-muted">
                <Icon name="micOff" size={10} />
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
