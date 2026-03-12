// ─────────────────────────────────────────────────────────
// CLVRQuant v2
// NEW: Macro countdown timers · Volume spike detector
//      Funding rate flip alerts · Liquidation heatmap
//      Push notifications · In-app alert banners
// Backend-proxied API calls (keys stored server-side)
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, memo } from "react";
import PhantomWalletPanel from "./PhantomWallet";
import WelcomePage from "./WelcomePage";
import AccountPage from "./AccountPage";
import QRScanner from "./QRScanner";

// ── WebAuthn helpers (Face ID setup after login) ───────────────────────────
const WA_STORE_KEY = "clvr_wa_cred";
function waSupported() { return !!(window.PublicKeyCredential && navigator.credentials?.create); }
function getStoredWACred() { try { return JSON.parse(localStorage.getItem(WA_STORE_KEY) || "null"); } catch { return null; } }
function storeWACred(credentialId, userId) { try { localStorage.setItem(WA_STORE_KEY, JSON.stringify({ credentialId, userId, registeredAt: Date.now() })); } catch {} }
function uint8ToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }

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

function isNYSEOpen(){
  const now=new Date();
  const et=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
  const day=et.getDay();
  if(day===0||day===6)return false;
  const h=et.getHours(),m=et.getMinutes();
  const mins=h*60+m;
  return mins>=570&&mins<960;
}
function isForexOpen(){
  const now=new Date();
  const et=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
  const day=et.getDay();
  const h=et.getHours();
  if(day===6)return false;
  if(day===0&&h<17)return false;
  if(day===5&&h>=17)return false;
  return true;
}
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

// ─── BINANCE WEBSOCKET SYMBOL MAP ────────────────────────
const BINANCE_WS_MAP={BTC:"btcusdt",ETH:"ethusdt",SOL:"solusdt",WIF:"wifusdt",DOGE:"dogeusdt",AVAX:"avaxusdt",LINK:"linkusdt",ARB:"arbusdt",PEPE:"pepeusdt",XRP:"xrpusdt",BNB:"bnbusdt",ADA:"adausdt",DOT:"dotusdt",MATIC:"maticusdt",UNI:"uniusdt",AAVE:"aaveusdt",NEAR:"nearusdt",SUI:"suiusdt",APT:"aptusdt",OP:"opusdt",TIA:"tiausdt",SEI:"seiusdt",JUP:"jupusdt",ONDO:"ondousdt",RENDER:"renderusdt",INJ:"injusdt",FET:"fetusdt",TAO:"taousdt",PENDLE:"pendleusdt",HBAR:"hbarusdt",TRUMP:"trumpusdt",HYPE:"hypeusdt"};
const BINANCE_REVERSE=Object.fromEntries(Object.entries(BINANCE_WS_MAP).map(([k,v])=>[v,k]));

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

// ─── NOTIFICATION MANAGER (Anti-Duplication) ─────────────
function createNotifHash(ts,asset,type){return`${Math.floor(ts/1000)}_${asset}_${type}`;}

// ─── i18n LABELS (EN/FR toggle) ──────────────────────────
const LANG_EN={stopLoss:"Stop Loss",target:"Target",entry:"Entry",approve:"Approve",cancel:"Cancel",riskTooHigh:"Risk Too High",capitalProtection:"Capital Protection",whaleAligned:"Whale Aligned",masterScore:"Master Score",tradeNow:"Trade Now",radar:"Radar",markets:"Markets",macro:"Macro",brief:"Brief",signals:"Signals",alerts:"Alerts",wallet:"Wallet",ai:"AI",about:"About",account:"Account",commandCenter:"Command Center",liveAlerts:"LIVE ALERTS",newsIntel:"LIVE NEWS INTELLIGENCE",nextMacro:"NEXT MACRO EVENT",upcoming:"UPCOMING EVENTS",volumeMonitor:"VOLUME MONITOR",fundingRates:"FUNDING RATES",liqHeatmap:"LIQUIDATION HEATMAP",allDataLive:"CLVRQuant v2 RADAR — ALL DATA LIVE",marketRegime:"MARKET REGIME",crashDetector:"CRASH DETECTOR",liquidityIndex:"GLOBAL LIQUIDITY INDEX",riskOn:"RISK ON",neutral:"NEUTRAL",riskOff:"RISK OFF",normal:"Normal",caution:"Caution",highRisk:"High Risk",crashWarning:"Crash Warning",expansion:"Expansion",contraction:"Contraction",score:"Score",probability:"Probability",mode:"Mode",lang:"EN"};
const LANG_FR={stopLoss:"Arrêt des Pertes",target:"Objectif",entry:"Entrée",approve:"Approuver",cancel:"Annuler",riskTooHigh:"Risque Trop Élevé",capitalProtection:"Protection du Capital",whaleAligned:"Alignement Smart Money",masterScore:"Score Maître",tradeNow:"Trader Maintenant",radar:"Radar",markets:"Marchés",macro:"Macro",brief:"Résumé",signals:"Signaux",alerts:"Alertes",wallet:"Portefeuille",ai:"IA",about:"À Propos",account:"Compte",commandCenter:"Centre de Commande",liveAlerts:"ALERTES EN DIRECT",newsIntel:"INTELLIGENCE NOUVELLES EN DIRECT",nextMacro:"PROCHAIN ÉVÉNEMENT MACRO",upcoming:"ÉVÉNEMENTS À VENIR",volumeMonitor:"MONITEUR DE VOLUME",fundingRates:"TAUX DE FINANCEMENT",liqHeatmap:"CARTE DE LIQUIDATION",allDataLive:"CLVRQuant v2 RADAR — DONNÉES EN DIRECT",marketRegime:"RÉGIME DE MARCHÉ",crashDetector:"DÉTECTEUR DE CRASH",liquidityIndex:"INDICE DE LIQUIDITÉ MONDIAL",riskOn:"RISQUE ON",neutral:"NEUTRE",riskOff:"RISQUE OFF",normal:"Normal",caution:"Prudence",highRisk:"Risque Élevé",crashWarning:"Alerte Crash",expansion:"Expansion",contraction:"Contraction",score:"Score",probability:"Probabilité",mode:"Mode",lang:"FR"};
function getLang(){try{return localStorage.getItem("clvr_lang")||"EN";}catch{return"EN";}}
function getI18n(lang){return lang==="FR"?LANG_FR:LANG_EN;}
let i18n=getI18n(getLang());

// ─── BULL PROBABILITY / STRENGTH METER ────────────────────
function bullProbability({priceMoveAbs,fundingRate,oiM,volumeMultiplier,dir,masterScore}){
  let prob=50;
  prob+=Math.min(priceMoveAbs*3,15);
  const fundingAligned=(dir==="LONG"&&fundingRate<0)||(dir==="SHORT"&&fundingRate>0);
  if(fundingAligned)prob+=10;else if(Math.abs(fundingRate)>0.03)prob-=8;
  if(oiM>500)prob+=8;else if(oiM>100)prob+=4;
  if(volumeMultiplier>2)prob+=7;else if(volumeMultiplier>1.5)prob+=3;
  if(masterScore)prob=(prob+masterScore)/2;
  return Math.max(5,Math.min(98,Math.round(prob)));
}

// ─── STRENGTH METER COMPONENT ─────────────────────────────
function StrengthMeter({value,C:_C}){
  const pct=Math.max(0,Math.min(100,value));
  const col=pct>=75?_C.green:pct>=55?_C.orange:_C.red;
  return(
    <div data-testid="strength-meter" style={{width:"100%",height:6,background:"rgba(255,255,255,.06)",borderRadius:1,overflow:"hidden",position:"relative"}}>
      <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${col}88,${col})`,borderRadius:1,transition:"width .8s ease"}}/>
      <div style={{position:"absolute",right:4,top:-12,fontFamily:MONO,fontSize:8,color:col,fontWeight:700}}>{pct}%</div>
    </div>
  );
}

// ─── TRADE CONFIRMATION MODAL ─────────────────────────────
function TradeConfirmationModal({sig,currentPrice,masterScore,riskOn,onApprove,onCancel,C:_C}){
  if(!sig)return null;
  const isLong=sig.dir==="LONG";
  const dirColor=isLong?_C.green:_C.red;
  const capitalProtected=masterScore<35;
  const slippage=currentPrice?(currentPrice*0.001).toFixed(sig.token==="BTC"?0:sig.token==="ETH"?1:4):"—";
  return(
    <div data-testid="trade-modal" style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onCancel}>
      <div style={{position:"absolute",inset:0,background:"rgba(5,7,9,.75)",backdropFilter:"blur(20px)"}}/>
      <div data-testid="trade-modal-content" onClick={e=>e.stopPropagation()} style={{position:"relative",background:"linear-gradient(135deg,rgba(12,18,32,.95),rgba(8,13,24,.98))",border:`1px solid ${_C.border2}`,borderRadius:6,maxWidth:400,width:"100%",overflow:"hidden",boxShadow:`0 24px 80px rgba(0,0,0,.6), 0 0 1px ${_C.gold}44`}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${_C.gold},transparent)`}}/>
        <div style={{padding:"20px 18px"}}>
          <div style={{fontFamily:MONO,fontSize:8,color:_C.gold,letterSpacing:"0.25em",marginBottom:8}}>TRADE CONFIRMATION</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:36,height:36,background:isLong?"rgba(0,199,135,.1)":"rgba(255,64,96,.1)",border:`1px solid ${dirColor}44`,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,fontWeight:900,fontSize:18,color:dirColor}}>{isLong?"+":"−"}</div>
            <div>
              <div style={{fontFamily:MONO,fontSize:18,fontWeight:800,color:_C.white}}>{sig.token}</div>
              <div style={{fontFamily:MONO,fontSize:10,color:dirColor,letterSpacing:"0.1em"}}>{sig.dir} · {sig.lev||"3x"}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              {l:i18n.entry,v:currentPrice?fmt(currentPrice,sig.token):"—",c:_C.white},
              {l:i18n.target+" (3× ATR)",v:sig.target?fmt(sig.target,sig.token):"—",c:_C.green},
              {l:i18n.stopLoss+" (1.5× ATR)",v:sig.stopLoss?fmt(sig.stopLoss,sig.token):"—",c:_C.red},
              {l:"Slippage Est.",v:slippage!=="—"?"~$"+slippage:"—",c:_C.muted2},
            ].map(({l,v,c})=>(
              <div key={l} style={{background:"rgba(0,0,0,.3)",border:`1px solid ${_C.border}`,borderRadius:2,padding:"8px 10px"}}>
                <div style={{fontFamily:MONO,fontSize:7,color:_C.muted,letterSpacing:"0.12em",marginBottom:3}}>{l}</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:c}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{background:"rgba(0,0,0,.2)",border:`1px solid ${_C.border}`,borderRadius:2,padding:"10px 12px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontFamily:MONO,fontSize:8,color:_C.gold,letterSpacing:"0.12em"}}>{i18n.capitalProtection}</span>
              <span style={{fontFamily:MONO,fontSize:10,color:capitalProtected?_C.red:_C.green,fontWeight:700}}>{capitalProtected?"⚠ "+i18n.riskTooHigh:"✓ SAFE"}</span>
            </div>
            <div style={{display:"flex",gap:12}}>
              <div><span style={{fontFamily:MONO,fontSize:8,color:_C.muted}}>{i18n.masterScore}: </span><span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:masterScore>=60?_C.green:masterScore>=40?_C.orange:_C.red}}>{masterScore||"—"}</span></div>
              <div><span style={{fontFamily:MONO,fontSize:8,color:_C.muted}}>Risk-On: </span><span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:riskOn>=60?_C.green:riskOn>=40?_C.orange:_C.red}}>{riskOn||50}%</span></div>
            </div>
          </div>
          {capitalProtected&&<div className="capital-protection-pulse" style={{padding:"8px 12px",borderRadius:2,marginBottom:14,textAlign:"center"}}>
            <span style={{fontFamily:MONO,fontSize:9,color:"#fff",fontWeight:700,letterSpacing:"0.1em"}}>{i18n.riskTooHigh} — {i18n.masterScore} &lt; 35%</span>
          </div>}
          <div style={{display:"flex",gap:8}}>
            <button data-testid="trade-approve" onClick={onApprove} disabled={capitalProtected}
              title={capitalProtected?i18n.riskTooHigh:""}
              style={{flex:1,padding:"12px",background:capitalProtected?"rgba(74,93,128,.1)":"rgba(201,168,76,.1)",border:`1px solid ${capitalProtected?_C.muted+"44":_C.gold+"55"}`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,color:capitalProtected?_C.muted:_C.gold2,cursor:capitalProtected?"not-allowed":"pointer",opacity:capitalProtected?.5:1}}>
              {capitalProtected?i18n.riskTooHigh:"Approve in Wallet →"}
            </button>
            <button data-testid="trade-cancel" onClick={onCancel}
              style={{padding:"12px 20px",background:_C.bg,border:`1px solid ${_C.border}`,borderRadius:2,fontFamily:MONO,fontSize:10,color:_C.muted2,cursor:"pointer",letterSpacing:"0.08em"}}>{i18n.cancel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ALERT BANNER ────────────────────────────────────────
function AlertBanner({alerts,onDismiss,C:_C}){
  if(!alerts||alerts.length===0)return null;
  const a=alerts[0];
  const tc={macro:{bg:"rgba(255,140,0,.12)",border:"rgba(255,140,0,.35)",icon:"!",color:_C.orange},volume:{bg:"rgba(0,212,255,.10)",border:"rgba(0,212,255,.35)",icon:"V",color:_C.cyan},funding:{bg:"rgba(0,199,135,.10)",border:"rgba(0,199,135,.35)",icon:"F",color:_C.green},liq:{bg:"rgba(255,64,96,.10)",border:"rgba(255,64,96,.35)",icon:"L",color:_C.red},price:{bg:"rgba(201,168,76,.10)",border:"rgba(201,168,76,.35)",icon:"P",color:_C.gold}}[a.type]||{bg:"rgba(201,168,76,.10)",border:"rgba(201,168,76,.35)",icon:"A",color:_C.gold};
  return(<div style={{position:"fixed",top:"env(safe-area-inset-top,0px)",left:0,right:0,zIndex:200,padding:"0 12px",maxWidth:640,margin:"0 auto"}}><div style={{background:tc.bg,border:`1px solid ${tc.border}`,borderTop:"none",borderRadius:"0 0 6px 6px",padding:"10px 14px",backdropFilter:"blur(16px)"}}><div style={{display:"flex",alignItems:"flex-start",gap:10}}><span style={{fontSize:14,flexShrink:0,marginTop:1,fontFamily:"'IBM Plex Mono',monospace",fontWeight:900,color:tc.color}}>{tc.icon}</span><div style={{flex:1}}><div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color:tc.color,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:3}}>{a.title}</div><div style={{fontFamily:"'Barlow',system-ui,sans-serif",fontSize:11,color:_C.text,lineHeight:1.6}}>{a.body}</div>{a.assets&&<div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{a.assets.map(sym=><span key={sym} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:tc.color,background:tc.bg,border:`1px solid ${tc.border}`,borderRadius:2,padding:"1px 6px"}}>{sym}</span>)}</div>}</div><button onClick={()=>onDismiss(a.id)} style={{background:"none",border:"none",color:_C.muted2,fontSize:18,cursor:"pointer",flexShrink:0,padding:0,lineHeight:1}}>x</button></div>{alerts.length>1&&<div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:7,color:_C.muted,marginTop:6,letterSpacing:"0.15em"}}>{alerts.length-1} MORE ALERT{alerts.length>2?"S":""}</div>}</div></div>);
}

