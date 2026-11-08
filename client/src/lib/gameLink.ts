/**
 * Position du joueur dans son jeu, via le standard « Mumble Link » (mémoire partagée).
 * La partie Rust lit cette mémoire ~20 fois/s et envoie l'événement "mumble-link".
 * Jeux compatibles : Minecraft (mod MumbleLink), Guild Wars 2, Arma, Star Citizen, etc.
 */
import { listen } from "@tauri-apps/api/event";

export type GameLink = {
  active: boolean;
  game: string;
  identity: string;
  context: string;
  /** Position en mètres (X est, Y haut, Z nord) et direction du regard */
  pos: [number, number, number];
  front: [number, number, number];
};

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let latest: GameLink | null = null;
const listeners = new Set<(g: GameLink | null) => void>();
let started = false;

function start() {
  if (started || !inTauri) return;
  started = true;
  listen<GameLink>("mumble-link", (e) => {
    latest = e.payload.active ? e.payload : null;
    listeners.forEach((l) => l(latest));
  }).catch(() => {});
}

export function onGameLink(fn: (g: GameLink | null) => void) {
  start();
  listeners.add(fn);
  fn(latest);
  return () => void listeners.delete(fn);
}

export const gameLinkSupported = inTauri;
