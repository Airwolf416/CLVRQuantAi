import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Service Worker registration (required for push notifications + PWA) ──────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(reg => {
        console.log("[SW] Registered, scope:", reg.scope);
        // Check for SW updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                console.log("[SW] New version available");
              }
            });
          }
        });
      })
      .catch(err => console.warn("[SW] Registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
