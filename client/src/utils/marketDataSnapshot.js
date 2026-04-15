import { fmtPrice as mfmtPrice } from "../store/MarketDataStore.jsx";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP","BNB","ADA","DOT","POL","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"];
const METALS_SYMS = ["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"];
const FOREX_SYMS = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD"];
const METAL_LABELS = {XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABELS = {EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

const FOREX_4D = ["EURUSD","GBPUSD","AUDUSD","USDCHF","USDCAD","NZDUSD","EURGBP","USDSGD"];
const FOREX_2D = ["USDJPY","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY"];

export const fmt = (p, sym) => {
  if (!p && p !== 0) return "—";
  p = Number(p);
  if (isNaN(p) || p === 0) return "—";
  if (FOREX_4D.includes(sym)) return p.toFixed(4);
  if (FOREX_2D.includes(sym)) return p.toFixed(2);
  if (["XAG","NATGAS","COPPER"].includes(sym)) return "$" + p.toFixed(2);
  if (["XAU","PLATINUM","WTI","BRENT"].includes(sym)) return "$" + p.toFixed(sym === "XAU" ? 0 : 2);
  if (p >= 1000) return "$" + p.toFixed(0);
  if (p >= 100) return "$" + p.toFixed(1);
  if (p >= 1) return "$" + p.toFixed(2);
  return "$" + p.toFixed(6);
};

const pct = (v, d = 2) => {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d) + "%";
};

export function buildMarketSnapshot({ storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices, liveSignals, newsFeed, macroEvents, insiderData, regimeData, storeMode, storeTotalMarkets, storeAlerts }) {
  const nowISO = new Date().toISOString();
  const nowET = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York", hour12: false });
  const snap = (sym, p) => { const d = p[sym]; return d ? `${fmt(d.price, sym)} (${pct(d.chg)})${d.live ? " LIVE" : " est"}` : "n/a"; };

  const fmtHLPerp = (sym) => {
    const d = storePerps[sym];
    if (!d?.price) return null;
    const chg = d.change24h != null ? ` (${d.change24h >= 0 ? "+" : ""}${d.change24h.toFixed(2)}%)` : "";
    const fund = d.funding != null ? ` Fund:${d.funding >= 0 ? "+" : ""}${(d.funding * 100).toFixed(4)}%/8h` : " Fund:n/a";
    const oi = d.openInterest && d.price ? ` OI:$${((d.openInterest * d.price) / 1e9).toFixed(2)}B` : "";
    return `${sym} $${mfmtPrice(d.price)}${chg}${fund}${oi}`;
  };

  const hlCryptoPerpSnap = CRYPTO_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ") || "HL perp data loading";
  const hlEquityPerpSnap = EQUITY_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ");
  const hlMetalPerpSnap = METALS_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ");
  const hlSpotSnap = CRYPTO_SYMS.map(s => {
    const d = storeSpot[s];
    if (!d?.price) return null;
    const chg = d.change24h != null ? ` (${d.change24h >= 0 ? "+" : ""}${d.change24h.toFixed(2)}%)` : "";
    return `${s} $${mfmtPrice(d.price)}${chg}`;
  }).filter(Boolean).join(" | ") || "HL spot data loading";

  const cryptoSnap = CRYPTO_SYMS.map(s => {
    const d = cryptoPrices[s];
    const f = d?.funding ? ` F:${pct(d.funding, 4)}/8h` : "";
    const oi = d?.oi ? ` OI:$${(d.oi / 1e6).toFixed(0)}M` : "";
    return `${s}:${snap(s, cryptoPrices)}${f}${oi}`;
  }).join(" | ");
  const stockSnap = EQUITY_SYMS.map(s => `${s}:${snap(s, equityPrices)}`).join(" | ");
  const metalSnap = METALS_SYMS.map(s => `${METAL_LABELS[s] || s}:${snap(s, metalPrices)}`).join(" | ");
  const fxSnap = FOREX_SYMS.map(s => `${FOREX_LABELS[s] || s}:${snap(s, forexPrices)}`).join(" | ");
  const sigSnap = liveSignals?.length > 0 ? `\nLIVE SIGNALS: ${liveSignals.slice(0, 5).map(s => `${s.token} ${s.dir} ${s.pctMove ? s.pctMove + "%" : ""}`).join(" | ")}` : "";
  const newsSnap = newsFeed?.length > 0 ? `\nNEWS: ${newsFeed.filter(n => !n.political).slice(0, 5).map(n => `[${n.source}] ${n.title.substring(0, 60)}`).join(" | ")}` : "";
  const macroSnap = macroEvents?.length > 0 ? `\nMACRO: ${macroEvents.slice(0, 10).map(e => `${e.date} ${e.timeET || e.time || ""} ET ${e.region || e.country}: ${e.name} Impact:${e.impact}`).join(" | ")}` : "";

  const storeModeSnap = storeMode ? `\nCLVR MARKET INTELLIGENCE: Regime=${storeMode.regime} Score=${storeMode.score}/100` : "";

  return {
    nowISO,
    nowET,
    sections: `━━━ SECTION A — HYPERLIQUID PERP DATA [LIVE STREAMING — <1s latency] ━━━
CRYPTO PERPS (${hlCryptoPerpSnap.split("|").length} assets): ${hlCryptoPerpSnap}${hlEquityPerpSnap ? `\nEQUITY PERPS (HL synthetic): ${hlEquityPerpSnap}` : ""}${hlMetalPerpSnap ? `\nCOMMODITY PERPS (HL synthetic): ${hlMetalPerpSnap}` : ""}

━━━ SECTION B — HYPERLIQUID SPOT DATA [LIVE] ━━━
${hlSpotSnap}

━━━ SECTION C — ADDITIONAL MARKET DATA [30-120s delayed — confirmation only] ━━━
CRYPTO spot (CoinGecko): ${cryptoSnap}
EQUITIES (Finnhub): ${stockSnap}
COMMODITIES: ${metalSnap}
FOREX (Finnhub): ${fxSnap}${sigSnap}${newsSnap}${storeModeSnap}
${macroSnap}`,
  };
}

export function buildMacroPreflightContext(preflight) {
  if (!preflight) return "";
  const lines = [`MACRO PRE-FLIGHT (LIVE — checked ${preflight.timestamp}):`];
  lines.push(`Status: ${preflight.status}`);
  lines.push(`Events next 2H: ${preflight.eventsNext2H?.length > 0 ? preflight.eventsNext2H.map(e => `${e.event} at ${e.time} [${e.impact}] ${e.status}`).join("; ") : "None"}`);
  lines.push(`Events next 4H: ${preflight.eventsNext4H?.length > 0 ? preflight.eventsNext4H.map(e => `${e.event} at ${e.time} [${e.impact}]`).join("; ") : "None"}`);
  lines.push(`Events next 24H: ${preflight.eventsNext24H?.length > 0 ? preflight.eventsNext24H.map(e => `${e.event} at ${e.time} ${e.date} [${e.impact}]`).join("; ") : "None"}`);
  lines.push(`Breaking news: ${preflight.breakingNews?.length > 0 ? preflight.breakingNews.map(n => `${n.headline} (${n.source}, ${n.time})`).join("; ") : "None"}`);
  lines.push(`Active geopolitical risks: ${preflight.activeConflicts?.length > 0 ? preflight.activeConflicts.join("; ") : "None"}`);
  lines.push("");
  lines.push("INSTRUCTIONS: Factor this macro context into EVERY signal. If CAUTION, reduce conviction by 20% and compress TP by 25%. Note the specific macro risk in the \"flags\" field of each trade. If breaking news affects a specific asset, either skip that asset or flag it prominently.");
  return lines.join("\n");
}

export { CRYPTO_SYMS, EQUITY_SYMS, METALS_SYMS, FOREX_SYMS, METAL_LABELS, FOREX_LABELS };
