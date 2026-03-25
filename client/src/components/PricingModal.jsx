import { useState } from "react";
import { TIERS, TIER_ORDER } from "../config/pricing.js";

const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

const C = {
  bg:     "#060a13",
  panel:  "#0a1020",
  panel2: "#0d1526",
  border: "#141e35",
  border2:"#1c2b4a",
  gold:   "#d4af37",
  gold2:  "#e8c96d",
  cyan:   "#00e5ff",
  green:  "#00ff88",
  muted:  "#4a5d80",
  muted2: "#6b7a99",
  text:   "#c8d4ee",
  white:  "#f0f4ff",
};

function CheckIcon({ color = C.green }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="6.5" cy="6.5" r="6" fill={color + "18"} stroke={color + "55"} strokeWidth="1"/>
      <path d="M4 6.5L5.8 8.5L9 4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <rect x="2" y="5" width="7" height="5" rx="1" fill="none" stroke={C.muted} strokeWidth="1"/>
      <path d="M3.5 5V3.5a2 2 0 0 1 4 0V5" stroke={C.muted} strokeWidth="1" fill="none"/>
    </svg>
  );
}

function FeatureRow({ feature }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 9 }}>
      {feature.locked
        ? <LockIcon />
        : <CheckIcon color={feature.elite ? C.cyan : C.green} />
      }
      <div style={{ flex: 1 }}>
        <span style={{
          fontFamily: MONO, fontSize: 11,
          color: feature.locked ? C.muted : feature.elite ? C.text : C.text,
          textDecoration: feature.locked ? "none" : "none",
          lineHeight: 1.4,
        }}>
          {feature.label}
        </span>
        {feature.tag && (
          <span style={{
            display: "inline-block", marginLeft: 6,
            background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.3)",
            borderRadius: 2, padding: "1px 5px",
            fontFamily: MONO, fontSize: 7, color: C.cyan,
            letterSpacing: "0.08em", verticalAlign: "middle",
          }}>
            {feature.tag}
          </span>
        )}
        {feature.locked && feature.note && (
          <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginLeft: 6 }}>
            — {feature.note}
          </span>
        )}
      </div>
    </div>
  );
}

