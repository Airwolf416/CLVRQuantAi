import { useState, useEffect, useCallback } from "react";
import { SiInstagram, SiTiktok } from "react-icons/si";

// ── WebAuthn / Face ID helpers ─────────────────────────────────────────────
const WA_STORE_KEY = "clvr_wa_cred";

function waSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create);
}

function getStoredCredential() {
  try { return JSON.parse(localStorage.getItem(WA_STORE_KEY) || "null"); } catch { return null; }
}

function storeCredential(credentialId, userId) {
  try { localStorage.setItem(WA_STORE_KEY, JSON.stringify({ credentialId, userId, platform: true, v: 2, registeredAt: Date.now() })); } catch {}
}

function isValidCredential(stored) {
  // v2+ credentials are platform passkeys (Face ID); older ones lack the flag and must be re-registered
  return stored && stored.credentialId && stored.v >= 2;
}

function clearStoredCredential() {
  try { localStorage.removeItem(WA_STORE_KEY); } catch {}
}

function strToUint8(str) {
  return new TextEncoder().encode(str);
}

function b64ToUint8(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function uint8ToB64(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const LEGAL = `CLVRQuant is a market information and education platform only. It does not provide financial advice, investment recommendations, or trading signals. All content is for informational and educational purposes only. By using this platform you acknowledge that: (1) You are solely responsible for any trading decisions you make. (2) CLVRQuant, its founder Mike Claver, and any affiliated entities bear no liability for any financial losses incurred. (3) Trading involves substantial risk of loss and is not suitable for all individuals. (4) Past market data and AI-generated analysis do not guarantee future results. Use this platform entirely at your own risk.\n\nAI DISCLOSURE: CLVR AI uses the Claude API by Anthropic to power its AI analysis engine.`;

const DARK_C = {
  bg: "#050709", panel: "#0c1220", border: "#141e35", border2: "#1c2b4a",
  gold: "#c9a84c", gold2: "#e8c96d", gold3: "#f7e0a0",
  text: "#c8d4ee", muted: "#4a5d80", muted2: "#6b7fa8", white: "#f0f4ff",
  green: "#00c787", red: "#ff4060", orange: "#ff8c00", cyan: "#00d4ff",
  inputBg: "#080d18",
};
const LIGHT_C = {
  bg: "#f0f2f5", panel: "#ffffff", border: "#e2e6ea", border2: "#cdd2d8",
  gold: "#8a6c18", gold2: "#a07820", gold3: "#c9a84c",
  text: "#0d1321", muted: "#4a5568", muted2: "#718096", white: "#0d1321",
  green: "#007a44", red: "#c41230", orange: "#b35a00", cyan: "#006e8a",
  inputBg: "#f0f2f5",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'Barlow', system-ui, sans-serif";

function Particles({ C }) {
  const [pts] = useState(() =>
    Array.from({ length: 18 }, (_, i) => ({
      x: Math.random() * 100, y: Math.random() * 100,
      s: 1 + Math.random() * 2, d: 4 + Math.random() * 8,
    }))
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {pts.map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
          width: p.s, height: p.s, borderRadius: "50%",
          background: i % 3 === 0 ? C.gold : i % 3 === 1 ? C.cyan : C.green,
          opacity: 0.25,
          animation: `float${i % 3} ${p.d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}

function WalkingTour({ C, isDark, onSignUp, onEnterFree, onClose }) {
  const [step, setStep] = useState(0);
  const TOTAL = 5;
  const STEPS = [
    {
      icon: "✦", label: "WELCOME",
      title: "The Intelligent Trader's Edge",
      sub: "Professional-grade market intelligence — accessible to everyone.",
      content: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
          {[
            { icon: "⚡", t: "Live Signals", d: "Real-time quant signals with confidence scoring" },
            { icon: "🤖", t: "CLVR AI", d: "Claude-powered market analyst at your fingertips" },
            { icon: "📈", t: "Track Record", d: "Transparent signal history with verified outcomes" },
            { icon: "📅", t: "Macro Calendar", d: "Fed meetings, CPI, earnings — never miss a catalyst" },
          ].map(({ icon, t, d }) => (
            <div key={t} style={{ background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 10px" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>{t}</div>
              <div style={{ fontFamily: SANS, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: "⚡", label: "SIGNALS",
      title: "Real-Time Quant Signals",
      sub: "AI-scored signals with risk management built-in.",
      content: (
        <div style={{ marginTop: 20, background: isDark ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.03)", border: `1px solid rgba(201,168,76,.25)`, borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>BTC/USD</div>
              <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 2 }}>PERPETUAL · BINANCE</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, background: "rgba(0,199,135,.15)", color: "#00c787", border: "1px solid rgba(0,199,135,.3)", borderRadius: 3, padding: "3px 8px" }}>LONG</span>
              <span style={{ fontFamily: MONO, fontSize: 9, background: "rgba(201,168,76,.15)", color: C.gold, border: `1px solid rgba(201,168,76,.3)`, borderRadius: 3, padding: "3px 8px" }}>82%</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[["Entry", "$97,240"], ["Target", "$103,800"], ["Stop", "$94,500"]].map(([l, v]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.1em" }}>{l}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: C.text, fontWeight: 700, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "rgba(255,140,0,.08)", border: "1px solid rgba(255,140,0,.2)", borderRadius: 4, padding: "6px 10px", fontFamily: MONO, fontSize: 9, color: "#ff8c00", textAlign: "center", letterSpacing: "0.08em" }}>
            🕐 PRO: Real-time · FREE: 30-min delay
          </div>
        </div>
      ),
    },
    {
      icon: "🤖", label: "CLVR AI",
      title: "AI-Powered Market Analysis",
      sub: "Ask anything. Get institutional-grade insights instantly.",
      content: (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontFamily: SANS, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.gold, display: "block", marginBottom: 4 }}>YOU</span>
            What's the macro outlook for BTC this week?
          </div>
          <div style={{ background: "rgba(201,168,76,.06)", border: "1px solid rgba(201,168,76,.2)", borderRadius: 8, padding: "10px 14px", fontFamily: SANS, fontSize: 12, color: C.text, lineHeight: 1.7 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: C.gold, display: "block", marginBottom: 4 }}>✦ CLVR AI</span>
            BTC faces a critical week with FOMC minutes Wednesday. Risk-on positioning has been building — watch the $96K support as the key level. A hold there targets $105K by Friday if CPI prints soft.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, textAlign: "center", letterSpacing: "0.1em" }}>POWERED BY CLAUDE · PRO & ELITE ONLY</div>
        </div>
      ),
    },
    {
      icon: "📈", label: "TRACK RECORD",
      title: "Fully Transparent Track Record",
      sub: "See every signal — wins, losses, and outcomes verified.",
      content: (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[["73%", "WIN RATE"], ["142", "SIGNALS"], ["4.2×", "AVG R:R"]].map(([v, l]) => (
              <div key={l} style={{ background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.gold, lineHeight: 1 }}>{v}</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 4, letterSpacing: "0.1em" }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { sym: "ETH", dir: "LONG", res: "WIN", pct: "+18.4%" },
              { sym: "BTC", dir: "SHORT", res: "WIN", pct: "+12.1%" },
              { sym: "SOL", dir: "LONG", res: "LOSS", pct: "-4.2%" },
            ].map(({ sym, dir, res, pct }) => (
              <div key={sym+dir} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: isDark ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.03)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px" }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.text, fontWeight: 700 }}>{sym}</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>{dir}</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: res === "WIN" ? "#00c787" : "#ff4060", fontWeight: 700 }}>{res}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: res === "WIN" ? "#00c787" : "#ff4060", fontWeight: 700 }}>{pct}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      icon: "🚀", label: "PLANS",
      title: "Choose Your Intelligence Level",
      sub: "Start free. Upgrade anytime. Cancel anytime.",
      content: (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            {
              tier: "FREE", price: "$0", sub: "Always free",
              features: ["Signals with 30-min delay", "Macro Calendar", "Live Market Prices"],
              locked: ["Real-time signals", "AI Chat & Morning Brief", "Watchlist & Alerts"],
              highlight: false, cta: "Start Free", action: "free", color: C.muted,
            },
            {
              tier: "PRO", price: "$29.99", sub: "per month · save 17% yearly",
              features: ["Real-time signals — zero delay", "CLVR AI Market Chat", "Custom watchlist (20 assets)", "Price alerts & push notifications", "Signal history & PnL tracking", "Morning Brief · 4 ideas/day"],
              locked: [],
              highlight: true, cta: "Start Pro", action: "signup", color: C.gold,
            },
            {
              tier: "ELITE", price: "$129", sub: "per month · save 23% yearly",
              features: ["Everything in Pro", "AI Quant Engine (12-factor)", "SEC Insider Flow & whale tracking", "Squawk Box live announcer", "Basket Analysis (3+ assets)", "Political Alpha correlation"],
              locked: [],
              highlight: false, cta: "Go Elite", action: "signup", color: "#00e5ff",
            },
          ].map(({ tier, price, sub, features, locked, highlight, cta, action, color }) => (
            <div key={tier} style={{ border: `1px solid ${highlight ? "rgba(201,168,76,.45)" : tier === "ELITE" ? "rgba(0,229,255,.3)" : C.border}`, borderRadius: 8, padding: "12px 14px", background: highlight ? "rgba(201,168,76,.05)" : tier === "ELITE" ? "rgba(0,229,255,.03)" : "transparent", position: "relative" }}>
              {highlight && <div style={{ position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)", fontFamily: MONO, fontSize: 7, background: C.gold, color: "#0a0a0a", padding: "2px 10px", borderRadius: "0 0 4px 4px", fontWeight: 700, letterSpacing: "0.1em" }}>MOST POPULAR</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color, letterSpacing: "0.1em" }}>{tier}</span>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: MONO, fontSize: 13, color, fontWeight: 800 }}>{price}<span style={{ fontSize: 8, color: C.muted, fontWeight: 400 }}>/mo</span></div>
                  <div style={{ fontFamily: MONO, fontSize: 7, color: C.muted }}>{sub}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                {features.map(f => <span key={f} style={{ fontFamily: MONO, fontSize: 8, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}><span style={{ color, flexShrink: 0 }}>✓</span>{f}</span>)}
                {locked.map(f => <span key={f} style={{ fontFamily: MONO, fontSize: 8, color: C.muted, opacity: 0.45, display: "flex", alignItems: "center", gap: 5 }}><span style={{ flexShrink: 0 }}>✕</span>{f}</span>)}
              </div>
              <button onClick={() => action === "free" ? onEnterFree() : onSignUp()} style={{ width: "100%", background: highlight ? "rgba(201,168,76,.14)" : tier === "ELITE" ? "rgba(0,229,255,.08)" : "transparent", border: `1px solid ${highlight ? "rgba(201,168,76,.4)" : tier === "ELITE" ? "rgba(0,229,255,.3)" : C.border}`, borderRadius: 4, padding: "9px", fontFamily: MONO, fontSize: 11, fontWeight: 700, color, cursor: "pointer", letterSpacing: "0.06em" }}>
                {cta} →
              </button>
            </div>
          ))}
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, textAlign: "center", lineHeight: 1.6 }}>No credit card required for Free · Stripe-secured payments · Cancel anytime</div>
        </div>
      ),
    },
  ];
  const s = STEPS[step];
  return (
    <div data-testid="walking-tour" style={{ position: "fixed", inset: 0, zIndex: 500, background: isDark ? "rgba(5,7,9,.97)" : "rgba(245,243,238,.97)", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ maxWidth: 480, width: "100%", margin: "0 auto", padding: "20px 20px calc(160px + env(safe-area-inset-bottom, 0px))", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 900, color: C.gold }}>{s.icon} CLVRQuant</div>
          <button onClick={onClose} data-testid="btn-tour-close" style={{ background: "none", border: "none", fontFamily: MONO, fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.08em", padding: "6px 10px" }}>SKIP ✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <div key={i} onClick={() => setStep(i)} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? C.gold : isDark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)", cursor: "pointer", transition: "background .3s" }} />
          ))}
        </div>

        {/* Step label */}
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.2em", marginBottom: 8 }}>STEP {step + 1} OF {TOTAL} · {s.label}</div>

        {/* Title */}
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: "clamp(22px,5vw,30px)", color: C.text, lineHeight: 1.2, marginBottom: 6 }}>{s.title}</div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{s.sub}</div>

        {/* Content */}
        {s.content}
      </div>

      {/* Fixed bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px", background: isDark ? "rgba(5,7,9,.98)" : "rgba(245,243,238,.98)", borderTop: `1px solid ${C.border}`, backdropFilter: "blur(14px)" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} data-testid="btn-tour-back" style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, padding: "12px", fontFamily: MONO, fontSize: 12, color: C.muted, cursor: "pointer", letterSpacing: "0.06em" }}>
              ← Back
            </button>
          )}
          {step < TOTAL - 1 ? (
            <button onClick={() => setStep(s => s + 1)} data-testid="btn-tour-next" style={{ flex: 2, background: "rgba(201,168,76,.12)", border: "1px solid rgba(201,168,76,.4)", borderRadius: 6, padding: "12px", fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.gold, cursor: "pointer", letterSpacing: "0.06em" }}>
              Next →
            </button>
          ) : (
            <button onClick={onSignUp} data-testid="btn-tour-signup" style={{ flex: 2, background: "rgba(201,168,76,.15)", border: "1px solid rgba(201,168,76,.5)", borderRadius: 6, padding: "12px", fontFamily: SERIF, fontStyle: "italic", fontSize: 14, fontWeight: 700, color: C.gold, cursor: "pointer", letterSpacing: "0.02em" }}>
              Create Free Account →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage({ onEnter, onBack, isDark = true, onToggleTheme }) {
  const C = isDark ? DARK_C : LIGHT_C;
  const [mode, setMode] = useState("welcome");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", dailyEmail: false, agreeTerms: false, referralCode: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showLegal, setShowLegal] = useState(false);
  const [showSpam, setShowSpam] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedUpUser, setSignedUpUser] = useState(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [waLoading, setWaLoading] = useState(false);
  // Detect biometric synchronously so we can show locked screen immediately
  // Only v2 (platform passkey) credentials are valid — auto-clear legacy cross-platform ones
  const [hasBiometric] = useState(() => {
    if (!waSupported()) return false;
    const stored = getStoredCredential();
    if (!isValidCredential(stored)) {
      if (stored) clearStoredCredential(); // clear old/invalid credential
      return false;
    }
    return true;
  });
  const [faceIdCancelled, setFaceIdCancelled] = useState(false);
  const [faceIdTriggered, setFaceIdTriggered] = useState(false);
  const [bypassBiometric, setBypassBiometric] = useState(false);
  const [cancelledShowPw, setCancelledShowPw] = useState(false);
  const [verifyState, setVerifyState] = useState(null); // null | "loading" | "success" | "error"
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [verifiedName, setVerifiedName] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifySignInLoading, setVerifySignInLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetTok = params.get("reset");
    const verifyTok = params.get("verify");
    if (resetTok) { setResetToken(resetTok); setMode("reset-password"); }
    if (verifyTok) {
      setVerifyState("loading");
      setCheckingSession(false);
      fetch(`/api/auth/verify-email?token=${encodeURIComponent(verifyTok)}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            setVerifiedEmail(data.email || "");
            setVerifiedName(data.name || "");
            setVerifyState("success");
            window.history.replaceState({}, "", window.location.pathname);
          } else {
            setVerifyError(data.error || "Invalid or expired verification link.");
            setVerifyState("error");
          }
        })
        .catch(() => { setVerifyError("Network error. Please try again."); setVerifyState("error"); });
      return;
    }
    fetch("/api/auth/me", { cache: "no-store" }).then(r => r.json()).then(data => {
      if (data.user) onEnter(data.user);
      else setCheckingSession(false);
    }).catch(() => setCheckingSession(false));
  }, []);

  // Face ID / WebAuthn sign-in
  const handleBiometricSignIn = useCallback(async () => {
    const stored = getStoredCredential();
    if (!stored?.credentialId) return;
    setWaLoading(true);
    setFaceIdCancelled(false);
    setError("");
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: [{ type: "public-key", id: b64ToUint8(stored.credentialId) }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (!assertion) throw new Error("cancelled");
      // Use the credential ID from the assertion itself (more reliable than localStorage alone)
      const assertedCredId = uint8ToB64(new Uint8Array(assertion.rawId));
      const res = await fetch("/api/auth/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: assertedCredId }),
      });
      const data = await res.json();
      if (!res.ok) {
        clearStoredCredential();
        throw new Error(data.error || "Auth failed");
      }
      setWaLoading(false);
      if (onEnter) onEnter(data.user);
    } catch (e) {
      setWaLoading(false);
      setFaceIdCancelled(true);
    }
  }, [onEnter]);

  // Auto-trigger Face ID the moment we confirm the session is not active
  useEffect(() => {
    if (!checkingSession && hasBiometric && !faceIdTriggered) {
      setFaceIdTriggered(true);
      handleBiometricSignIn();
    }
  }, [checkingSession, hasBiometric, faceIdTriggered, handleBiometricSignIn]);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(""); setSuccess(""); };

  // Escape from biometric flow back to the welcome screen
  const goToWelcome = () => {
    setBypassBiometric(true);
    setFaceIdCancelled(false);
    setCancelledShowPw(false);
    setMode("welcome");
    setError("");
  };

  const handleSignUp = async () => {
    if (!form.name.trim()) return setError("Please enter your name.");
    if (!form.email.includes("@")) return setError("Please enter a valid email.");
    if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (!form.agreeTerms) return setError("You must agree to the terms to continue.");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password, dailyEmail: form.dailyEmail, referralCode: form.referralCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Signup failed"); setLoading(false); return; }
      setLoading(false);
      if (data.user) setSignedUpUser({ ...data.user, isNewUser: true });
      setMode("verify");
    } catch (e) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  const handleSignIn = async (isRetry = false) => {
    if (!form.email.includes("@")) return setError("Please enter a valid email.");
    if (!form.password) return setError("Please enter your password.");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Sign in failed"); setLoading(false); return; }
      setLoading(false);
      if (onEnter) onEnter(data.mustChangePassword ? { ...data.user, mustChangePassword: true } : data.user);
    } catch (e) {
      if (!isRetry) {
        await new Promise(r => setTimeout(r, 2000));
        return handleSignIn(true);
      }
      setError("__network__");
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!form.email.includes("@")) return setError("Please enter a valid email address.");
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); setLoading(false); return; }
      setSuccess("If an account exists with this email, a password reset has been sent. Check your inbox (and spam folder).");
      setLoading(false);
    } catch (e) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) return setError("Password must be at least 6 characters.");
    if (newPassword !== newPasswordConfirm) return setError("Passwords do not match.");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Reset failed"); setLoading(false); return; }
      setSuccess("Password reset successfully! You can now sign in.");
      setLoading(false);
      setTimeout(() => { setMode("signin"); setSuccess(""); window.history.replaceState({}, "", window.location.pathname); }, 2500);
    } catch (e) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  // ── Email verification screens ──────────────────────────────────────────
  if (verifyState === "loading") {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 28, color: C.gold2, marginBottom: 8 }}>CLVRQuant</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.2em" }}>VERIFYING EMAIL...</div>
        </div>
      </div>
    );
  }

  if (verifyState === "error") {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 28, color: C.gold2, marginBottom: 4 }}>CLVRQuant</div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.3em", marginBottom: 40 }}>AI · MARKET INTELLIGENCE</div>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 22, color: "#f87171", marginBottom: 8 }}>Link Invalid</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted2, marginBottom: 32, textAlign: "center", maxWidth: 320, lineHeight: 1.7 }}>{verifyError}</div>
        <button onClick={() => { setVerifyState(null); setMode("signin"); }} style={{ background: "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.35)`, borderRadius: 6, padding: "12px 28px", fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 14, color: C.gold2, cursor: "pointer" }}>
          Sign In Instead
        </button>
      </div>
    );
  }

  if (verifyState === "success") {
    const handleVerifySignIn = async () => {
      if (!verifyPassword) return setError("Please enter your password.");
      setVerifySignInLoading(true);
      setError("");
      try {
        const res = await fetch("/api/auth/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: verifiedEmail, password: verifyPassword }),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Incorrect password."); setVerifySignInLoading(false); return; }
        setVerifySignInLoading(false);
        // isNewUser: true — triggers the onboarding tour automatically for fresh signups
        if (onEnter) onEnter({ ...data.user, isNewUser: true });
      } catch { setError("Network error. Please try again."); setVerifySignInLoading(false); }
    };
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900;1,700&family=IBM+Plex+Mono:wght@400;500&family=Barlow:wght@400;600&display=swap');
          @keyframes checkIn{0%{stroke-dashoffset:60}100%{stroke-dashoffset:0}}
          @keyframes ringIn{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
          @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        `}</style>
        <div style={{ position: "absolute", top: "25%", left: "50%", transform: "translateX(-50%)", width: 400, height: 400, background: "radial-gradient(circle,rgba(34,197,94,.06) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 28, color: C.gold2, marginBottom: 4 }}>CLVRQuant</div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.3em", marginBottom: 40 }}>AI · MARKET INTELLIGENCE</div>

        {/* Animated green checkmark */}
        <div style={{ animation: "ringIn .5s cubic-bezier(.34,1.56,.64,1) both", marginBottom: 20 }}>
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="40" fill="none" stroke="rgba(34,197,94,.15)" strokeWidth="2"/>
            <circle cx="44" cy="44" r="40" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeDasharray="251" strokeDashoffset="0" style={{ animation: "checkIn .6s ease .3s both", strokeDashoffset: 251 }}/>
            <polyline points="26,44 38,56 62,32" fill="none" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" style={{ animation: "checkIn .5s ease .6s both", strokeDashoffset: 60 }}/>
          </svg>
        </div>

        <div style={{ animation: "fadeUp .4s ease .8s both", textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 26, color: "#4ade80", marginBottom: 6 }}>Email Verified!</div>
          <div style={{ fontFamily: SANS, fontSize: 14, color: C.muted2, marginBottom: 4 }}>
            Welcome, <strong style={{ color: C.white }}>{verifiedName}</strong>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted, letterSpacing: "0.08em" }}>{verifiedEmail}</div>
        </div>

        {/* Password re-entry to sign in */}
        <div style={{ animation: "fadeUp .4s ease 1s both", width: "100%", maxWidth: 340 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, letterSpacing: "0.12em", marginBottom: 12, textAlign: "center" }}>ENTER YOUR PASSWORD TO CONTINUE</div>
          <input
            type="password"
            placeholder="Your password"
            value={verifyPassword}
            onChange={e => { setVerifyPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleVerifySignIn()}
            autoFocus
            style={{ width: "100%", background: C.inputBg, border: `1px solid ${error ? "#f87171" : C.border}`, borderRadius: 6, padding: "13px 14px", color: C.white, fontSize: 14, fontFamily: SANS, boxSizing: "border-box", outline: "none", marginBottom: 10 }}
          />
          {error && <div style={{ fontFamily: MONO, fontSize: 11, color: "#f87171", marginBottom: 10, textAlign: "center" }}>{error}</div>}
          <button
            onClick={handleVerifySignIn}
            disabled={verifySignInLoading}
            style={{ width: "100%", background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 6, padding: "14px", fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 15, color: "#4ade80", cursor: "pointer" }}
          >
            {verifySignInLoading ? "Signing in..." : "Enter Dashboard →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Biometric locked screen (shown when Face ID is registered and session needs re-auth) ──
  if (!bypassBiometric && hasBiometric && (checkingSession || waLoading || (!faceIdCancelled && faceIdTriggered))) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", overflow: "hidden" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900;1,700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        @keyframes faceIdPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
        @keyframes shimmer{0%{opacity:.3}50%{opacity:.7}100%{opacity:.3}}`}</style>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", width: 400, height: 400, background: "radial-gradient(circle,rgba(201,168,76,.08) 0%,transparent 70%)", pointerEvents: "none" }} />
        {/* Logo */}
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontWeight: 900, fontSize: 36, color: C.gold2, letterSpacing: "0.04em", marginBottom: 6, textShadow: "0 0 30px rgba(201,168,76,.25)" }}>CLVRQuant</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: C.gold, letterSpacing: "0.35em", marginBottom: 56, fontWeight: 500 }}>AI · MARKET INTELLIGENCE</div>
        {/* Face ID icon */}
        <div style={{ width: 80, height: 80, borderRadius: "50%", border: `2px solid ${waLoading ? C.gold : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28, animation: waLoading ? "faceIdPulse 1.6s ease-in-out infinite" : "none", transition: "border-color .4s", background: "rgba(201,168,76,.04)" }}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path d="M13 6C10.2 6 8 8.2 8 11v2" stroke={waLoading ? C.gold : C.muted} strokeWidth="2" strokeLinecap="round"/>
            <path d="M23 6C25.8 6 28 8.2 28 11v2" stroke={waLoading ? C.gold : C.muted} strokeWidth="2" strokeLinecap="round"/>
            <path d="M8 23v2c0 2.8 2.2 5 5 5" stroke={waLoading ? C.gold : C.muted} strokeWidth="2" strokeLinecap="round"/>
            <path d="M28 23v2c0 2.8-2.2 5-5 5" stroke={waLoading ? C.gold : C.muted} strokeWidth="2" strokeLinecap="round"/>
            <circle cx="14" cy="16" r="1.5" fill={waLoading ? C.gold : C.muted}/>
            <circle cx="22" cy="16" r="1.5" fill={waLoading ? C.gold : C.muted}/>
            <path d="M14 22c0 0 1.2 2 4 2s4-2 4-2" stroke={waLoading ? C.gold : C.muted} strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M18 13v3" stroke={waLoading ? C.gold2 : C.muted} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        {/* Status text */}
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: waLoading ? C.gold2 : C.muted2, letterSpacing: "0.06em", marginBottom: 8, animation: waLoading ? "shimmer 1.6s ease-in-out infinite" : "none" }}>
          {checkingSession ? "Checking session..." : waLoading ? "Authenticating..." : "Face ID ready"}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, letterSpacing: "0.1em" }}>
          {waLoading ? "Look at your device to continue" : checkingSession ? "" : "Waiting for Face ID..."}
        </div>
        {!checkingSession && !waLoading && (
          <button data-testid="btn-skip-faceid" onClick={goToWelcome}
            style={{ marginTop: 32, background: "none", border: "none", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.08em", textDecoration: "underline", padding: 0 }}>
            Sign in differently / Back to welcome
          </button>
        )}
      </div>
    );
  }

  // ── Face ID cancelled fallback — retry or inline sign-in ──
  if (!bypassBiometric && hasBiometric && faceIdCancelled) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 24px 48px", position: "relative", overflow: "hidden" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,900&family=IBM+Plex+Mono:wght@400;500&family=Barlow:wght@400;500;600&display=swap');
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}button{cursor:pointer;-webkit-appearance:none;touch-action:manipulation;}`}</style>
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 400, height: 400, background: "radial-gradient(circle,rgba(201,168,76,.06) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontWeight: 900, fontSize: 32, color: C.gold2, letterSpacing: "0.04em", marginBottom: 4 }}>CLVRQuant</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: C.gold, letterSpacing: "0.35em", marginBottom: 36, fontWeight: 500 }}>AI · MARKET INTELLIGENCE</div>
        {/* Lock icon */}
        {!cancelledShowPw && (
          <div style={{ width: 68, height: 68, borderRadius: "50%", border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, background: "rgba(255,255,255,.02)" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke={C.muted} strokeWidth="1.8"/><path d="M7 11V7a5 5 0 0110 0v4" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round"/></svg>
          </div>
        )}
        {!cancelledShowPw && (
          <>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted2, marginBottom: 4 }}>Verification cancelled</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, marginBottom: 32 }}>Try again or sign in with your password</div>
          </>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340, position: "relative", zIndex: 10 }}>
          {!cancelledShowPw && (
            <button
              data-testid="btn-faceid-retry"
              onClick={handleBiometricSignIn}
              disabled={waLoading}
              style={{ width: "100%", background: "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.35)`, borderRadius: 8, padding: "14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: C.gold2, letterSpacing: "0.06em", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, touchAction: "manipulation" }}>
              <svg width="18" height="18" viewBox="0 0 36 36" fill="none"><path d="M13 6C10.2 6 8 8.2 8 11v2" stroke={C.gold} strokeWidth="2" strokeLinecap="round"/><path d="M23 6C25.8 6 28 8.2 28 11v2" stroke={C.gold} strokeWidth="2" strokeLinecap="round"/><path d="M8 23v2c0 2.8 2.2 5 5 5" stroke={C.gold} strokeWidth="2" strokeLinecap="round"/><path d="M28 23v2c0 2.8-2.2 5-5 5" stroke={C.gold} strokeWidth="2" strokeLinecap="round"/><circle cx="14" cy="16" r="1.5" fill={C.gold}/><circle cx="22" cy="16" r="1.5" fill={C.gold}/><path d="M14 22c0 0 1.2 2 4 2s4-2 4-2" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round"/></svg>
              {waLoading ? "Authenticating..." : "Use Face ID"}
            </button>
          )}
          {!cancelledShowPw ? (
            <button
              data-testid="btn-use-password"
              onClick={() => setCancelledShowPw(true)}
              style={{ width: "100%", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted2, letterSpacing: "0.06em", touchAction: "manipulation" }}>
              Use Password Instead
            </button>
          ) : (
            <div style={{ background: C.panel, border: `1px solid rgba(201,168,76,.2)`, borderRadius: 10, padding: "20px 18px" }}>
              <div style={{ position: "relative", height: 1, background: `linear-gradient(90deg,transparent,${C.gold},transparent)`, marginBottom: 18 }} />
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted2, letterSpacing: "0.15em", textAlign: "center", marginBottom: 18 }}>SIGN IN</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: C.muted, marginBottom: 4, display: "block", letterSpacing: "0.12em" }}>EMAIL</label>
                  <input
                    data-testid="input-cancelled-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="you@email.com"
                    style={{ width: "100%", background: "#080d18", border: `1px solid ${C.border}`, borderRadius: 6, padding: "11px 12px", color: C.white, fontSize: 13, fontFamily: SANS, outline: "none", WebkitAppearance: "none" }}
                  />
                </div>
                <div>
                  <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: C.muted, marginBottom: 4, display: "block", letterSpacing: "0.12em" }}>PASSWORD</label>
                  <input
                    data-testid="input-cancelled-password"
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Your password"
                    onKeyDown={e => e.key === "Enter" && handleSignIn()}
                    style={{ width: "100%", background: "#080d18", border: `1px solid ${C.border}`, borderRadius: 6, padding: "11px 12px", color: C.white, fontSize: 13, fontFamily: SANS, outline: "none", WebkitAppearance: "none" }}
                  />
                </div>
                {error && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.red, padding: "7px 10px", background: "rgba(255,64,96,.06)", border: `1px solid rgba(255,64,96,.2)`, borderRadius: 4 }}>{error}</div>}
                <button
                  data-testid="btn-cancelled-signin"
                  onClick={handleSignIn}
                  disabled={loading}
                  style={{ width: "100%", background: `linear-gradient(135deg,${C.gold},${C.gold2})`, border: "none", borderRadius: 8, padding: "13px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: "#0a0a0a", letterSpacing: "0.08em", opacity: loading ? 0.6 : 1, touchAction: "manipulation" }}>
                  {loading ? "Signing In..." : "Sign In →"}
                </button>
                <button data-testid="btn-cancelled-forgot" onClick={() => { setBypassBiometric(true); setFaceIdCancelled(false); setCancelledShowPw(false); setMode("forgot"); setError(""); }}
                  style={{ background: "none", border: "none", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.gold, textAlign: "center", padding: "4px 0", cursor: "pointer", letterSpacing: "0.06em", touchAction: "manipulation" }}>
                  Forgot Password?
                </button>
                <button
                  onClick={() => { setCancelledShowPw(false); setError(""); }}
                  style={{ background: "none", border: "none", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, textAlign: "center", padding: "4px 0", touchAction: "manipulation" }}>
                  ← Back to Face ID
                </button>
              </div>
            </div>
          )}
        {!cancelledShowPw && (
          <button data-testid="btn-back-welcome-cancelled" onClick={goToWelcome}
            style={{ marginTop: 16, background: "none", border: "none", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.08em", textDecoration: "underline", padding: 0, touchAction: "manipulation" }}>
            ← Back to welcome screen
          </button>
        )}
        </div>
      </div>
    );
  }

  // ── Session check loading (no biometric) ──
  if (checkingSession) {
    return (
      <div style={{ fontFamily: SANS, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 28, color: C.gold2, marginBottom: 8 }}>CLVRQuant</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.2em" }}>LOADING...</div>
        </div>
      </div>
    );
  }

  const inputStyle = {
    width: "100%", background: C.inputBg, border: `1px solid ${C.border}`,
    borderRadius: 4, padding: "12px 14px", color: C.white, fontSize: 13,
    fontFamily: SANS, boxSizing: "border-box", outline: "none",
  };
  const btnGold = {
    width: "100%", background: "rgba(201,168,76,.12)", border: `1px solid rgba(201,168,76,.4)`,
    borderRadius: 4, padding: "13px", cursor: "pointer", fontWeight: 700,
    fontSize: 14, fontFamily: SERIF, fontStyle: "italic", color: C.gold2, letterSpacing: "0.02em",
  };
  const btnGhost = {
    width: "100%", background: "transparent", border: `1px solid ${C.border}`,
    borderRadius: 4, padding: "13px", cursor: "pointer", fontWeight: 600,
    fontSize: 13, fontFamily: MONO, color: C.muted2, letterSpacing: "0.06em",
  };

  return (
    <div style={{ fontFamily: SANS, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Barlow:wght@300;400;500;600;700&display=swap');
        @keyframes float0{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}
        @keyframes float1{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
        @keyframes float2{0%,100%{transform:translateY(0)}50%{transform:translateY(-24px)}}
        @keyframes goldPulse{0%,100%{box-shadow:0 0 30px rgba(201,168,76,.15)}50%{box-shadow:0 0 60px rgba(201,168,76,.3)}}
        @keyframes goldShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        body{background:${C.bg};margin:0;}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        input:focus{border-color:${C.gold} !important;}
      `}</style>

      <Particles C={C} />
      <div style={{ position: "absolute", top: "25%", left: "50%", transform: "translateX(-50%)", width: 500, height: 500, background: "radial-gradient(circle,rgba(201,168,76,.06) 0%,transparent 70%)", pointerEvents: "none" }} />

      {mode === "tour" && (
        <WalkingTour
          C={C}
          isDark={isDark}
          onSignUp={() => setMode("signup")}
          onEnterFree={() => onBack ? onBack() : onEnter && onEnter({ preview: true, tier: "free", name: "Guest" })}
          onClose={() => setMode("welcome")}
        />
      )}

      {mode === "welcome" && (
        <div data-testid="welcome-screen" style={{ textAlign: "center", maxWidth: 480, width: "100%", position: "relative", zIndex: 1 }}>
          {onBack && (
            <button data-testid="btn-back-preview" onClick={onBack}
              style={{ position:"absolute", top:-8, left:0, background:"none", border:"none", fontFamily:MONO, fontSize:10, color:C.muted, cursor:"pointer", letterSpacing:"0.06em", display:"flex", alignItems:"center", gap:5, padding:"4px 0" }}>
              ← Back to Preview
            </button>
          )}
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: "clamp(40px,10vw,64px)", letterSpacing: "0.04em", lineHeight: 1, marginBottom: 6, textShadow: "0 0 40px rgba(201,168,76,.3)" }}>
            <span style={{ color: isDark ? C.gold2 : "#0d1b35" }}>CLVR</span><span style={{ color: C.gold }}>Quant</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: isDark ? C.gold : "#0d1b35", letterSpacing: "0.35em", marginBottom: 28, fontWeight: 600 }}>AI · MARKET INTELLIGENCE</div>

          <p style={{ fontFamily: SANS, fontSize: 14, color: C.muted2, lineHeight: 1.8, marginBottom: 10, maxWidth: 380, margin: "0 auto 20px" }}>
            Your personal quantitative market intelligence terminal. Real-time signals, AI-powered analysis, macro calendar, and Phantom Wallet — all in one place.
          </p>

          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: "14px 18px", marginBottom: 28, fontSize: 11, color: C.muted2, lineHeight: 1.7, textAlign: "left" }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: isDark ? C.gold : "#0d1b35", letterSpacing: "0.15em", fontWeight: 700 }}>EDUCATION & INFORMATION PLATFORM</span>
            <div style={{ marginTop: 6 }}>
              CLVRQuant does <strong style={{ color: C.white }}>not</strong> execute trades, manage funds, or provide financial advice.
              All content is for <strong style={{ color: C.white }}>informational and learning purposes only.</strong>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            <button data-testid="btn-create-account" onClick={() => setMode("signup")} style={btnGold}>
              Create Free Account →
            </button>
            {hasBiometric ? (
              <button
                data-testid="btn-faceid-welcome"
                onClick={handleBiometricSignIn}
                disabled={waLoading}
                style={{
                  ...btnGhost, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  background: "rgba(255,255,255,0.03)",
                  opacity: waLoading ? 0.6 : 1, cursor: waLoading ? "not-allowed" : "pointer",
                }}
              >
                <span style={{ fontSize: 18 }}>🔒</span>
                <span style={{ fontFamily: MONO, fontSize: 12 }}>{waLoading ? "Verifying..." : "Continue with Face ID"}</span>
              </button>
            ) : (
              <button data-testid="btn-signin" onClick={() => setMode("signin")} style={btnGhost}>
                Sign In
              </button>
            )}
            {hasBiometric && (
              <button data-testid="btn-signin" onClick={() => setMode("signin")} style={{ ...btnGhost, fontSize: 11, color: C.muted, borderColor: C.border }}>
                Sign In with Password
              </button>
            )}
            <button data-testid="btn-explore" onClick={() => setMode("tour")}
              style={{ ...btnGhost, fontSize: 11, color: C.gold, borderColor: "rgba(201,168,76,.3)", letterSpacing: "0.08em" }}>
              Explore Features →
            </button>
          </div>

          {/* Theme toggle */}
          {onToggleTheme && (
            <div style={{ marginTop: 16, marginBottom: 4, textAlign: "center" }}>
              <button data-testid="btn-welcome-theme-toggle" onClick={onToggleTheme} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 14px", fontFamily: MONO, fontSize: 9, color: C.muted, cursor: "pointer", letterSpacing: "0.1em", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {isDark ? "☀️ Light Mode" : "🌙 Dark Mode"}
              </button>
            </div>
          )}

          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, lineHeight: 1.8, maxWidth: 380, margin: "0 auto" }}>
            By using CLVRQuant you agree that all market data and AI analysis is for informational purposes only. Trading involves substantial risk of loss. CLVRQuant, Mike Claver, and affiliated entities bear <strong style={{ color: C.muted2 }}>no liability</strong> for any financial decisions or losses.{" "}
            <span data-testid="link-full-disclaimer" onClick={() => setShowLegal(true)} style={{ color: C.gold, cursor: "pointer", textDecoration: "underline" }}>Read full disclaimer →</span>
          </div>

          {/* Social media links */}
          <div style={{ marginTop: 28, marginBottom: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.18em", marginBottom: 14, textTransform: "uppercase" }}>
              Follow for live signals &amp; market insights
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
              <a
                data-testid="link-instagram"
                href="https://www.instagram.com/clvrquantai?igsh=MTU0d25zcm5uaGp1cg%3D%3D&utm_source=qr"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  minWidth: 44, minHeight: 44, padding: "0 16px",
                  borderRadius: 8,
                  background: "rgba(201,168,76,0.07)",
                  border: "1px solid rgba(201,168,76,0.22)",
                  color: C.gold2,
                  textDecoration: "none",
                  fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em",
                  justifyContent: "center",
                }}
              >
                <SiInstagram size={18} />
                <span>Instagram</span>
              </a>
              <a
                data-testid="link-tiktok"
                href="https://www.tiktok.com/@clvrquantai"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  minWidth: 44, minHeight: 44, padding: "0 16px",
                  borderRadius: 8,
                  background: "rgba(201,168,76,0.07)",
                  border: "1px solid rgba(201,168,76,0.22)",
                  color: C.gold2,
                  textDecoration: "none",
                  fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em",
                  justifyContent: "center",
                }}
              >
                <SiTiktok size={17} />
                <span>TikTok</span>
              </a>
            </div>
          </div>

          <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 8, color: C.muted }}>© 2026 CLVRQuant · Mike Claver · Not a registered financial advisor</div>
        </div>
      )}

      {mode === "signup" && (
        <div data-testid="signup-screen" style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "28px 24px", width: "100%", maxWidth: 420, margin: "0 auto", position: "relative", zIndex: 1, animation: "goldPulse 4s ease-in-out infinite" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.gold},transparent)` }} />
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, marginBottom: 4, color: C.gold2 }}>
              CLVRQuant
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700, color: C.white }}>Create your account</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: "0.12em" }}>Free forever · No credit card required</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>FULL NAME</label>
              <input data-testid="input-signup-name" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Your name" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>EMAIL ADDRESS</label>
              <input data-testid="input-signup-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@email.com" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>PASSWORD</label>
              <input data-testid="input-signup-password" type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="Min 6 characters" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>CONFIRM PASSWORD</label>
              <input data-testid="input-signup-confirm" type="password" value={form.confirm} onChange={e => set("confirm", e.target.value)} placeholder="Repeat password" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>REFERRAL CODE <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span></label>
              <input data-testid="input-signup-referral" value={form.referralCode} onChange={e => set("referralCode", e.target.value.toUpperCase())} placeholder="CLVR-REF-XXXXXX" style={{ ...inputStyle, fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em" }} />
            </div>

            <div style={{ background: C.bg, border: `1px solid rgba(201,168,76,.15)`, borderRadius: 6, padding: "12px 14px" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input data-testid="checkbox-daily-email" type="checkbox" checked={form.dailyEmail} onChange={e => set("dailyEmail", e.target.checked)}
                  style={{ marginTop: 2, accentColor: C.gold, width: 16, height: 16, flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: SANS, fontSize: 13, color: C.white, fontWeight: 600 }}>Daily 6AM Market Brief</div>
                  <div style={{ fontFamily: SANS, fontSize: 11, color: C.muted2, marginTop: 3, lineHeight: 1.6 }}>Receive a daily morning email with key market signals, top setups, and QuantBrain insights before markets open.</div>
                </div>
              </label>
              <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 9, color: C.muted, lineHeight: 1.7, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                We will <strong style={{ color: C.muted2 }}>never</strong> sell, share, or spam your email. Unsubscribe anytime.{" "}
                <span data-testid="link-email-policy" onClick={() => setShowSpam(true)} style={{ color: C.gold, cursor: "pointer" }}>Email policy →</span>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input data-testid="checkbox-agree-terms" type="checkbox" checked={form.agreeTerms} onChange={e => set("agreeTerms", e.target.checked)}
                style={{ marginTop: 2, accentColor: C.gold, width: 16, height: 16, flexShrink: 0 }} />
              <span style={{ fontFamily: SANS, fontSize: 11, color: C.muted2, lineHeight: 1.6 }}>
                I understand CLVRQuant is for <strong style={{ color: C.white }}>education/information only</strong>, not financial advice. I accept all risks.{" "}
                <span onClick={() => setShowLegal(true)} style={{ color: C.gold, cursor: "pointer" }}>Terms →</span>
              </span>
            </label>

            {error && <div data-testid="text-auth-error" style={{ fontFamily: MONO, fontSize: 11, color: C.red, padding: "8px 12px", background: "rgba(255,64,96,.06)", border: `1px solid rgba(255,64,96,.2)`, borderRadius: 4 }}>{error}</div>}

            <button data-testid="btn-submit-signup" onClick={handleSignUp} disabled={loading}
              style={{ ...btnGold, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Creating Account..." : "Create Account →"}
            </button>

            <button data-testid="btn-back-signin" onClick={() => { setMode("signin"); setError(""); }}
              style={{ ...btnGhost, fontSize: 11 }}>
              Already have an account? Sign In
            </button>
          </div>
        </div>
      )}

      {mode === "signin" && (
        <div data-testid="signin-screen" style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "28px 24px", width: "100%", maxWidth: 420, margin: "0 auto", position: "relative", zIndex: 1, animation: "goldPulse 4s ease-in-out infinite" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.gold},transparent)` }} />
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, marginBottom: 4, color: C.gold2 }}>
              CLVRQuant
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700, color: C.white }}>Welcome back</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: "0.12em" }}>Sign in to your account</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>EMAIL ADDRESS</label>
              <input data-testid="input-signin-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@email.com" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>PASSWORD</label>
              <input data-testid="input-signin-password" type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="Your password"
                style={inputStyle} onKeyDown={e => e.key === "Enter" && handleSignIn()} />
            </div>

            {error && error !== "__network__" && <div data-testid="text-auth-error" style={{ fontFamily: MONO, fontSize: 11, color: C.red, padding: "8px 12px", background: "rgba(255,64,96,.06)", border: `1px solid rgba(255,64,96,.2)`, borderRadius: 4 }}>{error}</div>}
            {error === "__network__" && (
              <div data-testid="text-network-error" style={{ fontFamily: MONO, fontSize: 11, color: C.gold, padding: "10px 12px", background: "rgba(201,168,76,.06)", border: `1px solid rgba(201,168,76,.3)`, borderRadius: 4, textAlign: "center" }}>
                <div style={{ marginBottom: 8 }}>Connection interrupted. Please reload and try again.</div>
                <button onClick={() => window.location.reload()} style={{ background: C.gold, color: "#050709", border: "none", borderRadius: 4, padding: "6px 16px", fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em" }}>
                  RELOAD PAGE
                </button>
              </div>
            )}
            {success && <div data-testid="text-auth-success" style={{ fontFamily: MONO, fontSize: 11, color: C.green, padding: "8px 12px", background: "rgba(0,199,135,.06)", border: `1px solid rgba(0,199,135,.2)`, borderRadius: 4 }}>{success}</div>}

            <button data-testid="btn-submit-signin" onClick={handleSignIn} disabled={loading}
              style={{ ...btnGold, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Signing In..." : "Sign In →"}
            </button>

            {hasBiometric && (
              <button
                data-testid="btn-faceid-signin"
                onClick={handleBiometricSignIn}
                disabled={waLoading}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.12)`,
                  borderRadius: 6, padding: "12px 16px", color: C.white, fontFamily: MONO,
                  fontSize: 12, cursor: waLoading ? "not-allowed" : "pointer",
                  opacity: waLoading ? 0.6 : 1, letterSpacing: "0.06em",
                }}
              >
                <span style={{ fontSize: 20 }}>🔒</span>
                <span>{waLoading ? "Verifying..." : "Continue with Face ID / Biometric"}</span>
              </button>
            )}

            <button data-testid="btn-forgot-password" onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.06em", padding: "4px 0" }}>
              Forgot Password?
            </button>

            <button data-testid="btn-back-signup" onClick={() => { setMode("signup"); setError(""); }}
              style={{ ...btnGhost, fontSize: 11 }}>
              Need an account? Create one
            </button>

            <button data-testid="btn-guest-signin" onClick={() => setMode("tour")}
              style={{ ...btnGhost, fontSize: 10, color: C.muted, borderColor: C.border }}>
              Explore Features →
            </button>
          </div>
        </div>
      )}

      {mode === "forgot" && (
        <div data-testid="forgot-screen" style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "28px 24px", width: "100%", maxWidth: 420, margin: "0 auto", position: "relative", zIndex: 1, animation: "goldPulse 4s ease-in-out infinite" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.gold},transparent)` }} />
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, marginBottom: 4, color: C.gold2 }}>CLVRQuant</div>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700, color: C.white }}>Reset Password</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: "0.12em" }}>We'll send a temporary password to your email</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>EMAIL ADDRESS</label>
              <input data-testid="input-forgot-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@email.com"
                style={inputStyle} onKeyDown={e => e.key === "Enter" && handleForgotPassword()} />
            </div>

            {error && <div data-testid="text-auth-error" style={{ fontFamily: MONO, fontSize: 11, color: C.red, padding: "8px 12px", background: "rgba(255,64,96,.06)", border: `1px solid rgba(255,64,96,.2)`, borderRadius: 4 }}>{error}</div>}
            {success && <div data-testid="text-auth-success" style={{ fontFamily: MONO, fontSize: 11, color: C.green, padding: "8px 12px", background: "rgba(0,199,135,.06)", border: `1px solid rgba(0,199,135,.2)`, borderRadius: 4, lineHeight: 1.6 }}>{success}</div>}

            <button data-testid="btn-submit-forgot" onClick={handleForgotPassword} disabled={loading}
              style={{ ...btnGold, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Sending..." : "Send Reset Email →"}
            </button>

            <button data-testid="btn-back-signin-forgot" onClick={() => { setMode("signin"); setError(""); setSuccess(""); }}
              style={{ ...btnGhost, fontSize: 11 }}>
              ← Back to Sign In
            </button>
          </div>
        </div>
      )}

      {mode === "reset-password" && (
        <div data-testid="reset-password-screen" style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "28px 24px", width: "100%", maxWidth: 420, margin: "0 auto", position: "relative", zIndex: 1, animation: "goldPulse 4s ease-in-out infinite" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${C.gold},transparent)` }} />
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, marginBottom: 4, color: C.gold2 }}>CLVRQuant</div>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700, color: C.white }}>Set New Password</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: "0.12em" }}>Choose a new password for your account</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>NEW PASSWORD</label>
              <input data-testid="input-new-password" type="password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setError(""); }} placeholder="Min 6 characters" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginBottom: 5, display: "block", letterSpacing: "0.12em" }}>CONFIRM NEW PASSWORD</label>
              <input data-testid="input-confirm-new-password" type="password" value={newPasswordConfirm} onChange={e => { setNewPasswordConfirm(e.target.value); setError(""); }} placeholder="Repeat new password"
                style={inputStyle} onKeyDown={e => e.key === "Enter" && handleResetPassword()} />
            </div>

            {error && <div data-testid="text-auth-error" style={{ fontFamily: MONO, fontSize: 11, color: C.red, padding: "8px 12px", background: "rgba(255,64,96,.06)", border: `1px solid rgba(255,64,96,.2)`, borderRadius: 4 }}>{error}</div>}
            {success && <div data-testid="text-auth-success" style={{ fontFamily: MONO, fontSize: 11, color: C.green, padding: "8px 12px", background: "rgba(0,199,135,.06)", border: `1px solid rgba(0,199,135,.2)`, borderRadius: 4 }}>{success}</div>}

            <button data-testid="btn-submit-reset" onClick={handleResetPassword} disabled={loading}
              style={{ ...btnGold, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Resetting..." : "Set New Password →"}
            </button>

            <button data-testid="btn-back-signin-reset" onClick={() => { setMode("signin"); setError(""); setSuccess(""); window.history.replaceState({}, "", window.location.pathname); }}
              style={{ ...btnGhost, fontSize: 11 }}>
              ← Back to Sign In
            </button>
          </div>
        </div>
      )}

      {mode === "verify" && (
        <div data-testid="verify-screen" style={{ textAlign: "center", maxWidth: 420, width: "100%", position: "relative", zIndex: 1 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, background: "rgba(0,199,135,.1)", border: `1px solid rgba(0,199,135,.3)`, borderRadius: 14, marginBottom: 20 }}>
            <span style={{ fontSize: 30 }}>✓</span>
          </div>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 24, color: C.white, marginBottom: 8 }}>Account Created</div>
          <div style={{ fontFamily: SANS, fontSize: 14, color: C.muted2, lineHeight: 1.8, marginBottom: 8 }}>
            Welcome to CLVRQuant, <strong style={{ color: C.gold2 }}>{form.name}</strong>!
          </div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
            A welcome email has been sent to <strong style={{ color: C.text }}>{form.email}</strong>.
            {form.dailyEmail && <><br />You're subscribed to the <span style={{ color: C.gold }}>6AM Daily Brief</span>.</>}
          </div>
          <button data-testid="btn-enter-app" onClick={() => {
            if (signedUpUser) { onEnter(signedUpUser); return; }
            fetch("/api/auth/me?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()).then(data => {
              if (data.user) onEnter(data.user);
              else { setError("Session expired. Please sign in."); setMode("signin"); }
            }).catch(() => { setError("Connection error. Please sign in."); setMode("signin"); });
          }} style={btnGold}>
            Enter CLVRQuant →
          </button>
        </div>
      )}

      {showLegal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => setShowLegal(false)}>
          <div style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: 24, maxWidth: 480, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.orange, letterSpacing: "0.15em", marginBottom: 14 }}>FULL DISCLAIMER & TERMS OF USE</div>
            <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted2, lineHeight: 1.9, marginBottom: 16 }}>{LEGAL}</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, lineHeight: 1.8, borderTop: `1px solid ${C.border}`, paddingTop: 12, marginBottom: 16 }}>
              <strong style={{ color: C.muted2 }}>Created by:</strong> Mike Claver<br />
              <strong style={{ color: C.muted2 }}>Entity:</strong> CLVRQuant<br />
              <strong style={{ color: C.muted2 }}>Purpose:</strong> Market education and information only<br />
              <strong style={{ color: C.muted2 }}>Not registered as:</strong> Investment advisor, broker, or financial institution<br />
              <strong style={{ color: C.muted2 }}>Jurisdiction:</strong> Users are responsible for compliance with local laws
            </div>
            <button data-testid="btn-close-legal" onClick={() => setShowLegal(false)} style={btnGhost}>Close</button>
          </div>
        </div>
      )}

      {showSpam && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => setShowSpam(false)}>
          <div style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 8, padding: 24, maxWidth: 420, width: "100%" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.cyan, letterSpacing: "0.15em", marginBottom: 14 }}>EMAIL & ANTI-SPAM POLICY</div>
            {[
              ["What we send", "Welcome email on signup, optional 6AM daily market brief, and occasional product updates (max 1-2/month)."],
              ["What we never do", "We will never sell, rent, or share your email address with any third party, advertiser, or data broker."],
              ["Unsubscribe", "Every email contains an unsubscribe link. One click and you're off the list — no questions asked."],
              ["Daily Brief", "Subscribed to the 6AM brief? You can unsubscribe at any time via the link in any daily email."],
              ["Spam", "CLVRQuant has a strict zero-spam policy. If you receive something you didn't expect, email us and we'll fix it immediately."],
              ["Sender", "All emails come from our verified domain. Add us to your safe senders to avoid the spam folder."],
            ].map(([title, body]) => (
              <div key={title} style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.muted2, marginBottom: 3 }}>{title}</div>
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>{body}</div>
              </div>
            ))}
            <button data-testid="btn-close-spam" onClick={() => setShowSpam(false)} style={{ ...btnGhost, marginTop: 8 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
