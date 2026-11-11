import { locale, t } from "./i18n";
/** Petites aides d'affichage. */

// Fond sombre teinté + initiales claires (refonte v0.12) : plus doux que des pastilles vives.
const PALETTE = [
  { bg: "#143A36", fg: "#5EEAD4" },
  { bg: "#2C2445", fg: "#C4B5FD" },
  { bg: "#1D2C45", fg: "#9CC2FF" },
  { bg: "#3A1F2B", fg: "#F5A3C0" },
  { bg: "#3A2E17", fg: "#FFC457" },
  { bg: "#213A22", fg: "#A7E3A0" },
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
  // Les messages d'erreur du serveur sont en français : on les traduit s'ils sont connus.
  return t(err instanceof Error ? err.message : String(err));
}

export function formatExpiry(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return sameDay ? t("aujourd'hui à {0}", { 0: time }) : t("le {0} à {1}", { 0: d.toLocaleDateString(locale(), { day: "numeric", month: "short" }), 1: time });
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 || h >= 18 ? t("Bonsoir") : t("Bonjour");
}

export const ROLE_LABEL: Record<string, string> = {
  owner: t("Créateur"),
  admin: t("Admin"),
  member: t("Membre"),
  guest: t("Invité"),
};
