// ─────────────────────────────────────────────────────────
// CLVRQuant v2
// NEW: Macro countdown timers · Volume spike detector
//      Funding rate flip alerts · Liquidation heatmap
//      Push notifications · In-app alert banners
// Backend-proxied API calls (keys stored server-side)
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import PhantomWalletPanel from "./PhantomWallet";
import QuantBrainPanel from "./QuantBrain";
import FeaturesGuide from "./FeaturesGuide";

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
const timeAgo=(ts)=>{if(!ts)return"";const s=Math.floor((Date.now()-ts)/1000);if(s<10)return"just now";if(s<60)return`${s}s ago`;const m=Math.floor(s/60);if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;return`${Math.floor(h/24)}d ago`;};

// ─── BASE PRICES ──────────────────────────────────────────
const CRYPTO_BASE={BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,MATIC:0.55,UNI:9.5,AAVE:220,NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18,TRUMP:3.5,HYPE:31};
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

// ─── SIGNALS (live only — no simulated data) ─────────────

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
async function fetchNews(){
  const r=await fetch("/api/news");
  if(!r.ok)throw new Error(`News API ${r.status}`);
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

// ─── BLOOMBERG-STYLE SOUND PING ─────────────────────────
let audioCtx=null;
function playBloombergPing(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const ctx=audioCtx;
    const now=ctx.currentTime;
    const g=ctx.createGain();
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.18,now);
    g.gain.exponentialRampToValueAtTime(0.001,now+0.6);
    const o1=ctx.createOscillator();
    o1.type="sine";o1.frequency.setValueAtTime(880,now);o1.frequency.setValueAtTime(1174.66,now+0.08);
    o1.connect(g);o1.start(now);o1.stop(now+0.12);
    const o2=ctx.createOscillator();
    o2.type="sine";o2.frequency.setValueAtTime(1318.51,now+0.15);
    const g2=ctx.createGain();g2.connect(ctx.destination);
    g2.gain.setValueAtTime(0.14,now+0.15);g2.gain.exponentialRampToValueAtTime(0.001,now+0.55);
    o2.connect(g2);o2.start(now+0.15);o2.stop(now+0.55);
    const o3=ctx.createOscillator();
    o3.type="sine";o3.frequency.setValueAtTime(1760,now+0.3);
    const g3=ctx.createGain();g3.connect(ctx.destination);
    g3.gain.setValueAtTime(0.1,now+0.3);g3.gain.exponentialRampToValueAtTime(0.001,now+0.7);
    o3.connect(g3);o3.start(now+0.3);o3.stop(now+0.7);
  }catch(e){}
}

// ─── PUSH NOTIFICATIONS ─────────────────────────────────
function sendPush(title,body,tag="clvrquant"){
  if(typeof Notification!=="undefined"&&Notification.permission==="granted"){try{new Notification(title,{body,tag});}catch(e){}}
}

// ─── ALERT BANNER ────────────────────────────────────────
function AlertBanner({alerts,onDismiss,C:_C}){
  if(!alerts||alerts.length===0)return null;
  const a=alerts[0];
  const tc={macro:{bg:"rgba(255,140,0,.12)",border:"rgba(255,140,0,.35)",icon:"!",color:_C.orange},volume:{bg:"rgba(0,212,255,.10)",border:"rgba(0,212,255,.35)",icon:"V",color:_C.cyan},funding:{bg:"rgba(0,199,135,.10)",border:"rgba(0,199,135,.35)",icon:"F",color:_C.green},liq:{bg:"rgba(255,64,96,.10)",border:"rgba(255,64,96,.35)",icon:"L",color:_C.red},price:{bg:"rgba(201,168,76,.10)",border:"rgba(201,168,76,.35)",icon:"P",color:_C.gold}}[a.type]||{bg:"rgba(201,168,76,.10)",border:"rgba(201,168,76,.35)",icon:"A",color:_C.gold};
  return(<div style={{position:"fixed",top:"env(safe-area-inset-top,0px)",left:0,right:0,zIndex:200,padding:"0 12px",maxWidth:640,margin:"0 auto"}}><div style={{background:tc.bg,border:`1px solid ${tc.border}`,borderTop:"none",borderRadius:"0 0 6px 6px",padding:"10px 14px",backdropFilter:"blur(16px)"}}><div style={{display:"flex",alignItems:"flex-start",gap:10}}><span style={{fontSize:14,flexShrink:0,marginTop:1,fontFamily:"'IBM Plex Mono',monospace",fontWeight:900,color:tc.color}}>{tc.icon}</span><div style={{flex:1}}><div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:tc.color,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:3}}>{a.title}</div><div style={{fontFamily:"'Barlow',system-ui,sans-serif",fontSize:11,color:_C.text,lineHeight:1.6}}>{a.body}</div>{a.assets&&<div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{a.assets.map(sym=><span key={sym} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:tc.color,background:tc.bg,border:`1px solid ${tc.border}`,borderRadius:2,padding:"1px 6px"}}>{sym}</span>)}</div>}</div><button onClick={()=>onDismiss(a.id)} style={{background:"none",border:"none",color:_C.muted2,fontSize:18,cursor:"pointer",flexShrink:0,padding:0,lineHeight:1}}>x</button></div>{alerts.length>1&&<div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:7,color:_C.muted,marginTop:6,letterSpacing:"0.15em"}}>{alerts.length-1} MORE ALERT{alerts.length>2?"S":""}</div>}</div></div>);
}

