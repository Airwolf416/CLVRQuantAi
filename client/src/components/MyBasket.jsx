// ── MyBasket — Global Asset Coverage · Personalised Scalper & Swing AI ───────
import { useState, useCallback, useMemo, useEffect, useRef } from "react";

const C = {
  bg:"#050709", navy:"#080d18", panel:"#0c1220",
  border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7",
  halal:"#22c55e",
};
const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS  = "'Barlow', system-ui, sans-serif";

const MAX_ASSETS = 5;

// ── Asset Database ─────────────────────────────────────────────────────────────
const CRYPTO_ASSETS = [
  { sym:"BTC",  label:"Bitcoin",       icon:"₿",  cat:"crypto", region:"global" },
  { sym:"ETH",  label:"Ethereum",      icon:"Ξ",  cat:"crypto", region:"global" },
  { sym:"SOL",  label:"Solana",        icon:"◎",  cat:"crypto", region:"global" },
  { sym:"HYPE", label:"Hyperliquid",   icon:"H",  cat:"crypto", region:"global" },
  { sym:"XRP",  label:"XRP",           icon:"✕",  cat:"crypto", region:"global" },
  { sym:"DOGE", label:"Dogecoin",      icon:"Ð",  cat:"crypto", region:"global" },
  { sym:"AVAX", label:"Avalanche",     icon:"A",  cat:"crypto", region:"global" },
  { sym:"LINK", label:"Chainlink",     icon:"L",  cat:"crypto", region:"global" },
  { sym:"BNB",  label:"BNB",           icon:"B",  cat:"crypto", region:"global" },
  { sym:"ADA",  label:"Cardano",       icon:"₳",  cat:"crypto", region:"global" },
  { sym:"SUI",  label:"Sui",           icon:"S",  cat:"crypto", region:"global" },
  { sym:"DOT",  label:"Polkadot",      icon:"●",  cat:"crypto", region:"global" },
];

const EQUITY_ASSETS = [
  // North America — S&P 500 top stocks
  { sym:"AAPL",  label:"Apple",          icon:"🍎", cat:"equities", region:"namerica" },
  { sym:"NVDA",  label:"Nvidia",         icon:"N",  cat:"equities", region:"namerica" },
  { sym:"MSFT",  label:"Microsoft",      icon:"W",  cat:"equities", region:"namerica" },
  { sym:"GOOGL", label:"Alphabet",       icon:"G",  cat:"equities", region:"namerica" },
  { sym:"AMZN",  label:"Amazon",         icon:"A",  cat:"equities", region:"namerica" },
  { sym:"META",  label:"Meta",           icon:"f",  cat:"equities", region:"namerica" },
  { sym:"TSLA",  label:"Tesla",          icon:"T",  cat:"equities", region:"namerica" },
  { sym:"MSTR",  label:"MicroStrategy", icon:"M",  cat:"equities", region:"namerica" },
  { sym:"AMD",   label:"AMD",            icon:"A",  cat:"equities", region:"namerica" },
  { sym:"PLTR",  label:"Palantir",       icon:"P",  cat:"equities", region:"namerica" },
  { sym:"COIN",  label:"Coinbase",       icon:"C",  cat:"equities", region:"namerica" },
  { sym:"NFLX",  label:"Netflix",        icon:"N",  cat:"equities", region:"namerica" },
  { sym:"JPM",   label:"JPMorgan",       icon:"J",  cat:"equities", region:"namerica" },
  { sym:"V",     label:"Visa",           icon:"V",  cat:"equities", region:"namerica" },
  { sym:"XOM",   label:"ExxonMobil",     icon:"X",  cat:"equities", region:"namerica" },
  { sym:"WMT",   label:"Walmart",        icon:"W",  cat:"equities", region:"namerica" },
  { sym:"BAC",   label:"Bank of America",icon:"B",  cat:"equities", region:"namerica" },
  { sym:"UNH",   label:"UnitedHealth",   icon:"U",  cat:"equities", region:"namerica" },
  { sym:"DIS",   label:"Disney",         icon:"D",  cat:"equities", region:"namerica" },
  { sym:"CRM",   label:"Salesforce",     icon:"S",  cat:"equities", region:"namerica" },
  // Canada — TSX
  { sym:"RY",    label:"Royal Bank CA",  icon:"R",  cat:"equities", region:"namerica" },
  { sym:"TD",    label:"TD Bank",        icon:"T",  cat:"equities", region:"namerica" },
  { sym:"CNQ",   label:"Canadian Nat.",  icon:"C",  cat:"equities", region:"namerica" },
  { sym:"SU",    label:"Suncor Energy",  icon:"S",  cat:"equities", region:"namerica" },
  { sym:"BCE",   label:"BCE Inc.",       icon:"B",  cat:"equities", region:"namerica" },
  // Europe — FTSE 100, DAX, CAC 40
  { sym:"ASML",  label:"ASML",          icon:"A",  cat:"equities", region:"europe" },
  { sym:"SAP",   label:"SAP SE",        icon:"S",  cat:"equities", region:"europe" },
  { sym:"NESN",  label:"Nestlé",        icon:"N",  cat:"equities", region:"europe", halal:false },
  { sym:"LVMH",  label:"LVMH",          icon:"L",  cat:"equities", region:"europe", halal:false },
  { sym:"SHEL",  label:"Shell",         icon:"S",  cat:"equities", region:"europe" },
  { sym:"HSBA",  label:"HSBC",          icon:"H",  cat:"equities", region:"europe", halal:false },
  { sym:"AZN",   label:"AstraZeneca",   icon:"A",  cat:"equities", region:"europe" },
  { sym:"NVO",   label:"Novo Nordisk",  icon:"N",  cat:"equities", region:"europe" },
  { sym:"SIEGY", label:"Siemens",       icon:"S",  cat:"equities", region:"europe" },
  { sym:"TTE",   label:"TotalEnergies", icon:"T",  cat:"equities", region:"europe" },
  { sym:"BP",    label:"BP plc",        icon:"B",  cat:"equities", region:"europe" },
  { sym:"ULVR",  label:"Unilever",      icon:"U",  cat:"equities", region:"europe" },
  // Middle East
  { sym:"2222.SR", label:"Saudi Aramco", icon:"🛢", cat:"equities", region:"mideast", halal:true },
  { sym:"2010.SR", label:"SABIC",        icon:"S",  cat:"equities", region:"mideast", halal:true },
  { sym:"EMIRATESNBD", label:"Emirates NBD", icon:"E", cat:"equities", region:"mideast", halal:true },
  { sym:"QNBK",  label:"QNB Group",     icon:"Q",  cat:"equities", region:"mideast", halal:true },
  { sym:"ADNOCDIST", label:"ADNOC Dist.", icon:"A", cat:"equities", region:"mideast", halal:true },
  { sym:"ETISALAT", label:"e& (Etisalat)",icon:"e", cat:"equities", region:"mideast", halal:true },
  // Asia — Nikkei, Hang Seng
  { sym:"TSM",   label:"TSMC",          icon:"T",  cat:"equities", region:"asia" },
  { sym:"BABA",  label:"Alibaba",       icon:"A",  cat:"equities", region:"asia" },
  { sym:"TCEHY", label:"Tencent",       icon:"T",  cat:"equities", region:"asia" },
  { sym:"005930", label:"Samsung Elec.", icon:"S",  cat:"equities", region:"asia" },
  { sym:"9984.T", label:"SoftBank",     icon:"S",  cat:"equities", region:"asia" },
  { sym:"7203.T", label:"Toyota",       icon:"T",  cat:"equities", region:"asia" },
  { sym:"7974.T", label:"Nintendo",     icon:"N",  cat:"equities", region:"asia" },
  { sym:"0700.HK", label:"Tencent HK",  icon:"T",  cat:"equities", region:"asia" },
  { sym:"PDD",   label:"PDD Holdings",  icon:"P",  cat:"equities", region:"asia" },
  { sym:"JD",    label:"JD.com",        icon:"J",  cat:"equities", region:"asia" },
  { sym:"RELIANCE", label:"Reliance Ind.",icon:"R", cat:"equities", region:"asia" },
  { sym:"INFY",  label:"Infosys",       icon:"I",  cat:"equities", region:"asia" },
];

