import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TitleBar, { inDesktopApp } from "./components/TitleBar";
import Overlay from "./components/Overlay";
import CoachScreen from "./components/CoachScreen";
import { installNativeUiGuards } from "./lib/nativeUi";

// La fenêtre « overlay » (par-dessus le jeu) charge la même page avec ?overlay=1.
const params = new URLSearchParams(location.search);
const isOverlay = params.has("overlay");
// Fenêtre « coach-screen » : les annotations des potes sur l'écran que je partage
const isCoach = params.has("coach");

// Pas de menu clic droit Windows ni de bulles blanches natives
installNativeUiGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCoach ? (
      <CoachScreen />
    ) : isOverlay ? (
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
