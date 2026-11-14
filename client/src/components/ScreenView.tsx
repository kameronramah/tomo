import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { VideoQuality, type RemoteParticipant, type RemoteTrackPublication, type Room } from "livekit-client";
import { viewersOf, type Share } from "../lib/screen";
import { screenVolumeMemory, setParticipantVolume, setScreenVolume, volumeMemory } from "../lib/voice";
import { Icon, SpeakingBars, UserAvatar } from "./Brand";
import { useSpeaking } from "../lib/speaking";
import { t } from "../lib/i18n";
import CoachLayer from "./CoachLayer";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Props = {
  room: Room;
  shares: Share[];
  /** Identité de celui dont on regarde l'écran. */
  selected: string;
  onSelect: (identity: string) => void;
  /** Quitter le partage (on reste dans la pièce). */
  onClose: () => void;
  onStopMine: () => void;
  onSwitchMine?: () => void;
  onCapture?: (png: Blob) => void;
};

/** Grand écran pour regarder le partage choisi (passer à un autre, plein écran, qualité reçue). */
export default function ScreenView({ room, shares, selected, onSelect, onClose, onStopMine, onSwitchMine, onCapture }: Props) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [full, setFull] = useState(false);
  const [stats, setStats] = useState<{ w: number; h: number; fps: number }>({ w: 0, h: 0, fps: 0 });
  const [, setTick] = useState(0);
  const speaking = useSpeaking(room);
  const videoRef = useRef<HTMLVideoElement>(null);

  const current = shares.find((s) => s.participant.identity === selected) ?? shares[0];
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

  // Le partage regardé : pleine qualité. Les autres : en pause (rien n'est téléchargé).
  const currentPub = current?.publication;
  useEffect(() => {
    const remotes = shares.filter((s) => !s.isLocal).map((s) => s.publication as RemoteTrackPublication);
    for (const pub of remotes) {
      const on = pub === currentPub;
      pub.setEnabled(on);
      if (on) pub.setVideoQuality(VideoQuality.HIGH);
    }
  }, [shares, currentPub, track]);
  const sharesRef = useRef(shares);
  sharesRef.current = shares;
  useEffect(
    () => () => {
      for (const s of sharesRef.current) if (!s.isLocal) (s.publication as RemoteTrackPublication).setEnabled(false);
    },
    [],
  );

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

  const people = [room.localParticipant, ...room.remoteParticipants.values()];
  const viewers = viewersOf(room, current.participant.identity);

  return (
    <div className={`screen-view${full ? " full" : ""}`}>
      <div className="screen-main">
      <div className="screen-bar">
        <button className="btn pill small screen-back" onClick={onClose} title={t("Fermer le partage (tu restes dans la pièce)")}>
          <Icon name="chevronLeft" size={16} /> {t("Retour au vocal")}
        </button>
        <span className="row gap-8 grow">
          <UserAvatar identity={current.participant.identity} name={who} size={26} speaking={speaking.has(current.participant.identity)} />
          <strong className="ellipsis">{current.isLocal ? t("Ton écran") : t("Écran de {0}", { 0: who })}</strong>
          <span className="screen-quality" title={t("Qualité reçue")}>
            {quality}
          </span>
          {viewers.length > 0 && (
            <span className="muted small screen-viewers" title={viewers.map((p) => p.name || p.identity).join(", ")}>
              <Icon name="eye" size={14} /> {viewers.length}
            </span>
          )}
        </span>
        {current.hasAudio && !current.isLocal && (
          <label className="screen-volume" title={t("Volume du son partagé")}>
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
              aria-label={t("Volume du son partagé par {0}", { 0: who })}
            />
          </label>
        )}
        {current.isLocal && onSwitchMine && (
          <button className="btn small" onClick={onSwitchMine} title={t("Changer d'écran ou de fenêtre")}>
            {t("Changer d'écran")}
          </button>
        )}
        {current.isLocal && (
          <button className="btn small danger" onClick={onStopMine}>
            {t("Arrêter le partage")}
          </button>
        )}
        <button className="icon-btn" onClick={() => setFull(!full)} aria-label={full ? t("Quitter le plein écran") : t("Plein écran")} title={full ? t("Quitter le plein écran (Échap)") : t("Plein écran")}>
          <Icon name={full ? "minimize" : "maximize"} />
        </button>
      </div>

      <div className="screen-stage" onDoubleClick={() => setFull(!full)}>
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el !== videoEl) setVideoEl(el);
          }}
          autoPlay
          playsInline
          muted
          className="screen-video"
        />
        {current.isLocal && <span className="screen-note">{t("Aperçu de ce que voient tes potes")}</span>}
        <CoachLayer key={current.participant.identity} room={room} share={current.participant.identity} isMine={current.isLocal} video={videoEl} onCapture={onCapture} />
      </div>

      {shares.length > 1 && (
        <div className="screen-picker" role="tablist" aria-label={t("Partages en cours")}>
          {shares.map((s) => {
            const name = s.participant.name || s.participant.identity;
            const on = s === current;
            return (
              <button key={s.participant.identity} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => onSelect(s.participant.identity)}>
                <Icon name="monitor" size={15} /> {s.isLocal ? t("Ton écran") : name}
              </button>
            );
          })}
        </div>
      )}

      </div>

      {/* Qui est là : une liste à droite de l'écran (le volume de chacun s'ouvre au survol) */}
      <aside className="screen-side" aria-label={t("Dans la pièce")}>
        <span className="screen-side-title">{t("Dans la pièce · {0}", { 0: people.length })}</span>
        {people.map((p) => {
          const name = p.name || p.identity;
          const isMe = p === room.localParticipant;
          const talking = speaking.has(p.identity);
          const muted = !p.isMicrophoneEnabled;
          return (
            <div key={p.identity} className={`screen-row${talking ? " speaking" : ""}`}>
              <div className="screen-row-main">
                <UserAvatar identity={p.identity} name={name} size={34} />
                <span className="grow col">
                  <strong className="ellipsis">
                    {name}
                    {isMe && <span className="muted"> {t("(toi)")}</span>}
                  </strong>
                  <span className={`small ellipsis${muted ? " screen-row-muted" : talking ? " teal-soft" : " muted"}`}>
                    {muted ? t("micro coupé") : talking ? t("parle") : p.isScreenShareEnabled ? t("partage son écran") : ""}
                  </span>
                </span>
                {talking && <SpeakingBars />}
                {muted && <Icon name="micOff" size={15} label={t("Micro coupé")} />}
                {p.isScreenShareEnabled && (
                  <span className="amber">
                    <Icon name="screenShare" size={15} label={t("Partage son écran")} />
                  </span>
                )}
              </div>
              {!isMe && (
                <label className="volume">
                  <Icon name="volume" size={14} />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumeMemory.get(name) ?? 1}
                    onChange={(e) => {
                      setParticipantVolume(p as RemoteParticipant, Number(e.target.value));
                      setTick((x) => x + 1);
                    }}
                    aria-label={t("Volume de {0}", { 0: name })}
                  />
                </label>
              )}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
