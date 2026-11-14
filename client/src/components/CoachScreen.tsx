import { useEffect, useRef, useState } from "react";
import type { CoachScreenState } from "../lib/coachScreen";
import { drawMarks } from "../lib/coach";
import { t } from "../lib/i18n";

/**
 * Fenêtre « coach-screen » : plein écran, transparente, traversée par les clics.
 * Dessine les traits de tes potes directement sur ton écran partagé.
 */
export default function CoachScreen() {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<CoachScreenState>({ marks: [], requests: [] });
  const [requests, setRequests] = useState<CoachScreenState["requests"]>([]);

  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<CoachScreenState>("coach:state", (e) => {
        state.current = e.payload;
        setRequests(e.payload.requests);
      }).then((u) => (off = u)),
    );
    let raf = 0;
    const loop = () => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawMarks(ctx, state.current.marks, w, h);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      off?.();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="coach-screen-canvas" />
      {requests.length > 0 && (
        <div className="coach-screen-banner">
          {requests.map((r) => (
            <div key={r.identity}>{t("{0} veut annoter ton écran : réponds dans Tomo", { 0: r.name })}</div>
          ))}
        </div>
      )}
    </>
  );
}