// ─── COUNTDOWN TIMER ─────────────────────────────────────
function parseTimeET(timeStr){const tp=(timeStr||"12:00").match(/(\d+):(\d+)/);let h=tp?parseInt(tp[1]):12;const m=tp?parseInt(tp[2]):0;const isPM=timeStr&&timeStr.toLowerCase().includes("pm")&&h<12;if(isPM)h+=12;const isAM=timeStr&&timeStr.toLowerCase().includes("am")&&h===12;if(isAM)h=0;const isET=!timeStr||timeStr.includes("ET");return{h,m,offsetUTC:isET?5:0};}
function Countdown({dateStr,timeET,compact=false}){
  const[diff,setDiff]=useState(null);
  useEffect(()=>{
    const calc=()=>{const{h,m,offsetUTC}=parseTimeET(timeET);const[y,mo,d]=dateStr.split("-").map(Number);const target=new Date(Date.UTC(y,mo-1,d,h+offsetUTC,m,0));setDiff(target-new Date());};
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

// ─── QUANTBRAIN CONFLUENCE SCORER ────────────────────────
function scoreSignal({priceMoveAbs,direction,fundingRate,oiM,volumeMultiplier}){
  let score=0;const factors=[];
  const moveScore=Math.min(priceMoveAbs/5*20,20);score+=moveScore;
  factors.push({label:"Price Move",pts:+moveScore.toFixed(1),note:`${priceMoveAbs.toFixed(2)}% move`});
  const fundingAligned=(direction==="long"&&fundingRate<0)||(direction==="short"&&fundingRate>0);
  const fundingPts=fundingAligned?15:Math.abs(fundingRate)<0.005?5:0;score+=fundingPts;
  factors.push({label:"Funding Rate",pts:fundingPts,note:fundingAligned?"Aligned ✓":"Against signal"});
  const oiPts=oiM>500?15:oiM>100?10:oiM>20?6:2;score+=oiPts;
  factors.push({label:"Open Interest",pts:oiPts,note:`$${oiM}M OI`});
  const volPts=Math.min(volumeMultiplier*5,20);score+=volPts;
  factors.push({label:"Volume",pts:+volPts.toFixed(1),note:`${volumeMultiplier.toFixed(1)}x avg`});
  const momentumPts=priceMoveAbs>=3?15:priceMoveAbs>=2?10:priceMoveAbs>=1.5?7:3;score+=momentumPts;
  factors.push({label:"Momentum",pts:momentumPts,note:priceMoveAbs>=3?"Strong":"Moderate"});
  const total=Math.min(Math.round(score),100);
  return{total,factors};
}

// ─── SCORE RING ─────────────────────────────────────────
function ScoreRing({score,C:_C}){
  const color=score>=75?_C.green:score>=55?_C.orange:_C.red;
  const r=20,circ=2*Math.PI*r,dash=(score/100)*circ;
  return(
    <div style={{position:"relative",width:52,height:52,flexShrink:0}}>
      <svg width="52" height="52" style={{transform:"rotate(-90deg)"}}>
        <circle cx="26" cy="26" r={r} fill="none" stroke={_C.border} strokeWidth="4"/>
        <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1s ease"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color}}>{score}</div>
    </div>
  );
}

// ─── FACTOR BREAKDOWN ───────────────────────────────────
function FactorBreakdown({factors,score,C:_C}){
  return(
    <div style={{background:_C.bg,border:`1px solid ${_C.border}`,borderRadius:2,padding:14,marginTop:10}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:_C.muted,letterSpacing:"0.18em",marginBottom:10}}>QUANTBRAIN SCORE BREAKDOWN</div>
      {factors.map((f,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<factors.length-1?`1px solid ${_C.border}`:"none"}}>
          <div><span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:_C.muted2}}>{f.label}</span><span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:_C.muted,marginLeft:8}}>{f.note}</span></div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,color:f.pts>=10?_C.green:f.pts>=5?_C.orange:_C.red}}>+{typeof f.pts==="number"?f.pts.toFixed(0):f.pts}</div>
        </div>
      ))}
      <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${_C.border2}`,marginTop:4}}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,color:_C.white}}>Total Score</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:900,color:score>=75?_C.green:score>=55?_C.orange:_C.red}}>{score}/100</span>
      </div>
    </div>
  );
}

// ─── LAYOUT HELPERS (stable, outside Dashboard) ──────────
function SLabel({children}){
  return(
    <div style={{fontFamily:MONO,fontSize:10,letterSpacing:"0.25em",textTransform:"uppercase",color:C.gold,marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{flex:"0 0 24px",height:1,background:`linear-gradient(90deg,${C.gold},transparent)`,display:"inline-block"}}/>
      {children}
    </div>
  );
}
function PTitle({children}){return<span style={{fontFamily:SERIF,fontWeight:700,fontSize:15,color:C.white}}>{children}</span>;}
function SubBtn({k,label,col="gold",state,setter}){
  const active=state===k;
  const ac=col==="green"?C.green:col==="blue"?C.blue:col==="teal"?C.teal:col==="red"?C.red:col==="purple"?C.purple:col==="orange"?C.orange:col==="cyan"?C.cyan:C.gold;
  return<button onClick={()=>setter(k)} style={{padding:"6px 12px",borderRadius:2,whiteSpace:"nowrap",outline:"none",cursor:"pointer",fontFamily:MONO,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",border:`1px solid ${active?ac:C.border}`,background:active?"rgba(201,168,76,.07)":C.panel,color:active?ac:C.muted2,transition:"all .2s"}}>{label}</button>;
}
function LiveDot({live}){return<div style={{width:5,height:5,borderRadius:"50%",flexShrink:0,background:live?C.green:C.orange,boxShadow:live?`0 0 6px ${C.green}`:"none"}}/>;}
function ProGate({feature,isPro,onUpgrade,children}){
  if(isPro)return children;
  return(
    <div data-testid={`progate-${feature}`} style={{position:"relative"}}>
      <div style={{filter:"blur(4px)",opacity:0.3,pointerEvents:"none",maxHeight:180,overflow:"hidden"}}>{children}</div>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(5,7,9,.85)",backdropFilter:"blur(8px)",borderRadius:2}}>
        <div style={{fontFamily:SERIF,fontWeight:900,fontSize:16,color:C.gold2,marginBottom:4}}>Pro Feature</div>
        <div style={{fontFamily:MONO,fontSize:9,color:C.muted2,letterSpacing:"0.12em",marginBottom:12,textTransform:"uppercase"}}>{feature}</div>
        <button data-testid={`btn-upgrade-${feature}`} onClick={onUpgrade} style={{background:"rgba(201,168,76,.12)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"8px 20px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,cursor:"pointer"}}>Upgrade to Pro</button>
      </div>
    </div>
  );
}

// ─── AI INPUT (stable, memoized to prevent mobile keyboard retraction) ──
const AIInput=memo(function AIInput({value,onChange,placeholder}){
  const ref=useRef(null);
  useEffect(()=>{
    if(ref.current&&document.activeElement!==ref.current){
      ref.current.value=value;
    }
  },[value]);
  return<textarea ref={ref} data-testid="input-ai-query" defaultValue={value}
    onChange={e=>onChange(e.target.value)}
    placeholder={placeholder}
    style={{width:"100%",background:"rgba(12,18,32,1)",border:"1px solid #141e35",borderRadius:2,padding:12,color:"#c8d0e0",fontFamily:"'Barlow',sans-serif",fontSize:16,resize:"none",height:76,lineHeight:1.7}}/>;
});

// ─── BADGE ──────────────────────────────────────────────
function Badge({label,color="gold",style={}}){
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
}

// ─── PRICE ROW (Bloomberg-style tick arrows + flash) ──
function PriceRow({sym,d,extra,label,flash,onToggleWatch,watched,marketClosed}){
  if(!d)return null;
  const isUp=Number(d.chg)>=0;
  const tickUp=flash==="green";
  const tickDn=flash==="red";
  const priceColor=tickUp?C.green:tickDn?C.red:C.white;
  const arrow=tickUp?"↑":tickDn?"↓":"";
  return(
    <div data-testid={`price-row-${sym}`} style={{padding:"11px 14px",borderBottom:`1px solid ${C.border}`,
      background:tickUp?"rgba(0,199,135,.10)":tickDn?"rgba(255,64,96,.10)":"transparent",
      transition:"background .5s ease-out",
      display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:8,alignItems:"center"}}>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontFamily:MONO,fontWeight:600,fontSize:13,color:C.text,letterSpacing:"0.05em"}}>{sym}</span>
          {label&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>{label}</span>}
          <button onClick={()=>onToggleWatch(sym)} style={{background:"none",border:"none",cursor:"pointer",padding:"4px",fontSize:16,color:watched?C.gold:C.muted,opacity:watched?1:.3,transition:"all .2s",lineHeight:1}}>✦</button>
        </div>
        {extra&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>{extra}</div>}
      </div>
      <div style={{fontFamily:MONO,fontSize:14,fontWeight:600,color:priceColor,transition:"color .5s ease-out",display:"flex",alignItems:"center",gap:2}}>
        <span style={{fontSize:11,fontWeight:900,lineHeight:1,width:10,textAlign:"center",flexShrink:0}}>{arrow}</span>
        {fmt(d.price,sym)}
      </div>
      <div style={{fontFamily:MONO,fontSize:11,color:isUp?C.green:C.red,minWidth:50,textAlign:"right"}}>{pct(d.chg)}</div>
      {d.live?<Badge label="LIVE" color="green"/>:marketClosed?<Badge label="CLOSED" color="muted"/>:<Badge label="SIM" color="orange"/>}
    </div>
  );
}

// ─── SIGNAL CARD (stable, outside Dashboard to prevent unmount) ──
function SignalCard({sig,marketData,onShare,onAiAnalyze,onTrade,whaleAlerts:wAlerts}){
  const[expanded,setExpanded]=useState(false);
  const isLong=sig.dir==="LONG";
  const dirColor=isLong?C.green:C.red;
  const dirBg=isLong?"rgba(0,199,135,.06)":"rgba(255,64,96,.06)";
  const md=marketData[sig.token]||{};
  const priceMoveAbs=Math.abs(sig.pctMove||0);
  const fundingRate=md.funding||0;
  const oiM=md.oi?Math.round(md.oi/1e6):0;
  const vH=md.volHistory||[];const avgVol=vH.length>=3?vH.slice(-5).reduce((a,b)=>a+b,0)/Math.min(vH.length,5):0;
  const lastVol=vH[vH.length-1]||0;const volumeMultiplier=avgVol>0?lastVol/avgVol:1;
  const{total:qScore,factors}=scoreSignal({priceMoveAbs,direction:isLong?"long":"short",fundingRate,oiM,volumeMultiplier});
  const conviction=qScore>=75?"HIGH":qScore>=55?"MED":"LOW";
  const convColor=qScore>=75?C.green:qScore>=55?C.orange:C.red;
  const moveType=priceMoveAbs>=3?"MAJOR MOVE":priceMoveAbs>=2?"BREAKOUT":"MOMENTUM";
  const minutesAgo=sig.ts?Math.floor((Date.now()-sig.ts)/60000):0;
  const strength=bullProbability({priceMoveAbs,fundingRate,oiM,volumeMultiplier,dir:sig.dir,masterScore:sig.masterScore});
  const whaleMatch=wAlerts&&wAlerts.some(w=>w.sym===sig.token&&Math.abs(w.ts-sig.ts)<300000);
  const isHighConf=qScore>=75;
  return(
    <div data-testid={`signal-card-${sig.id}`} className={whaleMatch?"high-confidence-glow":""} style={{background:C.panel,border:`1px solid ${whaleMatch?C.gold+"88":isHighConf?`${dirColor}44`:C.border}`,borderRadius:2,marginBottom:10,overflow:"hidden",transition:"border-color .3s"}}>
      <div style={{padding:"14px 14px",cursor:"pointer"}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,background:dirBg,border:`1px solid ${dirColor}44`,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,fontFamily:MONO,color:dirColor,flexShrink:0}}>
            {isLong?"+":"\u2212"}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
              <span style={{fontFamily:MONO,fontSize:13,fontWeight:800,color:C.white,letterSpacing:"0.05em"}}>{sig.token}</span>
              <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:dirBg,color:dirColor,border:`1px solid ${dirColor}44`,fontFamily:MONO,letterSpacing:"0.1em"}}>{sig.dir}</span>
              {sig.real&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(0,199,135,.06)",color:C.green,border:"1px solid rgba(0,199,135,.25)",fontFamily:MONO,letterSpacing:"0.1em",animation:"pulse 2s infinite"}}>LIVE</span>}
              <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(201,168,76,.06)",color:C.gold,border:"1px solid rgba(201,168,76,.25)",fontFamily:MONO,letterSpacing:"0.1em"}}>ALPHA-DETECT</span>
              {whaleMatch&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(0,212,255,.08)",color:C.cyan,border:"1px solid rgba(0,212,255,.3)",fontFamily:MONO,letterSpacing:"0.08em",animation:"gold-pulse 2s infinite"}}>🐋 {i18n.whaleAligned}</span>}
              <span style={{fontFamily:MONO,fontSize:9,color:sig.pctMove>0?C.green:C.red,fontWeight:700}}>{sig.pctMove>0?"+":""}{sig.pctMove}%</span>
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{minutesAgo}m ago</span>
            </div>
            <div style={{fontFamily:SANS,fontSize:11,color:C.muted2,marginTop:5,lineHeight:1.55}}>{sig.desc}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:8,marginBottom:6}}>
              <div style={{background:"rgba(0,0,0,.2)",border:`1px solid ${C.border}`,borderRadius:2,padding:"5px 8px",textAlign:"center"}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.1em"}}>{i18n.entry}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.white}}>{sig.entry?fmt(sig.entry,sig.token):fmt(md.price,sig.token)}</div>
              </div>
              <div style={{background:"rgba(0,199,135,.04)",border:`1px solid rgba(0,199,135,.2)`,borderRadius:2,padding:"5px 8px",textAlign:"center"}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.green+"88",letterSpacing:"0.1em"}}>{i18n.target} 3×ATR</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.green}}>{sig.target?fmt(sig.target,sig.token):"—"}</div>
              </div>
              <div style={{background:"rgba(255,64,96,.04)",border:`1px solid rgba(255,64,96,.2)`,borderRadius:2,padding:"5px 8px",textAlign:"center"}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.red+"88",letterSpacing:"0.1em"}}>{i18n.stopLoss} 1.5×ATR</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.red}}>{sig.stopLoss?fmt(sig.stopLoss,sig.token):"—"}</div>
              </div>
            </div>
            <div style={{marginTop:4,marginBottom:6,paddingRight:56}}>
              <StrengthMeter value={strength} C={C}/>
            </div>
            <div style={{display:"flex",gap:4,marginTop:7,flexWrap:"wrap",alignItems:"center"}}>
              {sig.tags.map((tg,j)=><Badge key={j} label={tg.l} color={tg.c}/>)}
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.border}`,color:C.purple,fontFamily:MONO,letterSpacing:"0.08em"}}>{moveType}</span>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.border}`,color:C.muted2,fontFamily:MONO}}>{"\u2264"}{sig.lev}</span>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${convColor}44`,color:convColor,fontFamily:MONO,fontWeight:700}}>{conviction}</span>
              {volumeMultiplier>1.5&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.cyan}44`,color:C.cyan,fontFamily:MONO}}>Vol {volumeMultiplier.toFixed(1)}x</span>}
            </div>
          </div>
          <ScoreRing score={qScore} C={C}/>
        </div>
      </div>
      {expanded&&<div style={{padding:"0 14px 14px"}}>
        {sig.reasoning&&sig.reasoning.length>0&&<div style={{background:"rgba(201,168,76,.04)",border:`1px solid ${C.gold}22`,borderRadius:2,padding:"10px 12px",marginBottom:10}}>
          <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.15em",marginBottom:6}}>AI TRADE REASONING</div>
          {sig.reasoning.map((r,i)=><div key={i} style={{fontFamily:MONO,fontSize:10,color:C.muted2,lineHeight:1.7,display:"flex",gap:6,marginBottom:2}}><span style={{color:C.gold,flexShrink:0}}>•</span><span>{r}</span></div>)}
          {sig.masterScore&&<div style={{marginTop:6,fontFamily:MONO,fontSize:9,color:sig.masterScore>=60?C.green:sig.masterScore>=40?C.orange:C.red,fontWeight:700}}>{i18n.masterScore}: {sig.masterScore}/100 · Risk-On: {sig.riskOn||50}%</div>}
        </div>}
        <FactorBreakdown factors={factors} score={qScore} C={C}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:10}}>
          {[
            {l:"Funding",v:fundingRate!==0?(fundingRate>0?"+":"")+pct(fundingRate,4):"Neutral",c:fundingRate>0.02?C.red:fundingRate<-0.02?C.green:C.muted2},
            {l:"Open Interest",v:oiM>0?`$${oiM}M`:"N/A",c:oiM>100?C.green:C.muted2},
            {l:"Volume",v:volumeMultiplier>0?`${volumeMultiplier.toFixed(1)}x`:"N/A",c:volumeMultiplier>2?C.cyan:C.muted2},
          ].map(({l,v,c})=>(
            <div key={l} style={{background:C.bg,borderRadius:2,padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`}}>
              <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginBottom:3,letterSpacing:"0.1em"}}>{l}</div>
              <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8,marginTop:10}}>
          <button data-testid={`trade-now-${sig.id}`} onClick={e=>{e.stopPropagation();onTrade&&onTrade(sig);}}
            style={{flex:1,padding:"8px 0",background:"rgba(0,199,135,.08)",border:"1px solid rgba(0,199,135,.3)",borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:12,color:C.green,cursor:"pointer"}}>{i18n.tradeNow} →</button>
          <button data-testid={`ai-analyze-${sig.id}`} onClick={e=>{e.stopPropagation();onAiAnalyze(sig);}}
            style={{flex:1,padding:"8px 0",background:"rgba(201,168,76,.06)",border:"1px solid rgba(201,168,76,.25)",borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:12,color:C.gold2,cursor:"pointer"}}>Analyze with AI</button>
          <button data-testid={`share-signal-${sig.id}`} onClick={e=>{e.stopPropagation();onShare(sig);}}
            style={{padding:"8px 16px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:2,fontFamily:MONO,fontSize:10,color:C.muted2,cursor:"pointer",letterSpacing:"0.08em"}}>↗ Share</button>
        </div>
      </div>}
    </div>
  );
}

