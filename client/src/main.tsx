import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TitleBar, { inDesktopApp } from "./components/TitleBar";
import Overlay from "./components/Overlay";

// La fenêtre « overlay » (par-dessus le jeu) charge la même page avec ?overlay=1.
const isOverlay = new URLSearchParams(location.search).has("overlay");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? (
      <Overlay />
    ) : (
      <div className="window">
        {inDesktopApp && <TitleBar />}
        <div className="window-body">
          <App />
        </div>
      </div>
    )}
  </React.StrictMode>,
);
