/**
 * Glisser-déposer pour ranger une liste (pièces, fils) : on attrape la poignée, l'élément
 * prend sa nouvelle place en direct, et l'ordre est envoyé au lâcher.
 * Au clavier : poignée sélectionnée, flèches pour déplacer (chaque appui est enregistré).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export function useSortable(group: string, ids: string[], onCommit: (ids: string[]) => Promise<unknown>) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const orderRef = useRef<string[] | null>(null);
  const key = ids.join(",");

  // La liste du serveur a changé (enregistré, ou rangé par quelqu'un d'autre) : on la suit.
  useEffect(() => {
    if (!dragging) {
      setOrder(null);
      orderRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const list = order ?? ids;

  function move(id: string, to: number) {
    const cur = orderRef.current ?? ids;
    const from = cur.indexOf(id);
    if (from < 0 || to < 0 || to >= cur.length || from === to) return cur;
    const next = [...cur];
    next.splice(from, 1);
    next.splice(to, 0, id);
    orderRef.current = next;
    setOrder(next);
    return next;
  }

  function commit(next: string[]) {
    if (next.join(",") === key) {
      setOrder(null);
      orderRef.current = null;
      return;
    }
    onCommit(next).catch(() => {
      setOrder(null);
      orderRef.current = null;
    });
  }

  function gripProps(id: string) {
    return {
      "data-sort-grip": group,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        orderRef.current = [...list];
        setDragging(id);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (dragging !== id) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(`[data-sort-group="${group}"]`);
        const target = el?.dataset.sortId;
        if (target && target !== id) move(id, (orderRef.current ?? ids).indexOf(target));
      },
      onPointerUp: () => {
        if (dragging !== id) return;
        setDragging(null);
        commit(orderRef.current ?? ids);
      },
      onPointerCancel: () => {
        setDragging(null);
        setOrder(null);
        orderRef.current = null;
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const delta = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0;
        if (!delta) return;
        e.preventDefault();
        orderRef.current = [...list];
        const next = move(id, list.indexOf(id) + delta);
        commit(next);
        // garder la poignée sélectionnée après le déplacement
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sort-grip="${group}"][data-grip-id="${id}"]`)?.focus());
      },
      "data-grip-id": id,
    };
  }

  const itemProps = (id: string) => ({ "data-sort-group": group, "data-sort-id": id });

  return { list, dragging, gripProps, itemProps };
}
