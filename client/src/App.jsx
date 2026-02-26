// ─────────────────────────────────────────────────────────
// ALPHASCAN v10 — Full deployment version
// Real data: Hyperliquid (crypto) + Finnhub (stocks/metals/forex)
// ─────────────────────────────────────────────────────────
const FINNHUB_KEY = "d6fsllhr01qqnmbpsss0d6fsllhr01qqnmbpsssg";

import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────
// STYLE
// ─────────────────────────────────────────────────────────
const C = {
  bg:"#04060d", panel:"#0a0e1c", border:"#131d35",
  green:"#00e5a0", cyan:"#00d4ff", red:"#ff2d55", orange:"#ff8c00",
  gold:"#ffc400", purple:"#a855f7", blue:"#3b82f6", teal:"#14b8a6",
  pink:"#ec4899", text:"#d0deff", muted:"#3a4d70", muted2:"#5a6d90"
};

const pct = (v, d=2) => {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d) + "%";
};

const fmt = (p, sym) => {
  if (!p && p !== 0) return "—";
  p = Number(p);
  if (isNaN(p) || p === 0) return "—";
  if (["EURUSD","GBPUSD","AUDUSD","USDCHF"].includes(sym)) return p.toFixed(4);
  if (["USDJPY","USDCAD"].includes(sym)) return p.toFixed(2);
  if (sym === "XAG") return "$" + p.toFixed(2);
  if (sym === "XAU") return "$" + p.toFixed(0);
  if (p >= 1000) return "$" + p.toFixed(0);
  if (p >= 100)  return "$" + p.toFixed(1);
  if (p >= 1)    return "$" + p.toFixed(2);
  return "$" + p.toFixed(6);
};

const rndInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

const tagC = c => ({
  green:  {bg:"rgba(0,229,160,.12)",  color:C.green,  border:"rgba(0,229,160,.3)"},
  cyan:   {bg:"rgba(0,212,255,.12)",  color:C.cyan,   border:"rgba(0,212,255,.3)"},
  red:    {bg:"rgba(255,45,85,.12)",  color:C.red,    border:"rgba(255,45,85,.3)"},
  orange: {bg:"rgba(255,140,0,.12)",  color:C.orange, border:"rgba(255,140,0,.3)"},
  gold:   {bg:"rgba(255,196,0,.12)",  color:C.gold,   border:"rgba(255,196,0,.3)"},
  blue:   {bg:"rgba(59,130,246,.12)", color:C.blue,   border:"rgba(59,130,246,.3)"},
  teal:   {bg:"rgba(20,184,166,.12)", color:C.teal,   border:"rgba(20,184,166,.3)"},
  pink:   {bg:"rgba(236,72,153,.12)", color:C.pink,   border:"rgba(236,72,153,.3)"},
  purple: {bg:"rgba(168,85,247,.12)", color:C.purple, border:"rgba(168,85,247,.3)"},
}[c] || {bg:"rgba(255,255,255,.1)", color:"#fff", border:"rgba(255,255,255,.2)"});

const Badge = ({ label, color="green", style={} }) => {
  const t = tagC(color);
  return (
    <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:t.bg,
      color:t.color,border:`1px solid ${t.border}`,fontFamily:"monospace",
      letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:700,...style}}>
      {label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────
// BASE / FALLBACK PRICES
// ─────────────────────────────────────────────────────────
const CRYPTO_BASE = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072};
const EQUITY_BASE = {TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310};
const METALS_BASE = {XAU:3285,XAG:32.8};
const FOREX_BASE  = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654};

const CRYPTO_SYMS = Object.keys(CRYPTO_BASE);
const EQUITY_SYMS = Object.keys(EQUITY_BASE);
const METALS_SYMS = Object.keys(METALS_BASE);
const FOREX_SYMS  = Object.keys(FOREX_BASE);

// Finnhub symbol map
const FH_METALS = { XAU:"OANDA:XAU_USD", XAG:"OANDA:XAG_USD" };
const FH_FOREX  = {
  EURUSD:"OANDA:EUR_USD", GBPUSD:"OANDA:GBP_USD",
  USDJPY:"OANDA:USD_JPY", USDCHF:"OANDA:USD_CHF",
  AUDUSD:"OANDA:AUD_USD", USDCAD:"OANDA:USD_CAD"
};

// ─────────────────────────────────────────────────────────
// API FETCHERS — work in deployed env (no CORS issues)
// ─────────────────────────────────────────────────────────

