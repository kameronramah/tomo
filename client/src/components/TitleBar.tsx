import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./Brand";

export const inDesktopApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Barre de titre intégrée au thème (remplace la barre blanche de Windows).
 * La zone marquée data-tauri-drag-region permet de déplacer la fenêtre ;
 * un double-clic dessus agrandit/restaure.
 */
export default function TitleBar() {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {}));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-brand" data-tauri-drag-region>
        <Logo size={16} cut="var(--rail)" />
        <span data-tauri-drag-region>Tomo</span>
      </span>
      <div className="window-controls">
        <button onClick={() => win.minimize()} aria-label="Réduire" title="Réduire">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          aria-label={maximized ? "Restaurer" : "Agrandir"}
          title={maximized ? "Restaurer" : "Agrandir"}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
              <path d="M2.5 2.5V.5h7v7h-2" />
              <path d="M.5 2.5h7v7h-7z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
              <path d="M.5 .5h9v9h-9z" />
            </svg>
          )}
        </button>
        <button className="close" onClick={() => win.close()} aria-label="Fermer" title="Fermer">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
