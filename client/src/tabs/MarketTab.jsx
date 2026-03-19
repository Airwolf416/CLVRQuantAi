// ─────────────────────────────────────────────────────────────────────────────
// MarketTab.jsx — CLVRQuant · Market Data
// 4 class tabs (Crypto / Equities / Commodities / Forex)
// Each has SPOT and PERP sub-tabs with live data and flash animations
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import useMarketData from "../store/MarketDataStore.jsx";

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
  if (!v || isNaN(v)) return null;
  return (Number(v) >= 0 ? "+" : "") + Number(v).toFixed(4) + "% /8h";
}

// ── Flash-animated row ────────────────────────────────────────────────────────
// flash is "green" | "red" | undefined (from Dashboard's triggerFlashes)
function FlashRow({ sym, label, price, chg, flash, isForex, children }) {
  const chgN = Number(chg) || 0;
  const isUp = chgN >= 0;
  const bgFlash = flash === "green" ? "rgba(0,199,135,0.22)"
                : flash === "red"   ? "rgba(255,64,96,0.18)"
                : "transparent";
  const priceColor = flash === "green" ? C.green
                   : flash === "red"   ? C.red
                   : C.white;

  return (
    <div data-testid={`row-${sym}`} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "11px 10px", borderBottom: `1px solid ${C.border}`,
      background: bgFlash,
      // Instant flash-in, smooth fade-out
      transition: flash ? "none" : "background 0.5s",
      borderRadius: 4,
    }}>
      {/* Left: ticker + arrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 80 }}>
        <span style={{
          fontFamily: MONO, fontSize: 14, fontWeight: 700,
          color: C.text, letterSpacing: "0.05em",
        }}>{label || sym}</span>
        <span style={{
          fontSize: 12, fontWeight: 900,
          color: isUp ? C.green : C.red,
        }}>{isUp ? "↑" : "↓"}</span>
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

// ── Perp row (Hyperliquid) ────────────────────────────────────────────────────
function PerpRow({ sym, label, asset }) {
  if (!asset || !asset.price) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>— Not listed on HL</span>
      </div>
    );
  }
  const chgN = Number(asset.change24h) || 0;
  const isUp = chgN >= 0;
  const fund = fmtFund(asset.funding || asset.fundingRate);
  return (
    <div data-testid={`perp-row-${sym}`} style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 10px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.text }}>{label || sym}</span>
          <span style={{ fontSize: 12, fontWeight: 900, color: isUp ? C.green : C.red }}>{isUp ? "↑" : "↓"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: isUp ? C.green : C.red }}>
            {fmt(asset.price, sym)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: isUp ? C.green : C.red, background: isUp ? "rgba(0,199,135,0.1)" : "rgba(255,64,96,0.1)", borderRadius: 3, padding: "2px 6px" }}>
            {fmtChg(chgN)}
          </span>
          <Badge label="HL" color={C.cyan} />
        </div>
      </div>
      {(fund || asset.openInterest > 1000) && (
        <div style={{ padding: "0 10px 8px", display: "flex", gap: 12 }}>
          {fund && <span style={{ fontFamily: MONO, fontSize: 8, color: Number(asset.funding || asset.fundingRate) >= 0 ? C.green : C.red }}>FUND {fund}</span>}
          {asset.openInterest > 1000 && <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>OI ${(asset.openInterest / 1e6).toFixed(0)}M</span>}
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

  // storeByClass.crypto is an array of ticker strings ["BTC","ETH",...]
  // Sort by open interest from storePerps
  const allCryptoTickers = storeByClass?.crypto?.length
    ? [...storeByClass.crypto].sort((a, b) => (storePerps[b]?.openInterest || storePerps[b]?.volume24h || 0) - (storePerps[a]?.openInterest || storePerps[a]?.volume24h || 0))
    : CRYPTO_SYMS;

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
  const isNYSE = () => {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const d = et.getDay(), h = et.getHours(), m = et.getMinutes();
    return d >= 1 && d <= 5 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
  };
  const live = isNYSE();

  return (
    <div>
      <PanelHeader
        title="Equities · Finnhub"
        subtitle="finnhub websocket · real-time trades · NYSE 9:30a–4p ET"
        live={live}
      />
      <SubTabs
        tabs={[{ val: "spot", label: "SPOT · FINNHUB" }, { val: "perp", label: "PERP · HYPERLIQUID" }]}
        value={sub} onChange={setSub}
      />

      {sub === "spot" ? (
        <div>
          {EQUITY_SYMS.map(sym => {
            const d = equityPrices[sym] || {};
            return (
              <FlashRow key={sym} sym={sym} price={d.price} chg={d.chg} flash={flashes[sym]}>
                <Badge label={live ? "LIVE" : "CLOSED"} color={live ? C.green : C.orange} />
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
// ─────────────────────────────────────────────────────────────────────────────
function CommoditiesTab({ metalPrices, flashes, storePerps }) {
  const [sub, setSub] = useState("spot");
  const anyLive = Object.values(metalPrices).some(d => d.live);

  return (
    <div>
      <PanelHeader
        title="Commodities · Gold-API & Finnhub"
        subtitle="gold-api.com · metals spot  |  finnhub · energy ETF proxies"
        live={anyLive}
      />
      <SubTabs
        tabs={[{ val: "spot", label: "SPOT · GOLD-API/FH" }, { val: "perp", label: "PERP · HYPERLIQUID" }]}
        value={sub} onChange={setSub}
      />

      {sub === "spot" ? (
        <div>
          {METALS_SYMS.map(sym => {
            const d = metalPrices[sym] || {};
            return (
              <FlashRow key={sym} sym={sym} label={METAL_LABEL[sym] || sym} price={d.price} chg={d.chg} flash={flashes[sym]}>
                <Badge label={d.live ? "LIVE" : "SIM"} color={d.live ? C.green : C.orange} />
              </FlashRow>
            );
          })}
        </div>
      ) : (
        <div>
          {METALS_SYMS.map(sym => {
            const perp = hlPerpFor(sym, storePerps);
            return <PerpRow key={sym} sym={sym} label={METAL_LABEL[sym] || sym} asset={perp} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOREX TAB
// ─────────────────────────────────────────────────────────────────────────────
function ForexTab({ forexPrices, flashes }) {
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
        title="Forex · Finnhub"
        subtitle="finnhub websocket · forex spot  |  sun 5pm – fri 5pm ET"
        live={isOpen()}
      />
      <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginBottom: 6, letterSpacing: "0.06em" }}>
        SPOT RATES ONLY — No perpetual market exists for forex pairs
      </div>
      {FOREX_SYMS.map(sym => {
        const d = forexPrices[sym] || {};
        return (
          <FlashRow key={sym} sym={sym} label={FOREX_LABEL[sym] || sym} price={d.price} chg={d.chg} flash={flashes[sym]} isForex>
            <Badge label="FX" color={C.cyan} />
          </FlashRow>
        );
      })}
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
      {cls === "commodities" && <CommoditiesTab metalPrices={metalPrices}   flashes={flashes} storePerps={storePerps} />}
      {cls === "forex"       && <ForexTab       forexPrices={forexPrices}   flashes={flashes} />}
    </div>
  );
}
