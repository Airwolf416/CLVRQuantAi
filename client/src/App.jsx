// ─────────────────────────────────────────────────────────
// ALPHASCAN v11
// NEW: Bottom nav bar, price flash animations, watchlist,
//      alerts, OI sparklines, dark/light mode, share signal, PWA
// ─────────────────────────────────────────────────────────
// API keys are stored securely on the backend

import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEMES ──────────────────────────────────────────────
const DARK = {
  bg:"#04060d", panel:"#0a0e1c", border:"#131d35",
  green:"#00e5a0", cyan:"#00d4ff", red:"#ff2d55", orange:"#ff8c00",
  gold:"#ffc400", purple:"#a855f7", blue:"#3b82f6", teal:"#14b8a6",
  pink:"#ec4899", text:"#d0deff", muted:"#3a4d70", muted2:"#5a6d90",
  navBg:"#070b17", navBorder:"#1a2540", inputBg:"#080c18"
};
const LIGHT = {
  bg:"#f0f4ff", panel:"#ffffff", border:"#dde4f0",
  green:"#00a870", cyan:"#0099cc", red:"#e0002a", orange:"#d96b00",
  gold:"#b8860b", purple:"#7c3aed", blue:"#2563eb", teal:"#0f766e",
  pink:"#db2777", text:"#0f172a", muted:"#94a3b8", muted2:"#64748b",
  navBg:"#ffffff", navBorder:"#dde4f0", inputBg:"#f8faff"
};

const pct = (v,d=2) => { const n=Number(v); if(isNaN(n)) return "—"; return (n>=0?"+":"")+n.toFixed(d)+"%"; };
const fmt = (p,sym) => {
  if(!p&&p!==0) return "—"; p=Number(p); if(isNaN(p)||p===0) return "—";
  if(["EURUSD","GBPUSD","AUDUSD","USDCHF"].includes(sym)) return p.toFixed(4);
  if(["USDJPY","USDCAD"].includes(sym)) return p.toFixed(2);
  if(sym==="XAG") return "$"+p.toFixed(2);
  if(sym==="XAU") return "$"+p.toFixed(0);
  if(p>=1000) return "$"+p.toFixed(0);
  if(p>=100)  return "$"+p.toFixed(1);
  if(p>=1)    return "$"+p.toFixed(2);
  return "$"+p.toFixed(6);
};
const rndInt = (a,b) => Math.floor(a+Math.random()*(b-a+1));

// ─── BASE PRICES ─────────────────────────────────────────
const CRYPTO_BASE = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072};
const EQUITY_BASE = {TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310};
const METALS_BASE = {XAU:3285,XAG:32.8};
const FOREX_BASE  = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654};
const CRYPTO_SYMS = Object.keys(CRYPTO_BASE);
const EQUITY_SYMS = Object.keys(EQUITY_BASE);
const METALS_SYMS = Object.keys(METALS_BASE);
const FOREX_SYMS  = Object.keys(FOREX_BASE);
const ALL_SYMS    = [...CRYPTO_SYMS,...EQUITY_SYMS,...METALS_SYMS,...FOREX_SYMS];

const FH_METALS = {XAU:"OANDA:XAU_USD",XAG:"OANDA:XAG_USD"};
const FH_FOREX  = {EURUSD:"OANDA:EUR_USD",GBPUSD:"OANDA:GBP_USD",USDJPY:"OANDA:USD_JPY",USDCHF:"OANDA:USD_CHF",AUDUSD:"OANDA:AUD_USD",USDCAD:"OANDA:USD_CAD"};

// ─── API FETCHERS (proxied through backend) ──────────────
async function fetchHyperliquid() {
  const r = await fetch("/api/crypto");
  if (!r.ok) throw new Error(`Crypto API ${r.status}`);
  return await r.json();
}

async function fetchFinnhub() {
  const r = await fetch("/api/finnhub");
  if (!r.ok) throw new Error(`Finnhub API ${r.status}`);
  return await r.json();
}