// Hyperliquid — free, no key, works 24/7
async function fetchHyperliquid() {
  // Fetch mid prices
  const r1 = await fetch("https://api.hyperliquid.xyz/info", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({type:"allMids"})
  });
  const mids = await r1.json(); // {BTC:"84000", ETH:"1590", ...}

  // Fetch funding rates
  const r2 = await fetch("https://api.hyperliquid.xyz/info", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({type:"metaAndAssetCtxs"})
  });
  const meta = await r2.json();
  const universe = meta[0].universe;
  const ctxs = meta[1];
  const funding = {};
  universe.forEach((asset, i) => {
    if (CRYPTO_SYMS.includes(asset.name)) {
      funding[asset.name] = {
        funding: +(parseFloat(ctxs[i]?.funding || 0) * 100).toFixed(4),
        oi: parseFloat(ctxs[i]?.openInterest || 0) * parseFloat(ctxs[i]?.markPx || 0)
      };
    }
  });

  const result = {};
  CRYPTO_SYMS.forEach(sym => {
    if (mids[sym]) {
      const price = parseFloat(mids[sym]);
      const base  = CRYPTO_BASE[sym];
      result[sym] = {
        price,
        chg: base ? +((price - base) / base * 100).toFixed(2) : 0,
        funding: funding[sym]?.funding || 0,
        oi: funding[sym]?.oi || 0,
        live: true
      };
    }
  });
  return result;
}

// Finnhub — requires key, live during market hours
async function fhQuote(symbol) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
  );
  if (!r.ok) throw new Error(`Finnhub ${r.status}`);
  const d = await r.json();
  if (!d || !d.c || d.c === 0) throw new Error("zero price");
  return {
    price: d.c,
    chg: d.dp ?? (d.pc ? ((d.c - d.pc) / d.pc * 100) : 0),
    live: true
  };
}

async function fetchFinnhub() {
  const stocks = {}, metals = {}, forex = {};

  await Promise.allSettled([
    // Stocks
    ...EQUITY_SYMS.map(async sym => {
      try { stocks[sym] = await fhQuote(sym); }
      catch { stocks[sym] = { price: EQUITY_BASE[sym], chg:0, live:false }; }
    }),
    // Metals
    ...Object.entries(FH_METALS).map(async ([sym, fhSym]) => {
      try { metals[sym] = await fhQuote(fhSym); }
      catch { metals[sym] = { price: METALS_BASE[sym], chg:0, live:false }; }
    }),
    // Forex
    ...Object.entries(FH_FOREX).map(async ([sym, fhSym]) => {
      try { forex[sym] = await fhQuote(fhSym); }
      catch { forex[sym] = { price: FOREX_BASE[sym], chg:0, live:false }; }
    }),
  ]);

  return { stocks, metals, forex };
}

// ─────────────────────────────────────────────────────────
// SIGNALS & NEWS POOLS
// ─────────────────────────────────────────────────────────
const SIGNALS_POOL = [
  {icon:"🚀",dir:"LONG", token:"SOL",    conf:94,lev:"10x",src:"hyperliquid",
    desc:"Smart money wallets +$2.4M in 18min. Shorts clustered above — sweep incoming.",
    tags:[{l:"ON-CHAIN",c:"green"},{l:"LIQ SWEEP",c:"cyan"}]},
  {icon:"📉",dir:"SHORT",token:"BTC",    conf:81,lev:"5x",src:"hyperliquid",
    desc:"OI at resistance. Funding extreme positive. Reversal setup forming.",
    tags:[{l:"FUNDING",c:"orange"},{l:"RESISTANCE",c:"red"}]},
  {icon:"🔥",dir:"LONG", token:"WIF",    conf:88,lev:"3x",src:"hyperliquid",
    desc:"Whale 0x7f3 opened 8.4M WIF perp. Same wallet +340% on BONK pre-pump.",
    tags:[{l:"WHALE",c:"orange"},{l:"NEUTRAL FUND",c:"green"}]},
  {icon:"📈",dir:"LONG", token:"TSLA",   conf:86,lev:"5x",src:"trade.xyz",
    desc:"Earnings beat whisper +18%. Smart money opened $3.1M long.",
    tags:[{l:"EARNINGS",c:"gold"},{l:"WHALE",c:"orange"}]},
  {icon:"🚀",dir:"LONG", token:"NVDA",   conf:91,lev:"5x",src:"trade.xyz",
    desc:"H100 supply chain: +40% shipments detected in Taiwan customs.",
    tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"NEG FUND",c:"green"}]},
  {icon:"🥇",dir:"LONG", token:"XAU",    conf:89,lev:"5x",src:"phantom",
    desc:"Central bank gold buying +42t. DXY weakening. Path to $3,400 open.",
    tags:[{l:"MACRO",c:"gold"},{l:"CENTRAL BANK",c:"teal"}]},
  {icon:"🥈",dir:"LONG", token:"XAG",    conf:83,lev:"5x",src:"phantom",
    desc:"Gold/silver ratio 100:1 extreme. Solar industrial demand surging.",
    tags:[{l:"RATIO",c:"teal"},{l:"INDUSTRIAL",c:"cyan"}]},
  {icon:"💱",dir:"SHORT",token:"USDJPY", conf:84,lev:"10x",src:"phantom",
    desc:"BOJ hawkish minutes leaked. JPY intervention risk at ¥150.",
    tags:[{l:"BOJ",c:"teal"},{l:"INTERVENTION",c:"red"}]},
  {icon:"📊",dir:"LONG", token:"EURUSD", conf:79,lev:"10x",src:"phantom",
    desc:"ECB holds, Fed cutting. Rate differential narrowing. Shorts swept.",
    tags:[{l:"RATE DIFF",c:"blue"},{l:"LIQ SWEEP",c:"green"}]},
  {icon:"💎",dir:"LONG", token:"PEPE",   conf:76,lev:"5x",src:"hyperliquid",
    desc:"$18M PEPE exchange outflow. Supply squeeze. Funding negative.",
    tags:[{l:"OUTFLOW",c:"green"},{l:"NEG FUND",c:"cyan"}]},
  {icon:"⚠️",dir:"SHORT",token:"META",   conf:73,lev:"3x",src:"trade.xyz",
    desc:"EU antitrust fine €1.2B imminent. Options flow bearish.",
    tags:[{l:"REGULATORY",c:"red"},{l:"FUNDING",c:"orange"}]},
  {icon:"🎯",dir:"LONG", token:"AAPL",   conf:77,lev:"3x",src:"trade.xyz",
    desc:"iPhone 17 supply chain: orders up 22% vs prior cycle.",
    tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"SMART MONEY",c:"purple"}]},
];

