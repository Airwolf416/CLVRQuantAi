import { useState, useEffect } from "react";

const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";
const C = {
  bg:      "#050709",
  panel:   "#0c1220",
  border:  "#141e35",
  gold:    "#c9a84c",
  gold2:   "#e8c96d",
  muted:   "#4a5568",
  muted2:  "#8899aa",
  text:    "#e2e8f0",
  white:   "#ffffff",
};

const TOUR_KEY = "clvr_tour_v1_done";

const STEPS = [
  {
    icon: "✦",
    label: "WELCOME",
    title: "Your AI Market Terminal",
    subtitle: "A quick tour — 6 steps",
    body: "CLVRQuant gives you real-time prices across every major asset class, AI-generated trade signals, a macro calendar, and Claude AI analysis — all in one mobile-first dashboard.",
    cta: null,
    tab: null,
  },
  {
    icon: "📡",
    label: "RADAR",
    title: "Live Market Radar",
    subtitle: "Start here every session",
    body: "The Radar tab is your command centre. Live BTC, ETH, SOL, Gold, Forex prices tick in real-time. Alpha signals surface the biggest movers, whale alerts, and funding rate anomalies across 32 assets.",
    cta: "Open Radar →",
    tab: "radar",
  },
  {
    icon: "💹",
    label: "MARKETS",
    title: "All Asset Classes",
    subtitle: "32 crypto · 16 equities · 7 commodities · 14 forex",
    body: "Full coverage across every market. Tap any asset to see the live price, 24h change, open interest, and funding rates. Toggle between Spot and Perpetuals for crypto. Star assets to your watchlist.",
    cta: "Open Markets →",
    tab: "prices",
  },
  {
    icon: "⚡",
    label: "SIGNALS",
    title: "AI Trade Signals",
    subtitle: "Entry · Stop · TP1 · TP2 · Confidence",
    body: "Quantitative signals generated from live price action, funding rates, open interest, and macro context. Each signal includes a precise entry, stop-loss, two profit targets, and a Kelly-sized confidence score.",
    cta: "Open Signals →",
    tab: "signals",
  },
  {
    icon: "🏦",
    label: "MACRO",
    title: "Global Macro Calendar",
    subtitle: "Fed · ECB · CPI · NFP · BOJ",
    body: "Never be caught off-guard by a macro event. The calendar shows upcoming central bank decisions, inflation prints, jobs reports, and earnings — with AI commentary on likely market impact.",
    cta: "Open Macro →",
    tab: "macro",
  },
  {
    icon: "🔔",
    label: "ALERTS",
    title: "Custom Price Alerts",
    subtitle: "Push notifications to your device",
    body: "Set price alerts for any asset. Choose a threshold, direction, and field (price, funding rate, or open interest). When triggered, you get a push notification instantly — even when the app is closed.",
    cta: "Open Alerts →",
    tab: "alerts",
  },
  {
    icon: "✦",
    label: "AI ANALYST — PRO",
    title: "Ask Claude AI Anything",
    subtitle: "Powered by Claude Sonnet 4",
    body: "Type any question about markets and Claude AI responds with institutional-grade analysis. Ask for trade ideas, macro breakdowns, sector rotations, or risk assessments. Pro subscribers also get a personalised Morning Brief at 6 AM ET daily.",
    cta: "Open AI →",
    tab: "ai",
    pro: true,
  },
];

