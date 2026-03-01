// ─────────────────────────────────────────────────────────
// CLVRQuant v1
// Full AlphaScan v12 functionality — CLVRQuant luxury aesthetic
// Playfair Display · IBM Plex Mono · Barlow · Navy/Black/Gold
// Backend-proxied API calls (keys stored server-side)
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

// ─── CLVRQuant Theme ──────────────────────────────────────
const C = {
  bg:"#050709", navy:"#080d18", panel:"#0c1220",
  border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7", pink:"#ec4899",
  navBg:"#050709", navBorder:"#141e35", inputBg:"#080d18",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

const pct=(v,d=2)=>{const n=Number(v);if(isNaN(n))return"—";return(n>=0?"+":"")+n.toFixed(d)+"%";};
const FOREX_4D=["EURUSD","GBPUSD","AUDUSD","USDCHF","USDCAD","NZDUSD","EURGBP","USDSGD"];
const FOREX_2D=["USDJPY","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY"];
const fmt=(p,sym)=>{
  if(!p&&p!==0)return"—";p=Number(p);if(isNaN(p)||p===0)return"—";
  if(FOREX_4D.includes(sym))return p.toFixed(4);
  if(FOREX_2D.includes(sym))return p.toFixed(2);
  if(["XAG","NATGAS","COPPER"].includes(sym))return"$"+p.toFixed(2);
  if(["XAU","PLATINUM","WTI","BRENT"].includes(sym))return"$"+p.toFixed(sym==="XAU"?0:2);
  if(p>=1000)return"$"+p.toFixed(0);
  if(p>=100)return"$"+p.toFixed(1);
  if(p>=1)return"$"+p.toFixed(2);
  return"$"+p.toFixed(6);
};
const rndInt=(a,b)=>Math.floor(a+Math.random()*(b-a+1));
const timeAgo=(ts)=>{if(!ts)return"";const s=Math.floor((Date.now()-ts)/1000);if(s<10)return"just now";if(s<60)return`${s}s ago`;const m=Math.floor(s/60);if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;return`${Math.floor(h/24)}d ago`;};

// ─── BASE PRICES ──────────────────────────────────────────
const CRYPTO_BASE={BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,MATIC:0.55,UNI:9.5,AAVE:220,NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18};
const EQUITY_BASE={TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310,AMD:145,PLTR:70,COIN:210,SQ:72,SHOP:95,CRM:290,NFLX:850,DIS:105};
const METALS_BASE={XAU:5280,XAG:94,WTI:99,BRENT:16,NATGAS:13,COPPER:31.5,PLATINUM:2370};
const FOREX_BASE={EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654,NZDUSD:0.5932,EURGBP:0.8526,EURJPY:162.45,GBPJPY:190.52,USDMXN:17.15,USDZAR:18.45,USDTRY:32.5,USDSGD:1.34};
const CRYPTO_SYMS=Object.keys(CRYPTO_BASE);
const EQUITY_SYMS=Object.keys(EQUITY_BASE);
const METALS_SYMS=Object.keys(METALS_BASE);
const FOREX_SYMS=Object.keys(FOREX_BASE);
const ALL_SYMS=[...CRYPTO_SYMS,...EQUITY_SYMS,...METALS_SYMS,...FOREX_SYMS];
const METAL_LABELS={XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABELS={EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

// ─── SIGNALS & NEWS ───────────────────────────────────────
const SIGNALS_POOL=[
  {icon:"🚀",dir:"LONG",token:"SOL",conf:94,lev:"10x",src:"hyperliquid",desc:"Smart money wallets +$2.4M in 18min. Shorts clustered above — sweep incoming.",tags:[{l:"ON-CHAIN",c:"green"},{l:"LIQ SWEEP",c:"cyan"}]},
  {icon:"📉",dir:"SHORT",token:"BTC",conf:81,lev:"5x",src:"hyperliquid",desc:"OI at resistance. Funding extreme positive. Reversal setup forming.",tags:[{l:"FUNDING",c:"orange"},{l:"RESISTANCE",c:"red"}]},
  {icon:"🔥",dir:"LONG",token:"WIF",conf:88,lev:"3x",src:"hyperliquid",desc:"Whale 0x7f3 opened 8.4M WIF perp. Same wallet +340% on BONK pre-pump.",tags:[{l:"WHALE",c:"orange"},{l:"NEUTRAL FUND",c:"green"}]},
  {icon:"📈",dir:"LONG",token:"TSLA",conf:86,lev:"5x",src:"trade.xyz",desc:"Earnings beat whisper +18%. Smart money opened $3.1M long.",tags:[{l:"EARNINGS",c:"gold"},{l:"WHALE",c:"orange"}]},
  {icon:"🚀",dir:"LONG",token:"NVDA",conf:91,lev:"5x",src:"trade.xyz",desc:"H100 supply chain: +40% shipments detected in Taiwan customs.",tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"NEG FUND",c:"green"}]},
  {icon:"🥇",dir:"LONG",token:"XAU",conf:89,lev:"5x",src:"phantom",desc:"Central bank gold buying +42t. DXY weakening. Path to $3,400 open.",tags:[{l:"MACRO",c:"gold"},{l:"CENTRAL BANK",c:"teal"}]},
  {icon:"🥈",dir:"LONG",token:"XAG",conf:83,lev:"5x",src:"phantom",desc:"Gold/silver ratio 100:1. Solar industrial demand surging.",tags:[{l:"RATIO",c:"teal"},{l:"INDUSTRIAL",c:"cyan"}]},
  {icon:"💱",dir:"SHORT",token:"USDJPY",conf:84,lev:"10x",src:"phantom",desc:"BOJ hawkish minutes leaked. JPY intervention risk at ¥150.",tags:[{l:"BOJ",c:"teal"},{l:"INTERVENTION",c:"red"}]},
  {icon:"📊",dir:"LONG",token:"EURUSD",conf:79,lev:"10x",src:"phantom",desc:"ECB holds, Fed cutting. Rate differential narrowing.",tags:[{l:"RATE DIFF",c:"blue"},{l:"LIQ SWEEP",c:"green"}]},
  {icon:"💎",dir:"LONG",token:"PEPE",conf:76,lev:"5x",src:"hyperliquid",desc:"$18M PEPE exchange outflow. Supply squeeze. Funding negative.",tags:[{l:"OUTFLOW",c:"green"},{l:"NEG FUND",c:"cyan"}]},
  {icon:"⚠️",dir:"SHORT",token:"META",conf:73,lev:"3x",src:"trade.xyz",desc:"EU antitrust fine €1.2B imminent. Options flow bearish.",tags:[{l:"REGULATORY",c:"red"},{l:"FUNDING",c:"orange"}]},
  {icon:"🎯",dir:"LONG",token:"AAPL",conf:77,lev:"3x",src:"trade.xyz",desc:"iPhone 17 supply chain: orders up 22% vs prior cycle.",tags:[{l:"SUPPLY CHAIN",c:"cyan"},{l:"SMART MONEY",c:"purple"}]},
];
const NEWS_POOL=[
  {txt:"BOJ minutes leaked — 2 members backed rate hike, ¥150 intervention confirmed",src:"Macro Leak",col:"teal"},
  {txt:"NVDA H100: +40% shipments detected in Taiwan customs — not yet public",src:"Supply Chain",col:"green"},
  {txt:"Central bank gold: China +42t March, Russia +18t — XAU breakout fuel",src:"CB Monitor",col:"gold"},
  {txt:"Fed minutes: 2 members backed 25bps cut at last meeting",src:"Macro Leak",col:"gold"},
  {txt:"TSLA: CEO social activity spiking 3hrs before earnings — historical pattern",src:"Social Monitor",col:"orange"},
  {txt:"META EU antitrust fine €1.2B — Brussels court filing detected",src:"Legal Scanner",col:"red"},
  {txt:"SOL: 3 whale wallets accumulated $6.1M in 1hr on-chain",src:"On-chain",col:"green"},
  {txt:"Gold/silver ratio 100:1 — historically signals silver outperformance",src:"Metals Watch",col:"teal"},
];

// ─── API FETCHERS (proxied through backend) ──────────────
async function fetchHyperliquid(){
  const r=await fetch("/api/crypto");
  if(!r.ok)throw new Error(`Crypto API ${r.status}`);
  return await r.json();
}
async function fetchPerps(){
  const r=await fetch("/api/perps");
  if(!r.ok)throw new Error(`Perps API ${r.status}`);
  return await r.json();
}
async function fetchLiveSignals(since=0){
  const r=await fetch(`/api/signals?since=${since}`);
  if(!r.ok)throw new Error(`Signals API ${r.status}`);
  return await r.json();
}
async function fetchFinnhub(){
  const r=await fetch("/api/finnhub");
  if(!r.ok)throw new Error(`Finnhub API ${r.status}`);
  return await r.json();
}

// ─── SPARKLINE ────────────────────────────────────────────
function Sparkline({data,color,width=80,height=22}){
  if(!data||data.length<2)return<span style={{fontSize:8,opacity:.3,color:C.muted}}>—</span>;
  const min=Math.min(...data),max=Math.max(...data),range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*(height-2)+1}`).join(" ");
  const up=data[data.length-1]>=data[0];
  return(
    <svg width={width} height={height} style={{overflow:"visible",flexShrink:0}}>
      <polyline points={pts} fill="none" stroke={color||(up?C.green:C.red)} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)/(data.length-1)*width} cy={height-((data[data.length-1]-min)/range)*(height-2)+1} r="2.5" fill={color||(up?C.green:C.red)}/>
    </svg>
  );
}

// ─── TOAST (useRef fix) ──────────────────────────────────
function Toast({msg,onDone}){
  const onDoneRef=useRef(onDone);
  onDoneRef.current=onDone;
  useEffect(()=>{const t=setTimeout(()=>onDoneRef.current(),2500);return()=>clearTimeout(t);},[]);
  return(
    <div style={{position:"fixed",bottom:88,left:"50%",transform:"translateX(-50%)",
      background:C.gold,color:C.bg,borderRadius:2,padding:"10px 20px",
      fontSize:10,fontWeight:700,fontFamily:MONO,zIndex:9999,letterSpacing:"0.1em",
      boxShadow:`0 4px 24px rgba(201,168,76,.5)`,whiteSpace:"nowrap",
      animation:"slideUp .2s ease"}}>
      {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]=useState("prices");
  const [priceTab,setPriceTab]=useState("crypto");
  const [sigSubTab,setSigSubTab]=useState("all");
  const [macroFilter,setMacroFilter]=useState("ALL");

  const [cryptoSubTab,setCryptoSubTab]=useState("spot");
  const [cryptoPrices,setCryptoPrices]=useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,live:false,oiHistory:[]}])));
  const [perpPrices,setPerpPrices]=useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,live:false}])));
  const [equityPrices,setEquityPrices]=useState(()=>Object.fromEntries(EQUITY_SYMS.map(k=>[k,{price:EQUITY_BASE[k],chg:0,live:false}])));
  const [metalPrices,setMetalPrices]=useState(()=>Object.fromEntries(METALS_SYMS.map(k=>[k,{price:METALS_BASE[k],chg:0,live:false}])));
  const [forexPrices,setForexPrices]=useState(()=>Object.fromEntries(FOREX_SYMS.map(k=>[k,{price:FOREX_BASE[k],chg:0,live:false}])));

  const [flashes,setFlashes]=useState({});
  const prevRef=useRef({});
  const [watchlist,setWatchlist]=useState(["BTC","ETH","SOL","XAU","TSLA"]);
  const [alerts,setAlerts]=useState([
    {id:1,sym:"BTC",field:"funding",condition:"above",threshold:0.05,triggered:false,label:"BTC funding > 0.05%"},
    {id:2,sym:"XAU",field:"price",condition:"above",threshold:3400,triggered:false,label:"XAU price > $3,400"},
  ]);
  const [alertForm,setAlertForm]=useState({sym:"BTC",field:"price",condition:"above",threshold:""});
  const [showAlertForm,setShowAlertForm]=useState(false);
  const [signals,setSignals]=useState(()=>{const now=Date.now();return SIGNALS_POOL.slice(0,8).map((s,i)=>({...s,ts:now-(i*4+2)*60000,id:i}));});
  const [liveSignals,setLiveSignals]=useState([]);
  const [sigTracking,setSigTracking]=useState(0);
  const [news,setNews]=useState(()=>{const now=Date.now();return NEWS_POOL.map((n,i)=>({...n,ts:now-(i*6+1)*60000,id:i}));});
  const [flashSigId,setFlashSigId]=useState(null);
  const [sigCount,setSigCount]=useState(44);
  const [tick,setTick]=useState(0);
  const [lastUpdate,setLastUpdate]=useState(new Date());
  const [hlStatus,setHlStatus]=useState("connecting");
  const [fhStatus,setFhStatus]=useState("connecting");
  const [toast,setToast]=useState(null);
  const [aiInput,setAiInput]=useState("");
  const [aiOutput,setAiOutput]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const idRef=useRef(300);

  const [subEmail,setSubEmail]=useState("");
  const [subName,setSubName]=useState("");
  const [subLoading,setSubLoading]=useState(false);
  const [subList,setSubList]=useState([]);

  const [briefLoading,setBriefLoading]=useState(false);
  const [briefData,setBriefData]=useState(null);
  const [briefDate,setBriefDate]=useState(null);

  const [macroEvents,setMacroEvents]=useState([]);
  const [macroLoading,setMacroLoading]=useState(true);

  // ── flash helper ─────────────────────────────────────
  const triggerFlashes=useCallback((updates)=>{
    const nF={};
    Object.entries(updates).forEach(([sym,d])=>{
      const prev=prevRef.current[sym];
      if(prev&&d.price&&d.price!==prev)nF[sym]=d.price>prev?"green":"red";
      if(d.price)prevRef.current[sym]=d.price;
    });
    if(Object.keys(nF).length){
      setFlashes(f=>({...f,...nF}));
      setTimeout(()=>setFlashes(f=>{const n={...f};Object.keys(nF).forEach(k=>delete n[k]);return n;}),700);
    }
  },[]);

  // ── Crypto Spot (Binance) ───────────────────────────
  const doHL=useCallback(async()=>{
    try{
      const data=await fetchHyperliquid();
      setCryptoPrices(prev=>{const next={...prev};Object.entries(data).forEach(([sym,d])=>{const hist=[...(prev[sym]?.oiHistory||[]),d.oi].slice(-20);next[sym]={...prev[sym],...d,oiHistory:hist};});triggerFlashes(next);return next;});
      setHlStatus("live");
    }catch{setHlStatus("error");}
  },[triggerFlashes]);
  useEffect(()=>{doHL();const iv=setInterval(doHL,2000);return()=>clearInterval(iv);},[doHL]);

  // ── Crypto Perps (Hyperliquid) ─────────────────────
  const doPerps=useCallback(async()=>{
    try{
      const data=await fetchPerps();
      setPerpPrices(prev=>{const next={...prev};Object.entries(data).forEach(([sym,d])=>{next[sym]={...prev[sym],...d};});return next;});
    }catch{}
  },[]);
  useEffect(()=>{doPerps();const iv=setInterval(doPerps,5000);return()=>clearInterval(iv);},[doPerps]);

  // ── Live Signal Detection ─────────────────────────
  const lastSigTs=useRef(0);
  const seenSigIds=useRef(new Set());
  useEffect(()=>{
    const doSigFetch=async()=>{
      try{
        const data=await fetchLiveSignals(lastSigTs.current);
        if(data.signals&&data.signals.length>0){
          const newSigs=data.signals.filter(s=>!seenSigIds.current.has(s.id));
          if(newSigs.length>0){
            newSigs.forEach(s=>seenSigIds.current.add(s.id));
            setLiveSignals(prev=>[...newSigs,...prev].slice(0,50));
            setSigCount(c=>c+newSigs.length);
            setFlashSigId(newSigs[0].id);
            setTimeout(()=>setFlashSigId(null),3000);
            if(typeof Notification!=="undefined"&&Notification.permission==="granted"){
              const s=newSigs[0];
              new Notification(`CLVRQuant Alpha: ${s.token} ${s.dir}`,{body:s.desc});
            }
          }
          lastSigTs.current=Math.max(...data.signals.map(s=>s.ts));
        }
        setSigTracking(data.tracking||0);
      }catch{}
    };
    doSigFetch();
    const iv=setInterval(doSigFetch,10000);
    return()=>clearInterval(iv);
  },[]);

  // ── Finnhub ──────────────────────────────────────────
  const doFH=useCallback(async()=>{
    try{
      const{stocks,metals,forex}=await fetchFinnhub();
      setEquityPrices(prev=>{const n={...prev,...stocks};triggerFlashes(n);return n;});
      setMetalPrices(prev=>{const n={...prev,...metals};triggerFlashes(n);return n;});
      setForexPrices(prev=>{const n={...prev,...forex};triggerFlashes(n);return n;});
      const anyLive=[...Object.values(stocks),...Object.values(metals),...Object.values(forex)].some(p=>p.live);
      setFhStatus(anyLive?"live":"closed");
    }catch{setFhStatus("error");}
  },[triggerFlashes]);
  useEffect(()=>{doFH();const iv=setInterval(doFH,15000);return()=>clearInterval(iv);},[doFH]);

  // ── Macro calendar (auto-refresh every 5 min) ─────────
  const fetchMacro=useCallback(()=>{
    fetch("/api/macro").then(r=>r.json()).then(data=>{
      if(Array.isArray(data)) setMacroEvents(data);
      setMacroLoading(false);
    }).catch(()=>setMacroLoading(false));
  },[]);
  useEffect(()=>{fetchMacro();const iv=setInterval(fetchMacro,300000);return()=>clearInterval(iv);},[fetchMacro]);

  const allPrices={...cryptoPrices,...equityPrices,...metalPrices,...forexPrices};

  // ── Alert checker ────────────────────────────────────
  useEffect(()=>{
    const vals={};
    Object.entries(cryptoPrices).forEach(([sym,d])=>{vals[sym]=d.price;vals[sym+"_funding"]=d.funding;});
    Object.entries({...equityPrices,...metalPrices,...forexPrices}).forEach(([sym,d])=>{vals[sym]=d.price;});
    setAlerts(prev=>prev.map(a=>{
      if(a.triggered)return a;
      const key=a.field==="funding"?a.sym+"_funding":a.sym;
      const val=vals[key];if(val===undefined)return a;
      const hit=a.condition==="above"?val>=a.threshold:val<=a.threshold;
      if(hit){
        setToast(`✦ ALERT: ${a.label}`);
        if(typeof Notification!=="undefined"&&Notification.permission==="granted")new Notification("CLVRQuant",{body:a.label});
        return{...a,triggered:true};
      }
      return a;
    }));
  },[cryptoPrices,equityPrices,metalPrices,forexPrices]);

  // ── 1s tick (tickRef fix) ──────────────────────────────
  const tickRef=useRef(0);
  useEffect(()=>{
    const iv=setInterval(()=>{
      tickRef.current++;
      setTick(tickRef.current);setLastUpdate(new Date());
      if(tickRef.current%22===0){const s=SIGNALS_POOL[rndInt(0,SIGNALS_POOL.length-1)];const ns={...s,ts:Date.now(),id:idRef.current++};setSignals(prev=>[ns,...prev.slice(0,11)]);setSigCount(c=>c+1);setFlashSigId(ns.id);setTimeout(()=>setFlashSigId(null),3000);}
      if(tickRef.current%45===0){const n=NEWS_POOL[rndInt(0,NEWS_POOL.length-1)];setNews(prev=>[{...n,ts:Date.now(),id:idRef.current++},...prev.slice(0,10)]);}
    },1000);
    return()=>clearInterval(iv);
  },[]);

  // ── Watchlist ────────────────────────────────────────
  const toggleWatch=sym=>{const has=watchlist.includes(sym);setWatchlist(prev=>has?prev.filter(s=>s!==sym):[...prev,sym]);setToast(has?`Removed ${sym}`:`${sym} added to watchlist ✦`);};
  const isWatched=sym=>watchlist.includes(sym);

  // ── Copy helper (clipboard fallback) ─────────────────
  const copyText=useCallback((text)=>{
    if(navigator.clipboard&&window.isSecureContext){
      navigator.clipboard.writeText(text).then(()=>setToast("Copied ✦")).catch(()=>{fallbackCopy(text);});
    }else{fallbackCopy(text);}
    function fallbackCopy(t){
      const ta=document.createElement("textarea");
      ta.value=t;ta.style.position="fixed";ta.style.left="-9999px";ta.style.top="-9999px";
      document.body.appendChild(ta);ta.focus();ta.select();
      try{document.execCommand("copy");setToast("Copied ✦");}
      catch{setToast("Copy failed — long press to copy");}
      document.body.removeChild(ta);
    }
  },[]);

  // ── Share signal ─────────────────────────────────────
  const shareSignal=sig=>{
    const price=fmt(allPrices[sig.token]?.price,sig.token);
    copyText(`✦ CLVRQuant SIGNAL\n${sig.icon} ${sig.token} ${sig.dir} | Conf: ${sig.conf}/100 | ${sig.lev}\n💰 Price: ${price}\n📊 ${sig.desc}\n🏷 ${sig.tags.map(t=>t.l).join(" · ")}\n📡 ${sig.src}`);
  };

  // ── Subscribe ─────────────────────────────────────
  const handleSubscribe=async()=>{
    if(!subEmail||!subEmail.includes("@")){setToast("Enter a valid email address");return;}
    setSubLoading(true);
    try{
      await fetch("/api/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:subEmail,name:subName||"Trader"})});
      setSubList(prev=>[...prev.filter(e=>e!==subEmail),subEmail]);
      setToast(`✦ Subscribed — briefs at 6:00 AM`);
      setSubEmail("");setSubName("");
    }catch{setToast("Subscribe failed");}
    setSubLoading(false);
  };

  // ── Daily Brief via backend AI ─────────────────────
  const generateBrief=async()=>{
    setBriefLoading(true);
    const btc=cryptoPrices["BTC"],eth=cryptoPrices["ETH"],sol=cryptoPrices["SOL"];
    const xau=metalPrices["XAU"],xag=metalPrices["XAG"];
    const eurusd=forexPrices["EURUSD"],usdjpy=forexPrices["USDJPY"],usdcad=forexPrices["USDCAD"];
    const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const prompt=`Generate a concise morning market brief for ${todayStr}. Live data:
BTC: ${fmt(btc?.price,"BTC")} (${pct(btc?.chg)}) | Fund: ${pct(btc?.funding,4)}/8h
ETH: ${fmt(eth?.price,"ETH")} (${pct(eth?.chg)}) | SOL: ${fmt(sol?.price,"SOL")} (${pct(sol?.chg)})
XAU: ${fmt(xau?.price,"XAU")} | XAG: ${fmt(xag?.price,"XAG")}
EUR/USD: ${fmt(eurusd?.price,"EURUSD")} | USD/JPY: ${fmt(usdjpy?.price,"USDJPY")} | USD/CAD: ${fmt(usdcad?.price,"USDCAD")}
Write JSON (no markdown):
{"headline":"one-line market sentiment","bias":"RISK ON|RISK OFF|NEUTRAL","btc":"2 sentence BTC analysis with key levels","eth":"1 sentence ETH","sol":"1 sentence SOL","xau":"2 sentence gold analysis","xag":"1 sentence silver","eurusd":"2 sentence EUR/USD analysis","usdjpy":"2 sentence USD/JPY with BOJ context","usdcad":"2 sentence USD/CAD","watchToday":["item1","item2","item3","item4","item5"],"keyRisk":"single sentence on biggest risk today"}`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userMessage:prompt})});
      const data=await res.json();
      if(!res.ok){setToast(data.error||"Brief generation failed");setBriefLoading(false);return;}
      const txt=data.text||"";
      const clean=txt.replace(/```json|```/g,"").trim();
      setBriefData(JSON.parse(clean));setBriefDate(todayStr);
    }catch{setToast("Brief generation failed. Try again.");}
    setBriefLoading(false);
  };

  // ── AI ────────────────────────────────────────────────
  const runAI=async()=>{
    if(!aiInput.trim()||aiLoading)return;
    setAiLoading(true);setAiOutput("");
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" ✅":" ~"}`:"—";};
    const sys=`You are CLVRQuant, elite multi-market trading AI.
CRYPTO: ${CRYPTO_SYMS.slice(0,5).map(s=>`${s}:${snap(s,cryptoPrices)}${cryptoPrices[s]?.funding?` F:${pct(cryptoPrices[s].funding,4)}/8h`:""}`).join(" | ")}
STOCKS: ${EQUITY_SYMS.slice(0,4).map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ")}
METALS: XAU:${snap("XAU",metalPrices)} XAG:${snap("XAG",metalPrices)}
FOREX: ${FOREX_SYMS.slice(0,4).map(s=>`${s}:${snap(s,forexPrices)}`).join(" | ")}
Give: DIRECTION / ENTRY / STOP / TP1 / TP2 / LEVERAGE / CONVICTION / 2-line REASON. No disclaimers.`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:aiInput})});
      const data=await res.json();
      if(!res.ok){setAiOutput(data.error||`Error ${res.status}`);setAiLoading(false);return;}
      setAiOutput(data.text||"No response.");
    }catch(e){setAiOutput(`Error: ${e.message}`);}
    setAiLoading(false);
  };

  // ─── Style Helpers ─────────────────────────────────────
  const Badge=({label,color="gold",style={}})=>{
    const map={
      gold:{bg:"rgba(201,168,76,.1)",color:C.gold,border:"rgba(201,168,76,.25)"},
      green:{bg:"rgba(0,199,135,.1)",color:C.green,border:"rgba(0,199,135,.25)"},
      red:{bg:"rgba(255,64,96,.1)",color:C.red,border:"rgba(255,64,96,.25)"},
      orange:{bg:"rgba(255,140,0,.1)",color:C.orange,border:"rgba(255,140,0,.25)"},
      cyan:{bg:"rgba(0,212,255,.1)",color:C.cyan,border:"rgba(0,212,255,.25)"},
      blue:{bg:"rgba(59,130,246,.1)",color:C.blue,border:"rgba(59,130,246,.25)"},
      teal:{bg:"rgba(20,184,166,.1)",color:C.teal,border:"rgba(20,184,166,.25)"},
      pink:{bg:"rgba(236,72,153,.1)",color:C.pink,border:"rgba(236,72,153,.25)"},
      purple:{bg:"rgba(168,85,247,.1)",color:C.purple,border:"rgba(168,85,247,.25)"},
      muted:{bg:"rgba(74,93,128,.1)",color:C.muted2,border:"rgba(74,93,128,.25)"},
    };
    const t=map[color]||map.gold;
    return<span data-testid={`badge-${label}`} style={{fontSize:8,padding:"2px 7px",borderRadius:2,background:t.bg,color:t.color,border:`1px solid ${t.border}`,fontFamily:MONO,letterSpacing:"0.15em",textTransform:"uppercase",fontWeight:600,...style}}>{label}</span>;
  };

  const SLabel=({children})=>(
    <div style={{fontFamily:MONO,fontSize:8,letterSpacing:"0.28em",textTransform:"uppercase",color:C.gold,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{flex:"0 0 24px",height:1,background:`linear-gradient(90deg,${C.gold},transparent)`,display:"inline-block"}}/>
      {children}
    </div>
  );

  const panel={background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const PTitle=({children})=><span style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white}}>{children}</span>;

  const SubBtn=({k,label,col="gold",state,setter})=>{
    const active=state===k;
    const ac=col==="green"?C.green:col==="blue"?C.blue:col==="teal"?C.teal:col==="red"?C.red:col==="purple"?C.purple:col==="orange"?C.orange:col==="cyan"?C.cyan:C.gold;
    return<button onClick={()=>setter(k)} style={{padding:"5px 11px",borderRadius:2,whiteSpace:"nowrap",outline:"none",cursor:"pointer",fontFamily:MONO,fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",border:`1px solid ${active?ac:C.border}`,background:active?"rgba(201,168,76,.07)":C.panel,color:active?ac:C.muted2,transition:"all .2s"}}>{label}</button>;
  };
  const LiveDot=({live})=><div style={{width:5,height:5,borderRadius:"50%",flexShrink:0,background:live?C.green:C.orange,boxShadow:live?`0 0 6px ${C.green}`:"none"}}/>;

  const PriceRow=({sym,d,extra,label})=>{
    if(!d)return null;
    const flash=flashes[sym];const isUp=Number(d.chg)>=0;
    return(
      <div data-testid={`price-row-${sym}`} style={{padding:"11px 14px",borderBottom:`1px solid ${C.border}`,transition:"background .35s",
        background:flash==="green"?"rgba(0,199,135,.05)":flash==="red"?"rgba(255,64,96,.05)":"transparent",
        display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:8,alignItems:"center"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <span style={{fontFamily:MONO,fontWeight:600,fontSize:12,color:C.text,letterSpacing:"0.05em"}}>{sym}</span>
            {label&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>{label}</span>}
            <button onClick={()=>toggleWatch(sym)} style={{background:"none",border:"none",cursor:"pointer",padding:0,fontSize:11,color:isWatched(sym)?C.gold:C.muted,opacity:isWatched(sym)?1:.3,transition:"all .2s"}}>✦</button>
          </div>
          {extra&&<div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:2}}>{extra}</div>}
        </div>
        <div style={{fontFamily:MONO,fontSize:13,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .35s"}}>{fmt(d.price,sym)}</div>
        <div style={{fontFamily:MONO,fontSize:10,color:isUp?C.green:C.red,minWidth:50,textAlign:"right"}}>{pct(d.chg)}</div>
        {d.live?<Badge label="LIVE" color="green"/>:<Badge label="SIM" color="orange"/>}
      </div>
    );
  };

  const SignalRow=({sig})=>(
    <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:flashSigId===sig.id?"rgba(201,168,76,.03)":"transparent",transition:"background .5s"}}>
      <div style={{display:"grid",gridTemplateColumns:"28px 1fr auto",gap:10,alignItems:"start"}}>
        <div onClick={()=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");}}
          style={{width:26,height:26,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:sig.real?11:13,cursor:"pointer",
            fontFamily:sig.real?MONO:undefined,fontWeight:sig.real?800:undefined,color:sig.real?(sig.dir==="LONG"?C.green:C.red):undefined,
            background:sig.dir==="LONG"?"rgba(0,199,135,.08)":"rgba(255,64,96,.08)",
            border:`1px solid ${sig.dir==="LONG"?"rgba(0,199,135,.2)":"rgba(255,64,96,.2)"}`}}>{sig.real?(sig.dir==="LONG"?"+":"-"):sig.icon}</div>
        <div onClick={()=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");}} style={{cursor:"pointer"}}>
          <div style={{fontFamily:MONO,fontWeight:600,fontSize:11,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",color:C.text,letterSpacing:"0.05em"}}>
            {sig.token}<Badge label={sig.dir} color={sig.dir==="LONG"?"green":"red"}/>
            {sig.real&&<Badge label="LIVE" color="green"/>}
            {sig.src==="trade.xyz"&&<Badge label="trade.xyz" color="blue"/>}
            {sig.src==="phantom"&&<Badge label="phantom" color="pink"/>}
            {sig.src==="alpha-detect"&&<Badge label="alpha-detect" color="gold"/>}
            {sig.pctMove&&<span style={{fontFamily:MONO,fontSize:9,color:sig.pctMove>0?C.green:C.red,fontWeight:700}}>{sig.pctMove>0?"+":""}{sig.pctMove}%</span>}
            <span style={{fontSize:8,color:C.muted,fontFamily:MONO}}>{timeAgo(sig.ts)}</span>
          </div>
          <div style={{fontSize:10,color:C.muted2,lineHeight:1.65,marginTop:3}}>{sig.desc}</div>
          <div style={{display:"flex",gap:3,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
            {sig.tags.map((tg,j)=><Badge key={j} label={tg.l} color={tg.c}/>)}
            <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>≤{sig.lev}</span>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
          <div style={{fontFamily:SERIF,fontWeight:900,fontSize:22,color:sig.conf>=85?C.gold2:sig.conf>=70?C.gold:C.orange,lineHeight:1,textShadow:sig.conf>=85?`0 0 12px rgba(201,168,76,.4)`:"none"}}>{sig.conf}</div>
          <button data-testid={`share-signal-${sig.id}`} onClick={()=>shareSignal(sig)}
            style={{background:"none",border:`1px solid ${C.border}`,borderRadius:2,color:C.muted2,cursor:"pointer",fontFamily:MONO,fontSize:8,padding:"2px 7px",letterSpacing:"0.1em"}}>share</button>
        </div>
      </div>
    </div>
  );

  const hlLive=hlStatus==="live",fhLive=fhStatus==="live";
  const allSignals=[...liveSignals,...signals].sort((a,b)=>(b.ts||0)-(a.ts||0));
  const filtSigs=allSignals.filter(s=>{
    if(sigSubTab==="all")return true;
    if(sigSubTab==="watch")return watchlist.includes(s.token);
    if(sigSubTab==="crypto")return s.src==="hyperliquid"||s.src==="alpha-detect";
    if(sigSubTab==="equity")return s.src==="trade.xyz";
    if(sigSubTab==="metals")return["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"].includes(s.token);
    if(sigSubTab==="forex")return FOREX_SYMS.includes(s.token);
    return true;
  });

  // ── Macro event helpers ──────────────────────────────
  const today=new Date();
  const eventStatus=(dateStr)=>{
    const d=new Date(dateStr);
    const diff=Math.floor((d-today)/(1000*60*60*24));
    if(diff<0)return{label:"PAST",color:"muted"};
    if(diff===0)return{label:"TODAY",color:"red"};
    if(diff===1)return{label:"TMRW",color:"orange"};
    if(diff<=7)return{label:`${diff}d`,color:"gold"};
    return{label:`${diff}d`,color:"muted"};
  };
  const bankColor={FED:C.blue,ECB:C.purple,BOJ:C.teal,BOC:C.gold,BOE:C.green,RBA:C.cyan,"US CPI":C.orange,CPI:C.orange,GDP:C.blue,PMI:C.teal,USD:C.blue,EUR:C.purple,GBP:C.green,JPY:C.teal,CAD:C.gold,AUD:C.cyan,CHF:C.muted2,NZD:C.green,NFP:C.red,PCE:C.orange};
  const filteredMacro=macroFilter==="ALL"?macroEvents:macroEvents.filter(e=>e.bank===macroFilter||e.bank.startsWith(macroFilter));
  const sortedMacro=[...filteredMacro].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const upcomingCount=macroEvents.length;

  const NAV=[
    {k:"prices",icon:"💹",label:"Markets"},
    {k:"macro",icon:"🏦",label:"Macro"},
    {k:"brief",icon:"📰",label:"Brief"},
    {k:"signals",icon:"⚡",label:"Signals"},
    {k:"alerts",icon:"🔔",label:"Alerts"},
    {k:"ai",icon:"✦",label:"AI"},
  ];

  return(
    <div style={{fontFamily:SANS,background:C.bg,color:C.text,minHeight:"100vh",paddingBottom:76,maxWidth:640,margin:"0 auto",position:"relative"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Barlow:wght@300;400;500;600;700&display=swap');
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        select,input,textarea{outline:none;}
        ::-webkit-scrollbar{display:none;}
        button{cursor:pointer;}
        body{background:#050709;margin:0;}
        body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(20,30,53,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(20,30,53,.35) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0;}
        body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 40% at 50% 0%,rgba(201,168,76,.05) 0%,transparent 60%);pointer-events:none;z-index:0;}
        @keyframes slideUp{from{transform:translateX(-50%) translateY(16px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
      `}</style>

      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}

      {/* ── HEADER ── */}
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:"rgba(5,7,9,.96)",zIndex:50,backdropFilter:"blur(14px)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.gold2,letterSpacing:"0.04em",lineHeight:1,textShadow:"0 0 24px rgba(201,168,76,.25)"}}>CLVRQuant</div>
            <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.25em",marginTop:2}}>TRADE SMARTER WITH AI · v1</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",marginBottom:3}}>
              <LiveDot live={hlLive}/><span style={{fontFamily:MONO,fontSize:7,color:hlLive?C.green:C.orange}}>HL</span>
              <LiveDot live={fhLive}/><span style={{fontFamily:MONO,fontSize:7,color:fhLive?C.green:C.gold}}>FH</span>
            </div>
            <div style={{fontFamily:MONO,fontSize:7,color:C.muted}}>{lastUpdate.toLocaleTimeString()}</div>
          </div>
        </div>
        {/* Ticker chips */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
          {["BTC","ETH","SOL","XAU","XAG","EURUSD","TSLA","NVDA"].map(sym=>{
            const d=allPrices[sym],flash=flashes[sym];const isUp=Number(d?.chg)>=0;
            return(
              <div key={sym} data-testid={`ticker-${sym}`} onClick={()=>{setAiInput(`${sym} — long or short right now?`);setTab("ai");}}
                style={{background:flash==="green"?"rgba(0,199,135,.08)":flash==="red"?"rgba(255,64,96,.06)":C.panel,
                  border:`1px solid ${d?.live?"rgba(201,168,76,.18)":C.border}`,borderRadius:2,padding:"5px 9px",flexShrink:0,cursor:"pointer",minWidth:64,transition:"background .35s"}}>
                <div style={{fontFamily:MONO,fontSize:7,color:d?.live?C.gold:C.muted,letterSpacing:"0.08em"}}>{sym}</div>
                <div style={{fontFamily:MONO,fontSize:10,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .35s",marginTop:1}}>{fmt(d?.price,sym)}</div>
                <div style={{fontFamily:MONO,fontSize:8,color:isUp?C.green:C.red}}>{pct(d?.chg)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{padding:"10px 12px",position:"relative",zIndex:1}}>

        {/* ══ PRICES ══ */}
        {tab==="prices"&&<>
          <div style={{marginBottom:14}}><SLabel>Market Data</SLabel></div>
          <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto"}}>
            {[{k:"crypto",l:"Crypto"},{k:"equity",l:"Equities",col:"blue"},{k:"metals",l:"Commodities"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
              <SubBtn key={t.k} k={t.k} label={t.l} col={t.col||"gold"} state={priceTab} setter={setPriceTab}/>
            ))}
          </div>
          {priceTab==="crypto"&&<div style={panel}>
            <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`}}>
              {[{k:"spot",l:"Spot · Binance"},{k:"perp",l:"Perp · Hyperliquid"}].map(t=>(
                <button key={t.k} data-testid={`crypto-tab-${t.k}`} onClick={()=>setCryptoSubTab(t.k)} style={{flex:1,padding:"9px 0",background:cryptoSubTab===t.k?"rgba(201,168,76,.06)":"transparent",border:"none",borderBottom:cryptoSubTab===t.k?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.1em",color:cryptoSubTab===t.k?C.gold:C.muted2,transition:"all .2s"}}>{t.l}</button>
              ))}
            </div>
            {cryptoSubTab==="spot"&&<>
              <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em"}}>binance.us spot · last traded price · 2s</div>
              {CRYPTO_SYMS.map(sym=>{const d=cryptoPrices[sym];return <PriceRow key={sym} sym={sym} d={d}/>;})}
            </>}
            {cryptoSubTab==="perp"&&<>
              <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em"}}>hyperliquid.xyz · perp mid-price · 5s</div>
              {CRYPTO_SYMS.map(sym=>{const d=perpPrices[sym];const extraParts=[d?.funding?`Fund: ${pct(d.funding,4)}/8h`:"",d?.oi?`OI: $${(d.oi/1e6).toFixed(0)}M`:""].filter(Boolean).join(" · ");return(<div key={sym}><PriceRow sym={sym} d={d} extra={d?.live&&extraParts?extraParts:null}/></div>);})}
            </>}
          </div>}
          {priceTab==="equity"&&<div style={panel}>
            <div style={ph}><PTitle>Equities · Finnhub</PTitle><Badge label={fhLive?`${Object.values(equityPrices).filter(p=>p.live).length} Live`:"Closed"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>finnhub.io · NYSE/NASDAQ 9:30am–4pm ET</div>
            {EQUITY_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={equityPrices[sym]}/>)}
          </div>}
          {priceTab==="metals"&&<div style={panel}>
            <div style={ph}><PTitle>Commodities</PTitle><Badge label={fhLive?`${Object.values(metalPrices).filter(p=>p.live).length} Live`:"Closed"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>gold-api.com · metals · energy · 2min</div>
            {METALS_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={metalPrices[sym]} label={METAL_LABELS[sym]}/>)}
            <div style={{padding:"10px 14px",fontFamily:MONO,fontSize:9,color:C.muted2}}>Gold/Silver Ratio: <span style={{color:C.gold2,fontWeight:600}}>{metalPrices.XAU?.price&&metalPrices.XAG?.price?(metalPrices.XAU.price/metalPrices.XAG.price).toFixed(0):"—"}:1</span>{metalPrices.XAU?.price&&metalPrices.XAG?.price&&(metalPrices.XAU.price/metalPrices.XAG.price)>=90&&<span style={{color:C.green}}> · bullish for silver</span>}</div>
          </div>}
          {priceTab==="forex"&&<div style={panel}>
            <div style={ph}><PTitle>Forex</PTitle><Badge label={fhLive?`${Object.values(forexPrices).filter(p=>p.live).length} Live`:"Closed"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>exchangerate-api · 24/5 · closed weekends</div>
            {FOREX_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={forexPrices[sym]} label={FOREX_LABELS[sym]}/>)}
          </div>}
        </>}

        {/* ══ MACRO ══ */}
        {tab==="macro"&&<>
          <div style={{marginBottom:14}}><SLabel>Central Bank Calendar</SLabel></div>
          {macroLoading&&<div style={{padding:20,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>Loading calendar...</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[
              {label:"Next 14d",val:macroEvents.length,col:C.cyan},
              {label:"HIGH Impact",val:macroEvents.filter(e=>e.impact==="HIGH").length,col:C.orange},
              {label:"Live Feed",val:macroEvents.filter(e=>e.live).length||"—",col:C.green},
            ].map(s=>(
              <div key={s.label} style={{...panel,marginBottom:0,padding:"12px",textAlign:"center",border:`1px solid ${C.border2}`}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.15em",marginBottom:5}}>{s.label}</div>
                <div style={{fontFamily:SERIF,fontWeight:900,fontSize:26,color:s.col,lineHeight:1}}>{s.val}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto"}}>
            {["ALL","FED","ECB","BOJ","BOC","BOE","RBA","CPI"].map(b=>(
              <SubBtn key={b} k={b} label={b} col={b==="ALL"?"gold":b==="FED"?"blue":b==="ECB"?"purple":b==="BOJ"?"teal":b==="BOC"?"gold":b==="BOE"?"green":b==="RBA"?"cyan":"orange"} state={macroFilter} setter={setMacroFilter}/>
            ))}
          </div>
          <div style={panel}>
            <div style={ph}>
              <PTitle>Today & Upcoming</PTitle>
              <div style={{display:"flex",gap:5}}><Badge label={`${sortedMacro.length} events`} color="gold"/><Badge label="AUTO-REFRESH" color="green" style={{fontSize:7}}/></div>
            </div>
            {sortedMacro.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>No events scheduled.</div>}
            {sortedMacro.map(evt=>{
              const status=eventStatus(evt.date);const isToday=status.label==="TODAY";const bc=bankColor[evt.bank]||C.gold;
              return(
                <div key={evt.id} style={{padding:"13px 14px",borderBottom:`1px solid ${C.border}`,background:isToday?"rgba(255,64,96,.03)":"transparent"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:8}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:5}}>
                        <span style={{fontSize:13}}>{evt.flag}</span>
                        <span style={{fontFamily:MONO,fontWeight:600,fontSize:10,color:bc,letterSpacing:"0.1em"}}>{evt.bank}</span>
                        <Badge label={evt.impact} color={evt.impact==="HIGH"?"red":evt.impact==="MED"?"orange":"teal"}/>
                        {isToday&&<Badge label="TODAY" color="red" style={{animation:"pulse 1.4s ease infinite"}}/>}
                        {status.label!=="PAST"&&status.label!=="TODAY"&&<Badge label={status.label} color={status.color}/>}
                        {evt.live&&<Badge label="LIVE" color="green" style={{fontSize:7}}/>}
                      </div>
                      <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white,marginBottom:3}}>{evt.name}</div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{evt.date} · {evt.time}</div>
                    </div>
                    <div style={{flexShrink:0,textAlign:"right",minWidth:72}}>
                      {evt.current&&evt.current!=="—"&&<><div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:2}}>Current</div><div style={{fontFamily:MONO,fontSize:10,color:C.text}}>{evt.current}</div></>}
                      {evt.forecast&&evt.forecast!=="—"&&<div style={{marginTop:5}}><Badge label={evt.forecast} color={evt.forecast.includes("–")||evt.forecast.includes("-")?"red":evt.forecast==="Hold"?"green":"gold"}/></div>}
                    </div>
                  </div>
                  <div style={{fontSize:10,color:C.muted2,lineHeight:1.7,padding:"8px 10px",background:"rgba(0,0,0,.18)",borderRadius:2,borderLeft:`2px solid ${bc}33`}}>{evt.desc}</div>
                  <div style={{display:"flex",gap:6,marginTop:8}}>
                    <button onClick={()=>{setAiInput(`${evt.bank} ${evt.name} on ${evt.date}: forecast ${evt.forecast}. How to position? Which assets most affected?`);setTab("ai");}}
                      style={{background:"none",border:`1px solid ${C.border}`,color:C.muted2,borderRadius:2,padding:"3px 9px",fontFamily:MONO,fontSize:7,letterSpacing:"0.12em",cursor:"pointer"}}>Ask AI ✦</button>
                    <button onClick={()=>{const cal=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${evt.bank} - ${evt.name}\nDTSTART:${evt.date.replace(/-/g,"")}\nDTEND:${evt.date.replace(/-/g,"")}\nDESCRIPTION:${evt.desc}\nEND:VEVENT\nEND:VCALENDAR`;const blob=new Blob([cal],{type:"text/calendar"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${evt.bank}-${evt.date}.ics`;a.click();setToast("Calendar event saved ✦");}}
                      style={{background:"none",border:`1px solid ${C.border}`,color:C.muted2,borderRadius:2,padding:"3px 9px",fontFamily:MONO,fontSize:7,letterSpacing:"0.12em",cursor:"pointer"}}>Add to Cal</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>}

        {/* ══ BRIEF ══ */}
        {tab==="brief"&&<>
          <div style={{marginBottom:14}}><SLabel>Morning Market Brief</SLabel></div>
          <div style={panel}>
            <div style={ph}><PTitle>Daily Intelligence Brief</PTitle><Badge label="AI · Live Prices" color="gold"/></div>
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:C.muted2,lineHeight:1.8,marginBottom:14,fontStyle:"italic"}}>Same analysis as the 6AM email — generated live with current prices.</div>
              <button data-testid="button-generate-brief" onClick={generateBrief} disabled={briefLoading} style={{width:"100%",height:44,background:"rgba(201,168,76,.1)",color:briefLoading?C.muted:C.gold2,border:`1px solid ${briefLoading?"rgba(201,168,76,.15)":"rgba(201,168,76,.35)"}`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:briefLoading?"not-allowed":"pointer",letterSpacing:"0.04em"}}>
                {briefLoading?"Generating...":"Generate Today's Brief →"}
              </button>
            </div>
          </div>

          {briefData&&<>
            <div style={{background:"linear-gradient(135deg,#080d18,#0f1a2e)",borderRadius:2,border:`1px solid ${C.border2}`,padding:"22px 18px",marginBottom:10,textAlign:"center",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
              <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.28em",marginBottom:5}}>CLVRQuant · MORNING BRIEF</div>
              <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.white,fontStyle:"italic",marginBottom:4}}>Market Summary</div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{briefDate}</div>
              <div style={{marginTop:10}}>
                <span style={{padding:"4px 14px",borderRadius:2,fontFamily:MONO,fontSize:8,letterSpacing:"0.15em",
                  background:briefData.bias==="RISK ON"?"rgba(0,199,135,.1)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.1)":"rgba(201,168,76,.1)",
                  color:briefData.bias==="RISK ON"?C.green:briefData.bias==="RISK OFF"?C.red:C.gold,
                  border:`1px solid ${briefData.bias==="RISK ON"?"rgba(0,199,135,.3)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.3)":"rgba(201,168,76,.3)"}`}}>
                  {briefData.bias}
                </span>
              </div>
              <div style={{marginTop:12,fontFamily:SERIF,fontSize:13,color:C.text,fontStyle:"italic",lineHeight:1.6}}>"{briefData.headline}"</div>
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Live Prices</PTitle></div>
              {[{sym:"BTC",label:"BTC/USD",prices:cryptoPrices},{sym:"ETH",label:"ETH/USD",prices:cryptoPrices},{sym:"SOL",label:"SOL/USD",prices:cryptoPrices},{sym:"EURUSD",label:"EUR/USD",prices:forexPrices},{sym:"USDJPY",label:"USD/JPY",prices:forexPrices},{sym:"USDCAD",label:"USD/CAD",prices:forexPrices},{sym:"XAU",label:"Gold XAU",prices:metalPrices},{sym:"XAG",label:"Silver XAG",prices:metalPrices}].map(({sym,label,prices})=>{
                const d=prices[sym];const chg=d?.chg||0;
                return(<div key={sym} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,alignItems:"center",padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:C.muted2,letterSpacing:"0.06em"}}>{label}</div>
                  <div style={{fontFamily:MONO,fontSize:11,color:C.white}}>{fmt(d?.price,sym)}</div>
                  <div style={{fontFamily:MONO,fontSize:10,fontWeight:600,color:chg>=0?C.green:C.red}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)}%</div>
                </div>);
              })}
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Analysis & Outlook</PTitle></div>
              {[{icon:"₿",label:"Bitcoin",key:"btc",col:C.gold},{icon:"Ξ",label:"Ethereum",key:"eth",col:C.purple},{icon:"◎",label:"Solana",key:"sol",col:C.cyan},{icon:"▣",label:"Gold XAU",key:"xau",col:C.gold2},{icon:"◈",label:"Silver XAG",key:"xag",col:C.muted2},{icon:"€",label:"EUR/USD",key:"eurusd",col:C.blue},{icon:"¥",label:"USD/JPY",key:"usdjpy",col:C.teal},{icon:"$",label:"USD/CAD",key:"usdcad",col:C.green}].filter(s=>briefData[s.key]).map(s=>(
                <div key={s.key} style={{padding:"13px 14px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:s.col,marginBottom:5,fontStyle:"italic"}}>{s.icon} {s.label}</div>
                  <div style={{fontSize:11,color:C.text,lineHeight:1.8}}>{briefData[s.key]}</div>
                </div>
              ))}
            </div>
            {briefData.watchToday&&<div style={{...panel,border:`1px solid ${C.border2}`}}>
              <div style={{...ph,background:"rgba(201,168,76,.04)"}}><PTitle>What to Watch Today</PTitle></div>
              {briefData.watchToday.map((item,i)=>(
                <div key={i} style={{padding:"9px 14px",borderBottom:i<briefData.watchToday.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:12,color:C.gold,flexShrink:0}}>{i+1}.</span>
                  <div style={{fontSize:10,color:C.text,lineHeight:1.7}}>{item}</div>
                </div>
              ))}
            </div>}
            {briefData.keyRisk&&<div style={{...panel,border:`1px solid rgba(255,64,96,.2)`}}>
              <div style={{padding:"12px 14px",background:"rgba(255,64,96,.04)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontFamily:MONO,fontSize:9,color:C.red,letterSpacing:"0.15em",fontWeight:600,flexShrink:0,marginTop:2}}>RISK</span>
                <div style={{fontSize:11,color:C.text,lineHeight:1.7}}>{briefData.keyRisk}</div>
              </div>
            </div>}
            <div style={panel}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:36,height:36,border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:SERIF,fontWeight:900,fontSize:14,color:C.gold}}>MC</span>
                </div>
                <div>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white}}>Mike Claver</div>
                  <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:2}}>Morning Market Commentary · CLVRQuant</div>
                </div>
              </div>
              <div style={{padding:"9px 14px",fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",letterSpacing:"0.12em"}}>⚠ INFORMATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE</div>
            </div>
          </>}

          {/* Subscribe */}
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={{...ph,background:"rgba(201,168,76,.04)",borderBottom:`1px solid rgba(201,168,76,.12)`}}>
              <PTitle>Subscribe to Daily Brief</PTitle>
              <Badge label="6:00 AM daily" color="gold"/>
            </div>
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:C.muted2,lineHeight:1.8,marginBottom:14,fontStyle:"italic"}}>Receive this brief in your inbox every weekday at 6:00 AM.</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <input data-testid="input-sub-name" value={subName} onChange={e=>setSubName(e.target.value)} placeholder="Your name (optional)" style={{background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px",color:C.text,fontFamily:SANS,fontSize:11}}/>
                <input data-testid="input-sub-email" value={subEmail} onChange={e=>setSubEmail(e.target.value)} placeholder="your@email.com" type="email" style={{background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px",color:C.text,fontFamily:SANS,fontSize:11}}/>
                <button data-testid="button-subscribe" onClick={handleSubscribe} disabled={subLoading} style={{height:42,background:"rgba(201,168,76,.1)",color:subLoading?C.muted:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,cursor:subLoading?"not-allowed":"pointer"}}>
                  {subLoading?"Subscribing...":"Subscribe →"}
                </button>
              </div>
              {subList.length>0&&<div style={{marginTop:12,padding:"10px 12px",background:"rgba(0,0,0,.2)",borderRadius:2}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.18em",marginBottom:7}}>SUBSCRIBED ({subList.length})</div>
                {subList.map(e=><div key={e} style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}><span style={{color:C.gold,fontSize:8,fontFamily:MONO}}>✦</span><span style={{fontFamily:MONO,fontSize:10,color:C.text}}>{e}</span></div>)}
              </div>}
            </div>
          </div>
        </>}

        {/* ══ SIGNALS ══ */}
        {tab==="signals"&&<>
          <div style={{marginBottom:14}}><SLabel>Quant AI Signals</SLabel></div>
          <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto"}}>
            {[{k:"all",l:"All"},{k:"watch",l:"✦ Watch"},{k:"crypto",l:"Crypto",col:"green"},{k:"equity",l:"Equities",col:"blue"},{k:"metals",l:"Metals"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
              <SubBtn key={t.k} k={t.k} label={t.l} col={t.col||"gold"} state={sigSubTab} setter={setSigSubTab}/>
            ))}
          </div>
          <div style={panel}>
            <div style={ph}><PTitle>Alpha Signals</PTitle><div style={{display:"flex",gap:6}}><Badge label={`${liveSignals.length} live`} color="green"/><Badge label={`${sigCount} total`} color="gold"/></div></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em"}}>tracking {sigTracking} tokens · 1.5% move threshold · 5min window</div>
            {filtSigs.length===0?<div style={{padding:24,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>No signals for this filter.</div>:filtSigs.map(sig=><SignalRow key={sig.id} sig={sig}/>)}
          </div>
        </>}

        {/* ══ ALERTS ══ */}
        {tab==="alerts"&&<>
          <div style={{marginBottom:14}}><SLabel>Price Alerts</SLabel></div>
          <div style={panel}>
            <div style={ph}>
              <PTitle>Active Alerts</PTitle>
              <Badge label={`${alerts.filter(a=>!a.triggered).length} active`} color="green"/>
            </div>
            <div style={{padding:14}}>
              <div style={{fontSize:10,color:C.muted2,lineHeight:1.7,marginBottom:12,fontStyle:"italic"}}>Set alerts on price or funding. You'll get a browser notification and toast when triggered.</div>
              {typeof Notification!=="undefined"&&Notification.permission==="default"&&(
                <button data-testid="button-enable-notifications" onClick={()=>Notification.requestPermission()} style={{width:"100%",marginBottom:10,padding:"8px 12px",background:"rgba(59,130,246,.07)",border:`1px solid rgba(59,130,246,.25)`,borderRadius:2,color:C.blue,fontFamily:MONO,fontSize:8,letterSpacing:"0.12em",cursor:"pointer"}}>
                  Enable browser notifications
                </button>
              )}
              <button data-testid="button-new-alert" onClick={()=>setShowAlertForm(f=>!f)} style={{width:"100%",height:40,background:showAlertForm?"rgba(255,64,96,.08)":"rgba(201,168,76,.1)",color:showAlertForm?C.red:C.gold2,border:`1px solid ${showAlertForm?"rgba(255,64,96,.25)":"rgba(201,168,76,.3)"}`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:10}}>
                {showAlertForm?"Cancel":"+ New Alert"}
              </button>
              {showAlertForm&&(
                <div style={{background:"rgba(0,0,0,.2)",borderRadius:2,padding:12,marginBottom:12,border:`1px solid ${C.border}`}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:4,letterSpacing:"0.15em"}}>SYMBOL</div>
                      <select data-testid="select-alert-sym" value={alertForm.sym} onChange={e=>setAlertForm(f=>({...f,sym:e.target.value}))}
                        style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 8px",color:C.text,fontFamily:MONO,fontSize:10}}>
                        {ALL_SYMS.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:4,letterSpacing:"0.15em"}}>FIELD</div>
                      <select data-testid="select-alert-field" value={alertForm.field} onChange={e=>setAlertForm(f=>({...f,field:e.target.value}))}
                        style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 8px",color:C.text,fontFamily:MONO,fontSize:10}}>
                        <option value="price">Price</option>
                        <option value="funding">Funding %</option>
                      </select>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:4,letterSpacing:"0.15em"}}>CONDITION</div>
                      <select data-testid="select-alert-condition" value={alertForm.condition} onChange={e=>setAlertForm(f=>({...f,condition:e.target.value}))}
                        style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 8px",color:C.text,fontFamily:MONO,fontSize:10}}>
                        <option value="above">Above</option>
                        <option value="below">Below</option>
                      </select>
                    </div>
                    <div>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:4,letterSpacing:"0.15em"}}>THRESHOLD</div>
                      <input data-testid="input-alert-threshold" type="number" value={alertForm.threshold} onChange={e=>setAlertForm(f=>({...f,threshold:e.target.value}))} placeholder="e.g. 90000"
                        style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 8px",color:C.text,fontFamily:MONO,fontSize:10}}/>
                    </div>
                  </div>
                  <button data-testid="button-create-alert" onClick={()=>{
                    const t=Number(alertForm.threshold);
                    if(!t){setToast("Enter a threshold value");return;}
                    const label=`${alertForm.sym} ${alertForm.field} ${alertForm.condition} ${alertForm.field==="price"?fmt(t,alertForm.sym):t+"%"}`;
                    setAlerts(prev=>[...prev,{id:idRef.current++,sym:alertForm.sym,field:alertForm.field,condition:alertForm.condition,threshold:t,triggered:false,label}]);
                    setAlertForm({sym:"BTC",field:"price",condition:"above",threshold:""});
                    setShowAlertForm(false);
                    setToast(`Alert created: ${label} ✦`);
                  }} style={{width:"100%",height:38,background:"rgba(201,168,76,.1)",color:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    Create Alert
                  </button>
                </div>
              )}
            </div>
            {alerts.length===0?<div style={{padding:24,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>No alerts set.</div>:
              alerts.map(a=>(
                <div key={a.id} style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",opacity:a.triggered?.5:1}}>
                  <div>
                    <div style={{fontFamily:MONO,fontWeight:600,fontSize:11,color:a.triggered?C.muted:C.text,display:"flex",alignItems:"center",gap:6,letterSpacing:"0.05em"}}>
                      <span>{a.sym}</span>
                      <Badge label={a.field} color={a.field==="funding"?"orange":"blue"}/>
                      <Badge label={a.condition} color={a.condition==="above"?"green":"red"}/>
                      {a.triggered&&<Badge label="TRIGGERED" color="red"/>}
                    </div>
                    <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>{a.label}</div>
                  </div>
                  <button data-testid={`button-delete-alert-${a.id}`} onClick={()=>setAlerts(prev=>prev.filter(x=>x.id!==a.id))}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:2,color:C.muted2,cursor:"pointer",fontFamily:MONO,fontSize:9,padding:"3px 8px"}}>✕</button>
                </div>
              ))
            }
          </div>
        </>}

        {/* ══ AI ══ */}
        {tab==="ai"&&<>
          <div style={{marginBottom:14}}><SLabel>AI Market Analyst</SLabel></div>
          <div style={panel}>
            <div style={ph}><PTitle>CLVRQuant AI</PTitle><Badge label="Claude · Live" color="gold"/></div>
            <div style={{padding:16}}>
              <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
                {["BTC","ETH","SOL","XAU","EURUSD","TSLA","NVDA"].map(sym=>{const d=allPrices[sym];return<button key={sym} data-testid={`ai-chip-${sym}`} onClick={()=>setAiInput(`${sym} — long or short? Price:${fmt(d?.price,sym)} 24h:${pct(d?.chg)}`)}
                  style={{padding:"4px 10px",borderRadius:2,border:`1px solid ${d?.live?"rgba(201,168,76,.28)":C.border}`,background:C.panel,color:d?.live?C.gold2:C.muted2,fontFamily:MONO,fontSize:8,letterSpacing:"0.08em",cursor:"pointer"}}>
                  {sym}{d?.live?" ✦":""}
                </button>;})}
              </div>
              <textarea data-testid="input-ai-query" value={aiInput} onChange={e=>setAiInput(e.target.value)} placeholder={`"Long BTC now?" · "Is XAU overextended?" · "Best forex trade?"`}
                style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:12,color:C.text,fontFamily:SANS,fontSize:11,resize:"none",height:72,lineHeight:1.7}}/>
              <button data-testid="button-ai-analyze" onClick={runAI} disabled={aiLoading} style={{width:"100%",height:44,marginTop:8,background:"rgba(201,168,76,.1)",color:aiLoading?C.muted:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:aiLoading?"not-allowed":"pointer"}}>
                {aiLoading?"Analyzing...":"Analyze →"}
              </button>
              {aiOutput&&<div data-testid="text-ai-output" style={{marginTop:12,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:14,fontSize:11,lineHeight:1.9,color:C.text,whiteSpace:"pre-wrap",maxHeight:320,overflowY:"auto"}}>{aiOutput}</div>}
            </div>
          </div>
          <div style={{...panel,border:`1px solid rgba(255,140,0,.12)`}}>
            <div style={{padding:"11px 14px",background:"rgba(255,140,0,.03)"}}>
              <div style={{fontFamily:MONO,fontSize:7,color:C.orange,letterSpacing:"0.22em",marginBottom:5}}>⚠ LEGAL DISCLAIMER</div>
              <div style={{fontSize:9,color:C.muted,lineHeight:1.9}}>CLVRQuant is an AI-powered research and analytics platform for <strong style={{color:C.muted2}}>informational and educational purposes only</strong>. Nothing constitutes financial advice, investment advice, or trading advice. AI signals are not recommendations. All trading involves significant risk of loss. Past performance does not predict future results. © 2025 CLVRQuant · Mike Claver. All rights reserved. CLVRQuant™ is a trademark of Mike Claver.</div>
            </div>
          </div>
        </>}

        <div style={{textAlign:"center",fontFamily:MONO,fontSize:7,color:C.muted,marginTop:6,letterSpacing:"0.12em"}}>
          BINANCE · FINNHUB · NOT FINANCIAL ADVICE · © 2025 CLVRQUANT · MIKE CLAVER
        </div>
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"rgba(5,7,9,.97)",borderTop:`1px solid ${C.border}`,backdropFilter:"blur(14px)",display:"flex",paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        {NAV.map(item=>{
          const active=tab===item.k;const macroAlert=item.k==="macro"&&upcomingCount>0;
          return(
            <button key={item.k} data-testid={`nav-${item.k}`} onClick={()=>setTab(item.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px 2px 10px",background:"none",border:"none",borderTop:`2px solid ${active?C.gold:"transparent"}`,position:"relative",transition:"border-color .2s"}}>
              <span style={{fontSize:item.k==="ai"?16:18,lineHeight:1,fontFamily:item.k==="ai"?SERIF:"inherit",fontWeight:item.k==="ai"?900:"inherit",color:active?C.gold:C.muted2}}>{item.icon}</span>
              {macroAlert&&!active&&<div style={{position:"absolute",top:5,right:"calc(50% - 14px)",width:6,height:6,borderRadius:"50%",background:C.red}}/>}
              <span style={{fontFamily:MONO,fontSize:7,marginTop:4,color:active?C.gold:C.muted,letterSpacing:"0.15em",fontWeight:active?600:400,textTransform:"uppercase"}}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
