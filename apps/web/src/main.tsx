import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./presentation/app";
import { PublicTournament } from "./presentation/public-tournament";
import "./styles.css";

const shareMatch = /^\/share\/([A-Za-z0-9_-]{20,})\/?$/.exec(window.location.pathname);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {shareMatch ? <PublicTournament token={shareMatch[1]} /> : <App />}
  </React.StrictMode>,
);
