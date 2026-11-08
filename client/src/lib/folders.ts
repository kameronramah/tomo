/**
 * Dossiers de serveurs : rangement personnel de la colonne de gauche.
 * Gardé sur ce PC (localStorage), par instance : chacun range ses serveurs comme il veut.
 */
import { useEffect, useState } from "react";

export type Folder = { kind: "folder"; id: string; name: string; open: boolean; servers: string[] };
export type Entry = { kind: "server"; id: string } | Folder;
type Layout = { entries: Entry[]; collapsed: boolean };

const key = (instance: string) => `tomo.layout:${instance}`;
const listeners = new Set<() => void>();

function read(instance: string): Layout {
  try {
    const raw = localStorage.getItem(key(instance));
    if (raw) return JSON.parse(raw) as Layout;
  } catch {
    // stockage illisible : on repart de zéro
  }
  return { entries: [], collapsed: false };
}

function write(instance: string, l: Layout) {
  try {
    localStorage.setItem(key(instance), JSON.stringify(l));
  } catch {
    // stockage indisponible
  }
  listeners.forEach((f) => f());
}

/** Liste rangée : l'ordre enregistré, sans les serveurs quittés, avec les nouveaux à la fin. */
export function arrange(entries: Entry[], serverIds: string[]): Entry[] {
  const known = new Set(serverIds);
  const placed = new Set<string>();
  const out: Entry[] = [];
  for (const e of entries) {
    if (e.kind === "server") {
      if (known.has(e.id) && !placed.has(e.id)) (out.push(e), placed.add(e.id));
    } else {
      const servers = e.servers.filter((id) => known.has(id) && !placed.has(id));
      servers.forEach((id) => placed.add(id));
      if (servers.length > 0) out.push({ ...e, servers });
    }
  }
  for (const id of serverIds) if (!placed.has(id)) out.push({ kind: "server", id });
  return out;
}

function without(entries: Entry[], serverId: string): Entry[] {
  return entries
    .map((e) => (e.kind === "folder" ? { ...e, servers: e.servers.filter((s) => s !== serverId) } : e))
    .filter((e) => (e.kind === "server" ? e.id !== serverId : e.servers.length > 0));
}

export function useServerLayout(instance: string, serverIds: string[]) {
  const [layout, setLayout] = useState(() => read(instance));
  useEffect(() => {
    setLayout(read(instance));
    const f = () => setLayout(read(instance));
    listeners.add(f);
    return () => void listeners.delete(f);
  }, [instance]);

  const entries = arrange(layout.entries, serverIds);
  const save = (next: Entry[], collapsed = layout.collapsed) => write(instance, { entries: next, collapsed });

  return {
    entries,
    collapsed: layout.collapsed,
    setCollapsed: (c: boolean) => save(entries, c),
    /** Lâcher un serveur sur un autre serveur : crée un dossier avec les deux. */
    dropOnServer(dragged: string, target: string) {
      if (dragged === target) return;
      const base = without(entries, dragged);
      const i = base.findIndex((e) => e.kind === "server" && e.id === target);
      if (i < 0) return;
      const folder: Folder = { kind: "folder", id: crypto.randomUUID(), name: "Nouveau dossier", open: true, servers: [target, dragged] };
      base.splice(i, 1, folder);
      save(base);
    },
    /** Lâcher un serveur sur un dossier : il y entre. */
    dropOnFolder(dragged: string, folderId: string) {
      const base = without(entries, dragged).map((e) =>
        e.kind === "folder" && e.id === folderId ? { ...e, open: true, servers: [...e.servers, dragged] } : e,
      );
      save(base);
    },
    /** Lâcher un serveur avant une entrée (ou à la fin) : il sort de son dossier. */
    dropBefore(dragged: string, beforeIndex: number | null) {
      const target = beforeIndex === null ? null : entries[beforeIndex];
      const base = without(entries, dragged);
      const i = target ? base.findIndex((e) => e.id === target.id) : -1;
      base.splice(i < 0 ? base.length : i, 0, { kind: "server", id: dragged });
      save(base);
    },
    toggleFolder(id: string) {
      save(entries.map((e) => (e.kind === "folder" && e.id === id ? { ...e, open: !e.open } : e)));
    },
    renameFolder(id: string, name: string) {
      save(entries.map((e) => (e.kind === "folder" && e.id === id ? { ...e, name: name.trim().slice(0, 32) || e.name } : e)));
    },
    /** Défait un dossier : ses serveurs reviennent à sa place. */
    ungroup(id: string) {
      save(entries.flatMap((e) => (e.kind === "folder" && e.id === id ? e.servers.map((s) => ({ kind: "server" as const, id: s })) : [e])));
    },
  };
}
