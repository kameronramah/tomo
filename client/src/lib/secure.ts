/**
 * Coffre-fort pour le jeton de session « rester connecté ».
 * - Appli de bureau : Gestionnaire d'identification Windows (via la partie Rust).
 * - Navigateur (dev uniquement) : sessionStorage, effacé à la fermeture de l'onglet.
 */
import { invoke } from "@tauri-apps/api/core";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function secretGet(key: string): Promise<string | null> {
  if (inTauri) return (await invoke<string | null>("secret_get", { key }).catch(() => null)) ?? null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (inTauri) return void (await invoke("secret_set", { key, value }).catch(() => {}));
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignoré
  }
}

export async function secretDelete(key: string): Promise<void> {
  if (inTauri) return void (await invoke("secret_delete", { key }).catch(() => {}));
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignoré
  }
}