// ─── LIQUIDATION HEATMAP ─────────────────────────────────
function LiqHeatmap({sym,price,oi}){
  if(!price)return null;
  const step=sym==="BTC"?500:sym==="ETH"?50:sym==="SOL"?5:sym==="XAU"?20:null;
  if(!step)return null;
  const oiM=oi?(oi/1e6):0;
  const leverages=[5,10,15,20,25,50];
  const levels=[];
  leverages.forEach(lev=>{
    const liqUp=price*(1+1/lev);const liqDn=price*(1-1/lev);
    const roundUp=Math.round(liqUp/step)*step;const roundDn=Math.round(liqDn/step)*step;
    const distUp=Math.abs(roundUp-price)/price*100;const distDn=Math.abs(roundDn-price)/price*100;
    const weight=lev<=10?0.35:lev<=25?0.25:0.15;
    const sizeBase=oiM>0?oiM*weight:50*weight;
    if(distUp>0.2&&distUp<25&&!levels.find(l=>l.price===roundUp))levels.push({price:roundUp,size:Math.round(sizeBase*(lev<=10?1.8:lev<=25?1.2:0.6)),side:"short",dist:distUp,lev});
    if(distDn>0.2&&distDn<25&&!levels.find(l=>l.price===roundDn))levels.push({price:roundDn,size:Math.round(sizeBase*(lev<=10?1.8:lev<=25?1.2:0.6)),side:"long",dist:distDn,lev});
  });
  levels.sort((a,b)=>a.price-b.price);
  const above=levels.filter(l=>l.price>price).slice(0,5);
  const below=levels.filter(l=>l.price<price).reverse().slice(0,5);
  const maxSize=Math.max(...levels.map(l=>l.size),1);
  return(<div>
    {above.reverse().map(l=>(<div key={l.price} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{fontFamily:MONO,fontSize:10,color:C.red,width:68,textAlign:"right"}}>{fmt(l.price,sym)}</div><div style={{flex:1,position:"relative",height:14,background:"rgba(255,64,96,.06)",borderRadius:1}}><div style={{position:"absolute",right:0,top:0,bottom:0,width:`${(l.size/maxSize)*100}%`,background:`rgba(255,64,96,${0.15+l.size/maxSize*0.45})`,borderRadius:1}}/></div><div style={{fontFamily:MONO,fontSize:9,color:C.muted2,width:42}}>${l.size}M</div></div>))}
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,marginTop:2}}><div style={{fontFamily:MONO,fontSize:11,color:C.gold,width:68,textAlign:"right",fontWeight:700}}>{fmt(price,sym)}</div><div style={{flex:1,height:1,background:`linear-gradient(90deg,${C.gold},transparent)`}}/><div style={{fontFamily:MONO,fontSize:9,color:C.gold,width:42}}>NOW</div></div>
    {below.map(l=>(<div key={l.price} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{fontFamily:MONO,fontSize:10,color:C.green,width:68,textAlign:"right"}}>{fmt(l.price,sym)}</div><div style={{flex:1,position:"relative",height:14,background:"rgba(0,199,135,.06)",borderRadius:1}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${(l.size/maxSize)*100}%`,background:`rgba(0,199,135,${0.15+l.size/maxSize*0.45})`,borderRadius:1}}/></div><div style={{fontFamily:MONO,fontSize:9,color:C.muted2,width:42}}>${l.size}M</div></div>))}
    <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:6,borderTop:`1px solid ${C.border}`}}><div style={{fontFamily:MONO,fontSize:9,color:C.green}}>LONG LIQUIDATIONS</div><div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>Based on {oiM>0?`$${oiM.toFixed(0)}M OI`:"live OI"}</div><div style={{fontFamily:MONO,fontSize:9,color:C.red}}>SHORT LIQUIDATIONS</div></div>
  </div>);
}

// ─── MACRO EVENTS (frontend countdowns) ──────────────────
const MACRO_EVENTS=[];

// ─── MACRO EVENT CARD ────────────────────────────────────
function MacroCard({evt,imp,surprise,marketImpacts,bc,isToday,isLiveNow,status,onAskAI,onAddCal,onGoAI}){
  const [expanded,setExpanded]=useState(false);
  return(
    <div data-testid={`macro-card-${evt.id}`} style={{background:C.panel,border:`1px solid ${evt.released?(surprise?.color===C.red?C.red+"22":surprise?.color===C.green?C.green+"22":C.border):imp.color+"22"}`,borderRadius:2,marginBottom:8,overflow:"hidden",opacity:evt.released?1:0.88}}>
      <div style={{padding:"12px 14px",cursor:"pointer"}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
          <div style={{textAlign:"center",minWidth:40,flexShrink:0}}>
            <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:evt.released?C.muted:C.white}}>{(evt.timeET||evt.time||"").replace(" ET","")}</div>
            <div style={{fontSize:16,marginTop:2}}>{evt.flag||({"US":"\u{1F1FA}\u{1F1F8}","EU":"\u{1F1EA}\u{1F1FA}","UK":"\u{1F1EC}\u{1F1E7}","CA":"\u{1F1E8}\u{1F1E6}","JP":"\u{1F1EF}\u{1F1F5}","AU":"\u{1F1E6}\u{1F1FA}","CH":"\u{1F1E8}\u{1F1ED}","NZ":"\u{1F1F3}\u{1F1FF}"}[evt.country])||"\u{1F310}"}</div>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:4}}>
              <span style={{fontFamily:SERIF,fontSize:12,fontWeight:700,color:evt.released?C.muted2:C.white}}>{evt.name}</span>
              {isLiveNow&&<span style={{fontFamily:MONO,fontSize:7,background:"rgba(0,199,135,.12)",border:"1px solid rgba(0,199,135,.3)",color:C.green,borderRadius:2,padding:"1px 5px",fontWeight:700,letterSpacing:"0.1em",animation:"pulse 1.4s ease infinite"}}>LIVE NOW</span>}
              <span style={{fontFamily:MONO,fontSize:7,background:imp.bg,color:imp.color,border:`1px solid ${imp.color}33`,borderRadius:2,padding:"1px 5px",fontWeight:700,letterSpacing:"0.08em"}}>{imp.label}</span>
              {evt.released&&surprise&&<span style={{fontFamily:MONO,fontSize:7,background:"rgba(0,0,0,.3)",border:`1px solid ${surprise.color}33`,color:surprise.color,borderRadius:2,padding:"1px 5px",fontWeight:700}}>{surprise.label}</span>}
              {!evt.released&&<span style={{fontFamily:MONO,fontSize:7,color:C.muted,border:`1px solid ${C.border}`,borderRadius:2,padding:"1px 5px"}}>PENDING</span>}
              {isToday&&!isLiveNow&&<span style={{fontFamily:MONO,fontSize:7,color:C.red,border:`1px solid ${C.red}33`,borderRadius:2,padding:"1px 5px",animation:"pulse 1.4s ease infinite"}}>TODAY</span>}
              {evt.live&&<span style={{fontFamily:MONO,fontSize:7,color:C.green,border:`1px solid ${C.green}33`,borderRadius:2,padding:"1px 5px"}}>LIVE</span>}
            </div>
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginBottom:6}}>{evt.region||evt.country} · {evt.date}</div>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              {evt.actual&&<div><div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:1}}>ACTUAL</div><div style={{fontFamily:MONO,fontSize:15,fontWeight:800,color:surprise?.color||C.white}}>{evt.actual}<span style={{fontSize:8,color:C.muted,marginLeft:2}}>{evt.unit||""}</span></div></div>}
              <div><div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:1}}>FORECAST</div><div style={{fontFamily:MONO,fontSize:13,fontWeight:600,color:C.muted2}}>{evt.forecast}</div></div>
              <div><div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:1}}>PREVIOUS</div><div style={{fontFamily:MONO,fontSize:13,fontWeight:600,color:C.muted}}>{evt.previous||evt.current}</div></div>
            </div>
          </div>
          <div style={{color:C.muted,fontSize:12,flexShrink:0,marginTop:4,fontFamily:MONO}}>{expanded?"\u25B2":"\u25BC"}</div>
        </div>
      </div>
      {expanded&&(
        <div style={{padding:"0 14px 12px",borderTop:`1px solid ${C.border}`}}>
          <div style={{background:"rgba(0,0,0,.2)",border:`1px solid ${C.border}`,borderRadius:2,padding:"8px 12px",marginTop:10,marginBottom:8}}>
            <div style={{fontFamily:MONO,fontSize:7,color:C.gold,letterSpacing:"0.15em",marginBottom:4}}>QUANTBRAIN ANALYSIS</div>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted2,lineHeight:1.7}}>{evt.desc}</div>
          </div>
          {marketImpacts&&(
            <div style={{marginBottom:8}}>
              <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.15em",marginBottom:6}}>MARKET IMPACT</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                {marketImpacts.map((m,i)=>(
                  <div key={i} style={{background:"rgba(0,0,0,.2)",border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 9px"}}>
                    <div style={{fontFamily:MONO,fontSize:10,fontWeight:700,marginBottom:2,color:C.white}}>{m.asset} <span style={{color:m.color,fontSize:9}}>{m.dir}</span></div>
                    <div style={{fontFamily:MONO,fontSize:8,color:C.muted,lineHeight:1.4}}>{m.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:6}}>
            <button data-testid={`macro-ask-ai-${evt.id}`} onClick={onAskAI} style={{flex:1,background:"rgba(201,168,76,.08)",border:`1px solid ${C.gold}33`,color:C.gold2,borderRadius:2,padding:"7px",cursor:"pointer",fontFamily:MONO,fontWeight:700,fontSize:9,letterSpacing:"0.08em"}}>Ask QuantBrain</button>
            <button onClick={onAddCal} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted2,borderRadius:2,padding:"7px 10px",cursor:"pointer",fontFamily:MONO,fontSize:8,letterSpacing:"0.08em"}}>+ Cal</button>
            <button onClick={onGoAI} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted2,borderRadius:2,padding:"7px 10px",cursor:"pointer",fontFamily:MONO,fontSize:8,letterSpacing:"0.08em"}}>AI Tab</button>
          </div>
        </div>
      )}
    </div>
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
  const [user,setUser]=useState(null);

  if(!user) return <WelcomePage onEnter={setUser}/>;

  return <Dashboard user={user} setUser={setUser}/>;
}

function Dashboard({user,setUser}){
  const [tab,setTab]=useState("radar");
  const [priceTab,setPriceTab]=useState("crypto");
  const [sigSubTab,setSigSubTab]=useState("all");
  const [sigSort,setSigSort]=useState("recent");
  const [highConfOnly,setHighConfOnly]=useState(false);
  const [tradeModalSig,setTradeModalSig]=useState(null);
  const [whaleAlerts,setWhaleAlerts]=useState([]);
  const notifHashesRef=useRef(new Set());
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
  const [alerts,setAlerts]=useState([]);
  const alertsLoaded=useRef(false);
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
  const [aiTimeframe,setAiTimeframe]=useState("today");
  const idRef=useRef(300);
  useEffect(()=>{
    if(!user||alertsLoaded.current)return;
    alertsLoaded.current=true;
    const loadAlerts=()=>{
      fetch("/api/alerts").then(r=>{
        if(r.status===401){setTimeout(loadAlerts,1000);return null;}
        return r.ok?r.json():null;
      }).then(data=>{
        if(!data)return;
        const mapped=data.map(a=>({...a,threshold:Number(a.threshold)}));
        setAlerts(mapped);
        if(mapped.length>0)idRef.current=Math.max(...mapped.map(a=>a.id))+1;
      }).catch(()=>{});
    };
    setTimeout(loadAlerts,500);
  },[user]);
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

  const [userTier,setUserTier]=useState(()=>{try{return user?.tier||localStorage.getItem("clvr_tier")||"free";}catch{return"free";}});
  const [accessCodeInput,setAccessCodeInput]=useState("");
  const [accessCodeMsg,setAccessCodeMsg]=useState("");
  const [showQRScanner,setShowQRScanner]=useState(false);
  const [showUpgrade,setShowUpgrade]=useState(false);
  const [showBiometricSetup,setShowBiometricSetup]=useState(false);
  const [biometricRegistering,setBiometricRegistering]=useState(false);
  const [stripePrices,setStripePrices]=useState([]);
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const isPro=userTier==="pro";

  const [macroEvents,setMacroEvents]=useState([]);
  const [macroLoading,setMacroLoading]=useState(true);
  const [macroAiEvent,setMacroAiEvent]=useState(null);
  const [macroAiResp,setMacroAiResp]=useState(null);
  const [macroAiLoading,setMacroAiLoading]=useState(false);
  const [macroCalTab,setMacroCalTab]=useState("today");
  const [macroImpactFilter,setMacroImpactFilter]=useState("ALL");
  const [macroRegionFilter,setMacroRegionFilter]=useState("ALL");

  const [lang,setLang]=useState(getLang);
  const [regimeData,setRegimeData]=useState(null);
  const toggleLang=useCallback(()=>{
    setLang(prev=>{const nv=prev==="EN"?"FR":"EN";try{localStorage.setItem("clvr_lang",nv);}catch{}i18n=getI18n(nv);return nv;});
  },[]);

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
      setTimeout(()=>setFlashes(f=>{const n={...f};Object.keys(nF).forEach(k=>delete n[k]);return n;}),350);
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
    setTimeout(()=>setActiveAlerts(prev=>prev.filter(a=>a.id!==key)),5000);
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

  const macroEventsRef=useRef([]);
  useEffect(()=>{if(macroEvents.length>0){macroEventsRef.current=macroEvents.map(e=>({...e,timeET:e.timeET||e.time||"12:00",assets:e.assets||[],expectedMove:e.expectedMove||2}));}},[macroEvents]);

  const checkMacroCountdowns=useCallback(()=>{
    const now=new Date();
    macroEventsRef.current.forEach(evt=>{
      const timeStr=evt.timeET||evt.time||"12:00";const tp=timeStr.match(/(\d+):(\d+)/);let h=tp?parseInt(tp[1]):12;const m=tp?parseInt(tp[2]):0;const isPM=timeStr.toLowerCase().includes("pm")&&h<12;if(isPM)h+=12;const isET=timeStr.includes("ET");const[y,mo,d]=evt.date.split("-").map(Number);
      const target=new Date(Date.UTC(y,mo-1,d,isET?h+5:h,m,0));const diffMin=(target-now)/60000;
      [60,30,10,2].forEach(threshold=>{
        const key=`macro-${evt.id}-${threshold}`;
        if(!macroFired.current.has(key)&&diffMin<=threshold&&diffMin>threshold-0.6){
          macroFired.current.add(key);
          addAlert({type:"macro",title:`CLVRQuant · ${evt.bank}: ${evt.name} in ${threshold}min`,body:`${evt.assets?.join(", ")||""} expected to move ~${evt.expectedMove||2}%. Forecast: ${evt.forecast}. Position now.`,assets:evt.assets,id:key});
        }
      });
    });
  },[addAlert]);

  // ── Crypto Spot (Binance WebSocket — real-time) ─────
  const wsBuf=useRef({});
  const rafId=useRef(null);

  const flushWS=useCallback(()=>{
    const buf={...wsBuf.current};
    wsBuf.current={};
    rafId.current=null;
    if(!Object.keys(buf).length)return;
    setCryptoPrices(prev=>{
      const next={...prev};
      Object.entries(buf).forEach(([sym,price])=>{
        const base=CRYPTO_BASE[sym];
        const chg=base?+((price-base)/base*100).toFixed(2):0;
        next[sym]={...prev[sym],price,chg,live:true};
      });
      triggerFlashes(next);return next;
    });
    setHlStatus("live");
  },[triggerFlashes]);

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

  useEffect(()=>{
    doHL();
    let wsConnected=false;let lastMsg=0;
    const iv=setInterval(()=>{
      if(!wsConnected||(lastMsg&&Date.now()-lastMsg>10000)){wsConnected=false;doHL();}
    },2000);
    const streams=Object.values(BINANCE_WS_MAP).map(s=>s+"@trade").join("/");
    const url="wss://stream.binance.com:9443/stream?streams="+streams;
    let ws;let reconTimer;let retries=0;
    const connect=()=>{
      try{
        ws=new WebSocket(url);
        ws.onmessage=(e)=>{
          lastMsg=Date.now();
          try{
            const msg=JSON.parse(e.data);
            const d=msg.data;if(!d||!d.s)return;
            const sym=BINANCE_REVERSE[d.s.toLowerCase()];
            if(!sym)return;
            const price=parseFloat(d.p);
            if(!price||isNaN(price))return;
            wsBuf.current[sym]=price;
            if(!rafId.current)rafId.current=requestAnimationFrame(flushWS);
          }catch{}
        };
        ws.onopen=()=>{wsConnected=true;retries=0;lastMsg=Date.now();setHlStatus("live");};
        ws.onerror=()=>{};
        ws.onclose=()=>{wsConnected=false;retries++;if(retries<5)reconTimer=setTimeout(connect,3000*retries);};
      }catch{wsConnected=false;}
    };
    connect();
    return()=>{clearInterval(iv);clearTimeout(reconTimer);if(rafId.current)cancelAnimationFrame(rafId.current);try{ws.onclose=null;ws.close();}catch{}};
  },[doHL,flushWS]);

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
        if(data.whaleAlerts)setWhaleAlerts(data.whaleAlerts);
        if(data.signals&&data.signals.length>0){
          const newSigs=data.signals.filter(s=>!seenSigIds.current.has(s.id));
          if(newSigs.length>0){
            newSigs.forEach(s=>seenSigIds.current.add(s.id));
            setLiveSignals(prev=>[...newSigs,...prev].slice(0,50));
            setSigCount(c=>c+newSigs.length);
            setFlashSigId(newSigs[0].id);
            setTimeout(()=>setFlashSigId(null),3000);
            for(const s0 of newSigs){
              const nHash=createNotifHash(s0.ts,s0.token,s0.dir);
              if(!notifHashesRef.current.has(nHash)){
                notifHashesRef.current.add(nHash);
                if(notifHashesRef.current.size>50){const arr=[...notifHashesRef.current];notifHashesRef.current=new Set(arr.slice(-50));}
                try{if(typeof Notification!=="undefined"&&Notification.permission==="granted"){new Notification(`CLVRQuant · ${s0.token} ${s0.dir}`,{body:s0.desc});}}catch(e){}
                addAlert({type:"price",title:`CLVRQuant · ${s0.token} ${s0.dir}`,body:s0.desc,assets:[s0.token],id:`sig-${s0.id}`});
              }
            }
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
  useEffect(()=>{doFH();const iv=setInterval(doFH,60000);return()=>clearInterval(iv);},[doFH]);

  // ── SSE stream for real-time equity/commodity/forex (Finnhub WebSocket) ──
  const sseBuf=useRef({});
  const sseRaf=useRef(null);
  const flushSSE=useCallback(()=>{
    const buf={...sseBuf.current};sseBuf.current={};sseRaf.current=null;
    if(!Object.keys(buf).length)return;
    const eqU={},mtU={},fxU={};
    Object.entries(buf).forEach(([sym,d])=>{
      if(d.type==="equity")eqU[sym]={price:d.price,chg:d.chg,live:true};
      else if(d.type==="metal")mtU[sym]={price:d.price,chg:d.chg,live:true};
      else if(d.type==="forex")fxU[sym]={price:d.price,chg:d.chg,live:true};
    });
    if(Object.keys(eqU).length)setEquityPrices(prev=>{const n={...prev,...eqU};triggerFlashes(n);return n;});
    if(Object.keys(mtU).length)setMetalPrices(prev=>{const n={...prev,...mtU};triggerFlashes(n);return n;});
    if(Object.keys(fxU).length)setForexPrices(prev=>{const n={...prev,...fxU};triggerFlashes(n);return n;});
    setFhStatus("live");
  },[triggerFlashes]);

  useEffect(()=>{
    let es;let reconTimer;let retries=0;
    const connect=()=>{
      try{
        es=new EventSource("/api/stream");
        es.onmessage=(e)=>{
          try{
            const data=JSON.parse(e.data);
            if(!data||!Object.keys(data).length)return;
            Object.assign(sseBuf.current,data);
            if(!sseRaf.current)sseRaf.current=requestAnimationFrame(flushSSE);
          }catch{}
        };
        es.onopen=()=>{retries=0;};
        es.onerror=()=>{es.close();retries++;if(retries<10)reconTimer=setTimeout(connect,3000*Math.min(retries,5));};
      }catch{}
    };
    connect();
    return()=>{clearTimeout(reconTimer);if(sseRaf.current)cancelAnimationFrame(sseRaf.current);try{es.close();}catch{}};
  },[flushSSE]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const sessionId=params.get("session_id");
    const status=params.get("status");
    if(status==="success"&&sessionId){
      fetch(`/api/stripe/subscription?session_id=${sessionId}`).then(r=>r.json()).then(data=>{
        if(data.tier==="pro"){setUserTier("pro");try{localStorage.setItem("clvr_tier","pro");}catch{}setToast("✦ Welcome to CLVRQuant Pro!");}
      }).catch(()=>{});
      window.history.replaceState({},document.title,window.location.pathname);
    }
    if(status==="cancel"){setToast("Checkout cancelled");window.history.replaceState({},document.title,window.location.pathname);}
  },[]);

  useEffect(()=>{
    fetch("/api/stripe/products").then(r=>r.json()).then(data=>{
      if(Array.isArray(data))setStripePrices(data);
    }).catch(()=>{});
  },[]);

  const verifyAccessCode=useCallback(async(codeOverride)=>{
    const code=(codeOverride||accessCodeInput).trim();
    if(!code)return;
    if(codeOverride)setAccessCodeInput(codeOverride);
    try{
      const r=await fetch("/api/verify-code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
      const data=await r.json();
      if(data.valid){setUserTier("pro");try{localStorage.setItem("clvr_tier","pro");localStorage.setItem("clvr_code",code);}catch{}setAccessCodeMsg(`✦ ${data.label} — Pro access activated`);setToast("✦ Pro access activated!");}
      else{setAccessCodeMsg(data.error||"Invalid or expired code");}
    }catch{setAccessCodeMsg("Verification failed");}
  },[accessCodeInput]);

  // Show biometric setup prompt if WebAuthn is supported and no credential stored yet
  useEffect(()=>{
    if(!user||user?.guest)return;
    if(!waSupported()||getStoredWACred())return;
    const timer=setTimeout(()=>setShowBiometricSetup(true),2500);
    return()=>clearTimeout(timer);
  },[user]);

  // Register Face ID / biometric credential
  const registerBiometric=useCallback(async()=>{
    if(!user?.id)return;
    setBiometricRegistering(true);
    try{
      const challenge=new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userId=new TextEncoder().encode(user.id);
      const cred=await navigator.credentials.create({publicKey:{
        challenge,
        rp:{name:"CLVRQuant",id:window.location.hostname},
        user:{id:userId,name:user.email||user.username||"trader",displayName:user.name||"Trader"},
        pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
        authenticatorSelection:{userVerification:"preferred",residentKey:"discouraged"},
        timeout:60000,
        attestation:"none",
      }});
      if(!cred)throw new Error("Registration cancelled");
      const credentialId=uint8ToB64(cred.rawId);
      const r=await fetch("/api/auth/webauthn/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credentialId})});
      if(r.ok){storeWACred(credentialId,user.id);setToast("✦ Face ID enabled — next login is one tap");}
      else throw new Error("Server registration failed");
    }catch(e){
      const msg=e?.message||"";
      if(!msg.includes("cancel")&&!msg.includes("NotAllowed"))setToast("Biometric setup failed. Try again later.");
    }finally{setBiometricRegistering(false);setShowBiometricSetup(false);}
  },[user]);

  const handleCheckout=async(priceId)=>{
    setCheckoutLoading(true);
    try{
      const r=await fetch("/api/stripe/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({priceId})});
      const data=await r.json();
      if(data.url)window.location.href=data.url;
      else setToast("Checkout failed");
    }catch{setToast("Checkout error");}
    setCheckoutLoading(false);
  };

  // ── Macro calendar (auto-refresh every 60s) ─────────
  const fetchMacro=useCallback(()=>{
    fetch("/api/macro").then(r=>r.json()).then(data=>{
      if(Array.isArray(data)) setMacroEvents(data);
      setMacroLoading(false);
    }).catch(()=>setMacroLoading(false));
  },[]);
  useEffect(()=>{fetchMacro();const iv=setInterval(fetchMacro,60000);return()=>clearInterval(iv);},[fetchMacro]);

  const fetchRegime=useCallback(async()=>{
    try{const r=await fetch("/api/regime");if(r.ok){const d=await r.json();setRegimeData(d);}}catch{}
  },[]);
  useEffect(()=>{fetchRegime();const iv=setInterval(fetchRegime,60000);return()=>clearInterval(iv);},[fetchRegime]);

  const askMacroAI=async(evt)=>{
    setMacroAiEvent(evt);setMacroAiResp(null);setMacroAiLoading(true);
    try{
      const sys=`You are QuantBrain, an elite quantitative market intelligence analyst for CLVRQuant. Provide concise, data-driven analysis of economic releases. Focus on: 1) What the data means for markets, 2) Which assets are most affected, 3) How this changes the macro picture, 4) What to watch next. Be precise and use numbers.`;
      const msg=`Analyze this economic release:\n\nEvent: ${evt.name}\nCountry/Region: ${evt.region||evt.country}\nForecast: ${evt.forecast} ${evt.unit||""}\nPrevious: ${evt.previous||evt.current} ${evt.unit||""}\nActual: ${evt.actual||"Not yet released"} ${evt.unit||""}\nImpact Level: ${evt.impact}\nToday: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}\n\n${evt.actual?`The actual came in ${parseFloat(evt.actual)>parseFloat(evt.forecast)?"ABOVE":"BELOW"} expectations.`:"This event has not yet been released."}\n\nWhat does this mean for markets? Which assets move? What's the macro implication? What should I watch next?`;
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:msg})});
      const data=await res.json();
      setMacroAiResp(data.text||"No response.");
    }catch(e){setMacroAiResp("Error: "+(e.message||"Try again."));}
    setMacroAiLoading(false);
  };

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
        if(user&&a.id)fetch(`/api/alerts/${a.id}/trigger`,{method:"POST",credentials:"include"}).catch(()=>{});
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
    const macroSnap=macroEvents.length>0?`\nMACRO EVENTS (LIVE): ${macroEvents.slice(0,12).map(e=>`${e.date} ${e.timeET||e.time||""} ${e.region||e.country}: ${e.name} (${e.impact}) prev:${e.previous||e.current} fcast:${e.forecast}${e.actual?` ACTUAL:${e.actual} ${e.released?"RELEASED":""}`:""}`).join(" | ")}`:"";
    const prompt=`Generate a concise morning market brief for ${todayStr}. ALL data below is REAL and LIVE from exchanges:
CRYPTO: ${cryptoBrief}
EQUITIES: ${stockBrief}
COMMODITIES: ${metalBrief}
FOREX: ${fxBrief}${sigBrief}${macroSnap}${newsFeed.length>0?`\nNEWS HEADLINES: ${newsFeed.slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,60)}`).join(" | ")}`:""}
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
    const macroAiSnap=macroEvents.length>0?`\nMACRO EVENTS (LIVE): ${macroEvents.slice(0,12).map(e=>`${e.date} ${e.timeET||e.time||""} ${e.region||e.country}: ${e.name} (${e.impact}) prev:${e.previous||e.current} fcast:${e.forecast}${e.actual?` ACTUAL:${e.actual} ${e.released?"RELEASED":""}`:""}`).join(" | ")}`:"";
    const sys=`You are CLVRQuant, elite multi-market trading AI. All data below is REAL and LIVE from exchanges — use it for analysis. Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}.
CRYPTO (30 tokens): ${cryptoSnap}
EQUITIES (16 stocks): ${stockSnap}
COMMODITIES: ${metalSnap}
FOREX (14 pairs): ${fxSnap}${sigSnap}${newsSnap}${macroAiSnap}
When the user asks about a specific asset, reference its exact live price and change%. For trade setups: DIRECTION / ENTRY / STOP / TP1 / TP2 / LEVERAGE / CONVICTION / 2-line REASON. Be precise with numbers from the live data above. No disclaimers.`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:aiInput})});
      const data=await res.json();
      if(!res.ok){setAiOutput(data.error||`Error ${res.status}`);setAiLoading(false);return;}
      setAiOutput(data.text||"No response.");
    }catch(e){setAiOutput(`Error: ${e.message}`);}
    setAiLoading(false);
  };

  // ── Trade Ideas (QuantBrain integrated) ─────────────────
  const runTradeIdeas=async()=>{
    if(aiLoading)return;
    setAiLoading(true);setAiOutput("");
    const btc=cryptoPrices["BTC"]||{};
    const fundRate=btc.funding||0;
    const volH=btc.volHistory||[];const lastVol=volH[volH.length-1]||0;
    const avgVol=volH.length>=5?volH.slice(-5).reduce((a,b)=>a+b,0)/5:1;
    const volSpike=avgVol>0?lastVol/avgVol:1;
    const oiH=btc.oiHistory||[];
    const oiTrend=oiH.length>=2?(oiH[oiH.length-1]>oiH[oiH.length-2]*1.02?"rising":oiH[oiH.length-1]<oiH[oiH.length-2]*0.98?"falling":"flat"):"flat";
    let cScore=0;const bd=[];
    if(fundRate>0.01){cScore-=1;bd.push("Funding +"+fundRate.toFixed(4)+"% (longs crowded, -1)");}
    else if(fundRate<-0.01){cScore+=1;bd.push("Funding "+fundRate.toFixed(4)+"% (shorts crowded, +1)");}
    else bd.push("Funding neutral (0)");
    if(volSpike>=2){cScore+=1;bd.push("Volume "+volSpike.toFixed(1)+"x avg (momentum, +1)");}
    else bd.push("Volume "+volSpike.toFixed(1)+"x (no spike, 0)");
    if(oiTrend==="rising"){cScore+=1;bd.push("OI rising (new money, +1)");}
    else if(oiTrend==="falling"){cScore-=1;bd.push("OI falling (closing, -1)");}
    else bd.push("OI flat (0)");
    const regime=volSpike>=2&&oiTrend==="rising"?"MOMENTUM":"MEAN REVERSION";
    const prob=Math.max(5,Math.min(95,50+(cScore/8)*40));
    const kellyPct=Math.max(0,Math.min(25,(prob/100)-(1-prob/100)/2))*100;
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" LIVE":" est"}`:"n/a";};
    const cryptoSnap=CRYPTO_SYMS.map(s=>{const d=cryptoPrices[s];const f=d?.funding?` F:${pct(d.funding,4)}/8h`:"";const oi=d?.oi?` OI:$${(d.oi/1e6).toFixed(0)}M`:"";return`${s}:${snap(s,cryptoPrices)}${f}${oi}`;}).join(" | ");
    const stockSnap=EQUITY_SYMS.map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ");
    const metalSnap=METALS_SYMS.map(s=>`${METAL_LABELS[s]||s}:${snap(s,metalPrices)}`).join(" | ");
    const fxSnap=FOREX_SYMS.map(s=>`${FOREX_LABELS[s]||s}:${snap(s,forexPrices)}`).join(" | ");
    const sigSnap=liveSignals.length>0?`\nLIVE SIGNALS: ${liveSignals.slice(0,5).map(s=>`${s.token} ${s.dir} ${s.pctMove?s.pctMove+"%":""} — ${s.desc.substring(0,80)}`).join(" | ")}`:"";
    const newsSnap=newsFeed.length>0?`\nLATEST NEWS: ${newsFeed.slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,80)}`).join(" | ")}`:"";
    const sys=`You are QuantBrain — an elite quantitative trading analyst for CLVRQuant AI, built on the combined reasoning of the world's best statisticians, traders, mathematicians, and probability theorists.

Your thinking framework:
- Bayesian probability: continuously update beliefs as new signals arrive
- Kelly Criterion: size positions mathematically based on edge
- Regime detection: identify momentum vs mean reversion and adjust
- First-principles reasoning: derive correlations from current macro, not fixed rules
- Cross-asset thinking: consider how signals ripple across crypto, metals, forex, equities
- Expected value over prediction: find setups where the math favors participation

Today: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}

LIVE MARKET DATA:
CRYPTO (${CRYPTO_SYMS.length} tokens): ${cryptoSnap}
EQUITIES (${EQUITY_SYMS.length} stocks): ${stockSnap}
COMMODITIES: ${metalSnap}
FOREX (${FOREX_SYMS.length} pairs): ${fxSnap}${sigSnap}${newsSnap}

QUANTBRAIN CONFLUENCE ENGINE (auto-scored from live data):
Confluence Score: ${cScore > 0 ? "+" : ""}${cScore} / 8
Regime: ${regime}
Win Probability: ${prob.toFixed(1)}%
Kelly Fraction: ${kellyPct.toFixed(1)}%
Signal Breakdown:
${bd.map(b=>"- "+b).join("\n")}

Always structure your response with these EXACT sections:
1. REGIME ASSESSMENT
2. SIGNAL ANALYSIS (what the data is actually saying)
3. BAYESIAN PROBABILITY ESTIMATE (with reasoning)
4. TOP 3 TRADE IDEAS (derived from signals, not assumptions — consider all asset classes including commodities/oil)
5. CROSS-ASSET REASONING (which related assets are worth watching and WHY)
6. KELLY POSITION SIZING
7. RISK WARNING
8. VERDICT

For each trade idea use this format:
TRADE: [ASSET] [LONG/SHORT]
Entry: $X | Target: $X | Stop: $X
R/R: X:1 | Probability: X% | Kelly: X%
Rationale: [derive from current signals]
Related assets to watch: [reasoned from today's data]

Be precise, numerical, and ruthlessly honest. Use the EXACT live prices above.`;
    const tfLabel=aiTimeframe==="midterm"?"MID-TERM (1-4 week horizon)":aiTimeframe==="longterm"?"LONG-TERM (1-3 month horizon)":"TODAY'S (intraday/swing)";
    const tfHint=aiTimeframe==="midterm"?"Focus on weekly chart setups, sector rotation, macro trends. Entries can be scaled in. Use wider stops and targets appropriate for multi-week holds.":aiTimeframe==="longterm"?"Focus on monthly chart structures, macro regime shifts, secular trends, yield curves, commodity supercycles. Position sizing for multi-month conviction holds with wide stops.":"Focus on intraday and short-term swing setups. Use tight entries and stops based on current price action.";
    const userMsg=`Give me ${tfLabel} TOP 3 TRADE IDEAS with full quantitative analysis.

${tfHint}

Use the live market data and QuantBrain confluence score above. For each trade:
1. Specific entry, target, and stop loss based on current prices
2. Risk/reward ratio and probability estimate
3. Kelly-sized position recommendation
4. Cross-asset correlations worth monitoring
5. Key risk factors

Also provide an overall market regime assessment and your best risk-adjusted setup.`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:userMsg})});
      const data=await res.json();
      if(!res.ok){setAiOutput(data.error||`Error ${res.status}`);setAiLoading(false);return;}
      setAiOutput(data.text||"No response.");
    }catch(e){setAiOutput(`Error: ${e.message}`);}
    setAiLoading(false);
  };

  // ─── Style Helpers ─────────────────────────────────────

  const panel={background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const onUpgrade=useCallback(()=>setShowUpgrade(true),[]);



  const onShareSig=useCallback((sig)=>shareSignal(sig),[shareSignal]);
  const onAiSig=useCallback((sig)=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");},[]);
  const onAiChange=useCallback((v)=>setAiInput(v),[]);
  const openTradeModal=useCallback((sig)=>setTradeModalSig(sig),[]);

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

  const MACRO_FLAG={"US":"\u{1F1FA}\u{1F1F8}","EU":"\u{1F1EA}\u{1F1FA}","UK":"\u{1F1EC}\u{1F1E7}","CA":"\u{1F1E8}\u{1F1E6}","JP":"\u{1F1EF}\u{1F1F5}","CN":"\u{1F1E8}\u{1F1F3}","AU":"\u{1F1E6}\u{1F1FA}","CH":"\u{1F1E8}\u{1F1ED}","NZ":"\u{1F1F3}\u{1F1FF}"};
  const MACRO_IMPACT={HIGH:{color:C.red,bg:"rgba(255,64,96,.08)",label:"HIGH"},MED:{color:C.orange,bg:"rgba(245,158,11,.08)",label:"MED"},LOW:{color:C.green,bg:"rgba(0,199,135,.08)",label:"LOW"}};

  const parseMacroNum=(s)=>{if(!s||s==="—")return NaN;const str=String(s).trim();const m=str.match(/^([+-]?\d+\.?\d*)\s*([KMBkmb%]?)$/);if(!m)return parseFloat(str.replace(/[^0-9.-]/g,""));let n=parseFloat(m[1]);const u=m[2].toUpperCase();if(u==="K")n*=1000;if(u==="M")n*=1e6;if(u==="B")n*=1e9;return n;};
  const getMacroSurprise=(evt)=>{
    if(!evt.actual||!evt.forecast||evt.forecast==="—")return null;
    const a=parseMacroNum(evt.actual);
    const f=parseMacroNum(evt.forecast);
    if(isNaN(a)||isNaN(f))return null;
    const diff=a-f;
    const pctDiff=f!==0?Math.abs(diff/f)*100:Math.abs(diff);
    if(pctDiff<1&&Math.abs(diff)<0.05)return{label:"IN LINE",color:C.muted2};
    return diff>0?{label:`BEAT +${Math.abs(diff).toFixed(1)}`,color:C.green}:{label:`MISS ${diff.toFixed(1)}`,color:C.red};
  };

  const getMacroMarketImpact=(evt)=>{
    if(!evt.released||!evt.actual)return null;
    const impacts=[];const name=(evt.name||"").toLowerCase();
    if(name.includes("non-farm")||name.includes("nfp")||name.includes("employment change")){
      const actual=parseMacroNum(evt.actual);
      if(actual<0){
        impacts.push({asset:"USD",dir:"BEARISH",color:C.red,reason:"Jobs collapse = rate cut expectations surge"});
        impacts.push({asset:"XAU",dir:"BULLISH",color:C.green,reason:"Safe haven demand + rate cut tailwind"});
        impacts.push({asset:"BTC",dir:"CAUTIOUS",color:C.orange,reason:"Risk-off initially but rate cuts medium-term bullish"});
        impacts.push({asset:"SPX",dir:"BEARISH",color:C.red,reason:"Recession fears dominate"});
      }else{
        impacts.push({asset:"USD",dir:"BULLISH",color:C.green,reason:"Strong labor market supports USD"});
        impacts.push({asset:"XAU",dir:"BEARISH",color:C.red,reason:"Less safe-haven demand"});
      }
    }
    if(name.includes("gdp")){
      const actual=parseMacroNum(evt.actual);
      const forecast=parseMacroNum(evt.forecast);
      if(!isNaN(actual)&&!isNaN(forecast)){
        impacts.push({asset:evt.currency||"USD",dir:actual<forecast?"BEARISH":"BULLISH",color:actual<forecast?C.red:C.green,reason:actual<forecast?"Below forecast GDP = weakness":"Above forecast GDP = strength"});
      }
    }
    if(name.includes("cpi")||name.includes("inflation")){
      const actual=parseMacroNum(evt.actual);
      const forecast=parseMacroNum(evt.forecast);
      if(!isNaN(actual)&&!isNaN(forecast)){
        impacts.push({asset:"USD",dir:actual>forecast?"BULLISH":"BEARISH",color:actual>forecast?C.green:C.red,reason:actual>forecast?"Hot inflation = hawkish Fed":"Cool inflation = dovish Fed"});
        impacts.push({asset:"XAU",dir:actual>forecast?"BEARISH":"BULLISH",color:actual>forecast?C.red:C.green,reason:actual>forecast?"Higher rates weigh on gold":"Lower rates support gold"});
      }
    }
    if(name.includes("earnings")||name.includes("wages")){
      impacts.push({asset:"USD",dir:"MIXED",color:C.orange,reason:"Hot wages = sticky inflation, limits Fed cuts"});
    }
    if(name.includes("retail sales")){
      const actual=parseMacroNum(evt.actual);
      if(!isNaN(actual)){
        impacts.push({asset:"USD",dir:actual<0?"BEARISH":"BULLISH",color:actual<0?C.red:C.green,reason:actual<0?"Weak consumer spending = recession risk":"Strong consumer spending"});
      }
    }
    return impacts.length>0?impacts:null;
  };

  const macroTodayStr=new Date().toDateString();
  const macroTodayEvents=macroEvents.filter(e=>new Date(e.date).toDateString()===macroTodayStr);
  const macroWeekEnd=new Date();macroWeekEnd.setDate(macroWeekEnd.getDate()+(7-macroWeekEnd.getDay()));macroWeekEnd.setHours(23,59,59,999);
  const macroWeekEvents=macroEvents.filter(e=>{const d=new Date(e.date);return d>=new Date(new Date().toDateString())&&d<=macroWeekEnd;});
  const macroAllFiltered=(macroCalTab==="today"?macroTodayEvents:macroWeekEvents)
    .filter(e=>macroRegionFilter==="ALL"||(e.country||"").toUpperCase()===macroRegionFilter)
    .filter(e=>macroImpactFilter==="ALL"||e.impact===macroImpactFilter)
    .sort((a,b)=>{const da=new Date(a.date).getTime();const db=new Date(b.date).getTime();if(da!==db)return da-db;const ta=a.timeET||a.time||"00:00";const tb=b.timeET||b.time||"00:00";return ta.localeCompare(tb);});
  const macroReleasedCount=macroAllFiltered.filter(e=>e.released).length;
  const macroPendingCount=macroAllFiltered.filter(e=>!e.released).length;
  const macroHighCount=macroAllFiltered.filter(e=>e.impact==="HIGH").length;
  const macroSortedForNext=[...macroEvents].filter(e=>!e.released&&new Date(e.date)>=new Date(new Date().toDateString())).sort((a,b)=>{const da=new Date(a.date).getTime()-new Date(b.date).getTime();if(da!==0)return da;return(a.timeET||a.time||"00:00").localeCompare(b.timeET||b.time||"00:00");});
  const macroNextPending=macroSortedForNext[0]||null;

  const requestPush=async()=>{if(typeof Notification!=="undefined"){try{const p=await Notification.requestPermission();setNotifPerm(p);if(p==="granted"){setToast("Alerts enabled (browser + in-app)");return;}}catch(e){}}setNotifPerm("granted");setToast("In-app alerts enabled");};

  const todayDate=new Date();
  const nextEvents=macroEvents.map(e=>{const timeStr=e.timeET||e.time||"12:00";const timeParts=timeStr.match(/(\d+):(\d+)/);const h=timeParts?parseInt(timeParts[1]):12;const m=timeParts?parseInt(timeParts[2]):0;const isET=timeStr.includes("ET");const[y,mo,d]=e.date.split("-").map(Number);const t=new Date(Date.UTC(y,mo-1,d,isET?h+5:h,m,0));return{...e,timeET:timeStr,target:t,diffMs:t-todayDate};}).filter(e=>e.diffMs>0).sort((a,b)=>a.diffMs-b.diffMs);
  const macroBankColor={FED:C.blue,ECB:C.purple,BOJ:C.teal,BOC:C.gold,BOE:C.green,RBA:C.cyan,"US CPI":C.orange,NFP:C.red,PCE:C.orange};

  const isGuest=!!user?.guest;
  const GUEST_TABS=["radar","prices","macro","about"];
  const NAV_ALL=[
    {k:"radar",icon:"📡",label:i18n.radar},
    {k:"prices",icon:"💹",label:i18n.markets},
    {k:"macro",icon:"🏦",label:i18n.macro},
    {k:"brief",icon:"📰",label:i18n.brief},
    {k:"signals",icon:"⚡",label:i18n.signals},
    {k:"alerts",icon:"🔔",label:i18n.alerts},
    {k:"wallet",icon:"👛",label:i18n.wallet},
    {k:"ai",icon:"✦",label:i18n.ai},
    {k:"about",icon:"📖",label:i18n.about},
    {k:"account",icon:"⚙",label:i18n.account},
  ];
  const NAV=isGuest?NAV_ALL.filter(n=>GUEST_TABS.includes(n.k)):NAV_ALL;

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
        @keyframes gold-pulse{0%,100%{box-shadow:0 0 4px rgba(245,158,11,.2)}50%{box-shadow:0 0 16px rgba(245,158,11,.4),0 0 32px rgba(245,158,11,.15)}}
        .high-confidence-glow{border:1px solid #F59E0B !important;animation:gold-pulse 2s infinite;}
        .capital-protection-pulse{background:linear-gradient(90deg,rgba(255,45,85,.15),rgba(245,158,11,.15));animation:cap-pulse 1.5s infinite;}
        @keyframes cap-pulse{0%,100%{opacity:.7}50%{opacity:1}}
      `}</style>

      {/* QR Scanner overlay */}
      {showQRScanner&&<QRScanner onScan={async(raw)=>{setShowQRScanner(false);const code=raw.trim().toUpperCase();await verifyAccessCode(code);}} onClose={()=>setShowQRScanner(false)}/>}

      {/* Face ID / Biometric setup prompt */}
      {showBiometricSetup&&<div style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,.88)",backdropFilter:"blur(16px)",display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 40px"}}>
        <div style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:12,maxWidth:380,width:"100%",padding:"24px 20px",margin:"0 16px",position:"relative"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`,borderRadius:"12px 12px 0 0"}}/>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:42,marginBottom:8}}>🔒</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:18,color:C.gold2,marginBottom:4}}>Enable Face ID</div>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted,lineHeight:1.7,letterSpacing:"0.05em"}}>Sign in instantly on future visits.<br/>No password required.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button data-testid="btn-enable-faceid" onClick={registerBiometric} disabled={biometricRegistering} style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:8,padding:"13px 16px",fontFamily:MONO,fontSize:11,color:C.gold2,cursor:biometricRegistering?"not-allowed":"pointer",letterSpacing:"0.1em",opacity:biometricRegistering?0.6:1}}>
              {biometricRegistering?"Setting up...":"Enable Face ID / Biometric →"}
            </button>
            <button data-testid="btn-skip-faceid" onClick={()=>setShowBiometricSetup(false)} style={{background:"none",border:"none",fontFamily:MONO,fontSize:9,color:C.muted,cursor:"pointer",letterSpacing:"0.08em",padding:"8px 0"}}>
              Not now
            </button>
          </div>
        </div>
      </div>}

      {activeAlerts.length>0&&<div style={{animation:"slideDown .3s ease"}}><AlertBanner alerts={activeAlerts} onDismiss={dismissAlert} C={C}/></div>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
      {tradeModalSig&&<TradeConfirmationModal sig={tradeModalSig} currentPrice={(cryptoPrices[tradeModalSig.token]||{}).price} masterScore={tradeModalSig.masterScore||50} riskOn={tradeModalSig.riskOn||50} onApprove={()=>{setToast(`Trade approved: ${tradeModalSig.token} ${tradeModalSig.dir}`);setTradeModalSig(null);}} onCancel={()=>setTradeModalSig(null)} C={C}/>}

      {showUpgrade&&<div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,.85)",backdropFilter:"blur(12px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowUpgrade(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:4,maxWidth:420,width:"100%",maxHeight:"90vh",overflowY:"auto",position:"relative"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
          <div style={{padding:"22px 20px",textAlign:"center"}}>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:24,color:C.gold2,marginBottom:2}}>CLVRQuant Pro</div>
            <div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.2em",marginBottom:16}}>UNLOCK FULL INTELLIGENCE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16,textAlign:"left"}}>
              {["AI Market Analyst","QuantBrain Trade Ideas","Morning Briefs","Unlimited Alerts","Live Signals","Liquidation Heatmap","Volume Spike Monitor","Funding Rate Monitor"].map(f=>(
                <div key={f} style={{fontFamily:MONO,fontSize:9,color:C.text,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:C.gold,fontSize:10}}>✦</span>{f}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {(()=>{
                const monthlyPrice=stripePrices.find(p=>p.interval==="month");
                const yearlyPrice=stripePrices.find(p=>p.interval==="year");
                const pricesReady=monthlyPrice&&yearlyPrice;
                return<>
                  <button data-testid="btn-checkout-monthly" onClick={()=>pricesReady?handleCheckout(monthlyPrice.price_id):setToast("Prices loading, try again in a moment")} disabled={checkoutLoading} style={{flex:1,padding:"14px 12px",background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,cursor:checkoutLoading?"not-allowed":"pointer"}}>
                    <div style={{fontFamily:SERIF,fontWeight:900,fontSize:22,color:C.gold2}}>$29</div>
                    <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em"}}>PER MONTH</div>
                  </button>
                  <button data-testid="btn-checkout-yearly" onClick={()=>pricesReady?handleCheckout(yearlyPrice.price_id):setToast("Prices loading, try again in a moment")} disabled={checkoutLoading} style={{flex:1,padding:"14px 12px",background:"rgba(0,199,135,.06)",border:`1px solid rgba(0,199,135,.3)`,borderRadius:2,cursor:checkoutLoading?"not-allowed":"pointer",position:"relative"}}>
                    <div style={{position:"absolute",top:-8,right:8,fontFamily:MONO,fontSize:7,color:C.bg,background:C.green,padding:"2px 8px",borderRadius:2,fontWeight:700}}>SAVE 43%</div>
                    <div style={{fontFamily:SERIF,fontWeight:900,fontSize:22,color:C.green}}>$199</div>
                    <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em"}}>PER YEAR</div>
                  </button>
                </>;
              })()}
            </div>
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
              <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em",marginBottom:8}}>HAVE AN ACCESS CODE?</div>
              <div style={{display:"flex",gap:6}}>
                <button data-testid="btn-scan-qr" onClick={()=>setShowQRScanner(true)} title="Scan QR code" style={{background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:2,padding:"8px 10px",cursor:"pointer",fontSize:15,display:"flex",alignItems:"center"}}>📷</button>
                <input data-testid="input-access-code" value={accessCodeInput} onChange={e=>setAccessCodeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&verifyAccessCode()} placeholder="CLVR-VIP-XXXX or CLVR-FF-XXXX" style={{flex:1,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"8px 10px",color:C.text,fontFamily:MONO,fontSize:10}}/>
                <button data-testid="btn-verify-code" onClick={()=>verifyAccessCode()} style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,padding:"8px 14px",fontFamily:MONO,fontSize:9,color:C.gold,cursor:"pointer",letterSpacing:"0.1em"}}>VERIFY</button>
              </div>
              {accessCodeMsg&&<div style={{fontFamily:MONO,fontSize:9,color:accessCodeMsg.includes("✦")?C.green:C.red,marginTop:6}}>{accessCodeMsg}</div>}
            </div>
            <button onClick={()=>setShowUpgrade(false)} style={{marginTop:14,background:"none",border:"none",color:C.muted,fontFamily:MONO,fontSize:9,cursor:"pointer",letterSpacing:"0.1em"}}>CLOSE</button>
          </div>
        </div>
      </div>}

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
            {isPro?<div data-testid="badge-pro" style={{background:"rgba(201,168,76,.12)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"3px 8px",fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.15em",fontWeight:700}}>PRO</div>
            :<button data-testid="btn-upgrade-header" onClick={()=>setShowUpgrade(true)} style={{background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,padding:"3px 8px",fontFamily:MONO,fontSize:8,color:C.gold2,letterSpacing:"0.1em",cursor:"pointer",fontWeight:600}}>UPGRADE</button>}
            <button data-testid="btn-lang-toggle" onClick={toggleLang} style={{background:"rgba(201,168,76,.06)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:2,padding:"3px 7px",fontFamily:MONO,fontSize:8,color:C.gold,cursor:"pointer",letterSpacing:"0.1em",fontWeight:700}}>{lang==="EN"?"FR":"EN"}</button>
            <button data-testid="btn-signout" onClick={async()=>{try{await fetch("/api/auth/signout",{method:"POST"});}catch(e){}try{localStorage.removeItem("clvr_tier");localStorage.removeItem("clvr_code");}catch(e){}setUser(null);}} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:2,padding:"3px 6px",fontFamily:MONO,fontSize:8,color:C.muted,cursor:"pointer",letterSpacing:"0.08em"}}>OUT</button>
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
          {["BTC","ETH","SOL","XAU","WTI","EURUSD","TSLA","NVDA"].map(sym=>{
            const d=allPrices[sym],flash=flashes[sym];const isUp=Number(d?.chg)>=0;
            return(
              <div key={sym} data-testid={`ticker-${sym}`} onClick={()=>{setAiInput(`${sym} — long or short right now?`);setTab("ai");}}
                style={{background:flash==="green"?"rgba(0,199,135,.08)":flash==="red"?"rgba(255,64,96,.06)":C.panel,
                  border:`1px solid ${d?.live?"rgba(201,168,76,.18)":C.border}`,borderRadius:2,padding:"5px 9px",flexShrink:0,cursor:"pointer",minWidth:64,transition:"background .35s"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:d?.live?C.gold:C.muted,letterSpacing:"0.08em"}}>{sym}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .5s ease-out",marginTop:1,display:"flex",alignItems:"center",gap:2}}>{flash==="green"?"↑":flash==="red"?"↓":""}{fmt(d?.price,sym)}</div>
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
          <div style={{marginBottom:14}}><SLabel>{i18n.commandCenter}</SLabel></div>

          {regimeData&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div data-testid="panel-regime" style={{background:C.panel,border:`1px solid ${regimeData.regime?.regime==="RISK_ON"?C.green+"44":regimeData.regime?.regime==="RISK_OFF"?C.red+"44":C.border}`,borderRadius:4,padding:"12px",gridColumn:"1 / -1"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.15em"}}>{i18n.marketRegime}</div>
                <div data-testid="badge-regime" style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:2,
                  background:regimeData.regime?.regime==="RISK_ON"?"rgba(0,199,135,.12)":regimeData.regime?.regime==="RISK_OFF"?"rgba(255,64,96,.12)":"rgba(201,168,76,.12)",
                  color:regimeData.regime?.regime==="RISK_ON"?C.green:regimeData.regime?.regime==="RISK_OFF"?C.red:C.gold,
                  border:`1px solid ${regimeData.regime?.regime==="RISK_ON"?C.green+"44":regimeData.regime?.regime==="RISK_OFF"?C.red+"44":C.gold+"44"}`,
                  letterSpacing:"0.1em"}}>{regimeData.regime?.regime==="RISK_ON"?i18n.riskOn:regimeData.regime?.regime==="RISK_OFF"?i18n.riskOff:i18n.neutral}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{i18n.score}</div>
                <div style={{flex:1,height:6,background:"rgba(20,30,53,.8)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${regimeData.regime?.score||50}%`,borderRadius:3,
                    background:regimeData.regime?.regime==="RISK_ON"?C.green:regimeData.regime?.regime==="RISK_OFF"?C.red:C.gold,
                    transition:"width .5s"}}/>
                </div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.white,minWidth:28,textAlign:"right"}}>{regimeData.regime?.score||50}</div>
              </div>
              {regimeData.regime?.components&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {Object.entries(regimeData.regime.components).map(([k,v])=>{
                  const sc=typeof v==="object"&&v!==null?v.score:v;
                  const w=typeof v==="object"&&v!==null?v.weight:"";
                  return(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0"}}>
                    <span style={{fontFamily:MONO,fontSize:8,color:C.muted,textTransform:"uppercase"}}>{k} {w&&<span style={{color:C.muted+"88",fontSize:7}}>{w}</span>}</span>
                    <span style={{fontFamily:MONO,fontSize:9,color:sc>60?C.green:sc<40?C.red:C.gold,fontWeight:600}}>{typeof sc==="number"?sc.toFixed(0):sc}</span>
                  </div>);
                })}
              </div>}
            </div>

            <div data-testid="panel-crash" style={{background:C.panel,border:`1px solid ${(regimeData.crash?.probability||0)>60?C.red+"44":C.border}`,borderRadius:4,padding:"12px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.red,letterSpacing:"0.15em",marginBottom:8}}>{i18n.crashDetector}</div>
              <div style={{fontFamily:MONO,fontSize:22,fontWeight:900,color:(regimeData.crash?.probability||0)>60?C.red:(regimeData.crash?.probability||0)>40?C.orange:C.green,marginBottom:4,textAlign:"center"}}>
                {(regimeData.crash?.probability||0).toFixed(0)}%
              </div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted,textAlign:"center",marginBottom:6}}>{i18n.probability}</div>
              <div data-testid="badge-crash-status" style={{textAlign:"center",fontFamily:MONO,fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:2,display:"inline-block",width:"100%",
                background:(regimeData.crash?.probability||0)>80?"rgba(255,64,96,.15)":(regimeData.crash?.probability||0)>60?"rgba(255,140,0,.12)":(regimeData.crash?.probability||0)>40?"rgba(201,168,76,.12)":"rgba(0,199,135,.12)",
                color:(regimeData.crash?.probability||0)>80?C.red:(regimeData.crash?.probability||0)>60?C.orange:(regimeData.crash?.probability||0)>40?C.gold:C.green}}>
                {(regimeData.crash?.probability||0)>80?i18n.crashWarning:(regimeData.crash?.probability||0)>60?i18n.highRisk:(regimeData.crash?.probability||0)>40?i18n.caution:i18n.normal}
              </div>
            </div>

            <div data-testid="panel-liquidity" style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"12px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.cyan,letterSpacing:"0.15em",marginBottom:8}}>{i18n.liquidityIndex}</div>
              <div style={{fontFamily:MONO,fontSize:22,fontWeight:900,color:C.white,marginBottom:4,textAlign:"center"}}>
                {(regimeData.liquidity?.score||50).toFixed(0)}
              </div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted,textAlign:"center",marginBottom:6}}>{i18n.score} / 100</div>
              <div data-testid="badge-liquidity-mode" style={{textAlign:"center",fontFamily:MONO,fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:2,width:"100%",
                background:regimeData.liquidity?.mode==="LIQUIDITY_EXPANSION"?"rgba(0,199,135,.12)":regimeData.liquidity?.mode==="LIQUIDITY_CONTRACTION"?"rgba(255,64,96,.12)":"rgba(201,168,76,.12)",
                color:regimeData.liquidity?.mode==="LIQUIDITY_EXPANSION"?C.green:regimeData.liquidity?.mode==="LIQUIDITY_CONTRACTION"?C.red:C.gold}}>
                {regimeData.liquidity?.mode==="LIQUIDITY_EXPANSION"?i18n.expansion:regimeData.liquidity?.mode==="LIQUIDITY_CONTRACTION"?i18n.contraction:i18n.neutral}
              </div>
            </div>
          </div>
          </>}

          {notifPerm!=="granted"&&<div data-testid="push-prompt" style={{background:"rgba(201,168,76,.06)",border:`1px solid ${C.border}`,borderRadius:4,padding:"14px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:MONO,fontSize:20,color:C.gold}}>!</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:3}}>{i18n.liveAlerts}</div>
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
              <div style={{fontFamily:MONO,fontSize:10,color:C.blue,letterSpacing:"0.15em"}}>{i18n.newsIntel}</div>
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
            <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:10}}>{i18n.nextMacro}</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:16,color:C.text,marginBottom:3}}>{nextEvents[0].bank}: {nextEvents[0].name}</div>
            <div style={{fontFamily:MONO,fontSize:11,color:C.muted2,marginBottom:10}}>{nextEvents[0].date} {nextEvents[0].timeET} ET — Forecast: {nextEvents[0].forecast}</div>
            <Countdown dateStr={nextEvents[0].date} timeET={nextEvents[0].timeET}/>
            {nextEvents[0].assets&&<div style={{display:"flex",gap:4,marginTop:10,flexWrap:"wrap"}}>{nextEvents[0].assets.map(s=><span key={s} style={{fontFamily:MONO,fontSize:9,color:C.gold,background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:2,padding:"3px 8px"}}>{s}</span>)}</div>}
            <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,marginTop:8,lineHeight:1.6}}>{nextEvents[0].desc}</div>
          </div>}

          {nextEvents.length>1&&<div style={{marginBottom:12}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted,letterSpacing:"0.15em",marginBottom:8}}>{i18n.upcoming}</div>
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

          <ProGate feature="volume-funding-monitors" isPro={isPro} onUpgrade={onUpgrade}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.cyan,letterSpacing:"0.15em",marginBottom:8}}>{i18n.volumeMonitor}</div>
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
              <div style={{fontFamily:MONO,fontSize:9,color:C.green,letterSpacing:"0.15em",marginBottom:8}}>{i18n.fundingRates}</div>
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
              <div style={{fontFamily:MONO,fontSize:10,color:C.red,letterSpacing:"0.15em"}}>{i18n.liqHeatmap}</div>
              <div style={{display:"flex",gap:4}}>
                {["BTC","ETH","SOL","XAU"].map(s=>(
                  <button key={s} data-testid={`liq-btn-${s}`} onClick={()=>setLiqSym(s)} style={{background:liqSym===s?"rgba(255,64,96,.15)":"transparent",border:`1px solid ${liqSym===s?C.red:C.border}`,borderRadius:2,padding:"4px 10px",fontFamily:MONO,fontSize:9,color:liqSym===s?C.red:C.muted,cursor:"pointer",letterSpacing:"0.08em"}}>{s}</button>
                ))}
              </div>
            </div>
            <LiqHeatmap sym={liqSym} price={liqSym==="XAU"?metalPrices.XAU?.price:cryptoPrices[liqSym]?.price} oi={cryptoPrices[liqSym]?.oi||0}/>
          </div>
          </ProGate>

          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",padding:"8px 0",letterSpacing:"0.1em"}}>{i18n.allDataLive}</div>
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
              <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em"}}>binance websocket · real-time trades · ~16ms</div>
              {CRYPTO_SYMS.map(sym=>{const d=cryptoPrices[sym];return <PriceRow key={sym} sym={sym} d={d} flash={flashes[sym]} onToggleWatch={toggleWatch} watched={isWatched(sym)}/>;})}
            </>}
            {cryptoSubTab==="perp"&&<>
              <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em"}}>hyperliquid.xyz · perp mid-price · 5s</div>
              {CRYPTO_SYMS.map(sym=>{const d=perpPrices[sym];const extraParts=[d?.funding?`Fund: ${pct(d.funding,4)}/8h`:"",d?.oi?`OI: $${(d.oi/1e6).toFixed(0)}M`:""].filter(Boolean).join(" · ");return(<div key={sym}><PriceRow sym={sym} d={d} extra={d?.live&&extraParts?extraParts:null} flash={flashes[sym]} onToggleWatch={toggleWatch} watched={isWatched(sym)}/></div>);})}
            </>}
          </div>}
          {priceTab==="equity"&&<div style={panel}>
            <div style={ph}><PTitle>Equities · Finnhub</PTitle><div style={{display:"flex",gap:6,alignItems:"center"}}>{isNYSEOpen()?<Badge label="LIVE" color="green"/>:<Badge label="CLOSED" color="muted"/>}<Badge label={fhLive?`${Object.values(equityPrices).filter(p=>p.live).length} Streaming`:"Offline"} color={fhLive?"green":"gold"}/></div></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>finnhub websocket · real-time trades · NYSE 9:30a–4p ET</div>
            {EQUITY_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={equityPrices[sym]} flash={flashes[sym]} onToggleWatch={toggleWatch} watched={isWatched(sym)} marketClosed={!isNYSEOpen()}/>)}
          </div>}
          {priceTab==="metals"&&<div style={panel}>
            <div style={ph}><PTitle>Commodities</PTitle><Badge label={fhLive?`${Object.values(metalPrices).filter(p=>p.live).length} Live`:"Closed"} color={fhLive?"green":"gold"}/></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>gold-api.com · finnhub websocket · real-time</div>
            {METALS_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={metalPrices[sym]} label={METAL_LABELS[sym]} flash={flashes[sym]} onToggleWatch={toggleWatch} watched={isWatched(sym)}/>)}
            <div style={{padding:"10px 14px",fontFamily:MONO,fontSize:9,color:C.muted2}}>Gold/Silver Ratio: <span style={{color:C.gold2,fontWeight:600}}>{metalPrices.XAU?.price&&metalPrices.XAG?.price?(metalPrices.XAU.price/metalPrices.XAG.price).toFixed(0):"—"}:1</span>{metalPrices.XAU?.price&&metalPrices.XAG?.price&&(metalPrices.XAU.price/metalPrices.XAG.price)>=90&&<span style={{color:C.green}}> · bullish for silver</span>}</div>
          </div>}
          {priceTab==="forex"&&<div style={panel}>
            <div style={ph}><PTitle>Forex</PTitle><div style={{display:"flex",gap:6,alignItems:"center"}}>{isForexOpen()?<Badge label="LIVE" color="green"/>:<Badge label="CLOSED" color="muted"/>}<Badge label={fhLive?`${Object.values(forexPrices).filter(p=>p.live).length} Streaming`:"Offline"} color={fhLive?"green":"gold"}/></div></div>
            <div style={{padding:"4px 14px 6px",borderBottom:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted}}>finnhub websocket · real-time · Sun 5pm–Fri 5pm ET</div>
            {FOREX_SYMS.map(sym=><PriceRow key={sym} sym={sym} d={forexPrices[sym]} label={FOREX_LABELS[sym]} flash={flashes[sym]} onToggleWatch={toggleWatch} watched={isWatched(sym)} marketClosed={!isForexOpen()}/>)}
          </div>}
        </>}

        {/* ══ MACRO ══ */}
        {tab==="macro"&&<>
          <div style={{marginBottom:14}}><SLabel>Macro Calendar</SLabel></div>
          {macroLoading&&<div style={{padding:20,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>Loading calendar...</div>}

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[
              {label:"HIGH IMPACT",val:macroHighCount,col:C.red,bg:"rgba(255,64,96,.08)",bc:"rgba(255,64,96,.2)"},
              {label:"RELEASED",val:macroReleasedCount,col:C.green,bg:"rgba(0,199,135,.08)",bc:"rgba(0,199,135,.2)"},
              {label:"PENDING",val:macroPendingCount,col:C.orange,bg:"rgba(245,158,11,.08)",bc:"rgba(245,158,11,.2)"},
            ].map(s=>(
              <div key={s.label} data-testid={`macro-stat-${s.label.toLowerCase().replace(" ","-")}`} style={{background:s.bg,border:`1px solid ${s.bc}`,borderRadius:2,padding:"10px",textAlign:"center"}}>
                <div style={{fontFamily:SERIF,fontWeight:900,fontSize:22,color:s.col,lineHeight:1}}>{s.val}</div>
                <div style={{fontFamily:MONO,fontSize:7,color:s.col+"88",letterSpacing:"0.12em",marginTop:4}}>{s.label}</div>
              </div>
            ))}
          </div>

          {macroNextPending&&(
            <div data-testid="macro-next-event" style={{background:"rgba(201,168,76,.04)",border:`1px solid ${C.border2}`,borderRadius:2,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontFamily:MONO,fontSize:7,color:C.gold,letterSpacing:"0.18em",marginBottom:3}}>NEXT RELEASE</div>
                <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white}}>{MACRO_FLAG[macroNextPending.country]||macroNextPending.flag||""} {macroNextPending.name}</div>
                <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>Forecast: {macroNextPending.forecast} · {macroNextPending.time||macroNextPending.timeET||""}</div>
              </div>
              <div style={{fontFamily:MONO,fontSize:20,color:C.gold,animation:"pulse 2s infinite"}}>⏳</div>
            </div>
          )}

          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {["today","week"].map(t=>(
              <button key={t} data-testid={`macro-tab-${t}`} onClick={()=>setMacroCalTab(t)}
                style={{background:macroCalTab===t?"rgba(201,168,76,.12)":"transparent",border:`1px solid ${macroCalTab===t?C.gold+"44":C.border}`,color:macroCalTab===t?C.gold:C.muted,borderRadius:2,padding:"6px 14px",cursor:"pointer",fontFamily:MONO,fontSize:10,fontWeight:macroCalTab===t?700:400,letterSpacing:"0.08em"}}>
                {t==="today"?"Today":"This Week"}
              </button>
            ))}
          </div>

          <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto"}}>
            {["ALL","US","EU","UK","CA","JP","AU"].map(r=>(
              <button key={r} data-testid={`macro-region-${r}`} onClick={()=>setMacroRegionFilter(r)}
                style={{background:macroRegionFilter===r?"rgba(201,168,76,.1)":"transparent",border:`1px solid ${macroRegionFilter===r?C.gold+"44":C.border}`,color:macroRegionFilter===r?C.gold2:C.muted,borderRadius:2,padding:"5px 10px",cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.08em"}}>
                {MACRO_FLAG[r]||""} {r}
              </button>
            ))}
          </div>

          <div style={{display:"flex",gap:4,marginBottom:14,overflowX:"auto"}}>
            {["ALL","HIGH","MED","LOW"].map(i=>{const mi=MACRO_IMPACT[i];return(
              <button key={i} data-testid={`macro-impact-${i}`} onClick={()=>setMacroImpactFilter(i)}
                style={{background:macroImpactFilter===i?(mi?.bg||"rgba(201,168,76,.1)"):"transparent",border:`1px solid ${macroImpactFilter===i?(mi?.color||C.gold)+"44":C.border}`,color:macroImpactFilter===i?(mi?.color||C.gold):C.muted,borderRadius:2,padding:"5px 10px",cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.08em"}}>
                {i}
              </button>
            );})}
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em"}}>{macroAllFiltered.length} events · ForexFactory + Central Banks · 60s refresh</div>
            <Badge label="LIVE" color="green" style={{fontSize:7}}/>
          </div>

          {macroAllFiltered.length===0&&<div style={{padding:30,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:10}}>No events match your filters.</div>}

          {macroAllFiltered.map(evt=>{
            const imp=MACRO_IMPACT[evt.impact]||MACRO_IMPACT.LOW;
            const surprise=getMacroSurprise(evt);
            const marketImpacts=getMacroMarketImpact(evt);
            const status=eventStatus(evt.date);
            const isToday=status.label==="TODAY";
            const bc=bankColor[evt.bank]||C.gold;
            const nowTime=new Date().toTimeString().slice(0,5);
            const isLiveNow=!evt.released&&isToday&&(evt.timeET||"").slice(0,5)===nowTime;
            return(
              <MacroCard key={evt.id||evt.name+evt.date} evt={evt} imp={imp} surprise={surprise} marketImpacts={marketImpacts} bc={bc} isToday={isToday} isLiveNow={isLiveNow} status={status} onAskAI={()=>askMacroAI(evt)} onAddCal={()=>{const cal=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${evt.bank} - ${evt.name}\nDTSTART:${evt.date.replace(/-/g,"")}\nDTEND:${evt.date.replace(/-/g,"")}\nDESCRIPTION:${evt.desc||evt.name}\nEND:VEVENT\nEND:VCALENDAR`;const blob=new Blob([cal],{type:"text/calendar"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${evt.bank}-${evt.date}.ics`;a.click();setToast("Calendar event saved");}} onGoAI={()=>{setAiInput(`${evt.bank} ${evt.name} on ${evt.date}: forecast ${evt.forecast}, previous ${evt.previous||evt.current}${evt.actual?`, actual ${evt.actual}`:""}. How to position? Which assets most affected?`);setTab("ai");}}/>
            );
          })}

          <div style={{marginTop:12,display:"flex",gap:10,flexWrap:"wrap",fontFamily:MONO,fontSize:8,color:C.muted,justifyContent:"center"}}>
            <span>HIGH Impact</span><span>MED Impact</span><span>LOW Impact</span><span>· Tap any card for analysis</span>
          </div>

          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",padding:"8px 0",marginTop:4,letterSpacing:"0.1em"}}>CLVRQuant v2 · ALL DATA LIVE · Not financial advice</div>

          {macroAiEvent&&(
            <div data-testid="macro-ai-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:0}} onClick={()=>{setMacroAiEvent(null);setMacroAiResp(null);}}>
              <div style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:"4px 4px 0 0",padding:20,width:"100%",maxWidth:520,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div>
                    <div style={{fontFamily:MONO,fontSize:7,color:C.gold,letterSpacing:"0.18em"}}>QUANTBRAIN ANALYSIS</div>
                    <div style={{fontFamily:SERIF,fontSize:14,fontWeight:700,color:C.white,marginTop:3}}>{macroAiEvent.name}</div>
                  </div>
                  <button data-testid="macro-ai-close" onClick={()=>{setMacroAiEvent(null);setMacroAiResp(null);}} style={{background:C.border,border:"none",color:C.muted2,borderRadius:2,padding:"5px 10px",cursor:"pointer",fontFamily:MONO,fontSize:12}}>✕</button>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {[{l:"Actual",v:macroAiEvent.actual||"Pending",c:C.white},{l:"Forecast",v:macroAiEvent.forecast,c:C.muted2},{l:"Previous",v:macroAiEvent.previous||macroAiEvent.current,c:C.muted}].map(({l,v,c})=>(
                    <div key={l} style={{flex:1,background:"rgba(0,0,0,.3)",border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 8px",textAlign:"center"}}>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:2}}>{l}</div>
                      <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                {macroAiLoading?(
                  <div style={{textAlign:"center",padding:28}}>
                    <div style={{fontFamily:MONO,fontSize:11,color:C.gold,animation:"pulse 1.4s ease infinite"}}>QuantBrain analyzing...</div>
                  </div>
                ):(
                  <div style={{fontFamily:MONO,fontSize:11,color:C.text,lineHeight:1.9,whiteSpace:"pre-wrap"}}>{macroAiResp}</div>
                )}
                <div style={{marginTop:14,fontFamily:MONO,fontSize:7,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:10,letterSpacing:"0.08em"}}>For informational purposes only. Not financial advice. CLVRQuant · Mike Claver</div>
              </div>
            </div>
          )}
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
              {[{sym:"BTC",label:"BTC/USD",prices:cryptoPrices},{sym:"ETH",label:"ETH/USD",prices:cryptoPrices},{sym:"SOL",label:"SOL/USD",prices:cryptoPrices},{sym:"EURUSD",label:"EUR/USD",prices:forexPrices},{sym:"USDJPY",label:"USD/JPY",prices:forexPrices},{sym:"USDCAD",label:"USD/CAD",prices:forexPrices},{sym:"XAU",label:"Gold XAU",prices:metalPrices},{sym:"WTI",label:"Oil WTI",prices:metalPrices},{sym:"XAG",label:"Silver XAG",prices:metalPrices}].map(({sym,label,prices})=>{
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

          {/* Subscribe info */}
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={{...ph,background:"rgba(201,168,76,.04)",borderBottom:`1px solid rgba(201,168,76,.12)`}}>
              <PTitle>Daily Brief Delivery</PTitle>
              <Badge label="6:00 AM daily" color="gold"/>
            </div>
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:C.muted2,lineHeight:1.8,fontStyle:"italic"}}>Daily briefs are delivered to your inbox every weekday at 6:00 AM ET. You can manage your subscription from your account settings or the unsubscribe link in any email.</div>
            </div>
          </div>
        </>}

        {/* ══ SIGNALS ══ */}
        {tab==="signals"&&<>
          <div style={{marginBottom:14}}><SLabel>Quant AI Signals</SLabel></div>

          {/* Stats header */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            <div style={{background:"rgba(0,199,135,.06)",border:`1px solid rgba(0,199,135,.25)`,borderRadius:2,padding:"6px 12px",textAlign:"center"}}>
              <div style={{fontFamily:MONO,fontSize:15,fontWeight:800,color:C.green}}>{liveSignals.filter(s=>s.ts&&Date.now()-s.ts<300000).length}</div>
              <div style={{fontFamily:MONO,fontSize:7,color:`${C.green}88`,letterSpacing:"0.12em"}}>LIVE</div>
            </div>
            <div style={{background:"rgba(201,168,76,.06)",border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,padding:"6px 12px",textAlign:"center"}}>
              <div style={{fontFamily:MONO,fontSize:15,fontWeight:800,color:C.gold}}>{sigTracking}</div>
              <div style={{fontFamily:MONO,fontSize:7,color:`${C.gold}88`,letterSpacing:"0.12em"}}>TRACKING</div>
            </div>
            <div style={{background:"rgba(168,85,247,.06)",border:`1px solid rgba(168,85,247,.25)`,borderRadius:2,padding:"6px 12px",textAlign:"center"}}>
              <div style={{fontFamily:MONO,fontSize:15,fontWeight:800,color:C.purple}}>{liveSignals.length}</div>
              <div style={{fontFamily:MONO,fontSize:7,color:`${C.purple}88`,letterSpacing:"0.12em"}}>DETECTED</div>
            </div>
          </div>

          {/* Filters */}
          <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto"}}>
            {[{k:"all",l:"All"},{k:"watch",l:"✦ Watch"},{k:"crypto",l:"Crypto",col:"green"},{k:"equity",l:"Equities",col:"blue"},{k:"metals",l:"Metals"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
              <SubBtn key={t.k} k={t.k} label={t.l} col={t.col||"gold"} state={sigSubTab} setter={setSigSubTab}/>
            ))}
          </div>

          {/* Sort & score controls */}
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:4}}>
              {[{k:"score",l:"Score"},{k:"recent",l:"Recent"}].map(s=>(
                <button key={s.k} data-testid={`sort-${s.k}`} onClick={()=>setSigSort(s.k)} style={{padding:"5px 12px",borderRadius:2,border:`1px solid ${sigSort===s.k?C.gold:C.border}`,background:sigSort===s.k?"rgba(201,168,76,.08)":C.panel,color:sigSort===s.k?C.gold:C.muted,cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.08em"}}>{s.l}</button>
              ))}
            </div>
            <button data-testid="filter-high-conf" onClick={()=>setHighConfOnly(v=>!v)} style={{padding:"5px 12px",borderRadius:2,border:`1px solid ${highConfOnly?C.green:C.border}`,background:highConfOnly?"rgba(0,199,135,.08)":C.panel,color:highConfOnly?C.green:C.muted,cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.08em"}}>{highConfOnly?"✓ ":""}High Conf &gt;75%</button>
            <div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.08em"}}>tracking {sigTracking} tokens · 0.8% threshold · 5min window</div>
          </div>

          {/* Score legend */}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {[{label:"HIGH (75+)",color:C.green,bg:"rgba(0,199,135,.06)"},{label:"MED (55-74)",color:C.orange,bg:"rgba(255,140,0,.06)"},{label:"LOW (<55)",color:C.red,bg:"rgba(255,64,96,.06)"}].map(({label,color,bg})=>(
              <div key={label} style={{background:bg,border:`1px solid ${color}33`,borderRadius:2,padding:"3px 10px",fontFamily:MONO,fontSize:8,color,fontWeight:700,letterSpacing:"0.08em"}}>● {label}</div>
            ))}
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,padding:"3px 0"}}>Tap card for QuantBrain breakdown →</div>
          </div>

          {/* Signal feed */}
          {(()=>{
            let pool=highConfOnly?filtSigs.filter(s=>{
              const sc=scoreSignal({priceMoveAbs:Math.abs(s.pctMove||0),direction:s.dir==="LONG"?"long":"short",fundingRate:(cryptoPrices[s.token]||{}).funding||0,oiM:Math.round(((cryptoPrices[s.token]||{}).oi||0)/1e6),volumeMultiplier:1}).total;
              return sc>=75;
            }):filtSigs;
            const sorted=sigSort==="score"?[...pool].sort((a,b)=>{
              const scoreA=scoreSignal({priceMoveAbs:Math.abs(a.pctMove||0),direction:a.dir==="LONG"?"long":"short",fundingRate:(cryptoPrices[a.token]||{}).funding||0,oiM:Math.round(((cryptoPrices[a.token]||{}).oi||0)/1e6),volumeMultiplier:1}).total;
              const scoreB=scoreSignal({priceMoveAbs:Math.abs(b.pctMove||0),direction:b.dir==="LONG"?"long":"short",fundingRate:(cryptoPrices[b.token]||{}).funding||0,oiM:Math.round(((cryptoPrices[b.token]||{}).oi||0)/1e6),volumeMultiplier:1}).total;
              return scoreB-scoreA;
            }):pool;
            return sorted.length===0?<div style={{padding:32,textAlign:"center"}}>
              <div style={{color:C.muted,fontFamily:MONO,fontSize:10,marginBottom:8}}>
                {liveSignals.length===0?"Monitoring markets for significant moves...":(highConfOnly?"No high-confidence signals currently.":"No signals for this filter.")}
              </div>
              {liveSignals.length===0&&<div style={{color:C.muted2,fontFamily:MONO,fontSize:8,lineHeight:"1.6"}}>
                Signals appear when any tracked token moves &gt;0.8% within a 5-minute window.<br/>
                Tracking {sigTracking} tokens in real-time. Detector is armed.
              </div>}
            </div>:sorted.map(sig=><SignalCard key={sig.id} sig={sig} marketData={cryptoPrices} onShare={onShareSig} onAiAnalyze={onAiSig} onTrade={openTradeModal} whaleAlerts={whaleAlerts}/>);
          })()}
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
                  <button data-testid="button-create-alert" onClick={async()=>{
                    const t=Number(alertForm.threshold);
                    if(!t){setToast("Enter a threshold value");return;}
                    const label=`${alertForm.sym} ${alertForm.field} ${alertForm.condition} ${alertForm.field==="price"?fmt(t,alertForm.sym):t+"%"}`;
                    if(user){
                      try{
                        const r=await fetch("/api/alerts",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({sym:alertForm.sym,field:alertForm.field,condition:alertForm.condition,threshold:t,label})});
                        if(r.ok){const saved=await r.json();setAlerts(prev=>[...prev,{...saved,threshold:Number(saved.threshold)}]);}
                        else{const err=await r.json().catch(()=>({}));setToast(err.error||"Failed to save alert");return;}
                      }catch(e){setToast("Network error — could not save alert");return;}
                    }else{
                      setAlerts(prev=>[...prev,{id:idRef.current++,sym:alertForm.sym,field:alertForm.field,condition:alertForm.condition,threshold:t,triggered:false,label}]);
                    }
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
                  <button data-testid={`button-delete-alert-${a.id}`} onClick={()=>{
                    setAlerts(prev=>prev.filter(x=>x.id!==a.id));
                    if(user)fetch(`/api/alerts/${a.id}`,{method:"DELETE",credentials:"include"}).catch(()=>{});
                  }}
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

        {/* ══ AI ══ */}
        {tab==="ai"&&<>
          <div style={{marginBottom:14}}><SLabel>AI Market Analyst</SLabel></div>
          <ProGate feature="ai-analyst" isPro={isPro} onUpgrade={onUpgrade}>
          <div style={{...panel,overflow:"visible"}}>
            <div style={ph}><PTitle>CLVRQuant AI</PTitle><Badge label="Claude · Live" color="gold"/></div>
            <div style={{padding:16}}>
              <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
                {["BTC","ETH","SOL","TRUMP","HYPE","XAU","WTI","EURUSD","TSLA","NVDA"].map(sym=>{const d=allPrices[sym];return<button key={sym} data-testid={`ai-chip-${sym}`} onClick={()=>setAiInput(`${sym} — long or short? Price:${fmt(d?.price,sym)} 24h:${pct(d?.chg)}`)}
                  style={{padding:"5px 11px",borderRadius:2,border:`1px solid ${d?.live?"rgba(201,168,76,.28)":C.border}`,background:C.panel,color:d?.live?C.gold2:C.muted2,fontFamily:MONO,fontSize:10,letterSpacing:"0.08em",cursor:"pointer"}}>
                  {sym}{d?.live?" ✦":""}
                </button>;})}
              </div>
              <AIInput value={aiInput} onChange={onAiChange} placeholder={`"Long BTC now?" · "Is XAU overextended?" · "Best forex trade?"`}/>
              <div style={{display:"flex",gap:6,marginTop:8}}>
                <button data-testid="button-ai-analyze" onClick={runAI} disabled={aiLoading} style={{flex:1,height:44,background:"rgba(201,168,76,.1)",color:aiLoading?C.muted:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,cursor:aiLoading?"not-allowed":"pointer"}}>
                  {aiLoading?"Analyzing...":"Analyze →"}
                </button>
              </div>
              <div style={{display:"flex",gap:4,marginTop:10,marginBottom:6}}>
                {[{k:"today",l:"Today"},{k:"midterm",l:"Mid-Term (1-4 wks)"},{k:"longterm",l:"Long-Term (1-3 mo)"}].map(t=>(
                  <button key={t.k} data-testid={`ai-tf-${t.k}`} onClick={()=>setAiTimeframe(t.k)} style={{flex:1,padding:"6px 4px",borderRadius:2,border:`1px solid ${aiTimeframe===t.k?"rgba(0,199,135,.4)":C.border}`,background:aiTimeframe===t.k?"rgba(0,199,135,.08)":C.panel,color:aiTimeframe===t.k?C.green:C.muted,fontFamily:MONO,fontSize:8,letterSpacing:"0.06em",cursor:"pointer",transition:"all .2s"}}>{t.l}</button>
                ))}
              </div>
              <button data-testid="button-trade-ideas" onClick={runTradeIdeas} disabled={aiLoading} style={{width:"100%",height:48,background:aiLoading?"rgba(0,199,135,.03)":"rgba(0,199,135,.08)",color:aiLoading?C.muted:C.green,border:`1px solid ${aiLoading?"rgba(0,199,135,.12)":"rgba(0,199,135,.3)"}`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,cursor:aiLoading?"not-allowed":"pointer",letterSpacing:"0.02em"}}>
                {aiLoading?"QuantBrain Analyzing...":`Get ${aiTimeframe==="today"?"Today's":aiTimeframe==="midterm"?"Mid-Term":"Long-Term"} Trade Ideas ✦`}
              </button>
              {aiOutput&&<div data-testid="text-ai-output" style={{marginTop:12,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:14,fontSize:13,lineHeight:1.9,color:C.text,whiteSpace:"pre-wrap",overflowY:"auto",WebkitOverflowScrolling:"touch",paddingBottom:24}}>{aiOutput}</div>}
              {liveSignals.length>0&&<div style={{marginTop:16}}>
                <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.18em",marginBottom:10}}>AI TRADE REASONINGS · {i18n.masterScore}</div>
                {liveSignals.filter(s=>s.reasoning&&s.reasoning.length>0).slice(0,5).map(sig=>(
                  <div key={sig.id} data-testid={`ai-reasoning-${sig.id}`} style={{background:"rgba(201,168,76,.03)",border:`1px solid ${C.gold}18`,borderRadius:2,padding:"10px 12px",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontFamily:MONO,fontSize:13,fontWeight:800,color:C.white}}>{sig.token}</span>
                        <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:sig.dir==="LONG"?"rgba(0,199,135,.06)":"rgba(255,64,96,.06)",color:sig.dir==="LONG"?C.green:C.red,border:`1px solid ${sig.dir==="LONG"?"rgba(0,199,135,.25)":"rgba(255,64,96,.25)"}`,fontFamily:MONO}}>{sig.dir}</span>
                        {sig.masterScore&&<span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:sig.masterScore>=60?C.green:sig.masterScore>=40?C.orange:C.red}}>{i18n.masterScore}: {sig.masterScore}</span>}
                        {sig.whaleAligned&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:"rgba(0,212,255,.08)",color:C.cyan,border:"1px solid rgba(0,212,255,.2)",fontFamily:MONO}}>🐋</span>}
                      </div>
                      <button data-testid={`ai-trade-${sig.id}`} onClick={()=>openTradeModal(sig)} style={{padding:"5px 12px",borderRadius:2,background:"rgba(0,199,135,.08)",border:"1px solid rgba(0,199,135,.3)",fontFamily:MONO,fontSize:9,color:C.green,cursor:"pointer",letterSpacing:"0.06em"}}>{i18n.tradeNow}</button>
                    </div>
                    {sig.reasoning.map((r,i)=><div key={i} style={{fontFamily:MONO,fontSize:9,color:C.muted2,lineHeight:1.7,display:"flex",gap:5}}><span style={{color:C.gold,flexShrink:0}}>▸</span><span>{r}</span></div>)}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:8}}>
                      <div style={{textAlign:"center",padding:"4px 0"}}><div style={{fontFamily:MONO,fontSize:7,color:C.muted}}>{i18n.entry}</div><div style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:C.white}}>{sig.entry?fmt(sig.entry,sig.token):"—"}</div></div>
                      <div style={{textAlign:"center",padding:"4px 0"}}><div style={{fontFamily:MONO,fontSize:7,color:C.green+"88"}}>{i18n.target}</div><div style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:C.green}}>{sig.target?fmt(sig.target,sig.token):"—"}</div></div>
                      <div style={{textAlign:"center",padding:"4px 0"}}><div style={{fontFamily:MONO,fontSize:7,color:C.red+"88"}}>{i18n.stopLoss}</div><div style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:C.red}}>{sig.stopLoss?fmt(sig.stopLoss,sig.token):"—"}</div></div>
                    </div>
                  </div>
                ))}
                {liveSignals.filter(s=>s.reasoning&&s.reasoning.length>0).length===0&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,padding:12,textAlign:"center"}}>Waiting for signals with AI reasoning data...</div>}
              </div>}
            </div>
          </div>
          </ProGate>
          <div style={{...panel,border:`1px solid rgba(255,140,0,.12)`}}>
            <div style={{padding:"11px 14px",background:"rgba(255,140,0,.03)"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.orange,letterSpacing:"0.22em",marginBottom:5}}>LEGAL DISCLAIMER</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.9}}>CLVRQuant is an AI-powered research and analytics platform for <strong style={{color:C.muted2}}>informational and educational purposes only</strong>. Nothing constitutes financial advice, investment advice, or trading advice. AI signals are not recommendations. All trading involves significant risk of loss. Past performance does not predict future results. CLVRQuant · Mike Claver. All rights reserved.</div>
            </div>
          </div>
        </>}

        {/* ══ GUIDE ══ */}
        {tab==="about"&&<>
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={{padding:"28px 18px 10px",textAlign:"center"}}>
              <div style={{fontFamily:SERIF,fontSize:28,fontWeight:900,color:C.white,letterSpacing:"-0.02em"}}>CLVR<span style={{color:C.gold}}>Quant</span></div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.3em",marginTop:4}}>TRADE SMARTER WITH AI</div>
              <div style={{width:40,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`,margin:"16px auto"}}/>
              <div style={{fontFamily:SERIF,fontSize:15,color:C.muted2,fontStyle:"italic",lineHeight:1.8,maxWidth:480,margin:"0 auto"}}>
                CLVRQuant was born from frustration. After years of switching between dozens of tabs, apps, and feeds just to stay on top of the markets, the idea was simple: put everything you need in one clean, intelligent dashboard.
              </div>
            </div>
          </div>
          <div style={panel}>
            <div style={ph}><PTitle>Why CLVRQuant?</PTitle></div>
            <div style={{padding:"8px 16px 16px"}}>
              {[
                {t:"One Dashboard, All Markets",d:"Crypto, equities, commodities, forex, and macro events — all live, all in one place. No more tab-switching."},
                {t:"AI-Powered Intelligence",d:"Claude AI analyzes real-time data across all asset classes, giving you trade ideas with specific entries, targets, and stops. Not generic advice — data-driven analysis using live prices and your actual signals."},
                {t:"Real Alpha Signals",d:"Our QuantBrain engine detects price moves, anomalies, and momentum shifts across 32 crypto assets, 16 equities, and commodities in real-time. Every signal is scored using multiple on-chain and market factors."},
                {t:"Stay Ahead Daily",d:"The Morning Brief summarizes overnight moves, key macro events, and top setups before you even open a chart. Price alerts notify you when targets hit. The macro calendar keeps you aware of Fed decisions, CPI, NFP, and central bank events worldwide."},
                {t:"Built for Mobile",d:"Designed mobile-first so you can check markets, review signals, and get AI analysis from anywhere — your pocket market intelligence hub."},
              ].map(({t,d},i)=>(
                <div key={i} style={{marginBottom:14}}>
                  <div style={{fontFamily:SERIF,fontSize:14,fontWeight:700,color:C.gold2,marginBottom:4}}>{t}</div>
                  <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.8}}>{d}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={panel}>
            <div style={ph}><PTitle>Glossary</PTitle><Badge label="Learn" color="gold"/></div>
            <div style={{padding:"8px 16px 16px"}}>
              {[
                {t:"QuantBrain Score",d:"A 0–100 confluence score that measures how strong a trading signal is. It combines price movement, funding rates, open interest, volume, and momentum into a single number. 75+ is high conviction, 55-74 is medium, below 55 is low."},
                {t:"Alpha Signal",d:"A detected trading opportunity where the asset is showing unusual activity — a significant price move, volume spike, or momentum shift that could indicate a profitable trade setup."},
                {t:"Confluence",d:"When multiple independent indicators point in the same direction. The more factors that align (price move + rising volume + favorable funding + momentum), the stronger the signal."},
                {t:"Funding Rate",d:"In perpetual futures markets, the funding rate is a periodic payment between long and short traders. Positive funding means longs pay shorts (market is bullish/overleveraged). Negative funding means shorts pay longs (bearish/overleveraged shorts). Extreme funding often precedes reversals."},
                {t:"Open Interest (OI)",d:"The total value of outstanding derivative contracts (futures/options) for an asset. Rising OI with rising price = new money entering (bullish). Rising OI with falling price = new shorts (bearish). Falling OI = positions closing."},
                {t:"Kelly Criterion",d:"A mathematical formula used to determine optimal position size. It balances expected return against risk. A Kelly fraction of 2-3% means risking 2-3% of your portfolio on that trade — conservative but mathematically optimal for long-term growth."},
                {t:"Leverage",d:"Borrowing funds to increase your position size. 5x leverage means a 1% price move gives you a 5% gain (or loss). Higher leverage = higher risk. Our signals suggest max leverage based on conviction level."},
                {t:"LONG vs SHORT",d:"LONG means you profit when the price goes up (buy low, sell high). SHORT means you profit when the price goes down (sell high, buy back lower)."},
                {t:"Perpetual Futures (Perps)",d:"Derivative contracts that let you trade an asset's price without owning it. Unlike traditional futures, they have no expiration date. They track the spot price through the funding rate mechanism."},
                {t:"Volume Multiplier",d:"Compares current trading volume to the recent average. A 2.5x volume multiplier means trading activity is 2.5 times higher than normal — often a sign something significant is happening."},
                {t:"Macro Events",d:"Major economic announcements that move all markets: Federal Reserve interest rate decisions (FOMC), Consumer Price Index (CPI = inflation measure), Non-Farm Payrolls (NFP = jobs data), and GDP reports."},
                {t:"Risk/Reward Ratio",d:"The potential profit versus potential loss of a trade. A 3:1 R/R means you could make 3x what you're risking. Professional traders typically look for at least 2:1 ratios."},
                {t:"Conviction Level",d:"HIGH (75+ score): strong multi-factor alignment, consider full position. MEDIUM (55-74): moderate signal, consider half position. LOW (below 55): weak signal, exercise caution or skip."},
                {t:"SIM vs LIVE",d:"LIVE means the price is fetched in real-time from market data providers. SIM (simulated) means the data source is temporarily unavailable and a reference price is shown instead."},
                {t:"Morning Brief",d:"A daily AI-generated market summary that covers overnight price moves, key macro events, and the top trading setups for the day. Delivered fresh each session."},
                {t:"Polymarket Odds",d:"Real-time prediction market probabilities from Polymarket.com. These show what the crowd believes about future events (elections, regulations, etc.) and can impact crypto/equity sentiment."},
              ].map(({t,d},i)=>(
                <div key={i} data-testid={`glossary-${i}`} style={{marginBottom:16,paddingBottom:16,borderBottom:i<15?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.gold2,letterSpacing:"0.04em",marginBottom:5}}>{t}</div>
                  <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.9}}>{d}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{...panel,border:`1px solid rgba(201,168,76,.12)`}}>
            <div style={{padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontFamily:SERIF,fontSize:13,color:C.muted2,fontStyle:"italic",lineHeight:1.8}}>
                "Markets reward the prepared. CLVRQuant keeps you prepared."
              </div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,marginTop:8,letterSpacing:"0.15em"}}>CLVRQUANT · MIKE CLAVER</div>
            </div>
          </div>
        </>}

        {tab==="account"&&<AccountPage user={user} onSignOut={async()=>{try{await fetch("/api/auth/signout",{method:"POST"});}catch(e){}try{localStorage.removeItem("clvr_tier");localStorage.removeItem("clvr_code");}catch(e){}setUser(null);}} isPro={isPro} setShowUpgrade={setShowUpgrade}/>}

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
