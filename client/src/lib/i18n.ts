/**
 * Langue de l'interface. Le français est la langue de référence : on écrit le texte en
 * français dans le code (`t("Paramètres")`) et le dictionnaire anglais le traduit.
 * Un texte absent du dictionnaire reste en français (rien ne casse).
 * Changer de langue recharge la fenêtre (simple et sûr).
 */
import { EN } from "./i18n-en";

export type Lang = "fr" | "en";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
];

const KEY = "tomo.lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // stockage indisponible
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const lang: Lang = detect();
document.documentElement.lang = lang;

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // tant pis
  }
  location.reload();
}

/** Traduit un texte écrit en français ; `{nom}` est remplacé par vars.nom. */
export function t(fr: string, vars?: Record<string, unknown>): string {
  let s = lang === "en" ? (EN[fr] ?? fr) : fr;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  return s;
}

/** Pluriel simple : t1 pour 0 ou 1, tn au-delà (`{n}` remplacé). */
export const tn = (n: number, one: string, many: string) => t(n > 1 ? many : one, { n });

/** Heure / date au format de la langue choisie. */
export const locale = () => (lang === "en" ? "en-GB" : "fr-FR");
