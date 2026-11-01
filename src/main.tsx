import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// Settings kept in this browser under the old name come across once.
try { for (const k of Object.keys(localStorage)) if (k.startsWith("horus.")) { localStorage.setItem(k.replace("horus.", "warpnaut."), localStorage.getItem(k) ?? ""); localStorage.removeItem(k); } } catch { /* nothing kept here */ }


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
