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

const DEFAULT_INSTANCE = (import.meta.env.VITE_TOMO_INSTANCE as string | undefined) ?? "http://localhost:3000";

export function normalizeInstance(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.|192\.168\.|10\.)/i.test(u);
    u = `${local ? "http" : "https"}://${u}`;
  }
  return u;
}

export const loadInstance = () => read<string>(KEYS.instance, DEFAULT_INSTANCE);
export const saveInstance = (url: string) => write(KEYS.instance, normalizeInstance(url));

export type Devices = { input?: string; output?: string };
export const loadDevices = () => read<Devices>(KEYS.devices, {});
export const saveDevices = (d: Devices) => write(KEYS.devices, d);

export const loadLastServer = () => read<string | null>(KEYS.lastServer, null);
export const saveLastServer = (id: string | null) => write(KEYS.lastServer, id);
