import { locale, t } from "./i18n";
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
