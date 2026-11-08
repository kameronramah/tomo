/** Préférences locales : pseudo, serveurs rejoints, périphériques audio. */

export type SavedServer = {
  id: string;
  name: string;
  apiUrl: string;
  invite: string;
};

export type Devices = { input?: string; output?: string };

const KEYS = {
  profile: "t2m.profile",
  servers: "t2m.servers",
  active: "t2m.activeServer",
  devices: "t2m.devices",
  legacy: "t2m.settings", // format de la V0.1
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
    // stockage indisponible : l'appli marche quand même, sans mémoire
  }
}

/** Reprend le pseudo et le serveur saisis avec la V0.1, une seule fois. */
function migrateLegacy() {
  const legacy = read<{ apiUrl?: string; invite?: string; name?: string } | null>(KEYS.legacy, null);
  if (!legacy) return;
  if (legacy.name && !read(KEYS.profile, null)) write(KEYS.profile, { name: legacy.name });
  if (legacy.apiUrl && legacy.invite && read<SavedServer[]>(KEYS.servers, []).length === 0) {
    let name = "Serveur";
    try {
      name = new URL(legacy.apiUrl).host;
    } catch {
      // adresse illisible : nom par défaut
    }
    write(KEYS.servers, [{ id: crypto.randomUUID(), name, apiUrl: legacy.apiUrl, invite: legacy.invite }]);
  }
  try {
    localStorage.removeItem(KEYS.legacy);
  } catch {
    // ignoré
  }
}
migrateLegacy();

export const loadProfileName = () => read<{ name?: string }>(KEYS.profile, {}).name ?? "";
export const saveProfileName = (name: string) => write(KEYS.profile, { name });

export const loadServers = () => read<SavedServer[]>(KEYS.servers, []);
export const saveServers = (servers: SavedServer[]) => write(KEYS.servers, servers);

export const loadActiveServerId = () => read<string | null>(KEYS.active, null);
export const saveActiveServerId = (id: string | null) => write(KEYS.active, id);

export const loadDevices = () => read<Devices>(KEYS.devices, {});
export const saveDevices = (d: Devices) => write(KEYS.devices, d);
