import { useState, useEffect, useRef, useCallback } from "react";
import { fmtPrice } from "../store/MarketDataStore";
import { useTwitterIntelligence, buildAssetTwitterContext } from "../store/TwitterIntelligence";
import { useDataBus } from "../context/DataBusContext";
import KronosPanel from "../components/KronosPanel";

const mono  = "'IBM Plex Mono', monospace";
const serif = "'Playfair Display', serif";

// ─── Risk Profiles ────────────────────────────────────────────────────────────
const RISK_PROFILES = {
  low: {
    id:"low", label:"CONSERVATIVE", icon:"🛡",
    color:"#4ade80", hex:"74,222,128",
    desc:"Wide stops · Low leverage · Capital first",
    slMultiplier:2.5, leverage:[1,3], riskPct:1, minWinProb:85,
    tpRatios:[2.0,4.0],
  },
  mid: {
    id:"mid", label:"BALANCED", icon:"⚖",
    color:"#f59e0b", hex:"245,158,11",
    desc:"Standard quant · Risk/reward optimized",
    slMultiplier:1.8, leverage:[3,7], riskPct:2, minWinProb:80,
    tpRatios:[1.5,3.0],
  },
  high: {
    id:"high", label:"AGGRESSIVE", icon:"⚡",
    color:"#ff2d55", hex:"255,45,85",
    desc:"Tight stops · High leverage · Max upside",
    slMultiplier:1.2, leverage:[5,15], riskPct:4, minWinProb:75,
    tpRatios:[1.2,2.5],
  },
};

// ─── Timeframes ───────────────────────────────────────────────────────────────
const TIMEFRAMES = {
  today: { id:"today", label:"Today",     sublabel:"Scalp–Intraday", interval:"15m", count:200 },
  mid:   { id:"mid",   label:"Mid-Term",  sublabel:"1–4 weeks",     interval:"4h",  count:300 },
  long:  { id:"long",  label:"Long-Term", sublabel:"1–3 months",    interval:"1d",  count:200 },
};