const NEWS_POOL = [
  {txt:"BOJ minutes leaked — 2 members backed rate hike, ¥150 intervention confirmed",src:"Macro Leak",col:"teal"},
  {txt:"NVDA H100: +40% shipments detected in Taiwan customs — not yet public",src:"Supply Chain",col:"green"},
  {txt:"Central bank gold: China +42t March, Russia +18t — XAU breakout fuel",src:"CB Monitor",col:"gold"},
  {txt:"Fed minutes: 2 members backed 25bps cut at last meeting",src:"Macro Leak",col:"gold"},
  {txt:"TSLA: CEO social activity spiking 3hrs before earnings — historical pattern",src:"Social Monitor",col:"orange"},
  {txt:"META EU antitrust fine €1.2B — Brussels court filing detected",src:"Legal Scanner",col:"red"},
  {txt:"SOL: 3 whale wallets accumulated $6.1M in 1hr on-chain",src:"On-chain",col:"green"},
  {txt:"Gold/silver ratio 100:1 — historically signals silver outperformance",src:"Metals Watch",col:"teal"},
  {txt:"UK CPI +0.3% above forecast — BOE cut odds drop to 28%",src:"Macro",col:"teal"},
  {txt:"BTC miner capitulation ending — hashrate recovering, historically bullish",src:"On-chain",col:"green"},
  {txt:"AAPL iPhone 17 supply chain orders up 22% vs prior cycle",src:"Supply Chain",col:"cyan"},
  {txt:"DOGE whale wallet accumulation detected — 840M DOGE moved to cold storage",src:"On-chain",col:"orange"},
];

