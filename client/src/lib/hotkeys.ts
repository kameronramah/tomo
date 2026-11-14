/**
 * Raccourcis clavier configurables (Paramètres › Raccourcis clavier).
 *
 * Dans l'appli de bureau, l'état des touches vient de la partie Rust (`input.rs`) : les raccourcis
 * marchent aussi quand le jeu est au premier plan, sans bloquer la touche. Seules les touches
 * des raccourcis sont surveillées. Dans le navigateur (ou sur Mac sans l'autorisation),
 * on se rabat sur le clavier de la fenêtre : ça ne marche alors que quand Tomo est au premier plan.
 */
import { getSettings, onSettingsChange, updateSettings } from "./prefs";
import { t } from "./i18n";

export type ActionId = "ptt" | "mute" | "deafen" | "clip" | "spatial" | "captions" | "leave" | "overlay" | "settings";

export type ActionDef = { id: ActionId; label: string; hint?: string; group: "voice" | "game" | "app"; global: boolean };

export const ACTIONS: ActionDef[] = [
  { id: "ptt", label: t("Appuyer pour parler"), hint: t("À tenir enfoncée. Utilisé si « Appuyer pour parler » est choisi dans Audio et micro."), group: "voice", global: true },
  { id: "mute", label: t("Couper / activer le micro"), group: "voice", global: true },
  { id: "deafen", label: t("Couper / rétablir le son"), group: "voice", global: true },
  { id: "clip", label: t("Enregistrer un clip"), hint: t("Les dernières secondes du salon."), group: "voice", global: true },
  { id: "spatial", label: t("Audio spatial : activer / couper"), group: "voice", global: true },
  { id: "captions", label: t("Sous-titres : activer / couper"), group: "voice", global: true },
  { id: "leave", label: t("Quitter la pièce"), group: "voice", global: true },
  { id: "overlay", label: t("Afficher / masquer l'overlay"), group: "game", global: true },
  { id: "settings", label: t("Ouvrir les paramètres"), group: "app", global: false },
];

export const DEFAULT_SHORTCUTS: Record<ActionId, string[] | null> = {
  ptt: null,
  mute: ["Ctrl", "Shift", "M"],
  deafen: ["Ctrl", "Shift", "D"],
  clip: ["Ctrl", "Shift", "C"],
  spatial: null,
  captions: null,
  leave: null,
  overlay: ["Ctrl", "Shift", "O"],
  settings: ["Ctrl", ","],
};

const MODIFIERS = ["Ctrl", "Shift", "Alt", "Meta"];
const isModifier = (k: string) => MODIFIERS.includes(k);

/** Touches d'une action (réglage de la personne, sinon celles par défaut). */
export function shortcutOf(id: ActionId): string[] | null {
  const saved = getSettings().shortcuts;
  return id in saved ? saved[id] : DEFAULT_SHORTCUTS[id];
}

export function setShortcut(id: ActionId, keys: string[] | null) {
  updateSettings("shortcuts", { [id]: keys });
}

export function resetShortcuts() {
  const all: Record<string, string[] | null> = {};
  for (const a of ACTIONS) all[a.id] = DEFAULT_SHORTCUTS[a.id];
  updateSettings("shortcuts", all);
}

/** Ordre d'affichage : modificateurs d'abord, puis la touche. */
export function normalizeKeys(keys: Iterable<string>): string[] {
  const set = [...new Set(keys)];
  return [...MODIFIERS.filter((m) => set.includes(m)), ...set.filter((k) => !isModifier(k)).sort()];
}

export const sameKeys = (a: string[] | null, b: string[] | null) =>
  !!a && !!b && a.length === b.length && normalizeKeys(a).join("+") === normalizeKeys(b).join("+");

