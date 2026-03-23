// ── MyBasket — Personalised Scalper & Swing AI Trading Tool ──────────────
import { useState, useCallback } from "react";

const C = {
  bg:"#050709", navy:"#080d18", panel:"#0c1220",
  border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7",
};
const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS  = "'Barlow', system-ui, sans-serif";

const BASKET_ASSETS = {
  crypto: [
    { sym: "BTC",  label: "Bitcoin",   icon: "₿" },
    { sym: "ETH",  label: "Ethereum",  icon: "Ξ" },
    { sym: "SOL",  label: "Solana",    icon: "◎" },
    { sym: "HYPE", label: "Hyperliquid", icon: "H" },
    { sym: "XRP",  label: "XRP",       icon: "✕" },
    { sym: "DOGE", label: "Dogecoin",  icon: "Ð" },
    { sym: "AVAX", label: "Avalanche", icon: "A" },
    { sym: "LINK", label: "Chainlink", icon: "L" },
  ],
  equities: [
    { sym: "AAPL",  label: "Apple",        icon: "" },
    { sym: "NVDA",  label: "Nvidia",       icon: "" },
    { sym: "TSLA",  label: "Tesla",        icon: "T" },
    { sym: "MSFT",  label: "Microsoft",    icon: "" },
    { sym: "GOOGL", label: "Alphabet",     icon: "G" },
    { sym: "META",  label: "Meta",         icon: "f" },
    { sym: "AMZN",  label: "Amazon",       icon: "a" },
    { sym: "MSTR",  label: "MicroStrategy",icon: "M" },
    { sym: "AMD",   label: "AMD",          icon: "A" },
    { sym: "PLTR",  label: "Palantir",     icon: "P" },
    { sym: "COIN",  label: "Coinbase",     icon: "C" },
    { sym: "NFLX",  label: "Netflix",      icon: "N" },
  ],
  commodities: [
    { sym: "XAU",      label: "Gold",        icon: "Au" },
    { sym: "XAG",      label: "Silver",      icon: "Ag" },
    { sym: "WTI",      label: "WTI Oil",     icon: "⛽" },
    { sym: "BRENT",    label: "Brent Oil",   icon: "🛢" },
    { sym: "NATGAS",   label: "Natural Gas", icon: "🔥" },
    { sym: "COPPER",   label: "Copper",      icon: "Cu" },
    { sym: "PLATINUM", label: "Platinum",    icon: "Pt" },
    { sym: "WHEAT",    label: "Wheat",       icon: "🌾" },
  ],
};

const STYLES = [
  { key: "scalp",  label: "Scalp",  desc: "Minutes to hours · High freq · Tight stops",  color: C.cyan   },
  { key: "swing",  label: "Swing",  desc: "Days to weeks · Trend following · Wider stops", color: C.purple },
  { key: "day",    label: "Day",    desc: "Intraday · Close flat · Momentum-driven",       color: C.green  },
];