const COMMODITY_ASSETS = [
  // Metals
  { sym:"XAU",      label:"Gold",         icon:"Au",  cat:"commodities", region:"global", halal:true },
  { sym:"XAG",      label:"Silver",       icon:"Ag",  cat:"commodities", region:"global", halal:true },
  { sym:"COPPER",   label:"Copper",       icon:"Cu",  cat:"commodities", region:"global" },
  { sym:"PLATINUM", label:"Platinum",     icon:"Pt",  cat:"commodities", region:"global", halal:true },
  { sym:"PALLADIUM",label:"Palladium",    icon:"Pd",  cat:"commodities", region:"global", halal:true },
  // Energy
  { sym:"WTI",      label:"WTI Crude",    icon:"⛽",  cat:"commodities", region:"mideast" },
  { sym:"BRENT",    label:"Brent Crude",  icon:"🛢",  cat:"commodities", region:"mideast" },
  { sym:"NATGAS",   label:"Natural Gas",  icon:"🔥",  cat:"commodities", region:"global" },
  { sym:"URANIUM",  label:"Uranium",      icon:"☢",  cat:"commodities", region:"global" },
  { sym:"DUBAI",    label:"Dubai Crude",  icon:"🏙",  cat:"commodities", region:"mideast" },
  { sym:"LNG",      label:"LNG",          icon:"🚢",  cat:"commodities", region:"mideast" },
  // Agriculture
  { sym:"WHEAT",    label:"Wheat",        icon:"🌾",  cat:"commodities", region:"global", halal:true },
  { sym:"CORN",     label:"Corn",         icon:"🌽",  cat:"commodities", region:"global", halal:true },
  { sym:"SOYBEANS", label:"Soybeans",     icon:"🫘",  cat:"commodities", region:"global", halal:true },
  { sym:"COFFEE",   label:"Coffee",       icon:"☕",  cat:"commodities", region:"global", halal:true },
  { sym:"SUGAR",    label:"Sugar",        icon:"🍬",  cat:"commodities", region:"global", halal:true },
];

const ALL_ASSETS = [...CRYPTO_ASSETS, ...EQUITY_ASSETS, ...COMMODITY_ASSETS];

const STYLES = [
  { key:"scalp", label:"Scalp",  desc:"Minutes–hours · Tight stops",   color:C.cyan   },
  { key:"day",   label:"Day",    desc:"Intraday · Close flat",          color:C.green  },
  { key:"swing", label:"Swing",  desc:"Days–weeks · Trend follow",      color:C.purple },
];

