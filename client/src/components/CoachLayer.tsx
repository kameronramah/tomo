import { useEffect, useReducer, useRef, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import { canAnnotate, coachActive, coachFor, drawMarks, type Tool } from "../lib/coach";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";

/** Zone réellement occupée par l'image dans la vidéo (object-fit: contain). */
function contentRect(v: HTMLVideoElement) {
  const W = v.clientWidth;
  const H = v.clientHeight;
  const vw = v.videoWidth || 16;
  const vh = v.videoHeight || 9;
  const s = Math.min(W / vw, H / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Re-rend quand le mode coach ou les autorisations changent. */
function useCoach(room: Room) {
  const coach = coachFor(room);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = coach.on(tick);
    room.on(RoomEvent.ParticipantAttributesChanged, tick);
    return () => {
      off();
      room.off(RoomEvent.ParticipantAttributesChanged, tick);
    };
  }, [coach, room]);
  return coach;
}

/**
 * Calque d'annotations par-dessus la vidéo d'un partage d'écran (mode coach),
 * avec la barre d'outils. `share` = identité de celui qui partage.
 */
export default function CoachLayer({
  room,
  share,
  isMine,
  video,
  onCapture,
}: {
  room: Room;
  share: string;
  isMine: boolean;
  video: HTMLVideoElement | null;
  onCapture?: (png: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coach = useCoach(room);
  const [tool, setTool] = useState<Tool | null>(null);
  const drawing = useRef<{ id: string; pts: [number, number][]; last: number } | null>(null);

  const me = room.localParticipant.identity;
  const sharer = share === me ? room.localParticipant : room.remoteParticipants.get(share);
  const allowed = canAnnotate(sharer, me);
  const asked = coach.asked.get(share);
  useEffect(() => {
    if (!allowed) setTool(null);
  }, [allowed]);

  // Dessin : ~60 images/s
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = canvasRef.current;
      if (c && video) {
        const r = contentRect(video);
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(r.w * dpr) || c.height !== Math.round(r.h * dpr)) {
          c.width = Math.round(r.w * dpr);
          c.height = Math.round(r.h * dpr);
        }
        Object.assign(c.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, r.w, r.h);
        drawMarks(ctx, coach.visible(share), r.w, r.h);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [coach, share, video]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const b = canvasRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))];
  };

  function down(e: React.PointerEvent) {
    if (!tool || !allowed) return;
    e.preventDefault();
    e.stopPropagation();
    const id = crypto.randomUUID();
    if (tool === "ping") {
      coach.send(share, id, "ping", [pos(e)]);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = { id, pts: [pos(e)], last: 0 };
  }
  function move(e: React.PointerEvent) {
    const d = drawing.current;
    if (!d || !tool) return;
    const p = pos(e);
    if (tool === "arrow") d.pts = [d.pts[0], p];
    else d.pts.push(p);
    const now = performance.now();
    if (now - d.last > 66) {
      d.last = now;
      coach.send(share, d.id, tool, d.pts.slice(-400));
    }
  }
  function up() {
    const d = drawing.current;
    if (d && tool) coach.send(share, d.id, tool, d.pts.slice(-400));
    drawing.current = null;
  }

  /** Image annotée : l'image du partage + les traits encore visibles. */
  async function capture() {
    if (!video || !onCapture) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);
    drawMarks(ctx, coach.visible(share), w, h);
    c.toBlob((b) => b && onCapture(b), "image/png");
  }

  const openAll = isMine && coach.allowed() === "all";
  const allowedNames = isMine && coach.allowed() !== "all" ? (coach.allowed() as string[]).map((id) => ({ id, name: room.remoteParticipants.get(id)?.name || id })) : [];

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`coach-canvas${tool && allowed ? " drawing" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => tool && e.stopPropagation()}
      />
      <div className="coach-bar" role="toolbar" aria-label={t("Mode coach")}>
        {isMine && (
          <>
            <button className={`coach-btn${openAll ? " on" : ""}`} onClick={() => void coach.setOpenToAll(!openAll)} title={t("Tout le monde peut annoter sans demander")}>
              <Icon name="users" size={15} /> {openAll ? t("Ouvert à tous") : t("Ouvrir à tous")}
            </button>
            {allowedNames.map((p) => (
              <button key={p.id} className="coach-btn on" onClick={() => void coach.revoke(p.id)} title={t("Retirer l'autorisation de {0}", { 0: p.name })}>
                {p.name} <Icon name="x" size={13} />
              </button>
            ))}
          </>
        )}
        {!isMine && !allowed && (
          <>
            {asked === "pending" ? (
              <span className="coach-hint">{t("Demande envoyée, en attente de réponse…")}</span>
            ) : (
              <>
                {asked === "refused" && <span className="coach-hint">{t("Demande refusée.")}</span>}
                <button className="coach-btn" onClick={() => coach.ask(share)}>
                  <Icon name="pen" size={15} /> {asked === "refused" ? t("Redemander") : t("Demander à annoter")}
                </button>
              </>
            )}
          </>
        )}
        {allowed && (
          <>
            {(
              [
                ["pen", "pen", t("Crayon")],
                ["arrow", "chevronRight", t("Flèche")],
                ["ping", "orbit", t("Ping")],
              ] as const
            ).map(([id, icon, label]) => (
              <button key={id} className={`coach-btn${tool === id ? " on" : ""}`} onClick={() => setTool(tool === id ? null : id)} aria-pressed={tool === id} title={label}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
            <button className="coach-btn" onClick={() => coach.clearMine(share)} title={t("Effacer mes traits")}>
              <Icon name="x" size={15} />
            </button>
          </>
        )}
        {onCapture && (allowed || coachActive(sharer)) && (
          <button className="coach-btn" onClick={() => void capture()} title={t("Envoyer l'image annotée dans le chat de la pièce")}>
            <Icon name="image" size={15} /> {t("Capturer")}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Demandes d'annotation reçues quand je partage mon écran : « Mila veut annoter ton écran ».
 * Affiché dans la scène vocale, quel que soit l'affichage en cours.
 */
export function CoachRequests({ room }: { room: Room }) {
  const coach = useCoach(room);
  if (!coach.requests.length) return null;
  return (
    <div className="coach-requests" role="alert">
      {coach.requests.map((r) => (
        <div key={r.identity} className="coach-request">
          <Icon name="pen" size={16} />
          <span className="grow">{t("{0} veut annoter ton écran", { 0: r.name })}</span>
          <button className="btn primary small" onClick={() => void coach.answer(r.identity, true)}>
            {t("Autoriser")}
          </button>
          <button className="btn small" onClick={() => void coach.answer(r.identity, false)}>
            {t("Refuser")}
          </button>
        </div>
      ))}
    </div>
  );
}