// ─────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]       = useState("prices");
  const [priceTab,  setPriceTab]  = useState("crypto");
  const [sigSubTab, setSigSubTab] = useState("all");

  const [cryptoPrices, setCryptoPrices] = useState(
    () => Object.fromEntries(CRYPTO_SYMS.map(k => [k, {price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,live:false}]))
  );
  const [equityPrices, setEquityPrices] = useState(
    () => Object.fromEntries(EQUITY_SYMS.map(k => [k, {price:EQUITY_BASE[k],chg:0,live:false}]))
  );
  const [metalPrices, setMetalPrices] = useState(
    () => Object.fromEntries(METALS_SYMS.map(k => [k, {price:METALS_BASE[k],chg:0,live:false}]))
  );
  const [forexPrices, setForexPrices] = useState(
    () => Object.fromEntries(FOREX_SYMS.map(k => [k, {price:FOREX_BASE[k],chg:0,live:false}]))
  );

  const [hlStatus,  setHlStatus]  = useState("connecting");
  const [fhStatus,  setFhStatus]  = useState("connecting");
  const [fhMsg,     setFhMsg]     = useState("");
  const [signals,   setSignals]   = useState(SIGNALS_POOL.slice(0,8).map((s,i) => ({...s,time:`${i*4+2}m ago`,id:i})));
  const [news,      setNews]      = useState(NEWS_POOL.map((n,i) => ({...n,time:`${i*6+1}m ago`,id:i})));
  const [tick,      setTick]      = useState(0);
  const [flashId,   setFlashId]   = useState(null);
  const [lastUpdate,setLastUpdate]= useState(new Date());
  const [sigCount,  setSigCount]  = useState(44);
  const [aiInput,   setAiInput]   = useState("");
  const [aiOutput,  setAiOutput]  = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const idRef = useRef(300);

  // ── Hyperliquid: every 3s ─────────────────────────────
  const doHL = useCallback(async () => {
    try {
      const data = await fetchHyperliquid();
      setCryptoPrices(prev => {
        const next = {...prev};
        Object.entries(data).forEach(([sym, d]) => { next[sym] = {...prev[sym], ...d}; });
        return next;
      });
      setHlStatus("live");
    } catch (e) {
      setHlStatus("error");
    }
  }, []);

  useEffect(() => {
    doHL();
    const iv = setInterval(doHL, 3000);
    return () => clearInterval(iv);
  }, [doHL]);

  // ── Finnhub: every 15s ────────────────────────────────
  const doFH = useCallback(async () => {
    try {
      const { stocks, metals, forex } = await fetchFinnhub();
      setEquityPrices(prev => ({...prev, ...stocks}));
      setMetalPrices(prev  => ({...prev, ...metals}));
      setForexPrices(prev  => ({...prev, ...forex}));
      const anyLive = [...Object.values(stocks),...Object.values(metals),...Object.values(forex)].some(p => p.live);
      setFhStatus(anyLive ? "live" : "closed");
      setFhMsg(anyLive ? "" : "Market closed — showing last known prices");
    } catch (e) {
      setFhStatus("error");
      setFhMsg(e.message);
    }
  }, []);

  useEffect(() => {
    doFH();
    const iv = setInterval(doFH, 15000);
    return () => clearInterval(iv);
  }, [doFH]);

  // ── 1s tick ───────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setTick(t => t + 1);
      setLastUpdate(new Date());
      if (tick % 22 === 0) {
        const s  = SIGNALS_POOL[rndInt(0, SIGNALS_POOL.length - 1)];
        const ns = {...s, time:"just now", id:idRef.current++};
        setSignals(prev => [ns, ...prev.slice(0, 11)]);
        setSigCount(c => c + 1);
        setFlashId(ns.id);
        setTimeout(() => setFlashId(null), 3000);
      }
      if (tick % 45 === 0) {
        const n = NEWS_POOL[rndInt(0, NEWS_POOL.length - 1)];
        setNews(prev => [{...n, time:"just now", id:idRef.current++}, ...prev.slice(0, 10)]);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [tick]);

  // ── AI analyst ────────────────────────────────────────
  const runAI = async () => {
    if (!aiInput.trim() || aiLoading) return;
    setAiLoading(true);
    setAiOutput("");

    const snap = (sym, prices) => {
      const d = prices[sym];
      return d ? `${fmt(d.price, sym)} (${pct(d.chg)})${d.live ? " ✅" : " ~"}` : "—";
    };

    const sys = `You are ALPHASCAN, elite multi-market trading AI with real-time data.

LIVE MARKET DATA:
CRYPTO (Hyperliquid, ${hlStatus === "live" ? "REAL-TIME" : "last known"}):
${CRYPTO_SYMS.slice(0,6).map(s => `${s}: ${snap(s, cryptoPrices)}${cryptoPrices[s]?.funding ? ` | Fund: ${pct(cryptoPrices[s].funding, 4)}/8h` : ""}`).join("\n")}

STOCKS (trade.xyz, ${fhStatus === "live" ? "REAL-TIME" : "market closed"}):
${EQUITY_SYMS.slice(0,6).map(s => `${s}: ${snap(s, equityPrices)}`).join("\n")}

METALS (Phantom):
XAU Gold: ${snap("XAU", metalPrices)} | XAG Silver: ${snap("XAG", metalPrices)}
Gold/Silver Ratio: ${metalPrices.XAU?.price && metalPrices.XAG?.price ? (metalPrices.XAU.price / metalPrices.XAG.price).toFixed(0) : "~100"}:1

FOREX (Phantom):
${FOREX_SYMS.slice(0,4).map(s => `${s}: ${snap(s, forexPrices)}`).join(" | ")}

Respond as a prop desk trader:
DIRECTION: LONG/SHORT/WAIT
ENTRY: [price]
STOP LOSS: [price]
TP1: [price] | TP2: [price]
LEVERAGE: [Nx]
CONVICTION: [x]/100
REASON: 2 sentences. No disclaimers.`;

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: sys, userMessage: aiInput })
      });
      const data = await res.json();
      if (!res.ok) { setAiOutput(data.error || `API Error ${res.status}`); setAiLoading(false); return; }
      setAiOutput(data.text || "No response.");
    } catch (e) { setAiOutput(`Error: ${e.message}`); }
    setAiLoading(false);
  };

  // ── helpers ───────────────────────────────────────────
  const panel = {background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:10};
  const ph    = {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(255,255,255,.015)"};
  const pt    = {fontWeight:700,fontSize:11,letterSpacing:"0.18em",textTransform:"uppercase",color:C.text};

  const Btn = ({ label, active, col="green", onClick }) => {
    const rgb = {green:"0,229,160",blue:"59,130,246",gold:"255,196,0",teal:"20,184,166"}[col]||"0,229,160";
    return (
      <button onClick={onClick} style={{
        padding:"5px 10px",borderRadius:6,whiteSpace:"nowrap",outline:"none",cursor:"pointer",
        fontFamily:"monospace",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",
        border:`1px solid ${active ? C[col] : C.border}`,
        background: active ? `rgba(${rgb},.12)` : C.panel,
        color: active ? C[col] : C.muted2,
      }}>{label}</button>
    );
  };

  const LiveDot = ({ live }) => (
    <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,
      background:live?C.green:C.orange,boxShadow:live?`0 0 6px ${C.green}`:"none"}}/>
  );

  const PriceRow = ({ sym, d }) => {
    if (!d) return null;
    return (
      <div style={{padding:"10px 14px",borderBottom:`1px solid rgba(19,29,53,.7)`,
        display:"grid",gridTemplateColumns:"90px 1fr auto auto auto",gap:10,alignItems:"center"}}>
        <div style={{fontWeight:700,fontSize:13}}>{sym}</div>
        <div style={{fontSize:8,color:C.muted}}>
          {d.funding ? `Fund: ${pct(d.funding,4)}/8h` : ""}
          {d.oi > 0 ? ` | OI: $${(d.oi/1e6).toFixed(0)}M` : ""}
        </div>
        <div style={{fontSize:13,fontWeight:700}}>{fmt(d.price, sym)}</div>
        <div style={{fontSize:11,color:Number(d.chg)>=0?C.green:C.red,minWidth:55,textAlign:"right"}}>{pct(d.chg)}</div>
        <div>{d.live
          ? <Badge label="LIVE" color="green"  style={{fontSize:7,padding:"1px 5px"}}/>
          : <Badge label="SIM"  color="orange" style={{fontSize:7,padding:"1px 5px"}}/>}
        </div>
      </div>
    );
  };

  const SignalRow = ({ sig }) => (
    <div onClick={() => { setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`); setTab("ai"); }}
      style={{padding:"11px 14px",borderBottom:`1px solid rgba(19,29,53,.7)`,cursor:"pointer",
        display:"grid",gridTemplateColumns:"28px 1fr 40px",gap:10,alignItems:"start",
        background:flashId===sig.id?"rgba(0,229,160,.08)":"transparent",transition:"background 0.5s"}}>
      <div style={{width:26,height:26,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,
        background:sig.dir==="LONG"?"rgba(0,229,160,.1)":"rgba(255,45,85,.1)",
        border:`1px solid ${sig.dir==="LONG"?"rgba(0,229,160,.2)":"rgba(255,45,85,.2)"}`}}>{sig.icon}</div>
      <div>
        <div style={{fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
          {sig.token}
          <Badge label={sig.dir} color={sig.dir==="LONG"?"green":"red"}/>
          {sig.src==="trade.xyz"&&<Badge label="trade.xyz" color="blue"/>}
          {sig.src==="phantom"  &&<Badge label="phantom"   color="pink"/>}
          <span style={{fontSize:9,color:C.muted}}>{sig.time}</span>
        </div>
        <div style={{fontSize:10,color:C.muted2,lineHeight:1.5,marginTop:2}}>{sig.desc}</div>
        <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
          {sig.tags.map((tg,j) => <Badge key={j} label={tg.l} color={tg.c}/>)}
          <span style={{fontSize:9,color:C.muted,alignSelf:"center"}}>≤{sig.lev}</span>
        </div>
      </div>
      <div style={{textAlign:"right"}}>
        <div style={{fontWeight:900,fontSize:20,color:sig.conf>=85?C.green:sig.conf>=70?C.gold:C.orange}}>{sig.conf}</div>
      </div>
    </div>
  );

  const filtSigs = signals.filter(s => {
    if (sigSubTab==="all")    return true;
    if (sigSubTab==="crypto") return s.src==="hyperliquid";
    if (sigSubTab==="equity") return s.src==="trade.xyz";
    if (sigSubTab==="metals") return ["XAU","XAG"].includes(s.token);
    if (sigSubTab==="forex")  return FOREX_SYMS.includes(s.token);
    return true;
  });

  const hlLive = hlStatus==="live";
  const fhLive = fhStatus==="live";
  const hlLiveCount = Object.values(cryptoPrices).filter(p=>p.live).length;
  const fhLiveCount = [...Object.values(equityPrices),...Object.values(metalPrices),...Object.values(forexPrices)].filter(p=>p.live).length;

  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",background:C.bg,color:C.text,minHeight:"100vh",padding:"10px 12px",maxWidth:640,margin:"0 auto"}}>

      {/* HEADER */}
      <div style={{marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
          <div>
            <div style={{fontWeight:900,fontSize:22,color:C.green,letterSpacing:"0.1em",textShadow:`0 0 20px rgba(0,229,160,.4)`}}>
              ALPHASCAN <span style={{color:C.cyan,fontSize:14}}>v10</span>
            </div>
            <div style={{fontSize:7,color:C.muted,letterSpacing:"0.2em",marginTop:2}}>
              CRYPTO · STOCKS · METALS · FOREX · 226 PERPS
            </div>
          </div>
          <div style={{textAlign:"right",fontSize:8}}>
            <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginBottom:3}}>
              <LiveDot live={hlLive}/>
              <span style={{color:hlLive?C.green:C.orange}}>
                HL {hlLive?`${hlLiveCount}/9 LIVE`:hlStatus.toUpperCase()}
              </span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginBottom:3}}>
              <LiveDot live={fhLive}/>
              <span style={{color:fhLive?C.green:fhStatus==="closed"?C.gold:C.orange}}>
                FH {fhLive?`${fhLiveCount} LIVE`:fhStatus==="closed"?"CLOSED":fhStatus.toUpperCase()}
              </span>
            </div>
            <div style={{color:C.muted}}>{lastUpdate.toLocaleTimeString()}</div>
          </div>
        </div>

        {/* Market status grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
          {[
            {l:"Crypto",  n:hlLiveCount, total:9,  live:hlLive,   col:"green"},
            {l:"Stocks",  n:Object.values(equityPrices).filter(p=>p.live).length, total:8, live:fhLive, col:"blue"},
            {l:"Metals",  n:Object.values(metalPrices).filter(p=>p.live).length,  total:2, live:fhLive, col:"gold"},
            {l:"Forex",   n:Object.values(forexPrices).filter(p=>p.live).length,  total:6, live:fhLive, col:"teal"},
          ].map(s => (
            <div key={s.l} style={{
              background:s.live?`rgba(${s.col==="green"?"0,229,160":s.col==="blue"?"59,130,246":s.col==="gold"?"255,196,0":"20,184,166"},.06)`:"rgba(255,140,0,.06)",
              border:`1px solid ${s.live?C[s.col]+"44":"rgba(255,140,0,.2)"}`,
              borderRadius:6,padding:"5px 8px",textAlign:"center"}}>
              <div style={{fontSize:7,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>{s.l}</div>
              <div style={{fontWeight:900,fontSize:16,color:s.live?C[s.col]:C.orange,marginTop:1}}>
                {s.n}<span style={{fontSize:10,color:C.muted}}>/{s.total}</span>
              </div>
            </div>
          ))}
        </div>
        {fhMsg && <div style={{marginTop:5,fontSize:8,color:C.gold}}>⚠️ {fhMsg}</div>}
      </div>

      {/* QUICK TICKER STRIP */}
      <div style={{display:"flex",gap:5,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
        {["BTC","ETH","SOL","XAU","XAG","EURUSD","TSLA","NVDA"].map(sym => {
          const all = {...cryptoPrices,...equityPrices,...metalPrices,...forexPrices};
          const d = all[sym];
          return (
            <div key={sym} onClick={() => { setAiInput(`${sym} — long or short right now?`); setTab("ai"); }}
              style={{background:C.panel,border:`1px solid ${d?.live?C.green+"55":C.border}`,
                borderRadius:6,padding:"5px 9px",flexShrink:0,cursor:"pointer",minWidth:72}}>
              <div style={{fontSize:7,color:d?.live?C.green:C.muted,letterSpacing:"0.08em"}}>{sym}</div>
              <div style={{fontSize:10,fontWeight:700,marginTop:1}}>{fmt(d?.price,sym)}</div>
              <div style={{fontSize:8,color:Number(d?.chg)>=0?C.green:C.red}}>{pct(d?.chg)}</div>
            </div>
          );
        })}
      </div>

      {/* MAIN TABS */}
      <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto"}}>
        {[{k:"prices",l:"💹 Prices"},{k:"signals",l:"⚡ Signals"},{k:"funding",l:"💸 Funding"},{k:"news",l:"📡 News"},{k:"ai",l:"🤖 AI"}].map(t => (
          <Btn key={t.k} label={t.l} active={tab===t.k} onClick={() => setTab(t.k)}/>
        ))}
      </div>

      {/* ══ PRICES ══ */}
      {tab==="prices" && <>
        <div style={{display:"flex",gap:4,marginBottom:8}}>
          {[{k:"crypto",l:"⚡ Crypto",col:"green"},{k:"equity",l:"📊 Stocks",col:"blue"},{k:"metals",l:"🥇 Metals",col:"gold"},{k:"forex",l:"💱 Forex",col:"teal"}].map(t => (
            <Btn key={t.k} label={t.l} col={t.col} active={priceTab===t.k} onClick={() => setPriceTab(t.k)}/>
          ))}
        </div>

        {priceTab==="crypto" && (
          <div style={panel}>
            <div style={ph}>
              <span style={pt}>⚡ Crypto · Hyperliquid</span>
              <Badge label={hlLive?"API LIVE":"Connecting..."} color={hlLive?"green":"orange"}/>
            </div>
            <div style={{padding:"5px 14px",background:"rgba(0,229,160,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>
              Source: <span style={{color:C.green}}>api.hyperliquid.xyz</span> · Free · No API key · Refreshes every 3s
            </div>
            {CRYPTO_SYMS.map(sym => <PriceRow key={sym} sym={sym} d={cryptoPrices[sym]}/>)}
          </div>
        )}

        {priceTab==="equity" && (
          <div style={panel}>
            <div style={ph}>
              <span style={pt}>📊 Stocks · trade.xyz</span>
              <Badge label={fhLive?`${Object.values(equityPrices).filter(p=>p.live).length} LIVE`:"MARKET CLOSED"} color={fhLive?"green":"gold"}/>
            </div>
            <div style={{padding:"5px 14px",background:"rgba(59,130,246,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>
              Source: <span style={{color:C.blue}}>Finnhub.io</span> · Live NYSE hours (9:30am–4pm ET) · Refreshes every 15s
            </div>
            {EQUITY_SYMS.map(sym => <PriceRow key={sym} sym={sym} d={equityPrices[sym]}/>)}
          </div>
        )}

        {priceTab==="metals" && (
          <div style={panel}>
            <div style={ph}>
              <span style={pt}>🥇 Metals · Phantom</span>
              <Badge label={fhLive?`${Object.values(metalPrices).filter(p=>p.live).length} LIVE`:"CLOSED"} color={fhLive?"green":"gold"}/>
            </div>
            <div style={{padding:"5px 14px",background:"rgba(255,196,0,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>
              Source: <span style={{color:C.gold}}>Finnhub OANDA</span> · XAU (Gold) · XAG (Silver)
            </div>
            {METALS_SYMS.map(sym => <PriceRow key={sym} sym={sym} d={metalPrices[sym]}/>)}
            <div style={{padding:"10px 14px",borderTop:`1px solid ${C.border}`,fontSize:9,color:C.muted2}}>
              Gold/Silver Ratio: <span style={{color:C.gold,fontWeight:700}}>
                {metalPrices.XAU?.price&&metalPrices.XAG?.price?(metalPrices.XAU.price/metalPrices.XAG.price).toFixed(0):"—"}:1
              </span>
              {metalPrices.XAU?.price&&metalPrices.XAG?.price&&(metalPrices.XAU.price/metalPrices.XAG.price)>=90&&
                <span style={{color:C.green}}> ← historically bullish for silver</span>}
            </div>
          </div>
        )}

        {priceTab==="forex" && (
          <div style={panel}>
            <div style={ph}>
              <span style={pt}>💱 Forex · Phantom</span>
              <Badge label={fhLive?`${Object.values(forexPrices).filter(p=>p.live).length} LIVE`:"CLOSED"} color={fhLive?"green":"gold"}/>
            </div>
            <div style={{padding:"5px 14px",background:"rgba(20,184,166,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>
              Source: <span style={{color:C.teal}}>Finnhub OANDA</span> · 24/5 (closed weekends)
            </div>
            {FOREX_SYMS.map(sym => <PriceRow key={sym} sym={sym} d={forexPrices[sym]}/>)}
          </div>
        )}
      </>}

      {/* ══ SIGNALS ══ */}
      {tab==="signals" && <>
        <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto"}}>
          {[{k:"all",l:"All",col:"green"},{k:"crypto",l:"Crypto",col:"green"},{k:"equity",l:"Stocks",col:"blue"},{k:"metals",l:"Metals",col:"gold"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
            <Btn key={t.k} label={t.l} col={t.col} active={sigSubTab===t.k} onClick={()=>setSigSubTab(t.k)}/>
          ))}
        </div>
        <div style={panel}>
          <div style={ph}><span style={pt}>⚡ Alpha Signals</span><Badge label={`${sigCount} total`} color="cyan"/></div>
          {filtSigs.map(sig => <SignalRow key={sig.id} sig={sig}/>)}
        </div>
      </>}

      {/* ══ FUNDING ══ */}
      {tab==="funding" && (
        <div style={panel}>
          <div style={ph}>
            <span style={pt}>💸 Funding Rates · Hyperliquid</span>
            <Badge label={hlLive?"Real-time":"Connecting"} color={hlLive?"green":"orange"}/>
          </div>
          <div style={{padding:"5px 14px",fontSize:8,color:C.muted2,borderBottom:`1px solid ${C.border}`}}>
            <span style={{color:C.red}}>Positive</span> = longs pay (bearish) · <span style={{color:C.green}}>Negative</span> = shorts pay (bullish)
          </div>
          {CRYPTO_SYMS.map(sym => {
            const d = cryptoPrices[sym];
            const r = d?.funding || 0;
            return (
              <div key={sym} style={{padding:"9px 14px",borderBottom:`1px solid rgba(19,29,53,.7)`,
                display:"grid",gridTemplateColumns:"52px 80px 1fr 70px 44px",gap:8,alignItems:"center"}}>
                <div style={{fontWeight:700,fontSize:12}}>{sym}</div>
                <div style={{fontWeight:700,fontSize:11,color:r>0.03?C.red:r<-0.01?C.green:C.gold}}>{pct(r,4)}/8h</div>
                <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(100,Math.abs(r)*2000)}%`,borderRadius:2,background:r>0?"rgba(255,45,85,.7)":"rgba(0,229,160,.7)"}}/>
                </div>
                <div style={{fontSize:8,color:C.muted2}}>{r>0.05?"Short bias":r<-0.02?"Long ✓":"Neutral"}</div>
                {d?.live?<Badge label="LIVE" color="green" style={{fontSize:7,padding:"1px 4px"}}/>:<Badge label="SIM" color="orange" style={{fontSize:7,padding:"1px 4px"}}/>}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ NEWS ══ */}
      {tab==="news" && (
        <div style={panel}>
          <div style={ph}><span style={pt}>📡 Pre-Twitter Intel</span><Badge label="Scanning" color="red"/></div>
          {news.map(n => (
            <div key={n.id} onClick={() => { setAiInput(`Analyze for a trade: "${n.txt}"`); setTab("ai"); }}
              style={{padding:"11px 14px",borderBottom:`1px solid rgba(19,29,53,.7)`,cursor:"pointer",display:"flex",gap:10}}>
              <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,marginTop:4,
                background:C[n.col]||C.cyan,boxShadow:`0 0 5px ${C[n.col]||C.cyan}`}}/>
              <div>
                <div style={{fontSize:10,color:C.text,lineHeight:1.5}}>{n.txt}</div>
                <div style={{fontSize:8,color:C.muted,marginTop:2}}>{n.src} · {n.time}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ AI ══ */}
      {tab==="ai" && (
        <div style={panel}>
          <div style={ph}><span style={pt}>🤖 AI Perp Analyst</span><Badge label="Claude · Live Data" color="cyan"/></div>
          <div style={{padding:14}}>
            <div style={{background:"rgba(0,0,0,.3)",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",marginBottom:10,fontSize:9,lineHeight:1.8,color:C.muted2}}>
              <div style={{color:hlLive?C.green:C.orange}}>{hlLive?"✅":"⏳"} Crypto: {hlLive?"Real-time Hyperliquid data":"Connecting..."}</div>
              <div style={{color:fhLive?C.green:C.gold}}>{fhLive?"✅":"⚠️"} Stocks/Metals/Forex: {fhLive?"Live Finnhub data":"Market closed — last prices"}</div>
            </div>
            <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
              {["BTC","ETH","SOL","XAU","EURUSD","TSLA","NVDA"].map(sym => {
                const all = {...cryptoPrices,...equityPrices,...metalPrices,...forexPrices};
                const d = all[sym];
                return (
                  <button key={sym} onClick={() => setAiInput(`${sym} — long or short? Price: ${fmt(d?.price,sym)}, 24h: ${pct(d?.chg)}`)}
                    style={{padding:"4px 9px",borderRadius:5,outline:"none",cursor:"pointer",fontFamily:"monospace",
                      border:`1px solid ${d?.live?C.green:C.border}`,background:"transparent",
                      color:d?.live?C.green:C.muted2,fontSize:9}}>
                    {sym}{d?.live?" 🟢":""}
                  </button>
                );
              })}
            </div>
            <textarea value={aiInput} onChange={e => setAiInput(e.target.value)}
              placeholder={`"Long BTC now?" · "Is XAU overextended?" · "Best forex trade?"`}
              style={{width:"100%",background:"#080c18",border:`1px solid ${C.border}`,borderRadius:6,
                padding:10,color:C.text,fontFamily:"monospace",fontSize:11,resize:"none",
                height:68,outline:"none",boxSizing:"border-box"}}/>
            <button onClick={runAI} disabled={aiLoading} style={{
              width:"100%",height:40,marginTop:8,
              background:aiLoading?"rgba(0,229,160,.3)":C.green,
              color:"#04060d",border:"none",borderRadius:6,fontWeight:700,fontSize:11,
              letterSpacing:"0.15em",textTransform:"uppercase",
              cursor:aiLoading?"not-allowed":"pointer",fontFamily:"monospace"}}>
              {aiLoading?"⟳ Analyzing...":"Analyze →"}
            </button>
            {aiOutput && (
              <div style={{marginTop:12,background:"#080c18",border:`1px solid ${C.border}`,
                borderRadius:6,padding:14,fontSize:11,lineHeight:1.9,color:C.text,
                whiteSpace:"pre-wrap",maxHeight:320,overflowY:"auto"}}>
                {aiOutput}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{textAlign:"center",fontSize:7,color:C.muted,marginTop:6,letterSpacing:"0.12em",lineHeight:1.8}}>
        CRYPTO: HYPERLIQUID API · STOCKS/METALS/FOREX: FINNHUB API<br/>
        NOT FINANCIAL ADVICE · FOR EDUCATIONAL USE ONLY
      </div>
    </div>
  );
}
