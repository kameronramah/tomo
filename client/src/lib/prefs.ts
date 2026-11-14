/** Préférences locales non sensibles (jamais de jeton ici). */

const KEYS = {
  instance: "tomo.instance",
  devices: "tomo.devices",
  lastServer: "tomo.lastServer",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : on continue sans mémoire
  }
}

/** Le serveur Tomo (VPS). En dev, l'API locale. VITE_TOMO_INSTANCE permet d'en forcer une autre à la compilation. */
const VPS_INSTANCE = "https://tomo.grylix.dev";
const DEFAULT_INSTANCE =
  (import.meta.env.VITE_TOMO_INSTANCE as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:3000" : VPS_INSTANCE);

/** Choisir l'adresse du serveur n'est possible qu'en dev : pour tout le monde, c'est le VPS d'office. */
export const INSTANCE_EDITABLE = import.meta.env.DEV;

export function normalizeInstance(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.|192\.168\.|10\.)/i.test(u);
    u = `${local ? "http" : "https"}://${u}`;
  }
  return u;
}

// Adresse nettoyée (un « / » final, comme « https://tomo.grylix.dev/ », donnerait des adresses en « //auth »)
// Hors dev, une ancienne adresse gardée sur le PC (ex. localhost) est ignorée.
export const loadInstance = () =>
  normalizeInstance(INSTANCE_EDITABLE ? read<string>(KEYS.instance, DEFAULT_INSTANCE) : DEFAULT_INSTANCE);
export const saveInstance = (url: string) => write(KEYS.instance, normalizeInstance(url));

export type Devices = { input?: string; output?: string; camera?: string };
export const loadDevices = () => read<Devices>(KEYS.devices, {});
export const saveDevices = (d: Devices) => write(KEYS.devices, d);

export const loadLastServer = () => read<string | null>(KEYS.lastServer, null);
export const saveLastServer = (id: string | null) => write(KEYS.lastServer, id);

// ---------------------------------------------------------------------------
// Réglages de l'utilisateur (espace Paramètres)
// ---------------------------------------------------------------------------
export type Settings = {
  sounds: { enabled: boolean; volume: number; voice: boolean; messages: boolean; calls: boolean };
  /** normalize : volume uniformisé (chaque voix reçue ramenée au même niveau) */
  audio: {
    /** off : rien ; light : filtre du navigateur ; advanced : RNNoise calculé sur le PC */
    denoise: "off" | "light" | "advanced";
    /** Porte de bruit : le micro se coupe sous gateThreshold (dB) */
    gate: boolean;
    gateThreshold: number;
    echoCancellation: boolean;
    autoGain: boolean;
    outputVolume: number;
    normalize: boolean;
    /** voice : le micro s'ouvre quand je parle ; ptt : seulement pendant que je tiens la touche */
    mode: "voice" | "ptt";
    /** Appuyer pour parler : délai avant de couper après avoir lâché (ms), petit son */
    pttDelay: number;
    pttSound: boolean;
    /** Baisser les autres quand je parle (option, coupée au départ) : de duckAmount (0..1) */
    duck: boolean;
    duckAmount: number;
  };
  /** Raccourcis : action → touches (noms de lib/hotkeys.ts), null = aucun */
  shortcuts: Record<string, string[] | null>;
  appearance: { zoom: number; reducedMotion: boolean; compact: boolean };
  /**
   * desktop : notifications Windows / Mac quand Tomo est en arrière-plan (messages privés, demandes, appels)
   * quiet* : heures calmes (pas de sons ni de notifications sur ce créneau, comme « Ne pas déranger »)
   */
  notifications: {
    dmSound: boolean;
    mentionsOnly: boolean;
    desktop: boolean;
    desktopPreview: boolean;
    quietEnabled: boolean;
    quietFrom: string;
    quietTo: string;
  };
  clips: { enabled: boolean; seconds: 30 | 60 | 120 };
  /** Lancement : réduit quand Tomo démarre avec l'ordinateur ; fermer = réduire */
  startup: { minimized: boolean };
  /** Mise à jour automatique (téléchargée en arrière-plan, installée au redémarrage) */
  updates: { auto: boolean };
  /** Sous-titres : modèle Whisper (plus gros = plus juste mais plus lent), traduction vers ma langue */
  captions: { model: string; translate: boolean; v?: number };
  /** Overlay en jeu : quand l'afficher, où, et quoi */
  overlay: {
    mode: "game" | "always" | "off";
    corner: "tl" | "tr" | "bl" | "br";
    opacity: number;
    voices: boolean;
    chat: boolean;
    captions: boolean;
  };
  /**
   * Jeux : detect (lire la liste des programmes), propose (proposer de rejoindre les potes),
   * perGame (réglages par jeu), custom (jeux ajoutés à la main), seen (jeux déjà détectés)
   */
  games: {
    detect: boolean;
    propose: boolean;
    perGame: Record<
      string,
      { spatial: boolean; overlay: boolean; focus: boolean; hidden: boolean; autoRoom: { serverId: string; roomId: string; label: string } | null }
    >;
    custom: { exe: string; name: string }[];
    seen: { id: string; name: string }[];
  };
  spatial: { range: number; showMap: boolean };
  screen: { preset: "game" | "sharp" | "max" | "eco"; audio: boolean };
};