const REGIONS = [
  { k:"all",      label:"All",         flag:"🌍" },
  { k:"namerica", label:"N. America",  flag:"🇺🇸" },
  { k:"europe",   label:"Europe",      flag:"🇪🇺" },
  { k:"mideast",  label:"Mid East",    flag:"🌙" },
  { k:"asia",     label:"Asia",        flag:"🌏" },
  { k:"global",   label:"Global",      flag:"🔗" },
];

const CATS = [
  { k:"all",        label:"All"         },
  { k:"crypto",     label:"Crypto"      },
  { k:"equities",   label:"Equities"    },
  { k:"commodities",label:"Commodities" },
];

export default function MyBasket({ isPro, onUpgrade, storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices }) {
  const [selected, setSelected]     = useState(new Set(["BTC","ETH","XAU"]));
  const [style, setStyle]           = useState("swing");
  const [cat, setCat]               = useState("all");
  const [region, setRegion]         = useState("all");
  const [search, setSearch]         = useState("");
  const [priceView, setPriceView]   = useState("spot"); // "spot" | "perp"
  const [basketResult, setBasketResult] = useState("");
  const [basketData, setBasketData] = useState(null);
  const [basketLoading, setBasketLoading] = useState(false);
  const [openPanel, setOpenPanel]   = useState(true);
  const [showHalalOnly, setShowHalalOnly] = useState(false);
  const [marketType, setMarketType] = useState("BOTH"); // PERP | SPOT | BOTH

  // ── Live prices for ALL 140+ basket assets ──────────────────────────────────
  const [bPrices, setBPrices]       = useState({});  // { sym: { price, chg, currency, live } }
  const [pricesLoading, setPricesLoading] = useState(false);
  const [lastPriceFetch, setLastPriceFetch] = useState(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    const doFetch = async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      setPricesLoading(true);
      try {
        const allSyms = ALL_ASSETS.map(a => a.sym).join(",");
        const r = await fetch(`/api/basket-prices?syms=${encodeURIComponent(allSyms)}`, { credentials:"include" });
        if (r.ok) {
          const data = await r.json();
          setBPrices(data);
          setLastPriceFetch(Date.now());
        }
      } catch(e) {
        console.warn("[MyBasket] price fetch failed:", e.message);
      } finally {
        setPricesLoading(false);
        isFetchingRef.current = false;
      }
    };
    doFetch();
    const interval = setInterval(doFetch, 60000);
    return () => clearInterval(interval);
  }, []);  // run once on mount, refresh every 60s

  const toggleAsset = useCallback((sym) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sym)) { next.delete(sym); }
      else { if (next.size >= MAX_ASSETS) return prev; next.add(sym); }
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let list = ALL_ASSETS;
    if (cat !== "all") list = list.filter(a => a.cat === cat);
    if (region !== "all") list = list.filter(a => a.region === region);
    if (showHalalOnly) list = list.filter(a => a.halal === true);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(a => a.sym.toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
    }
    return list;
  }, [cat, region, search, showHalalOnly]);

  const fmtPrice = useCallback((price, currency) => {
    if (!price || price === 0) return null;
    const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "CAD" ? "CA$" : "$";
    if (price >= 1000) return `${symbol}${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (price >= 1)    return `${symbol}${price.toFixed(2)}`;
    if (price >= 0.01) return `${symbol}${price.toFixed(4)}`;
    return `${symbol}${price.toFixed(6)}`;
  }, []);

  const getPriceSnap = useCallback((sym) => {
    const fmtChg = (c) => c != null ? ` (${c >= 0 ? "+" : ""}${c.toFixed(2)}%)` : "";
    const crypto = cryptoPrices?.[sym];
    const equity = equityPrices?.[sym];
    const metal  = metalPrices?.[sym];
    const perp   = storePerps?.[sym];
    const bp     = bPrices?.[sym];

    // Determine category — matches Markets tab SPOT data source routing
    if (crypto?.price > 0) {
      // Crypto: Markets tab uses cryptoPrices (Finnhub spot); perp for funding info
      const fund = perp?.funding != null ? ` Fund:${(perp.funding * 100).toFixed(4)}%/8h` : "";
      const chg = fmtChg(crypto.chg ?? perp?.change24h);
      return `${fmtPrice(crypto.price, "USD")}${chg}${fund} [LIVE]`;
    }
    if (equity?.price > 0) {
      // Equities: Markets tab SPOT uses equityPrices (Finnhub WS) — match exactly
      return `${fmtPrice(equity.price, "USD")}${fmtChg(equity.chg)} [LIVE]`;
    }
    if (metal?.price > 0) {
      // Commodities: Markets tab uses metalPrices (Gold-API / Finnhub) — match exactly
      return `${fmtPrice(metal.price, "USD")}${fmtChg(metal.chg)} [LIVE]`;
    }
    // Fallback — basket REST API (intl stocks, assets not in live feeds)
    if (bp?.price > 0) {
      const liveTag = bp.live ? " [LIVE]" : " [est]";
      return `${fmtPrice(bp.price, bp.currency)}${fmtChg(bp.chg)}${liveTag}`;
    }
    return "loading…";
  }, [storePerps, cryptoPrices, equityPrices, metalPrices, bPrices, fmtPrice]);

  const runBasket = useCallback(async () => {
    if (selected.size === 0 || basketLoading) return;
    setBasketLoading(true);
    setBasketResult("");
    setBasketData(null);
    const syms = [...selected];
    const priceData = syms.map(sym => `${sym}: ${getPriceSnap(sym)}`).join(" | ");
    const styleObj = STYLES.find(s => s.key === style);
    const styleDesc = styleObj ? `${styleObj.label} (${styleObj.desc})` : style;
    const styleKey = (styleObj?.label || style).toUpperCase();

    const mtRule = marketType === "PERP"
      ? `MARKET TYPE: PERP ONLY (leveraged perpetual futures). Every crypto signal must set "marketType":"PERP" and include a leverage suggestion. Tight SL. Thesis should reference funding/OI when relevant. Non-crypto assets (equities, commodities, FX) always use "marketType":"SPOT", "leverage":"1x".`
      : marketType === "SPOT"
      ? `MARKET TYPE: SPOT ONLY (cash / no leverage). Every signal must set "marketType":"SPOT" and "leverage":"1x". SL can be wider, kill clock longer, thesis should reference accumulation zones / DCA / portfolio allocation.`
      : `MARKET TYPE: BOTH. Mix PERP and SPOT. Label each crypto signal "marketType":"PERP" (with leverage) or "SPOT" ("leverage":"1x"). Non-crypto assets always SPOT, "leverage":"1x".`;

    const system = `You are CLVR AI's Basket Analyst — multi-asset portfolio specialist (crypto, US/EU/Asia/MidEast equities, commodities, FX). You MUST respond with ONLY valid JSON — no conversational text, no preamble, no "let me analyze", no markdown fences. Start with { and end with }.

${mtRule}

STYLE RULES:
- SCALP: stops 1–1.5%, TP1 1.5–2.5%, leverage up to 10x (perp), kill clock 2–4H
- DAY: stops 1.5–3%, TP1 2.5–5%, leverage up to 5x (perp), kill clock 12–24H
- SWING: stops 4–7%, TP1 6–12%, leverage up to 3x (perp), kill clock 48–72H

Return this EXACT JSON structure — one object per asset the user selected. NEVER skip an asset. If an asset has no valid setup, include it with "direction":"NEUTRAL" and explain why in thesis.

{
  "generated": "ISO-8601 timestamp",
  "style": "${styleKey}",
  "overallStance": "Risk-on | Risk-off | Mixed",
  "correlationNote": "One sentence on correlation risk across the basket.",
  "highestConviction": "TICKER",
  "basket": [
    {
      "asset": "BTC",
      "direction": "LONG",
      "tradeType": "${styleKey}",
      "marketType": "PERP",
      "entry": 75138,
      "tp1": {"price": 76500, "pct": 50, "rr": "1.4:1"},
      "tp2": {"price": 78000, "pct": 30, "rr": "2.1:1"},
      "sl": 73500,
      "leverage": "5x",
      "weight": 25,
      "conviction": 72,
      "thesis": "Two sentences max.",
      "invalidation": "One sentence.",
      "killClock": "72H"
    }
  ]
}`;

    const userMessage = `Analyze my basket and return ${styleKey} signals as valid JSON only.

MY BASKET (${syms.length} assets): ${syms.join(", ")}
TRADING STYLE: ${styleDesc}
MARKET TYPE: ${marketType}
LIVE PRICES: ${priceData}

Return one signal object per asset. Do NOT skip any. If no setup, use direction:"NEUTRAL" and explain in thesis. JSON ONLY — no prose.`;

    try {
      const r = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, userMessage, maxTokens: 6144 }),
      });
      const data = await r.json();
      if (!r.ok) {
        setBasketResult(data.error || `Error ${r.status}`);
        return;
      }
      const text = data.text || "";
      // Try to parse JSON
      try {
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : cleaned);
        if (parsed && Array.isArray(parsed.basket) && parsed.basket.length > 0) {
          setBasketData(parsed);
        } else {
          console.error("[Basket] JSON parsed but no basket array:", parsed);
          setBasketResult(text || "No response.");
        }
      } catch (e) {
        console.error("[Basket] Failed to parse JSON response:", e?.message);
        console.error("[Basket] Raw response (first 500):", text.substring(0, 500));
        setBasketResult(text || "Failed to parse response.");
      }
    } catch (e) {
      setBasketResult(`Error: ${e.message}`);
    } finally {
      setBasketLoading(false);
    }
  }, [selected, style, marketType, basketLoading, getPriceSnap]);

  if (!isPro) {
    return (
      <div data-testid="progate-my-basket" style={{ position:"relative" }}>
        <div style={{ filter:"blur(4px)", opacity:0.3, pointerEvents:"none", maxHeight:160, overflow:"hidden" }}>
          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:14 }}>
            <div style={{ fontFamily:MONO, fontSize:10, color:C.purple, letterSpacing:"0.15em", marginBottom:8 }}>MY BASKET · GLOBAL AI</div>
            <div style={{ display:"flex", gap:6 }}>
              {["BTC","NVDA","XAU","2222.SR","ASML"].map(s => (
                <div key={s} style={{ padding:"6px 12px", background:C.border, borderRadius:4, fontFamily:MONO, fontSize:10, color:C.muted }}>{s}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(5,7,9,.85)", backdropFilter:"blur(8px)", borderRadius:4 }}>
          <div style={{ fontFamily:SERIF, fontWeight:900, fontSize:16, color:"#e8c96d", marginBottom:4, textShadow:"0 0 12px rgba(201,168,76,.5)" }}>Elite Feature</div>
          <div style={{ fontFamily:MONO, fontSize:9, color:C.muted2, letterSpacing:"0.12em", marginBottom:12, textTransform:"uppercase" }}>My Basket · Global AI · 140+ Assets</div>
          <button data-testid="btn-upgrade-my-basket" onClick={onUpgrade} style={{ background:"rgba(201,168,76,.18)", border:`1px solid rgba(201,168,76,.55)`, borderRadius:2, padding:"8px 20px", fontFamily:SERIF, fontStyle:"italic", fontWeight:700, fontSize:13, color:"#e8c96d", cursor:"pointer", boxShadow:"0 0 16px rgba(201,168,76,.2)" }}>Upgrade to Elite ⚡</button>
        </div>
      </div>
    );
  }

  const selList = [...selected];

  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, marginBottom:10, overflow:"hidden" }}>
      {/* Header */}
      <div onClick={() => setOpenPanel(o => !o)} style={{ padding:"11px 14px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontFamily:MONO, fontSize:9, color:C.purple, letterSpacing:"0.18em" }}>MY BASKET</span>
          <span style={{ fontFamily:MONO, fontSize:8, color:C.muted, background:"rgba(168,85,247,.08)", border:`1px solid rgba(168,85,247,.2)`, borderRadius:2, padding:"2px 7px" }}>GLOBAL AI · 140+ ASSETS</span>
          {selList.length > 0 && (
            <span style={{ fontFamily:MONO, fontSize:8, color:C.purple }}>{selList.length}/{MAX_ASSETS}</span>
          )}
          {pricesLoading ? (
            <span style={{ fontFamily:MONO, fontSize:7, color:C.muted, letterSpacing:"0.1em" }}>⟳ LOADING PRICES…</span>
          ) : lastPriceFetch ? (
            <span style={{ fontFamily:MONO, fontSize:7, color:C.green, letterSpacing:"0.1em" }}>● LIVE</span>
          ) : null}
        </div>
        <span style={{ fontFamily:MONO, fontSize:9, color:C.muted }}>{openPanel ? "▲" : "▼"}</span>
      </div>

      {openPanel && (
        <div style={{ padding:14 }}>

          {/* ── Search bar ── */}
          <div style={{ position:"relative", marginBottom:10 }}>
            <input
              data-testid="basket-search"
              type="text"
              placeholder="Search ticker or name… e.g. ASML, Gold, Samsung"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width:"100%", background:"rgba(8,13,24,.8)", border:`1px solid ${search ? C.purple : C.border}`, borderRadius:3, padding:"8px 32px 8px 10px", fontFamily:MONO, fontSize:10, color:C.text, letterSpacing:"0.04em", outline:"none", boxSizing:"border-box" }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.muted, fontSize:14, cursor:"pointer", padding:0, lineHeight:1 }}>×</button>
            )}
          </div>

          {/* ── Category + Region filters ── */}
          <div style={{ display:"flex", gap:4, marginBottom:6, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            {CATS.map(c => (
              <button key={c.k} data-testid={`basket-cat-${c.k}`} onClick={() => setCat(c.k)} style={{ flexShrink:0, padding:"4px 10px", borderRadius:2, border:`1px solid ${cat===c.k ? C.purple : C.border}`, background:cat===c.k ? "rgba(168,85,247,.1)" : "transparent", color:cat===c.k ? C.purple : C.muted, fontFamily:MONO, fontSize:8, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display:"flex", gap:4, marginBottom:8, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            {REGIONS.map(r => (
              <button key={r.k} data-testid={`basket-region-${r.k}`} onClick={() => setRegion(r.k)} style={{ flexShrink:0, padding:"4px 10px", borderRadius:2, border:`1px solid ${region===r.k ? C.blue : C.border}`, background:region===r.k ? "rgba(59,130,246,.1)" : "transparent", color:region===r.k ? C.blue : C.muted, fontFamily:MONO, fontSize:8, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
                {r.flag} {r.label}
              </button>
            ))}
            <button data-testid="basket-halal-toggle" onClick={() => setShowHalalOnly(h => !h)} style={{ flexShrink:0, padding:"4px 10px", borderRadius:2, border:`1px solid ${showHalalOnly ? C.halal : C.border}`, background:showHalalOnly ? "rgba(34,197,94,.1)" : "transparent", color:showHalalOnly ? C.halal : C.muted, fontFamily:MONO, fontSize:8, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
              ☪ Halal
            </button>
          </div>

          {/* ── Price view toggle: SPOT / PERP ── */}
          <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:8 }}>
            <span style={{ fontFamily:MONO, fontSize:7, color:C.muted, letterSpacing:"0.08em", marginRight:2 }}>PRICE:</span>
            {[["spot","SPOT · FINNHUB"],["perp","PERP · HYPERLIQUID"]].map(([k,lbl]) => (
              <button
                key={k}
                data-testid={`basket-priceview-${k}`}
                onClick={() => setPriceView(k)}
                style={{ padding:"3px 9px", borderRadius:2, border:`1px solid ${priceView===k ? C.gold : C.border}`, background:priceView===k ? "rgba(201,168,76,.1)" : "transparent", color:priceView===k ? C.gold : C.muted, fontFamily:MONO, fontSize:7, cursor:"pointer", letterSpacing:"0.06em", whiteSpace:"nowrap" }}
              >{lbl}</button>
            ))}
          </div>

          {/* ── Asset grid ── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:4, marginBottom:12, maxHeight:280, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
            {filtered.length === 0 && (
              <div style={{ gridColumn:"1 / -1", textAlign:"center", padding:"18px 0", fontFamily:MONO, fontSize:9, color:C.muted }}>
                No assets match your filters
              </div>
            )}
            {filtered.map(({ sym, label, cat:assetCat, halal }) => {
              const active = selected.has(sym);
              const blocked = !active && selected.size >= MAX_ASSETS;
              const catColor = assetCat === "crypto" ? C.cyan : assetCat === "equities" ? C.blue : C.gold;
              // Live price — route by priceView toggle (SPOT matches Markets tab; PERP matches HL perps)
              const bp     = bPrices?.[sym];
              const perp   = storePerps?.[sym];
              const crypto = cryptoPrices?.[sym];
              const equity = equityPrices?.[sym];
              const metal  = metalPrices?.[sym];
              let rawPrice, rawChg, isLive;
              if (priceView === "perp" && perp?.price) {
                // PERP mode — Hyperliquid perpetual (same as Markets tab PERP sub-tab)
                rawPrice = perp.price;
                rawChg   = perp.change24h ?? 0;
                isLive   = true;
              } else {
                // SPOT mode — same sources as Markets tab SPOT sub-tab per category
                rawPrice =
                  assetCat === "crypto"      ? (crypto?.price  || bp?.price) :
                  assetCat === "equities"    ? (equity?.price  || bp?.price) :
                  assetCat === "commodities" ? (metal?.price   || bp?.price) :
                                               bp?.price;
                rawChg =
                  assetCat === "crypto"      ? (crypto?.chg  ?? bp?.chg ?? 0) :
                  assetCat === "equities"    ? (equity?.chg  ?? bp?.chg ?? 0) :
                  assetCat === "commodities" ? (metal?.chg   ?? bp?.chg ?? 0) :
                                               (bp?.chg ?? 0);
                isLive =
                  assetCat === "crypto"      ? !!(crypto?.price) :
                  assetCat === "equities"    ? !!(equity?.price || bp?.live) :
                  assetCat === "commodities" ? !!(metal?.price  || bp?.live) :
                                               !!bp?.live;
              }
              const currency = bp?.currency || "USD";
              const priceStr = rawPrice ? fmtPrice(rawPrice, currency) : (pricesLoading ? "…" : "—");
              const chgColor = rawChg > 0 ? C.green : rawChg < 0 ? C.red : C.muted;
              return (
                <button key={sym} data-testid={`basket-asset-${sym}`} onClick={() => !blocked && toggleAsset(sym)}
                  style={{ padding:"6px 4px 5px", borderRadius:3, border:`1px solid ${active ? C.purple : C.border}`, background:active ? "rgba(168,85,247,.12)" : blocked ? "rgba(8,13,24,.3)" : "rgba(8,13,24,.6)", cursor:blocked ? "not-allowed" : "pointer", textAlign:"center", position:"relative", opacity:blocked ? 0.45 : 1 }}>
                  {active && <div style={{ position:"absolute", top:3, right:4, width:5, height:5, borderRadius:"50%", background:C.purple }} />}
                  {isLive && !active && <div style={{ position:"absolute", top:3, right:4, width:4, height:4, borderRadius:"50%", background:C.green, opacity:0.7 }} />}
                  {halal === true && (
                    <div style={{ position:"absolute", top:2, left:3, fontFamily:MONO, fontSize:6, color:C.halal, letterSpacing:"-0.02em", lineHeight:1 }}>☪</div>
                  )}
                  <div style={{ fontFamily:MONO, fontSize:8, fontWeight:700, color:active ? C.purple : C.muted2, lineHeight:1.2 }}>{sym.length > 7 ? sym.slice(0,7) : sym}</div>
                  <div style={{ fontFamily:SANS, fontSize:6.5, color:blocked ? C.muted : active ? `${C.purple}bb` : C.muted, marginTop:1, lineHeight:1.2, display:"-webkit-box", WebkitLineClamp:1, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{label}</div>
                  {priceStr && priceStr !== "—" ? (
                    <div style={{ fontFamily:MONO, fontSize:7, color:active ? C.purple : C.text, marginTop:2, lineHeight:1, letterSpacing:"-0.02em" }}>{priceStr}</div>
                  ) : null}
                  {rawChg !== 0 ? (
                    <div style={{ fontFamily:MONO, fontSize:6, color:chgColor, lineHeight:1, marginTop:1 }}>{rawChg >= 0 ? "+" : ""}{rawChg.toFixed(2)}%</div>
                  ) : null}
                  <div style={{ width:14, height:2, background:catColor, borderRadius:1, margin:"3px auto 0", opacity:0.5 }} />
                </button>
              );
            })}
          </div>

          {/* ── Legend ── */}
          <div style={{ display:"flex", gap:10, marginBottom:10, flexWrap:"wrap" }}>
            {[["crypto",C.cyan],["equities",C.blue],["commodities",C.gold]].map(([l,c]) => (
              <div key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <div style={{ width:12, height:3, background:c, borderRadius:1 }} />
                <span style={{ fontFamily:MONO, fontSize:7, color:C.muted, textTransform:"uppercase" }}>{l}</span>
              </div>
            ))}
            <div style={{ display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:8, color:C.halal }}>☪</span>
              <span style={{ fontFamily:MONO, fontSize:7, color:C.muted }}>Shariah-compliant</span>
            </div>
          </div>

          {/* ── Selected basket pills ── */}
          {selList.length > 0 && (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10, padding:"8px 10px", background:"rgba(168,85,247,.04)", border:`1px solid rgba(168,85,247,.15)`, borderRadius:3 }}>
              <span style={{ fontFamily:MONO, fontSize:8, color:C.muted, alignSelf:"center" }}>BASKET ({selList.length}/{MAX_ASSETS}):</span>
              {selList.map(sym => {
                const asset = ALL_ASSETS.find(a => a.sym === sym);
                return (
                  <span key={sym} onClick={() => toggleAsset(sym)} style={{ fontFamily:MONO, fontSize:8, color:C.purple, background:"rgba(168,85,247,.12)", border:`1px solid rgba(168,85,247,.3)`, borderRadius:2, padding:"2px 8px", cursor:"pointer", display:"flex", alignItems:"center", gap:3 }}>
                    {asset?.halal === true && <span style={{ fontSize:7, color:C.halal }}>☪</span>}
                    {sym} ×
                  </span>
                );
              })}
              {selected.size < MAX_ASSETS && (
                <span style={{ fontFamily:MONO, fontSize:7, color:C.muted, alignSelf:"center" }}>{MAX_ASSETS - selected.size} more</span>
              )}
            </div>
          )}

          {/* ── Style selector ── */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontFamily:MONO, fontSize:8, color:C.muted, letterSpacing:"0.12em", marginBottom:6 }}>TRADING STYLE</div>
            <div style={{ display:"flex", gap:5 }}>
              {STYLES.map(s => (
                <button key={s.key} data-testid={`basket-style-${s.key}`} onClick={() => setStyle(s.key)} style={{ flex:1, padding:"8px 6px", borderRadius:3, border:`1px solid ${style===s.key ? s.color : C.border}`, background:style===s.key ? `${s.color}12` : "transparent", cursor:"pointer", textAlign:"center" }}>
                  <div style={{ fontFamily:MONO, fontSize:9, fontWeight:700, color:style===s.key ? s.color : C.muted }}>{s.label}</div>
                  <div style={{ fontFamily:SANS, fontSize:7, color:C.muted, marginTop:2, lineHeight:1.3 }}>{s.desc.split("·")[0].trim()}</div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Market type selector ── */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontFamily:MONO, fontSize:8, color:C.muted, letterSpacing:"0.12em", marginBottom:6 }}>MARKET TYPE</div>
            <div style={{ display:"flex", gap:5 }}>
              {[
                { k:"PERP", col:C.cyan, desc:"Leveraged" },
                { k:"SPOT", col:C.purple, desc:"Cash · 1x" },
                { k:"BOTH", col:C.gold, desc:"Mix" },
              ].map(m => (
                <button key={m.k} data-testid={`basket-market-${m.k}`} onClick={() => setMarketType(m.k)} style={{ flex:1, padding:"7px 6px", borderRadius:3, border:`1px solid ${marketType===m.k ? m.col : C.border}`, background:marketType===m.k ? `${m.col}12` : "transparent", cursor:"pointer", textAlign:"center" }}>
                  <div style={{ fontFamily:MONO, fontSize:9, fontWeight:700, color:marketType===m.k ? m.col : C.muted, letterSpacing:"0.06em" }}>{m.k}</div>
                  <div style={{ fontFamily:SANS, fontSize:7, color:C.muted, marginTop:2, lineHeight:1.3 }}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Run button ── */}
          <button data-testid="btn-run-basket" onClick={runBasket} disabled={basketLoading || selected.size === 0}
            style={{ width:"100%", padding:"13px 14px", borderRadius:3, border:`1px solid ${selected.size===0 ? C.border : "rgba(168,85,247,.4)"}`, background:selected.size===0 ? "transparent" : "rgba(168,85,247,.08)", color:basketLoading || selected.size===0 ? C.muted : C.purple, fontFamily:SERIF, fontStyle:"italic", fontWeight:700, fontSize:14, cursor:basketLoading || selected.size===0 ? "not-allowed" : "pointer", letterSpacing:"0.02em" }}>
            {basketLoading ? "Analyzing Global Basket…" : selected.size===0 ? "Select up to 5 assets above" : `Analyze My ${STYLES.find(s=>s.key===style)?.label} Basket (${selList.length} asset${selList.length!==1?"s":""}) ✦`}
          </button>

          {/* ── Structured result (JSON) ── */}
          {basketData && Array.isArray(basketData.basket) && basketData.basket.length > 0 && (
            <div data-testid="basket-result-cards" style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
              {/* Portfolio header */}
              {(basketData.overallStance || basketData.correlationNote || basketData.highestConviction) && (
                <div style={{ background:"rgba(168,85,247,.06)", border:`1px solid rgba(168,85,247,.2)`, borderRadius:3, padding:"10px 12px" }}>
                  <div style={{ fontFamily:MONO, fontSize:8, color:C.purple, letterSpacing:"0.14em", marginBottom:6 }}>PORTFOLIO SUMMARY</div>
                  {basketData.overallStance && (
                    <div style={{ fontFamily:MONO, fontSize:10, color:C.text, marginBottom:4 }}>
                      <span style={{ color:C.muted }}>Stance:</span> <span style={{ color:C.gold, fontWeight:700 }}>{basketData.overallStance}</span>
                    </div>
                  )}
                  {basketData.highestConviction && (
                    <div style={{ fontFamily:MONO, fontSize:10, color:C.text, marginBottom:4 }}>
                      <span style={{ color:C.muted }}>Highest conviction:</span> <span style={{ color:C.green, fontWeight:700 }}>{basketData.highestConviction}</span>
                    </div>
                  )}
                  {basketData.correlationNote && (
                    <div style={{ fontFamily:SANS, fontSize:11, color:C.text, lineHeight:1.5, marginTop:6 }}>{basketData.correlationNote}</div>
                  )}
                </div>
              )}
              {/* Per-asset signal cards */}
              {basketData.basket.map((t, i) => {
                const dirColor = t.direction === "LONG" ? C.green : t.direction === "SHORT" ? C.red : C.muted2;
                const mtColor = t.marketType === "PERP" ? C.cyan : t.marketType === "SPOT" ? C.purple : C.gold;
                const fmt = (v) => {
                  if (v == null || v === "") return "—";
                  const n = typeof v === "number" ? v : parseFloat(v);
                  if (!isFinite(n)) return String(v);
                  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits:0 });
                  if (n >= 1)    return n.toFixed(2);
                  if (n >= 0.01) return n.toFixed(4);
                  return n.toFixed(6);
                };
                return (
                  <div key={`${t.asset}-${i}`} data-testid={`basket-card-${t.asset}`} style={{ background:"#080d18", border:`1px solid ${C.border}`, borderRadius:3, padding:"11px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                      <span style={{ fontFamily:SERIF, fontSize:14, fontWeight:700, color:C.white }}>{t.asset}</span>
                      <span style={{ fontFamily:MONO, fontSize:9, fontWeight:700, color:dirColor, background:`${dirColor}18`, border:`1px solid ${dirColor}55`, borderRadius:2, padding:"2px 7px", letterSpacing:"0.08em" }}>{t.direction || "—"}</span>
                      {t.marketType && (
                        <span style={{ fontFamily:MONO, fontSize:8, fontWeight:700, color:mtColor, background:`${mtColor}18`, border:`1px solid ${mtColor}55`, borderRadius:2, padding:"2px 6px", letterSpacing:"0.08em" }}>{t.marketType}</span>
                      )}
                      {t.tradeType && (
                        <span style={{ fontFamily:MONO, fontSize:7, color:C.muted, background:C.border, borderRadius:2, padding:"2px 6px", letterSpacing:"0.08em" }}>{t.tradeType}</span>
                      )}
                      {typeof t.conviction === "number" && (
                        <span style={{ marginLeft:"auto", fontFamily:MONO, fontSize:9, color:t.conviction>=70?C.green:t.conviction>=50?C.gold:C.muted2, fontWeight:700 }}>{t.conviction}%</span>
                      )}
                    </div>
                    {t.direction !== "NEUTRAL" && (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6, marginBottom:8 }}>
                        {[
                          { label:"ENTRY", val:fmt(t.entry), col:C.text },
                          { label:"SL",    val:fmt(t.sl),    col:C.red },
                          { label:"TP1",   val:fmt(t.tp1?.price ?? t.tp1), col:C.green, sub:t.tp1?.rr },
                          { label:"TP2",   val:fmt(t.tp2?.price ?? t.tp2), col:C.green, sub:t.tp2?.rr },
                        ].map(x => (
                          <div key={x.label} style={{ background:"rgba(12,18,32,.7)", border:`1px solid ${C.border}`, borderRadius:2, padding:"5px 7px" }}>
                            <div style={{ fontFamily:MONO, fontSize:6.5, color:C.muted, letterSpacing:"0.1em", marginBottom:2 }}>{x.label}</div>
                            <div style={{ fontFamily:MONO, fontSize:10, color:x.col, fontWeight:700 }}>{x.val}</div>
                            {x.sub && <div style={{ fontFamily:MONO, fontSize:7, color:C.muted2, marginTop:1 }}>{x.sub}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:6, fontFamily:MONO, fontSize:8, color:C.muted2 }}>
                      {t.leverage && <span>LEV <span style={{ color:C.text, fontWeight:700 }}>{t.leverage}</span></span>}
                      {t.killClock && <span>KILL <span style={{ color:C.text, fontWeight:700 }}>{t.killClock}</span></span>}
                      {typeof t.weight === "number" && <span>WEIGHT <span style={{ color:C.text, fontWeight:700 }}>{t.weight}%</span></span>}
                    </div>
                    {t.thesis && (
                      <div style={{ fontFamily:SANS, fontSize:11, color:C.text, lineHeight:1.5, marginTop:4 }}>{t.thesis}</div>
                    )}
                    {t.invalidation && (
                      <div style={{ fontFamily:MONO, fontSize:8, color:C.muted2, marginTop:6 }}>
                        <span style={{ color:C.red }}>✕ INVALIDATION:</span> <span style={{ color:C.text }}>{t.invalidation}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Fallback: raw text (JSON parse failed) ── */}
          {!basketData && basketResult && (
            <div data-testid="text-basket-result" style={{ marginTop:12, background:"#080d18", border:`1px solid ${C.border}`, borderRadius:3, padding:14, fontSize:12, lineHeight:1.9, color:C.text, whiteSpace:"pre-wrap", overflowY:"auto", WebkitOverflowScrolling:"touch", maxHeight:520 }}>
              {basketResult}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