export default function MyBasket({ isPro, onUpgrade, aiLoading, setAiLoading, setAiOutput, storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices }) {
  const [selected, setSelected]   = useState(new Set(["BTC", "ETH", "NVDA"]));
  const [style, setStyle]         = useState("swing");
  const [category, setCategory]   = useState("crypto");
  const [basketResult, setBasketResult] = useState("");
  const [basketLoading, setBasketLoading] = useState(false);
  const [openPanel, setOpenPanel] = useState(true);

  const toggleAsset = useCallback((sym) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sym)) { next.delete(sym); }
      else { if (next.size >= 8) return prev; next.add(sym); }
      return next;
    });
  }, []);

  const getPriceSnap = useCallback((sym) => {
    const perp = storePerps?.[sym];
    if (perp?.price) {
      const chg = perp.change24h != null ? ` (${perp.change24h >= 0 ? "+" : ""}${perp.change24h.toFixed(2)}%)` : "";
      const fund = perp.funding != null ? ` Fund:${(perp.funding * 100).toFixed(4)}%/8h` : "";
      return `$${perp.price.toFixed(perp.price >= 100 ? 0 : perp.price >= 1 ? 2 : 4)}${chg}${fund} [LIVE]`;
    }
    const spot = storeSpot?.[sym]?.price || cryptoPrices?.[sym]?.price || equityPrices?.[sym]?.price || metalPrices?.[sym]?.price;
    if (spot) return `$${spot.toFixed(spot >= 100 ? 0 : 2)} [est]`;
    return "n/a";
  }, [storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices]);

  const runBasket = useCallback(async () => {
    if (selected.size === 0 || basketLoading) return;
    setBasketLoading(true);
    setBasketResult("");

    const syms = [...selected];
    const priceData = syms.map(sym => `${sym}: ${getPriceSnap(sym)}`).join(" | ");
    const styleObj = STYLES.find(s => s.key === style);
    const styleDesc = styleObj ? `${styleObj.label} (${styleObj.desc})` : style;

    const userMessage = `Analyze my custom trading basket and generate ${styleObj?.label || style} trade recommendations for each asset.

MY BASKET (${syms.length} assets): ${syms.join(", ")}
TRADING STYLE: ${styleDesc}
LIVE PRICES: ${priceData}

For EACH asset in my basket, provide:
1. Directional bias (LONG / SHORT / NEUTRAL)
2. Entry price with trigger condition
3. Stop Loss (tight for scalp, wider for swing)
4. Take Profit 1 (TP1) and Take Profit 2 (TP2)
5. Suggested size weight in the basket (% allocation)
6. Confidence score (0–100)
7. Key reasoning (2–3 bullet points max)

Then at the end, provide:
- Portfolio-level correlation risk (any assets moving together?)
- Overall basket stance (Risk-on / Risk-off / Mixed)
- Which asset has the highest conviction trade right now?

Format clearly with each asset as a header. Be direct and numerical.`;

    const system = `You are CLVR AI's Basket Analyst — specialist in multi-asset portfolio construction and ${styleDesc} trading. You receive a user's custom basket of assets and generate personalized, style-specific trade recommendations. Use live price data provided. For scalp trades: stops 1–1.5%, leverage up to 10x. For day trades: stops 1.5–3%, leverage up to 5x. For swing trades: stops 4–7%, leverage up to 3x. Always account for correlation risk across the basket. Be specific, numerical, and direct.`;

    try {
      const r = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, userMessage }),
      });
      const data = await r.json();
      if (!r.ok) {
        setBasketResult(data.error || `Error ${r.status}`);
      } else {
        setBasketResult(data.text || "No response.");
      }
    } catch (e) {
      setBasketResult(`Error: ${e.message}`);
    } finally {
      setBasketLoading(false);
    }
  }, [selected, style, basketLoading, getPriceSnap]);

  if (!isPro) {
    return (
      <div data-testid="progate-my-basket" style={{ position: "relative" }}>
        <div style={{ filter: "blur(4px)", opacity: 0.3, pointerEvents: "none", maxHeight: 160, overflow: "hidden" }}>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.purple, letterSpacing: "0.15em", marginBottom: 8 }}>MY BASKET · PERSONALISED AI</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["BTC","ETH","NVDA","XAU"].map(s => <div key={s} style={{ padding: "6px 12px", background: C.border, borderRadius: 4, fontFamily: MONO, fontSize: 10, color: C.muted }}>{s}</div>)}
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(5,7,9,.85)", backdropFilter: "blur(8px)", borderRadius: 4 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 16, color: C.gold2, marginBottom: 4 }}>Pro Feature</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, letterSpacing: "0.12em", marginBottom: 12, textTransform: "uppercase" }}>My Basket · Personalised AI</div>
          <button data-testid="btn-upgrade-my-basket" onClick={onUpgrade} style={{ background: "rgba(201,168,76,.12)", border: `1px solid rgba(201,168,76,.35)`, borderRadius: 2, padding: "8px 20px", fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 13, color: C.gold2, cursor: "pointer" }}>Upgrade to Pro</button>
        </div>
      </div>
    );
  }

  const selList = [...selected];

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 10, overflow: "hidden" }}>
      {/* Header */}
      <div onClick={() => setOpenPanel(o => !o)} style={{ padding: "11px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.purple, letterSpacing: "0.18em" }}>MY BASKET</span>
          <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted, background: "rgba(168,85,247,.08)", border: `1px solid rgba(168,85,247,.2)`, borderRadius: 2, padding: "2px 7px" }}>PERSONALISED AI</span>
          {selList.length > 0 && <span style={{ fontFamily: MONO, fontSize: 8, color: C.purple }}>{selList.length} assets</span>}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>{openPanel ? "▲" : "▼"}</span>
      </div>

      {openPanel && (
        <div style={{ padding: 14 }}>
          {/* Category tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {Object.keys(BASKET_ASSETS).map(cat => (
              <button key={cat} data-testid={`basket-cat-${cat}`} onClick={() => setCategory(cat)} style={{ flex: 1, padding: "5px 6px", borderRadius: 2, border: `1px solid ${category === cat ? C.purple : C.border}`, background: category === cat ? "rgba(168,85,247,.08)" : "transparent", color: category === cat ? C.purple : C.muted, fontFamily: MONO, fontSize: 8, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {cat}
              </button>
            ))}
          </div>

          {/* Asset grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 12 }}>
            {BASKET_ASSETS[category].map(({ sym, label, icon }) => {
              const active = selected.has(sym);
              return (
                <button key={sym} data-testid={`basket-asset-${sym}`} onClick={() => toggleAsset(sym)} style={{ padding: "7px 4px", borderRadius: 3, border: `1px solid ${active ? C.purple : C.border}`, background: active ? "rgba(168,85,247,.1)" : "rgba(8,13,24,.6)", cursor: "pointer", textAlign: "center", transition: "all .15s", position: "relative" }}>
                  {active && <div style={{ position: "absolute", top: 3, right: 4, width: 5, height: 5, borderRadius: "50%", background: C.purple }} />}
                  <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: active ? C.purple : C.muted2 }}>{sym}</div>
                  <div style={{ fontFamily: SANS, fontSize: 8, color: C.muted, marginTop: 1, lineHeight: 1.2 }}>{label.length > 9 ? label.slice(0, 9) : label}</div>
                </button>
              );
            })}
          </div>

          {/* Selected basket pills */}
          {selList.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", background: "rgba(168,85,247,.04)", border: `1px solid rgba(168,85,247,.15)`, borderRadius: 3 }}>
              <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted, alignSelf: "center" }}>BASKET:</span>
              {selList.map(sym => (
                <span key={sym} onClick={() => toggleAsset(sym)} style={{ fontFamily: MONO, fontSize: 8, color: C.purple, background: "rgba(168,85,247,.1)", border: `1px solid rgba(168,85,247,.3)`, borderRadius: 2, padding: "2px 8px", cursor: "pointer" }}>
                  {sym} ×
                </span>
              ))}
            </div>
          )}

          {/* Style selector */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.12em", marginBottom: 6 }}>TRADING STYLE</div>
            <div style={{ display: "flex", gap: 5 }}>
              {STYLES.map(s => (
                <button key={s.key} data-testid={`basket-style-${s.key}`} onClick={() => setStyle(s.key)} style={{ flex: 1, padding: "8px 6px", borderRadius: 3, border: `1px solid ${style === s.key ? s.color : C.border}`, background: style === s.key ? `${s.color}12` : "transparent", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: style === s.key ? s.color : C.muted }}>{s.label}</div>
                  <div style={{ fontFamily: SANS, fontSize: 8, color: C.muted, marginTop: 2, lineHeight: 1.3 }}>{s.desc.split("·")[0].trim()}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button data-testid="btn-run-basket" onClick={runBasket} disabled={basketLoading || selected.size === 0} style={{ width: "100%", padding: "13px 14px", borderRadius: 3, border: `1px solid ${selected.size === 0 ? C.border : "rgba(168,85,247,.4)"}`, background: selected.size === 0 ? "transparent" : "rgba(168,85,247,.08)", color: basketLoading || selected.size === 0 ? C.muted : C.purple, fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 14, cursor: basketLoading || selected.size === 0 ? "not-allowed" : "pointer", letterSpacing: "0.02em" }}>
            {basketLoading ? "Analyzing Your Basket..." : selected.size === 0 ? "Select assets above" : `Analyze My ${STYLES.find(s => s.key === style)?.label} Basket (${selList.length} assets) ✦`}
          </button>

          {/* Result */}
          {basketResult && (
            <div data-testid="text-basket-result" style={{ marginTop: 12, background: "#080d18", border: `1px solid ${C.border}`, borderRadius: 3, padding: 14, fontSize: 13, lineHeight: 1.9, color: C.text, whiteSpace: "pre-wrap", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
              {basketResult}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
