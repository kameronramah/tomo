/**
 * Jeux lancés : l'appli de bureau lit la liste des programmes ouverts (rien d'autre) toutes les
 * 10 s et la compare à une liste de jeux connus + ceux ajoutés à la main dans Paramètres › Jeux.
 *
 * Le jeu en cours sert à : « joue à … » (si on l'autorise), la pièce automatique, le mode focus,
 * l'audio spatial par jeu et l'overlay.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./desktop";
import { getSettings, onSettingsChange, updateSettings, type Settings } from "./prefs";

export type GameInfo = { id: string; name: string; exe: string };
export type RunningGame = GameInfo & { since: number };

/** Jeux reconnus d'office (nom du programme en minuscules → nom affiché). */
const KNOWN: Record<string, string> = {
  "valorant-win64-shipping.exe": "Valorant",
  "league of legends.exe": "League of Legends",
  "cs2.exe": "Counter-Strike 2",
  "javaw.exe": "Minecraft",
  "minecraft.windows.exe": "Minecraft",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "r5apex.exe": "Apex Legends",
  "r5apex_dx12.exe": "Apex Legends",
  "rocketleague.exe": "Rocket League",
  "overwatch.exe": "Overwatch 2",
  "dota2.exe": "Dota 2",
  "gta5.exe": "GTA V",
  "gta5_enhanced.exe": "GTA V",
  "eldenring.exe": "Elden Ring",
  "nightreign.exe": "Elden Ring Nightreign",
  "valheim.exe": "Valheim",
  "rust.exe": "Rust",
  "destiny2.exe": "Destiny 2",
  "cod.exe": "Call of Duty",
  "cod24.exe": "Call of Duty",
  "helldivers2.exe": "Helldivers 2",
  "lethal company.exe": "Lethal Company",
  "phasmophobia.exe": "Phasmophobia",
  "palworld-win64-shipping.exe": "Palworld",
  "deadbydaylight-win64-shipping.exe": "Dead by Daylight",
  "among us.exe": "Among Us",
  "terraria.exe": "Terraria",
  "stardew valley.exe": "Stardew Valley",
  "rainbowsix.exe": "Rainbow Six Siege",
  "rainbowsix_vulkan.exe": "Rainbow Six Siege",
  "pubg-win64-shipping.exe": "PUBG",
  "tslgame.exe": "PUBG",
  "eafc25.exe": "EA SPORTS FC 25",
  "fc26.exe": "EA SPORTS FC 26",
  "marvel-win64-shipping.exe": "Marvel Rivals",
  "thefinals.exe": "The Finals",
  "deadlock.exe": "Deadlock",
  "project8.exe": "Deadlock",
  "seaofthieves.exe": "Sea of Thieves",
  "arma3_x64.exe": "Arma 3",
  "gw2-64.exe": "Guild Wars 2",
  "starcitizen.exe": "Star Citizen",
  "wow.exe": "World of Warcraft",
  "hearthstone.exe": "Hearthstone",
  "diablo iv.exe": "Diablo IV",
  "path of exile 2.exe": "Path of Exile 2",
  "pathofexile_x64steam.exe": "Path of Exile",
  "baldursgate3.exe": "Baldur's Gate 3",
  "bg3.exe": "Baldur's Gate 3",
  "factorio.exe": "Factorio",
  "satisfactory.exe": "Satisfactory",
  "7daystodie.exe": "7 Days to Die",
  "repo.exe": "R.E.P.O.",
  "peak.exe": "PEAK",
  "content warning.exe": "Content Warning",
  "battlefield6.exe": "Battlefield 6",
  "bf6.exe": "Battlefield 6",
  "escapefromtarkov.exe": "Escape from Tarkov",
  "warframe.x64.exe": "Warframe",
  "genshinimpact.exe": "Genshin Impact",
  "rlleague.exe": "Rocket League",
};

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Liste complète : jeux connus + jeux ajoutés à la main. */
function catalog(s: Settings): Map<string, GameInfo> {
  const m = new Map<string, GameInfo>();
  for (const [exe, name] of Object.entries(KNOWN)) m.set(exe, { id: idOf(name), name, exe });
  for (const c of s.games.custom) m.set(c.exe.toLowerCase(), { id: idOf(c.name), name: c.name, exe: c.exe.toLowerCase() });
  return m;
}

let current: RunningGame | null = null;
const listeners = new Set<(g: RunningGame | null) => void>();

export const currentGame = () => current;

/** Le programme (nom du .exe) est-il le jeu en cours ? (un jeu peut avoir plusieurs .exe) */
export function isCurrentGameProgram(program: string) {
  if (!current) return false;
  return catalog(getSettings()).get(program.toLowerCase())?.id === current.id;
}
export function onGame(fn: (g: RunningGame | null) => void) {
  listeners.add(fn);
  fn(current);
  return () => void listeners.delete(fn);
}

/** Réglages d'un jeu (avec les valeurs par défaut). */
export function gamePrefs(id: string): Settings["games"]["perGame"][string] {
  const defaults: Settings["games"]["perGame"][string] = { spatial: true, overlay: true, focus: false, hidden: false, autoRoom: null };
  return { ...defaults, ...(getSettings().games.perGame[id] as Partial<typeof defaults> | undefined) };
}

export function setGamePrefs(id: string, patch: Partial<Settings["games"]["perGame"][string]>) {
  const all = getSettings().games.perGame;
  updateSettings("games", { perGame: { ...all, [id]: { ...gamePrefs(id), ...patch } } });
}

async function scan() {
  const s = getSettings();
  if (!s.games.detect) return set(null);
  let programs: string[];
  try {
    programs = await invoke<string[]>("running_programs");
  } catch {
    return;
  }
  const cat = catalog(s);
  const found = programs.map((p) => cat.get(p)).find((g): g is GameInfo => !!g);
  if (!found) return set(null);
  if (current?.id === found.id) return;
  // On retient les jeux déjà vus pour les afficher dans Paramètres › Jeux.
  if (!s.games.seen.some((g) => g.id === found.id)) updateSettings("games", { seen: [...s.games.seen, { id: found.id, name: found.name }].slice(-30) });
  set({ ...found, since: Date.now() });
}

function set(g: RunningGame | null) {
  if ((g?.id ?? null) === (current?.id ?? null)) return;
  current = g;
  listeners.forEach((l) => l(g));
}

/** Démarre la surveillance (appli de bureau uniquement). */
export function startGameWatch() {
  if (!inTauri) return () => {};
  void scan();
  const timer = window.setInterval(() => void scan(), 10_000);
  const off = onSettingsChange(() => void scan());
  return () => {
    window.clearInterval(timer);
    off();
    set(null);
  };
}

/** Ce que les autres voient (rien si « Montrer à quoi je joue » est coupé côté serveur ou si le jeu est masqué). */
export function publicGame(g: RunningGame | null) {
  if (!g || gamePrefs(g.id).hidden) return null;
  return { name: g.name, since: g.since };
}

/** « depuis 40 min » / « depuis 1 h 12 ». */
export function sinceLabel(since: number) {
  const min = Math.max(1, Math.round((Date.now() - since) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
