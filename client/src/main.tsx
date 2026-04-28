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
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  // Top-level tabs don't need bearer auth — the cookie works there. Defensively
  // purge any leftover token so it's not exposed to JS in non-iframe contexts.
  if (!inIframe) {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    return;
  }
  // Strict same-origin /api/ matcher. Critically, a substring match like
  // url.indexOf("/api/") would also match third-party URLs whose path
  // happens to contain "/api/" (e.g. https://evil.com/api/x), which would
  // exfiltrate the bearer session ID. We therefore require either a
  // relative path beginning with "/api/" OR an absolute URL whose origin
  // matches window.location.origin AND whose pathname starts with "/api/".
  const ourOrigin = window.location.origin;
  const isOurApi = (rawUrl: string): boolean => {
    if (!rawUrl) return false;
    if (rawUrl.startsWith("/api/") || rawUrl === "/api") return true;
    if (rawUrl.startsWith("/")) return false; // other relative path
    try {
      const u = new URL(rawUrl);
      return u.origin === ourOrigin && u.pathname.startsWith("/api/");
    } catch {
      return false;
    }
  };
  const origFetch = window.fetch.bind(window);
  const wrapped: typeof window.fetch = (input, init) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url;
      if (isOurApi(url)) {
        const headers = new Headers(init?.headers);
        if (input instanceof Request) {
          input.headers.forEach((v, k) => { if (!headers.has(k)) headers.set(k, v); });
        }
        const token = localStorage.getItem(TOKEN_KEY);
        if (token && !headers.has("Authorization")) {
          headers.set("Authorization", "Bearer " + token);
        }
        // Always send cookies on our /api/* — the cookie path remains the
        // primary auth mechanism in non-ITP browsers, and we must not
        // break it. The bearer header is purely additive.
        init = {
          ...(init || {}),
          headers,
          credentials: init?.credentials ?? "include",
        };
      }
    } catch {
      // Never let auth wrapping break the request.
    }
    return origFetch(input, init);
  };
  window.fetch = wrapped;
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
