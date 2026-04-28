import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import App from "./App";
import "./index.css";

// Bearer-token fallback for cookieless contexts. Inside the Replit preview
// iframe on Safari/iOS, Intelligent Tracking Prevention silently drops the
// session cookie even with SameSite=None;Secure, so every authed request
// 401s. The server returns the session ID in the sign-in response body and
// — only when we're actually running inside an iframe — we cache it in
// localStorage and attach it to every /api/* fetch as
// `Authorization: Bearer <token>`. Top-level tabs (including production on
// clvrquantai.com) use the httpOnly session cookie unchanged and never see
// the token in JS, so a hypothetical XSS there can't escalate to session
// hijack. The header is only added when a token is actually cached, so a
// stale token from a prior iframe session is also still honored.
(function installBearerFetch() {
  const TOKEN_KEY = "clvr_auth_token";
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
  // Top-level tabs don't need bearer auth — the cookie works there. Defensively
  // purge any leftover token so it's not exposed to JS in non-iframe contexts.
  if (!inIframe) {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    return;
  }
  const origFetch = window.fetch.bind(window);
  window.fetch = ((input: any, init?: any) => {
    try {
      const url = typeof input === "string"
        ? input
        : (input instanceof URL ? input.href : (input && input.url) || "");
      if (url && url.indexOf("/api/") !== -1) {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          const headers = new Headers(init?.headers);
          if (input instanceof Request) {
            input.headers.forEach((v, k) => { if (!headers.has(k)) headers.set(k, v); });
          }
          if (!headers.has("Authorization")) {
            headers.set("Authorization", "Bearer " + token);
            init = { ...(init || {}), headers };
            if (!init.credentials) init.credentials = "include";
          }
        }
      }
    } catch (e) {
      // Never let auth wrapping break the request.
    }
    return origFetch(input, init);
  }) as typeof window.fetch;
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(reg => {
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

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
