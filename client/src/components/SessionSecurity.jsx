import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, configureApiClient } from "../lib/apiClient";

const HEARTBEAT_MS = 5 * 60 * 1000;
const WARNING_MS = 15 * 60 * 1000;
export function canSendHeartbeat(lastSuccessAt, now = Date.now()) {
  return now - lastSuccessAt >= HEARTBEAT_MS;
}
export function sessionBroadcastPayload(type) {
  return { type, source: "clvr-session" };
}
export function publishSessionEvent(type) {
  const payload = { ...sessionBroadcastPayload(type), eventId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` };
  try { const channel = new BroadcastChannel("clvr-session"); channel.postMessage(payload); channel.close(); } catch {}
  try { localStorage.setItem("clvr_session_event", JSON.stringify(payload)); localStorage.removeItem("clvr_session_event"); } catch {}
}
export function createSessionEventReceiver(onClear) {
  const seen = new Set();
  return event => {
    let payload = event?.data;
    if (!payload && event?.key === "clvr_session_event") {
      try { payload = JSON.parse(event.newValue || "null"); } catch { return; }
    }
    // Receiving a notification is deliberately terminal: it only clears local
    // state. It must never call publishSessionEvent and echo across tabs.
    if (payload?.source === "clvr-session" && (payload.type === "expired" || payload.type === "signout")) {
      // publishSessionEvent emits both transport mechanisms for compatibility;
      // eventId makes that one originating transition, not two.
      if (payload.eventId && seen.has(payload.eventId)) return;
      if (payload.eventId) seen.add(payload.eventId);
      onClear(payload.type);
    }
  };
}

function expiryFrom(status) {
  const idle = status?.idleExpiresAt || status?.idleExpiry || status?.idleExpires;
  const absolute = status?.absoluteExpiresAt || status?.absoluteExpiry || status?.maxAgeExpiresAt;
  const values = [idle, absolute].map(v => typeof v === "number" ? v : Date.parse(v)).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

export default function SessionSecurity({ onExpired }) {
  const [warning, setWarning] = useState(false);
  const [warningVisible, setWarningVisible] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef(null);
  const lastHeartbeat = useRef(0);
  const expiry = useRef(null);
  const resolver = useRef(null);
  const restoreFocus = useRef(null);
  const clearSession = useCallback((code) => {
    try {
      localStorage.removeItem("clvr_auth_token");
      sessionStorage.setItem("clvr_session_notice", code === "SESSION_MAX_AGE"
        ? "For your security, please sign in again."
        : "Your session ended after inactivity. Please sign in again.");
    } catch {}
    onExpired?.(code);
  }, [onExpired]);
  const expired = useCallback((code) => {
    clearSession(code);
    publishSessionEvent("expired");
  }, [clearSession]);
  const reconcile = useCallback(async () => {
    const res = await apiFetch("/api/session/status", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    expiry.current = expiryFrom(data);
    setWarning(Boolean(expiry.current && expiry.current - Date.now() <= WARNING_MS));
  }, []);
  const heartbeat = useCallback(async () => {
    if (!canSendHeartbeat(lastHeartbeat.current)) return;
    const res = await apiFetch("/api/session/heartbeat", { method: "POST", credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      lastHeartbeat.current = Date.now();
      expiry.current = expiryFrom(data);
      setWarning(false);
    }
  }, []);

  useEffect(() => configureApiClient({
    onSessionExpired: expired,
    requestReauth: () => new Promise(resolve => {
      resolver.current = resolve; restoreFocus.current = document.activeElement; setError(""); setReauthOpen(true);
    }),
  }), [expired]);
  // Presentation-only presence handling lets the warning leave gracefully
  // without affecting authoritative expiry or heartbeat behavior.
  useEffect(() => {
    if (warning) {
      setWarningVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setWarningVisible(false), 200);
    return () => window.clearTimeout(timer);
  }, [warning]);
  useEffect(() => {
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("clvr-session") : null;
    const receive = createSessionEventReceiver(() => clearSession());
    channel?.addEventListener("message", receive);
    window.addEventListener("storage", receive);
    return () => { channel?.removeEventListener("message", receive); channel?.close(); window.removeEventListener("storage", receive); };
  }, [expired]);
  useEffect(() => {
    reconcile().catch(() => {});
    const activity = event => { if (event.isTrusted) heartbeat().catch(() => {}); };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        reconcile().catch(() => {});
      }
    };
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("scroll", activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => setWarning(Boolean(expiry.current && expiry.current - Date.now() <= WARNING_MS)), 60_000);
    return () => { window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); window.removeEventListener("scroll", activity); document.removeEventListener("visibilitychange", visibility); clearInterval(timer); };
  }, [heartbeat, reconcile]);
  useEffect(() => {
    if (!reauthOpen) return;
    passwordRef.current?.focus();
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      if (event.key === "Tab") {
        const nodes = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] input')].filter(n => !n.disabled);
        const index = nodes.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && index === nodes.length - 1) { event.preventDefault(); nodes[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [reauthOpen]);
  const finish = approved => {
    setReauthOpen(false); resolver.current?.(approved); resolver.current = null;
    queueMicrotask(() => restoreFocus.current?.focus?.());
  };
  const cancel = () => finish(false);
  const confirm = async e => {
    e.preventDefault(); setBusy(true); setError("");
    const password = passwordRef.current?.value || "";
    try {
      const res = await apiFetch("/api/session/confirm-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }, { skipReauth: true });
      if (!res.ok) throw new Error();
      finish(true);
    } catch { setError("We could not verify your password. Please try again."); }
    finally { setBusy(false); }
  };
  return <>
    {warningVisible && <div role="status" aria-live="polite" className={warning ? "motion-idle-banner-enter" : "motion-idle-banner-exit"} style={{ position:"fixed", right:16, bottom:16, zIndex:900, maxWidth:360, padding:12, background:"#0c1220", border:"1px solid #c9a84c", color:"#f0f4ff", fontSize:13 }}>
      Your session will expire soon due to inactivity. Continue working to stay signed in.
    </div>}
    {reauthOpen && <div role="presentation" style={{ position:"fixed", inset:0, zIndex:1000, display:"grid", placeItems:"center", background:"rgba(0,0,0,.65)" }}>
      <form role="dialog" aria-modal="true" aria-labelledby="reauth-title" onSubmit={confirm} style={{ width:"min(400px, calc(100% - 32px))", padding:24, background:"#0c1220", border:"1px solid #1c2b4a", color:"#f0f4ff" }}>
        <h2 id="reauth-title" style={{ marginTop:0 }}>Confirm your password</h2>
        <p>For your security, confirm your password before continuing.</p>
        <label htmlFor="reauth-password">Password</label>
        <input id="reauth-password" ref={passwordRef} type="password" autoComplete="current-password" required style={{ width:"100%", boxSizing:"border-box", margin:"8px 0 12px", padding:9 }} />
        {error && <p role="alert">{error}</p>}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}><button type="button" onClick={cancel}>Cancel</button><button disabled={busy}>{busy ? "Confirming…" : "Confirm"}</button></div>
      </form>
    </div>}
  </>;
}