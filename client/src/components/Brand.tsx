import { useEffect, useReducer } from "react";
import type { Room } from "livekit-client";
import { colorFor, initials } from "../lib/ui";
import { networkInfo } from "../lib/voice";
import type { Presence } from "../lib/api";
import { STATUS_LABEL, getPerson, usePeople, userIdOf } from "../lib/people";
import { t } from "../lib/i18n";

/**
 * Avatar d'une personne d'après l'annuaire : sa photo et son nom affiché à jour.
 * `userId` (compte) ou `identity` (vocal : u:<id>) ; `name` sert tant que le profil n'est pas chargé.
 */
export function UserAvatar({
  userId,
  identity,
  name,
  size,
  speaking,
  className,
  showStatus = false,
}: {
  userId?: string | null;
  identity?: string;
  name: string;
  size?: number;
  speaking?: boolean;
  className?: string;
  showStatus?: boolean;
}) {
  const id = userId ?? (identity ? userIdOf(identity) : null);
  usePeople(id ? [id] : []);
  const p = getPerson(id);
  return (
    <Avatar
      name={p?.displayName ?? name}
      src={p?.avatarUrl}
      size={size}
      speaking={speaking}
      className={className}
      status={showStatus ? (p?.status ?? "offline") : undefined}
    />
  );
}

/** Nom affiché à jour d'une personne (son pseudo tant que le profil n'est pas chargé). */
export function useDisplayName(userId: string | null | undefined, fallback: string) {
  usePeople(userId ? [userId] : []);
  return getPerson(userId)?.displayName ?? fallback;
}

/** Barres de signal + ping (ms), mis à jour toutes les 2 s. */
export function NetworkBadge({ room, showLabel = false }: { room: Room | null; showLabel?: boolean }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);
  const n = networkInfo(room);
  const cls = n.level >= 2 ? "good" : n.level === 1 ? "poor" : "unknown";
  return (
    <span className={`net ${cls}`} title={t("Qualité réseau {0}{1}", { 0: n.label, 1: n.rtt !== null ? ` · ping ${n.rtt} ms` : "" })}>
      <span className="net-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= n.level ? "on" : ""} style={{ height: 3 + i * 3 }} />
        ))}
      </span>
      <span className="net-ms">{n.rtt !== null ? `${n.rtt} ms` : t("— ms")}</span>
      {showLabel && <span className="net-label">{t("· connexion")} {n.label}</span>}
    </span>
  );
}

/** Logo tomo : deux bulles qui se répondent. `cut` = couleur du fond (découpe entre les bulles). */
export function Logo({ size = 28, cut = "var(--panel)" }: { size?: number; cut?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path
        d="M34 22h12a12 12 0 0 1 12 12v4a12 12 0 0 1-12 12h-2v8l-9-8h-1a12 12 0 0 1-12-12v-4a12 12 0 0 1 12-12z"
        fill="var(--amber)"
      />
      <path
        d="M18 6h12a12 12 0 0 1 12 12v4a12 12 0 0 1-12 12h-1l-9 8v-8h-2A12 12 0 0 1 6 22v-4A12 12 0 0 1 18 6z"
        fill="var(--teal)"
        stroke={cut}
        strokeWidth="3"
      />
      <rect x="15.5" y="16" width="3" height="8" rx="1.5" fill={cut} />
      <rect x="22.5" y="12" width="3" height="16" rx="1.5" fill={cut} />
      <rect x="29.5" y="16" width="3" height="8" rx="1.5" fill={cut} />
    </svg>
  );
}

export function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      {t("tom")}<span className="amber">{t("o")}</span>
    </span>
  );
}