// ─── Full Asset Library ───────────────────────────────────────────────────────
const FULL_ASSET_LIBRARY = [
  // CRYPTO — LARGE CAP
  { ticker:"BTC",    name:"Bitcoin",          cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"ETH",    name:"Ethereum",         cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"SOL",    name:"Solana",           cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"BNB",    name:"BNB",              cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"XRP",    name:"XRP",              cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"ADA",    name:"Cardano",          cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"AVAX",   name:"Avalanche",        cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"DOGE",   name:"Dogecoin",         cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"DOT",    name:"Polkadot",         cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"POL",    name:"Polygon",          cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"LINK",   name:"Chainlink",        cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"LTC",    name:"Litecoin",         cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"UNI",    name:"Uniswap",          cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"ATOM",   name:"Cosmos",           cat:"CRYPTO",    sub:"LARGE_CAP",    flags:[] },
  // CRYPTO — MID CAP
  { ticker:"HYPE",   name:"Hyperliquid",      cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"HBAR",   name:"Hedera",           cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"TIA",    name:"Celestia",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"FET",    name:"Fetch.ai",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"NEAR",   name:"NEAR Protocol",    cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"SUI",    name:"Sui",              cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"APT",    name:"Aptos",            cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"ARB",    name:"Arbitrum",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"OP",     name:"Optimism",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"INJ",    name:"Injective",        cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"SEI",    name:"Sei",              cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"AAVE",   name:"Aave",             cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"ONDO",   name:"Ondo Finance",     cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"RENDER", name:"Render",           cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"PENDLE", name:"Pendle",           cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"JUP",    name:"Jupiter",          cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"TAO",    name:"Bittensor",        cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"WIF",    name:"dogwifhat",        cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"TRUMP",  name:"Official Trump",   cat:"CRYPTO",    sub:"MID_CAP",      flags:["HIGH_RISK"] },
  { ticker:"PEPE",   name:"Pepe",             cat:"CRYPTO",    sub:"MID_CAP",      flags:["HIGH_RISK"] },
  { ticker:"BONK",   name:"Bonk",             cat:"CRYPTO",    sub:"MID_CAP",      flags:["HIGH_RISK"] },
  { ticker:"FLOKI",  name:"Floki",            cat:"CRYPTO",    sub:"MID_CAP",      flags:["HIGH_RISK"] },
  { ticker:"WLD",    name:"Worldcoin",        cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"EIGEN",  name:"Eigenlayer",       cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"PYTH",   name:"Pyth Network",     cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"STX",    name:"Stacks",           cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"MANTA",  name:"Manta",            cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"ALT",    name:"AltLayer",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"DYM",    name:"Dymension",        cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"STRK",   name:"Starknet",         cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"ZK",     name:"ZKsync",           cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  { ticker:"BLAST",  name:"Blast",            cat:"CRYPTO",    sub:"MID_CAP",      flags:[] },
  // CRYPTO — SMALL/EMERGING
  { ticker:"POPCAT",  name:"Popcat",          cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"MEW",     name:"cat in a dogs",   cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"BOME",    name:"Book of Meme",    cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"NEIRO",   name:"Neiro",           cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"PNUT",    name:"Peanut the Squirrel",cat:"CRYPTO", sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"ACT",     name:"Act I",           cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"VIRTUAL", name:"Virtuals Protocol",cat:"CRYPTO",   sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"AI16Z",   name:"ai16z",           cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  { ticker:"GRIFFAIN",name:"Griffain",        cat:"CRYPTO",    sub:"SMALL_CAP",    flags:["HIGH_RISK"] },
  // EQUITIES — US LARGE CAP
  { ticker:"AAPL",   name:"Apple Inc.",       cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"MSFT",   name:"Microsoft",        cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"NVDA",   name:"NVIDIA",           cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"TSLA",   name:"Tesla",            cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"META",   name:"Meta Platforms",   cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"GOOGL",  name:"Alphabet",         cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"AMZN",   name:"Amazon",           cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"NFLX",   name:"Netflix",          cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"AMD",    name:"AMD",              cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"COIN",   name:"Coinbase",         cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"MSTR",   name:"MicroStrategy",    cat:"EQUITY",    sub:"LARGE_CAP",    flags:["HIGH_VOL"] },
  { ticker:"PLTR",   name:"Palantir",         cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"HOOD",   name:"Robinhood",        cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"SOFI",   name:"SoFi Technologies",cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"RKLB",   name:"Rocket Lab",       cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"IONQ",   name:"IonQ",             cat:"EQUITY",    sub:"LARGE_CAP",    flags:["HIGH_VOL"] },
  { ticker:"SMCI",   name:"Super Micro",      cat:"EQUITY",    sub:"LARGE_CAP",    flags:["HIGH_VOL"] },
  { ticker:"ARM",    name:"ARM Holdings",     cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"CRWD",   name:"CrowdStrike",      cat:"EQUITY",    sub:"LARGE_CAP",    flags:[] },
  { ticker:"PANW",   name:"Palo Alto Networks",cat:"EQUITY",   sub:"LARGE_CAP",    flags:[] },
  // EQUITIES — LEVERAGED ETFs
  { ticker:"SQQQ",   name:"ProShares UltraPro Short QQQ", cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"TQQQ",   name:"ProShares UltraPro QQQ",       cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"SOXS",   name:"Direxion Semi Bear 3x",        cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"SOXL",   name:"Direxion Semi Bull 3x",        cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"UVXY",   name:"ProShares Ultra VIX",          cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"SPXU",   name:"ProShares UltraPro Short S&P", cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  { ticker:"SPXL",   name:"Direxion S&P 500 Bull 3x",    cat:"EQUITY", sub:"LEVERAGED_ETF", flags:["HIGH_VOL"] },
  // COMMODITIES
  { ticker:"XAU",    name:"Gold",             cat:"COMMODITY", sub:"METALS",       flags:[] },
  { ticker:"XAG",    name:"Silver",           cat:"COMMODITY", sub:"METALS",       flags:[] },
  { ticker:"CL",     name:"Crude Oil (WTI)",  cat:"COMMODITY", sub:"ENERGY",       flags:[] },
  { ticker:"NG",     name:"Natural Gas",      cat:"COMMODITY", sub:"ENERGY",       flags:["HIGH_VOL"] },
  { ticker:"COPPER", name:"Copper",           cat:"COMMODITY", sub:"METALS",       flags:[] },
  { ticker:"WHEAT",  name:"Wheat",            cat:"COMMODITY", sub:"GRAINS",       flags:[] },
  { ticker:"CORN",   name:"Corn",             cat:"COMMODITY", sub:"GRAINS",       flags:[] },
  { ticker:"NATGAS", name:"Nat Gas Spot",     cat:"COMMODITY", sub:"ENERGY",       flags:["HIGH_VOL"] },
  { ticker:"HG",     name:"Copper Futures",   cat:"COMMODITY", sub:"METALS",       flags:[] },
  // FX PAIRS
  { ticker:"EURUSD", name:"Euro / USD",       cat:"FX",        sub:"MAJOR",        flags:[] },
  { ticker:"GBPUSD", name:"British Pound / USD", cat:"FX",     sub:"MAJOR",        flags:[] },
  { ticker:"USDJPY", name:"USD / Japanese Yen",  cat:"FX",     sub:"MAJOR",        flags:[] },
  { ticker:"AUDUSD", name:"Aussie Dollar / USD",  cat:"FX",    sub:"MAJOR",        flags:[] },
  { ticker:"USDCAD", name:"USD / Canadian Dollar",cat:"FX",    sub:"MAJOR",        flags:[] },
  { ticker:"USDCHF", name:"USD / Swiss Franc",    cat:"FX",    sub:"MAJOR",        flags:[] },
  { ticker:"NZDUSD", name:"NZD / USD",            cat:"FX",    sub:"MAJOR",        flags:[] },
  { ticker:"EURJPY", name:"Euro / JPY",           cat:"FX",    sub:"CROSS",        flags:[] },
  { ticker:"GBPJPY", name:"Pound / JPY",          cat:"FX",    sub:"CROSS",        flags:["HIGH_VOL"] },
  { ticker:"XAUUSD", name:"Gold / USD",           cat:"FX",    sub:"COMMODITY_FX", flags:[] },
  // INDICES
  { ticker:"SPX",    name:"S&P 500",          cat:"INDEX",     sub:"US",           flags:[] },
  { ticker:"NDX",    name:"Nasdaq 100",        cat:"INDEX",     sub:"US",           flags:[] },
  { ticker:"DJI",    name:"Dow Jones",         cat:"INDEX",     sub:"US",           flags:[] },
  { ticker:"VIX",    name:"Volatility Index",  cat:"INDEX",     sub:"US",           flags:["HIGH_VOL"] },
  { ticker:"DAX",    name:"Germany DAX",       cat:"INDEX",     sub:"EU",           flags:[] },
  { ticker:"FTSE",   name:"FTSE 100",          cat:"INDEX",     sub:"EU",           flags:[] },
  { ticker:"NIKKEI", name:"Nikkei 225",        cat:"INDEX",     sub:"ASIA",         flags:[] },
  { ticker:"HSI",    name:"Hang Seng",         cat:"INDEX",     sub:"ASIA",         flags:[] },
];

const TOP_5_BY_VOLUME = ["BTC","ETH","SOL","BNB","NVDA"];

// ─── Helper functions ─────────────────────────────────────────────────────────
function getAssetMeta(ticker) {
  return FULL_ASSET_LIBRARY.find(a => a.ticker === ticker) || { ticker, name:ticker, cat:"CRYPTO", sub:"", flags:[] };
}

function ASSET_CLASS(ticker) {
  const meta = getAssetMeta(ticker);
  if (meta.cat === "EQUITY")    return "equity";
  if (meta.cat === "COMMODITY") return "commodity";
  if (meta.cat === "FX")        return "fx";
  if (meta.cat === "INDEX")     return "index";
  return "crypto";
}

function autoMarket(ticker) {
  return ASSET_CLASS(ticker) === "crypto" ? null : "SPOT"; // null = use user's setting
}

function scoreToDisplayTier(score) {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return null;
}

const DISPLAY_TIER_CONFIG = {
  S: { color:"#d4af37", bg:"rgba(212,175,55,0.15)", border:"rgba(212,175,55,0.5)", glow:true },
  A: { color:"#00ff88", bg:"rgba(0,255,136,0.10)",  border:"rgba(0,255,136,0.4)",  glow:false },
  B: { color:"#3b82f6", bg:"rgba(59,130,246,0.10)", border:"rgba(59,130,246,0.4)", glow:false },
  C: { color:"#6b7a99", bg:"rgba(107,122,153,0.08)",border:"rgba(107,122,153,0.3)",glow:false },
};

const CAT_COLORS = {
  CRYPTO:"#9945ff", EQUITY:"#3b82f6", COMMODITY:"#d4af37", FX:"#00e5ff", INDEX:"#f59e0b",
};

const MEDALS = ["🥇","🥈","🥉"];

function convictionBarColor(score) {
  if (score > 85) return "#d4af37";
  if (score > 70) return "#00ff88";
  if (score > 50) return "#f59e0b";
  return "#ff2d55";
}

function fmtPct(val, plusSign = true) {
  if (val == null) return "—";
  const s = `${Math.abs(val).toFixed(2)}%`;
  return val >= 0 ? (plusSign ? `+${s}` : s) : `-${s}`;
}

function formatSignalName(sig) {
  return sig.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

function extractEdgeFactors(result) {
  const green = (result.bayesian?.signals_used || []).slice(0,4).map(formatSignalName);
  const amber = (result.risk_flags || result.risks || []).slice(0,3);
  return { green, amber };
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch (_) {}
}

// ─── Existing sub-components (unchanged) ──────────────────────────────────────
function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:8, padding:"11px 12px" }}>
      <div style={{ fontSize:9, color:"#6b7a99", fontFamily:mono, marginBottom:4, letterSpacing:1 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:800, color:color||"#e8e8f0", fontFamily:mono }}>{value}</div>
      {sub && <div style={{ fontSize:8, color:"#3a4560", fontFamily:mono, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function LevelRow({ label, price, color, note }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
      <div>
        <div style={{ fontSize:10, color:"#a0aec0", fontFamily:mono }}>{label}</div>
        {note && <div style={{ fontSize:8, color:"#3a4560", fontFamily:mono, marginTop:2 }}>{note}</div>}
      </div>
      <div style={{ fontSize:16, fontWeight:900, color, fontFamily:mono }}>{fmtPrice(price)}</div>
    </div>
  );
}

const TIER_CONFIG_LEGACY = {
  A: { label:"ELITE",    color:"#00ff88", bg:"rgba(0,255,136,0.08)",  border:"rgba(0,255,136,0.3)",  desc:"≥80% Bayesian confidence · All signals aligned" },
  B: { label:"HIGH",     color:"#d4af37", bg:"rgba(212,175,55,0.08)", border:"rgba(212,175,55,0.3)", desc:"≥70% Bayesian confidence · Strong setup" },
  C: { label:"MODERATE", color:"#f59e0b", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.3)", desc:"≥60% Bayesian confidence · Proceed with caution" },
  D: { label:"WEAK",     color:"#ff2d55", bg:"rgba(255,45,85,0.08)",  border:"rgba(255,45,85,0.3)",  desc:"<60% confidence · Stand aside or reduce size" },
};
const TREND_ARROW = { BULLISH:"↑", BEARISH:"↓", NEUTRAL:"→", LEANING_BULL:"↗", LEANING_BEAR:"↘", MIXED:"↔" };
const TREND_COLOR = { BULLISH:"#00ff88", BEARISH:"#ff2d55", NEUTRAL:"#f59e0b", LEANING_BULL:"#4ade80", LEANING_BEAR:"#f87171", MIXED:"#6b7a99" };

function BayesianMeter({ probability, tier, interpretation }) {
  const cfg = TIER_CONFIG_LEGACY[tier] || TIER_CONFIG_LEGACY.C;
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDisplayed(probability), 100);
    return () => clearTimeout(t);
  }, [probability]);
  return (
    <div style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:"16px 16px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:8, color:"#6b7a99", letterSpacing:1.5, marginBottom:4 }}>BAYESIAN BRAIN SCORE</div>
          <div style={{ fontSize:11, color:cfg.color, fontWeight:800, letterSpacing:1 }}>{interpretation}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:9, color:"#6b7a99", marginBottom:2 }}>CONVICTION TIER</div>
          <div style={{ fontSize:28, fontWeight:900, color:cfg.color, fontFamily:mono, background:cfg.bg, border:`2px solid ${cfg.color}`, borderRadius:8, width:48, height:48, display:"flex", alignItems:"center", justifyContent:"center" }}>{tier}</div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
        <div style={{ fontSize:36, fontWeight:900, color:cfg.color, fontFamily:mono, lineHeight:1 }}>
          {displayed.toFixed(1)}<span style={{ fontSize:18 }}>%</span>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:8, color:"#3a4560", marginBottom:4 }}>probability of successful trade</div>
          <div style={{ height:6, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${displayed}%`, background:`linear-gradient(90deg,${cfg.color}60,${cfg.color})`, borderRadius:3, transition:"width 1.5s cubic-bezier(.4,0,.2,1)" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
            <span style={{ fontSize:7, color:"#2a3550" }}>0%</span>
            <span style={{ fontSize:7, color:"#2a3550" }}>50%</span>
            <span style={{ fontSize:7, color:"#2a3550" }}>100%</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize:8, color:"#3a4560", lineHeight:1.5 }}>{cfg.desc}</div>
    </div>
  );
}

function MultiTFStrip({ multiTf }) {
  if (!multiTf) return null;
  const tfs = [{ key:"15m", label:"15m", sub:"Scalp" },{ key:"4h", label:"4H", sub:"Swing" },{ key:"1d", label:"1D", sub:"Trend" }];
  const dirColor  = TREND_COLOR[multiTf.direction] || "#6b7a99";
  const confluent = multiTf.confluent;
  return (
    <div style={{ background:"#0a0f1e", border:"1px solid #1a2235", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, fontWeight:700 }}>◆ MULTI-TIMEFRAME CONFLUENCE</div>
        <div style={{ fontSize:8, fontWeight:800, letterSpacing:1, color:confluent?"#00ff88":"#f59e0b", background:confluent?"rgba(0,255,136,0.08)":"rgba(245,158,11,0.08)", border:`1px solid ${confluent?"rgba(0,255,136,0.3)":"rgba(245,158,11,0.3)"}`, padding:"3px 8px", borderRadius:4 }}>
          {confluent ? "✓ CONFLUENT" : "⚡ MIXED"} · {multiTf.strength}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        {tfs.map(({ key, label, sub }) => {
          const tf = multiTf[key];
          const trend = tf?.trend || "NEUTRAL";
          const col   = TREND_COLOR[trend] || "#6b7a99";
          const arrow = TREND_ARROW[trend] || "→";
          return (
            <div key={key} style={{ background:`rgba(${col==="#00ff88"?"0,255,136":col==="#ff2d55"?"255,45,85":"245,158,11"},0.05)`, border:`1px solid ${col}30`, borderRadius:8, padding:"10px", textAlign:"center" }}>
              <div style={{ fontSize:8, color:"#6b7a99", marginBottom:4 }}>{label} · {sub}</div>
              <div style={{ fontSize:24, color:col, fontWeight:900, lineHeight:1, marginBottom:4 }}>{arrow}</div>
              <div style={{ fontSize:8, fontWeight:800, color:col }}>{trend.replace("_"," ")}</div>
              {tf?.ema9 > 0 && <div style={{ fontSize:7, color:"#2a3550", marginTop:4, lineHeight:1.6 }}>EMA9 {fmtPrice(tf.ema9)}<br/>EMA21 {fmtPrice(tf.ema21)}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:8, color:"#3a4560" }}>Overall direction:</span>
        <span style={{ fontSize:9, fontWeight:800, color:dirColor }}>{TREND_ARROW[multiTf.direction] || "↔"} {multiTf.direction?.replace("_"," ")}</span>
      </div>
    </div>
  );
}

function FearGreedPanel({ fng }) {
  if (!fng) return null;
  const val = fng.value || 50;
  const col = val<=25?"#00ff88":val>=75?"#ff2d55":val<=45?"#f87171":val>=60?"#f59e0b":"#6b7a99";
  const emoji = val<=25?"😱":val>=75?"🤑":val<=45?"😨":val>=60?"😎":"😐";
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:10, padding:"11px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, fontWeight:700 }}>◆ FEAR & GREED INDEX</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:28 }}>{emoji}</div>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontSize:13, fontWeight:900, color:col, fontFamily:mono }}>{val}/100</span>
            <span style={{ fontSize:10, fontWeight:700, color:col }}>{(fng.classification||"Neutral").toUpperCase()}</span>
          </div>
          <div style={{ height:5, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${val}%`, background:"linear-gradient(90deg,#00ff88,#f59e0b,#ff2d55)", borderRadius:3 }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatternPanel({ patterns }) {
  if (!patterns) return null;
  const { detected } = patterns;
  const PATS = [
    { key:"bull_flag", icon:"📈", label:"BULL FLAG", color:"#00ff88" },
    { key:"bear_flag", icon:"📉", label:"BEAR FLAG", color:"#ff2d55" },
    { key:"head_and_shoulders", icon:"🔻", label:"H&S", color:"#ff2d55" },
    { key:"double_top", icon:"⛰", label:"DBL TOP", color:"#f87171" },
    { key:"double_bottom", icon:"🏔", label:"DBL BOTTOM", color:"#4ade80" },
  ];
  const detectedPats = PATS.filter(p => detected[p.key]);
  if (detectedPats.length === 0) return null;
  return (
    <div style={{ marginBottom:12, display:"flex", flexWrap:"wrap", gap:5 }}>
      {detectedPats.map(p => (
        <span key={p.key} style={{ fontSize:8, color:p.color, background:`${p.color}11`, border:`1px solid ${p.color}30`, borderRadius:4, padding:"3px 8px", fontFamily:mono }}>
          {p.icon} {p.label} DETECTED
        </span>
      ))}
    </div>
  );
}

const LOAD_STEPS = [
  "Fetching candle history…",
  "Running multi-timeframe confluence…",
  "Computing Bayesian brain score…",
  "Scanning chart patterns…",
  "Fetching Fear & Greed index…",
  "Checking macro kill switch…",
  "Routing to CLVR Quant Engine…",
  "Synthesising AI analysis…",
];

function LoadingBrain({ step, progress }) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPulse(p => (p+1)%3), 400);
    return () => clearInterval(t);
  }, []);
  const dots = ".".repeat(pulse+1);
  return (
    <div style={{ background:"rgba(212,175,55,0.04)", border:"1px solid rgba(212,175,55,0.15)", borderRadius:12, padding:"20px 16px", marginBottom:20, textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:8 }}>🧠</div>
      <div style={{ fontSize:11, fontWeight:800, color:"#d4af37", letterSpacing:1, marginBottom:6 }}>MASTERBRAIN ACTIVE</div>
      <div style={{ fontSize:10, color:"#6b7a99", marginBottom:14 }}>{step}{dots}</div>
      {progress && (
        <div style={{ marginBottom:12 }}>
          <div style={{ height:3, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden", marginBottom:4 }}>
            <div style={{ height:"100%", width:`${(progress.done/progress.total)*100}%`, background:"linear-gradient(90deg,#d4af37,#00ff88)", borderRadius:3, transition:"width 0.5s ease" }}/>
          </div>
          <div style={{ fontSize:8, color:"#6b7a99" }}>Analyzing {progress.done} / {progress.total} assets</div>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
        {["Multi-TF Confluence","Bayesian Scoring","Pattern Recognition","Macro Kill Switch"].map((label,i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:6, padding:"6px 4px", fontSize:7, color:"#3a4560", textAlign:"center" }}>
            <div style={{ fontSize:10, marginBottom:3 }}>{["🔀","🎯","📊","🛡"][i]}</div>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NEW: Asset Browser ────────────────────────────────────────────────────────
function AssetBrowser({ selected, onToggle, onClearAll, onSelectTop5, prices, funding, oi }) {
  const [search, setSearch]   = useState("");
  const [catFilter, setCatFilter] = useState("ALL");

  const CATS = ["ALL","CRYPTO","EQUITY","COMMODITY","FX","INDEX"];

  const filtered = FULL_ASSET_LIBRARY.filter(a => {
    const matchCat = catFilter === "ALL" || a.cat === catFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div>
      {/* Search */}
      <div style={{ position:"relative", marginBottom:10 }}>
        <input
          type="text"
          placeholder="Search assets… BTC, Gold, TSLA, EURUSD"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-asset-search"
          style={{
            width:"100%", boxSizing:"border-box",
            background:"#0d1321", border:"1px solid #1a2235",
            borderRadius:8, padding:"10px 12px 10px 36px",
            color:"#e8e8f0", fontFamily:mono, fontSize:12, outline:"none",
          }}
        />
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, opacity:0.4 }}>🔍</span>
        {search && (
          <button onClick={() => setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#6b7a99", cursor:"pointer", fontSize:14 }}>×</button>
        )}
      </div>

      {/* Category tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        {CATS.map(c => (
          <button key={c} onClick={() => setCatFilter(c)} data-testid={`btn-cat-${c}`} style={{
            background: catFilter===c ? (CAT_COLORS[c]||"rgba(212,175,55,0.15)") + "22" : "transparent",
            border:`1px solid ${catFilter===c ? (CAT_COLORS[c]||"#d4af37") : "#1a2235"}`,
            color: catFilter===c ? (CAT_COLORS[c]||"#d4af37") : "#6b7a99",
            borderRadius:5, padding:"5px 10px", cursor:"pointer",
            fontFamily:mono, fontSize:9, fontWeight:catFilter===c?800:400, letterSpacing:0.5,
          }}>{c}</button>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
        <span style={{ fontSize:8, color:"#3a4560", fontFamily:mono }}>
          {selected.length}/5 selected
        </span>
        <button onClick={onSelectTop5} data-testid="btn-select-top5" style={{
          background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.25)",
          color:"#00ff88", borderRadius:4, padding:"4px 10px",
          fontFamily:mono, fontSize:8, fontWeight:700, cursor:"pointer", letterSpacing:0.5,
        }}>⭐ TOP 5 BY VOLUME</button>
        {selected.length > 0 && (
          <button onClick={onClearAll} data-testid="btn-clear-assets" style={{
            background:"rgba(255,45,85,0.06)", border:"1px solid rgba(255,45,85,0.25)",
            color:"#ff2d55", borderRadius:4, padding:"4px 10px",
            fontFamily:mono, fontSize:8, fontWeight:700, cursor:"pointer",
          }}>CLEAR ALL</button>
        )}
      </div>

      {/* Asset grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:8, maxHeight:320, overflowY:"auto", paddingRight:4 }}>
        {filtered.map(a => {
          const isSelected = selected.includes(a.ticker);
          const catCol     = CAT_COLORS[a.cat] || "#6b7a99";
          const liveData   = prices[a.ticker] || prices[a.ticker.toLowerCase()];
          const fundRate   = funding[a.ticker];
          const oiVal      = oi[a.ticker];
          const isHighConv = Math.abs(fundRate||0) > 0.01;
          const isThinBook = oiVal != null && oiVal < 5_000_000;
          const disabled   = !isSelected && selected.length >= 5;

          return (
            <div
              key={a.ticker}
              onClick={() => !disabled && onToggle(a.ticker)}
              data-testid={`asset-card-${a.ticker}`}
              style={{
                background: isSelected ? `${catCol}15` : "rgba(255,255,255,0.02)",
                border:`1.5px solid ${isSelected ? catCol : "#1a2235"}`,
                borderRadius:8, padding:"9px 10px", cursor:disabled?"not-allowed":"pointer",
                opacity:disabled?0.4:1, transition:"all 0.15s", position:"relative",
                boxShadow: isSelected ? `0 0 12px ${catCol}25` : "none",
              }}
            >
              {/* Selected checkmark */}
              {isSelected && (
                <div style={{ position:"absolute", top:5, right:7, fontSize:10, color:catCol, fontWeight:900 }}>✓</div>
              )}

              {/* Ticker + Name */}
              <div style={{ fontSize:12, fontWeight:900, color:isSelected?catCol:"#e8e8f0", fontFamily:mono, marginBottom:2 }}>{a.ticker}</div>
              <div style={{ fontSize:8, color:"#6b7a99", marginBottom:6, lineHeight:1.3, minHeight:20 }}>{a.name}</div>

              {/* Price */}
              {liveData?.price && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#e8e8f0", fontFamily:mono }}>{fmtPrice(liveData.price)}</div>
                  {liveData.chg != null && (
                    <div style={{ fontSize:8, fontWeight:700, color:liveData.chg>=0?"#00ff88":"#ff2d55" }}>
                      {liveData.chg>=0?"+":""}{liveData.chg?.toFixed(2)}%
                    </div>
                  )}
                </div>
              )}

              {/* Badges */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:2 }}>
                <span style={{ fontSize:6, color:catCol, background:`${catCol}15`, border:`1px solid ${catCol}30`, borderRadius:3, padding:"1px 5px", fontFamily:mono }}>{a.cat}</span>
                {a.flags.includes("HIGH_RISK") && <span style={{ fontSize:6, color:"#ff2d55", background:"rgba(255,45,85,0.1)", borderRadius:3, padding:"1px 5px" }}>⚠️ HIGH RISK</span>}
                {a.flags.includes("HIGH_VOL")  && <span style={{ fontSize:6, color:"#f59e0b", background:"rgba(245,158,11,0.1)", borderRadius:3, padding:"1px 5px" }}>🔥 HIGH VOL</span>}
                {isThinBook && <span style={{ fontSize:6, color:"#f59e0b", background:"rgba(245,158,11,0.08)", borderRadius:3, padding:"1px 5px" }}>THIN BOOK</span>}
                {isHighConv && <span style={{ fontSize:6, color:"#d4af37", background:"rgba(212,175,55,0.12)", borderRadius:3, padding:"1px 5px" }}>⭐ EXTREME FUNDING</span>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn:"1/-1", textAlign:"center", color:"#3a4560", fontSize:10, padding:"20px 0", fontFamily:mono }}>
            No assets match your search
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NEW: Scan Summary Banner ─────────────────────────────────────────────────
function ScanSummaryBanner({ scanned, found, regime, crashProb, scanResults, killSwitch, macroEvents }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", timeZone:"America/New_York" });
  const dateStr = now.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }).toUpperCase();

  const crashColor = crashProb < 30 ? "#00ff88" : crashProb < 50 ? "#f59e0b" : "#ff2d55";
  const crashIcon  = crashProb < 30 ? "✅" : crashProb < 50 ? "⚠️" : "🔴";

  // Compute macro warning from killSwitch
  let macroWarnLevel = "GREEN";
  let macroWarnText  = "No macro events in next 4 hours";
  let macroWarnIcon  = "✅";

  const nearEvt = killSwitch?.nearest_event;
  if (nearEvt?.hours_away != null) {
    if (nearEvt.hours_away < 0.5) {
      macroWarnLevel = "RED";
      macroWarnIcon  = "⛔";
      macroWarnText  = `HIGH IMPACT NOW: ${nearEvt.name} — REDUCE POSITION SIZE`;
    } else if (nearEvt.hours_away < 2) {
      macroWarnLevel = "AMBER";
      macroWarnIcon  = "⚠️";
      macroWarnText  = `HIGH IMPACT IN ${nearEvt.hours_away.toFixed(1)}H: ${nearEvt.name} — Reduce size`;
    }
  }

  const macroRowBg = macroWarnLevel==="RED" ? "rgba(255,45,85,0.15)" : macroWarnLevel==="AMBER" ? "rgba(245,158,11,0.12)" : "rgba(0,255,136,0.08)";
  const macroRowBorder = macroWarnLevel==="RED" ? "rgba(255,45,85,0.4)" : macroWarnLevel==="AMBER" ? "rgba(245,158,11,0.35)" : "rgba(0,255,136,0.25)";
  const macroRowColor  = macroWarnLevel==="RED" ? "#ff2d55" : macroWarnLevel==="AMBER" ? "#f59e0b" : "#00ff88";

  // Funding bias from results
  const extremeFunding = scanResults.filter(r => r.result && Math.abs(r.fundingRate||0) > 0.01).length;

  return (
    <div style={{ background:"linear-gradient(135deg,#0a0f1e,#060a13)", border:`1px solid rgba(212,175,55,0.35)`, borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
      {/* Title row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>🧠</span>
          <div>
            <div style={{ fontSize:11, fontWeight:900, color:"#d4af37", letterSpacing:2, fontFamily:mono }}>MASTERBRAIN SCAN</div>
            <div style={{ fontSize:8, color:"#3a4560", fontFamily:mono }}>Quant Engine · Multi-Factor Analysis</div>
          </div>
        </div>
        <div style={{ fontSize:9, color:"#6b7a99", fontFamily:mono, textAlign:"right" }}>
          {dateStr}<br/>
          <span style={{ color:"#d4af37" }}>{timeStr} ET</span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        {[
          { label:"ASSETS SCANNED", value:scanned, color:"#e8e8f0" },
          { label:"SIGNALS FOUND",  value:found,   color:found>0?"#00ff88":"#ff2d55" },
          { label:"REGIME",         value:`${regime?.label||"NEUTRAL"} ${regime?.score||50}/100`, color:regime?.label==="RISK_ON"?"#00ff88":regime?.label==="RISK_OFF"?"#ff2d55":"#f59e0b" },
        ].map(s => (
          <div key={s.label} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1a2235", borderRadius:7, padding:"7px 12px", flex:1, minWidth:100 }}>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, letterSpacing:1, marginBottom:3 }}>{s.label}</div>
            <div style={{ fontSize:11, fontWeight:900, color:s.color, fontFamily:mono }}>{s.value}</div>
          </div>
        ))}
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1a2235", borderRadius:7, padding:"7px 12px", flex:1, minWidth:100 }}>
          <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, letterSpacing:1, marginBottom:3 }}>CRASH PROB</div>
          <div style={{ fontSize:11, fontWeight:900, color:crashColor, fontFamily:mono }}>{crashIcon} {crashProb}%</div>
        </div>
        {extremeFunding > 0 && (
          <div style={{ background:"rgba(212,175,55,0.06)", border:"1px solid rgba(212,175,55,0.2)", borderRadius:7, padding:"7px 12px", flex:1, minWidth:100 }}>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, letterSpacing:1, marginBottom:3 }}>FUNDING BIAS</div>
            <div style={{ fontSize:11, fontWeight:900, color:"#d4af37", fontFamily:mono }}>⭐ {extremeFunding} Extreme</div>
          </div>
        )}
      </div>

      {/* Macro warning row */}
      <div style={{ background:macroRowBg, border:`1px solid ${macroRowBorder}`, borderRadius:7, padding:"7px 12px", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:14 }}>{macroWarnIcon}</span>
        <span style={{ fontSize:9, color:macroRowColor, fontFamily:mono, fontWeight:700 }}>{macroWarnText}</span>
      </div>
    </div>
  );
}

// ─── NEW: Signal Card ─────────────────────────────────────────────────────────
function SignalCard({ rank, ticker, result, onDismiss, onSetAlert }) {
  const [edgeExpanded, setEdgeExpanded] = useState(true);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (dismissed) return null;

  const isLong = result.signal?.includes("LONG");
  const borderColor = isLong ? "#00ff88" : "#ff2d55";
  const dirLabel    = isLong ? "↑ LONG" : "↓ SHORT";

  const winProb  = result.win_probability || result.adjusted_score || 75;
  const tierKey  = scoreToDisplayTier(winProb);
  const tierCfg  = DISPLAY_TIER_CONFIG[tierKey] || DISPLAY_TIER_CONFIG.C;
  const barColor = convictionBarColor(winProb);

  const entry = result.entry?.price;
  const tp1   = result.tp1?.price;
  const tp2   = result.tp2?.price;
  const sl    = result.stopLoss?.price;

  const tp1Pct = (entry && tp1) ? ((tp1 - entry) / entry * 100 * (isLong ? 1 : -1)) : null;
  const tp2Pct = (entry && tp2) ? ((tp2 - entry) / entry * 100 * (isLong ? 1 : -1)) : null;
  const slPct  = (entry && sl)  ? ((sl  - entry) / entry * 100 * (isLong ? 1 : -1)) : null;

  const rr       = result.rr;
  const leverage = result.leverage?.recommended || result.leverage?.max || "—";
  const duration = result.hold?.duration || "—";
  const market   = result.market_type || "PERP";

  const assetMeta = getAssetMeta(ticker);
  const { green: edgeGreen, amber: edgeAmber } = extractEdgeFactors(result);

  const rrColor = rr >= 2.5 ? "#00ff88" : rr >= 2.0 ? "#f59e0b" : "#ff2d55";

  const handleCopy = () => {
    const txt = `ASSET: ${ticker} ${isLong?"LONG":"SHORT"} | ENTRY: ${fmtPrice(entry)} | TP1: ${fmtPrice(tp1)} | TP2: ${fmtPrice(tp2)||"—"} | SL: ${fmtPrice(sl)} | LEV: ${leverage}x MAX`;
    copyToClipboard(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.(ticker);
  };

  return (
    <div style={{
      background:"#060a13",
      border:`1px solid #1a2235`,
      borderLeft:`4px solid ${borderColor}`,
      borderRadius:10,
      overflow:"hidden",
      transition:"opacity 0.3s ease",
      fontFamily:mono,
    }}>
      {/* CARD HEADER */}
      <div style={{ padding:"14px 14px 10px", background:"rgba(255,255,255,0.02)" }}>
        {/* Rank + Asset + Direction + Market */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:18 }}>{MEDALS[rank] || "🎖"}</span>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:14, fontWeight:900, color:"#e8e8f0" }}>#{rank+1}</span>
                <span style={{ fontSize:14, fontWeight:900, color:"#e8e8f0" }}>·</span>
                <span style={{ fontSize:14, fontWeight:900, color:"#e8e8f0" }}>{ticker} / USDT</span>
              </div>
              <div style={{ fontSize:8, color:"#6b7a99", marginTop:1 }}>{assetMeta.name}</div>
            </div>
          </div>
          <div style={{ textAlign:"right", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{
              fontSize:11, fontWeight:900, color:borderColor,
              background:`${borderColor}15`, border:`1px solid ${borderColor}40`,
              borderRadius:5, padding:"3px 8px",
            }}>{dirLabel}</span>
            <span style={{ fontSize:9, color:"#6b7a99", background:"rgba(255,255,255,0.05)", borderRadius:4, padding:"2px 6px" }}>[{market}]</span>
          </div>
        </div>

        {/* Conviction bar + tier */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:8, color:"#6b7a99" }}>Conviction</span>
              <span style={{ fontSize:9, fontWeight:800, color:barColor }}>{winProb}/100</span>
            </div>
            <div style={{ height:6, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
              <div style={{
                height:"100%", width:`${winProb}%`,
                background:winProb>85?`linear-gradient(90deg,${barColor}80,${barColor})`:`${barColor}`,
                borderRadius:3, transition:"width 1.2s ease",
                boxShadow:winProb>85?`0 0 8px ${barColor}80`:"none",
              }}/>
            </div>
          </div>
          {tierKey && (
            <div style={{
              fontSize:16, fontWeight:900, color:tierCfg.color,
              background:tierCfg.bg, border:`2px solid ${tierCfg.border}`,
              borderRadius:7, width:36, height:36,
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:tierCfg.glow?`0 0 14px ${tierCfg.color}60`:"none",
            }}>{tierKey}</div>
          )}
        </div>
        <div style={{ fontSize:7, color:"#3a4560", marginTop:4 }}>
          Tier {tierKey}: {tierKey==="S"?"90–100 · Gold Signal":tierKey==="A"?"80–89 · High Conviction":tierKey==="B"?"70–79 · Strong Setup":"60–69 · Moderate Setup"}
        </div>
      </div>

      {/* PRICE ACTION GRID */}
      {entry && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:0 }}>
          {/* ENTRY */}
          <div style={{ padding:"10px 10px", borderBottom:"1px solid #1a2235", borderRight:"1px solid #1a2235" }}>
            <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>ENTRY</div>
            <div style={{ fontSize:13, fontWeight:900, color:"#d4af37", fontFamily:mono }}>{fmtPrice(entry)}</div>
            {result.entry?.zone_low && (
              <div style={{ fontSize:7, color:"#3a4560", marginTop:2 }}>{fmtPrice(result.entry.zone_low)}–{fmtPrice(result.entry.zone_high)}</div>
            )}
          </div>
          {/* TP1 */}
          <div style={{ padding:"10px 10px", background:"rgba(0,255,136,0.06)", borderBottom:"1px solid #1a2235", borderRight:"1px solid #1a2235" }}>
            <div style={{ fontSize:7, color:"#3a4560", letterSpacing:0.5, marginBottom:2 }}>Conservative Exit</div>
            <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>TP1 🎯</div>
            <div style={{ fontSize:13, fontWeight:900, color:"#00ff88", fontFamily:mono }}>{fmtPrice(tp1)}</div>
            {tp1Pct != null && <div style={{ fontSize:8, color:"#4ade80", marginTop:2 }}>{fmtPct(tp1Pct)}</div>}
          </div>
          {/* TP2 */}
          <div style={{ padding:"10px 10px", background:"rgba(0,255,136,0.04)", borderBottom:"1px solid #1a2235", borderRight:"1px solid #1a2235" }}>
            <div style={{ fontSize:7, color:"#3a4560", letterSpacing:0.5, marginBottom:2 }}>Full Target</div>
            <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>TP2 🎯</div>
            <div style={{ fontSize:13, fontWeight:900, color:"#4ade80", fontFamily:mono }}>{tp2 ? fmtPrice(tp2) : "—"}</div>
            {tp2Pct != null && <div style={{ fontSize:8, color:"#4ade80", marginTop:2 }}>{fmtPct(tp2Pct)}</div>}
          </div>
          {/* SL */}
          <div style={{ padding:"10px 10px", background:"rgba(255,45,85,0.06)", borderBottom:"1px solid #1a2235" }}>
            <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>SL 🛑</div>
            <div style={{ fontSize:13, fontWeight:900, color:"#ff2d55", fontFamily:mono }}>{fmtPrice(sl)}</div>
            {slPct != null && <div style={{ fontSize:8, color:"#f87171", marginTop:2 }}>{fmtPct(slPct)}</div>}
          </div>
        </div>
      )}

      {/* TRADE PARAMETERS ROW */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:0, borderBottom:"1px solid #1a2235" }}>
        <div style={{ padding:"10px", borderRight:"1px solid #1a2235", textAlign:"center" }}>
          <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:5 }}>LEVERAGE</div>
          <div style={{ fontSize:16, fontWeight:900, color:"#e8e8f0", fontFamily:mono }}>{leverage}x</div>
          <div style={{ fontSize:7, color:"#3a4560", marginTop:2 }}>MAX</div>
        </div>
        <div style={{ padding:"10px", borderRight:"1px solid #1a2235", textAlign:"center" }}>
          <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:5 }}>RISK/REWARD</div>
          <div style={{ fontSize:16, fontWeight:900, color:rrColor, fontFamily:mono }}>{rr ? `${rr.toFixed(2)} : 1` : "—"}</div>
          <div style={{ fontSize:7, color:"#3a4560", marginTop:2 }}>{rr>=2.5?"EXCELLENT":rr>=2.0?"GOOD":"CHECK"}</div>
        </div>
        <div style={{ padding:"10px", textAlign:"center" }}>
          <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:5 }}>DURATION</div>
          <div style={{ fontSize:11, fontWeight:800, color:"#00e5ff", fontFamily:mono, lineHeight:1.3 }}>{duration}</div>
        </div>
      </div>

      {/* WHY THIS TRADE (collapsible edge factors) */}
      <div style={{ borderBottom:"1px solid #1a2235" }}>
        <button
          onClick={() => setEdgeExpanded(e => !e)}
          style={{ width:"100%", background:"transparent", border:"none", padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}
        >
          <span style={{ fontSize:9, color:"#d4af37", fontWeight:700, letterSpacing:1, fontFamily:mono }}>📊 EDGE FACTORS</span>
          <span style={{ fontSize:10, color:"#3a4560" }}>{edgeExpanded?"▾":"▸"}</span>
        </button>
        {edgeExpanded && (
          <div style={{ padding:"4px 14px 12px" }}>
            {edgeGreen.length > 0 && edgeGreen.map((f,i) => (
              <div key={i} style={{ fontSize:9, color:"#4ade80", marginBottom:5, lineHeight:1.5 }}>✅ {f}</div>
            ))}
            {edgeAmber.length > 0 && edgeAmber.map((f,i) => (
              <div key={i} style={{ fontSize:9, color:"#f59e0b", marginBottom:5, lineHeight:1.5 }}>⚠️ {f}</div>
            ))}
            {edgeGreen.length === 0 && edgeAmber.length === 0 && (
              <div style={{ fontSize:8, color:"#3a4560" }}>Analysis complete — see quant rationale below</div>
            )}
            {result.quant_rationale && (
              <div style={{ fontSize:10, color:"#a0aec0", marginTop:8, lineHeight:1.7, borderTop:"1px solid #1a2235", paddingTop:8, fontFamily:"'Barlow', sans-serif", fontStyle:"italic" }}>
                {result.quant_rationale}
              </div>
            )}
          </div>
        )}
      </div>

      {/* INVALIDATION ROW */}
      {result.invalidation && (
        <div style={{ padding:"8px 14px", borderBottom:"1px solid #1a2235", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span style={{ fontSize:12, flexShrink:0 }}>❌</span>
          <div>
            <span style={{ fontSize:8, color:"#f87171", fontFamily:mono, fontWeight:700 }}>INVALIDATION</span>
            <div style={{ fontSize:10, color:"#f87171", fontFamily:"'Barlow', sans-serif", lineHeight:1.6, marginTop:2 }}>{result.invalidation}</div>
          </div>
        </div>
      )}

      {/* ADVANCED DETAILS TOGGLE */}
      <div style={{ borderBottom:"1px solid #1a2235" }}>
        <button
          onClick={() => setDetailExpanded(d => !d)}
          style={{ width:"100%", background:"transparent", border:"none", padding:"7px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}
        >
          <span style={{ fontSize:8, color:"#3a4560", fontFamily:mono }}>Advanced Quant Detail</span>
          <span style={{ fontSize:9, color:"#3a4560" }}>{detailExpanded?"▾":"▸"}</span>
        </button>
        {detailExpanded && (
          <div style={{ padding:"0 12px 12px" }}>
            {result.bayesian && <BayesianMeter probability={result.bayesian.probability} tier={result.conviction_tier||result.bayesian.tier} interpretation={result.bayesian.interpretation}/>}
            {result.multi_tf && <MultiTFStrip multiTf={result.multi_tf}/>}
            <FearGreedPanel fng={result.fear_greed}/>
            <PatternPanel patterns={result.patterns}/>
            {result.indicators && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                {[
                  { label:"RSI(14)", value:`${result.indicators.rsi} · ${result.indicators.rsiLabel}`, color:result.indicators.rsi>60?"#00ff88":result.indicators.rsi<40?"#ff2d55":"#f59e0b" },
                  { label:"MACD", value:result.indicators.macdCrossing, color:result.indicators.macdCrossing?.includes("BULL")?"#00ff88":"#ff2d55" },
                  { label:"TREND", value:result.indicators.trend, color:result.indicators.trend?.includes("UP")?"#00ff88":result.indicators.trend?.includes("DOWN")?"#ff2d55":"#f59e0b" },
                  { label:"ATR", value:`${result.indicators.atrPct?.toFixed(2)}%`, color:"#6b7a99" },
                  { label:"VOLUME", value:result.indicators.volumeSignal, color:result.indicators.volumeSignal==="SURGE"?"#00ff88":"#6b7a99" },
                  { label:"MOMENTUM", value:`${result.indicators.momentumScore}/100`, color:result.indicators.momentumScore>60?"#00ff88":result.indicators.momentumScore<40?"#ff2d55":"#f59e0b" },
                ].map(({ label, value, color }) => (
                  <StatBox key={label} label={label} value={value||"—"} color={color}/>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ACTION BUTTONS */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:0 }}>
        <button
          onClick={handleCopy}
          data-testid={`btn-copy-${ticker}`}
          style={{ padding:"11px 8px", background:"transparent", border:"none", borderRight:"1px solid #1a2235", color:copied?"#00ff88":"#6b7a99", cursor:"pointer", fontFamily:mono, fontSize:8, fontWeight:700, letterSpacing:0.5 }}
        >
          {copied ? "✓ COPIED!" : "📋 COPY TRADE"}
        </button>
        <button
          onClick={() => onSetAlert?.(ticker, entry)}
          data-testid={`btn-alert-${ticker}`}
          style={{ padding:"11px 8px", background:"transparent", border:"none", borderRight:"1px solid #1a2235", color:"#d4af37", cursor:"pointer", fontFamily:mono, fontSize:8, fontWeight:700, letterSpacing:0.5 }}
        >
          ⏰ SET ALERT
        </button>
        <button
          onClick={handleDismiss}
          data-testid={`btn-dismiss-${ticker}`}
          style={{ padding:"11px 8px", background:"transparent", border:"none", color:"#3a4560", cursor:"pointer", fontFamily:mono, fontSize:8, letterSpacing:0.5 }}
        >
          ✕ DISMISS
        </button>
      </div>
    </div>
  );
}

// ─── NEW: No Signals State ────────────────────────────────────────────────────
function NoSignalsState({ nextTime }) {
  return (
    <div style={{ textAlign:"center", padding:"40px 20px", background:"rgba(255,45,85,0.04)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:12 }}>
      <div style={{ fontSize:36, marginBottom:12 }}>⛔</div>
      <div style={{ fontSize:13, fontWeight:800, color:"#ff2d55", marginBottom:10, fontFamily:mono }}>NO HIGH-CONVICTION SETUPS FOUND</div>
      <div style={{ fontSize:10, color:"#6b7a99", lineHeight:1.7, maxWidth:380, margin:"0 auto" }}>
        Macro conditions, low regime score, or R/R below 2:1 prevented signal generation for all selected assets.
        {nextTime && <> Check back at <strong style={{ color:"#d4af37" }}>{nextTime}</strong>.</>}
      </div>
    </div>
  );
}

// ─── Suppressed signal mini-panel ─────────────────────────────────────────────
function SuppressedCard({ ticker, result }) {
  return (
    <div style={{ background:"rgba(255,45,85,0.04)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:8, padding:"10px 14px", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:10, fontWeight:900, color:"#ff2d55", fontFamily:mono }}>🛑 {ticker}</span>
          <span style={{ fontSize:8, color:"#f87171" }}>SUPPRESSED</span>
        </div>
        <div style={{ fontSize:8, color:"#6b7a99" }}>{result.win_probability}% conviction</div>
      </div>
      {result.suppression_message && (
        <div style={{ fontSize:8, color:"#6b7a99", marginTop:5, lineHeight:1.5 }}>{result.suppression_message}</div>
      )}
      {result.suppression_rules?.length > 0 && (
        <div style={{ marginTop:5, display:"flex", flexWrap:"wrap", gap:4 }}>
          {result.suppression_rules.slice(0,3).map((r,i) => (
            <span key={i} style={{ fontSize:7, color:"#ff2d55", background:"rgba(255,45,85,0.08)", borderRadius:3, padding:"2px 6px", fontFamily:mono }}>
              R{r.id}: {r.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function AITab() {
  const [selectedAssets, setSelectedAssets] = useState(["BTC"]);
  const [market,   setMarket]  = useState("PERP");
  const [risk,     setRisk]    = useState("mid");
  const [tf,       setTf]      = useState("today");
  const [query,    setQuery]   = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]); // [{ticker, result, error}]
  const [scanProgress, setScanProgress] = useState({ done:0, total:0 });
  const [step,     setStep]    = useState("");
  const stepIdx   = useRef(0);

  const twitterData = useTwitterIntelligence();
  const { regime, killSwitch, macroEvents, prices, funding, oi, fearGreed } = useDataBus();

  // Crash probability from regime data
  const crashProb = Math.round((100 - (regime?.score||50)) * 0.8);

  const toggleAsset = useCallback((ticker) => {
    setSelectedAssets(prev => {
      if (prev.includes(ticker)) return prev.filter(t => t !== ticker);
      if (prev.length >= 5) return prev;
      return [...prev, ticker];
    });
  }, []);

  const clearAllAssets = () => setSelectedAssets([]);
  const selectTop5 = () => setSelectedAssets(TOP_5_BY_VOLUME.slice());

  const runQuantScan = async () => {
    if (selectedAssets.length === 0) return;
    setScanning(true);
    setScanResults([]);
    setScanProgress({ done:0, total:selectedAssets.length });

    const collected = [];

    for (let i = 0; i < selectedAssets.length; i++) {
      const ticker = selectedAssets[i];
      const meta = getAssetMeta(ticker);
      const assetMarket = (meta.cat !== "CRYPTO") ? "SPOT" : market;

      stepIdx.current = 0;
      setStep(`Analyzing ${ticker}…`);

      try {
        const twitterCtx = buildAssetTwitterContext(twitterData, ticker);

        const response = await fetch("/api/quant", {
          method:  "POST",
          headers: { "Content-Type":"application/json" },
          credentials: "include",
          body: JSON.stringify({
            ticker,
            marketType:     assetMarket,
            userQuery:      query,
            riskId:         risk,
            timeframeId:    tf,
            assetClass:     ASSET_CLASS(ticker),
            twitterContext: twitterCtx,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Analysis failed (${response.status})`);
        }

        const data = await response.json();

        // Compute RR if not provided
        if (data.signal !== "SUPPRESSED" && !data.rr && data.entry?.price && data.tp1?.price && data.stopLoss?.price) {
          const r = Math.abs(data.entry.price - data.stopLoss.price);
          const w = Math.abs(data.tp1.price - data.entry.price);
          data.rr = r > 0.000001 ? w / r : 0;
        }

        // Store market type used in the result
        data.market_type = assetMarket;

        collected.push({ ticker, result:data, error:null, fundingRate: funding[ticker]||0 });
      } catch (err) {
        collected.push({ ticker, result:null, error:err.message });
      }

      setScanProgress({ done:i+1, total:selectedAssets.length });
    }

    setScanning(false);
    setStep("");
    setScanResults(collected);
  };

  const profile = RISK_PROFILES[risk];

  // Split results into qualifying signals vs suppressed/errors
  const qualifyingSignals = scanResults.filter(r =>
    r.result &&
    r.result.signal !== "SUPPRESSED" &&
    r.result.signal &&
    r.result.entry?.price &&
    (r.result.rr == null || r.result.rr >= 1.3)
  ).sort((a,b) => (b.result.win_probability||0) - (a.result.win_probability||0));

  const suppressedResults = scanResults.filter(r =>
    r.result && r.result.signal === "SUPPRESSED"
  );

  const errorResults = scanResults.filter(r => r.error);

  const hasScanDone = scanResults.length > 0 && !scanning;
  const displayCards = qualifyingSignals.slice(0, 3);

  return (
    <div style={{ backgroundColor:"#060a13", minHeight:"100vh", padding:"20px 16px", fontFamily:mono, color:"#e8e8f0" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #1a2235", paddingBottom:15, marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontFamily:serif, color:"#e8e8f0" }}>CLVRQuant AI</h2>
          <div style={{ fontSize:7, color:"#3a4560", letterSpacing:1.5, marginTop:3 }}>
            MASTERBRAIN · BAYESIAN SCORING · MULTI-TF CONFLUENCE · MACRO KILL SWITCH
          </div>
        </div>
        <div style={{ border:"1px solid #d4af37", color:"#d4af37", padding:"5px 12px", borderRadius:4, fontSize:11, fontWeight:"bold", letterSpacing:1 }}>
          CLVR AI · SECURE
        </div>
      </div>

      {/* ── STEP 1: RISK PROFILE ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 1 — RISK PROFILE</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {Object.values(RISK_PROFILES).map(p => {
            const active = risk === p.id;
            return (
              <div key={p.id} onClick={() => setRisk(p.id)} data-testid={`btn-risk-${p.id}`} style={{
                background: active ? `rgba(${p.hex},0.1)` : "rgba(255,255,255,0.02)",
                border:`2px solid ${active ? p.color : "#1a2235"}`,
                borderRadius:12, padding:"12px 10px", cursor:"pointer",
                transition:"all 0.2s", textAlign:"center",
              }}>
                <div style={{ fontSize:20, marginBottom:5 }}>{p.icon}</div>
                <div style={{ fontSize:9, fontWeight:800, color:active?p.color:"#6b7a99", letterSpacing:1, marginBottom:5 }}>{p.label}</div>
                <div style={{ fontSize:7, color:"#3a4560", lineHeight:1.6 }}>{p.desc}</div>
                {active && <div style={{ marginTop:7, fontSize:7, color:p.color }}>SL {p.slMultiplier}×ATR · {p.leverage[0]}–{p.leverage[1]}x · {p.riskPct}% risk</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── STEP 2: ASSET BROWSER ── */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>
          ◆ STEP 2 — SELECT ASSETS
          <span style={{ color:"#3a4560", marginLeft:8, fontSize:7 }}>Choose 1–5 to scan simultaneously</span>
        </div>
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:12, padding:"14px" }}>
          <AssetBrowser
            selected={selectedAssets}
            onToggle={toggleAsset}
            onClearAll={clearAllAssets}
            onSelectTop5={selectTop5}
            prices={prices}
            funding={funding}
            oi={oi}
          />
          {/* Selected strip */}
          {selectedAssets.length > 0 && (
            <div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid #1a2235", display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
              <span style={{ fontSize:7, color:"#3a4560" }}>QUEUED FOR SCAN:</span>
              {selectedAssets.map(t => {
                const meta = getAssetMeta(t);
                const col  = CAT_COLORS[meta.cat] || "#6b7a99";
                return (
                  <span key={t} style={{ fontSize:9, fontWeight:800, color:col, background:`${col}15`, border:`1px solid ${col}30`, borderRadius:4, padding:"3px 8px", fontFamily:mono }}>
                    {t}
                    <button onClick={() => toggleAsset(t)} style={{ background:"none", border:"none", color:col, cursor:"pointer", marginLeft:5, fontSize:10, padding:0 }}>×</button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── STEP 3: PERP / SPOT (for crypto assets) ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <button onClick={() => setMarket("PERP")} data-testid="button-market-perp" style={{
          background: market==="PERP" ? "rgba(0,229,255,0.1)" : "transparent",
          border:`1px solid ${market==="PERP" ? "#00e5ff" : "#1a2235"}`,
          color: market==="PERP" ? "#00e5ff" : "#6b7a99",
          padding:12, borderRadius:6, cursor:"pointer", fontWeight:"bold", fontSize:12, fontFamily:mono,
        }}>📊 PERP Markets</button>
        <button onClick={() => setMarket("SPOT")} data-testid="button-market-spot" style={{
          background: market==="SPOT" ? "rgba(255,255,255,0.05)" : "transparent",
          border:`1px solid ${market==="SPOT" ? "#fff" : "#1a2235"}`,
          color: market==="SPOT" ? "#fff" : "#6b7a99",
          padding:12, borderRadius:6, cursor:"pointer", fontWeight:"bold", fontSize:12, fontFamily:mono,
        }}>📈 SPOT Markets</button>
      </div>
      <div style={{ fontSize:7, color:"#3a4560", marginBottom:16, textAlign:"center" }}>
        Equities, FX, Commodities &amp; Indices always use SPOT · Market type applies to crypto only
      </div>

      {/* ── STEP 4: TIMEFRAME ── */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 3 — TIME HORIZON</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {Object.values(TIMEFRAMES).map(t => {
            const active = tf === t.id;
            return (
              <button key={t.id} onClick={() => setTf(t.id)} data-testid={`button-tf-${t.id}`} style={{
                background: active ? "rgba(0,255,136,0.08)" : "transparent",
                border:`1px solid ${active ? "#00ff88" : "#1a2235"}`,
                color: active ? "#00ff88" : "#6b7a99",
                padding:"11px 8px", borderRadius:6, cursor:"pointer", fontSize:10, fontFamily:mono,
              }}>
                <div style={{ fontWeight:"bold", marginBottom:3 }}>{t.label}</div>
                <div style={{ fontSize:8, opacity:0.7 }}>{t.sublabel}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CUSTOM PROMPT ── */}
      <textarea
        placeholder={`Optional: "Focus on funding rate anomalies" · "Short bias only" · "Ignore memecoins"`}
        value={query}
        onChange={e => setQuery(e.target.value)}
        data-testid="input-custom-query"
        style={{
          width:"100%", background:"#0d1321", border:"1px solid #1a2235",
          borderRadius:8, padding:15, color:"#e8e8f0", fontFamily:mono,
          fontSize:14, height:80, resize:"none", marginBottom:16,
          boxSizing:"border-box", outline:"none",
        }}
      />

      {/* Twitter badge */}
      {twitterData.hasKey && !twitterData.loading && (
        <div style={{ marginBottom:16, display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:8, padding:"8px 12px" }}>
          <span style={{ fontSize:12 }}>𝕏</span>
          <span style={{ fontSize:9, color:"#6b7a99" }}>Twitter intelligence active ·</span>
          <span style={{ fontSize:9, fontWeight:700, color:twitterData.sentiment.score>55?"#00ff88":twitterData.sentiment.score<45?"#ff2d55":"#f59e0b" }}>
            {twitterData.sentiment.label} ({twitterData.sentiment.score}%)
          </span>
          <span style={{ fontSize:8, color:"#2a3550", marginLeft:"auto" }}>feeds AI automatically</span>
        </div>
      )}

      {/* MasterBrain capability overview (shown only before any scan) */}
      {!hasScanDone && !scanning && (
        <div style={{ marginBottom:16, background:"rgba(212,175,55,0.03)", border:"1px solid #1a2235", borderRadius:10, padding:"12px 14px" }}>
          <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:8, fontWeight:700 }}>◆ MASTERBRAIN ENGINES</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { icon:"🔀", label:"Multi-TF Confluence",      desc:"15m · 1h · 4h · 1d EMA9/EMA21 trend alignment" },
              { icon:"🎯", label:"Bayesian Scoring",         desc:"9 weighted signals · A/B/C/D conviction tiers" },
              { icon:"📊", label:"Pattern Recognition",      desc:"Head & Shoulders · Bull Flag · Pivot analysis" },
              { icon:"😱", label:"Fear & Greed Index",       desc:"Crypto sentiment · Contrarian signal detection" },
              { icon:"🛡", label:"Macro Kill Switch",        desc:"Halts near HIGH impact events within 4h" },
              { icon:"🚫", label:"Signal Suppression Rules", desc:"6-rule engine: macro · trend · drawdown · support · NY open · kill switch" },
              { icon:"🤖", label:"CLVR AI (Claude)",         desc:"HL · Binance · Finnhub · claude-sonnet-4-6" },
              { icon:"🏆", label:"R/R Hard Filter",          desc:"Min 2:1 R/R required · S/A/B/C conviction tiers" },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize:8, fontWeight:700, color:"#a0aec0", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:7, color:"#3a4560", lineHeight:1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kronos Forecast Engine */}
      <KronosPanel defaultAsset={selectedAssets[0] || "BTC"} />

      {/* ── EXECUTE SCAN BUTTON ── */}
      <button
        onClick={runQuantScan}
        disabled={scanning || selectedAssets.length === 0}
        data-testid="button-quant-analyze"
        style={{
          width:"100%",
          background: scanning ? "#0d1321" : `rgba(${profile.hex},0.08)`,
          border:`1px solid ${scanning ? "#1a2235" : profile.color}`,
          color: scanning ? "#6b7a99" : profile.color,
          padding:16, borderRadius:8, fontSize:15,
          fontFamily:serif, fontStyle:"italic",
          cursor: (scanning || selectedAssets.length === 0) ? "not-allowed" : "pointer",
          marginBottom:20, transition:"all 0.2s",
          letterSpacing:0.5,
          boxShadow: scanning ? "none" : `0 0 20px rgba(${profile.hex},0.15)`,
        }}
      >
        {scanning
          ? `⟳ ${step || "Routing to Quant Engine..."}`
          : selectedAssets.length === 0
          ? "← Select 1–5 assets to scan"
          : `${profile.icon} Execute MasterBrain Scan · ${selectedAssets.length} Asset${selectedAssets.length>1?"s":""} →`
        }
      </button>

      {/* ── LOADING ── */}
      {scanning && <LoadingBrain step={step} progress={scanProgress}/>}

      {/* ── SCAN RESULTS ── */}
      {hasScanDone && (
        <div style={{ animation:"fadeIn 0.5s ease" }}>

          {/* Scan Summary Banner */}
          <ScanSummaryBanner
            scanned={scanResults.length}
            found={qualifyingSignals.length}
            regime={regime}
            crashProb={crashProb}
            scanResults={scanResults}
            killSwitch={killSwitch}
            macroEvents={macroEvents}
          />

          {/* Signal Cards (3 side by side on desktop, stacked on mobile) */}
          {displayCards.length > 0 ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap:16, marginBottom:20 }}>
              {displayCards.map((item, idx) => (
                <SignalCard
                  key={item.ticker}
                  rank={idx}
                  ticker={item.ticker}
                  result={item.result}
                />
              ))}
            </div>
          ) : (
            <NoSignalsState />
          )}

          {/* Suppressed signals (collapsed list) */}
          {suppressedResults.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:8, color:"#ff2d55", letterSpacing:2, marginBottom:8, fontWeight:700 }}>🛑 SUPPRESSED SIGNALS ({suppressedResults.length})</div>
              {suppressedResults.map(r => (
                <SuppressedCard key={r.ticker} ticker={r.ticker} result={r.result}/>
              ))}
            </div>
          )}

          {/* Errors */}
          {errorResults.length > 0 && (
            <div style={{ marginBottom:16 }}>
              {errorResults.map(r => (
                <div key={r.ticker} style={{ background:"rgba(255,45,85,0.06)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:6, padding:"8px 12px", marginBottom:6, fontSize:8, color:"#f87171", fontFamily:mono }}>
                  ⚠ {r.ticker}: {r.error}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize:8, color:"#1a2235", textAlign:"center", lineHeight:1.8 }}>
            © 2025 CLVRQuant · Mike Claver™ · Not financial advice · For informational purposes only
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        textarea:focus { border-color: rgba(212,175,55,0.4) !important; outline: none; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#060a13; }
        ::-webkit-scrollbar-thumb { background:#1a2235; border-radius:2px; }
      `}</style>
    </div>
  );
}
