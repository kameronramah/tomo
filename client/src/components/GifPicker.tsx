import { useEffect, useRef, useState } from "react";
import type { Api, Gif } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";

/**
 * Sélecteur de GIF (Klipy) : tendances à l'ouverture, recherche au fil de la frappe.
 * Un clic sur un GIF l'envoie tout de suite.
 */
export default function GifPicker({ api, onPick, onClose }: { api: Api; onPick: (g: Gif) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recherche avec un petit délai (pas une requête par lettre)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .gifs(q.trim())
        .then((r) => alive && (setGifs(r.gifs), setError(undefined)))
        .catch((e) => alive && setError(errorMessage(e)))
        .finally(() => alive && setLoading(false));
    }, q ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Deux colonnes façon « mur » : chaque GIF garde ses proportions
  const cols: Gif[][] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(g);
    heights[i] += g.preview.height / Math.max(1, g.preview.width);
  }

  return (
    <>
      <div className="click-away" onClick={onClose} />
      <div className="gif-picker" role="dialog" aria-label={t("Choisir un GIF")}>
        <label className="gif-search">
          <Icon name="search" size={16} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher un GIF")} aria-label={t("Rechercher un GIF")} />
        </label>
        <span className="muted small">{q.trim() ? t("Résultats") : t("Tendances")}</span>
        <div className="gif-grid">
          {error ? (
            <p className="muted small pad">{error}</p>
          ) : loading && gifs.length === 0 ? (
            <p className="muted small pad">{t("Chargement…")}</p>
          ) : gifs.length === 0 ? (
            <p className="muted small pad">{t("Aucun GIF trouvé.")}</p>
          ) : (
            cols.map((col, i) => (
              <div key={i} className="gif-col">
                {col.map((g) => (
                  <button key={g.id} type="button" className="gif-item" onClick={() => onPick(g)} title={g.title} aria-label={t("Envoyer le GIF {0}", { 0: g.title })}>
                    <img src={g.preview.url} alt={g.title} loading="lazy" style={{ aspectRatio: `${g.preview.width} / ${g.preview.height}` }} />
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <span className="gif-credit">{t("GIF fournis par KLIPY")}</span>
      </div>
    </>
  );
}