const PATHS: Record<string, string[]> = {
  mic: ["M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z", "M5 10a7 7 0 0 0 14 0", "M12 17v4"],
  micOff: ["M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z", "M5 10a7 7 0 0 0 14 0", "M12 17v4", "M3 3l18 18"],
  headphones: ["M3 14v-2a9 9 0 0 1 18 0v2", "M3 14h4v7H5a2 2 0 0 1-2-2z", "M21 14h-4v7h2a2 2 0 0 0 2-2z"],
  headphonesOff: ["M3 14v-2a9 9 0 0 1 18 0v2", "M3 14h4v7H5a2 2 0 0 1-2-2z", "M21 14h-4v7h2a2 2 0 0 0 2-2z", "M3 3l18 18"],
  sliders: ["M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12", "M16 4v4M10 10v4M18 16v4"],
  leave: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 17l-5-5 5-5", "M5 12h11"],
  speaker: ["M11 5L6 9H3v6h3l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7"],
  speakerLoud: ["M11 5L6 9H3v6h3l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  orbit: ["M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", "M2 12c0-2.5 4.5-4.5 10-4.5s10 2 10 4.5-4.5 4.5-10 4.5S2 14.5 2 12z"],
  userPlus: ["M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M2 21a7 7 0 0 1 14 0", "M19 8v6M16 11h6"],
  plus: ["M12 5v14M5 12h14"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronUp: ["M6 15l6-6 6 6"],
  check: ["M5 12l5 5L20 7"],
  rewind: ["M11 19l-7-7 7-7v14z", "M20 19l-7-7 7-7v14z"],
  lock: ["M4 11h16v10H4z", "M8 11V7a4 4 0 0 1 8 0v4"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"],
  eyeOff: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z", "M3 3l18 18"],
  more: ["M5 12h.01M12 12h.01M19 12h.01"],
  settings: ["M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  trash: ["M4 7h16", "M10 11v6M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M14 6l4 4"],
  logout: ["M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3", "M16 17l5-5-5-5", "M21 12H9"],
  users: ["M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M2 21a7 7 0 0 1 14 0", "M17 4a4 4 0 0 1 0 8", "M22 21a7 7 0 0 0-4-6.3"],
  key: ["M15 3a6 6 0 1 1-5.2 9L3 18.8V21h3v-2h2v-2h2l1.2-1.2A6 6 0 0 1 15 3z", "M16.5 7.5h.01"],
  x: ["M6 6l12 12M18 6L6 18"],
  maximize: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  minimize: ["M4 14h6v6", "M20 10h-6V4", "M14 10l7-7", "M3 21l7-7"],
  screenShare: ["M3 4h18v12H3z", "M8 20h8M12 16v4", "M12 13V7", "M9 10l3-3 3 3"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  hash: ["M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"],
  chat: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"],
  phone: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"],
  phoneOff: ["M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 4.2 2 2 0 0 1 5 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L9 9.8", "M22 2L2 22"],
  userCheck: ["M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M2 21a7 7 0 0 1 14 0", "M16 11l2 2 4-4"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  monitor: ["M3 4h18v12H3z", "M8 20h8M12 16v4"],
  keyboard: ["M2 6h20v12H2z", "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"],
  info: ["M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z", "M12 16v-4M12 8h.01"],
  signal: ["M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4"],
  user: ["M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M4 21a8 8 0 0 1 16 0"],
  volume: ["M11 5L6 9H3v6h3l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  flask: ["M9 3h6", "M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3", "M7 15h10"],
  login: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 17l5-5-5-5", "M15 12H3"],
  paperclip: ["M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"],
  play: ["M8 5.5v13l11-6.5z"],
  smile: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z", "M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5", "M9.5 10h.01M14.5 10h.01"],
  power: ["M12 3v8", "M6.3 6.3a8 8 0 1 0 11.4 0"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
  mail: ["M4 6h16v12H4z", "M4 7l8 6 8-6"],
  folder: ["M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"],
  chevronRight: ["M9 6l6 6-6 6"],
  chevronLeft: ["M15 6l-6 6 6 6"],
  sidebar: ["M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", "M9 4.5v15"],
  search: ["M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M20 20l-4-4"],
  pause: ["M8 5v14M16 5v14"],
  download: ["M12 4v11", "M7.5 10.5 12 15l4.5-4.5", "M5 20h14"],
  gamepad: ["M6.5 8h11a4 4 0 0 1 3.9 4.9l-.9 4a2.5 2.5 0 0 1-4.3 1.1L14.5 16h-5l-1.7 2a2.5 2.5 0 0 1-4.3-1.1l-.9-4A4 4 0 0 1 6.5 8z", "M8 11v3M6.5 12.5h3", "M15.5 12h.01M17.5 13.5h.01"],
  trophy: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4", "M12 13v4", "M8.5 20h7l-1-3h-5z"],
  pin: ["M9 4h6l-1 5 3 3H7l3-3z", "M12 12v8"],
  captions: ["M3 5h18v14H3z", "M7 10h3M7 14h6M14 10h3M16 14h1"],
  pen: ["M4 20l4-1L19 8l-3-3L5 16z", "M14 7l3 3"],
  chart: ["M4 20V10M10 20V4M16 20v-7M22 20H2"],
  star: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  image: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 10.5a1.5 1.5 0 1 0 0-.01", "M4 18l5-5 4 4 3-3 4 4"],
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function Avatar({
  name,
  size = 36,
  speaking = false,
  className = "",
  src,
  status,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
  className?: string;
  /** Photo de profil (sinon : initiales sur fond coloré) */
  src?: string | null;
  /** Pastille de statut (en ligne, inactif, ne pas déranger, hors ligne) */
  status?: Presence;
}) {
  const c = colorFor(name);
  const face = (
    <span
      className={`avatar${speaking ? " speaking" : ""}${src ? " photo" : ""} ${className}`}
      style={{ width: size, height: size, background: src ? undefined : c.bg, color: c.fg, fontSize: size * 0.38 }}
    >
      {src ? <img src={src} alt="" draggable={false} /> : initials(name, 1)}
    </span>
  );
  if (!status) return face;
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span className="avatar-wrap">
      {face}
      <StatusDot status={status} size={dot} />
    </span>
  );
}

/** Pastille de statut : forme ET couleur différentes (lisible aussi pour les daltoniens). */
export function StatusDot({ status, size = 12, inline = false }: { status: Presence | "invisible"; size?: number; inline?: boolean }) {
  return (
    <span
      className={`st-dot st-${status}${inline ? " inline" : ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  );
}

/** Petite pastille carrée aux initiales d'un serveur. */
export function ServerBadge({ name, size = 40 }: { name: string; size?: number }) {
  const c = colorFor(name);
  return (
    <span className="server-badge" style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: size * 0.32 }}>
      {initials(name)}
    </span>
  );
}

/** Trois barres animées « en train de parler ». */
export function SpeakingBars() {
  return (
    <span className="speaking-bars" aria-label={t("En train de parler")} role="img">
      <span />
      <span />
      <span />
    </span>
  );
}
