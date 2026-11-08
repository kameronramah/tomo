import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Api, Attachment } from "../lib/api";
import { formatDuration, formatSize } from "../lib/voiceNote";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";

/** Ouvre une adresse dans le navigateur (téléchargement d'un fichier, image en grand…). */
export function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) openUrl(url).catch(() => window.open(url, "_blank"));
  else window.open(url, "_blank", "noopener");
}

/** Onde d'un message vocal : 48 barres, la partie déjà écoutée est colorée. */
function Waveform({ levels, progress }: { levels: string; progress: number }) {
  const bars = (levels || "3".repeat(48)).split("").map(Number);
  return (
    <span className="wave" aria-hidden="true">
      {bars.map((v, i) => (
        <span key={i} className={i / bars.length < progress ? "on" : ""} style={{ height: `${4 + v * 2.2}px` }} />
      ))}
    </span>
  );
}

/** Lecteur de message vocal (lecture / pause, avancement cliquable). */
export function VoicePlayer({ src, durationMs, waveform }: { src: string; durationMs?: number; waveform?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [fileMs, setFileMs] = useState(0);
  const total = durationMs ?? fileMs;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Durée inconnue (fichier audio glissé à la main) : on la lit dans le fichier.
    // Les WebM enregistrés par un navigateur n'indiquent pas leur durée : on force son calcul.
    const onMeta = () => {
      if (durationMs) return;
      if (Number.isFinite(a.duration)) setFileMs(a.duration * 1000);
      else {
        const fix = () => {
          a.removeEventListener("durationchange", fix);
          if (Number.isFinite(a.duration)) setFileMs(a.duration * 1000);
          a.currentTime = 0;
        };
        a.addEventListener("durationchange", fix);
        a.currentTime = 1e7;
      }
    };
    a.addEventListener("loadedmetadata", onMeta);
    const onTime = () => setTime(a.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [durationMs]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // un seul vocal à la fois
      document.querySelectorAll<HTMLAudioElement>("audio.voice-note").forEach((o) => o !== a && o.pause());
      void a.play();
    } else a.pause();
  }

  function seek(e: React.MouseEvent<HTMLButtonElement>) {
    const a = audioRef.current;
    if (!a || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = (((e.clientX - r.left) / r.width) * total) / 1000;
    setTime(a.currentTime * 1000);
  }

  const progress = total ? Math.min(1, time / total) : 0;
  return (
    <div className="voice-note-player">
      <audio ref={audioRef} className="voice-note" src={src} preload="metadata" />
      <button type="button" className="play" onClick={toggle} aria-label={playing ? t("Mettre en pause") : t("Écouter le message vocal")}>
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <button type="button" className="seek" onClick={seek} aria-label={t("Avancer dans le message vocal")}>
        <Waveform levels={waveform ?? ""} progress={progress} />
      </button>
      <span className="dur">{formatDuration(playing || time > 0 ? time : total)}</span>
    </div>
  );
}

/** Affichage d'une pièce jointe dans un message. */
export function AttachmentView({ api, att, onOpenImage }: { api: Api; att: Attachment; onOpenImage: (src: string, name: string) => void }) {
  const src = api.fileUrl(att);
  if (att.kind === "image") {
    // Taille réservée d'avance (pas de saut de la liste quand l'image arrive)
    const w = att.width ?? 320;
    const h = att.height ?? 200;
    const scale = Math.min(1, 320 / w, 240 / h);
    return (
      <button type="button" className="att-image" onClick={() => onOpenImage(src, att.name)} aria-label={t("Agrandir {0}", { 0: att.name })}>
        <img src={src} alt={att.name} width={Math.round(w * scale)} height={Math.round(h * scale)} loading="lazy" />
        {att.mime === "image/gif" && <span className="gif-tag">{t("GIF")}</span>}
      </button>
    );
  }
  if (att.kind === "audio") return <VoicePlayer src={src} durationMs={att.durationMs} waveform={att.waveform} />;
  return (
    <div className="att-file">
      <span className="att-file-icon">
        <Icon name="file" size={18} />
      </span>
      <span className="col gap-2 grow" style={{ minWidth: 0 }}>
        <span className="ellipsis strong-ish">{att.name}</span>
        <span className="muted small">{formatSize(att.size)}</span>
      </span>
      <button type="button" className="icon-btn sm" onClick={() => openExternal(src)} aria-label={t("Télécharger {0}", { 0: att.name })} title={t("Télécharger")}>
        <Icon name="download" size={16} />
      </button>
    </div>
  );
}

/** Image en grand par-dessus l'appli (Échap ou clic pour fermer). */
export function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={name} onClick={onClose}>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis">{name}</span>
        <button type="button" className="btn small" onClick={() => openExternal(src)}>
          <Icon name="download" size={15} /> {t("Ouvrir / enregistrer")}
        </button>
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t("Fermer")}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