// ─── SIGNALS & NEWS ───────────────────────────────────────
const SIGNALS_POOL = [
  {icon:"🚀",dir:"LONG", token:"SOL",    conf:94,lev:"10x",src:"hyperliquid",desc:"Smart money wallets +$2.4M in 18min. Shorts clustered above — sweep incoming.",tags:[{l:"ON-CHAIN",c:"green"},{l:"LIQ SWEEP",c:"cyan"}]},
  {icon:"📉",dir:"SHORT",token:"BTC",    conf:81,lev:"5x", src:"hyperliquid",desc:"OI at resistance. Funding extreme positive. Reversal setup forming.",tags:[{l:"FUNDING",c:"orange"},{l:"RESISTANCE",c:"red"}]},
  {icon:"🔥",dir:"LONG", token:"WIF",    conf:88,lev:"3x", src:"hyperliquid",desc:"Whale 0x7f3 opened 8.4M WIF perp. Same wallet +340% on BONK pre-pump.",tags:[{l:"WHALE",c:"orange"},{l:"NEUTRAL FUND",c:"green"}]},
  {icon:"📈",dir:"LONG", token:"TSLA",   conf:86,lev:"5x", src:"trade.xyz",  desc:"Earnings beat whisper +18%. Smart money opened $3.1M long.",tags:[{l:"EARNINGS",c:"gold"},{l:"WHALE",c:"orange"}]},
  {icon:"🚀",dir:"LONG", token:"NVDA",   conf:91,lev:"5x", src:"trade.xyz",  desc:"H100 supply chain: +40% shipments detected in Taiwan customs.",tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"NEG FUND",c:"green"}]},
  {icon:"🥇",dir:"LONG", token:"XAU",    conf:89,lev:"5x", src:"phantom",    desc:"Central bank gold buying +42t. DXY weakening. Path to $3,400 open.",tags:[{l:"MACRO",c:"gold"},{l:"CENTRAL BANK",c:"teal"}]},
  {icon:"🥈",dir:"LONG", token:"XAG",    conf:83,lev:"5x", src:"phantom",    desc:"Gold/silver ratio 100:1. Solar industrial demand surging.",tags:[{l:"RATIO",c:"teal"},{l:"INDUSTRIAL",c:"cyan"}]},
  {icon:"💱",dir:"SHORT",token:"USDJPY", conf:84,lev:"10x",src:"phantom",    desc:"BOJ hawkish minutes leaked. JPY intervention risk at ¥150.",tags:[{l:"BOJ",c:"teal"},{l:"INTERVENTION",c:"red"}]},
  {icon:"📊",dir:"LONG", token:"EURUSD", conf:79,lev:"10x",src:"phantom",    desc:"ECB holds, Fed cutting. Rate differential narrowing. Shorts swept.",tags:[{l:"RATE DIFF",c:"blue"},{l:"LIQ SWEEP",c:"green"}]},
  {icon:"💎",dir:"LONG", token:"PEPE",   conf:76,lev:"5x", src:"hyperliquid",desc:"$18M PEPE exchange outflow. Supply squeeze. Funding negative.",tags:[{l:"OUTFLOW",c:"green"},{l:"NEG FUND",c:"cyan"}]},
  {icon:"⚠️",dir:"SHORT",token:"META",   conf:73,lev:"3x", src:"trade.xyz",  desc:"EU antitrust fine €1.2B imminent. Options flow bearish.",tags:[{l:"REGULATORY",c:"red"},{l:"FUNDING",c:"orange"}]},
  {icon:"🎯",dir:"LONG", token:"AAPL",   conf:77,lev:"3x", src:"trade.xyz",  desc:"iPhone 17 supply chain: orders up 22% vs prior cycle.",tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"SMART MONEY",c:"purple"}]},
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
];