/** Action qui utilise déjà ces touches (pour prévenir des doublons). */
export function conflictWith(id: ActionId, keys: string[]): ActionDef | null {
  return ACTIONS.find((a) => a.id !== id && sameKeys(shortcutOf(a.id), keys)) ?? null;
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/** Nom lisible d'une touche. */
export function keyLabel(k: string): string {
  const names: Record<string, string> = {
    Ctrl: "Ctrl",
    Shift: t("Maj"),
    Alt: isMac ? "Option" : "Alt",
    Meta: isMac ? "Cmd" : "Win",
    Space: t("Espace"),
    Enter: t("Entrée"),
    Escape: t("Échap"),
    Backspace: t("Retour"),
    Tab: "Tab",
    CapsLock: t("Verr. Maj"),
    Left: "←",
    Right: "→",
    Up: "↑",
    Down: "↓",
    Delete: t("Suppr"),
    Insert: t("Inser"),
    Home: t("Début"),
    End: t("Fin"),
    PageUp: t("Page préc."),
    PageDown: t("Page suiv."),
    Mouse3: t("Clic molette"),
    Mouse4: t("Souris 4"),
    Mouse5: t("Souris 5"),
  };
  if (names[k]) return names[k];
  if (/^Num.$|^Num\d$/.test(k)) return t("Pavé {0}", { 0: k.slice(3) });
  return k;
}

export function formatShortcut(keys: string[] | null | undefined): string {
  return keys && keys.length ? normalizeKeys(keys).map(keyLabel).join(" + ") : t("Aucun");
}

/** Pour les infobulles : « (Ctrl+Maj+M) », ou rien si aucun raccourci. */
export function shortcutHint(id: ActionId): string {
  const k = shortcutOf(id);
  return k && k.length ? ` (${normalizeKeys(k).map(keyLabel).join("+")})` : "";
}

// ---------------------------------------------------------------------------
// Touches de la fenêtre (navigateur, ou repli) → mêmes noms que la partie Rust
// ---------------------------------------------------------------------------
export function nameFromEvent(e: KeyboardEvent): string | null {
  switch (e.key) {
    case "Control":
      return "Ctrl";
    case "Shift":
      return "Shift";
    case "Alt":
    case "AltGraph":
      return "Alt";
    case "Meta":
    case "OS":
      return "Meta";
    case " ":
      return "Space";
    case "Enter":
      return "Enter";
    case "Escape":
      return "Escape";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "CapsLock":
      return "CapsLock";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "Delete":
    case "Insert":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
      return e.key;
  }
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (e.code.startsWith("Numpad")) {
    const rest = e.code.slice(6);
    const map: Record<string, string> = { Multiply: "*", Add: "+", Subtract: "-", Decimal: ".", Divide: "/" };
    if (/^\d$/.test(rest)) return `Num${rest}`;
    if (map[rest]) return `Num${map[rest]}`;
  }
  // Chiffres de la rangée du haut (sur AZERTY, ils demandent Maj : on prend la position)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code) && e.key.length === 1 && /[a-z]/i.test(e.key)) return e.key.toUpperCase();
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

const mouseName = (button: number) => (button === 1 ? "Mouse3" : button === 3 ? "Mouse4" : button === 4 ? "Mouse5" : null);

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------
type Handler = (down: boolean) => void;
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let handlers: Partial<Record<ActionId, Handler>> = {};
let pressed = new Set<string>();
const active = new Set<ActionId>();
let recording: ((keys: string[]) => void) | null = null;
let nativeOk = false;
let started = false;

/** Une action est-elle « tenue » avec les touches enfoncées ? */
function matches(id: ActionId, keys: string[]): boolean {
  if (!keys.length) return false;
  if (!keys.every((k) => pressed.has(k))) return false;
  // Push-to-talk : on peut tenir Maj (courir) en même temps. Les autres : modificateurs exacts.
  if (id === "ptt") return true;
  return MODIFIERS.every((m) => keys.includes(m) === pressed.has(m));
}

function evaluate() {
  for (const a of ACTIONS) {
    const keys = shortcutOf(a.id);
    const focusedOk = a.global || document.hasFocus();
    const on = !!keys && focusedOk && matches(a.id, keys);
    if (on && !active.has(a.id)) {
      active.add(a.id);
      handlers[a.id]?.(true);
    } else if (!on && active.has(a.id)) {
      active.delete(a.id);
      if (a.id === "ptt") handlers.ptt?.(false);
    }
  }
}

function setPressed(next: Iterable<string>) {
  pressed = new Set(next);
  if (recording) recording([...pressed]);
  else evaluate();
}

/** Touches à surveiller côté Rust : seulement celles des raccourcis. */
async function syncNative() {
  if (!inTauri || !nativeOk) return;
  const keys = new Set<string>();
  for (const a of ACTIONS) {
    if (a.id === "ptt" && getSettings().audio.mode !== "ptt") continue;
    shortcutOf(a.id)?.forEach((k) => keys.add(k));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("input_set_keys", { keys: [...keys] }).catch(() => {});
}

/** Démarre les raccourcis (une fois, depuis App). */
export async function startHotkeys(h: Partial<Record<ActionId, Handler>>) {
  handlers = h;
  if (started) return;
  started = true;

  if (inTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      nativeOk = await invoke<boolean>("input_permission", { ask: false });
      await listen<string[]>("input:keys", (e) => setPressed(e.payload));
      let prev = "";
      onSettingsChange((s) => {
        const sig = JSON.stringify([s.shortcuts, s.audio.mode]);
        if (sig !== prev) {
          prev = sig;
          void syncNative();
        }
      });
      await syncNative();
    } catch {
      nativeOk = false;
    }
  }

  // Repli : clavier et souris de la fenêtre (navigateur, ou Mac sans autorisation).
  const local = new Set<string>();
  const push = () => {
    if (!nativeOk) setPressed(local);
  };
  window.addEventListener("keydown", (e) => {
    const n = nameFromEvent(e);
    if (!n) return;
    const wasRecording = recording !== null;
    if (!nativeOk) {
      // la combinaison d'un raccourci ne doit pas aussi taper dans un champ
      local.add(n);
      push();
      if (recording || ACTIONS.some((a) => active.has(a.id) && a.id !== "ptt")) e.preventDefault();
    } else if (recording) e.preventDefault();
    // Pendant l'enregistrement, la touche est pour nous seuls (Échap ne ferme pas les Paramètres)
    if (wasRecording) e.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener("keyup", (e) => {
    const n = nameFromEvent(e);
    if (n && local.delete(n)) push();
  });
  window.addEventListener("blur", () => {
    local.clear();
    push();
  });
  window.addEventListener("mousedown", (e) => {
    const n = mouseName(e.button);
    if (n) {
      local.add(n);
      push();
    }
  });
  window.addEventListener("mouseup", (e) => {
    const n = mouseName(e.button);
    if (n && local.delete(n)) push();
  });
}

/** Enregistrement d'un raccourci en cours (Échap ne doit alors pas fermer les Paramètres). */
export const isRecordingShortcut = () => recording !== null;

/** Les raccourcis marchent-ils en jeu ? (faux dans le navigateur ou sur Mac sans autorisation) */
export const hotkeysGlobal = () => nativeOk;

/** macOS : demande l'autorisation « Surveillance de l'entrée ». */
export async function askInputPermission(): Promise<boolean> {
  if (!inTauri) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  nativeOk = await invoke<boolean>("input_permission", { ask: true }).catch(() => false);
  await syncNative();
  return nativeOk;
}

/**
 * Enregistre un nouveau raccourci : la combinaison la plus grande tenue avant de tout relâcher.
 * Échap seul = annuler (null). S'arrête tout seul après 15 s.
 */
export function recordShortcut(): { result: Promise<string[] | null>; cancel: () => void } {
  let finish: (v: string[] | null) => void = () => {};
  const result = new Promise<string[] | null>((resolve) => (finish = resolve));
  let best: string[] = [];
  let done = false;
  const end = (v: string[] | null) => {
    if (done) return;
    done = true;
    recording = null;
    clearTimeout(timer);
    pressed = new Set();
    active.clear();
    if (inTauri && nativeOk) {
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("input_record", { on: false }).catch(() => {}));
      void syncNative();
    }
    finish(v);
  };
  const timer = setTimeout(() => end(null), 15000);
  recording = (keys) => {
    if (keys.length === 1 && keys[0] === "Escape" && best.length <= 1) return end(null);
    if (keys.length > best.length) best = keys;
    // Tout relâché : on garde la combinaison, à condition qu'il y ait une vraie touche
    if (keys.length === 0 && best.length) {
      if (best.every(isModifier)) best = [];
      else end(normalizeKeys(best));
    }
  };
  // Les touches déjà enfoncées (clic de souris…) ne comptent pas
  if (inTauri && nativeOk) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("input_record", { on: true }).catch(() => {}));
  return { result, cancel: () => end(null) };
}