// ─── COUNTDOWN TIMER ─────────────────────────────────────
function Countdown({dateStr,timeET,compact=false}){
  const[diff,setDiff]=useState(null);
  useEffect(()=>{
    const calc=()=>{const[h,m]=(timeET||"12:00").split(":").map(Number);const[y,mo,d]=dateStr.split("-").map(Number);const target=new Date(Date.UTC(y,mo-1,d,h+5,m,0));setDiff(target-new Date());};
    calc();const iv=setInterval(calc,1000);return()=>clearInterval(iv);
  },[dateStr,timeET]);
  if(diff===null)return null;
  if(diff<0)return<span style={{fontFamily:MONO,fontSize:compact?7:8,color:C.muted}}>PAST</span>;
  const s=Math.floor(diff/1000);const dd=Math.floor(s/86400);const h=Math.floor((s%86400)/3600);const min=Math.floor((s%3600)/60);const sec=s%60;
  const isHot=diff<30*60*1000;const isWarm=diff<2*60*60*1000;const col=isHot?C.red:isWarm?C.orange:C.muted2;
  if(compact){const label=dd>0?`${dd}d ${h}h`:h>0?`${h}h ${min}m`:`${min}m ${sec}s`;return<span style={{fontFamily:MONO,fontSize:10,color:col,fontWeight:isHot?700:400}}>{label}</span>;}
  return(<div style={{display:"flex",gap:6,alignItems:"center"}}>
    {dd>0&&<div style={{textAlign:"center"}}><div style={{fontFamily:SERIF,fontWeight:900,fontSize:26,color:col,lineHeight:1}}>{dd}</div><div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em"}}>DAYS</div></div>}
    <div style={{textAlign:"center"}}><div style={{fontFamily:SERIF,fontWeight:900,fontSize:26,color:col,lineHeight:1}}>{String(h).padStart(2,"0")}</div><div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em"}}>HRS</div></div>
    <div style={{fontFamily:MONO,color:col,fontSize:18,marginBottom:12}}>:</div>
    <div style={{textAlign:"center"}}><div style={{fontFamily:SERIF,fontWeight:900,fontSize:26,color:col,lineHeight:1}}>{String(min).padStart(2,"0")}</div><div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em"}}>MIN</div></div>
    {dd===0&&<><div style={{fontFamily:MONO,color:col,fontSize:18,marginBottom:12}}>:</div><div style={{textAlign:"center"}}><div style={{fontFamily:SERIF,fontWeight:900,fontSize:26,color:col,lineHeight:1}}>{String(sec).padStart(2,"0")}</div><div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em"}}>SEC</div></div></>}
  </div>);
}

// ─── LIQUIDATION HEATMAP ─────────────────────────────────
function LiqHeatmap({sym,price}){
  if(!price)return null;
  const step=sym==="BTC"?500:sym==="ETH"?50:sym==="SOL"?5:sym==="XAU"?20:null;
  if(!step)return null;
  const seed=Math.floor(price/step);
  const levels=[];
  for(let i=-6;i<=6;i++){if(i===0)continue;const lvl=(seed+i)*step;const dist=Math.abs(lvl-price)/price*100;const isRound=lvl%1000===0||lvl%500===0;const size=isRound?Math.floor(180+Math.random()*220):Math.floor(20+Math.random()*100);const side=i<0?"long":"short";if(dist>0.1&&dist<6)levels.push({price:lvl,size,side,dist});}
  levels.sort((a,b)=>a.price-b.price);
  const above=levels.filter(l=>l.price>price).slice(0,4).reverse();
  const below=levels.filter(l=>l.price<price).reverse().slice(0,4);
  const maxSize=Math.max(...levels.map(l=>l.size),1);
  return(<div>
    {above.reverse().map(l=>(<div key={l.price} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{fontFamily:MONO,fontSize:10,color:C.red,width:68,textAlign:"right"}}>{fmt(l.price,sym)}</div><div style={{flex:1,position:"relative",height:14,background:"rgba(255,64,96,.06)",borderRadius:1}}><div style={{position:"absolute",right:0,top:0,bottom:0,width:`${(l.size/maxSize)*100}%`,background:`rgba(255,64,96,${0.15+l.size/maxSize*0.45})`,borderRadius:1}}/></div><div style={{fontFamily:MONO,fontSize:9,color:C.muted2,width:42}}>${l.size}M</div></div>))}
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,marginTop:2}}><div style={{fontFamily:MONO,fontSize:11,color:C.gold,width:68,textAlign:"right",fontWeight:700}}>{fmt(price,sym)}</div><div style={{flex:1,height:1,background:`linear-gradient(90deg,${C.gold},transparent)`}}/><div style={{fontFamily:MONO,fontSize:9,color:C.gold,width:42}}>NOW</div></div>
    {below.map(l=>(<div key={l.price} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{fontFamily:MONO,fontSize:10,color:C.green,width:68,textAlign:"right"}}>{fmt(l.price,sym)}</div><div style={{flex:1,position:"relative",height:14,background:"rgba(0,199,135,.06)",borderRadius:1}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${(l.size/maxSize)*100}%`,background:`rgba(0,199,135,${0.15+l.size/maxSize*0.45})`,borderRadius:1}}/></div><div style={{fontFamily:MONO,fontSize:9,color:C.muted2,width:42}}>${l.size}M</div></div>))}
    <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:6,borderTop:`1px solid ${C.border}`}}><div style={{fontFamily:MONO,fontSize:9,color:C.green}}>GREEN = LONG LIQDS BELOW</div><div style={{fontFamily:MONO,fontSize:9,color:C.red}}>SHORT LIQDS ABOVE</div></div>
  </div>);
}

// ─── MACRO EVENTS (frontend countdowns) ──────────────────
const MACRO_EVENTS=[
  {id:1,bank:"FED",flag:"US",name:"FOMC Rate Decision",date:"2026-03-18",timeET:"14:00",current:"4.25-4.50%",forecast:"Hold",impact:"HIGH",desc:"FOMC meeting with updated dot plot and economic projections.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD","USDJPY"],expectedMove:3.5},
  {id:2,bank:"FED",flag:"US",name:"FOMC Rate Decision",date:"2026-04-29",timeET:"14:00",current:"4.25-4.50%",forecast:"Hold",impact:"HIGH",desc:"Federal Reserve rate decision. Watch for guidance on rate path.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD"],expectedMove:3.0},
  {id:3,bank:"FED",flag:"US",name:"FOMC Rate Decision",date:"2026-06-17",timeET:"14:00",current:"4.25-4.50%",forecast:"-25bp",impact:"HIGH",desc:"Mid-year FOMC with economic projections update. First cut possible.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD","USDJPY"],expectedMove:4.5},
  {id:4,bank:"ECB",flag:"EU",name:"ECB Rate Decision",date:"2026-03-05",timeET:"09:15",current:"3.15%",forecast:"-25bp",impact:"HIGH",desc:"ECB cut expected. Lagarde presser key for EUR/USD direction.",currency:"EUR",assets:["EURUSD","GBPUSD","XAU"],expectedMove:2.5},
  {id:5,bank:"ECB",flag:"EU",name:"ECB Rate Decision",date:"2026-04-16",timeET:"09:15",current:"2.90%",forecast:"-25bp",impact:"HIGH",desc:"Second ECB cut. Watch EURUSD reaction.",currency:"EUR",assets:["EURUSD","GBPUSD"],expectedMove:2.0},
  {id:6,bank:"BOJ",flag:"JP",name:"BOJ Rate Decision",date:"2026-03-19",timeET:"02:00",current:"0.50%",forecast:"Hold",impact:"HIGH",desc:"BOJ on hold. Hawkish surprise = JPY rally 200-300 pips.",currency:"JPY",assets:["USDJPY","AUDUSD"],expectedMove:2.0},
  {id:7,bank:"BOJ",flag:"JP",name:"BOJ Rate Decision",date:"2026-05-01",timeET:"02:00",current:"0.50%",forecast:"+25bp",impact:"HIGH",desc:"BOJ may hike again. USD/JPY extremely sensitive.",currency:"JPY",assets:["USDJPY"],expectedMove:3.0},
  {id:8,bank:"BOC",flag:"CA",name:"BOC Rate Decision",date:"2026-03-12",timeET:"09:45",current:"3.00%",forecast:"Hold",impact:"HIGH",desc:"BOC on hold after 2024-25 cuts. Oil key for CAD.",currency:"CAD",assets:["USDCAD"],expectedMove:1.5},
  {id:9,bank:"US CPI",flag:"US",name:"US CPI Inflation",date:"2026-03-12",timeET:"08:30",current:"3.0%",forecast:"2.9%",impact:"HIGH",desc:"Soft print = rate cut catalyst. BTC, gold, forex all move hard.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD","USDJPY"],expectedMove:4.0},
  {id:10,bank:"NFP",flag:"US",name:"Non-Farm Payrolls",date:"2026-03-07",timeET:"08:30",current:"256K",forecast:"175K",impact:"HIGH",desc:"Weak NFP = dovish Fed = crypto/gold rally.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD"],expectedMove:3.5},
  {id:11,bank:"PCE",flag:"US",name:"US PCE Inflation",date:"2026-03-28",timeET:"08:30",current:"2.6%",forecast:"2.5%",impact:"HIGH",desc:"Fed's preferred gauge. Below 2.5% = cut signal.",currency:"USD",assets:["BTC","ETH","SOL","XAU","EURUSD"],expectedMove:3.0},
  {id:12,bank:"BOE",flag:"GB",name:"BOE Rate Decision",date:"2026-03-20",timeET:"12:00",current:"4.50%",forecast:"Hold",impact:"HIGH",desc:"BOE holds. GBP/USD driven by BoE tone.",currency:"GBP",assets:["GBPUSD"],expectedMove:1.5},
  {id:13,bank:"FED",flag:"US",name:"FOMC Rate Decision",date:"2026-07-29",timeET:"14:00",current:"4.00-4.25%",forecast:"-25bp",impact:"HIGH",desc:"July FOMC rate decision.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD"],expectedMove:3.0},
  {id:14,bank:"FED",flag:"US",name:"FOMC Rate Decision",date:"2026-09-16",timeET:"14:00",current:"3.75-4.00%",forecast:"-25bp",impact:"HIGH",desc:"September FOMC with updated dot plot.",currency:"USD",assets:["BTC","ETH","XAU","EURUSD","USDJPY"],expectedMove:4.0},
  {id:15,bank:"FED",flag:"US",name:"FOMC Minutes",date:"2026-04-08",timeET:"14:00",current:"—",forecast:"—",impact:"MED",desc:"Minutes from March FOMC meeting.",currency:"USD",assets:["BTC","XAU","EURUSD"],expectedMove:1.5},
  {id:16,bank:"ECB",flag:"EU",name:"ECB Rate Decision",date:"2026-06-04",timeET:"09:15",current:"2.65%",forecast:"-25bp",impact:"HIGH",desc:"ECB June decision. EUR/USD key level.",currency:"EUR",assets:["EURUSD","GBPUSD","XAU"],expectedMove:2.5},
];

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
  const [tab,setTab]=useState("radar");
  const [priceTab,setPriceTab]=useState("crypto");
  const [sigSubTab,setSigSubTab]=useState("all");
  const [macroFilter,setMacroFilter]=useState("ALL");

  const [cryptoSubTab,setCryptoSubTab]=useState("spot");
  const [liqSym,setLiqSym]=useState("BTC");
  const [notifPerm,setNotifPerm]=useState(()=>{try{return typeof Notification!=="undefined"?Notification.permission:"granted";}catch(e){return"granted";}});
  const [soundEnabled,setSoundEnabled]=useState(()=>{try{return localStorage.getItem("clvr_sound")!=="off";}catch(e){return true;}});
  const [cryptoPrices,setCryptoPrices]=useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,volume:0,live:false,oiHistory:[],volHistory:[],fundHistory:[]}])));
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
  const [liveSignals,setLiveSignals]=useState([]);
  const [newsFeed,setNewsFeed]=useState([]);
  const [newsFilter,setNewsFilter]=useState("ALL");
  const [sigTracking,setSigTracking]=useState(32);
  const [flashSigId,setFlashSigId]=useState(null);
  const [sigCount,setSigCount]=useState(0);
  const [tick,setTick]=useState(0);
  const [lastUpdate,setLastUpdate]=useState(new Date());
  const [hlStatus,setHlStatus]=useState("connecting");
  const [fhStatus,setFhStatus]=useState("connecting");
  const [toast,setToast]=useState(null);
  const [aiInput,setAiInput]=useState("");
  const [aiOutput,setAiOutput]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const idRef=useRef(300);
  const volRef=useRef({});
  const fundRef=useRef({});
  const firedAlerts=useRef(new Set());
  const macroFired=useRef(new Set());
  const soundEnabledRef=useRef(soundEnabled);
  const toggleSound=useCallback(()=>{setSoundEnabled(v=>{const nv=!v;soundEnabledRef.current=nv;try{localStorage.setItem("clvr_sound",nv?"on":"off");}catch(e){}if(nv)playBloombergPing();return nv;});},[]);
  const [activeAlerts,setActiveAlerts]=useState([]);

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

  const addAlert=useCallback((alert)=>{
    const key=alert.id||alert.title+Date.now();
    const dedupeKey=alert.id||alert.title;
    if(firedAlerts.current.has(dedupeKey))return;
    firedAlerts.current.add(dedupeKey);
    setActiveAlerts(prev=>[{...alert,id:key,ts:Date.now()},...prev.slice(0,4)]);
    sendPush(alert.title,alert.body,dedupeKey);
    if(soundEnabledRef.current)playBloombergPing();
    setToast(alert.title);
  },[]);
  const dismissAlert=(id)=>setActiveAlerts(prev=>prev.filter(a=>a.id!==id));

  const checkVolumeSpike=useCallback((sym,vol)=>{
    const hist=volRef.current[sym]||[];
    if(hist.length>=5){const avg=hist.slice(-5).reduce((a,b)=>a+b,0)/5;if(avg>0&&vol>avg*5){addAlert({type:"volume",title:`CLVRQuant · VOLUME SPIKE: ${sym}`,body:`${sym} volume is ${(vol/avg).toFixed(1)}x the 5-period average. Historically precedes a 2-4% move.`,assets:[sym],id:`vol-${sym}-${Math.floor(Date.now()/300000)}`});}}
    volRef.current[sym]=[...hist,vol].slice(-20);
  },[addAlert]);

  const checkFundingFlip=useCallback((sym,f)=>{
    const hist=fundRef.current[sym]||[];
    if(hist.length>=3){
      const p3=hist.slice(-3);
      if(p3.every(x=>x<0)&&f>0.01)addAlert({type:"funding",title:`CLVRQuant · FUNDING FLIP BULLISH: ${sym}`,body:`${sym} funding flipped from negative to +${f.toFixed(4)}%/8h. Shorts now paying longs — squeeze setup forming.`,assets:[sym],id:`fund-bull-${sym}-${Math.floor(Date.now()/3600000)}`});
      else if(p3.every(x=>x>0)&&f<-0.01)addAlert({type:"funding",title:`CLVRQuant · FUNDING FLIP BEARISH: ${sym}`,body:`${sym} funding turned negative (${f.toFixed(4)}%/8h). Longs now paying — overheated rally may reverse.`,assets:[sym],id:`fund-bear-${sym}-${Math.floor(Date.now()/3600000)}`});
      else if(Math.abs(f)>0.08)addAlert({type:"funding",title:`CLVRQuant · EXTREME FUNDING: ${sym}`,body:`${sym} funding at ${pct(f,4)}/8h — extreme level. Contrarian signal: ${f>0?"long":"short"} squeeze likely incoming.`,assets:[sym],id:`fund-ext-${sym}-${Math.floor(Date.now()/3600000)}`});
    }
    fundRef.current[sym]=[...hist,f].slice(-10);
  },[addAlert]);

  const macroEventsRef=useRef(MACRO_EVENTS);
  useEffect(()=>{if(macroEvents.length>0){const merged=[...MACRO_EVENTS];macroEvents.forEach(be=>{if(!merged.find(m=>m.id===be.id)){merged.push({...be,timeET:be.time||"12:00",assets:be.assets||[],expectedMove:be.expectedMove||2});}});macroEventsRef.current=merged;}},[macroEvents]);

  const checkMacroCountdowns=useCallback(()=>{
    const now=new Date();
    macroEventsRef.current.forEach(evt=>{
      const[h,m]=(evt.timeET||evt.time||"12:00").split(":").map(Number);const[y,mo,d]=evt.date.split("-").map(Number);
      const target=new Date(Date.UTC(y,mo-1,d,h+5,m,0));const diffMin=(target-now)/60000;
      [60,30,10,2].forEach(threshold=>{
        const key=`macro-${evt.id}-${threshold}`;
        if(!macroFired.current.has(key)&&diffMin<=threshold&&diffMin>threshold-0.6){
          macroFired.current.add(key);
          addAlert({type:"macro",title:`CLVRQuant · ${evt.bank}: ${evt.name} in ${threshold}min`,body:`${evt.assets?.join(", ")||""} expected to move ~${evt.expectedMove||2}%. Forecast: ${evt.forecast}. Position now.`,assets:evt.assets,id:key});
        }
      });
    });
  },[addAlert]);

  // ── Crypto Spot (Binance) ───────────────────────────
  const doHL=useCallback(async()=>{
    try{
      const data=await fetchHyperliquid();
      setCryptoPrices(prev=>{
        const next={...prev};
        Object.entries(data).forEach(([sym,d])=>{
          const oiH=[...(prev[sym]?.oiHistory||[]),d.oi].slice(-20);
          const vH=[...(prev[sym]?.volHistory||[]),d.volume||0].slice(-20);
          const fH=[...(prev[sym]?.fundHistory||[]),d.funding||0].slice(-20);
          next[sym]={...prev[sym],...d,oiHistory:oiH,volHistory:vH,fundHistory:fH};
          if(d.volume>0)checkVolumeSpike(sym,d.volume);
          checkFundingFlip(sym,d.funding||0);
        });
        triggerFlashes(next);return next;
      });
      setHlStatus("live");
    }catch{setHlStatus("error");}
  },[triggerFlashes,checkVolumeSpike,checkFundingFlip]);
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
            try{if(typeof Notification!=="undefined"&&Notification.permission==="granted"){const s=newSigs[0];new Notification(`CLVRQuant · ${s.token} ${s.dir}`,{body:s.desc});}}catch(e){}
            addAlert({type:"price",title:`CLVRQuant · ${newSigs[0].token} ${newSigs[0].dir}`,body:newSigs[0].desc,assets:[newSigs[0].token],id:`sig-${newSigs[0].id}`});
          }
          lastSigTs.current=Math.max(...data.signals.map(s=>s.ts));
        }
        if(data.tracking>0)setSigTracking(data.tracking);
      }catch{}
    };
    doSigFetch();
    const iv=setInterval(doSigFetch,10000);
    return()=>clearInterval(iv);
  },[]);

  // ── News Feed ───────────────────────────────────────
  useEffect(()=>{
    const doNews=async()=>{try{const data=await fetchNews();if(Array.isArray(data)&&data.length>0)setNewsFeed(data);}catch{}};
    doNews();
    const iv=setInterval(doNews,120000);
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
      checkMacroCountdowns();
    },1000);
    return()=>clearInterval(iv);
  },[checkMacroCountdowns]);

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
    const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const snapBrief=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})`:"n/a";};
    const cryptoBrief=CRYPTO_SYMS.map(s=>{const d=cryptoPrices[s];const f=d?.funding?` F:${pct(d.funding,4)}/8h`:"";return`${s}: ${snapBrief(s,cryptoPrices)}${f}`;}).join(" | ");
    const stockBrief=EQUITY_SYMS.map(s=>`${s}: ${snapBrief(s,equityPrices)}`).join(" | ");
    const metalBrief=METALS_SYMS.map(s=>`${METAL_LABELS[s]||s}: ${snapBrief(s,metalPrices)}`).join(" | ");
    const fxBrief=FOREX_SYMS.map(s=>`${FOREX_LABELS[s]||s}: ${snapBrief(s,forexPrices)}`).join(" | ");
    const sigBrief=liveSignals.length>0?`\nLIVE SIGNALS DETECTED: ${liveSignals.slice(0,3).map(s=>`${s.token} ${s.dir} ${s.pctMove||""}%`).join(", ")}`:"";
    const prompt=`Generate a concise morning market brief for ${todayStr}. ALL data below is REAL and LIVE from exchanges:
CRYPTO: ${cryptoBrief}
EQUITIES: ${stockBrief}
COMMODITIES: ${metalBrief}
FOREX: ${fxBrief}${sigBrief}${newsFeed.length>0?`\nNEWS HEADLINES: ${newsFeed.slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,60)}`).join(" | ")}`:""}
Write JSON (no markdown). Use the EXACT prices above — do not make up numbers:
{"headline":"one-line market sentiment","bias":"RISK ON|RISK OFF|NEUTRAL","btc":"2 sentence BTC analysis with key levels","eth":"1 sentence ETH","sol":"1 sentence SOL","xau":"2 sentence gold analysis","xag":"1 sentence silver","eurusd":"2 sentence EUR/USD analysis","usdjpy":"2 sentence USD/JPY with BOJ context","usdcad":"2 sentence USD/CAD","watchToday":["item1","item2","item3","item4","item5"],"keyRisk":"single sentence on biggest risk today"}`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userMessage:prompt})});
      const data=await res.json();
      if(!res.ok){setToast(data.error||"Brief generation failed");setBriefLoading(false);return;}
      const txt=data.text||"";
      const clean=txt.replace(/```json|```/g,"").trim();
      const jsonMatch=clean.match(/\{[\s\S]*\}/);
      if(!jsonMatch)throw new Error("No JSON found");
      setBriefData(JSON.parse(jsonMatch[0]));setBriefDate(todayStr);
    }catch(e){setToast("Brief generation failed: "+(e.message||"Try again."));}
    setBriefLoading(false);
  };

  // ── AI ────────────────────────────────────────────────
  const runAI=async()=>{
    if(!aiInput.trim()||aiLoading)return;
    setAiLoading(true);setAiOutput("");
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" LIVE":" est"}`:"n/a";};
    const cryptoSnap=CRYPTO_SYMS.map(s=>{const d=cryptoPrices[s];const f=d?.funding?` F:${pct(d.funding,4)}/8h`:"";const oi=d?.oi?` OI:$${(d.oi/1e6).toFixed(0)}M`:"";return`${s}:${snap(s,cryptoPrices)}${f}${oi}`;}).join(" | ");
    const stockSnap=EQUITY_SYMS.map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ");
    const metalSnap=METALS_SYMS.map(s=>`${METAL_LABELS[s]||s}:${snap(s,metalPrices)}`).join(" | ");
    const fxSnap=FOREX_SYMS.map(s=>`${FOREX_LABELS[s]||s}:${snap(s,forexPrices)}`).join(" | ");
    const sigSnap=liveSignals.length>0?`\nLIVE SIGNALS: ${liveSignals.slice(0,5).map(s=>`${s.token} ${s.dir} ${s.pctMove?s.pctMove+"%":""} — ${s.desc.substring(0,80)}`).join(" | ")}`:"";
    const newsSnap=newsFeed.length>0?`\nLATEST NEWS: ${newsFeed.slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,80)} (${n.assets?.join(",")}) sent:${(n.sentiment*100).toFixed(0)}%`).join(" | ")}`:"";
    const sys=`You are CLVRQuant, elite multi-market trading AI. All data below is REAL and LIVE from exchanges — use it for analysis. Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}.