// ─── SPARKLINE ────────────────────────────────────────────
function Sparkline({data,color,width=80,height=24}) {
  if(!data||data.length<2) return <span style={{fontSize:8,opacity:.3,color:"#666"}}>—</span>;
  const min=Math.min(...data),max=Math.max(...data),range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*(height-2)+1}`).join(" ");
  const up=data[data.length-1]>=data[0];
  return (
    <svg width={width} height={height} style={{overflow:"visible",flexShrink:0}}>
      <polyline points={pts} fill="none" stroke={color||(up?"#00e5a0":"#ff2d55")} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)/(data.length-1)*width} cy={height-((data[data.length-1]-min)/range)*(height-2)+1} r="2.5" fill={color||(up?"#00e5a0":"#ff2d55")}/>
    </svg>
  );
}

// ─── TOAST ────────────────────────────────────────────────
function Toast({msg,onDone}) {
  useEffect(()=>{const t=setTimeout(onDone,3000);return()=>clearTimeout(t);},[onDone]);
  return (
    <div style={{position:"fixed",bottom:88,left:"50%",transform:"translateX(-50%)",
      background:"#00e5a0",color:"#04060d",borderRadius:10,padding:"10px 18px",
      fontSize:11,fontWeight:700,fontFamily:"monospace",zIndex:9999,
      boxShadow:"0 4px 24px rgba(0,229,160,.5)",whiteSpace:"nowrap",
      animation:"slideUp .2s ease"}}>
      {msg}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════
export default function App() {
  const [darkMode,   setDarkMode]   = useState(true);
  const C = darkMode ? DARK : LIGHT;

  const [tab,        setTab]        = useState("prices");
  const [priceTab,   setPriceTab]   = useState("crypto");
  const [sigSubTab,  setSigSubTab]  = useState("all");

  const [cryptoPrices, setCryptoPrices] = useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,live:false,oiHistory:[]}])));
  const [equityPrices, setEquityPrices] = useState(()=>Object.fromEntries(EQUITY_SYMS.map(k=>[k,{price:EQUITY_BASE[k],chg:0,live:false}])));
  const [metalPrices,  setMetalPrices]  = useState(()=>Object.fromEntries(METALS_SYMS.map(k=>[k,{price:METALS_BASE[k],chg:0,live:false}])));
  const [forexPrices,  setForexPrices]  = useState(()=>Object.fromEntries(FOREX_SYMS.map(k=>[k,{price:FOREX_BASE[k],chg:0,live:false}])));

  // Flash tracking
  const [flashes,    setFlashes]    = useState({});
  const prevRef = useRef({});

  // Watchlist
  const [watchlist,  setWatchlist]  = useState(["BTC","ETH","SOL","XAU","TSLA"]);

  // Alerts
  const [alerts,     setAlerts]     = useState([
    {id:1,sym:"BTC",field:"funding",condition:"above",threshold:0.05,triggered:false,label:"BTC funding > 0.05%"},
    {id:2,sym:"XAU",field:"price",  condition:"above",threshold:3400, triggered:false,label:"XAU price > $3,400"},
  ]);
  const [alertForm,  setAlertForm]  = useState({sym:"BTC",field:"price",condition:"above",threshold:""});
  const [showAlertForm, setShowAlertForm] = useState(false);

  const [signals,    setSignals]    = useState(SIGNALS_POOL.slice(0,8).map((s,i)=>({...s,time:`${i*4+2}m ago`,id:i})));
  const [news,       setNews]       = useState(NEWS_POOL.map((n,i)=>({...n,time:`${i*6+1}m ago`,id:i})));
  const [flashSigId, setFlashSigId] = useState(null);
  const [sigCount,   setSigCount]   = useState(44);
  const [tick,       setTick]       = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [hlStatus,   setHlStatus]   = useState("connecting");
  const [fhStatus,   setFhStatus]   = useState("connecting");
  const [toast,      setToast]      = useState(null);
  const [aiInput,    setAiInput]    = useState("");
  const [aiOutput,   setAiOutput]   = useState("");
  const [aiLoading,  setAiLoading]  = useState(false);
  const idRef = useRef(300);

  // ── Flash helper ──────────────────────────────────────
  const triggerFlashes = useCallback((updates) => {
    const newF = {};
    Object.entries(updates).forEach(([sym,d]) => {
      const prev = prevRef.current[sym];
      if(prev && d.price && d.price !== prev) newF[sym] = d.price > prev ? "green" : "red";
      if(d.price) prevRef.current[sym] = d.price;
    });
    if(Object.keys(newF).length) {
      setFlashes(f=>({...f,...newF}));
      setTimeout(()=>setFlashes(f=>{const n={...f};Object.keys(newF).forEach(k=>delete n[k]);return n;}),700);
    }
  },[]);

  // ── Hyperliquid ───────────────────────────────────────
  const doHL = useCallback(async()=>{
    try {
      const data=await fetchHyperliquid();
      setCryptoPrices(prev=>{
        const next={...prev};
        Object.entries(data).forEach(([sym,d])=>{
          const hist=[...(prev[sym]?.oiHistory||[]),d.oi].slice(-20);
          next[sym]={...prev[sym],...d,oiHistory:hist};
        });
        triggerFlashes(next);
        return next;
      });
      setHlStatus("live");
    } catch { setHlStatus("error"); }
  },[triggerFlashes]);

  useEffect(()=>{doHL();const iv=setInterval(doHL,3000);return()=>clearInterval(iv);},[doHL]);

  // ── Finnhub ───────────────────────────────────────────
  const doFH = useCallback(async()=>{
    try {
      const {stocks,metals,forex}=await fetchFinnhub();
      setEquityPrices(prev=>{const n={...prev,...stocks};triggerFlashes(n);return n;});
      setMetalPrices(prev=>{const n={...prev,...metals};triggerFlashes(n);return n;});
      setForexPrices(prev=>{const n={...prev,...forex};triggerFlashes(n);return n;});
      const anyLive=[...Object.values(stocks),...Object.values(metals),...Object.values(forex)].some(p=>p.live);
      setFhStatus(anyLive?"live":"closed");
    } catch { setFhStatus("error"); }
  },[triggerFlashes]);

  useEffect(()=>{doFH();const iv=setInterval(doFH,15000);return()=>clearInterval(iv);},[doFH]);

  // ── Alert checker ─────────────────────────────────────
  const allPrices = {...cryptoPrices,...equityPrices,...metalPrices,...forexPrices};
  useEffect(()=>{
    const vals = {};
    Object.entries(cryptoPrices).forEach(([sym,d])=>{vals[sym]=d.price;vals[sym+"_funding"]=d.funding;});
    Object.entries({...equityPrices,...metalPrices,...forexPrices}).forEach(([sym,d])=>{vals[sym]=d.price;});
    setAlerts(prev=>prev.map(a=>{
      if(a.triggered) return a;
      const key = a.field==="funding"?a.sym+"_funding":a.sym;
      const val = vals[key];
      if(val===undefined) return a;
      const hit = a.condition==="above" ? val>=a.threshold : val<=a.threshold;
      if(hit) {
        setToast(`🔔 ALERT: ${a.label}`);
        if(Notification.permission==="granted") new Notification("AlphaScan",{body:a.label});
        return {...a,triggered:true};
      }
      return a;
    }));
  },[cryptoPrices,equityPrices,metalPrices,forexPrices]);

  // ── 1s tick ───────────────────────────────────────────
  const tickRef = useRef(0);
  useEffect(()=>{
    const iv=setInterval(()=>{
      tickRef.current++;
      setTick(tickRef.current); setLastUpdate(new Date());
      if(tickRef.current%22===0){
        const s=SIGNALS_POOL[rndInt(0,SIGNALS_POOL.length-1)];
        const ns={...s,time:"just now",id:idRef.current++};
        setSignals(prev=>[ns,...prev.slice(0,11)]);
        setSigCount(c=>c+1); setFlashSigId(ns.id); setTimeout(()=>setFlashSigId(null),3000);
      }
      if(tickRef.current%45===0){const n=NEWS_POOL[rndInt(0,NEWS_POOL.length-1)];setNews(prev=>[{...n,time:"just now",id:idRef.current++},...prev.slice(0,10)]);}
    },1000);
    return()=>clearInterval(iv);
  },[]);

  // ── Watchlist ─────────────────────────────────────────
  const toggleWatch = sym => {
    const has=watchlist.includes(sym);
    setWatchlist(prev=>has?prev.filter(s=>s!==sym):[...prev,sym]);
    setToast(has?`Removed ${sym}`:`Added ${sym} to watchlist ⭐`);
  };
  const isWatched = sym=>watchlist.includes(sym);

  // ── Share signal ──────────────────────────────────────
  const shareSignal = sig => {
    const price=fmt(allPrices[sig.token]?.price,sig.token);
    const text=`⚡ ALPHASCAN SIGNAL\n${sig.icon} ${sig.token} ${sig.dir} | Conf: ${sig.conf}/100 | ${sig.lev}\n💰 Price: ${price}\n📊 ${sig.desc}\n🏷 ${sig.tags.map(t=>t.l).join(" · ")}\n📡 ${sig.src} | alpha-scan.replit.app`;
    navigator.clipboard.writeText(text).then(()=>setToast("Signal copied! 📋"));
  };

  // ── AI ────────────────────────────────────────────────
  const runAI = async()=>{
    if(!aiInput.trim()||aiLoading) return;
    setAiLoading(true); setAiOutput("");
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" ✅":" ~"}`:"—";};
    const sys=`You are ALPHASCAN, elite multi-market trading AI.
CRYPTO (${hlStatus==="live"?"LIVE":"~"}): ${CRYPTO_SYMS.slice(0,5).map(s=>`${s}:${snap(s,cryptoPrices)}${cryptoPrices[s]?.funding?` F:${pct(cryptoPrices[s].funding,4)}/8h`:""}`).join(" | ")}
STOCKS: ${EQUITY_SYMS.slice(0,4).map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ")}
METALS: XAU:${snap("XAU",metalPrices)} XAG:${snap("XAG",metalPrices)}
FOREX: ${FOREX_SYMS.slice(0,4).map(s=>`${s}:${snap(s,forexPrices)}`).join(" | ")}
Respond: DIRECTION / ENTRY / STOP / TP1 / TP2 / LEVERAGE / CONVICTION / REASON (2 sentences, no disclaimers)`;
    try {
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:aiInput})});
      const data=await res.json();
      if(!res.ok){setAiOutput(data.error||`Error ${res.status}`);setAiLoading(false);return;}
      setAiOutput(data.text||"No response.");
    } catch(e){setAiOutput(`Error: ${e.message}`);}
    setAiLoading(false);
  };

  // ── Style components ──────────────────────────────────
  const tagColors = {
    green:{bg:"rgba(0,229,160,.12)",color:C.green,border:"rgba(0,229,160,.3)"},
    cyan: {bg:"rgba(0,212,255,.12)",color:C.cyan, border:"rgba(0,212,255,.3)"},
    red:  {bg:"rgba(255,45,85,.12)",color:C.red,  border:"rgba(255,45,85,.3)"},
    orange:{bg:"rgba(255,140,0,.12)",color:C.orange,border:"rgba(255,140,0,.3)"},
    gold: {bg:"rgba(255,196,0,.12)",color:C.gold, border:"rgba(255,196,0,.3)"},
    blue: {bg:"rgba(59,130,246,.12)",color:C.blue,border:"rgba(59,130,246,.3)"},
    teal: {bg:"rgba(20,184,166,.12)",color:C.teal,border:"rgba(20,184,166,.3)"},
    pink: {bg:"rgba(236,72,153,.12)",color:C.pink,border:"rgba(236,72,153,.3)"},
    purple:{bg:"rgba(168,85,247,.12)",color:C.purple,border:"rgba(168,85,247,.3)"},
  };
  const Badge=({label,color="green",style={}})=>{
    const t=tagColors[color]||{bg:"rgba(128,128,128,.12)",color:C.muted2,border:"rgba(128,128,128,.3)"};
    return <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:t.bg,color:t.color,border:`1px solid ${t.border}`,fontFamily:"monospace",letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:700,...style}}>{label}</span>;
  };
  const panel={background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",marginBottom:10};
  const ph={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:darkMode?"rgba(255,255,255,.015)":"rgba(0,0,0,.02)"};
  const pt={fontWeight:700,fontSize:11,letterSpacing:"0.18em",textTransform:"uppercase",color:C.text};
  const SubBtn=({k,label,col="green",state,setter})=>{
    const rgb={green:"0,229,160",blue:"59,130,246",gold:"255,196,0",teal:"20,184,166"}[col]||"0,229,160";
    const active=state===k;
    return <button onClick={()=>setter(k)} style={{padding:"4px 10px",borderRadius:5,whiteSpace:"nowrap",outline:"none",cursor:"pointer",fontFamily:"monospace",fontSize:9,border:`1px solid ${active?C[col]:C.border}`,background:active?`rgba(${rgb},.12)`:C.panel,color:active?C[col]:C.muted2}}>{label}</button>;
  };
  const LiveDot=({live})=><div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:live?C.green:C.orange,boxShadow:live?`0 0 6px ${C.green}`:"none"}}/>;

  const PriceRow=({sym,d,extra})=>{
    if(!d) return null;
    const flash=flashes[sym];
    return (
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,transition:"background .35s",
        background:flash==="green"?"rgba(0,229,160,.12)":flash==="red"?"rgba(255,45,85,.1)":"transparent",
        display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:8,alignItems:"center"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontWeight:700,fontSize:13,color:C.text}}>{sym}</span>
            <button onClick={()=>toggleWatch(sym)} style={{background:"none",border:"none",cursor:"pointer",padding:0,fontSize:12,opacity:isWatched(sym)?1:.25,transition:"opacity .2s"}}>⭐</button>
          </div>
          {extra&&<div style={{fontSize:8,color:C.muted,marginTop:1}}>{extra}</div>}
        </div>
        <div style={{fontSize:13,fontWeight:700,color:flash==="green"?C.green:flash==="red"?C.red:C.text,transition:"color .35s"}}>{fmt(d.price,sym)}</div>
        <div style={{fontSize:11,color:Number(d.chg)>=0?C.green:C.red,minWidth:52,textAlign:"right"}}>{pct(d.chg)}</div>
        {d.live?<Badge label="LIVE" color="green" style={{fontSize:7,padding:"1px 5px"}}/>:<Badge label="SIM" color="orange" style={{fontSize:7,padding:"1px 5px"}}/>}
      </div>
    );
  };

  const SignalRow=({sig})=>(
    <div style={{padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:flashSigId===sig.id?"rgba(0,229,160,.06)":"transparent",transition:"background .5s"}}>
      <div style={{display:"grid",gridTemplateColumns:"28px 1fr auto",gap:10,alignItems:"start"}}>
        <div onClick={()=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");}}
          style={{width:26,height:26,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,cursor:"pointer",
            background:sig.dir==="LONG"?"rgba(0,229,160,.1)":"rgba(255,45,85,.1)",
            border:`1px solid ${sig.dir==="LONG"?"rgba(0,229,160,.2)":"rgba(255,45,85,.2)"}`}}>{sig.icon}</div>
        <div onClick={()=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");}} style={{cursor:"pointer"}}>
          <div style={{fontWeight:700,fontSize:12,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",color:C.text}}>
            {sig.token}
            <Badge label={sig.dir} color={sig.dir==="LONG"?"green":"red"}/>
            {sig.src==="trade.xyz"&&<Badge label="trade.xyz" color="blue"/>}
            {sig.src==="phantom"  &&<Badge label="phantom"   color="pink"/>}
            <span style={{fontSize:9,color:C.muted}}>{sig.time}</span>
          </div>
          <div style={{fontSize:10,color:C.muted2,lineHeight:1.5,marginTop:2}}>{sig.desc}</div>
          <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
            {sig.tags.map((tg,j)=><Badge key={j} label={tg.l} color={tg.c}/>)}
            <span style={{fontSize:9,color:C.muted}}>≤{sig.lev}</span>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
          <div style={{fontWeight:900,fontSize:20,color:sig.conf>=85?C.green:sig.conf>=70?C.gold:C.orange}}>{sig.conf}</div>
          <button onClick={()=>shareSignal(sig)} title="Copy to clipboard"
            style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.muted2,cursor:"pointer",fontSize:11,padding:"2px 6px"}}>📤</button>
        </div>
      </div>
    </div>
  );

  const hlLive=hlStatus==="live", fhLive=fhStatus==="live";
  const filtSigs=signals.filter(s=>{
    if(sigSubTab==="all")    return true;
    if(sigSubTab==="watch")  return watchlist.includes(s.token);
    if(sigSubTab==="crypto") return s.src==="hyperliquid";
    if(sigSubTab==="equity") return s.src==="trade.xyz";
    if(sigSubTab==="metals") return ["XAU","XAG"].includes(s.token);
    if(sigSubTab==="forex")  return FOREX_SYMS.includes(s.token);
    return true;
  });

  // ── BOTTOM NAV ────────────────────────────────────────
  const NAV=[
    {k:"prices", icon:"💹", label:"Prices"},
    {k:"watch",  icon:"⭐", label:"Watch"},
    {k:"signals",icon:"⚡", label:"Signals"},
    {k:"alerts", icon:"🔔", label:"Alerts"},
    {k:"ai",     icon:"🤖", label:"AI"},
  ];

  // ─────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",background:C.bg,color:C.text,minHeight:"100vh",paddingBottom:76,maxWidth:640,margin:"0 auto"}}>
      <style>{`
        @keyframes slideUp{from{transform:translateX(-50%) translateY(16px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        select,input,textarea{outline:none;}
        ::-webkit-scrollbar{display:none;}
        button{font-family:'IBM Plex Mono',monospace;}
      `}</style>

      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}

      {/* ── STICKY HEADER ── */}
      <div style={{padding:"12px 14px 8px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.bg,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div>
            <div style={{fontWeight:900,fontSize:20,color:C.green,letterSpacing:"0.08em",textShadow:darkMode?"0 0 20px rgba(0,229,160,.3)":"none",lineHeight:1}}>
              ALPHASCAN <span style={{color:C.cyan,fontSize:12}}>v11</span>
            </div>
            <div style={{fontSize:7,color:C.muted,letterSpacing:"0.18em",marginTop:2}}>CRYPTO · STOCKS · METALS · FOREX</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button data-testid="button-theme-toggle" onClick={()=>setDarkMode(d=>!d)} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:20,padding:"5px 11px",cursor:"pointer",fontSize:15}}>
              {darkMode?"☀️":"🌙"}
            </button>
            <div style={{textAlign:"right"}}>
              <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end",marginBottom:2}}>
                <LiveDot live={hlLive}/><span style={{fontSize:8,color:hlLive?C.green:C.orange}}>HL</span>
                <LiveDot live={fhLive}/><span style={{fontSize:8,color:fhLive?C.green:C.gold}}>FH</span>
              </div>
              <div style={{fontSize:7,color:C.muted}}>{lastUpdate.toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        {/* Ticker strip */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
          {["BTC","ETH","SOL","XAU","XAG","EURUSD","TSLA","NVDA"].map(sym=>{
            const d=allPrices[sym], flash=flashes[sym];
            return (
              <div key={sym} onClick={()=>{setAiInput(`${sym} — long or short right now?`);setTab("ai");}}
                style={{background:flash==="green"?"rgba(0,229,160,.15)":flash==="red"?"rgba(255,45,85,.1)":C.panel,
                  border:`1px solid ${d?.live?C.green+"55":C.border}`,borderRadius:6,padding:"5px 9px",
                  flexShrink:0,cursor:"pointer",minWidth:68,transition:"background .35s"}}>
                <div style={{fontSize:7,color:d?.live?C.green:C.muted}}>{sym}</div>
                <div style={{fontSize:10,fontWeight:700,color:flash==="green"?C.green:flash==="red"?C.red:C.text,transition:"color .35s",marginTop:1}}>{fmt(d?.price,sym)}</div>
                <div style={{fontSize:8,color:Number(d?.chg)>=0?C.green:C.red}}>{pct(d?.chg)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── PAGE CONTENT ── */}
      <div style={{padding:"10px 12px"}}>

        {/* ══ PRICES ══ */}
        {tab==="prices"&&<>
          <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto"}}>
            {[{k:"crypto",l:"⚡ Crypto",col:"green"},{k:"equity",l:"📊 Stocks",col:"blue"},{k:"metals",l:"🥇 Metals",col:"gold"},{k:"forex",l:"💱 Forex",col:"teal"}].map(t=>(
              <SubBtn key={t.k} k={t.k} label={t.l} col={t.col} state={priceTab} setter={setPriceTab}/>
            ))}
          </div>

          {priceTab==="crypto"&&<div style={panel}>
            <div style={ph}><span style={pt}>⚡ Crypto · Hyperliquid</span><Badge label={hlLive?"LIVE":"Connecting"} color={hlLive?"green":"orange"}/></div>
            <div style={{padding:"4px 14px",background:darkMode?"rgba(0,229,160,.04)":"rgba(0,180,120,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>
              api.hyperliquid.xyz · Free · No key · Updates every 3s
            </div>
            {CRYPTO_SYMS.map(sym=>{
              const d=cryptoPrices[sym];
              return (
                <div key={sym}>
                  <PriceRow sym={sym} d={d} extra={d?.live&&d.funding?`Fund: ${pct(d.funding,4)}/8h · OI: $${(d.oi/1e6).toFixed(0)}M`:null}/>
                  {d?.oiHistory?.length>3&&(
                    <div style={{padding:"2px 14px 8px",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:7,color:C.muted,letterSpacing:"0.1em",flexShrink:0}}>OI TREND</span>
                      <Sparkline data={d.oiHistory} width={90} height={20}/>
                      <span style={{fontSize:8,color:C.muted2}}>${(d.oi/1e6).toFixed(0)}M</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>}

          {priceTab==="equity"&&<div style={panel}>
            <div style={ph}><span style={pt}>📊 Stocks · trade.xyz</span><Badge label={fhLive?`${Object.values(equityPrices).filter(p=>p.live).length} LIVE`:"CLOSED"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px",background:darkMode?"rgba(59,130,246,.04)":"rgba(37,99,235,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>finnhub.io · NYSE hours 9:30am–4pm ET</div>
            {EQUITY_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={equityPrices[sym]}/>)}
          </div>}

          {priceTab==="metals"&&<div style={panel}>
            <div style={ph}><span style={pt}>🥇 Metals · Phantom</span><Badge label={fhLive?`${Object.values(metalPrices).filter(p=>p.live).length} LIVE`:"CLOSED"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px",background:darkMode?"rgba(255,196,0,.04)":"rgba(180,140,0,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>Finnhub OANDA · XAU & XAG</div>
            {METALS_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={metalPrices[sym]}/>)}
            <div style={{padding:"8px 14px",fontSize:9,color:C.muted2}}>
              Gold/Silver Ratio: <span style={{color:C.gold,fontWeight:700}}>{metalPrices.XAU?.price&&metalPrices.XAG?.price?(metalPrices.XAU.price/metalPrices.XAG.price).toFixed(0):"—"}:1</span>
              {metalPrices.XAU?.price&&metalPrices.XAG?.price&&(metalPrices.XAU.price/metalPrices.XAG.price)>=90&&<span style={{color:C.green}}> ← bullish for silver</span>}
            </div>
          </div>}

          {priceTab==="forex"&&<div style={panel}>
            <div style={ph}><span style={pt}>💱 Forex · Phantom</span><Badge label={fhLive?`${Object.values(forexPrices).filter(p=>p.live).length} LIVE`:"CLOSED"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px",background:darkMode?"rgba(20,184,166,.04)":"rgba(15,118,110,.04)",borderBottom:`1px solid ${C.border}`,fontSize:8,color:C.muted2}}>Finnhub OANDA · 24/5 (closed weekends)</div>
            {FOREX_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={forexPrices[sym]}/>)}
          </div>}
        </>}

        {/* ══ WATCHLIST ══ */}
        {tab==="watch"&&<>
          <div style={panel}>
            <div style={ph}><span style={pt}>⭐ Watchlist</span><Badge label={`${watchlist.length} symbols`} color="gold"/></div>
            {watchlist.length===0
              ? <div style={{padding:28,textAlign:"center",color:C.muted,fontSize:11}}>Tap ⭐ on any price row to add symbols</div>
              : watchlist.map(sym=>{
                  const d=allPrices[sym], flash=flashes[sym];
                  const oiData=cryptoPrices[sym]?.oiHistory;
                  return (
                    <div key={sym} style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,transition:"background .35s",
                      background:flash==="green"?"rgba(0,229,160,.12)":flash==="red"?"rgba(255,45,85,.1)":"transparent",
                      display:"grid",gridTemplateColumns:"1fr auto auto auto auto",gap:8,alignItems:"center"}}>
                      <div style={{fontWeight:700,fontSize:14,color:C.text}}>{sym}</div>
                      {oiData?.length>3?<Sparkline data={oiData} width={55} height={20}/>:<div/>}
                      <div style={{fontSize:13,fontWeight:700,color:flash==="green"?C.green:flash==="red"?C.red:C.text,transition:"color .35s"}}>{fmt(d?.price,sym)}</div>
                      <div style={{fontSize:11,color:Number(d?.chg)>=0?C.green:C.red}}>{pct(d?.chg)}</div>
                      <button onClick={()=>toggleWatch(sym)} style={{background:"none",border:"none",cursor:"pointer",fontSize:16}}>⭐</button>
                    </div>
                  );
                })
            }
          </div>
          {signals.filter(s=>watchlist.includes(s.token)).length>0&&(
            <div style={panel}>
              <div style={ph}><span style={pt}>⚡ Signals for watchlist</span></div>
              {signals.filter(s=>watchlist.includes(s.token)).slice(0,5).map(sig=><SignalRow key={sig.id} sig={sig}/>)}
            </div>
          )}
        </>}

        {/* ══ SIGNALS ══ */}
        {tab==="signals"&&<>
          <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto"}}>
            {[{k:"all",l:"All",col:"green"},{k:"watch",l:"⭐ Watch",col:"gold"},{k:"crypto",l:"Crypto",col:"green"},{k:"equity",l:"Stocks",col:"blue"},{k:"metals",l:"Metals",col:"gold"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
              <SubBtn key={t.k} k={t.k} label={t.l} col={t.col} state={sigSubTab} setter={setSigSubTab}/>
            ))}
          </div>
          <div style={panel}>
            <div style={ph}><span style={pt}>⚡ Alpha Signals</span><div style={{display:"flex",gap:5}}><Badge label={`${sigCount} total`} color="cyan"/><Badge label="📤 share" color="teal"/></div></div>
            {filtSigs.length===0?<div style={{padding:20,textAlign:"center",color:C.muted,fontSize:11}}>No signals for this filter.</div>:filtSigs.map(sig=><SignalRow key={sig.id} sig={sig}/>)}
          </div>
        </>}

        {/* ══ ALERTS ══ */}
        {tab==="alerts"&&<>
          <div style={panel}>
            <div style={ph}>
              <span style={pt}>🔔 Price Alerts</span>
              <button onClick={()=>setShowAlertForm(v=>!v)} style={{background:C.green,color:"#04060d",border:"none",borderRadius:5,padding:"4px 10px",fontSize:9,fontWeight:700,cursor:"pointer"}}>
                {showAlertForm?"✕ Cancel":"+ New"}
              </button>
            </div>

            {showAlertForm&&(
              <div style={{padding:14,borderBottom:`1px solid ${C.border}`,background:darkMode?"rgba(0,229,160,.04)":"rgba(0,180,120,.04)"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  {[
                    {label:"SYMBOL",key:"sym",opts:ALL_SYMS.map(s=>({v:s,l:s}))},
                    {label:"FIELD", key:"field",opts:[{v:"price",l:"Price"},{v:"funding",l:"Funding Rate (crypto)"}]},
                    {label:"WHEN",  key:"condition",opts:[{v:"above",l:"Goes Above"},{v:"below",l:"Goes Below"}]},
                  ].map(({label,key,opts})=>(
                    <div key={key}>
                      <div style={{fontSize:7,color:C.muted,marginBottom:3,letterSpacing:"0.12em"}}>{label}</div>
                      <select value={alertForm[key]} onChange={e=>setAlertForm(f=>({...f,[key]:e.target.value}))}
                        style={{width:"100%",background:C.panel,color:C.text,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>
                        {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </div>
                  ))}
                  <div>
                    <div style={{fontSize:7,color:C.muted,marginBottom:3,letterSpacing:"0.12em"}}>VALUE</div>
                    <input type="number" value={alertForm.threshold} onChange={e=>setAlertForm(f=>({...f,threshold:e.target.value}))}
                      placeholder="e.g. 90000" style={{width:"100%",background:C.panel,color:C.text,border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",fontFamily:"monospace",fontSize:10}}/>
                  </div>
                </div>
                <button onClick={()=>{
                  if(!alertForm.threshold) return;
                  const label=`${alertForm.sym} ${alertForm.field==="funding"?"funding":""} ${alertForm.condition} ${alertForm.threshold}`;
                  setAlerts(prev=>[...prev,{id:Date.now(),...alertForm,threshold:parseFloat(alertForm.threshold),triggered:false,label}]);
                  setAlertForm({sym:"BTC",field:"price",condition:"above",threshold:""});
                  setShowAlertForm(false); setToast("Alert created! 🔔");
                  if(Notification.permission==="default") Notification.requestPermission();
                }} style={{width:"100%",padding:"8px",background:C.green,color:"#04060d",border:"none",borderRadius:6,fontWeight:700,fontSize:10,cursor:"pointer"}}>
                  CREATE ALERT
                </button>
              </div>
            )}

            {alerts.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted,fontSize:11}}>No alerts. Tap + New to create one.</div>}
            {alerts.map(a=>{
              const val=a.field==="funding"?cryptoPrices[a.sym]?.funding:allPrices[a.sym]?.price;
              return (
                <div key={a.id} style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,
                  background:a.triggered?darkMode?"rgba(0,229,160,.06)":"rgba(0,180,120,.06)":"transparent"}}>
                  <div style={{fontSize:18}}>{a.triggered?"✅":"🔔"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:11,color:a.triggered?C.green:C.text}}>{a.label}</div>
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>
                      Now: <span style={{color:C.text}}>{val!=null?val.toFixed(a.field==="funding"?4:2):"—"}</span>
                      {a.triggered&&<span style={{color:C.green}}> · TRIGGERED ✓</span>}
                    </div>
                  </div>
                  <button onClick={()=>setAlerts(prev=>prev.filter(x=>x.id!==a.id))} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18}}>✕</button>
                </div>
              );
            })}
          </div>

          {/* Alert ideas */}
          <div style={panel}>
            <div style={ph}><span style={pt}>💡 Quick Alert Ideas</span></div>
            {[
              {sym:"BTC",field:"funding",condition:"above",threshold:0.05,label:"BTC funding > 0.05% (extreme longs)"},
              {sym:"XAU",field:"price",  condition:"above",threshold:3400, label:"Gold breaks $3,400 ATH"},
              {sym:"SOL",field:"funding",condition:"below",threshold:-0.02,label:"SOL funding negative (long bias)"},
              {sym:"USDJPY",field:"price",condition:"above",threshold:150,  label:"USDJPY > 150 (BOJ risk)"},
            ].map((idea,i)=>(
              <div key={i} style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,fontSize:10,color:C.muted2}}>{idea.label}</div>
                <button onClick={()=>{setAlerts(prev=>[...prev,{id:Date.now(),...idea,triggered:false}]);setToast("Alert added! 🔔");}}
                  style={{background:"none",border:`1px solid ${C.green}`,color:C.green,borderRadius:5,padding:"3px 9px",fontSize:9,cursor:"pointer",whiteSpace:"nowrap"}}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        </>}

        {/* ══ AI ══ */}
        {tab==="ai"&&(
          <div style={panel}>
            <div style={ph}><span style={pt}>🤖 AI Perp Analyst</span><Badge label="Claude · Live" color="cyan"/></div>
            <div style={{padding:14}}>
              <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
                {["BTC","ETH","SOL","XAU","EURUSD","TSLA","NVDA"].map(sym=>{
                  const d=allPrices[sym];
                  return <button key={sym} onClick={()=>setAiInput(`${sym} — long or short? Price:${fmt(d?.price,sym)} 24h:${pct(d?.chg)}`)}
                    style={{padding:"4px 9px",borderRadius:5,border:`1px solid ${d?.live?C.green:C.border}`,background:"transparent",color:d?.live?C.green:C.muted2,fontSize:9,cursor:"pointer"}}>
                    {sym}{d?.live?" 🟢":""}
                  </button>;
                })}
              </div>
              <textarea data-testid="input-ai-query" value={aiInput} onChange={e=>setAiInput(e.target.value)}
                placeholder={`"Long BTC now?" · "Is XAU overextended?" · "Best forex trade?"`}
                style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:6,padding:10,color:C.text,fontFamily:"monospace",fontSize:11,resize:"none",height:68}}/>
              <button data-testid="button-ai-analyze" onClick={runAI} disabled={aiLoading} style={{width:"100%",height:40,marginTop:8,background:aiLoading?"rgba(0,229,160,.3)":C.green,color:"#04060d",border:"none",borderRadius:6,fontWeight:700,fontSize:11,letterSpacing:"0.15em",textTransform:"uppercase",cursor:aiLoading?"not-allowed":"pointer"}}>
                {aiLoading?"⟳ Analyzing...":"Analyze →"}
              </button>
              {aiOutput&&<div style={{marginTop:12,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:6,padding:14,fontSize:11,lineHeight:1.9,color:C.text,whiteSpace:"pre-wrap",maxHeight:320,overflowY:"auto"}}>{aiOutput}</div>}
            </div>
          </div>
        )}

        <div style={{textAlign:"center",fontSize:7,color:C.muted,marginTop:4,letterSpacing:"0.1em"}}>
          HYPERLIQUID · FINNHUB · NOT FINANCIAL ADVICE
        </div>
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:C.navBg,borderTop:`1px solid ${C.navBorder}`,display:"flex",paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        {NAV.map(item=>{
          const active=tab===item.k;
          const alertBadge=item.k==="alerts"&&alerts.filter(a=>!a.triggered).length>0;
          return (
            <button key={item.k} data-testid={`nav-${item.k}`} onClick={()=>setTab(item.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px 2px 9px",background:"none",border:"none",cursor:"pointer",borderTop:`2px solid ${active?C.green:"transparent"}`,position:"relative"}}>
              <span style={{fontSize:19,lineHeight:1}}>{item.icon}</span>
              {alertBadge&&<div style={{position:"absolute",top:6,right:"50%",marginRight:-14,width:8,height:8,borderRadius:"50%",background:C.red}}/>}
              <span style={{fontSize:8,marginTop:3,fontFamily:"monospace",color:active?C.green:C.muted2,fontWeight:active?700:400,letterSpacing:"0.03em"}}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