export const DEFAULT_SETTINGS: Settings = {
  sounds: { enabled: true, volume: 0.5, voice: true, messages: true, calls: true },
  audio: { denoise: "advanced", gate: false, gateThreshold: -50, echoCancellation: true, autoGain: true, outputVolume: 1, normalize: true, mode: "voice", pttDelay: 200, pttSound: true, duck: false, duckAmount: 0.5 },
  shortcuts: {},
  appearance: { zoom: 1, reducedMotion: false, compact: false },
  notifications: { dmSound: true, mentionsOnly: false, desktop: true, desktopPreview: true, quietEnabled: false, quietFrom: "23:00", quietTo: "08:00" },
  clips: { enabled: true, seconds: 60 },
  startup: { minimized: true },
  updates: { auto: true },
  captions: { model: "auto", translate: true, v: 2 },
  overlay: { mode: "game", corner: "tl", opacity: 0.9, voices: true, chat: true, captions: true },
  games: { detect: true, propose: true, perGame: {}, custom: [], seen: [] },
  spatial: { range: 25, showMap: true },
  screen: { preset: "game", audio: true },
};

const SETTINGS_KEY = "tomo.settings";
let current: Settings = (() => {
  const saved = read<Partial<Settings>>(SETTINGS_KEY, {});
  return {
    sounds: { ...DEFAULT_SETTINGS.sounds, ...saved.sounds },
    audio: {
      ...DEFAULT_SETTINGS.audio,
      // anciens réglages : la case « Suppression du bruit » décochée = aucune suppression
      ...((saved.audio as { noiseSuppression?: boolean } | undefined)?.noiseSuppression === false ? { denoise: "off" as const } : {}),
      ...saved.audio,
    },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...saved.appearance },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...saved.notifications },
    clips: { ...DEFAULT_SETTINGS.clips, ...saved.clips },
    spatial: { ...DEFAULT_SETTINGS.spatial, ...saved.spatial },
    screen: { ...DEFAULT_SETTINGS.screen, ...saved.screen },
    startup: { ...DEFAULT_SETTINGS.startup, ...saved.startup },
    updates: { ...DEFAULT_SETTINGS.updates, ...saved.updates },
    games: { ...DEFAULT_SETTINGS.games, ...saved.games },
    captions: {
      ...DEFAULT_SETTINGS.captions,
      ...saved.captions,
      // l'ancien réglage d'office (« Équilibré ») passe une fois à « Automatique », plus juste quand le PC suit
      ...(saved.captions && !saved.captions.v && saved.captions.model === "onnx-community/whisper-base" ? { model: "auto" } : {}),
      v: 2,
    },
    overlay: { ...DEFAULT_SETTINGS.overlay, ...saved.overlay },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...saved.shortcuts },
  };
})();
const settingsListeners = new Set<(s: Settings) => void>();

export const getSettings = () => current;

export function updateSettings<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) {
  current = { ...current, [section]: { ...current[section], ...patch } };
  write(SETTINGS_KEY, current);
  settingsListeners.forEach((l) => l(current));
}

export function onSettingsChange(fn: (s: Settings) => void) {
  settingsListeners.add(fn);
  return () => void settingsListeners.delete(fn);
}
