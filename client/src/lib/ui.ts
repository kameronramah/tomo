/** Petites aides d'affichage. */

const PALETTE = [
  { bg: "#2DD4BF", fg: "#062A26" },
  { bg: "#A78BFA", fg: "#1E1236" },
  { bg: "#60A5FA", fg: "#0B1F3A" },
  { bg: "#F472B6", fg: "#3A0B24" },
  { bg: "#FFB020", fg: "#3A2604" },
  { bg: "#A3E635", fg: "#1C2A05" },
];

/** Couleur stable dérivée du nom. */
export function colorFor(name: string) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string, max = 2): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const raw = words.length === 1 ? words[0].slice(0, max) : words.slice(0, max).map((w) => w[0]).join("");
  return raw.toUpperCase();
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatExpiry(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `aujourd'hui à ${time}` : `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${time}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 || h >= 18 ? "Bonsoir" : "Bonjour";
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Créateur",
  admin: "Admin",
  member: "Membre",
  guest: "Invité",
};
