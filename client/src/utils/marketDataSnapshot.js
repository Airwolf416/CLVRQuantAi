import { fmtPrice as mfmtPrice } from "../store/MarketDataStore.jsx";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP","BNB","ADA","DOT","POL","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"];
const METALS_SYMS = ["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"];
const FOREX_SYMS = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD"];
const METAL_LABELS = {XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABELS = {EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

const FOREX_4D = ["EURUSD","GBPUSD","AUDUSD","USDCHF","USDCAD","NZDUSD","EURGBP","USDSGD"];
const FOREX_2D = ["USDJPY","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY"];

// Pump/Dump thresholds in 24h % change. Per-asset-class because volatility
// profiles differ wildly: a 1% move in EUR/USD is a major event, but on BTC
// it's noise. These match the user's request to inject only assets actually
// moving — not the entire stale price universe — into the AI prompt.
const PUMP_DUMP_THRESHOLDS = {
  crypto:    3.0,
  equity:    1.5,
  commodity: 1.5,
  forex:     0.5,
};

function classifyMove(chg, klass) {
  const n = Number(chg);
  if (!isFinite(n)) return "neutral";
  const t = PUMP_DUMP_THRESHOLDS[klass] ?? 2.0;
  if (n >=  t) return "pump";
  if (n <= -t) return "dump";
  return "neutral";
}

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

/**
 * Build the market snapshot string injected into the AI system prompt.
 *
 * @param {Object} args
 * @param {"PERP"|"SPOT"|"BOTH"} [args.marketTypeFilter="BOTH"]
 *   - "PERP": ONLY Hyperliquid perp prices are emitted. Spot sections are
 *     dropped entirely so the AI cannot pick a spot price for an asset the
 *     user wanted as a perp trade (this was the AMD-spot-when-PERP-selected
 *     bug).
 *   - "SPOT": ONLY spot prices (HL spot + CoinGecko/Yahoo/FMP) are emitted.
 *     Perp section is dropped.
 *   - "BOTH": all sections, every line tagged so AI labels each idea correctly.
 * @param {boolean} [args.signalFilter=true]
 *   When true, every asset row is filtered to PUMP / DUMP only — anything
 *   with |24h change| below the per-asset-class threshold (or no active
 *   QuantBrain signal) is dropped. The AI sees only assets actually moving,
 *   per user request "equities/commodities/forex/crypto should be injected
 *   only if there's a pump or dump signal".
 * @param {"ALL"|"CRYPTO"|"EQUITY"|"COMMODITY"|"FOREX"} [args.assetClass="ALL"]
 *   When non-ALL, asset rows from the OTHER classes are dropped from every
 *   section. The filter header also tells the AI to recommend ONLY trades
 *   from the chosen class. Used by the Trade Ideas asset-class selector
 *   so the user can scope a generation to e.g. "FX-only" or "equities-only".
 */
export function buildMarketSnapshot({
  storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
  liveSignals, newsFeed, macroEvents, insiderData, regimeData,
  storeMode, storeTotalMarkets, storeAlerts,
  marketTypeFilter = "BOTH",
  signalFilter = true,
  assetClass = "ALL",
}) {
  const nowISO = new Date().toISOString();
  const nowET = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York", hour12: false });

  const includePerps = marketTypeFilter === "PERP" || marketTypeFilter === "BOTH";
  const includeSpot  = marketTypeFilter === "SPOT" || marketTypeFilter === "BOTH";

  // Asset-class gates. ALL → every class allowed. Otherwise only the matching
  // class is allowed; rows from the others are silently dropped during build.
  const acAll       = assetClass === "ALL";
  const acCrypto    = acAll || assetClass === "CRYPTO";
  const acEquity    = acAll || assetClass === "EQUITY";
  const acCommodity = acAll || assetClass === "COMMODITY";
  const acForex     = acAll || assetClass === "FOREX";

  // Tokens with an active QuantBrain signal — always pass the filter even if
  // 24h % change happens to be below the pump/dump threshold (the signal
  // engine has already classified them as worth attention).
  const signaledTokens = new Set();
  if (Array.isArray(liveSignals)) {
    for (const s of liveSignals) {
      if (s?.token) signaledTokens.add(String(s.token).toUpperCase());
    }
  }

  // Helper that decides whether a row should be kept under signal filter.
  // Returns the classification ("pump"/"dump"/"signal"/"neutral") or null
  // if the row should be DROPPED.
  const keepOrDrop = (chg, klass, symUpper) => {
    if (!signalFilter) return classifyMove(chg, klass) || "neutral";
    const cls = classifyMove(chg, klass);
    if (cls !== "neutral") return cls;
    if (signaledTokens.has(symUpper)) return "signal";
    return null;
  };

  // ── SECTION A — HYPERLIQUID PERPS ────────────────────────────────────────
  // Only emitted when marketTypeFilter allows PERP. Each row is tagged with
  // [PUMP]/[DUMP]/[SIGNAL] so the AI can reason about WHY this row is here.
  let sectionA = "";
  if (includePerps) {
    const fmtHLPerp = (sym, klass = "crypto") => {
      const d = storePerps?.[sym];
      if (!d?.price) return null;
      const cls = keepOrDrop(d.change24h, klass, sym);
      if (cls === null) return null;
      const chg = d.change24h != null ? ` (${d.change24h >= 0 ? "+" : ""}${d.change24h.toFixed(2)}%)` : "";
      const fund = d.funding != null ? ` Fund:${d.funding >= 0 ? "+" : ""}${(d.funding * 100).toFixed(4)}%/8h` : " Fund:n/a";
      const oi = d.openInterest && d.price ? ` OI:$${((d.openInterest * d.price) / 1e9).toFixed(2)}B` : "";
      const tag = ` [${cls.toUpperCase()}]`;
      return `${sym} $${mfmtPrice(d.price)}${chg}${fund}${oi}${tag}`;
    };

    const cryptoPerpRows    = acCrypto    ? CRYPTO_SYMS.map(s => fmtHLPerp(s, "crypto")).filter(Boolean)    : [];
    const equityPerpRows    = acEquity    ? EQUITY_SYMS.map(s => fmtHLPerp(s, "equity")).filter(Boolean)    : [];
    const commodityPerpRows = acCommodity ? METALS_SYMS.map(s => fmtHLPerp(s, "commodity")).filter(Boolean) : [];

    // Each placeholder line is also gated by the asset-class flag so we
    // don't emit "CRYPTO PERPS: (no signals)" inside a FOREX-only run.
    const cryptoLine    = !acCrypto    ? "" : cryptoPerpRows.length    ? `CRYPTO PERPS: ${cryptoPerpRows.join(" | ")}`             : (signalFilter ? "CRYPTO PERPS: (no pump/dump signals — all assets within neutral range)" : "");
    const equityLine    = !acEquity    ? "" : equityPerpRows.length    ? `EQUITY PERPS (HL synthetic): ${equityPerpRows.join(" | ")}` : "";
    const commodityLine = !acCommodity ? "" : commodityPerpRows.length ? `COMMODITY PERPS (HL synthetic): ${commodityPerpRows.join(" | ")}` : "";

    sectionA = `━━━ SECTION A — HYPERLIQUID PERP DATA [LIVE STREAMING — <1s latency] ━━━
${[cryptoLine, equityLine, commodityLine].filter(Boolean).join("\n")}`;
  }

  // ── SECTION B — HYPERLIQUID SPOT ────────────────────────────────────────
  // HL spot only carries crypto pairs — drop entirely under non-crypto class.
  let sectionB = "";
  if (includeSpot && acCrypto) {
    const hlSpotRows = CRYPTO_SYMS.map(s => {
      const d = storeSpot?.[s];
      if (!d?.price) return null;
      const cls = keepOrDrop(d.change24h, "crypto", s);
      if (cls === null) return null;
      const chg = d.change24h != null ? ` (${d.change24h >= 0 ? "+" : ""}${d.change24h.toFixed(2)}%)` : "";
      const tag = ` [${cls.toUpperCase()}]`;
      return `${s} $${mfmtPrice(d.price)}${chg}${tag}`;
    }).filter(Boolean);

    sectionB = `━━━ SECTION B — HYPERLIQUID SPOT DATA [LIVE] ━━━
${hlSpotRows.length ? hlSpotRows.join(" | ") : (signalFilter ? "(no pump/dump signals on tracked spot pairs)" : "HL spot data loading")}`;
  }

  // ── SECTION C — DELAYED SPOT (CoinGecko / Yahoo / FMP) ──────────────────
  // Spot-only data source. Emitted under SPOT or BOTH. Filtered same as A/B.
  let sectionC = "";
  if (includeSpot) {
    const snap = (sym, store) => {
      const d = store?.[sym];
      return d ? `${fmt(d.price, sym)} (${pct(d.chg)})${d.live ? " LIVE" : " est"}` : null;
    };
    const tagged = (sym, store, klass, label) => {
      const d = store?.[sym];
      if (!d) return null;
      // CRITICAL: never feed stale fallback prices to the AI. Equity/metal/
      // forex stores get seeded with hardcoded constants (months stale —
      // AMD was $145, EURUSD was 1.0842, etc) so the UI tiles render
      // immediately, but those seeds are wrong by the time the AI sees them.
      // Crypto comes from CoinGecko which is always live, no `live` flag.
      if ((klass === "equity" || klass === "commodity" || klass === "forex") && d.live !== true) return null;
      const cls = keepOrDrop(d.chg, klass, sym);
      if (cls === null) return null;
      const base = snap(sym, store);
      if (!base) return null;
      const tag = ` [${cls.toUpperCase()}]`;
      const f = klass === "crypto" && d.funding ? ` F:${pct(d.funding, 4)}/8h` : "";
      const oi = klass === "crypto" && d.oi ? ` OI:$${(d.oi / 1e6).toFixed(0)}M` : "";
      return `${label}:${base}${f}${oi}${tag}`;
    };

    const cryptoCRows = acCrypto    ? CRYPTO_SYMS.map(s => tagged(s, cryptoPrices, "crypto", s)).filter(Boolean) : [];
    const equityRows  = acEquity    ? EQUITY_SYMS.map(s => tagged(s, equityPrices, "equity", s)).filter(Boolean) : [];
    const metalRows   = acCommodity ? METALS_SYMS.map(s => tagged(s, metalPrices, "commodity", METAL_LABELS[s] || s)).filter(Boolean) : [];
    const fxRows      = acForex     ? FOREX_SYMS.map(s => tagged(s, forexPrices, "forex", FOREX_LABELS[s] || s)).filter(Boolean) : [];

    const noteIfEmpty = (rows, name) =>
      rows.length ? rows.join(" | ") : (signalFilter ? `(no ${name} pump/dump signals)` : "loading");

    // Only include lines for asset classes the user has opted into. Under e.g.
    // assetClass="EQUITY" we skip the CRYPTO/COMMODITIES/FOREX lines entirely
    // so the AI cannot accidentally pick a non-equity asset.
    const cLines = [
      acCrypto    ? `CRYPTO spot (CoinGecko): ${noteIfEmpty(cryptoCRows, "crypto")}` : null,
      acEquity    ? `EQUITIES (Yahoo/FMP): ${noteIfEmpty(equityRows, "equity")}`     : null,
      acCommodity ? `COMMODITIES: ${noteIfEmpty(metalRows, "commodity")}`            : null,
      acForex     ? `FOREX (Yahoo/FMP): ${noteIfEmpty(fxRows, "FX")}`                : null,
    ].filter(Boolean);

    sectionC = `━━━ SECTION C — ADDITIONAL MARKET DATA [30-120s delayed — confirmation only] ━━━
${cLines.join("\n")}`;
  }

  // ── Live QuantBrain signal feed (the actual classified pump/dump events) ─
  // Highest-confidence movers — appended after the per-section data. Under a
  // non-ALL asset class we filter the signals to tokens that belong to the
  // selected class so we don't dump e.g. a BTC SHORT signal into a FOREX-only
  // run (the AI would feel pressure to either trade it or explain it away).
  let filteredSignals = liveSignals;
  if (!acAll && Array.isArray(liveSignals)) {
    const allowedSet = new Set([
      ...(acCrypto    ? CRYPTO_SYMS : []),
      ...(acEquity    ? EQUITY_SYMS : []),
      ...(acCommodity ? METALS_SYMS : []),
      ...(acForex     ? FOREX_SYMS  : []),
    ]);
    filteredSignals = liveSignals.filter(s => s?.token && allowedSet.has(String(s.token).toUpperCase()));
  }
  const sigSnap = filteredSignals?.length > 0
    ? `\nLIVE QUANTBRAIN SIGNALS (recent pump/dump events): ${filteredSignals.slice(0, 5).map(s => `${s.token} ${s.dir}${s.pctMove ? " " + s.pctMove + "%" : ""}`).join(" | ")}`
    : "";

  const newsSnap     = newsFeed?.length > 0     ? `\nNEWS: ${newsFeed.filter(n => !n.political).slice(0, 5).map(n => `[${n.source}] ${n.title.substring(0, 60)}`).join(" | ")}` : "";
  const macroSnap    = macroEvents?.length > 0  ? `\nMACRO: ${macroEvents.slice(0, 10).map(e => `${e.date} ${e.timeET || e.time || ""} ET ${e.region || e.country}: ${e.name} Impact:${e.impact}`).join(" | ")}` : "";
  const storeModeSnap = storeMode               ? `\nCLVR MARKET INTELLIGENCE: Regime=${storeMode.regime} Score=${storeMode.score}/100` : "";

  // Header note explaining the filter regime so the AI doesn't hallucinate
  // missing assets. This is what enforces "if it's not in the snapshot,
  // don't trade it."
  const filterHeader = [
    marketTypeFilter === "PERP" ? "MARKET DATA REGIME: PERP-ONLY (Hyperliquid perp prices, with funding & OI). No spot prices supplied. Use ONLY the prices listed in Section A for entry/SL/TP. Do NOT recommend any asset that is not present in Section A — if an asset has no perp data here, it has no Hyperliquid perp listing and you cannot trade it as PERP."
    : marketTypeFilter === "SPOT" ? "MARKET DATA REGIME: SPOT-ONLY (HL spot + CoinGecko/Yahoo/FMP). No perp prices supplied. Use ONLY the prices listed in Sections B and C for entry/SL/TP. Do NOT recommend any asset that is not present in those sections."
    : "MARKET DATA REGIME: BOTH (perp + spot). Each row is tagged. PERP rows = Section A. SPOT rows = Sections B/C. Use the price from the section matching your trade's marketType field — do not mix.",
    !acAll ? `ASSET CLASS FILTER: ${assetClass}-ONLY. The user has narrowed this generation to ${assetClass.toLowerCase()} assets only. Recommend ONLY trades whose asset is from the ${assetClass.toLowerCase()} class (rows from other classes have been intentionally dropped from the data sections above). If no ${assetClass.toLowerCase()} setup meets your conviction bar, return an empty trades:[] array with a one-line "reason" — DO NOT substitute another asset class.` : null,
    signalFilter ? `SIGNAL FILTER: only assets currently classified as PUMP (24h ≥ +threshold) or DUMP (24h ≤ -threshold), or with an active QuantBrain signal, are included. Per-class thresholds: crypto ±${PUMP_DUMP_THRESHOLDS.crypto}%, equity ±${PUMP_DUMP_THRESHOLDS.equity}%, commodity ±${PUMP_DUMP_THRESHOLDS.commodity}%, FX ±${PUMP_DUMP_THRESHOLDS.forex}%. Assets within neutral range have been deliberately omitted — the user wants you focused on assets actually moving, not the full stale universe.` : null,
  ].filter(Boolean).join("\n");

  const body = [sectionA, sectionB, sectionC].filter(Boolean).join("\n\n")
             + sigSnap + newsSnap + storeModeSnap + macroSnap;

  return {
    nowISO,
    nowET,
    sections: `${filterHeader}\n\n${body}`,
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

export { CRYPTO_SYMS, EQUITY_SYMS, METALS_SYMS, FOREX_SYMS, METAL_LABELS, FOREX_LABELS, PUMP_DUMP_THRESHOLDS };
