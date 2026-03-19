// ─────────────────────────────────────────────────────────────────────────────
// MarketDataStore.js  —  CLVRQuant AI · Master Data Backbone
//
// Single source of truth for ALL market data. Every tab imports useMarketData().
// No tab fetches its own prices.
//
// DATA STREAMS:
//   PERPS  → Hyperliquid (dynamic discovery — all dexes)
//   SPOT   → Backend proxy → Finnhub (primary) / Yahoo Finance (fallback)
//
// ABSOLUTE DATA RULES:
//   • markPx === 0   → skip asset entirely, never render
//   • Price missing  → show "—", never show fake numbers
//   • Every price carries a source label
//   • AI signals blocked if live price is missing
//   • Stale data (>60s) flagged
//
// Refreshes every 15 seconds. One fetch cycle serves all consumers.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

const HL_API        = "https://api.hyperliquid.xyz/info";
const REFRESH_MS    = 15_000;
const STALE_MS      = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// ASSET METADATA LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
const ASSET_META_LIB = {
  // ── CRYPTO (default dex) ────────────────────────────────────────────────
  BTC:      { name:"Bitcoin",             icon:"₿",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  ETH:      { name:"Ethereum",            icon:"Ξ",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  SOL:      { name:"Solana",              icon:"◎",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  AVAX:     { name:"Avalanche",           icon:"▲",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  ARB:      { name:"Arbitrum",            icon:"🔵", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  WIF:      { name:"dogwifhat",           icon:"🐕", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  DOGE:     { name:"Dogecoin",            icon:"Ð",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  BONK:     { name:"Bonk",               icon:"🔨", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  SUI:      { name:"Sui",                icon:"💧", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  PEPE:     { name:"Pepe",               icon:"🐸", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  INJ:      { name:"Injective",           icon:"🔷", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  TIA:      { name:"Celestia",            icon:"🌌", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  SEI:      { name:"Sei",                icon:"🔴", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  APT:      { name:"Aptos",              icon:"🌀", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  JTO:      { name:"Jito",               icon:"⚡", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  OP:       { name:"Optimism",            icon:"🔴", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  LINK:     { name:"Chainlink",           icon:"🔗", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  ATOM:     { name:"Cosmos",              icon:"⚛",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  DOT:      { name:"Polkadot",            icon:"⚫", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  MATIC:    { name:"Polygon",             icon:"🔷", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  UNI:      { name:"Uniswap",             icon:"🦄", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  AAVE:     { name:"Aave",               icon:"👻", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  LTC:      { name:"Litecoin",            icon:"Ł",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  XRP:      { name:"XRP",                icon:"◈",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  ADA:      { name:"Cardano",             icon:"₳",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  HYPE:     { name:"Hyperliquid",         icon:"⚡", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  NEAR:     { name:"NEAR Protocol",       icon:"Ⓝ",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  FTM:      { name:"Fantom",              icon:"👻", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  MKR:      { name:"Maker",              icon:"⬡",  spotSymbol:null,              yahoo:null,           dex:"crypto" },
  SNX:      { name:"Synthetix",           icon:"🔵", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  CRV:      { name:"Curve",              icon:"🔵", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  BNB:      { name:"BNB",                icon:"🔶", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  TRUMP:    { name:"Official Trump",      icon:"🇺🇸", spotSymbol:null,              yahoo:null,           dex:"crypto" },
  // ── EQUITIES (xyz dex) ──────────────────────────────────────────────────
  NVDA:     { name:"Nvidia",              icon:"🟢", spotSymbol:"NVDA",            yahoo:"NVDA",         dex:"xyz" },
  TSLA:     { name:"Tesla",               icon:"⚡", spotSymbol:"TSLA",            yahoo:"TSLA",         dex:"xyz" },
  AAPL:     { name:"Apple",               icon:"🍎", spotSymbol:"AAPL",            yahoo:"AAPL",         dex:"xyz" },
  MSFT:     { name:"Microsoft",           icon:"🪟", spotSymbol:"MSFT",            yahoo:"MSFT",         dex:"xyz" },
  META:     { name:"Meta Platforms",      icon:"👤", spotSymbol:"META",            yahoo:"META",         dex:"xyz" },
  AMZN:     { name:"Amazon",              icon:"📦", spotSymbol:"AMZN",            yahoo:"AMZN",         dex:"xyz" },
  GOOGL:    { name:"Alphabet",            icon:"🔍", spotSymbol:"GOOGL",           yahoo:"GOOGL",        dex:"xyz" },
  AMD:      { name:"AMD",                icon:"🔴", spotSymbol:"AMD",             yahoo:"AMD",          dex:"xyz" },
  INTC:     { name:"Intel",              icon:"💻", spotSymbol:"INTC",            yahoo:"INTC",         dex:"xyz" },
  MU:       { name:"Micron Technology",   icon:"💾", spotSymbol:"MU",              yahoo:"MU",           dex:"xyz" },
  ORCL:     { name:"Oracle",              icon:"🔴", spotSymbol:"ORCL",            yahoo:"ORCL",         dex:"xyz" },
  SNDK:     { name:"SanDisk",             icon:"💿", spotSymbol:"SNDK",            yahoo:"SNDK",         dex:"xyz" },
  COIN:     { name:"Coinbase",            icon:"🔵", spotSymbol:"COIN",            yahoo:"COIN",         dex:"xyz" },
  MSTR:     { name:"MicroStrategy",       icon:"₿",  spotSymbol:"MSTR",            yahoo:"MSTR",         dex:"xyz" },
  HOOD:     { name:"Robinhood",           icon:"🏹", spotSymbol:"HOOD",            yahoo:"HOOD",         dex:"xyz" },
  CRCL:     { name:"Circle Internet",     icon:"⭕", spotSymbol:"CRCL",            yahoo:"CRCL",         dex:"xyz" },
  SBET:     { name:"SharpLink Gaming",    icon:"🎮", spotSymbol:"SBET",            yahoo:"SBET",         dex:"xyz" },
  CRWV:     { name:"CoreWeave",           icon:"☁",  spotSymbol:"CRWV",            yahoo:"CRWV",         dex:"xyz" },
  PLTR:     { name:"Palantir",            icon:"🔮", spotSymbol:"PLTR",            yahoo:"PLTR",         dex:"xyz" },
  NFLX:     { name:"Netflix",             icon:"🎬", spotSymbol:"NFLX",            yahoo:"NFLX",         dex:"xyz" },
  RIVN:     { name:"Rivian",              icon:"🚗", spotSymbol:"RIVN",            yahoo:"RIVN",         dex:"xyz" },
  USAR:     { name:"US Arms (ETF)",       icon:"🏔", spotSymbol:"USAR",            yahoo:"USAR",         dex:"xyz" },
  SKHX:     { name:"SkyHarbour Group",    icon:"✈",  spotSymbol:"SKYH",            yahoo:"SKYH",         dex:"xyz" },
  BABA:     { name:"Alibaba",             icon:"🛒", spotSymbol:"BABA",            yahoo:"BABA",         dex:"xyz" },
  TSM:      { name:"TSMC",               icon:"🇹🇼", spotSymbol:"TSM",             yahoo:"TSM",          dex:"xyz" },
  SMSN:     { name:"Samsung Electronics", icon:"📱", spotSymbol:null,              yahoo:"005930.KS",    dex:"xyz" },
  HYUNDAI:  { name:"Hyundai Motor",       icon:"🚘", spotSymbol:null,              yahoo:"005380.KS",    dex:"xyz" },
  EWY:      { name:"iShares MSCI S.Korea",icon:"🇰🇷", spotSymbol:"EWY",            yahoo:"EWY",          dex:"xyz" },
  EWJ:      { name:"iShares MSCI Japan",  icon:"🇯🇵", spotSymbol:"EWJ",            yahoo:"EWJ",          dex:"xyz" },
  XYZ100:   { name:"Nasdaq 100",          icon:"📊", spotSymbol:"QQQ",             yahoo:"QQQ",          dex:"xyz" },
  SP500:    { name:"S&P 500",             icon:"📈", spotSymbol:"SPY",             yahoo:"SPY",          dex:"xyz" },
  SPX500:   { name:"S&P 500",             icon:"📈", spotSymbol:"SPY",             yahoo:"SPY",          dex:"xyz" },
  // ── COMMODITIES (flx dex) ───────────────────────────────────────────────
  GOLD:     { name:"Gold",                icon:"🥇", spotSymbol:"OANDA:XAU_USD",   yahoo:"GC=F",         dex:"flx" },
  XAU:      { name:"Gold",                icon:"🥇", spotSymbol:"OANDA:XAU_USD",   yahoo:"GC=F",         dex:"flx" },
  SILVER:   { name:"Silver",              icon:"🥈", spotSymbol:"OANDA:XAG_USD",   yahoo:"SI=F",         dex:"flx" },
  XAG:      { name:"Silver",              icon:"🥈", spotSymbol:"OANDA:XAG_USD",   yahoo:"SI=F",         dex:"flx" },
  PLATINUM: { name:"Platinum",            icon:"⬜", spotSymbol:"OANDA:XPT_USD",   yahoo:"PL=F",         dex:"flx" },
  PALLADIUM:{ name:"Palladium",           icon:"🔘", spotSymbol:"OANDA:XPD_USD",   yahoo:"PA=F",         dex:"flx" },
  CL:       { name:"WTI Crude Oil",       icon:"🛢",  spotSymbol:"NYMEX:CL1!",      yahoo:"CL=F",         dex:"flx" },
  OIL:      { name:"WTI Crude Oil",       icon:"🛢",  spotSymbol:"NYMEX:CL1!",      yahoo:"CL=F",         dex:"flx" },
  BRENTOIL: { name:"Brent Crude Oil",     icon:"⛽", spotSymbol:"NYMEX:BB1!",      yahoo:"BZ=F",         dex:"flx" },
  BRENT:    { name:"Brent Crude Oil",     icon:"⛽", spotSymbol:"NYMEX:BB1!",      yahoo:"BZ=F",         dex:"flx" },
  NATGAS:   { name:"Natural Gas",         icon:"🔥", spotSymbol:"NYMEX:NG1!",      yahoo:"NG=F",         dex:"flx" },
  COPPER:   { name:"Copper",              icon:"🟤", spotSymbol:"NYMEX:HG1!",      yahoo:"HG=F",         dex:"flx" },
  URNM:     { name:"Uranium ETF (URNM)",  icon:"☢",  spotSymbol:"URNM",            yahoo:"URNM",         dex:"flx" },
  // ── MACRO SPOT ONLY ─────────────────────────────────────────────────────
  VIX:      { name:"CBOE VIX",            icon:"⚡", spotSymbol:"CBOE:VIX",        yahoo:"^VIX",         dex:"macro" },
  SPY:      { name:"S&P 500 ETF",         icon:"📊", spotSymbol:"SPY",             yahoo:"SPY",          dex:"macro" },
  QQQ:      { name:"Nasdaq 100 ETF",      icon:"💹", spotSymbol:"QQQ",             yahoo:"QQQ",          dex:"macro" },
  DXY:      { name:"US Dollar Index",     icon:"💵", spotSymbol:"OANDA:USD_CHF",   yahoo:"DX-Y.NYB",     dex:"macro" },
};

const DEX_CLASS = { crypto:"crypto", xyz:"equity", flx:"commodity", macro:"macro" };

function getMeta(ticker) {
  const m = ASSET_META_LIB[ticker] || {};
  const dex = m.dex || "crypto";
  return {
    ticker,
    name:   m.name || ticker,
    icon:   m.icon || "◆",
    class:  DEX_CLASS[dex] || "crypto",
    dex,
    spotSymbol: m.spotSymbol || null,
    yahoo:      m.yahoo || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS — exported for component use
// ─────────────────────────────────────────────────────────────────────────────
export function fmtPrice(p) {
  if (!p || p === 0) return "—";
  if (p >= 10000)  return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1000)   return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (p >= 100)    return "$" + p.toFixed(2);
  if (p >= 1)      return "$" + p.toFixed(3);
  if (p >= 0.001)  return "$" + p.toFixed(5);
  return "$" + p.toFixed(8);
}

export function fmtChange(c) {
  if (c == null) return "—";
  const sign = c >= 0 ? "+" : "";
  return `${sign}${c.toFixed(2)}%`;
}

export function fmtFunding(f) {
  if (f == null || f === 0) return "0.0000%";
  return `${f >= 0 ? "+" : ""}${(f * 100).toFixed(4)}%`;
}

export function changeColor(c) {
  if (!c && c !== 0) return "#6b7a99";
  return c > 0 ? "#00ff88" : c < 0 ? "#ff2d55" : "#6b7a99";
}

export function sigColor(regime) {
  if (regime === "RISK-ON" || regime === "bullish" || regime === "LOW")  return "#00ff88";
  if (regime === "RISK-OFF" || regime === "bearish" || regime === "HIGH") return "#ff2d55";
  return "#f59e0b";
}

export function computeVolatility(ticker, perpData, cls) {
  if (!perpData) return 0;
  const ch = Math.abs(perpData.change24h || 0);
  if (cls === "crypto") {
    if (ch > 8) return 1.0;
    if (ch > 4) return 0.75;
    if (ch > 2) return 0.5;
    if (ch > 1) return 0.25;
    return 0.1;
  }
  if (ch > 4) return 1.0;
  if (ch > 2) return 0.75;
  if (ch > 1) return 0.5;
  if (ch > 0.5) return 0.25;
  return 0.1;
}

export function VolatilityBar({ vol }) {
  if (!vol) return null;
  const col = vol >= 0.75 ? "#ff2d55" : vol >= 0.5 ? "#f59e0b" : "#3a4560";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:1, height:12 }}>
      {[0.25, 0.5, 0.75, 1.0].map((thresh, i) => (
        <div key={i} style={{
          width: 2, height: 4 + i * 2,
          borderRadius: 1,
          background: vol >= thresh ? col : "rgba(255,255,255,0.06)",
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HYPERLIQUID FETCH — dynamic discovery, all dexes
// ─────────────────────────────────────────────────────────────────────────────
async function fetchHLDex(dex) {
  const body = dex === "crypto"
    ? { type: "metaAndAssetCtxs" }
    : { type: "metaAndAssetCtxs", dex };
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const json = await res.json();
    const universe = json?.[0]?.universe || [];
    const ctxs     = json?.[1] || [];
    const out = {};
    universe.forEach((asset, i) => {
      const ctx = ctxs[i] || {};
      // Strip dex prefix: "xyz:TSLA" → "TSLA", "flx:OIL" → "OIL"
      const ticker = asset.name.includes(":") ? asset.name.split(":").slice(1).join(":") : asset.name;
      const markPx = parseFloat(ctx.markPx || 0);
      if (!markPx || markPx === 0) return; // HARD RULE: skip zero prices
      const prevPx = parseFloat(ctx.prevDayPx || markPx);
      const change24h = prevPx > 0 ? ((markPx - prevPx) / prevPx) * 100 : 0;
      out[ticker] = {
        price:       markPx,
        oraclePx:    parseFloat(ctx.oraclePx || 0),
        prevDayPx:   prevPx,
        change24h,
        funding:     parseFloat(ctx.funding || 0),
        openInterest: parseFloat(ctx.openInterest || 0),
        volume24h:   parseFloat(ctx.dayNtlVlm || 0),
        maxLeverage: asset.maxLeverage || 0,
        source:      "Hyperliquid",
        dex,
        ts: Date.now(),
      };
    });
    return out;
  } catch (e) {
    console.warn(`[MarketDataStore] HL fetch failed for dex=${dex}:`, e.message);
    return {};
  }
}

async function fetchAllHL() {
  const [cryptoPerps, equityPerps, commodityPerps] = await Promise.all([
    fetchHLDex("crypto"),
    fetchHLDex("xyz"),
    fetchHLDex("flx"),
  ]);
  return { ...cryptoPerps, ...equityPerps, ...commodityPerps };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOT FETCH — via backend proxy to avoid CORS / key exposure
// ─────────────────────────────────────────────────────────────────────────────
// Backend metal key → all canonical ticker aliases so lookups never fail
// e.g. backend returns "WTI" but HL perp tickers are "OIL" and "CL"
const SPOT_ALIASES = {
  WTI:      ["OIL", "CL"],
  BRENT:    ["BRENTOIL"],
  XAU:      ["XAU", "GOLD"],
  XAG:      ["XAG", "SILVER"],
};

async function fetchSpotViaBackend(symbols) {
  if (!symbols || symbols.length === 0) return {};
  try {
    const res = await fetch("/api/finnhub", { credentials: "include", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    const all = { ...data.stocks, ...data.metals, ...data.forex };
    const now = Date.now();
    for (const [sym, d] of Object.entries(all)) {
      if (!d?.price || d.price <= 0) continue;
      const entry = {
        price:     d.price,
        change24h: d.chg || 0,
        high:      d.h || 0,
        low:       d.l || 0,
        prevClose: d.pc || 0,
        source:    "Finnhub",
        ts: now,
      };
      const key = sym.toUpperCase();
      out[key] = entry;
      // Expand aliases so lookups work for any ticker variant (OIL, CL, WTI all hit same data)
      const aliases = SPOT_ALIASES[key] || [];
      for (const alias of aliases) out[alias] = { ...entry };
    }
    return out;
  } catch (e) {
    console.warn("[MarketDataStore] Spot fetch failed:", e.message);
    return {};
  }
}

// Also fetch VIX and macro spot assets from the backend crypto endpoint
async function fetchCryptoSpot() {
  try {
    const res = await fetch("/api/crypto", { credentials: "include", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const [sym, d] of Object.entries(data || {})) {
      if (d?.price && d.price > 0) {
        out[sym.toUpperCase()] = {
          price:    d.price,
          change24h: d.chg || 0,
          source:   "Hyperliquid",
          ts: Date.now(),
        };
      }
    }
    return out;
  } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPREADS — spot vs perp divergence
// ─────────────────────────────────────────────────────────────────────────────
function computeSpreads(spotMap, perpMap, discoveredAssets) {
  const spreads = {};
  for (const [ticker, meta] of Object.entries(discoveredAssets)) {
    if (meta.class === "crypto") continue; // crypto perps ARE the price reference
    const spot = spotMap[ticker]?.price || spotMap[meta.spotSymbol]?.price || 0;
    const perp = perpMap[ticker]?.price || 0;
    if (!spot || !perp) continue;
    const spreadPct = ((perp - spot) / spot) * 100;
    const signal = spreadPct > 0.5 ? "PERP_PREMIUM" : spreadPct < -0.5 ? "PERP_DISCOUNT" : "FLAT";
    const severity = Math.abs(spreadPct) > 3 ? "HIGH" : Math.abs(spreadPct) > 1 ? "MODERATE" : "LOW";
    spreads[ticker] = {
      spotPrice: spot,
      perpPrice: perp,
      spreadPct,
      signal,
      severity,
      label: spreadPct > 0.5 ? "Futures Premium" : spreadPct < -0.5 ? "Futures Discount" : "Aligned",
      spotSource: spotMap[ticker]?.source || "Finnhub",
    };
  }
  return spreads;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLVR MARKET MODE SCORE — deterministic, no randomness
// ─────────────────────────────────────────────────────────────────────────────
function computeMarketMode(perpMap, spotMap, sentimentScore) {
  const btc    = perpMap["BTC"] || {};
  const eth    = perpMap["ETH"] || {};
  const nvda   = spotMap["NVDA"] || perpMap["NVDA"] || {};
  const spy    = spotMap["SPY"]  || perpMap["SP500"] || {};
  const gold   = spotMap["XAU"]  || spotMap["GOLD"]  || perpMap["GOLD"] || {};
  const oil    = spotMap["OIL"]  || perpMap["OIL"]   || {};
  const vix    = spotMap["VIX"]  || spotMap["^VIX"]  || {};

  const btcFunding = btc.funding || 0;
  const btcChange  = btc.change24h || 0;
  const ethChange  = eth.change24h || 0;
  const nvdaChange = nvda.change24h || 0;
  const spyChange  = spy.change24h || 0;
  const goldChange = gold.change24h || 0;
  const oilChange  = oil.change24h || 0;
  const vixPrice   = vix.price || 0;

  const vixScore = vixPrice > 0
    ? (vixPrice < 16 ? 18 : vixPrice > 30 ? -24 : vixPrice > 20 ? -10 : 0)
    : 0;

  const sScore = typeof sentimentScore === "number" ? sentimentScore : 50;

  let score = 50;
  score += btcFunding < -0.0005 ? 12 : btcFunding > 0.001 ? -15 : 0;
  score += btcChange  * 3.5;
  score += ethChange  * 2.0;
  score += nvdaChange * 2.5;
  score += spyChange  * 2.0;
  score -= goldChange * 2.0;
  score += oilChange  * 0.8;
  score += vixScore;
  score += (sScore - 50) * 0.3;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const regime = score >= 60 ? "RISK-ON" : score <= 40 ? "RISK-OFF" : "NEUTRAL";

  // Per-class sub-scores
  const cryptoScore = Math.max(0, Math.min(100, Math.round(
    50 + btcChange * 4 + ethChange * 2 + (btcFunding < -0.0005 ? 10 : btcFunding > 0.001 ? -12 : 0)
  )));
  const equitiesScore = Math.max(0, Math.min(100, Math.round(
    50 + spyChange * 4 + nvdaChange * 3 + (vixScore * 0.5)
  )));
  const commoditiesScore = Math.max(0, Math.min(100, Math.round(
    50 + goldChange * 2.5 + oilChange * 2.5
  )));

  // Cross-asset correlations
  const correlations = [];
  if (goldChange > 1.5 && btcChange < 0)
    correlations.push({ signal:"RISK-OFF", msg:"Gold rising + BTC negative — defensive rotation", severity:"HIGH" });
  if (goldChange > 1 && spyChange < -0.5)
    correlations.push({ signal:"RISK-OFF", msg:"Gold up + SPY down — macro fear spreading", severity:"HIGH" });
  if (btcFunding > 0.002 && btcChange > 2)
    correlations.push({ signal:"OVERHEATED", msg:`BTC funding ${fmtFunding(btcFunding)}/hr — long squeeze risk elevated`, severity:"HIGH" });
  if (nvdaChange > 3 && btcChange > 2)
    correlations.push({ signal:"RISK-ON", msg:"NVDA+BTC both +2%+ — broad risk appetite", severity:"MODERATE" });
  if (vixPrice > 25 && spyChange < -1)
    correlations.push({ signal:"RISK-OFF", msg:`VIX ${vixPrice.toFixed(1)} + SPY ${spyChange.toFixed(1)}% — equity fear spreading`, severity:"HIGH" });
  if (oilChange > 2 && goldChange > 1)
    correlations.push({ signal:"INFLATION", msg:"Oil+Gold both rising — inflation trade active", severity:"MODERATE" });

  const signals = {
    CRYPTO:       regime === "RISK-ON" ? "RISK-ON" : regime === "RISK-OFF" ? "RISK-OFF" : "NEUTRAL",
    EQUITIES:     equitiesScore >= 60 ? "RISK-ON" : equitiesScore <= 40 ? "RISK-OFF" : "NEUTRAL",
    COMMODITIES:  goldChange > 1 ? "RISK-OFF" : goldChange < -1 ? "RISK-ON" : "NEUTRAL",
    VOLATILITY:   vixPrice > 30 ? "HIGH" : vixPrice > 20 ? "ELEVATED" : vixPrice > 0 ? "LOW" : "UNKNOWN",
    FUNDING:      btcFunding > 0.002 ? "OVERHEATED" : btcFunding < -0.0005 ? "BEARISH" : "NORMAL",
  };

  return {
    score, regime,
    crypto:      { score: cryptoScore,      regime: cryptoScore >= 60 ? "RISK-ON" : cryptoScore <= 40 ? "RISK-OFF" : "NEUTRAL" },
    equities:    { score: equitiesScore,    regime: equitiesScore >= 60 ? "RISK-ON" : equitiesScore <= 40 ? "RISK-OFF" : "NEUTRAL" },
    commodities: { score: commoditiesScore, regime: commoditiesScore >= 60 ? "RISK-ON" : commoditiesScore <= 40 ? "RISK-OFF" : "NEUTRAL" },
    vix:         { price: vixPrice, regime: vixPrice > 30 ? "FEAR" : vixPrice > 20 ? "ELEVATED" : vixPrice > 0 ? "CALM" : "—" },
    correlations, signals,
    inputs: { btcChange, ethChange, nvdaChange, spyChange, goldChange, oilChange, btcFunding, vixPrice },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS / SENTIMENT — via backend CryptoPanic proxy
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSentiment() {
  try {
    const res = await fetch("/api/cryptopanic", { credentials: "include", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { score: 50, label: "NEUTRAL", headlines: [] };
    const data = await res.json();
    const results = data?.results || data || [];
    if (!Array.isArray(results) || results.length === 0) return { score: 50, label: "NEUTRAL", headlines: [] };
    let bullish = 0, bearish = 0, neutral = 0;
    const headlines = results.slice(0, 8).map(r => {
      const v = r.votes || {};
      const bull = (v.positive || 0) + (v.liked || 0);
      const bear = (v.negative || 0) + (v.disliked || 0);
      const sentiment = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
      if (sentiment === "bullish") bullish++;
      else if (sentiment === "bearish") bearish++;
      else neutral++;
      return { title: r.title, url: r.url, sentiment, source: r.source?.title || "CryptoPanic" };
    });
    const total = bullish + bearish + neutral || 1;
    const score = Math.round((bullish / total) * 100);
    const label = score >= 60 ? "BULLISH" : score <= 40 ? "BEARISH" : "NEUTRAL";
    return { score, label, headlines };
  } catch { return { score: 50, label: "NEUTRAL", headlines: [] }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED ALERTS
// ─────────────────────────────────────────────────────────────────────────────
function computeAlerts(perpMap, spreads, marketMode, prevMode) {
  const alerts = [];
  const now = Date.now();

  // Funding rate spikes
  for (const ticker of ["BTC", "ETH", "SOL"]) {
    const p = perpMap[ticker];
    if (!p) continue;
    if (Math.abs(p.funding) > 0.003) {
      alerts.push({
        id: `funding-${ticker}-${now}`,
        type: "FUNDING", asset: ticker, category: "Funding Spike",
        title: `${ticker} Funding ${p.funding > 0 ? "Spike" : "Negative"}`,
        msg: `${ticker} funding rate ${fmtFunding(p.funding)}/hr — ${p.funding > 0 ? "longs paying shorts, squeeze risk elevated" : "shorts paying longs, potential squeeze up"}`,
        severity: "HIGH", ts: now,
      });
    }
  }

  // Spread anomalies
  for (const [ticker, s] of Object.entries(spreads)) {
    if (s.severity === "HIGH") {
      alerts.push({
        id: `spread-${ticker}-${now}`,
        type: "SPREAD", asset: ticker, category: "Spread Anomaly",
        title: `${ticker} ${s.label}: ${s.spreadPct > 0 ? "+" : ""}${s.spreadPct.toFixed(2)}%`,
        msg: `${ticker} perp trading ${Math.abs(s.spreadPct).toFixed(2)}% ${s.spreadPct > 0 ? "above" : "below"} spot — futures market ${s.spreadPct > 0 ? "more bullish than" : "diverging bearishly from"} physical market`,
        severity: "HIGH", ts: now,
      });
    }
  }

  // Regime change
  if (prevMode && prevMode.regime && marketMode.regime !== prevMode.regime) {
    alerts.push({
      id: `regime-${now}`,
      type: "REGIME", asset: "MARKET", category: "Regime Shift",
      title: `Market Regime: ${prevMode.regime} → ${marketMode.regime}`,
      msg: `CLVR Market Mode shifted from ${prevMode.regime} to ${marketMode.regime} (score: ${marketMode.score}/100)`,
      severity: "MODERATE", ts: now,
    });
  }

  // High-severity correlations
  for (const c of (marketMode.correlations || [])) {
    if (c.severity === "HIGH") {
      alerts.push({
        id: `corr-${c.signal}-${now}`,
        type: "CORRELATION", asset: "MULTI", category: "Cross-Asset Signal",
        title: `${c.signal} Signal Detected`,
        msg: c.msg,
        severity: "HIGH", ts: now,
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERED ASSETS BUILDER — maps all fetched tickers to enriched metadata
// ─────────────────────────────────────────────────────────────────────────────
function buildDiscoveredAssets(perpMap) {
  const out = {};
  for (const ticker of Object.keys(perpMap)) {
    const meta = getMeta(ticker);
    out[ticker] = meta;
  }
  // Add macro spot-only assets
  for (const ticker of ["VIX", "SPY", "QQQ", "DXY"]) {
    const meta = getMeta(ticker);
    out[ticker] = meta;
  }
  return out;
}

function byClassFromDiscovered(discoveredAssets) {
  const crypto = [], equity = [], commodity = [];
  for (const [ticker, meta] of Object.entries(discoveredAssets)) {
    if (meta.class === "crypto")    crypto.push(ticker);
    else if (meta.class === "equity")   equity.push(ticker);
    else if (meta.class === "commodity") commodity.push(ticker);
  }
  return { crypto, equity, commodity };
}

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEF DATA BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildMorningBrief(perpMap, spotMap, spreads, marketMode, sentiment, discoveredAssets) {
  const getAsset = (ticker) => {
    const perp = perpMap[ticker];
    const spot = spotMap[ticker] || spotMap[ASSET_META_LIB[ticker]?.spotSymbol];
    const meta = getMeta(ticker);
    return { perp, spot, meta };
  };

  const btc = getAsset("BTC");
  const eth = getAsset("ETH");
  const gold = getAsset("GOLD") || getAsset("XAU");
  const oil  = getAsset("OIL") || getAsset("CL");

  // Top movers across all asset classes (by |change24h|, must have real price)
  const allMovers = [];
  for (const [ticker, meta] of Object.entries(discoveredAssets)) {
    const p = perpMap[ticker] || spotMap[ticker];
    if (!p?.price || p.price === 0) continue;
    allMovers.push({ ticker, meta, price: p.price, change24h: p.change24h || 0, source: p.source });
  }
  allMovers.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  const topMovers = allMovers.slice(0, 6);

  // Top spread anomalies
  const topSpreads = Object.entries(spreads)
    .filter(([, s]) => Math.abs(s.spreadPct) > 0.5)
    .sort(([, a], [, b]) => Math.abs(b.spreadPct) - Math.abs(a.spreadPct))
    .slice(0, 4)
    .map(([ticker, s]) => ({ ticker, ...s }));

  const totalMarkets = Object.keys(discoveredAssets).length;

  return {
    date: new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric", timeZone:"America/New_York" }),
    marketMode,
    sentiment,
    btc: { perp: btc.perp, spot: btc.spot },
    eth: { perp: eth.perp, spot: eth.spot },
    gold: { perp: gold?.perp, spot: gold?.spot },
    oil:  { perp: oil?.perp,  spot: oil?.spot  },
    topMovers,
    topSpreads,
    correlations: marketMode.correlations || [],
    totalMarkets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON STATE — shared across all hook consumers
// ─────────────────────────────────────────────────────────────────────────────
let _state = {
  perps:           {},
  spot:            {},
  spreads:         {},
  marketMode:      null,
  sentiment:       { score: 50, label: "NEUTRAL", headlines: [] },
  alerts:          [],
  dismissedAlerts: new Set(),
  discoveredAssets:{},
  byClass:         { crypto:[], equity:[], commodity:[] },
  loading:         true,
  lastUpdate:      null,
  error:           null,
};
let _prevMode = null;
let _listeners = new Set();
let _intervalId = null;
let _fetchCount = 0;
let _sentimentTick = 0; // fetch sentiment every 4 cycles (~60s)

function notify() {
  for (const fn of _listeners) fn({ ..._state });
}

async function doFetch() {
  _fetchCount++;
  try {
    // Always fetch perps
    const perpMapRaw = await fetchAllHL();

    // Spot + crypto spot in parallel, sentiment every 4 cycles
    const [spotMapRaw, cryptoSpot, sentimentRaw] = await Promise.all([
      fetchSpotViaBackend(Object.keys(perpMapRaw)),
      fetchCryptoSpot(),
      _fetchCount % 4 === 1 ? fetchSentiment() : Promise.resolve(_state.sentiment),
    ]);

    // Merge crypto spot into spot map
    const spotMap = { ...cryptoSpot, ...spotMapRaw };

    // Build discovered assets from live HL response
    const discoveredAssets = buildDiscoveredAssets(perpMapRaw);
    const byClass = byClassFromDiscovered(discoveredAssets);

    // Build spot lookup keyed by both ticker and spotSymbol
    const spotLookup = { ...spotMap };
    for (const [ticker, meta] of Object.entries(discoveredAssets)) {
      if (meta.spotSymbol && spotMap[meta.spotSymbol]) {
        spotLookup[ticker] = spotMap[meta.spotSymbol];
      }
    }

    const spreads   = computeSpreads(spotLookup, perpMapRaw, discoveredAssets);
    const sentiment = sentimentRaw || _state.sentiment;
    const marketMode = computeMarketMode(perpMapRaw, spotLookup, sentiment.score);
    const newAlerts  = computeAlerts(perpMapRaw, spreads, marketMode, _prevMode);

    // Merge alerts — keep dismissed ones filtered, dedupe by type+asset
    const existingActive = _state.alerts.filter(a =>
      !_state.dismissedAlerts.has(a.id) &&
      !newAlerts.some(n => n.type === a.type && n.asset === a.asset)
    );
    const allAlerts = [...newAlerts, ...existingActive]
      .filter(a => !_state.dismissedAlerts.has(a.id))
      .slice(0, 20);

    _prevMode = marketMode;
    _state = {
      ..._state,
      perps:           perpMapRaw,
      spot:            spotLookup,
      spreads,
      marketMode,
      sentiment,
      alerts:          allAlerts,
      discoveredAssets,
      byClass,
      loading:         false,
      lastUpdate:      Date.now(),
      error:           null,
    };
    notify();
  } catch (e) {
    console.error("[MarketDataStore] Fetch cycle failed:", e.message);
    _state = { ..._state, loading: false, error: e.message };
    notify();
  }
}

function ensurePolling() {
  if (_intervalId) return;
  doFetch();
  _intervalId = setInterval(doFetch, REFRESH_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// useMarketData HOOK
// ─────────────────────────────────────────────────────────────────────────────
export function useMarketData() {
  const [state, setState] = useState(_state);

  useEffect(() => {
    _listeners.add(setState);
    ensurePolling();
    return () => { _listeners.delete(setState); };
  }, []);

  const refresh = useCallback(() => { doFetch(); }, []);

  const dismissAlert = useCallback((id) => {
    _state.dismissedAlerts.add(id);
    _state = { ..._state, alerts: _state.alerts.filter(a => a.id !== id) };
    notify();
  }, []);

  // Accessor helpers
  const spotPx   = useCallback((ticker) => state.spot[ticker]?.price || 0, [state.spot]);
  const perpPx   = useCallback((ticker) => state.perps[ticker]?.price || 0, [state.perps]);
  const bestPx   = useCallback((ticker) => {
    const meta = getMeta(ticker);
    if (meta.class === "crypto") return perpPx(ticker);
    return spotPx(ticker) || perpPx(ticker);
  }, [state.spot, state.perps]);
  const funding  = useCallback((ticker) => state.perps[ticker]?.funding || 0, [state.perps]);
  const spread   = useCallback((ticker) => state.spreads[ticker] || null, [state.spreads]);
  const morningBrief = useCallback(() =>
    buildMorningBrief(state.perps, state.spot, state.spreads, state.marketMode, state.sentiment, state.discoveredAssets),
    [state]
  );

  const totalMarkets = Object.keys(state.discoveredAssets).length;

  return {
    // Data maps
    spot:             state.spot,
    perps:            state.perps,
    spreads:          state.spreads,
    marketMode:       state.marketMode,
    sentiment:        state.sentiment,
    alerts:           state.alerts,
    discoveredAssets: state.discoveredAssets,
    byClass:          state.byClass,
    // Status
    loading:          state.loading,
    lastUpdate:       state.lastUpdate,
    error:            state.error,
    totalMarkets,
    // Accessors
    spotPx,
    perpPx,
    bestPx,
    funding,
    spread,
    morningBrief,
    refresh,
    dismissAlert,
    // Helpers re-exported for convenience
    fmtPrice,
    fmtChange,
    fmtFunding,
    changeColor,
    sigColor,
  };
}

export default useMarketData;
