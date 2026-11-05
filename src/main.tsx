import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// Settings kept in this browser under an old name (Horus, then Warpnaut) come across once.
try {
  for (const k of Object.keys(localStorage)) {
    const old = /^(horus|warpnaut)\./.exec(k);
    if (!old) continue;
    const name = `aetherdeck.${k.slice(old[0].length)}`;
    if (localStorage.getItem(name) === null) localStorage.setItem(name, localStorage.getItem(k) ?? "");
    localStorage.removeItem(k);
  }
} catch { /* nothing kept here */ }


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
