import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TitleBar, { inDesktopApp } from "./components/TitleBar";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="window">
      {inDesktopApp && <TitleBar />}
      <div className="window-body">
        <App />
      </div>
    </div>
  </React.StrictMode>,
);