function PricingCard({ tier, yearly, userTier, onSelect, isLoading }) {
  const isCurrentPlan = userTier === tier.id;
  const tierIdx  = TIER_ORDER.indexOf(tier.id);
  const userIdx  = TIER_ORDER.indexOf(userTier || "free");
  const isHigher = tierIdx > userIdx;
  const isElite  = tier.id === "elite";

  const displayPrice = tier.monthlyPrice === 0 ? 0 : yearly ? tier.yearlyPrice / 12 : tier.monthlyPrice;
  const displayPriceFull = tier.monthlyPrice === 0 ? null : yearly ? tier.yearlyPrice : null;

  return (
    <div
      data-testid={`pricing-card-${tier.id}`}
      style={{
        position: "relative",
        background: isElite
          ? "linear-gradient(180deg, rgba(0,229,255,0.04) 0%, rgba(6,10,19,0) 100%)"
          : C.panel,
        border: `1px solid ${isElite ? C.cyan + "88" : tier.borderColor}`,
        borderRadius: 12,
        padding: "22px 18px 20px",
        boxShadow: isElite
          ? "0 0 40px rgba(0,229,255,0.08), 0 0 1px rgba(0,229,255,0.3) inset"
          : "none",
        transition: "transform 0.2s",
        flex: "1 1 0",
        minWidth: 0,
      }}
    >
      {/* ELITE badge */}
      {tier.badge && (
        <div style={{
          position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(90deg, #00b4cc, #00e5ff)",
          borderRadius: 20, padding: "3px 14px",
          fontFamily: MONO, fontSize: 8, fontWeight: 800,
          color: "#060a13", letterSpacing: "0.15em", whiteSpace: "nowrap",
        }}>
          ★ {tier.badge}
        </div>
      )}

      {/* Tier name */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: tier.color, letterSpacing: "0.2em", fontWeight: 700 }}>
          {tier.id === "free" ? "FREE" : tier.name.toUpperCase()}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 14, color: C.text, marginTop: 2 }}>{tier.tagline}</div>
      </div>

      {/* Price */}
      <div style={{ margin: "18px 0 6px" }}>
        {tier.monthlyPrice === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 900, color: C.white, lineHeight: 1 }}>$0</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 32, fontWeight: 900, color: C.white, lineHeight: 1 }}>
                ${displayPrice.toFixed(2)}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginBottom: 4 }}>/mo</div>
            </div>
            {yearly && (
              <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginTop: 3 }}>
                ${tier.yearlyPrice}/yr billed annually
              </div>
            )}
          </>
        )}
      </div>

      {/* Yearly savings badge */}
      {yearly && tier.yearlySavings && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)",
          borderRadius: 20, padding: "3px 10px", marginBottom: 16,
        }}>
          <span style={{ fontSize: 8 }}>💚</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.green, fontWeight: 700 }}>
            Save ${tier.yearlySavings}
          </span>
        </div>
      )}
      {(!yearly || !tier.yearlySavings) && <div style={{ marginBottom: 16 }} />}

      {/* Divider */}
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${tier.borderColor}, transparent)`, marginBottom: 16 }} />

      {/* Features */}
      <div style={{ marginBottom: 20 }}>
        {tier.features.map((f, i) => <FeatureRow key={i} feature={f} />)}
      </div>

      {/* CTA Button */}
      {tier.monthlyPrice === 0 ? (
        <button
          data-testid={`btn-pricing-${tier.id}`}
          disabled
          style={{
            width: "100%", padding: "12px 0", borderRadius: 6,
            background: "transparent", border: `1px solid ${C.border2}`,
            fontFamily: MONO, fontSize: 11, color: C.muted,
            cursor: "default", letterSpacing: "0.1em",
          }}
        >
          {isCurrentPlan ? "Current Plan" : "Free Forever"}
        </button>
      ) : isCurrentPlan ? (
        <button
          data-testid={`btn-pricing-${tier.id}`}
          disabled
          style={{
            width: "100%", padding: "12px 0", borderRadius: 6,
            background: `${tier.color}12`, border: `1px solid ${tier.color}50`,
            fontFamily: MONO, fontSize: 11, color: tier.color,
            cursor: "default", letterSpacing: "0.1em",
          }}
        >
          ✓ Current Plan
        </button>
      ) : (
        <button
          data-testid={`btn-pricing-${tier.id}`}
          onClick={() => onSelect(tier, yearly)}
          disabled={isLoading}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 6,
            background: isElite
              ? "linear-gradient(90deg, rgba(0,180,204,0.18), rgba(0,229,255,0.18))"
              : `${tier.color}15`,
            border: `1px solid ${isElite ? C.cyan : tier.color}`,
            fontFamily: MONO, fontSize: 11,
            color: isElite ? C.cyan : tier.color,
            cursor: isLoading ? "not-allowed" : "pointer",
            letterSpacing: "0.1em", fontWeight: 700,
            boxShadow: isElite ? `0 0 16px rgba(0,229,255,0.12)` : "none",
            transition: "all 0.2s",
          }}
        >
          {isLoading ? "Redirecting..." : isHigher ? `Upgrade to ${tier.name}` : `Switch to ${tier.name}`}
        </button>
      )}
    </div>
  );
}

export default function PricingModal({ isOpen, onClose, userTier = "free", onUpgrade }) {
  const [yearly,  setYearly]  = useState(false);
  const [loading, setLoading] = useState(null);

  if (!isOpen) return null;

  const handleSelect = async (tier, isYearly) => {
    if (tier.monthlyPrice === 0) return;
    setLoading(tier.id);
    try {
      if (onUpgrade) await onUpgrade(tier.id, isYearly ? "yearly" : "monthly");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      data-testid="pricing-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(6,10,19,0.92)", backdropFilter: "blur(8px)",
        zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        data-testid="pricing-modal"
        style={{
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 16, width: "100%", maxWidth: 900,
          maxHeight: "90vh", overflowY: "auto",
          padding: "32px 24px 28px",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <button
            data-testid="btn-pricing-close"
            onClick={onClose}
            style={{
              position: "absolute", top: 20, right: 20,
              background: "transparent", border: "none",
              color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1,
            }}
          >✕</button>

          <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.3em", marginBottom: 8 }}>
            CLVR QUANTAI — SUBSCRIPTION PLANS
          </div>
          <h2 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 900, color: C.white, margin: "0 0 8px" }}>
            Institutional-Grade Intelligence
          </h2>
          <p style={{ fontFamily: MONO, fontSize: 11, color: C.muted2, margin: 0 }}>
            Real-time markets · AI Quant Engine · SEC insider flow · No data latency
          </p>

          {/* Billing toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 22 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: yearly ? C.muted : C.text }}>Monthly</span>
            <button
              data-testid="btn-billing-toggle"
              onClick={() => setYearly(y => !y)}
              style={{
                width: 46, height: 24, borderRadius: 12,
                background: yearly ? "rgba(0,255,136,0.2)" : C.border2,
                border: `1px solid ${yearly ? "rgba(0,255,136,0.4)" : C.border}`,
                cursor: "pointer", position: "relative", transition: "all 0.25s",
                padding: 0,
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: yearly ? C.green : C.muted,
                position: "absolute", top: 3,
                left: yearly ? 26 : 4,
                transition: "all 0.25s",
                boxShadow: yearly ? `0 0 8px ${C.green}50` : "none",
              }} />
            </button>
            <span style={{ fontFamily: MONO, fontSize: 11, color: yearly ? C.text : C.muted }}>
              Yearly
              <span style={{ marginLeft: 6, background: "rgba(0,255,136,0.12)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 20, padding: "2px 7px", fontSize: 8, color: C.green }}>
                SAVE UP TO $349
              </span>
            </span>
          </div>
        </div>

        {/* Cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {TIER_ORDER.map(id => (
            <PricingCard
              key={id}
              tier={TIERS[id]}
              yearly={yearly}
              userTier={userTier}
              onSelect={handleSelect}
              isLoading={loading === id}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, lineHeight: 2 }}>
            Cancel anytime · Secure checkout via Stripe · All prices in USD
          </div>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 2 }}>
            CLVRQuant is an informational platform only — not financial advice.
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
