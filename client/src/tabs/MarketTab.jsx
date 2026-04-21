// ─────────────────────────────────────────────────────────────────────────────
// MarketTab.jsx — CLVRQuant · Market Data
// 4 class tabs (Crypto / Equities / Commodities / Forex)
// Each has SPOT and PERP sub-tabs with live data and flash animations
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import useMarketData from "../store/MarketDataStore.jsx";
import { getET, getNYSEStatus } from "../utils/marketBell.js";

const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00", cyan:"#00d4ff",
};

// ── Symbol lists ──────────────────────────────────────────────────────────────
const CRYPTO_SYMS  = ["BTC","ETH","SOL","BNB","XRP","AVAX","DOGE","LINK","ARB","PEPE","ADA","DOT","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE","WIF"];
const EQUITY_SYMS  = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","HOOD","NFLX","ORCL","TSM","GME","RIVN","BABA","HIMS","CRCL"];
const METALS_SYMS  = ["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"];
const FOREX_SYMS   = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD"];
const METAL_LABEL  = {XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABEL  = {EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

// HL perp ticker lookup after prefix stripping (xyz:TSLA→TSLA, flx:OIL→OIL)
// Maps each spot ticker → possible HL perp tickers
const PERP_LOOKUP = {
  XAU:      ["GOLD","XAU"],
  XAG:      ["SILVER","XAG"],
  WTI:      ["OIL","CL"],
  BRENT:    ["BRENTOIL","BRENT"],
  NATGAS:   ["GAS","NATGAS"],
  COPPER:   ["COPPER"],
  PLATINUM: ["PLATINUM"],
};

// HL single-currency perps track the currency vs USD. For USDxxx pairs we invert.
// Format: [perpTickers[], invert]
const FX_PERP_LOOKUP = {
  EURUSD: { tickers: ["EUR"],  invert: false },
  GBPUSD: { tickers: ["GBP"],  invert: false },
  AUDUSD: { tickers: ["AUD"],  invert: false },
  NZDUSD: { tickers: ["NZD"],  invert: false },
  USDJPY: { tickers: ["JPY"],  invert: true  },
  USDCHF: { tickers: ["CHF"],  invert: true  },
  USDCAD: { tickers: ["CAD"],  invert: true  },
  USDMXN: { tickers: ["MXN"],  invert: true  },
};

function hlPerpFor(sym, storePerps) {
  const tries = PERP_LOOKUP[sym] || [sym];
  for (const t of tries) if (storePerps[t]?.price) return storePerps[t];
  return null;
}

// ── Price formatters ──────────────────────────────────────────────────────────
function fmt(price, sym) {
  if (!price || isNaN(price) || price <= 0) return "--";
  if (sym === "PEPE" || sym === "BONK") return "$" + price.toFixed(8);
  if (price >= 10000) return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (price >= 1000)  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100)   return "$" + price.toFixed(2);
  if (price >= 1)     return "$" + price.toFixed(3);
  if (price >= 0.01)  return "$" + price.toFixed(4);
  return "$" + price.toFixed(6);
}
function fmtFx(price) {
  if (!price || isNaN(price)) return "--";
  if (price >= 100) return price.toFixed(2);
  return price.toFixed(4);
}
function fmtChg(v) {
  const n = Number(v);
  if (isNaN(n)) return "--";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}
function fmtFund(v) {
  if (v == null || isNaN(v) || v === 0) return null;
  // HL funding is a raw decimal (e.g. -0.0000057 = -0.000570%/8h); multiply ×100 for display
  const pct = Number(v) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(4) + "%/8h";
}
function fmtOI(openInterest, price) {
  if (!openInterest || !price) return null;
  const usd = openInterest * price;
  if (usd >= 1e9) return "$" + (usd / 1e9).toFixed(1) + "B";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(0) + "M";
  if (usd >= 1e3) return "$" + (usd / 1e3).toFixed(0) + "K";
  return null;
}

// getET and getNYSEStatus are imported from ../utils/marketBell.js

// ── Bloomberg-style blink keyframes (injected once) ──────────────────────────
const BLINK_CSS = `
@keyframes clvrBellPulse {
  0%   { opacity: 1; transform: scale(1); }
  50%  { opacity: 0.6; transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes clvrBlinkUp {
  0%   { opacity:1; transform:scaleY(1.4) translateY(-1px); }
  30%  { opacity:0.05; transform:scaleY(0.8); }
  60%  { opacity:1; transform:scaleY(1.4) translateY(-1px); }
  100% { opacity:1; transform:scaleY(1); }
}
@keyframes clvrBlinkDown {
  0%   { opacity:1; transform:scaleY(1.4) translateY(1px); }
  30%  { opacity:0.05; transform:scaleY(0.8); }
  60%  { opacity:1; transform:scaleY(1.4) translateY(1px); }
  100% { opacity:1; transform:scaleY(1); }
}
`;
let _blinkInjected = false;
function injectBlink() {
  if (_blinkInjected) return;
  _blinkInjected = true;
  const s = document.createElement("style");
  s.textContent = BLINK_CSS;
  document.head.appendChild(s);
}

// ── Flash-animated row ────────────────────────────────────────────────────────
// flash is "green" | "red" | undefined (from Dashboard's triggerFlashes)
function FlashRow({ sym, label, price, chg, flash, isForex, children }) {
  injectBlink();
  const chgN = Number(chg) || 0;
  const isUp = chgN >= 0;
  const bgFlash = flash === "green" ? "rgba(0,199,135,0.22)"
                : flash === "red"   ? "rgba(255,64,96,0.18)"
                : "transparent";
  const priceColor = flash === "green" ? C.green
                   : flash === "red"   ? C.red
                   : C.white;

  // Arrow blinks while flash is active; direction follows last-tick or 24h chg
  const arrowUp    = flash === "green" ? true : flash === "red" ? false : isUp;
  const arrowAnim  = flash === "green" ? "clvrBlinkUp 0.28s 2 ease-in-out"
                   : flash === "red"   ? "clvrBlinkDown 0.28s 2 ease-in-out"
                   : "none";
  const arrowColor = flash === "green" ? C.green : flash === "red" ? C.red : isUp ? C.green : C.red;

  return (
    <div data-testid={`row-${sym}`} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "11px 10px", borderBottom: `1px solid ${C.border}`,
      background: bgFlash,
      transition: flash ? "none" : "background 0.5s",
      borderRadius: 4,
    }}>
      {/* Left: ticker + blinking arrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 80 }}>
        <span style={{
          fontFamily: MONO, fontSize: 14, fontWeight: 700,
          color: C.text, letterSpacing: "0.05em",
        }}>{label || sym}</span>
        <span style={{
          fontSize: 14, fontWeight: 900, display: "inline-block",
          color: arrowColor,
          animation: arrowAnim,
        }}>{arrowUp ? "↑" : "↓"}</span>
      </div>

      {/* Right: price + change + badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontFamily: MONO, fontSize: 15, fontWeight: 700,
          color: priceColor,
          transition: flash ? "none" : "color 0.5s",
        }}>
          {isForex ? fmtFx(price) : fmt(price, sym)}
        </span>

        <span style={{
          fontFamily: MONO, fontSize: 10, fontWeight: 700,
          color: isUp ? C.green : C.red,
          background: isUp ? "rgba(0,199,135,0.1)" : "rgba(255,64,96,0.1)",
          borderRadius: 3, padding: "2px 6px",
        }}>{fmtChg(chg)}</span>

        {children}
      </div>
    </div>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────
function Badge({ label, color }) {
  const col = color || C.muted2;
  return (
    <span style={{
      fontFamily: MONO, fontSize: 8, fontWeight: 700, color: col,
      background: col + "18", border: `1px solid ${col}40`,
      borderRadius: 3, padding: "2px 6px", letterSpacing: "0.08em",
    }}>{label}</span>
  );
}

// ── Live/Closed badge ─────────────────────────────────────────────────────────
function LiveBadge({ live }) {
  return live
    ? <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: C.green, background: "rgba(0,199,135,0.1)", border: "1px solid rgba(0,199,135,0.25)", borderRadius: 3, padding: "3px 8px", letterSpacing: "0.1em" }}>LIVE</span>
    : <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: C.orange, background: "rgba(255,140,0,0.08)", border: "1px solid rgba(255,140,0,0.2)", borderRadius: 3, padding: "3px 8px", letterSpacing: "0.1em" }}>CLOSED</span>;
}

// ── Perp row (Hyperliquid) — with Bloomberg-style flash on every price tick ───
function PerpRow({ sym, label, asset }) {
  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    injectBlink();
    const price = asset?.price;
    if (!price) return;
    const prev = prevPriceRef.current;
    if (prev !== null && price !== prev) {
      const dir = price > prev ? "green" : "red";
      setFlash(dir);
      const t = setTimeout(() => setFlash(null), 600);
      prevPriceRef.current = price;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = price;
  }, [asset?.price]);

  if (!asset || !asset.price) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>— No perp data</span>
      </div>
    );
  }

  const chgN      = Number(asset.change24h) || 0;
  const isUp      = chgN >= 0;
  const fund      = fmtFund(asset.funding ?? asset.fundingRate);
  const oi        = fmtOI(asset.openInterest, asset.price);

  // Flash-driven visuals — same grammar as FlashRow (SPOT tab)
  const arrowUp    = flash === "green" ? true : flash === "red" ? false : isUp;
  const arrowAnim  = flash === "green" ? "clvrBlinkUp 0.28s 2 ease-in-out"
                   : flash === "red"   ? "clvrBlinkDown 0.28s 2 ease-in-out"
                   : "none";
  const arrowColor = flash ? (flash === "green" ? C.green : C.red) : (isUp ? C.green : C.red);
  const bgFlash    = flash === "green" ? "rgba(0,199,135,0.22)"
                   : flash === "red"   ? "rgba(255,64,96,0.18)"
                   : "transparent";
  const priceColor = flash ? (flash === "green" ? C.green : C.red) : (isUp ? C.green : C.red);

  return (
    <div data-testid={`perp-row-${sym}`} style={{
      borderBottom: `1px solid ${C.border}`,
      background: bgFlash,
      transition: flash ? "none" : "background 0.5s",
      borderRadius: 4,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
          <span style={{
            fontSize: 14, fontWeight: 900, display: "inline-block",
            color: arrowColor,
            animation: arrowAnim,
          }}>{arrowUp ? "↑" : "↓"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: MONO, fontSize: 15, fontWeight: 700,
            color: priceColor,
            transition: flash ? "none" : "color 0.5s",
          }}>
            {fmt(asset.price, sym)}
          </span>
          <span style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            color: isUp ? C.green : C.red,
            background: isUp ? "rgba(0,199,135,0.1)" : "rgba(255,64,96,0.1)",
            borderRadius: 3, padding: "2px 6px",
          }}>
            {fmtChg(chgN)}
          </span>
          <Badge label="HL" color={C.cyan} />
        </div>
      </div>
      {(fund || oi) && (
        <div style={{ padding: "0 10px 8px", display: "flex", gap: 12 }}>
          {fund && (
            <span style={{ fontFamily: MONO, fontSize: 8, color: Number(asset.funding ?? asset.fundingRate) >= 0 ? C.green : C.red }}>
              FUND {fund}
            </span>
          )}
          {oi && <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>OI {oi}</span>}
        </div>
      )}
    </div>
  );
}

// ── Panel header ──────────────────────────────────────────────────────────────
function PanelHeader({ title, subtitle, live, extra }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 6, padding: "10px 14px 8px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: subtitle ? 4 : 0 }}>
        <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700, color: C.white, fontStyle: "italic" }}>{title}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {extra}
          <LiveBadge live={live} />
        </div>
      </div>
      {subtitle && <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.07em" }}>{subtitle}</div>}
    </div>
  );
}

// ── Sub-tab toggle ────────────────────────────────────────────────────────────
function SubTabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
      {tabs.map(t => (
        <button key={t.val} onClick={() => onChange(t.val)} style={{
          fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
          padding: "6px 14px", borderRadius: 4, cursor: "pointer", border: "none",
          background: value === t.val ? C.gold : "rgba(255,255,255,0.05)",
          color: value === t.val ? C.bg : C.muted2,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO TAB
// ─────────────────────────────────────────────────────────────────────────────
function CryptoTab({ cryptoPrices, flashes, storePerps, storeByClass }) {
  const [sub, setSub] = useState("spot");

  // PERP crypto order mirrors SPOT (CRYPTO_SYMS) for easy side-by-side comparison,
  // then appends any additional HL-only tickers sorted by OI
  const hlSet = new Set(storeByClass?.crypto || []);
  const extraHL = [...hlSet]
    .filter(s => !CRYPTO_SYMS.includes(s))
    .sort((a, b) => (storePerps[b]?.openInterest || 0) - (storePerps[a]?.openInterest || 0));
  const allCryptoTickers = [...CRYPTO_SYMS, ...extraHL];

  const anyLive = Object.values(cryptoPrices).some(d => d.live);

  return (
    <div>
      <PanelHeader
        title="Crypto · Binance & Hyperliquid"
        subtitle="binance websocket · real-time spot  |  hyperliquid · perp funding"
        live={anyLive}
        extra={
          <span style={{ fontFamily: MONO, fontSize: 7, color: C.cyan, background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.15)", borderRadius: 3, padding: "2px 7px", letterSpacing: "0.1em" }}>
            ⚡ STREAMING
          </span>
        }
      />
      <SubTabs
        tabs={[{ val: "spot", label: "SPOT · BINANCE" }, { val: "perp", label: "PERP · HYPERLIQUID" }]}
        value={sub} onChange={setSub}
      />

      {sub === "spot" ? (
        <div>
          {CRYPTO_SYMS.map(sym => {
            const d = cryptoPrices[sym] || {};
            return (
              <FlashRow key={sym} sym={sym} price={d.price} chg={d.chg} flash={flashes[sym]}>
                <Badge label={d.live ? "LIVE" : "SIM"} color={d.live ? C.green : C.orange} />
              </FlashRow>
            );
          })}
        </div>
      ) : (
        <div>
          {allCryptoTickers.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", fontFamily: MONO, fontSize: 10, color: C.muted }}>
              Loading Hyperliquid perps…
            </div>
          ) : (
            allCryptoTickers.map(sym => {
              const asset = storePerps[sym];
              return <PerpRow key={sym} sym={sym} asset={asset} />;
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EQUITIES TAB
// ─────────────────────────────────────────────────────────────────────────────
function EquitiesTab({ equityPrices, flashes, storePerps }) {
  const [sub, setSub] = useState("spot");

  // ── Clock tick (local display only — bell firing lives in App.jsx globally) ──
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Derived clock values (recomputed on every tick)
  const nowLocal   = new Date();
  const etObj      = getET();
  const nyseStatus = getNYSEStatus();
  const live       = nyseStatus === "open";

  const fmtTimeAMPM = (d) =>
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

  const statusColor  = nyseStatus === "open" ? C.green : nyseStatus === "pre" ? C.gold : C.muted2;
  const statusLabel  = nyseStatus === "open" ? "OPEN" : nyseStatus === "pre" ? "PRE-MARKET" : nyseStatus === "after" ? "AFTER-HOURS" : "CLOSED";

  return (
    <div>
      <PanelHeader
        title="Equities · Yahoo / FMP"
        subtitle="yahoo finance + fmp · real-time trades · NYSE 9:30a–4p ET"
        live={live}
      />

      {/* ── Market Clock Widget ─────────────────────────────────────────────── */}
      <div data-testid="market-clock" style={{
        background: "rgba(12,18,32,0.9)",
        border: `1px solid ${C.border2}`,
        borderRadius: 6, padding: "12px 14px", marginBottom: 10,
      }}>

        {/* Clock rows */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.15em", marginBottom: 2 }}>
              YOUR LOCAL TIME
            </div>
            <div data-testid="clock-local" style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: C.white, letterSpacing: "0.05em" }}>
              {fmtTimeAMPM(nowLocal)}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 1 }}>
              {nowLocal.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>

          <div style={{ width: 1, height: 40, background: C.border }} />

          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.15em", marginBottom: 2 }}>
              NEW YORK / ET
            </div>
            <div data-testid="clock-et" style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: statusColor, letterSpacing: "0.05em" }}>
              {fmtTimeAMPM(etObj)}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: statusColor, marginTop: 1, letterSpacing: "0.1em" }}>
              ● {statusLabel}
            </div>
          </div>
        </div>

        {/* NYSE hours reminder */}
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 7, color: C.muted, letterSpacing: "0.08em", textAlign: "center" }}>
          NYSE · MON–FRI · 9:30 AM – 4:00 PM ET · Bell fires at open &amp; close when sound is ON 🔊
        </div>
      </div>

      <SubTabs
        tabs={[{ val: "spot", label: "SPOT · YAHOO/FMP" }, { val: "perp", label: "PERP · HYPERLIQUID" }]}
        value={sub} onChange={setSub}
      />

      {sub === "spot" ? (
        <div>
          {EQUITY_SYMS.map(sym => {
            const d = equityPrices[sym] || {};
            return (
              <FlashRow key={sym} sym={sym} price={d.price} chg={d.chg} flash={flashes[sym]}>
                <Badge label={live ? "LIVE" : statusLabel} color={statusColor} />
              </FlashRow>
            );
          })}
        </div>
      ) : (
        <div>
          {EQUITY_SYMS.map(sym => (
            <PerpRow key={sym} sym={sym} asset={storePerps[sym] || null} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMODITIES TAB
// Max allowed deviation (fraction) between HL perp and spot before we treat
// the perp as stale/illiquid and substitute the real CME/Yahoo Finance price.
const MAX_PERP_SPOT_DEVIATION = 0.10; // 10%

// Energy commodities always use CME Yahoo Finance reference in the perp tab.
// The Hyperliquid flx dex energy contracts (OIL, GAS, BRENTOIL) are relatively
// illiquid — their prevDayPx often mismatches the real CME prior close, making
// the change-rate unreliable.  Metals (XAU, XAG, Cu, Pt, Pd) are fine on HL.
const CME_ALWAYS_SYMS = new Set(["WTI", "BRENT", "NATGAS"]);

// CME futures ticker labels shown when using spot data as perp reference
const CME_LABEL = {
  WTI:       "CME CL=F",
  BRENT:     "CME BZ=F",
  NATGAS:    "CME NG=F",
  XAU:       "CME GC=F",
  XAG:       "CME SI=F",
  COPPER:    "CME HG=F",
  PLATINUM:  "CME PL=F",
  PALLADIUM: "CME PA=F",
};

// Resolve the best perp asset for a commodity symbol.
// Energy (WTI/BRENT/NATGAS): always use CME Yahoo Finance spot as the reference.
// Metals: use HL flx dex price when within 10% of spot; fall back to CME otherwise.
function resolveCommPerp(sym, storePerps, metalPrices) {
  const spot   = metalPrices[sym];
  const spotPx = spot?.price;

  // ── ENERGY: always show CME futures reference ──────────────────────────────
  if (CME_ALWAYS_SYMS.has(sym)) {
    if (!spotPx || spotPx <= 0) return null;
    const hlPerp = hlPerpFor(sym, storePerps || {});
    return {
      price:        spotPx,
      change24h:    spot?.chg ?? 0,
      funding:      hlPerp?.funding ?? null,   // show funding if available
      openInterest: null,
      source:       "CME",
      stale:        false,
    };
  }

  // ── METALS: prefer HL flx dex, fall back to CME if absent/stale ───────────
  const hlPerp = hlPerpFor(sym, storePerps || {});

  if (!hlPerp || !hlPerp.price) {
    if (!spotPx || spotPx <= 0) return null;
    return {
      price:        spotPx,
      change24h:    spot?.chg ?? 0,
      funding:      null,
      openInterest: null,
      source:       "CME",
      stale:        false,
    };
  }

  // Use oracle price if mark is stale vs oracle
  const effectivePx = (hlPerp.oraclePx > 0) ? hlPerp.oraclePx : hlPerp.price;

  // If oracle/mark deviates >10% from real spot, treat as stale
  if (spotPx > 0) {
    const deviation = Math.abs(effectivePx - spotPx) / spotPx;
    if (deviation > MAX_PERP_SPOT_DEVIATION) {
      return {
        price:        spotPx,
        change24h:    spot?.chg ?? 0,
        funding:      null,
        openInterest: null,
        source:       "CME",
        stale:        true,
        hlStalePrice: hlPerp.price,
      };
    }
  }

  return { ...hlPerp, price: effectivePx, source: "HL", stale: false };
}

// Perp row that understands stale substitution and CME references
function CommodityPerpRow({ sym, label, asset }) {
  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    injectBlink();
    const price = asset?.price;
    if (!price) return;
    const prev = prevPriceRef.current;
    if (prev !== null && price !== prev) {
      setFlash(price > prev ? "green" : "red");
      setTimeout(() => setFlash(null), 600);
    }
    prevPriceRef.current = price;
  }, [asset?.price]);

  if (!asset || !asset.price) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>— No perp data</span>
      </div>
    );
  }

  const chgN = Number(asset.change24h) || 0;
  const isUp = chgN >= 0;
  const bgFlash   = flash === "green" ? "rgba(0,199,135,0.22)" : flash === "red" ? "rgba(255,64,96,0.18)" : "transparent";
  const priceColor = flash ? (flash === "green" ? C.green : C.red) : (isUp ? C.green : C.red);

  const isCME   = asset.source === "CME";
  const isStale = asset.stale;

  return (
    <div style={{ padding: "10px 10px", borderBottom: `1px solid ${C.border}`, background: bgFlash, transition: "background 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
          <span style={{
            fontFamily: MONO, fontSize: 7, fontWeight: 700,
            color: isCME ? C.orange : C.cyan,
            border: `1px solid ${isCME ? C.orange : C.cyan}`,
            padding: "1px 4px", borderRadius: 2, letterSpacing: "0.06em",
          }}>{isCME ? (CME_LABEL[sym] || "CME REF") : "HL FLX"}</span>
          {isStale && (
            <span style={{
              fontFamily: MONO, fontSize: 7, color: C.red,
              border: `1px solid ${C.red}44`, padding: "1px 4px", borderRadius: 2, letterSpacing: "0.06em",
            }} title={`HL flx perp stale at $${asset.hlStalePrice?.toFixed(3)} (>${Math.round(MAX_PERP_SPOT_DEVIATION * 100)}% from CME)`}>
              HL STALE
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: priceColor }}>{fmt(asset.price, sym)}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: priceColor }}>{chgN >= 0 ? "+" : ""}{chgN.toFixed(2)}%</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
        {asset.funding != null && (
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted2 }}>
            Fund: <span style={{ color: asset.funding > 0.001 ? C.red : asset.funding < -0.0005 ? C.green : C.muted2 }}>
              {asset.funding >= 0 ? "+" : ""}{(asset.funding * 100).toFixed(4)}%/8h
            </span>
          </span>
        )}
        {asset.openInterest != null && asset.openInterest > 0 && asset.price > 0 && (
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted2 }}>
            OI: ${((asset.openInterest * asset.price) / 1e6).toFixed(1)}M
          </span>
        )}
        {isCME && (
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>
            {isStale ? "HL perp illiquid — showing CME futures reference" : "CME futures reference"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function CommoditiesTab({ metalPrices, flashes }) {
  const [sub, setSub] = useState("spot");
  const { perps: storePerps } = useMarketData();
  const anyLive = Object.values(metalPrices).some(d => d.live);

  return (
    <div>
      <PanelHeader
        title="Commodities · Gold-API & Yahoo Finance"
        subtitle="gold-api.com · XAU/XAG/Pt/Cu  |  Yahoo Finance CME · WTI/Brent/NatGas"
        live={anyLive}
      />
      <SubTabs
        tabs={[
          { val: "spot", label: "SPOT · CME/GOLD-API" },
          { val: "perp", label: "PERP · TRADE.XYZ" },
        ]}
        value={sub} onChange={setSub}
      />

      {sub === "spot" ? (
        <div>
          {METALS_SYMS.map(sym => {
            const d = metalPrices[sym] || {};
            return (
              <FlashRow key={sym} sym={sym} label={METAL_LABEL[sym] || sym} price={d.price} chg={d.chg} flash={flashes[sym]}>
                <Badge label={d.live ? "LIVE" : "LOADING"} color={d.live ? C.green : C.muted} />
              </FlashRow>
            );
          })}
        </div>
      ) : (
        <div>
          {METALS_SYMS.map(sym => {
            const asset = resolveCommPerp(sym, storePerps, metalPrices);
            return <CommodityPerpRow key={sym} sym={sym} label={METAL_LABEL[sym] || sym} asset={asset} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOREX TAB
// ─────────────────────────────────────────────────────────────────────────────
// Build an FX perp asset from an HL single-currency perp (e.g. EUR/USD from HL "EUR").
// Inverts price for USDxxx pairs (e.g. USD/JPY from HL "JPY" → 1/price).
function resolveFxPerp(sym, storePerps) {
  const cfg = FX_PERP_LOOKUP[sym];
  if (!cfg) return null;
  let hl = null;
  for (const t of cfg.tickers) {
    if (storePerps[t]?.price) { hl = storePerps[t]; break; }
  }
  if (!hl) return null;
  if (!cfg.invert) return hl;
  // Invert: USDxxx = 1 / (xxx/USD)
  const invPrice = 1 / hl.price;
  const invChg = -1 * (Number(hl.change24h) || 0); // % reverses sign on inversion (approx)
  return {
    ...hl,
    price: invPrice,
    change24h: invChg,
    // Funding and OI are still meaningful but flip sign conceptually for direction
  };
}

function FxPerpRow({ sym, label, asset }) {
  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    injectBlink();
    const price = asset?.price;
    if (!price) return;
    const prev = prevPriceRef.current;
    if (prev !== null && price !== prev) {
      setFlash(price > prev ? "green" : "red");
      const t = setTimeout(() => setFlash(null), 600);
      prevPriceRef.current = price;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = price;
  }, [asset?.price]);

  if (!asset || !asset.price) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>— No HL perp available</span>
      </div>
    );
  }

  const chgN = Number(asset.change24h) || 0;
  const isUp = chgN >= 0;
  const fund = fmtFund(asset.funding ?? asset.fundingRate);
  const oi   = fmtOI(asset.openInterest, asset.price);
  const arrowUp = flash === "green" ? true : flash === "red" ? false : isUp;
  const arrowAnim = flash === "green" ? "clvrBlinkUp 0.28s 2 ease-in-out"
                  : flash === "red"   ? "clvrBlinkDown 0.28s 2 ease-in-out" : "none";
  const arrowColor = flash ? (flash === "green" ? C.green : C.red) : (isUp ? C.green : C.red);
  const bgFlash = flash === "green" ? "rgba(0,199,135,0.22)" : flash === "red" ? "rgba(255,64,96,0.18)" : "transparent";
  const priceColor = flash ? (flash === "green" ? C.green : C.red) : (isUp ? C.green : C.red);

  return (
    <div data-testid={`perp-row-${sym}`} style={{
      borderBottom: `1px solid ${C.border}`, background: bgFlash,
      transition: flash ? "none" : "background 0.5s", borderRadius: 4,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: arrowColor, animation: arrowAnim }}>{arrowUp ? "↑" : "↓"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: priceColor, transition: flash ? "none" : "color 0.5s" }}>
            {fmtFx(asset.price)}
          </span>
          <span style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            color: isUp ? C.green : C.red,
            background: isUp ? "rgba(0,199,135,0.1)" : "rgba(255,64,96,0.1)",
            borderRadius: 3, padding: "2px 6px",
          }}>{fmtChg(chgN)}</span>
          <Badge label="HL" color={C.cyan} />
        </div>
      </div>
      {(fund || oi) && (
        <div style={{ padding: "0 10px 8px", display: "flex", gap: 12 }}>
          {fund && (
            <span style={{ fontFamily: MONO, fontSize: 8, color: Number(asset.funding ?? asset.fundingRate) >= 0 ? C.green : C.red }}>
              FUND {fund}
            </span>
          )}
          {oi && <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>OI {oi}</span>}
        </div>
      )}
    </div>
  );
}

function ForexTab({ forexPrices, flashes, storePerps }) {
  const [mode, setMode] = useState("spot");
  const isOpen = () => {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const d = et.getDay(), h = et.getHours();
    if (d === 6) return false;
    if (d === 0 && h < 17) return false;
    if (d === 5 && h >= 17) return false;
    return true;
  };

  return (
    <div>
      <PanelHeader
        title={mode === "spot" ? "Forex · Yahoo / FMP" : "Forex · Hyperliquid"}
        subtitle={mode === "spot"
          ? "yahoo finance + fmp · forex spot  |  sun 5pm – fri 5pm ET"
          : "hyperliquid · fx perps (24/7)  |  usdxxx pairs inverted from xxx/usd"}
        live={mode === "perp" ? true : isOpen()}
      />
      <SubTabs
        value={mode}
        onChange={setMode}
        tabs={[{ val: "spot", label: "SPOT · YAHOO/FMP" }, { val: "perp", label: "PERP · HYPERLIQUID" }]}
      />
      {mode === "spot" ? (
        FOREX_SYMS.map(sym => {
          const d = forexPrices[sym] || {};
          return (
            <FlashRow key={sym} sym={sym} label={FOREX_LABEL[sym] || sym} price={d.price} chg={d.chg} flash={flashes[sym]} isForex>
              <Badge label="FX" color={C.cyan} />
            </FlashRow>
          );
        })
      ) : (
        <>
          <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, margin: "4px 0 8px", letterSpacing: "0.06em" }}>
            HL lists single-currency perps (EUR, GBP, JPY, CHF, AUD, CAD, NZD, MXN) vs USD. Cross pairs not supported.
          </div>
          {Object.keys(FX_PERP_LOOKUP).map(sym => (
            <FxPerpRow key={sym} sym={sym} label={FOREX_LABEL[sym] || sym} asset={resolveFxPerp(sym, storePerps || {})} />
          ))}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
const CLASS_TABS = [
  { val: "crypto",      label: "CRYPTO"      },
  { val: "equities",    label: "EQUITIES"    },
  { val: "commodities", label: "COMMODITIES" },
  { val: "forex",       label: "FOREX"       },
];

export default function MarketTab({ cryptoPrices = {}, equityPrices = {}, metalPrices = {}, forexPrices = {}, flashes = {} }) {
  const [cls, setCls] = useState("crypto");
  const { perps: storePerps, byClass: storeByClass } = useMarketData();

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      {/* ── Section label ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 3, height: 16, background: C.gold, borderRadius: 2 }} />
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.2em", fontWeight: 700 }}>MARKET DATA</div>
      </div>

      {/* ── Class tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {CLASS_TABS.map(t => (
          <button key={t.val} data-testid={`class-tab-${t.val}`} onClick={() => setCls(t.val)} style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
            padding: "7px 16px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
            border: `1px solid ${cls === t.val ? C.gold : C.border2}`,
            background: cls === t.val ? "rgba(201,168,76,0.12)" : "transparent",
            color: cls === t.val ? C.gold : C.muted2,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Content ── */}
      {cls === "crypto"      && <CryptoTab      cryptoPrices={cryptoPrices} flashes={flashes} storePerps={storePerps} storeByClass={storeByClass} />}
      {cls === "equities"    && <EquitiesTab    equityPrices={equityPrices} flashes={flashes} storePerps={storePerps} />}
      {cls === "commodities" && <CommoditiesTab metalPrices={metalPrices}   flashes={flashes} />}
      {cls === "forex"       && <ForexTab       forexPrices={forexPrices}   flashes={flashes} storePerps={storePerps} />}
    </div>
  );
}
