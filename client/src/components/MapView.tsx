import { useEffect, useReducer, useRef } from "react";
import { RoomEvent, type Room } from "livekit-client";
import { MAP_HALF, type SpatialEngine } from "../lib/spatial";
import { getSettings, updateSettings } from "../lib/prefs";
import { Icon, UserAvatar } from "./Brand";
import { useSpeaking } from "../lib/speaking";
import { t } from "../lib/i18n";

type Props = { room: Room; engine: SpatialEngine };

/**
 * Carte du salon (vue de dessus) : glisse ton avatar pour te rapprocher de quelqu'un.
 * En mode « jeu », la carte suit ta position dans le jeu et ne se déplace plus à la souris.
 */
export default function MapView({ room, engine }: Props) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const areaRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const speaking = useSpeaking(room);

  useEffect(() => {
    const off = engine.on(refresh);
    room.on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh);
    return () => {
      off();
      room.off(RoomEvent.ParticipantConnected, refresh).off(RoomEvent.ParticipantDisconnected, refresh);
    };
  }, [room, engine]);

  const range = getSettings().spatial.range;
  const game = engine.mySource === "game";
  // Mode carte : monde fixe de 60 m. Mode jeu : centré sur moi, échelle selon la portée.
  const half = game ? Math.max(range * 1.25, 10) : MAP_HALF;
  const cx = game ? engine.me.x : 0;
  const cy = game ? engine.me.y : 0;
  const toPct = (x: number, y: number) => ({
    left: `${((x - cx + half) / (2 * half)) * 100}%`,
    top: `${((cy - y + half) / (2 * half)) * 100}%`,
  });

  function moveTo(e: React.PointerEvent) {
    const el = areaRef.current;
    if (!el || game) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 * MAP_HALF - MAP_HALF;
    const y = MAP_HALF - ((e.clientY - r.top) / r.height) * 2 * MAP_HALF;
    const clamp = (v: number) => Math.max(-MAP_HALF + 1, Math.min(MAP_HALF - 1, v));
    engine.setMyPose({ x: clamp(x), y: clamp(y), yaw: 0 }, "map");
  }

  const me = room.localParticipant;
  const others = [...room.remoteParticipants.values()];
  const placed = others.filter((p) => engine.isPlaced(p.identity));
  const unplaced = others.filter((p) => !engine.isPlaced(p.identity));
  const rangePct = (range / (2 * half)) * 100;

  return (
    <div className="map-wrap">
      <div className="map-toolbar">
        <span className={`map-source${game ? " game" : ""}`}>
          <Icon name={game ? "monitor" : "orbit"} size={14} />
          {game ? t("Position du jeu : {0}", { 0: engine.gameName || "jeu" }) : t("Glisse ton avatar pour te déplacer")}
        </span>
        <label className="map-range">
          {t("Portée")}
          <input
            type="range"
            min={8}
            max={60}
            step={1}
            value={range}
            onChange={(e) => updateSettings("spatial", { range: Number(e.target.value) })}
            aria-label={t("Portée d'écoute en mètres")}
          />
          <span>{range} {t("m")}</span>
        </label>
      </div>

      <div
        ref={areaRef}
        className={`map${game ? " game" : ""}`}
        onPointerDown={(e) => {
          if (game) return;
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        role="application"
        aria-label={t("Carte du salon : clique ou glisse pour déplacer ton avatar")}
      >
        {/* Portée d'écoute autour de moi */}
        <span className="map-range-ring" style={{ ...toPct(engine.me.x, engine.me.y), width: `${rangePct * 2}%`, height: `${rangePct * 2}%` }} />

        {placed.map((p) => {
          const r = engine.remotes.get(p.identity)!;
          const d = engine.distanceTo(p.identity) ?? 0;
          const audible = d <= range;
          return (
            <span key={p.identity} className={`map-pin${audible ? "" : " far"}`} style={toPct(r.x, r.y)} title={t("{0} · {1} m", { 0: p.name || p.identity, 1: Math.round(d) })}>
              <UserAvatar identity={p.identity} name={p.name || p.identity} size={38} speaking={speaking.has(p.identity) && audible} />
              <span className="map-label">
                {p.name || p.identity}
                <em>{Math.round(d)} {t("m")}</em>
              </span>
            </span>
          );
        })}

        <span className="map-pin me" style={toPct(engine.me.x, engine.me.y)}>
          {game && <span className="map-facing" style={{ transform: `rotate(${engine.me.yaw}rad)` }} />}
          <UserAvatar identity={me.identity} name={me.name || me.identity} size={44} speaking={speaking.has(me.identity)} />
          <span className="map-label">{t("Toi")}</span>
        </span>
      </div>

      {unplaced.length > 0 && (
        <div className="map-unplaced muted small">
          <Icon name="info" size={14} />
          <span>
            {t("Entendu")}{unplaced.length > 1 ? "s" : ""} {t("normalement, sans 3D :")}{" "}
            {unplaced.map((p, i) => (
              <span key={p.identity}>
                {i > 0 && " · "}
                <strong className="soft">{p.name || p.identity}</strong> ({engine.unplacedReason(p.identity)})
              </span>
            ))}
          </span>
        </div>
      )}

      <button className="link small" onClick={() => updateSettings("spatial", { showMap: false })}>
        {t("Afficher les tuiles à la place de la carte")}
      </button>
    </div>
  );
}
