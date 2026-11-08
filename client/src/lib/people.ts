/**
 * Annuaire des personnes : nom affiché, photo, couleur et statut de chacun.
 * Partagé par toute l'appli (messages, bulles du vocal, membres, amis…), rempli à la demande
 * (par lots) et tenu à jour en direct par les événements « presence » et « profile ».
 */
import { useEffect, useReducer } from "react";
import type { Api, LightProfile, Presence } from "./api";
import type { Realtime } from "./realtime";
import { t } from "./i18n";

const map = new Map<string, LightProfile>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
const failed = new Set<string>();
let api: Api | null = null;
let timer: number | undefined;

const emit = () => listeners.forEach((l) => l());

/** Identité LiveKit (u:<id>) → identifiant de compte ; null pour un invité ou un bot. */
export const userIdOf = (identity: string) => (identity.startsWith("u:") ? identity.slice(2) : null);

export function setPeopleApi(a: Api | null) {
  api = a;
  map.clear();
  failed.clear();
  emit();
}

export function putPeople(list: LightProfile[]) {
  for (const p of list) map.set(p.id, p);
  emit();
}

export function getPerson(id: string | null | undefined) {
  return id ? map.get(id) : undefined;
}

/** Demande les profils manquants (regroupés en un seul appel toutes les 50 ms). */
export function ensurePeople(ids: (string | null | undefined)[]) {
  let added = false;
  for (const id of ids) if (id && !map.has(id) && !pending.has(id) && !failed.has(id)) (pending.add(id), (added = true));
  if (!added || timer) return;
  timer = window.setTimeout(async () => {
    timer = undefined;
    const batch = [...pending].slice(0, 200);
    batch.forEach((id) => pending.delete(id));
    if (!api || batch.length === 0) return;
    try {
      const got = await api.usersBatch(batch);
      putPeople(got);
      const ok = new Set(got.map((p) => p.id));
      batch.filter((id) => !ok.has(id)).forEach((id) => failed.add(id));
    } catch {
      // réseau : on réessaiera à la prochaine demande
    }
    if (pending.size) ensurePeople([]);
  }, 50);
}

/** Recharge le profil de quelqu'un (il vient de le modifier). */
export function refreshPerson(id: string) {
  map.delete(id);
  failed.delete(id);
  ensurePeople([id]);
}

export function setPresence(id: string, status: Presence) {
  const p = map.get(id);
  if (!p) return;
  map.set(id, { ...p, status, customStatus: status === "offline" ? null : p.customStatus });
  emit();
}

/** Branche l'annuaire sur le temps réel. Renvoie la fonction pour débrancher. */
export function watchPeople(realtime: Realtime) {
  return realtime.on((e) => {
    if (e.type === "presence" && typeof e.userId === "string") {
      setPresence(e.userId, (e.status as Presence) ?? (e.online ? "online" : "offline"));
      if (!map.has(e.userId)) ensurePeople([e.userId]);
    }
    if (e.type === "profile" && typeof e.userId === "string") refreshPerson(e.userId);
  });
}

/** Re-rend le composant quand l'annuaire change ; demande les profils manquants. */
export function usePeople(ids: (string | null | undefined)[] = []) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(tick);
    return () => void listeners.delete(tick);
  }, []);
  const key = ids.join(",");
  useEffect(() => ensurePeople(ids), [key]);
  return getPerson;
}

export const STATUS_LABEL: Record<Presence | "invisible", string> = {
  online: t("En ligne"),
  idle: t("Inactif"),
  dnd: t("Ne pas déranger"),
  offline: t("Hors ligne"),
  invisible: t("Invisible"),
};
