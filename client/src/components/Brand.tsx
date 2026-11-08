import { colorFor, initials } from "../lib/ui";

/** Logo Tomo : deux bulles qui se répondent. `cut` = couleur du fond (découpe entre les bulles). */
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
      Tom<span className="amber">o</span>
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
  flask: ["M9 3h6", "M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3", "M7 15h10"],
  login: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 17l5-5-5-5", "M15 12H3"],
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
}: {
  name: string;
  size?: number;
  speaking?: boolean;
  className?: string;
}) {
  const c = colorFor(name);
  return (
    <span
      className={`avatar${speaking ? " speaking" : ""} ${className}`}
      style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: size * 0.38 }}
    >
      {initials(name, 1)}
    </span>
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
    <span className="speaking-bars" aria-label="En train de parler" role="img">
      <span />
      <span />
      <span />
    </span>
  );
}