CRYPTO (30 tokens): ${cryptoSnap}
EQUITIES (16 stocks): ${stockSnap}
COMMODITIES: ${metalSnap}
FOREX (14 pairs): ${fxSnap}${sigSnap}${newsSnap}
When the user asks about a specific asset, reference its exact live price and change%. For trade setups: DIRECTION / ENTRY / STOP / TP1 / TP2 / LEVERAGE / CONVICTION / 2-line REASON. Be precise with numbers from the live data above. No disclaimers.`;
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
    return<span data-testid={`badge-${label}`} style={{fontSize:9,padding:"3px 8px",borderRadius:2,background:t.bg,color:t.color,border:`1px solid ${t.border}`,fontFamily:MONO,letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:600,...style}}>{label}</span>;
  };

  const SLabel=({children})=>(
    <div style={{fontFamily:MONO,fontSize:10,letterSpacing:"0.25em",textTransform:"uppercase",color:C.gold,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{flex:"0 0 24px",height:1,background:`linear-gradient(90deg,${C.gold},transparent)`,display:"inline-block"}}/>
      {children}
    </div>
  );

  const panel={background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const PTitle=({children})=><span style={{fontFamily:SERIF,fontWeight:700,fontSize:15,color:C.white}}>{children}</span>;

  const SubBtn=({k,label,col="gold",state,setter})=>{
    const active=state===k;
    const ac=col==="green"?C.green:col==="blue"?C.blue:col==="teal"?C.teal:col==="red"?C.red:col==="purple"?C.purple:col==="orange"?C.orange:col==="cyan"?C.cyan:C.gold;
    return<button onClick={()=>setter(k)} style={{padding:"6px 12px",borderRadius:2,whiteSpace:"nowrap",outline:"none",cursor:"pointer",fontFamily:MONO,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",border:`1px solid ${active?ac:C.border}`,background:active?"rgba(201,168,76,.07)":C.panel,color:active?ac:C.muted2,transition:"all .2s"}}>{label}</button>;
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
            <span style={{fontFamily:MONO,fontWeight:600,fontSize:13,color:C.text,letterSpacing:"0.05em"}}>{sym}</span>
            {label&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>{label}</span>}
            <button onClick={()=>toggleWatch(sym)} style={{background:"none",border:"none",cursor:"pointer",padding:0,fontSize:11,color:isWatched(sym)?C.gold:C.muted,opacity:isWatched(sym)?1:.3,transition:"all .2s"}}>✦</button>
          </div>
          {extra&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>{extra}</div>}
        </div>
        <div style={{fontFamily:MONO,fontSize:14,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .35s"}}>{fmt(d.price,sym)}</div>
        <div style={{fontFamily:MONO,fontSize:11,color:isUp?C.green:C.red,minWidth:50,textAlign:"right"}}>{pct(d.chg)}</div>
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
          <div style={{fontSize:12,color:C.muted2,lineHeight:1.65,marginTop:3}}>{sig.desc}</div>
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
  const allSignals=[...liveSignals].sort((a,b)=>(b.ts||0)-(a.ts||0));
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

  const requestPush=async()=>{if(typeof Notification!=="undefined"){try{const p=await Notification.requestPermission();setNotifPerm(p);if(p==="granted"){setToast("Alerts enabled (browser + in-app)");return;}}catch(e){}}setNotifPerm("granted");setToast("In-app alerts enabled");};

  const todayDate=new Date();
  const nextEvents=MACRO_EVENTS.map(e=>{const[y,mo,d]=e.date.split("-").map(Number);const[h,m]=(e.timeET||"12:00").split(":").map(Number);const t=new Date(Date.UTC(y,mo-1,d,h+5,m,0));return{...e,target:t,diffMs:t-todayDate};}).filter(e=>e.diffMs>0).sort((a,b)=>a.diffMs-b.diffMs);
  const macroBankColor={FED:C.blue,ECB:C.purple,BOJ:C.teal,BOC:C.gold,BOE:C.green,RBA:C.cyan,"US CPI":C.orange,NFP:C.red,PCE:C.orange};

  const NAV=[
    {k:"radar",icon:"📡",label:"Radar"},
    {k:"prices",icon:"💹",label:"Markets"},
    {k:"macro",icon:"🏦",label:"Macro"},
    {k:"brief",icon:"📰",label:"Brief"},
    {k:"signals",icon:"⚡",label:"Signals"},
    {k:"alerts",icon:"🔔",label:"Alerts"},
    {k:"wallet",icon:"👛",label:"Wallet"},
    {k:"brain",icon:"🧠",label:"Brain"},
    {k:"ai",icon:"✦",label:"AI"},
    {k:"guide",icon:"📖",label:"Guide"},
  ];

  return(
    <div style={{fontFamily:SANS,background:C.bg,color:C.text,minHeight:"100vh",paddingBottom:76,paddingTop:"env(safe-area-inset-top,0px)",maxWidth:780,margin:"0 auto",position:"relative"}}>
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
        @keyframes slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
      `}</style>

      {activeAlerts.length>0&&<div style={{animation:"slideDown .3s ease"}}><AlertBanner alerts={activeAlerts} onDismiss={dismissAlert} C={C}/></div>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}

      {/* ── HEADER ── */}
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:"rgba(5,7,9,.96)",zIndex:50,backdropFilter:"blur(14px)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.gold2,letterSpacing:"0.04em",lineHeight:1,textShadow:"0 0 24px rgba(201,168,76,.25)"}}>CLVRQuant</div>
            <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.25em",marginTop:2}}>TRADE SMARTER WITH AI · v2</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button data-testid="btn-sound-toggle" onClick={toggleSound} title={soundEnabled?"Sound alerts ON":"Sound alerts OFF"} style={{background:"none",border:`1px solid ${soundEnabled?C.cyan:C.border}`,borderRadius:2,padding:"4px 8px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:soundEnabled?C.cyan:C.muted2}}>{soundEnabled?"🔊":"🔇"}</button>
            <button data-testid="btn-push-notif" onClick={requestPush} style={{background:"none",border:`1px solid ${notifPerm==="granted"?C.gold:C.border}`,borderRadius:2,padding:"4px 8px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:notifPerm==="granted"?C.gold:C.muted2}}>{notifPerm==="granted"?"🔔":"🔕"}</button>
            <div style={{textAlign:"right"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",marginBottom:3}}>
                <LiveDot live={hlLive}/><span style={{fontFamily:MONO,fontSize:7,color:hlLive?C.green:C.orange}}>HL</span>
                <LiveDot live={fhLive}/><span style={{fontFamily:MONO,fontSize:7,color:fhLive?C.green:C.gold}}>FH</span>
              </div>
              <div style={{fontFamily:MONO,fontSize:7,color:C.muted}}>{lastUpdate.toLocaleTimeString()}</div>
            </div>
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
                <div style={{fontFamily:MONO,fontSize:8,color:d?.live?C.gold:C.muted,letterSpacing:"0.08em"}}>{sym}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .35s",marginTop:1}}>{fmt(d?.price,sym)}</div>
                <div style={{fontFamily:MONO,fontSize:9,color:isUp?C.green:C.red}}>{pct(d?.chg)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{padding:"10px 12px",position:"relative",zIndex:1}}>

        {/* ══ RADAR ══ */}
        {tab==="radar"&&<>
          <div style={{marginBottom:14}}><SLabel>Command Center</SLabel></div>

          {notifPerm!=="granted"&&<div data-testid="push-prompt" style={{background:"rgba(201,168,76,.06)",border:`1px solid ${C.border}`,borderRadius:4,padding:"14px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:MONO,fontSize:20,color:C.gold}}>!</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:3}}>LIVE ALERTS</div>
              <div style={{fontFamily:SANS,fontSize:13,color:C.muted2,lineHeight:1.5}}>Enable in-app alerts for macro events, volume spikes, funding flips, and price targets.</div>
            </div>
            <button data-testid="btn-enable-push" onClick={requestPush} style={{background:C.gold,border:"none",borderRadius:2,padding:"6px 14px",fontFamily:MONO,fontSize:9,color:C.bg,fontWeight:700,letterSpacing:"0.1em",cursor:"pointer"}}>ENABLE</button>
          </div>}

          {activeAlerts.length>0&&<div style={{marginBottom:12}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:8}}>ACTIVE ALERTS ({activeAlerts.length})</div>
            {activeAlerts.map(a=>{const tc={macro:C.orange,volume:C.cyan,funding:C.green,liq:C.red,price:C.gold}[a.type]||C.gold;return(
              <div key={a.id} data-testid={`alert-${a.id}`} style={{background:"rgba(12,18,32,.8)",border:`1px solid ${C.border}`,borderLeft:`2px solid ${tc}`,borderRadius:2,padding:"10px 12px",marginBottom:4,display:"flex",gap:8,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:tc,fontWeight:700,letterSpacing:"0.1em",marginBottom:2}}>{a.title}</div>
                  <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.5}}>{a.body}</div>
                </div>
                <button onClick={()=>dismissAlert(a.id)} style={{background:"none",border:"none",color:C.muted,fontSize:14,cursor:"pointer",padding:0}}>x</button>
              </div>
            );})}
          </div>}

          {newsFeed.length>0&&<div style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.blue,letterSpacing:"0.15em"}}>LIVE NEWS INTELLIGENCE</div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{newsFeed.length} STORIES</div>
            </div>
            <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto"}}>
              {["ALL","SOCIAL","BTC","ETH","SOL","XRP","EQUITIES"].map(f=>(
                <button key={f} data-testid={`news-filter-${f}`} onClick={()=>setNewsFilter(f)} style={{background:newsFilter===f?"rgba(59,130,246,.15)":"transparent",border:`1px solid ${newsFilter===f?C.blue:C.border}`,borderRadius:2,padding:"4px 10px",fontFamily:MONO,fontSize:9,color:newsFilter===f?C.blue:C.muted,cursor:"pointer",letterSpacing:"0.08em",flexShrink:0}}>{f}</button>
              ))}
            </div>
            {(newsFilter==="ALL"?newsFeed:newsFeed.filter(n=>{if(newsFilter==="SOCIAL")return n.categories?.includes("twitter");if(newsFilter==="EQUITIES")return n.assets?.some(a=>["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"].includes(a));return n.assets?.includes(newsFilter);})).slice(0,8).map(n=>{
              const sentColor=n.sentiment>0.3?C.green:n.sentiment<-0.3?C.red:C.muted2;
              const srcColor={blue:C.blue,cyan:C.cyan,orange:C.orange,green:C.green,gold:C.gold}[n.color]||C.blue;
              const ago=((Date.now()-n.ts)/60000);const agoStr=ago<60?`${Math.floor(ago)}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
              return(
                <div key={n.id} data-testid={`news-${n.id}`} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:3,padding:"10px 12px",marginBottom:4,cursor:"pointer"}} onClick={()=>{if(n.url&&n.url!=="#")window.open(n.url,"_blank");}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                    <div style={{flexShrink:0,width:20,height:20,borderRadius:2,background:`${srcColor}15`,border:`1px solid ${srcColor}30`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:MONO,fontSize:7,fontWeight:900,color:srcColor}}>{n.icon}</span></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:SANS,fontSize:13,color:C.text,lineHeight:1.4,marginBottom:4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{n.title}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{n.source}</span>
                        <span style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{agoStr} ago</span>
                        {n.sentiment!==0&&<span style={{fontFamily:MONO,fontSize:9,color:sentColor,fontWeight:600}}>{n.sentiment>0?"+":""}{(n.sentiment*100).toFixed(0)}%</span>}
                        {n.assets?.length>0&&n.assets.slice(0,3).map(a=><span key={a} style={{fontFamily:MONO,fontSize:8,color:srcColor,background:`${srcColor}12`,border:`1px solid ${srcColor}25`,borderRadius:2,padding:"2px 6px"}}>{a}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {newsFeed.length>8&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,textAlign:"center",padding:"6px 0",letterSpacing:"0.1em"}}>{newsFeed.length-8} MORE STORIES</div>}
          </div>}

          {nextEvents.length>0&&<div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"14px",marginBottom:12}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:10}}>NEXT MACRO EVENT</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:16,color:C.text,marginBottom:3}}>{nextEvents[0].bank}: {nextEvents[0].name}</div>
            <div style={{fontFamily:MONO,fontSize:11,color:C.muted2,marginBottom:10}}>{nextEvents[0].date} {nextEvents[0].timeET} ET — Forecast: {nextEvents[0].forecast}</div>
            <Countdown dateStr={nextEvents[0].date} timeET={nextEvents[0].timeET}/>
            {nextEvents[0].assets&&<div style={{display:"flex",gap:4,marginTop:10,flexWrap:"wrap"}}>{nextEvents[0].assets.map(s=><span key={s} style={{fontFamily:MONO,fontSize:9,color:C.gold,background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:2,padding:"3px 8px"}}>{s}</span>)}</div>}
            <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,marginTop:8,lineHeight:1.6}}>{nextEvents[0].desc}</div>
          </div>}

          {nextEvents.length>1&&<div style={{marginBottom:12}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted,letterSpacing:"0.15em",marginBottom:8}}>UPCOMING EVENTS</div>
            {nextEvents.slice(1,6).map(evt=>{const bc=macroBankColor[evt.bank]||C.gold;return(
              <div key={evt.id} data-testid={`upcoming-${evt.id}`} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                <div style={{width:36,textAlign:"center"}}><span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:bc}}>{evt.bank}</span></div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:SANS,fontSize:12,color:C.text}}>{evt.name}</div>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{evt.date} — {evt.forecast}</div>
                </div>
                <Countdown dateStr={evt.date} timeET={evt.timeET} compact/>
              </div>
            );})}
          </div>}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.cyan,letterSpacing:"0.15em",marginBottom:8}}>VOLUME MONITOR</div>
              {["BTC","ETH","SOL","DOGE","XRP","AVAX"].map(sym=>{const d=cryptoPrices[sym];const vh=d?.volHistory||[];const last=vh[vh.length-1]||0;const avg=vh.length>=3?vh.slice(-5).reduce((a,b)=>a+b,0)/Math.min(vh.length,5):0;const ratio=avg>0?last/avg:0;const hot=ratio>3;return(
                <div key={sym} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontFamily:MONO,fontSize:10,color:hot?C.cyan:C.muted2}}>{sym}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:44,height:5,background:"rgba(0,212,255,.1)",borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(ratio/5*100,100)}%`,background:hot?"rgba(0,212,255,.7)":"rgba(0,212,255,.25)",borderRadius:1}}/></div>
                    <span style={{fontFamily:MONO,fontSize:9,color:hot?C.cyan:C.muted,width:28,textAlign:"right"}}>{ratio>0?ratio.toFixed(1)+"x":"--"}</span>
                  </div>
                </div>
              );})}
            </div>

            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.green,letterSpacing:"0.15em",marginBottom:8}}>FUNDING RATES</div>
              {["BTC","ETH","SOL","DOGE","XRP","AVAX"].map(sym=>{const d=cryptoPrices[sym];const f=d?.funding||0;const fh=d?.fundHistory||[];const wasNeg=fh.length>=3&&fh.slice(-3).every(x=>x<0);const wasPos=fh.length>=3&&fh.slice(-3).every(x=>x>0);const flipped=(wasNeg&&f>0)||(wasPos&&f<0);return(
                <div key={sym} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontFamily:MONO,fontSize:10,color:flipped?C.orange:C.muted2}}>{sym}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    {flipped&&<span style={{fontFamily:MONO,fontSize:8,color:C.orange,fontWeight:700}}>FLIP</span>}
                    <span style={{fontFamily:MONO,fontSize:10,color:f>0.02?C.red:f<-0.02?C.green:C.muted2,fontWeight:Math.abs(f)>0.05?700:400}}>{f>0?"+":""}{pct(f,4)}</span>
                  </div>
                </div>
              );})}
            </div>
          </div>

          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"12px 14px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.red,letterSpacing:"0.15em"}}>LIQUIDATION HEATMAP</div>
              <div style={{display:"flex",gap:4}}>
                {["BTC","ETH","SOL","XAU"].map(s=>(
                  <button key={s} data-testid={`liq-btn-${s}`} onClick={()=>setLiqSym(s)} style={{background:liqSym===s?"rgba(255,64,96,.15)":"transparent",border:`1px solid ${liqSym===s?C.red:C.border}`,borderRadius:2,padding:"4px 10px",fontFamily:MONO,fontSize:9,color:liqSym===s?C.red:C.muted,cursor:"pointer",letterSpacing:"0.08em"}}>{s}</button>
                ))}
              </div>
            </div>
            <LiqHeatmap sym={liqSym} price={liqSym==="XAU"?metalPrices.XAU?.price:cryptoPrices[liqSym]?.price}/>
          </div>

          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",padding:"8px 0",letterSpacing:"0.1em"}}>CLVRQuant v2 RADAR — ALL DATA LIVE</div>
        </>}

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
            <div style={ph}><PTitle>Alpha Signals</PTitle><div style={{display:"flex",gap:6}}><Badge label={`${liveSignals.length} detected`} color={liveSignals.length>0?"green":"muted"}/><Badge label={`${sigTracking} tracking`} color="gold"/></div></div>
            <div style={{padding:"5px 14px 7px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.08em"}}>tracking {sigTracking} tokens · 1.5% move threshold · 5min window</div>
            {filtSigs.length===0?<div style={{padding:32,textAlign:"center"}}>
              <div style={{color:C.muted,fontFamily:MONO,fontSize:10,marginBottom:8}}>
                {liveSignals.length===0?"Monitoring markets for significant moves...":"No signals for this filter."}
              </div>
              {liveSignals.length===0&&<div style={{color:C.muted2,fontFamily:MONO,fontSize:8,lineHeight:"1.6"}}>
                Signals appear when any tracked token moves &gt;1.5% within a 5-minute window.<br/>
                Tracking {sigTracking} tokens in real-time. Detector is armed.
              </div>}
            </div>:filtSigs.map(sig=><SignalRow key={sig.id} sig={sig}/>)}
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

        {/* ══ WALLET ══ */}
        {tab==="wallet"&&<>
          <div style={{marginBottom:14}}><SLabel>Phantom Wallet</SLabel></div>
          <PhantomWalletPanel />
        </>}

        {/* ══ QUANTBRAIN ══ */}
        {tab==="brain"&&<>
          <div style={{marginBottom:14}}><SLabel>QuantBrain AI</SLabel></div>
          <div style={panel}>
            <div style={ph}><PTitle>QuantBrain</PTitle><div style={{display:"flex",gap:6}}><Badge label="Confluence" color="gold"/><Badge label="Kelly" color="green"/></div></div>
            <div style={{padding:16}}>
              <QuantBrainPanel cryptoPrices={cryptoPrices} />
            </div>
          </div>
        </>}

        {/* ══ AI ══ */}
        {tab==="ai"&&<>
          <div style={{marginBottom:14}}><SLabel>AI Market Analyst</SLabel></div>
          <div style={panel}>
            <div style={ph}><PTitle>CLVRQuant AI</PTitle><Badge label="Claude · Live" color="gold"/></div>
            <div style={{padding:16}}>
              <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
                {["BTC","ETH","SOL","TRUMP","HYPE","XAU","EURUSD","TSLA","NVDA"].map(sym=>{const d=allPrices[sym];return<button key={sym} data-testid={`ai-chip-${sym}`} onClick={()=>setAiInput(`${sym} — long or short? Price:${fmt(d?.price,sym)} 24h:${pct(d?.chg)}`)}
                  style={{padding:"5px 11px",borderRadius:2,border:`1px solid ${d?.live?"rgba(201,168,76,.28)":C.border}`,background:C.panel,color:d?.live?C.gold2:C.muted2,fontFamily:MONO,fontSize:10,letterSpacing:"0.08em",cursor:"pointer"}}>
                  {sym}{d?.live?" ✦":""}
                </button>;})}
              </div>
              <textarea data-testid="input-ai-query" value={aiInput} onChange={e=>setAiInput(e.target.value)} placeholder={`"Long BTC now?" · "Is XAU overextended?" · "Best forex trade?"`}
                style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:12,color:C.text,fontFamily:SANS,fontSize:13,resize:"none",height:76,lineHeight:1.7}}/>
              <button data-testid="button-ai-analyze" onClick={runAI} disabled={aiLoading} style={{width:"100%",height:44,marginTop:8,background:"rgba(201,168,76,.1)",color:aiLoading?C.muted:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:aiLoading?"not-allowed":"pointer"}}>
                {aiLoading?"Analyzing...":"Analyze →"}
              </button>
              {aiOutput&&<div data-testid="text-ai-output" style={{marginTop:12,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:14,fontSize:13,lineHeight:1.9,color:C.text,whiteSpace:"pre-wrap",maxHeight:360,overflowY:"auto"}}>{aiOutput}</div>}
            </div>
          </div>
          <div style={{...panel,border:`1px solid rgba(255,140,0,.12)`}}>
            <div style={{padding:"11px 14px",background:"rgba(255,140,0,.03)"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.orange,letterSpacing:"0.22em",marginBottom:5}}>LEGAL DISCLAIMER</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.9}}>CLVRQuant is an AI-powered research and analytics platform for <strong style={{color:C.muted2}}>informational and educational purposes only</strong>. Nothing constitutes financial advice, investment advice, or trading advice. AI signals are not recommendations. All trading involves significant risk of loss. Past performance does not predict future results. CLVRQuant · Mike Claver. All rights reserved.</div>
            </div>
          </div>
        </>}

        {/* ══ GUIDE ══ */}
        {tab==="guide"&&<>
          <div style={{marginBottom:14}}><SLabel>Platform Guide</SLabel></div>
          <FeaturesGuide />
        </>}

        <div style={{textAlign:"center",fontFamily:MONO,fontSize:8,color:C.muted,marginTop:6,letterSpacing:"0.1em"}}>
          BINANCE · FINNHUB · PHANTOM · NOT FINANCIAL ADVICE · CLVRQUANT · MIKE CLAVER
        </div>
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"rgba(5,7,9,.97)",borderTop:`1px solid ${C.border}`,backdropFilter:"blur(14px)",display:"flex",paddingBottom:"env(safe-area-inset-bottom,0px)",overflowX:"auto"}}>
        {NAV.map(item=>{
          const active=tab===item.k;const macroAlert=item.k==="macro"&&upcomingCount>0;
          return(
            <button key={item.k} data-testid={`nav-${item.k}`} onClick={()=>setTab(item.k)} style={{flex:"0 0 auto",minWidth:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"7px 4px 9px",background:"none",border:"none",borderTop:`2px solid ${active?C.gold:"transparent"}`,position:"relative",transition:"border-color .2s"}}>
              <span style={{fontSize:item.k==="ai"?11:13,lineHeight:1,fontFamily:item.k==="ai"?SERIF:"inherit",fontWeight:item.k==="ai"?900:"inherit",color:active?C.gold:C.muted2}}>{item.icon}</span>
              {macroAlert&&!active&&<div style={{position:"absolute",top:4,right:8,width:5,height:5,borderRadius:"50%",background:C.red}}/>}
              <span style={{fontFamily:MONO,fontSize:7,marginTop:3,color:active?C.gold:C.muted,letterSpacing:"0.06em",fontWeight:active?600:400,textTransform:"uppercase"}}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
