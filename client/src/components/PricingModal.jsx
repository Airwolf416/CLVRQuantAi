import { useState, useEffect } from "react";
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

const TAB_COLORS = { free: C.muted2, pro: C.gold, elite: C.cyan };

function CheckIcon({ color = C.green }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="7" cy="7" r="6.5" fill={color + "18"} stroke={color + "55"} strokeWidth="1"/>
      <path d="M4.5 7L6.3 9L9.5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <rect x="2" y="5.5" width="8" height="5" rx="1.5" fill="none" stroke={C.muted} strokeWidth="1"/>
      <path d="M4 5.5V4A2 2 0 0 1 8 4V5.5" stroke={C.muted} strokeWidth="1" fill="none"/>
    </svg>
  );
}

export default function PricingModal({ isOpen, onClose, userTier = "free", onUpgrade, defaultTier }) {
  const [activeTier, setActiveTier] = useState(defaultTier || (userTier === "elite" ? "elite" : "pro"));
  const [yearly, setYearly] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) setActiveTier(defaultTier || (userTier === "elite" ? "elite" : "pro"));
  }, [isOpen, defaultTier, userTier]);

  if (!isOpen) return null;

  const tier = TIERS[activeTier];
  const tierColor = TAB_COLORS[activeTier];
  const isElite = activeTier === "elite";
  const isFree = activeTier === "free";
  const tierIdx = TIER_ORDER.indexOf(activeTier);
  const userIdx = TIER_ORDER.indexOf(userTier || "free");
  const isCurrentPlan = userTier === activeTier;
  const isHigher = tierIdx > userIdx;

  const monthlyDisplay = isFree ? 0 : yearly ? (tier.yearlyPrice / 12) : tier.monthlyPrice;
  const yearlyTotal = isFree ? 0 : tier.yearlyPrice;

  const handleUpgrade = async () => {
    if (isFree || isCurrentPlan) return;
    setLoading(true);
    try {
      if (onUpgrade) await onUpgrade(activeTier, yearly ? "yearly" : "monthly");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="pricing-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(6,10,19,0.94)", backdropFilter: "blur(10px)",
        zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: 0,
      }}
    >
      <div
        data-testid="pricing-modal"
        style={{
          background: C.bg,
          border: `1px solid ${C.border2}`,
          borderRadius: "20px 20px 0 0",
          width: "100%", maxWidth: 520,
          maxHeight: "93vh", overflowY: "auto",
          paddingBottom: "env(safe-area-inset-bottom, 12px)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 6px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border2 }} />
        </div>

        {/* Header */}
        <div style={{ padding: "0 20px 20px", position: "relative" }}>
          <button
            data-testid="btn-pricing-close"
            onClick={onClose}
            style={{
              position: "absolute", top: 0, right: 20,
              background: C.border2, border: "none", borderRadius: "50%",
              width: 30, height: 30, color: C.muted2, fontSize: 14,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>

          <div style={{ textAlign: "center", paddingRight: 40 }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.gold, letterSpacing: "0.3em", marginBottom: 6 }}>
              CLVR QUANTAI PLANS
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 900, color: C.white, lineHeight: 1.2 }}>
              Institutional-Grade Intelligence
            </div>
          </div>

          {/* Tier tabs */}
          <div style={{
            display: "flex", gap: 6, marginTop: 18,
            background: C.panel, borderRadius: 10, padding: 4,
          }}>
            {TIER_ORDER.map(id => (
              <button
                key={id}
                data-testid={`btn-tier-tab-${id}`}
                onClick={() => setActiveTier(id)}
                style={{
                  flex: 1, padding: "9px 4px", borderRadius: 8,
                  border: `1px solid ${activeTier === id ? TAB_COLORS[id] + "60" : "transparent"}`,
                  background: activeTier === id ? `${TAB_COLORS[id]}12` : "transparent",
                  fontFamily: MONO, fontSize: 9,
                  color: activeTier === id ? TAB_COLORS[id] : C.muted,
                  cursor: "pointer", letterSpacing: "0.08em",
                  fontWeight: activeTier === id ? 700 : 400,
                  transition: "all 0.2s",
                }}
              >
                {id.toUpperCase()}
                {id === "elite" && (
                  <div style={{
                    fontSize: 6, marginTop: 1, color: C.cyan,
                    letterSpacing: "0.05em", opacity: 0.8,
                  }}>★ TOP</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan content */}
        <div style={{
          margin: "0 12px",
          background: isElite
            ? "linear-gradient(180deg, rgba(0,229,255,0.04) 0%, rgba(6,10,19,0) 100%)"
            : C.panel,
          border: `1px solid ${isElite ? C.cyan + "60" : C.border2}`,
          borderRadius: 14,
          padding: "20px 16px 18px",
          boxShadow: isElite ? "0 0 30px rgba(0,229,255,0.06)" : "none",
        }}>
          {/* Plan name + tagline */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: tierColor, letterSpacing: "0.2em", fontWeight: 700 }}>
                {activeTier === "free" ? "FREE PLAN" : tier.name.toUpperCase()}
              </div>
              {isElite && (
                <div style={{
                  background: "linear-gradient(90deg,#00b4cc,#00e5ff)",
                  borderRadius: 20, padding: "2px 10px",
                  fontFamily: MONO, fontSize: 7, fontWeight: 800,
                  color: "#060a13", letterSpacing: "0.12em",
                }}>★ RECOMMENDED</div>
              )}
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 17, color: C.text }}>{tier.tagline}</div>
          </div>

          {/* Price display */}
          {!isFree && (
            <>
              {/* Billing toggle */}
              <div style={{
                display: "flex", alignItems: "center",
                background: C.bg, borderRadius: 8, padding: "3px",
                marginBottom: 14, gap: 3,
              }}>
                <button
                  data-testid="btn-billing-monthly"
                  onClick={() => setYearly(false)}
                  style={{
                    flex: 1, padding: "8px 6px", borderRadius: 6, border: "none",
                    background: !yearly ? C.panel2 : "transparent",
                    fontFamily: MONO, fontSize: 9,
                    color: !yearly ? C.white : C.muted,
                    cursor: "pointer", fontWeight: !yearly ? 700 : 400,
                    boxShadow: !yearly ? `0 0 0 1px ${tierColor}40` : "none",
                    transition: "all 0.2s",
                  }}
                >Monthly</button>
                <button
                  data-testid="btn-billing-yearly"
                  onClick={() => setYearly(true)}
                  style={{
                    flex: 1, padding: "8px 6px", borderRadius: 6, border: "none",
                    background: yearly ? C.panel2 : "transparent",
                    fontFamily: MONO, fontSize: 9,
                    color: yearly ? C.white : C.muted,
                    cursor: "pointer", fontWeight: yearly ? 700 : 400,
                    boxShadow: yearly ? `0 0 0 1px ${C.green}40` : "none",
                    transition: "all 0.2s",
                    position: "relative",
                  }}
                >
                  Yearly
                  {tier.yearlySavings && (
                    <span style={{
                      marginLeft: 5, background: `${C.green}18`,
                      border: `1px solid ${C.green}40`,
                      borderRadius: 20, padding: "1px 5px",
                      fontSize: 7, color: C.green,
                    }}>-${Math.round(tier.yearlySavings/tier.yearlyPrice*100)}%</span>
                  )}
                </button>
              </div>

              {/* Price big display */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  <div style={{ fontFamily: MONO, fontSize: 48, fontWeight: 900, color: C.white, lineHeight: 1, letterSpacing: "-0.03em" }}>
                    ${yearly ? yearlyTotal.toLocaleString() : (monthlyDisplay % 1 === 0 ? monthlyDisplay.toFixed(0) : monthlyDisplay.toFixed(2))}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted, marginBottom: 6 }}>{yearly ? "/yr" : "/mo"}</div>
                </div>
                {yearly && (
                  <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4 }}>
                    <span style={{ color: C.green }}>Save ${tier.yearlySavings}</span>
                    <span style={{ marginLeft: 6 }}> · ${(tier.yearlyPrice / 12).toFixed(2)}/mo equivalent</span>
                  </div>
                )}
              </div>
            </>
          )}

          {isFree && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: MONO, fontSize: 48, fontWeight: 900, color: C.white, lineHeight: 1 }}>$0</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 4 }}>Free forever</div>
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: `linear-gradient(90deg,transparent,${tierColor}40,transparent)`, marginBottom: 16 }} />

          {/* Features */}
          <div style={{ marginBottom: 20 }}>
            {tier.features.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 11 }}>
                {f.locked ? <LockIcon /> : <CheckIcon color={isElite ? C.cyan : C.green} />}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: MONO, fontSize: 12,
                    color: f.locked ? C.muted : C.text,
                    lineHeight: 1.4,
                  }}>
                    {f.label}
                  </span>
                  {f.tag && (
                    <span style={{
                      background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)",
                      borderRadius: 3, padding: "1px 5px",
                      fontFamily: MONO, fontSize: 7, color: C.cyan,
                      letterSpacing: "0.08em", whiteSpace: "nowrap",
                    }}>
                      {f.tag}
                    </span>
                  )}
                  {f.locked && f.note && (
                    <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>— {f.note}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          {isFree ? (
            <div style={{
              textAlign: "center", padding: "12px",
              border: `1px solid ${C.border}`, borderRadius: 8,
              fontFamily: MONO, fontSize: 11, color: C.muted,
            }}>
              {isCurrentPlan ? "✓ Your current plan" : "Free Forever"}
            </div>
          ) : isCurrentPlan ? (
            <div style={{
              textAlign: "center", padding: "12px",
              border: `1px solid ${tierColor}50`, borderRadius: 8,
              background: `${tierColor}08`,
              fontFamily: MONO, fontSize: 11, color: tierColor,
            }}>
              ✓ Your current plan
            </div>
          ) : (
            <button
              data-testid={`btn-upgrade-${activeTier}`}
              onClick={handleUpgrade}
              disabled={loading}
              style={{
                width: "100%", padding: "15px 0",
                borderRadius: 10, border: `1px solid ${isElite ? C.cyan : C.gold}`,
                background: isElite
                  ? "linear-gradient(135deg, rgba(0,180,204,0.2), rgba(0,229,255,0.12))"
                  : "linear-gradient(135deg, rgba(212,175,55,0.18), rgba(232,201,109,0.1))",
                fontFamily: MONO, fontSize: 13, fontWeight: 800,
                color: isElite ? C.cyan : C.gold,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "0.12em",
                boxShadow: isElite
                  ? "0 0 24px rgba(0,229,255,0.14)"
                  : "0 0 24px rgba(212,175,55,0.12)",
                transition: "all 0.2s",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Redirecting to Stripe…" : isHigher ? `Upgrade to ${tier.name}` : `Switch to ${tier.name}`}
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "16px 20px 8px" }}>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, lineHeight: 2 }}>
            Cancel anytime · Secure checkout via Stripe · All prices in USD
          </div>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 2 }}>
            CLVRQuant is informational only — not financial advice.
          </div>
        </div>
      </div>
    </div>
  );
}