export default function OnboardingTour({ onClose, onNavigateTab, isPro }) {
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);
  const total = STEPS.length;
  const current = STEPS[step];

  const finish = () => {
    setExiting(true);
    setTimeout(() => {
      try { localStorage.setItem(TOUR_KEY, "1"); } catch {}
      onClose();
    }, 300);
  };

  const next = () => {
    if (step < total - 1) setStep(s => s + 1);
    else finish();
  };

  const prev = () => { if (step > 0) setStep(s => s - 1); };

  const handleCta = () => {
    if (current.tab) onNavigateTab(current.tab);
    finish();
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(5,7,9,0.92)",
        backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px 20px",
        opacity: exiting ? 0 : 1,
        transition: "opacity .3s ease",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(); }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=IBM+Plex+Mono:wght@400;500;600&family=Barlow:wght@400;500;600&display=swap');
        @keyframes tourSlideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        @keyframes tourPulse{0%,100%{opacity:.7}50%{opacity:1}}
      `}</style>

      {/* Card */}
      <div
        key={step}
        style={{
          width: "100%", maxWidth: 420,
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "32px 28px 28px",
          position: "relative",
          animation: "tourSlideUp .35s ease",
          boxShadow: "0 0 60px rgba(201,168,76,.08), 0 24px 48px rgba(0,0,0,.6)",
        }}
      >
        {/* Top accent line */}
        <div style={{ position: "absolute", top: 0, left: 28, right: 28, height: 2, background: `linear-gradient(90deg,transparent,${C.gold},transparent)`, borderRadius: 1 }} />

        {/* Skip */}
        <button
          onClick={finish}
          style={{ position: "absolute", top: 16, right: 18, background: "none", border: "none", fontFamily: MONO, fontSize: 10, color: C.muted, cursor: "pointer", letterSpacing: "0.1em", padding: "4px 8px" }}
        >
          SKIP
        </button>

        {/* Step badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <div style={{
            fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.2em",
            background: "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.2)`,
            borderRadius: 3, padding: "3px 8px", fontWeight: 600,
          }}>
            {current.label}
          </div>
          {current.pro && (
            <div style={{
              fontFamily: MONO, fontSize: 9, color: "#a855f7", letterSpacing: "0.15em",
              background: "rgba(168,85,247,.1)", border: "1px solid rgba(168,85,247,.25)",
              borderRadius: 3, padding: "3px 8px", fontWeight: 600,
            }}>
              PRO
            </div>
          )}
        </div>

        {/* Icon */}
        <div style={{
          fontSize: 36, marginBottom: 16, lineHeight: 1,
          textShadow: "0 0 20px rgba(201,168,76,.3)",
          animation: "tourPulse 3s ease-in-out infinite",
        }}>
          {current.icon}
        </div>

        {/* Title */}
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 26, color: C.gold2, lineHeight: 1.2, marginBottom: 6 }}>
          {current.title}
        </div>

        {/* Subtitle */}
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.15em", marginBottom: 16, fontWeight: 500 }}>
          {current.subtitle}
        </div>

        {/* Body */}
        <div style={{ fontFamily: SANS, fontSize: 14, color: C.muted2, lineHeight: 1.75, marginBottom: 28 }}>
          {current.body}
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 24 }}>
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: i === step ? 20 : 6, height: 6,
                borderRadius: 3,
                background: i === step ? C.gold : C.border,
                border: "none", padding: 0, cursor: "pointer",
                transition: "all .25s ease",
              }}
            />
          ))}
        </div>

        {/* Buttons row: Back + Next/Done */}
        <div style={{ display: "flex", gap: 10, marginBottom: current.cta ? 10 : 0 }}>
          {step > 0 ? (
            <button
              onClick={prev}
              style={{ flex: 1, padding: "12px", borderRadius: 6, background: "transparent", border: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 12, color: C.muted2, cursor: "pointer", letterSpacing: "0.06em" }}
            >
              ← Back
            </button>
          ) : <div style={{ flex: 1 }} />}

          <button
            onClick={step === total - 1 ? finish : next}
            style={{ flex: 2, padding: "12px", borderRadius: 6, background: "rgba(201,168,76,.12)", border: `1px solid rgba(201,168,76,.4)`, fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 15, color: C.gold2, cursor: "pointer" }}
          >
            {step === 0 ? "Begin Tour →" : step === total - 1 ? "Done ✦" : "Next →"}
          </button>
        </div>

        {/* CTA — navigate to the feature tab */}
        {current.cta && (
          <button
            onClick={handleCta}
            style={{ width: "100%", padding: "11px", borderRadius: 6, background: "transparent", border: `1px solid rgba(201,168,76,.2)`, fontFamily: MONO, fontSize: 11, color: C.gold, cursor: "pointer", letterSpacing: "0.08em" }}
          >
            {current.cta}
          </button>
        )}

        {/* Step counter */}
        <div style={{ textAlign: "center", marginTop: 14, fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.15em" }}>
          {step + 1} / {total}
        </div>
      </div>
    </div>
  );
}

// Helper: should we show the tour?
export function shouldShowTour() {
  try { return !localStorage.getItem(TOUR_KEY); } catch { return false; }
}
