// ─────────────────────────────────────────────────────────────────────────────
// MarketTab.jsx — CLVRQuant · Market Data
// Layout: 4 class tabs (Crypto/Equities/Commodities/Forex)
// Each tab has [SPOT] [PERP] sub-tabs with live data + flash animations
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from "react";
import useMarketData from "../store/MarketDataStore.jsx";

const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00", cyan:"#00d4ff",
};

// ── Symbols & Labels ──────────────────────────────────────────────────────────
const CRYPTO_SYMS  = ["BTC","ETH","SOL","BNB","XRP","AVAX","DOGE","LINK","ARB","PEPE","ADA","DOT","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE","WIF"];
const EQUITY_SYMS  = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"];
const METALS_SYMS  = ["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"];
const FOREX_SYMS   = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD"];
const METAL_LABEL  = {XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABEL  = {EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

// HL ticker aliases for commodity spot→perp lookup
const PERP_ALIASES = {
  WTI:["WTI","OIL","CL"], BRENT:["BRENT","BRENTOIL","BNO"],
  XAU:["XAU","GOLD"], XAG:["XAG","SILVER"],
  COPPER:["COPPER","HG","CU"], NATGAS:["NATGAS","NG"],
  PLATINUM:["PLATINUM","XPT"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(price, sym) {
  if (!price || isNaN(price)) return "--";
  if (sym && (sym==="PEPE"||sym==="BONK")) return "$"+price.toFixed(8);
  if (price >= 10000) return "$"+price.toLocaleString("en-US",{minimumFractionDigits:1,maximumFractionDigits:1});
  if (price >= 1000)  return "$"+price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  if (price >= 100)   return "$"+price.toFixed(2);
  if (price >= 1)     return "$"+price.toFixed(3);
  if (price >= 0.01)  return "$"+price.toFixed(4);
  return "$"+price.toFixed(6);
}
function fmtFx(price) {
  if (!price || isNaN(price)) return "--";
  if (price >= 100) return price.toFixed(2);
  return price.toFixed(4);
}
function fmtChg(v) {
  if (v===undefined||v===null||isNaN(v)) return "--";
  return (v>=0?"+":"")+Number(v).toFixed(2)+"%";
}
function fmtFund(v) {
  if (!v||isNaN(v)) return null;
  return (v>=0?"+":"")+Number(v).toFixed(4)+"%";
}
function chgColor(v) { return Number(v)>=0 ? C.green : C.red; }

function getPerpBySym(sym, storePerps) {
  const aliases = PERP_ALIASES[sym] || [sym];
  for (const a of aliases) if (storePerps[a]?.price) return storePerps[a];
  return null;
}

// ── Flash-animated price badge ────────────────────────────────────────────────
function PriceBadge({ value, sym, flash }) {
  const bg = flash==="up" ? "rgba(0,199,135,0.18)" : flash==="down" ? "rgba(255,64,96,0.18)" : "transparent";
  const col = flash==="up" ? C.green : flash==="down" ? C.red : C.white;
  return (
    <span style={{
      fontFamily:MONO, fontSize:14, fontWeight:700, color:col,
      background:bg, borderRadius:3, padding:"1px 4px",
      transition:"background 0.25s,color 0.25s",
    }}>{fmt(value,sym)}</span>
  );
}

// ── Change badge ──────────────────────────────────────────────────────────────
function ChgBadge({ v, size=10 }) {
  const val = Number(v)||0;
  const col = val>=0 ? C.green : C.red;
  const bg  = val>=0 ? "rgba(0,199,135,0.1)" : "rgba(255,64,96,0.1)";
  return (
    <span style={{ fontFamily:MONO, fontSize:size, fontWeight:700, color:col,
      background:bg, borderRadius:3, padding:"2px 6px", letterSpacing:"0.04em" }}>
      {fmtChg(val)}
    </span>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────
function SrcBadge({ label, live, color }) {
  const col = color || (live ? C.green : C.orange);
  const bg  = live ? "rgba(0,199,135,0.1)" : "rgba(255,140,0,0.1)";
  return (
    <span style={{ fontFamily:MONO, fontSize:8, fontWeight:700, color:col,
      background:bg, border:`1px solid ${col}40`, borderRadius:3, padding:"2px 6px",
      letterSpacing:"0.08em" }}>
      {label}
    </span>
  );
}

// ── Live / Closed badge ───────────────────────────────────────────────────────
function LiveBadge({ live }) {
  return live
    ? <span style={{ fontFamily:MONO, fontSize:8, fontWeight:700, color:C.green,
        background:"rgba(0,199,135,0.1)", border:`1px solid rgba(0,199,135,0.25)`,
        borderRadius:3, padding:"3px 8px", letterSpacing:"0.1em" }}>LIVE</span>
    : <span style={{ fontFamily:MONO, fontSize:8, fontWeight:700, color:C.orange,
        background:"rgba(255,140,0,0.08)", border:`1px solid rgba(255,140,0,0.2)`,
        borderRadius:3, padding:"3px 8px", letterSpacing:"0.1em" }}>CLOSED</span>;
}

// ── Direction arrow ───────────────────────────────────────────────────────────
function Arrow({ chg }) {
  const v = Number(chg)||0;
  return <span style={{ color:v>=0?C.green:C.red, fontSize:9, marginLeft:3 }}>{v>=0?"↑":"↓"}</span>;
}

// ── Section header ────────────────────────────────────────────────────────────
function PanelHeader({ title, subtitle, live, extra }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border2}`,
      borderRadius:6, padding:"10px 14px 8px", marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontFamily:SERIF, fontSize:13, fontWeight:700, color:C.white, fontStyle:"italic" }}>{title}</div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {extra}
          <LiveBadge live={live} />
        </div>
      </div>
      {subtitle && (
        <div style={{ fontFamily:MONO, fontSize:8, color:C.muted, letterSpacing:"0.08em" }}>{subtitle}</div>
      )}
    </div>
  );
}

// ── Sub-tab row ───────────────────────────────────────────────────────────────
function SubTabs({ tabs, value, onChange }) {
  return (
    <div style={{ display:"flex", gap:6, marginBottom:8 }}>
      {tabs.map(t => (
        <button key={t.val} onClick={()=>onChange(t.val)} style={{
          fontFamily:MONO, fontSize:9, fontWeight:700, letterSpacing:"0.1em",
          padding:"5px 12px", borderRadius:4, cursor:"pointer", border:"none",
          background: value===t.val ? C.gold : "rgba(255,255,255,0.04)",
          color: value===t.val ? C.bg : C.muted2,
          transition:"all 0.15s",
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ── Asset row (spot) ──────────────────────────────────────────────────────────
function SpotRow({ sym, label, price, chg, flash, live, badge }) {
  return (
    <div data-testid={`spot-row-${sym}`} style={{
      display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"10px 0", borderBottom:`1px solid ${C.border}`,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:C.text, letterSpacing:"0.06em" }}>
          {label||sym}
        </span>
        <Arrow chg={chg} />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <PriceBadge value={price} sym={sym} flash={flash} />
        <ChgBadge v={chg} />
        {badge && <SrcBadge label={badge} live={live} />}
      </div>
    </div>
  );
}

// ── Asset row (perp — from store) ─────────────────────────────────────────────
function PerpRow({ sym, asset }) {
  if (!asset) return (
    <div style={{ padding:"10px 0", borderBottom:`1px solid ${C.border}`,
      display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:C.text }}>{sym}</span>
      <span style={{ fontFamily:MONO, fontSize:10, color:C.muted }}>— Not listed on HL</span>
    </div>
  );
  const chg = asset.change24h || 0;
  const fund = fmtFund(asset.fundingRate);
  return (
    <div data-testid={`perp-row-${sym}`} style={{
      padding:"10px 0", borderBottom:`1px solid ${C.border}`,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:C.text, letterSpacing:"0.06em" }}>{sym}</span>
          <Arrow chg={chg} />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontFamily:MONO, fontSize:14, fontWeight:700,
            color:chg>=0?C.green:C.red }}>{fmt(asset.price, sym)}</span>
          <ChgBadge v={chg} />
          <SrcBadge label="HL" live={true} color={C.cyan} />
        </div>
      </div>
      {fund && (
        <div style={{ fontFamily:MONO, fontSize:8, color:Number(asset.fundingRate)>=0?C.green:C.red,
          marginTop:2, paddingLeft:2 }}>
          FUND {fund}/8h
          {asset.openInterest>0 && <span style={{ color:C.muted, marginLeft:8 }}>OI ${(asset.openInterest/1e6).toFixed(0)}M</span>}
        </div>
      )}
    </div>
  );
}

// ── Forex row ─────────────────────────────────────────────────────────────────
function ForexRow({ sym, price, chg, flash }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontFamily:MONO, fontSize:13, fontWeight:700, color:C.text }}>{FOREX_LABEL[sym]||sym}</span>
        <Arrow chg={chg} />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontFamily:MONO, fontSize:14, fontWeight:700,
          color: flash==="up"?C.green:flash==="down"?C.red:C.white,
          transition:"color 0.25s" }}>{fmtFx(price)}</span>
        <ChgBadge v={chg} />
      </div>
    </div>
  );
}

// ── CRYPTO TAB ────────────────────────────────────────────────────────────────
function CryptoTab({ cryptoPrices, flashes, storePerps, storeByClass, storeLoading }) {
  const [sub, setSub] = useState("spot");
  const isNYSE = () => {
    const now = new Date();
    const et  = new Date(now.toLocaleString("en-US", { timeZone:"America/New_York" }));
    const d=et.getDay(), h=et.getHours(), m=et.getMinutes();
    return d>=1&&d<=5 && (h>9||(h===9&&m>=30)) && h<16;
  };

  // Live crypto perps from store — sorted by OI (volume)
  const perpList = storeByClass?.crypto
    ? [...storeByClass.crypto].sort((a,b)=>(b.openInterest||0)-(a.openInterest||0))
    : CRYPTO_SYMS.map(s=>storePerps[s]?{...storePerps[s],ticker:s}:null).filter(Boolean);

  return (
    <div>
      <PanelHeader
        title="Crypto · Binance & Hyperliquid"
        subtitle="binance websocket · real-time spot  |  hyperliquid · perp funding"
        live={Object.values(cryptoPrices).some(d=>d.live)}
        extra={<span style={{ fontFamily:MONO, fontSize:7, color:C.cyan,
          background:"rgba(0,212,255,0.08)", border:`1px solid rgba(0,212,255,0.15)`,
          borderRadius:3, padding:"2px 7px", letterSpacing:"0.1em" }}>⚡ STREAMING</span>}
      />
      <SubTabs
        tabs={[{val:"spot",label:"SPOT · BINANCE"},{val:"perp",label:"PERP · HYPERLIQUID"}]}
        value={sub} onChange={setSub}
      />

      {sub==="spot" ? (
        <div>
          {CRYPTO_SYMS.map(sym => {
            const d = cryptoPrices[sym] || {};
            return <SpotRow key={sym} sym={sym} price={d.price} chg={d.chg}
              flash={flashes[sym]} live={d.live}
              badge={d.live?"LIVE":"SIM"} />;
          })}
        </div>
      ) : (
        <div>
          {storeLoading && perpList.length===0 && (
            <div style={{ fontFamily:MONO, fontSize:10, color:C.muted, padding:"20px 0", textAlign:"center" }}>
              Loading Hyperliquid perps…
            </div>
          )}
          {perpList.map(asset => {
            const sym = asset.ticker || asset.symbol || asset.coin || "";
            return <PerpRow key={sym} sym={sym} asset={asset} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── EQUITIES TAB ──────────────────────────────────────────────────────────────
function EquitiesTab({ equityPrices, flashes, storePerps }) {
  const [sub, setSub] = useState("spot");
  const isLive = () => {
    const et = new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
    const d=et.getDay(),h=et.getHours(),m=et.getMinutes();
    return d>=1&&d<=5&&(h>9||(h===9&&m>=30))&&h<16;
  };
  const live = isLive();
  return (
    <div>
      <PanelHeader
        title="Equities · Finnhub"
        subtitle="finnhub websocket · real-time trades · NYSE 9:30a–4p ET"
        live={live}
      />
      <SubTabs
        tabs={[{val:"spot",label:"SPOT · FINNHUB"},{val:"perp",label:"PERP · HYPERLIQUID"}]}
        value={sub} onChange={setSub}
      />
      {sub==="spot" ? (
        <div>
          {EQUITY_SYMS.map(sym => {
            const d = equityPrices[sym] || {};
            return <SpotRow key={sym} sym={sym} price={d.price} chg={d.chg}
              flash={flashes[sym]} live={live} badge={live?"LIVE":"CLOSED"} />;
          })}
        </div>
      ) : (
        <div>
          {EQUITY_SYMS.map(sym => <PerpRow key={sym} sym={sym} asset={storePerps[sym]||null} />)}
        </div>
      )}
    </div>
  );
}

// ── COMMODITIES TAB ───────────────────────────────────────────────────────────
function CommoditiesTab({ metalPrices, flashes, storePerps }) {
  const [sub, setSub] = useState("spot");
  return (
    <div>
      <PanelHeader
        title="Commodities · Gold-API & Finnhub"
        subtitle="gold-api.com · metals spot  |  finnhub · energy ETF proxies"
        live={Object.values(metalPrices).some(d=>d.live)}
      />
      <SubTabs
        tabs={[{val:"spot",label:"SPOT · GOLD-API/FH"},{val:"perp",label:"PERP · HYPERLIQUID"}]}
        value={sub} onChange={setSub}
      />
      {sub==="spot" ? (
        <div>
          {METALS_SYMS.map(sym => {
            const d = metalPrices[sym] || {};
            return <SpotRow key={sym} sym={sym} label={METAL_LABEL[sym]||sym}
              price={d.price} chg={d.chg} flash={flashes[sym]} live={d.live}
              badge={d.live?"LIVE":"SIM"} />;
          })}
        </div>
      ) : (
        <div>
          {METALS_SYMS.map(sym => {
            const perp = getPerpBySym(sym, storePerps);
            return <PerpRow key={sym} sym={METAL_LABEL[sym]||sym} asset={perp} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── FOREX TAB ─────────────────────────────────────────────────────────────────
function ForexTab({ forexPrices, flashes }) {
  const isOpen = () => {
    const et = new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
    const d=et.getDay(),h=et.getHours();
    if (d===6) return false;
    if (d===0 && h<17) return false;
    if (d===5 && h>=17) return false;
    return true;
  };
  return (
    <div>
      <PanelHeader
        title="Forex · Finnhub"
        subtitle="finnhub websocket · forex spot  |  sun 5pm – fri 5pm ET"
        live={isOpen()}
      />
      <div style={{ fontFamily:MONO, fontSize:8, color:C.muted, marginBottom:8, letterSpacing:"0.06em" }}>
        SPOT RATES ONLY — No perp market exists for forex pairs
      </div>
      {FOREX_SYMS.map(sym => {
        const d = forexPrices[sym] || {};
        return <ForexRow key={sym} sym={sym} price={d.price} chg={d.chg} flash={flashes[sym]} />;
      })}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export default function MarketTab({ cryptoPrices={}, equityPrices={}, metalPrices={}, forexPrices={}, flashes={} }) {
  const [cls, setCls] = useState("crypto");
  const { perps:storePerps, byClass:storeByClass, loading:storeLoading } = useMarketData();

  const CLASS_TABS = [
    { val:"crypto",      label:"CRYPTO"      },
    { val:"equities",    label:"EQUITIES"    },
    { val:"commodities", label:"COMMODITIES" },
    { val:"forex",       label:"FOREX"       },
  ];

  return (
    <div style={{ maxWidth:780, margin:"0 auto" }}>
      {/* ── Section header ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
        <div style={{ width:3, height:16, background:C.gold, borderRadius:2 }} />
        <div style={{ fontFamily:MONO, fontSize:9, color:C.gold, letterSpacing:"0.2em", fontWeight:700 }}>
          MARKET DATA
        </div>
      </div>

      {/* ── Class tabs ── */}
      <div style={{ display:"flex", gap:4, marginBottom:14, overflowX:"auto", paddingBottom:2 }}>
        {CLASS_TABS.map(t => (
          <button key={t.val} data-testid={`class-tab-${t.val}`}
            onClick={()=>setCls(t.val)} style={{
              fontFamily:MONO, fontSize:10, fontWeight:700, letterSpacing:"0.1em",
              padding:"7px 16px", borderRadius:4, cursor:"pointer", whiteSpace:"nowrap",
              border:`1px solid ${cls===t.val ? C.gold : C.border2}`,
              background: cls===t.val ? "rgba(201,168,76,0.12)" : "transparent",
              color: cls===t.val ? C.gold : C.muted2,
              transition:"all 0.15s",
            }}>{t.label}</button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {cls==="crypto"      && <CryptoTab      cryptoPrices={cryptoPrices} flashes={flashes} storePerps={storePerps} storeByClass={storeByClass} storeLoading={storeLoading} />}
      {cls==="equities"    && <EquitiesTab    equityPrices={equityPrices} flashes={flashes} storePerps={storePerps} />}
      {cls==="commodities" && <CommoditiesTab metalPrices={metalPrices}   flashes={flashes} storePerps={storePerps} />}
      {cls==="forex"       && <ForexTab       forexPrices={forexPrices}   flashes={flashes} />}
    </div>
  );
}
