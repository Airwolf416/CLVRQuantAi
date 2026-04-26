// ─────────────────────────────────────────────────────────
// CLVRQuant v2
// NEW: Macro countdown timers · Volume spike detector
//      Funding rate flip alerts · Liquidation heatmap
//      Push notifications · In-app alert banners
// Backend-proxied API calls (keys stored server-side)
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, memo, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { Menu, X, LogOut, Languages, QrCode, ScanLine } from "lucide-react";
import ChartAITab from "./tabs/ChartAITab.jsx";
import CheckoutPage from "./pages/Checkout.jsx";
import PaymentSuccessPage from "./pages/PaymentSuccess.jsx";
import PhantomWalletPanel from "./PhantomWallet";
import WelcomePage from "./WelcomePage";
import AccountPage from "./AccountPage";
import QRScanner from "./QRScanner";
import OnboardingTour from "./OnboardingTour";
import MarketTab from "./tabs/MarketTab";
import InsiderTab from "./tabs/InsiderTab";
import KronosPanel from "./components/KronosPanel";
import AIQuantTab from "./tabs/AITab";
import PricingModal from "./components/PricingModal.jsx";
import MyBasket from "./components/MyBasket.jsx";
import useMarketData, { fmtPrice as mfmtPrice, fmtChange as mfmtChange, fmtFunding as mfmtFunding } from "./store/MarketDataStore.jsx";
import { useTwitterIntelligence, TwitterSentimentBadge, TwitterMarketModeStrip, TwitterMorningBrief, TwitterSignalPanel } from "./store/TwitterIntelligence.jsx";
import { playMarketBell, unlockAudio, unlockSpeech, getET as getBellET, getNYSEStatus as getBellNYSEStatus } from "./utils/marketBell.js";
import { DataBusProvider, DataBusCtx, useDataBus, mapRegimeLabel, regimeMultiplier, fearGreedColor } from "./context/DataBusContext.jsx";

// ── WebAuthn helpers (Face ID setup after login) ───────────────────────────
const WA_STORE_KEY = "clvr_wa_cred";
function waSupported() { return !!(window.PublicKeyCredential && navigator.credentials?.create); }
function getStoredWACred() { try { const c = JSON.parse(localStorage.getItem(WA_STORE_KEY) || "null"); return (c && c.v >= 2) ? c : null; } catch { return null; } }
function storeWACred(credentialId, userId) { try { localStorage.setItem(WA_STORE_KEY, JSON.stringify({ credentialId, userId, platform: true, v: 2, registeredAt: Date.now() })); } catch {} }
function uint8ToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }

// ─── CLVRQuant Theme ──────────────────────────────────────
const DARK_C = {
  bg:"#050709", navy:"#080d18", panel:"#0c1220",
  border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7", pink:"#ec4899",
  navBg:"#050709", navBorder:"#141e35", inputBg:"#080d18",
};
const LIGHT_C = {
  bg:"#f0f2f5", navy:"#f0f2f5", panel:"#ffffff",
  border:"#e2e6ea", border2:"#cdd2d8",
  gold:"#8a6c18", gold2:"#a07820", gold3:"#c9a84c",
  text:"#0d1321", muted:"#4a5568", muted2:"#718096", white:"#0d1321",
  green:"#007a44", red:"#c41230", orange:"#b35a00",
  cyan:"#006e8a", blue:"#1d4ed8", teal:"#0d7a6e", purple:"#7c3aed", pink:"#be185d",
  navBg:"#ffffff", navBorder:"#e2e6ea", inputBg:"#f0f2f5",
};
// module-level fallback (dark) for simple utility components
const C = DARK_C;
const ThemeCtx = createContext({C:DARK_C,isDark:true,toggle:()=>{}});
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
const CRYPTO_BASE={BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,POL:0.55,UNI:9.5,AAVE:220,NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18,TRUMP:3.5,HYPE:31};
const EQUITY_BASE={TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310,AMD:145,PLTR:70,COIN:210,SQ:72,SHOP:95,CRM:290,NFLX:850,DIS:105};
const METALS_BASE={XAU:4495,XAG:70,WTI:100,BRENT:105,NATGAS:3.0,COPPER:5.49,PLATINUM:1870};
const FOREX_BASE={EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654,NZDUSD:0.5932,EURGBP:0.8526,EURJPY:162.45,GBPJPY:190.52,USDMXN:17.15,USDZAR:18.45,USDTRY:32.5,USDSGD:1.34};
const CRYPTO_SYMS=Object.keys(CRYPTO_BASE);
const EQUITY_SYMS=Object.keys(EQUITY_BASE);
const METALS_SYMS=Object.keys(METALS_BASE);
const FOREX_SYMS=Object.keys(FOREX_BASE);
const ALL_SYMS=[...CRYPTO_SYMS,...EQUITY_SYMS,...METALS_SYMS,...FOREX_SYMS];
const METAL_LABELS={XAU:"Gold",XAG:"Silver",WTI:"Oil WTI",BRENT:"Oil Brent",NATGAS:"Nat Gas",COPPER:"Copper",PLATINUM:"Platinum"};
const FOREX_LABELS={EURUSD:"EUR/USD",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",USDCHF:"USD/CHF",AUDUSD:"AUD/USD",USDCAD:"USD/CAD",NZDUSD:"NZD/USD",EURGBP:"EUR/GBP",EURJPY:"EUR/JPY",GBPJPY:"GBP/JPY",USDMXN:"USD/MXN",USDZAR:"USD/ZAR",USDTRY:"USD/TRY",USDSGD:"USD/SGD"};

// ─── BINANCE WEBSOCKET SYMBOL MAP ────────────────────────
const BINANCE_WS_MAP={BTC:"btcusdt",ETH:"ethusdt",SOL:"solusdt",WIF:"wifusdt",DOGE:"dogeusdt",AVAX:"avaxusdt",LINK:"linkusdt",ARB:"arbusdt",PEPE:"pepeusdt",XRP:"xrpusdt",BNB:"bnbusdt",ADA:"adausdt",DOT:"dotusdt",POL:"polusdt",UNI:"uniusdt",AAVE:"aaveusdt",NEAR:"nearusdt",SUI:"suiusdt",APT:"aptusdt",OP:"opusdt",TIA:"tiausdt",SEI:"seiusdt",JUP:"jupusdt",ONDO:"ondousdt",RENDER:"renderusdt",INJ:"injusdt",FET:"fetusdt",TAO:"taousdt",PENDLE:"pendleusdt",HBAR:"hbarusdt",TRUMP:"trumpusdt",HYPE:"hypeusdt"};
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
  // [migrated Apr 2026] /api/finnhub now serves FMP data; route name kept for compat.
  const r=await fetch("/api/finnhub");
  if(!r.ok)throw new Error(`Market data API ${r.status}`);
  return await r.json();
}
async function fetchNews(){
  const r=await fetch("/api/news");
  if(!r.ok)throw new Error(`News API ${r.status}`);
  const j=await r.json();
  // Backward compat: server now returns {items, filtered}; older shape was a bare array.
  if(Array.isArray(j))return{items:j,filtered:0};
  return{items:Array.isArray(j?.items)?j.items:[],filtered:j?.filtered||0};
}

// ─── SPARKLINE ────────────────────────────────────────────
function Sparkline({data,color,width=80,height=22}){
  if(!data||data.length<2)return<span style={{fontSize:8,opacity:.3,color:C.muted}}>—</span>;
  const min=Math.min(...data),max=Math.max(...data),range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*(height-2)+1}`).join(" ");
  const up=data[data.length-1]>=data[0];
  return(
    <svg width={width} height={height} style={{overflow:"visible",flexShrink:0}}>
      <polyline points={pts} fill="none" stroke={color||(up?C.gold:"#ff4060")} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)/(data.length-1)*width} cy={height-((data[data.length-1]-min)/range)*(height-2)+1} r="2.5" fill={color||(up?C.gold:"#ff4060")}/>
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

// ─── PUSH NOTIFICATIONS (via service worker → OS notification center) ──────
// Module-level flag — synced from React component so sendPush respects the toggle
let _pushDisabledFlag=false;

function sendPush(title,body,tag="clvrquant"){
  if(_pushDisabledFlag)return; // user toggled off — in-app banners only
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
  // Route through service worker so notification appears in OS notification center
  if("serviceWorker"in navigator&&navigator.serviceWorker.controller){
    try{navigator.serviceWorker.controller.postMessage({type:"SHOW_NOTIFICATION",title,body,tag,icon:"/icons/icon-192.png"});return;}catch(e){}
  }
  // Fallback: use registration.showNotification if available
  if("serviceWorker"in navigator){
    navigator.serviceWorker.ready.then(reg=>{
      try{reg.showNotification(title,{body,icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",tag});}
      catch{try{new Notification(title,{body,tag});}catch{}}
    }).catch(()=>{try{new Notification(title,{body,tag});}catch{}});
    return;
  }
  try{new Notification(title,{body,tag});}catch(e){}
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
function getETtoUTCOffset(){try{const now=new Date();const utcMs=now.getTime();const etMs=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"})).getTime();return Math.round((utcMs-etMs)/3600000);}catch{return 5;}}
function parseTimeET(timeStr){const tp=(timeStr||"12:00").match(/(\d+):(\d+)/);let h=tp?parseInt(tp[1]):12;const m=tp?parseInt(tp[2]):0;const isPM=timeStr&&timeStr.toLowerCase().includes("pm")&&h<12;if(isPM)h+=12;const isAM=timeStr&&timeStr.toLowerCase().includes("am")&&h===12;if(isAM)h=0;const isET=!timeStr||timeStr.includes("ET");return{h,m,offsetUTC:isET?getETtoUTCOffset():0};}
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

// ─── ADVANCED 6-DIMENSION SCORE BREAKDOWN ────────────────
function AdvancedFactorBreakdown({breakdown,C:_C}){
  if(!breakdown)return null;
  const dims=[
    {key:"technical",        label:"TECHNICAL ANALYSIS",  color:"#3b82f6",  desc:"RSI · EMA Alignment · Bollinger Bands"},
    {key:"statistical",      label:"STATISTICS / MATH",   color:"#a855f7",  desc:"Z-Score standard deviations from mean"},
    {key:"newsSentiment",    label:"NEWS SENTIMENT",       color:"#06b6d4",  desc:"CryptoPanic live market sentiment"},
    {key:"fundamentals",     label:"FUNDAMENTALS",         color:"#c9a84c",  desc:"Open Interest · Funding Rate"},
    {key:"patternRecognition",label:"PATTERN RECOGNITION", color:"#f97316",  desc:"Chart patterns (flags, H&S, double tops)"},
    {key:"backtesting",      label:"BACK TESTING",         color:"#22c55e",  desc:"Historical win rate for similar setups"},
  ];
  const total=breakdown.total||0;
  return(
    <div style={{background:_C.bg,border:`1px solid ${_C.border}`,borderRadius:2,padding:14,marginTop:10}}>
      <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:_C.muted,letterSpacing:"0.18em",marginBottom:12}}>ADVANCED 6-DIMENSION ANALYSIS</div>
      {dims.map(({key,label,color,desc})=>{
        const dim=breakdown[key];
        if(!dim)return null;
        const pct=dim.max>0?Math.round((dim.pts/dim.max)*100):0;
        return(
          <div key={key} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
              <div>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,color}}>{label}</span>
                <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:_C.muted,marginLeft:6}}>{desc}</span>
              </div>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:800,color:pct>=70?_C.green:pct>=40?_C.orange:_C.red}}>{dim.pts}/{dim.max}</span>
            </div>
            <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
              <div style={{height:4,width:`${pct}%`,background:color,borderRadius:2,transition:"width 1s ease",boxShadow:`0 0 6px ${color}66`}}/>
            </div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:_C.muted,marginTop:2}}>{dim.label}</div>
          </div>
        );
      })}
      <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${_C.border}`,marginTop:6}}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,color:_C.white}}>COMPOSITE SCORE</span>
        <div style={{textAlign:"right"}}>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:14,fontWeight:900,color:total>=80?_C.green:total>=65?_C.orange:_C.red}}>{total}</span>
          <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:_C.muted}}>/100</span>
          {total>=80&&<span style={{marginLeft:8,fontSize:9,fontWeight:700,color:_C.green,fontFamily:"'IBM Plex Mono',monospace"}}>⚡ STRONG — PUSH SENT</span>}
        </div>
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
function ProGate({feature,isPro,onUpgrade,children,tier}){
  if(isPro)return children;
  const isEliteTier=tier==="elite";
  const label=isEliteTier?"Elite Feature":"Pro Feature";
  const btnLabel=isEliteTier?"Upgrade to Elite ⚡":"Upgrade to Pro";
  return(
    <div data-testid={`progate-${feature}`} style={{position:"relative"}}>
      <div style={{filter:"blur(4px)",opacity:0.3,pointerEvents:"none",maxHeight:180,overflow:"hidden"}}>{children}</div>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(5,7,9,.85)",backdropFilter:"blur(8px)",borderRadius:2}}>
        <div style={{fontFamily:SERIF,fontWeight:900,fontSize:16,color:isEliteTier?"#e8c96d":C.gold2,marginBottom:4,textShadow:isEliteTier?"0 0 12px rgba(201,168,76,.5)":undefined}}>{label}</div>
        <div style={{fontFamily:MONO,fontSize:9,color:C.muted2,letterSpacing:"0.12em",marginBottom:12,textTransform:"uppercase"}}>{feature}</div>
        <button data-testid={`btn-upgrade-${feature}`} onClick={onUpgrade} style={{background:isEliteTier?"rgba(201,168,76,.18)":"rgba(201,168,76,.12)",border:`1px solid ${isEliteTier?"rgba(201,168,76,.55)":"rgba(201,168,76,.35)"}`,borderRadius:2,padding:"8px 20px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:isEliteTier?"#e8c96d":C.gold2,cursor:"pointer",boxShadow:isEliteTier?"0 0 16px rgba(201,168,76,.2)":undefined}}>{btnLabel}</button>
      </div>
    </div>
  );
}

// Tabs that require Pro (fully locked for free users)
const PRO_TABS_GATE=["brief","alerts","wallet","ai"];
// Tabs that require Elite (locked for both free AND pro users)
const ELITE_TABS_GATE=["insider","basket","chartai"];

function PreviewGate({tab,onSignUp,onSignIn,C2,MONO2,SERIF2}){
  const tabNames={radar:"Radar Command Center",markets:"Live Markets",macro:"Macro Calendar",brief:"Morning Brief",signals:"AI Quant Signals",alerts:"Price Alerts",wallet:"Phantom Wallet",ai:"CLVR AI Analyst",chartai:"Chart AI",basket:"My Basket",account:"Your Account",insider:"SEC Insider Flow",quant:"Quant Engine",about:"About",journal:"Trade Journal"};
  const tabBlurbs={radar:"Live market regime · crash detector · global liquidity index · social sentiment",markets:"Real-time crypto, equities, metals & forex · funding rates · OI · whale tracking",macro:"Fed calendar · CPI/NFP events · geopolitical risk · economic data",brief:"Daily AI market brief · 4 curated trade ideas · macro risk scoring",signals:"Full quant signal library · Bayesian scoring · funding anomalies · whale detection",alerts:"Custom price alerts · push notifications · macro event warnings",wallet:"Phantom Wallet · Solana balance · DeFi integration · token tracking",ai:"CLVR AI market chat · real-time data context · trade ideas · position sizing",chartai:"Upload any chart · AI returns direction, entry, SL & TP1/TP2/TP3 with live news context · 5 analyses/day",insider:"SEC Form 4 insider filings · whale cluster tracking · institutional flow",quant:"QuantBrain engine · custom signal tuning · risk profiles",journal:"Log trades · P&L tracking · win rate · R:R analysis (Elite)"};
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:460,padding:"36px 20px",textAlign:"center"}}>
      {/* Icon + heading */}
      <div style={{fontSize:44,marginBottom:14,filter:"drop-shadow(0 0 12px rgba(201,168,76,.3))"}}>🔐</div>
      <div style={{fontFamily:SERIF2,fontSize:22,fontWeight:900,color:C2.gold2,marginBottom:6,letterSpacing:"-0.02em"}}>{tabNames[tab]||"Feature Locked"}</div>
      <div style={{fontFamily:MONO2,fontSize:9,color:C2.muted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:18}}>FREE ACCOUNT REQUIRED</div>
      <div style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.85,marginBottom:28,maxWidth:290}}>{tabBlurbs[tab]||"Create a free account to unlock this feature and start trading smarter."}</div>

      {/* Primary CTA — free account */}
      <button data-testid="preview-signup-btn" onClick={()=>onSignUp("free")}
        style={{width:"100%",maxWidth:300,padding:"14px 0",borderRadius:4,background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.55)",color:C2.gold2,fontFamily:SERIF2,fontStyle:"italic",fontWeight:700,fontSize:16,cursor:"pointer",marginBottom:10,letterSpacing:"0.02em",boxShadow:"0 0 20px rgba(201,168,76,.1)"}}>
        Create Free Account →
      </button>

      {/* Upgrade pitch card */}
      <div style={{width:"100%",maxWidth:300,background:"rgba(201,168,76,.04)",border:"1px solid rgba(201,168,76,.18)",borderRadius:5,padding:"16px 18px",marginBottom:18,textAlign:"left"}}>
        <div style={{fontFamily:MONO2,fontSize:9,color:C2.gold,letterSpacing:"0.16em",marginBottom:10}}>PRO & ELITE MEMBERS ALSO GET</div>
        {[["⚡","AI-powered quant signals + trade ideas"],["📰","Morning brief · 4 daily curated ideas"],["🔍","SEC insider filings · whale cluster flow"],["🔔","Custom price alerts · push notifications"],["👛","Phantom wallet + Hyperliquid trading"]].map(([icon,text])=>(
          <div key={text} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
            <span style={{fontSize:11,lineHeight:1.7}}>{icon}</span>
            <span style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.7}}>{text}</span>
          </div>
        ))}
        <button data-testid="preview-upgrade-pro-btn" onClick={()=>onSignUp("pro")}
          style={{width:"100%",marginTop:14,padding:"11px 0",borderRadius:3,background:"rgba(201,168,76,.15)",border:"1px solid rgba(201,168,76,.45)",color:C2.gold,fontFamily:MONO2,fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.1em"}}>
          UPGRADE TO PRO — FROM $29.99/mo →
        </button>
        <button data-testid="preview-upgrade-elite-btn" onClick={()=>onSignUp("elite")}
          style={{width:"100%",marginTop:6,padding:"10px 0",borderRadius:3,background:"rgba(0,229,255,.06)",border:"1px solid rgba(0,229,255,.3)",color:"#00e5ff",fontFamily:MONO2,fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.1em"}}>
          ELITE — FULL ACCESS FROM $129/mo ⚡
        </button>
      </div>

      {/* Sign in link */}
      <div style={{fontFamily:MONO2,fontSize:10,color:C2.muted}}>
        Already have an account?{" "}
        <span data-testid="preview-signin-link" onClick={onSignIn} style={{color:C2.gold,cursor:"pointer",textDecoration:"underline",letterSpacing:"0.04em"}}>Sign in</span>
      </div>
    </div>
  );
}

function PreviewPricingPage({onSignUp,onSignIn,C2,MONO2,SERIF2}){
  const plans=[
    {name:"Free",price:"$0",period:"forever",color:C2.muted2,borderColor:"#1c2b4a",features:["Live crypto, equities & forex prices","Macro calendar & event tracker","Market regime dashboard","Signals with 30-min delay (prices hidden)","Track record — aggregate stats only"]},
    {name:"Pro",price:"$29.99",period:"/mo",color:C2.gold2,borderColor:"rgba(201,168,76,.5)",badge:"MOST POPULAR",features:["Everything in Free","⚡ Real-time signals — no delay, full prices","📰 Daily AI Morning Brief · 1 trade idea","🔔 Custom price alerts + push notifications","👛 Phantom Wallet + Solana integration","🤖 CLVR AI Market Analyst · full history"]},
    {name:"Elite",price:"$129",period:"/mo",color:"#00e5ff",borderColor:"rgba(0,229,255,.4)",badge:"FULL ACCESS",features:["Everything in Pro","🏛 SEC Insider / Form 4 flow","🐋 Whale cluster tracking","⚡ Hyperliquid perps integration","🔑 Direct founder access · all future features"]},
  ];
  return(
    <div style={{padding:"20px 4px 40px"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontFamily:SERIF2,fontSize:24,fontWeight:900,color:C2.gold2,letterSpacing:"-0.02em",marginBottom:4}}>CLVRQuant Plans</div>
        <div style={{fontFamily:MONO2,fontSize:9,color:C2.gold,letterSpacing:"0.2em",marginBottom:10}}>MARKET INTELLIGENCE · FOR SERIOUS TRADERS</div>
        <div style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.7,maxWidth:320,margin:"0 auto"}}>
          Real-time data, AI-powered analysis, and institutional-grade tools — built for traders who want an edge.
        </div>
      </div>

      {/* Pricing cards */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
        {plans.map(plan=>(
          <div key={plan.name} style={{background:"#0c1220",border:`1px solid ${plan.borderColor}`,borderRadius:6,padding:"18px 16px",position:"relative"}}>
            {plan.badge&&(
              <div style={{position:"absolute",top:-10,right:16,background:plan.name==="Elite"?"rgba(0,229,255,.15)":"rgba(201,168,76,.18)",border:`1px solid ${plan.borderColor}`,borderRadius:3,padding:"3px 10px",fontFamily:MONO2,fontSize:8,color:plan.color,letterSpacing:"0.15em",fontWeight:700}}>
                {plan.badge}
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
              <div>
                <div style={{fontFamily:SERIF2,fontSize:18,fontWeight:900,color:plan.color,letterSpacing:"-0.01em"}}>{plan.name}</div>
                <div style={{fontFamily:MONO2,fontSize:9,color:C2.muted,letterSpacing:"0.08em",marginTop:2}}>
                  {plan.name==="Free"?"No credit card required":"Cancel anytime"}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <span style={{fontFamily:SERIF2,fontSize:28,fontWeight:900,color:plan.color}}>{plan.price}</span>
                <span style={{fontFamily:MONO2,fontSize:9,color:C2.muted}}>{plan.period}</span>
              </div>
            </div>
            {plan.features.map(f=>(
              <div key={f} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <span style={{color:plan.color,fontFamily:MONO2,fontSize:10,lineHeight:1.6,flexShrink:0}}>✓</span>
                <span style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.6}}>{f}</span>
              </div>
            ))}
            {plan.name!=="Free"&&(
              <button data-testid={`preview-pricing-${plan.name.toLowerCase()}`} onClick={()=>onSignUp(plan.name.toLowerCase())}
                style={{width:"100%",marginTop:14,padding:"11px 0",borderRadius:4,background:plan.name==="Elite"?"rgba(0,229,255,.1)":"rgba(201,168,76,.12)",border:`1px solid ${plan.borderColor}`,color:plan.color,fontFamily:MONO2,fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.1em"}}>
                {plan.name==="Elite"?"Get Elite Access ⚡":"Get Pro Access →"}
              </button>
            )}
            {plan.name==="Free"&&(
              <button data-testid="preview-pricing-free" onClick={()=>onSignUp("free")}
                style={{width:"100%",marginTop:14,padding:"11px 0",borderRadius:4,background:"rgba(255,255,255,.04)",border:"1px solid #1c2b4a",color:C2.muted2,fontFamily:MONO2,fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.1em"}}>
                Create Free Account →
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Sign in link */}
      <div style={{textAlign:"center",fontFamily:MONO2,fontSize:10,color:C2.muted,marginBottom:20}}>
        Already have an account?{" "}
        <span data-testid="preview-pricing-signin" onClick={onSignIn} style={{color:C2.gold,cursor:"pointer",textDecoration:"underline"}}>Sign in →</span>
      </div>

      {/* Benefits strip */}
      <div style={{background:"#0c1220",border:"1px solid #141e35",borderRadius:5,padding:"14px 16px"}}>
        <div style={{fontFamily:MONO2,fontSize:9,color:C2.gold,letterSpacing:"0.16em",marginBottom:10}}>WHY CLVRQUANT</div>
        {[["📡","Live data from Binance WS, Hyperliquid, FMP & Crypto Panic — no delays"],["🤖","CLVR AI uses Claude Sonnet — real market context, not generic answers"],["🏛","SEC Form 4 insider filings updated daily — follow the smart money"],["🔔","Push alerts to your device — never miss a breakout or news event"],["👛","Phantom Wallet integration — track your Solana portfolio in-app"],["🔒","Your data is private and never sold — ever"]].map(([icon,text])=>(
          <div key={text} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
            <span style={{fontSize:12,lineHeight:1.6,flexShrink:0}}>{icon}</span>
            <span style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.6}}>{text}</span>
          </div>
        ))}
      </div>

      <div style={{fontFamily:MONO2,fontSize:8,color:C2.muted,textAlign:"center",marginTop:18,lineHeight:1.7}}>
        CLVRQuant is an information & education platform only. Not financial advice.<br/>Trading involves risk. Past data does not guarantee future results.
      </div>
    </div>
  );
}

function TabUpgradeGate({tab,tier,onUpgrade,C2,MONO2,SERIF2}){
  const isElite=tier==="elite";
  const labels={brief:"Morning Brief",signals:"Quant AI Signals",alerts:"Alerts & Anomalies",wallet:"Phantom Wallet",ai:"AI Market Analyst",insider:"SEC Insider Flow"};
  const features={brief:"Daily AI-generated market brief · 4 curated trade ideas · macro risk scoring",signals:"Full pattern library · Bayesian signal scoring · funding rate anomalies · whale detection",alerts:"Custom price alerts · push notifications · macro event warnings",wallet:"Phantom Wallet · Solana balance · DeFi integration · token tracking",ai:"CLVR AI Market Chat · real-time context · trade ideas · position sizing",insider:"SEC Form 4 insider filings · whale cluster tracking · institutional flow"};
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:380,padding:"32px 24px",textAlign:"center"}}>
      <div style={{fontSize:32,marginBottom:16}}>🔒</div>
      <div style={{fontFamily:SERIF2,fontSize:20,fontWeight:900,color:isElite?"#00e5ff":C2.gold2,marginBottom:6,letterSpacing:"-0.02em"}}>{isElite?"Elite Feature":"Pro Feature"}</div>
      <div style={{fontFamily:MONO2,fontSize:11,color:C2.muted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:16}}>{labels[tab]||tab}</div>
      <div style={{fontFamily:MONO2,fontSize:10,color:C2.muted2,lineHeight:1.8,marginBottom:24,maxWidth:280}}>{features[tab]||"Unlock this feature with an upgrade."}</div>
      <button onClick={onUpgrade} style={{background:isElite?"rgba(0,229,255,.12)":"rgba(201,168,76,.12)",border:`1px solid ${isElite?"rgba(0,229,255,.4)":"rgba(201,168,76,.4)"}`,borderRadius:3,padding:"11px 28px",fontFamily:SERIF2,fontStyle:"italic",fontWeight:700,fontSize:14,color:isElite?"#00e5ff":C2.gold2,cursor:"pointer",letterSpacing:"0.04em",boxShadow:isElite?"0 0 24px rgba(0,229,255,.15)":"0 0 24px rgba(201,168,76,.12)"}}>
        {isElite?"Upgrade to Elite ⚡":"Upgrade to Pro →"}
      </button>
      <div style={{fontFamily:MONO2,fontSize:9,color:C2.muted,marginTop:14,letterSpacing:"0.08em"}}>
        {isElite?"FROM $129/mo · CANCEL ANYTIME":"FROM $29.99/mo · CANCEL ANYTIME"}
      </div>
    </div>
  );
}

// ─── GLOBAL BELL OVERLAY ─────────────────────────────────────────────────────
// Shows NYSE open/close banner + 60-second countdown anywhere on the app
function GlobalBellOverlay({bellFlash,secsToClose}){
  const C2={red:"#ff4060",green:"#00c787",gold:"#c9a84c",white:"#f0f4ff",muted:"#4a5d80"};
  const MONO2="'IBM Plex Mono',monospace";
  if(!bellFlash&&secsToClose===null)return null;
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,pointerEvents:"none"}}>
      {/* 60-second countdown bar before market close */}
      {secsToClose!==null&&secsToClose>0&&(
        <div style={{background:"rgba(5,7,9,.92)",borderBottom:"1px solid rgba(255,64,96,.3)",padding:"6px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:MONO2,fontSize:9,color:C2.red,letterSpacing:"0.14em",fontWeight:700}}>⏱ MARKET CLOSE IN</span>
          <span data-testid="global-countdown-secs" style={{fontFamily:MONO2,fontSize:13,fontWeight:800,color:C2.red}}>{secsToClose}s</span>
          <div style={{position:"absolute",bottom:0,left:0,height:2,background:C2.red,width:`${(secsToClose/60)*100}%`,transition:"width 1s linear",boxShadow:`0 0 6px ${C2.red}`}}/>
        </div>
      )}
      {/* Bell flash banner — NYSE open or close */}
      {bellFlash&&(
        <div style={{
          background:bellFlash==="open"?"rgba(0,199,135,.15)":"rgba(255,64,96,.15)",
          borderBottom:`1px solid ${bellFlash==="open"?"rgba(0,199,135,.5)":"rgba(255,64,96,.5)"}`,
          padding:"10px 14px",textAlign:"center",
          fontFamily:MONO2,fontSize:14,fontWeight:800,letterSpacing:"0.2em",
          color:bellFlash==="open"?C2.green:C2.red,
          animation:"clvrBellPulse 0.6s ease-in-out 3",
        }}>
          {bellFlash==="open"?"🔔 NYSE MARKET OPEN 🔔":"🔔 NYSE MARKET CLOSED 🔔"}
        </div>
      )}
    </div>
  );
}

// ─── SQUAWK BOX (Pro-only TTS signal announcer) ───────────────────────────────
// Unlock helper — must be called inside a user gesture handler
function unlockSpeechSynthesis(){
  try{
    const ss=window.speechSynthesis;
    if(!ss)return;
    ss.cancel();
    const u=new SpeechSynthesisUtterance("");
    u.volume=0;
    ss.speak(u);
  }catch(e){}
}

// Global helper so other components can trigger squawk (macro alerts, kill switch, etc.)
// Stores last call so the SquawkBox effect can react. Priority: 'normal' | 'urgent'
const __squawkQueue = { last: null };
export function emitSquawk(message, priority = "normal") {
  __squawkQueue.last = { message, priority, ts: Date.now() };
  try { window.dispatchEvent(new CustomEvent("clvr-squawk", { detail: __squawkQueue.last })); } catch {}
}

function SquawkBox({signals,soundEnabled,isPro,muted}){
  const lastAnnouncedRef=useRef(null);
  const voiceRef=useRef(null);

  // Load best available voice — prefer professional desk-trader voices
  useEffect(()=>{
    const load=()=>{
      const voices=window.speechSynthesis?.getVoices()||[];
      voiceRef.current=
        voices.find(v=>v.lang==="en-US"&&(v.name.includes("Daniel")||v.name.includes("Alex")||v.name.includes("Google")||v.name.includes("Enhanced")||v.name.includes("Samantha")))
        ||voices.find(v=>v.lang.startsWith("en"))
        ||voices[0]||null;
    };
    load();
    if(window.speechSynthesis)window.speechSynthesis.onvoiceschanged=load;
  },[]);

  // Chrome keep-alive: resume speechSynthesis every 10s so it never silently pauses
  useEffect(()=>{
    if(!isPro||muted||!soundEnabled)return;
    const id=setInterval(()=>{
      try{if(window.speechSynthesis?.paused)window.speechSynthesis.resume();}catch(e){}
    },10000);
    return()=>clearInterval(id);
  },[isPro,muted,soundEnabled]);

  // Internal speak helper with priority tuning
  const speak=useCallback((text,priority="normal")=>{
    if(!isPro||muted||!soundEnabled)return;
    try{
      const ss=window.speechSynthesis;
      if(!ss)return;
      if(ss.paused)ss.resume();
      // For urgent: cancel queue and speak immediately. For normal: queue.
      if(priority==="urgent")ss.cancel();
      const utt=new SpeechSynthesisUtterance(text);
      utt.voice=voiceRef.current;
      utt.rate=priority==="urgent"?1.15:1.05;
      utt.pitch=priority==="urgent"?1.2:0.95;
      utt.volume=priority==="urgent"?1.0:0.85;
      ss.speak(utt);
    }catch(e){}
  },[isPro,muted,soundEnabled]);

  // Announce new signals (normal priority)
  useEffect(()=>{
    if(!isPro||muted||!soundEnabled)return;
    const sig=signals?.[0];
    if(!sig||sig.id===lastAnnouncedRef.current)return;
    lastAnnouncedRef.current=sig.id;
    const score=sig.masterScore?`Master score ${sig.masterScore}.`:"";
    const dir=sig.dir==="LONG"?"long":"short";
    speak(`${sig.token} ${dir} signal. ${score}`,"normal");
  },[signals,isPro,muted,soundEnabled,speak]);

  // Listen for emitSquawk() calls from anywhere in the app (macro, kill switch, big moves)
  useEffect(()=>{
    if(!isPro||muted||!soundEnabled)return;
    const handler=(e)=>{
      const{message,priority}=e.detail||{};
      if(message)speak(message,priority||"normal");
    };
    window.addEventListener("clvr-squawk",handler);
    return()=>window.removeEventListener("clvr-squawk",handler);
  },[isPro,muted,soundEnabled,speak]);

  return null;
}

// ─── AI INPUT (stable, memoized to prevent mobile keyboard retraction) ──
const AIInput=memo(function AIInput({value,onChange,placeholder}){
  const{C}=useContext(ThemeCtx);
  const ref=useRef(null);
  useEffect(()=>{
    if(ref.current&&document.activeElement!==ref.current){
      ref.current.value=value;
    }
  },[value]);
  return<textarea ref={ref} data-testid="input-ai-query" defaultValue={value}
    onChange={e=>onChange(e.target.value)}
    placeholder={placeholder}
    style={{width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:12,color:C.text,fontFamily:"'Barlow',sans-serif",fontSize:16,resize:"none",height:76,lineHeight:1.7}}/>;
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
function PriceRow({sym,d,extra,label,flash,marketClosed}){
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

// Derive a human-readable hold window from signal timeframe
function holdWindowLabel(tf){
  if(!tf)return{label:"Intraday – 24 hrs",sub:"suggested hold window",color:"#00e5ff"};
  const t=tf.toLowerCase().replace(/\s/g,"");
  if(t==="1m"||t==="5m")return{label:"15 – 60 min",sub:"scalp — exit before next candle closes",color:"#f59e0b"};
  if(t==="15m")return{label:"30 min – 3 hrs",sub:"short-term scalp window",color:"#f59e0b"};
  if(t==="30m")return{label:"1 – 6 hrs",sub:"intraday window",color:"#00e5ff"};
  if(t==="1h"||t==="60m")return{label:"2 – 8 hrs",sub:"intraday swing",color:"#00e5ff"};
  if(t==="2h"||t==="120m")return{label:"4 – 12 hrs",sub:"intraday swing",color:"#00e5ff"};
  if(t==="4h"||t==="240m")return{label:"4 hrs – 24 hrs",sub:"intraday to overnight swing",color:"#00e5ff"};
  if(t==="6h")return{label:"6 hrs – 2 days",sub:"short swing",color:"#a78bfa"};
  if(t==="8h")return{label:"8 hrs – 3 days",sub:"short swing",color:"#a78bfa"};
  if(t==="12h")return{label:"12 hrs – 4 days",sub:"swing trade window",color:"#a78bfa"};
  if(t==="1d"||t==="daily")return{label:"1 – 7 days",sub:"swing trade — plan around daily closes",color:"#a78bfa"};
  if(t==="3d")return{label:"3 – 14 days",sub:"medium swing",color:"#d4af37"};
  if(t==="1w"||t==="weekly")return{label:"1 – 4 weeks",sub:"position trade — weekly structure",color:"#d4af37"};
  return{label:"2 hrs – 24 hrs",sub:"intraday default",color:"#00e5ff"};
}

// ─── SIGNAL CARD (stable, outside Dashboard to prevent unmount) ──
function SignalCard({sig,marketData,onShare,onAiAnalyze,onTrade,whaleAlerts:wAlerts,isPro,onUpgrade,regimeName,regimeMult}){
  const{C}=useContext(ThemeCtx);
  const[expanded,setExpanded]=useState(false);
  const[secsLeft,setSecsLeft]=useState(()=>sig.locked?Math.max(0,30*60-Math.floor((Date.now()-sig.ts)/1000)):0);
  useEffect(()=>{
    if(!sig.locked||secsLeft<=0)return;
    const t=setInterval(()=>setSecsLeft(s=>{if(s<=1){clearInterval(t);return 0;}return s-1;}),1000);
    return()=>clearInterval(t);
  },[sig.locked,secsLeft]);
  const isLong=sig.dir==="LONG";
  const dirColor=isLong?C.green:C.red;
  const dirBg=isLong?"rgba(0,199,135,.06)":"rgba(255,64,96,.06)";
  const md=marketData[sig.token]||{};
  const priceMoveAbs=Math.abs(sig.pctMove||0);
  const fundingRate=md.funding||0;
  const oiM=md.oi?Math.round(md.oi/1e6):0;
  const vH=md.volHistory||[];const avgVol=vH.length>=3?vH.slice(-5).reduce((a,b)=>a+b,0)/Math.min(vH.length,5):0;
  const lastVol=vH[vH.length-1]||0;const volumeMultiplier=avgVol>0?lastVol/avgVol:1;
  const{total:computedScore,factors}=scoreSignal({priceMoveAbs,direction:isLong?"long":"short",fundingRate,oiM,volumeMultiplier});
  const qScore=sig.advancedScore!=null?sig.advancedScore:computedScore;
  const isStrong=sig.isStrongSignal||qScore>=80;
  const conviction=qScore>=80?"STRONG":qScore>=70?"HIGH":qScore>=55?"MED":"LOW";
  const convColor=qScore>=80?C.green:qScore>=70?C.green:qScore>=55?C.orange:C.red;
  const moveType=priceMoveAbs>=3?"MAJOR MOVE":priceMoveAbs>=2?"BREAKOUT":"MOMENTUM";
  const minutesAgo=sig.ts?Math.floor((Date.now()-sig.ts)/60000):0;
  const strength=bullProbability({priceMoveAbs,fundingRate,oiM,volumeMultiplier,dir:sig.dir,masterScore:sig.masterScore});
  const whaleMatch=wAlerts&&wAlerts.some(w=>w.sym===sig.token&&Math.abs(w.ts-sig.ts)<300000);
  const isHighConf=qScore>=75;
  return(
    <div data-testid={`signal-card-${sig.id}`} className={isStrong?"high-confidence-glow":whaleMatch?"high-confidence-glow":""} style={{background:C.panel,border:`1px solid ${isStrong?"rgba(0,199,135,.6)":whaleMatch?C.gold+"88":isHighConf?`${dirColor}44`:C.border}`,borderRadius:2,marginBottom:10,overflow:"hidden",transition:"border-color .3s"}}>
      {isStrong&&<div style={{background:"linear-gradient(90deg,rgba(0,199,135,.15),rgba(0,199,135,.05))",borderBottom:"1px solid rgba(0,199,135,.25)",padding:"5px 14px",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontFamily:MONO,fontSize:8,fontWeight:800,color:C.green,letterSpacing:"0.2em"}}>⚡ STRONG SIGNAL — PUSH NOTIFICATION SENT · {sig.advancedScore}/100</span>
      </div>}
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
              {!sig.locked&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(201,168,76,.06)",color:C.gold,border:"1px solid rgba(201,168,76,.25)",fontFamily:MONO,letterSpacing:"0.1em"}}>ALPHA-DETECT</span>}
              {sig.locked&&secsLeft>0&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(255,140,0,.08)",color:"#ff8c00",border:"1px solid rgba(255,140,0,.35)",fontFamily:MONO,letterSpacing:"0.1em"}}>⏱ UNLOCKS {Math.floor(secsLeft/60)}:{String(secsLeft%60).padStart(2,"0")}</span>}
              {sig.locked&&secsLeft===0&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(255,140,0,.08)",color:"#ff8c00",border:"1px solid rgba(255,140,0,.35)",fontFamily:MONO,letterSpacing:"0.1em"}}>⏱ 30M DELAYED</span>}

              {whaleMatch&&<span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:2,background:"rgba(0,212,255,.08)",color:C.cyan,border:"1px solid rgba(0,212,255,.3)",fontFamily:MONO,letterSpacing:"0.08em",animation:"gold-pulse 2s infinite"}}>🐋 {i18n.whaleAligned}</span>}
              {regimeName&&regimeName!=="UNKNOWN"&&regimeMult!=null&&(()=>{
                const multLabel=regimeMult>=1.1?"×1.1":regimeMult<=0.70?"×0.7":regimeMult<=0.80?"×0.8":"×1.0";
                const isBull=["BULL_TREND","BEAR_TREND"].includes(regimeName);
                const isLow=["CRISIS","HIGH_VOLATILITY"].includes(regimeName);
                const rc=isBull?"rgba(0,199,135,.7)":isLow?"rgba(255,64,96,.7)":"rgba(255,200,100,.7)";
                const rbg=isBull?"rgba(0,199,135,.08)":isLow?"rgba(255,64,96,.08)":"rgba(255,200,100,.06)";
                return<span style={{fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:2,background:rbg,color:rc,border:`1px solid ${rc}55`,fontFamily:MONO,letterSpacing:"0.06em",flexShrink:0}}>{regimeName.replace("_"," ")} {multLabel}</span>;
              })()}
              <span style={{fontFamily:MONO,fontSize:9,color:sig.pctMove>0?C.green:C.red,fontWeight:700}}>{sig.pctMove>0?"+":""}{sig.pctMove}%</span>
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{minutesAgo}m ago</span>
            </div>
            <div style={{fontFamily:SANS,fontSize:11,color:C.muted2,marginTop:5,lineHeight:1.55}}>{sig.desc}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:8,marginBottom:6,position:"relative"}}>
              <div style={{background:"rgba(0,0,0,.25)",border:`1px solid ${C.border}`,borderRadius:2,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.08em"}}>📍 Entry</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.white,filter:sig.locked?"blur(5px)":"none",userSelect:sig.locked?"none":"auto"}}>{sig.entry?fmt(sig.entry,sig.token):fmt(md.price,sig.token)}</div>
              </div>
              <div style={{background:"rgba(255,64,96,.04)",border:`1px solid rgba(255,64,96,.25)`,borderRadius:2,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:C.red+"99",letterSpacing:"0.08em"}}>🛑 Stop{!sig.locked&&sig.stopPct?` −${sig.stopPct}%`:""}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.red,filter:sig.locked?"blur(5px)":"none",userSelect:sig.locked?"none":"auto"}}>{sig.stopLoss?fmt(sig.stopLoss,sig.token):"—"}</div>
              </div>
              <div style={{background:"rgba(0,199,135,.05)",border:`1px solid rgba(0,199,135,.25)`,borderRadius:2,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:C.green+"99",letterSpacing:"0.08em"}}>🎯 TP1{!sig.locked&&sig.tp1Pct?` +${sig.tp1Pct}%`:""}{!sig.locked&&sig.rr1?` · ${sig.rr1}:1`:""}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.green,filter:sig.locked?"blur(5px)":"none",userSelect:sig.locked?"none":"auto"}}>{sig.tp1?fmt(sig.tp1,sig.token):sig.target?fmt(sig.target,sig.token):"—"}</div>
              </div>
              <div style={{background:"rgba(0,199,135,.02)",border:`1px solid rgba(0,199,135,.14)`,borderRadius:2,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:C.green+"66",letterSpacing:"0.08em"}}>🎯 TP2{!sig.locked&&sig.tp2Pct?` +${sig.tp2Pct}%`:""}{!sig.locked&&sig.rr2?` · ${sig.rr2}:1`:""}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.green+"aa",filter:sig.locked?"blur(5px)":"none",userSelect:sig.locked?"none":"auto"}}>{sig.tp2?fmt(sig.tp2,sig.token):"—"}</div>
              </div>
              {sig.locked&&(
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                  <div style={{background:"rgba(5,7,9,.7)",backdropFilter:"blur(2px)",borderRadius:3,padding:"4px 10px",fontFamily:MONO,fontSize:8,color:"#ff8c00",letterSpacing:"0.12em",border:"1px solid rgba(255,140,0,.25)"}}>🔒 UPGRADE FOR PRICE LEVELS</div>
                </div>
              )}
            </div>
            {/* Hold window — always visible */}
            {(()=>{const hw=holdWindowLabel(sig.timeframe);return(
              <div style={{background:`rgba(0,0,0,.2)`,border:`1px solid ${hw.color}33`,borderRadius:2,padding:"7px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em"}}>⏳ HOLD WINDOW</div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
                  <div style={{fontFamily:MONO,fontSize:11,fontWeight:800,color:hw.color}}>{hw.label}</div>
                  <div style={{fontFamily:MONO,fontSize:7,color:C.muted}}>{hw.sub}</div>
                </div>
              </div>
            );})()}
            {sig.macroFlags&&sig.macroFlags.length>0&&<div style={{background:"rgba(255,64,96,.06)",border:"1px solid rgba(255,64,96,.25)",borderRadius:2,padding:"5px 10px",marginBottom:6,fontFamily:MONO,fontSize:9,color:C.red,lineHeight:1.6}}>⚠️ {sig.macroFlags[0]}</div>}
            <div style={{marginTop:4,marginBottom:6,paddingRight:56}}>
              <StrengthMeter value={strength} C={C}/>
            </div>
            <div style={{display:"flex",gap:4,marginTop:7,flexWrap:"wrap",alignItems:"center"}}>
              {sig.tags.map((tg,j)=><Badge key={j} label={tg.l} color={tg.c}/>)}
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.border}`,color:C.purple,fontFamily:MONO,letterSpacing:"0.08em"}}>{moveType}</span>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.border}`,color:C.muted2,fontFamily:MONO}}>⚡ {sig.lev||"2x"}</span>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${convColor}44`,color:convColor,fontFamily:MONO,fontWeight:700}}>📊 {conviction}</span>
              {sig.timeframe&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.gold}44`,color:C.gold,fontFamily:MONO}}>⏱ {sig.timeframe}</span>}
              {sig.session&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.border}`,color:C.muted2,fontFamily:MONO}}>{sig.session}</span>}
              {volumeMultiplier>1.5&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:C.bg,border:`1px solid ${C.cyan}44`,color:C.cyan,fontFamily:MONO}}>Vol {volumeMultiplier.toFixed(1)}x</span>}
            </div>
          </div>
          <ScoreRing score={qScore} C={C}/>
        </div>
      </div>
      {expanded&&<div style={{padding:"0 14px 14px",position:"relative"}}>
        {sig.locked&&<div style={{position:"absolute",inset:0,zIndex:10,backdropFilter:"blur(8px)",background:"rgba(5,7,9,.88)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,borderRadius:2,padding:"12px 16px"}}>
          <span style={{fontSize:26}}>🔒</span>
          <div style={{fontFamily:SERIF,fontWeight:900,fontSize:15,color:C.gold2,textAlign:"center"}}>Pro Signal Intelligence</div>
          <div style={{display:"flex",flexDirection:"column",gap:4,width:"100%",maxWidth:220}}>
            {[["📍","Entry, Stop-Loss & Take-Profit"],["📊","AI Confidence Breakdown"],["🧠","Full AI Trade Reasoning"],["🎯","Score Factors & Checks"]].map(([icon,txt])=>(
              <div key={txt} style={{display:"flex",alignItems:"center",gap:6,fontFamily:MONO,fontSize:8,color:C.muted2,lineHeight:1.5}}>
                <span style={{flexShrink:0}}>{icon}</span><span>{txt}</span>
              </div>
            ))}
          </div>
          <button data-testid="btn-upgrade-signal" onClick={onUpgrade} style={{background:"rgba(201,168,76,.14)",border:`1px solid rgba(201,168,76,.4)`,borderRadius:4,padding:"9px 22px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,cursor:"pointer",marginTop:2}}>Upgrade to Pro →</button>
        </div>}
        {sig.reasoning&&sig.reasoning.length>0&&<div style={{background:"rgba(201,168,76,.04)",border:`1px solid ${C.gold}22`,borderRadius:2,padding:"10px 12px",marginBottom:10}}>
          <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.15em",marginBottom:6}}>AI TRADE REASONING</div>
          {sig.reasoning.map((r,i)=><div key={i} style={{fontFamily:MONO,fontSize:10,color:C.muted2,lineHeight:1.7,display:"flex",gap:6,marginBottom:2}}><span style={{color:C.gold,flexShrink:0}}>•</span><span>{r}</span></div>)}
          {sig.masterScore&&<div style={{marginTop:6,fontFamily:MONO,fontSize:9,color:sig.masterScore>=60?C.green:sig.masterScore>=40?C.orange:C.red,fontWeight:700}}>{i18n.masterScore}: {sig.masterScore}/100 · Risk-On: {sig.riskOn||50}%</div>}
        </div>}
        {sig.checks&&sig.checks.length>0&&<div style={{background:"rgba(0,0,0,.2)",border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px",marginBottom:10}}>
          <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em",marginBottom:7,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>SIGNAL QUALITY CHECKS</span>
            <span style={{color:sig.checksPassedCount>=4?C.green:sig.checksPassedCount>=3?C.orange:C.red,fontWeight:700}}>{sig.checksPassedCount}/{sig.checksTotalCount} PASSED</span>
          </div>
          {sig.checks.map((c,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:5,fontFamily:MONO,fontSize:10,lineHeight:1.5}}>
              <span style={{flexShrink:0,fontSize:12}}>{c.pass?"✅":"⚠️"}</span>
              <div>
                <span style={{color:c.pass?C.white:C.orange}}>{c.label}</span>
                {!c.pass&&<span style={{color:C.muted,fontSize:9}}> — {c.detail}</span>}
              </div>
            </div>
          ))}
        </div>}
        {sig.scoreBreakdown?<AdvancedFactorBreakdown breakdown={sig.scoreBreakdown} C={C}/>:<FactorBreakdown factors={factors} score={qScore} C={C}/>}
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
  // Hold inference: for rate decisions where forecast === previous (a hold was priced in)
  // and the official actual hasn't arrived yet from ForexFactory, infer the result = HOLD
  const isRateDecision=(evt.name||"").toLowerCase().match(/rate|fomc|interest/);
  const holdInferred=!evt.actual&&evt.isPast&&evt.impact==="HIGH"&&isRateDecision&&
    evt.forecast&&evt.forecast!=="—"&&evt.previous&&evt.previous!=="—"&&
    evt.forecast===evt.previous;
  const displayActual=evt.actual||(holdInferred?evt.forecast:null);
  const isEffectivelyReleased=evt.released||holdInferred;
  return(
    <div data-testid={`macro-card-${evt.id}`} style={{background:C.panel,border:`1px solid ${isEffectivelyReleased?(surprise?.color===C.red?C.red+"22":surprise?.color===C.green?C.green+"22":C.border):evt.isPast?C.border:imp.color+"22"}`,borderRadius:2,marginBottom:8,overflow:"hidden",opacity:(isEffectivelyReleased||evt.isPast)?1:0.88}}>
      <div style={{padding:"12px 14px",cursor:"pointer"}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
          <div style={{textAlign:"center",minWidth:40,flexShrink:0}}>
            <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:(isEffectivelyReleased||evt.isPast)?C.muted:C.white}}>{(evt.timeET||evt.time||"").replace(" ET","")}</div>
            <div style={{fontSize:16,marginTop:2}}>{evt.flag||({"US":"\u{1F1FA}\u{1F1F8}","EU":"\u{1F1EA}\u{1F1FA}","UK":"\u{1F1EC}\u{1F1E7}","CA":"\u{1F1E8}\u{1F1E6}","JP":"\u{1F1EF}\u{1F1F5}","AU":"\u{1F1E6}\u{1F1FA}","CH":"\u{1F1E8}\u{1F1ED}","NZ":"\u{1F1F3}\u{1F1FF}"}[evt.country])||"\u{1F310}"}</div>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:4}}>
              <span style={{fontFamily:SERIF,fontSize:12,fontWeight:700,color:(isEffectivelyReleased||evt.isPast)?C.muted2:C.white}}>{evt.name}</span>
              {isLiveNow&&<span style={{fontFamily:MONO,fontSize:7,background:"rgba(0,199,135,.12)",border:"1px solid rgba(0,199,135,.3)",color:C.green,borderRadius:2,padding:"1px 5px",fontWeight:700,letterSpacing:"0.1em",animation:"pulse 1.4s ease infinite"}}>LIVE NOW</span>}
              <span style={{fontFamily:MONO,fontSize:7,background:imp.bg,color:imp.color,border:`1px solid ${imp.color}33`,borderRadius:2,padding:"1px 5px",fontWeight:700,letterSpacing:"0.08em"}}>{imp.label}</span>
              {evt.released&&surprise&&<span style={{fontFamily:MONO,fontSize:7,background:"rgba(0,0,0,.3)",border:`1px solid ${surprise.color}33`,color:surprise.color,borderRadius:2,padding:"1px 5px",fontWeight:700}}>{surprise.label}</span>}
              {isEffectivelyReleased&&!surprise&&<span style={{fontFamily:MONO,fontSize:7,color:C.green,border:`1px solid ${C.green}33`,borderRadius:2,padding:"1px 5px"}}>{holdInferred?"HOLD":"RELEASED"}</span>}
              {!isEffectivelyReleased&&evt.isPast&&!displayActual&&evt.impact==="HIGH"&&<span style={{fontFamily:MONO,fontSize:7,color:C.orange,border:`1px solid ${C.orange}44`,borderRadius:2,padding:"1px 5px",animation:"pulse 1.6s ease infinite"}}>AWAITING RESULT</span>}
              {!isEffectivelyReleased&&evt.isPast&&(displayActual||evt.impact!=="HIGH")&&<span style={{fontFamily:MONO,fontSize:7,color:C.muted,border:`1px solid ${C.border}`,borderRadius:2,padding:"1px 5px"}}>RELEASED</span>}
              {!isEffectivelyReleased&&!evt.isPast&&<span style={{fontFamily:MONO,fontSize:7,color:C.muted,border:`1px solid ${C.border}`,borderRadius:2,padding:"1px 5px"}}>PENDING</span>}
              {isToday&&!isLiveNow&&!evt.isPast&&<span style={{fontFamily:MONO,fontSize:7,color:C.red,border:`1px solid ${C.red}33`,borderRadius:2,padding:"1px 5px",animation:"pulse 1.4s ease infinite"}}>TODAY</span>}
              {evt.live&&<span style={{fontFamily:MONO,fontSize:7,color:C.green,border:`1px solid ${C.green}33`,borderRadius:2,padding:"1px 5px"}}>LIVE</span>}
            </div>
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginBottom:6}}>{evt.region||evt.country} · {evt.date}</div>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              {displayActual&&<div><div style={{fontFamily:MONO,fontSize:7,color:holdInferred?C.muted:C.muted,marginBottom:1}}>ACTUAL</div><div style={{fontFamily:MONO,fontSize:15,fontWeight:800,color:holdInferred?C.muted2:surprise?.color||C.white}}>{displayActual}<span style={{fontSize:8,color:C.muted,marginLeft:2}}>{evt.unit||""}{holdInferred?" (hold)":""}</span></div></div>}
              {!displayActual&&evt.isPast&&evt.impact==="HIGH"&&<div><div style={{fontFamily:MONO,fontSize:7,color:C.orange,marginBottom:1}}>ACTUAL</div><div style={{fontFamily:MONO,fontSize:10,fontWeight:600,color:C.orange,animation:"pulse 1.6s ease infinite"}}>AWAITING…</div></div>}
              {!displayActual&&evt.isPast&&evt.impact!=="HIGH"&&<div><div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginBottom:1}}>ACTUAL</div><div style={{fontFamily:MONO,fontSize:13,fontWeight:600,color:C.muted}}>—</div></div>}
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

// ─── MACRO ACTUAL INFERENCE (hold detection for AI context) ──
// Returns the best-known actual for a macro event.
// If ForexFactory hasn't published yet but forecast===previous for a rate decision, infer a hold.
function macroActualLabel(e){
  if(e.actual)return{actual:e.actual,tag:e.released?"✓RELEASED":"✓"};
  const isRateDec=(e.name||"").match(/rate|fomc|interest/i);
  if(e.isPast&&e.impact==="HIGH"&&isRateDec&&
     e.forecast&&e.forecast!=="—"&&e.previous&&e.previous!=="—"&&e.forecast===e.previous){
    return{actual:e.forecast,tag:"✓HOLD (FF pending)"};
  }
  return{actual:null,tag:null};
}

// ─── HELP FAQ ITEM (accordion) ────────────────────────────
function HelpItem({q,a}){
  const [open,setOpen]=useState(false);
  return(
    <div style={{borderBottom:`1px solid ${C.border}`,paddingBottom:8,marginBottom:8}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",background:"none",border:"none",padding:"8px 0",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,cursor:"pointer",textAlign:"left"}}>
        <span style={{fontFamily:SANS,fontSize:13,fontWeight:600,color:C.white,lineHeight:1.5,flex:1}}>{q}</span>
        <span style={{fontFamily:MONO,fontSize:12,color:C.muted,flexShrink:0,marginTop:2}}>{open?"▲":"▼"}</span>
      </button>
      {open&&<div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.85,paddingBottom:4}}>{a}</div>}
    </div>
  );
}


// ─── TRACK RECORD TAB ─────────────────────────────────────
// ─── PERFORMANCE HIGHLIGHTS (curated, public) ─────────────────
// Replaces the old public-facing track-record snapshot. Shows ONLY:
//   - Overall win rate of signals users actually receive (suppressed-excluded)
//   - Top 3 token/direction combos with sample size >= 25
// No losing combos, no negative PnL headlines.
function PerformanceHighlights(){
  const [data,setData]=useState(null);
  const [err,setErr]=useState(false);
  useEffect(()=>{
    let on=true;
    fetch("/api/performance-highlights",{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(d=>{if(on)setData(d);})
      .catch(()=>{if(on)setErr(true);});
    return()=>{on=false;};
  },[]);
  if(err||!data||data.overallWinRate==null||data.sampleSize<25)return null;
  const wr=data.overallWinRate;
  const wrColor=wr>=55?C.green:wr>=45?C.gold:C.muted2;
  return(
    <div data-testid="panel-performance-highlights" style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:4,padding:"12px 14px",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.18em"}}>PERFORMANCE HIGHLIGHTS · LAST {data.windowDays}D</div>
        <div style={{fontFamily:MONO,fontSize:7,color:C.muted2,letterSpacing:"0.1em"}}>n={data.sampleSize}</div>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12}}>
        <div data-testid="text-overall-winrate" style={{fontFamily:SERIF,fontSize:32,fontWeight:900,color:wrColor,letterSpacing:"-0.02em"}}>{wr}%</div>
        <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>overall win rate · published signals only</div>
      </div>
      {data.topCombos&&data.topCombos.length>0&&<>
        <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em",marginBottom:6}}>TOP PERFORMING SETUPS</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {data.topCombos.map((c,i)=>(
            <div key={`${c.token}-${c.direction}`} data-testid={`row-top-combo-${i}`} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 8px",background:C.bg,borderRadius:3,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:MONO,fontSize:11,color:C.text,fontWeight:700}}>{c.token}</span>
                <span style={{fontFamily:MONO,fontSize:8,color:c.direction==="LONG"?C.green:C.red,letterSpacing:"0.1em"}}>{c.direction}</span>
              </div>
              <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                <span style={{fontFamily:MONO,fontSize:13,fontWeight:800,color:c.winRate>=55?C.green:C.gold}}>{c.winRate}%</span>
                <span style={{fontFamily:MONO,fontSize:7,color:C.muted}}>n={c.n}</span>
              </div>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// ── ADMIN: Rejection tuning dashboard (admin-only via /api/admin/rejections) ──
// Surfaces why the auto-scanner is killing setups so we can tune thresholds
// without flying blind. Backed by signal_rejections table (30d retention).
function AdminRejectionsTab(){
  const{C}=useContext(ThemeCtx);
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState(null);
  const[windowParam,setWindowParam]=useState("24h");
  const[asset,setAsset]=useState("");
  const fetchData=async()=>{
    setLoading(true);setErr(null);
    try{
      const qs=new URLSearchParams({window:windowParam,limit:"100"});
      if(asset.trim())qs.set("asset",asset.trim().toUpperCase());
      const r=await fetch(`/api/admin/rejections?${qs}`,{credentials:"include"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();setData(j);
    }catch(e){setErr(e.message||"Failed to load");}
    finally{setLoading(false);}
  };
  useEffect(()=>{fetchData();},[windowParam]);
  const reasonColor=(reason)=>{
    if(reason?.startsWith("SL_"))return"#ef4444";
    if(reason?.includes("CROWDED"))return"#f59e0b";
    if(reason==="COUNTER_TREND_MICRO")return"#a855f7";
    if(reason?.startsWith("RR_"))return"#06b6d4";
    return"#888";
  };
  const fmtTs=(ts)=>{const d=new Date(ts);return`${d.toLocaleDateString()} ${d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;};
  return(<div data-testid="page-admin-rejections" style={{padding:"16px",color:C.text,maxWidth:1200,margin:"0 auto"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12}}>
      <div>
        <div style={{fontSize:18,fontWeight:800,letterSpacing:"0.04em"}}>SIGNAL REJECTIONS</div>
        <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>Mechanical-gate kill log · admin only · 30d retention</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <input data-testid="input-asset-filter" placeholder="Asset (e.g. BTC)" value={asset} onChange={(e)=>setAsset(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&fetchData()} style={{padding:"6px 10px",fontSize:11,background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,borderRadius:4,color:C.text,fontFamily:"monospace",width:120}}/>
        <select data-testid="select-window" value={windowParam} onChange={(e)=>setWindowParam(e.target.value)} style={{padding:"6px 10px",fontSize:11,background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,borderRadius:4,color:C.text,fontFamily:"monospace"}}>
          <option value="1h">1h</option><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option><option value="all">all</option>
        </select>
        <button data-testid="button-refresh-rejections" onClick={fetchData} disabled={loading} style={{padding:"6px 14px",fontSize:11,fontWeight:700,background:C.accent,color:"#000",border:"none",borderRadius:4,cursor:loading?"wait":"pointer",fontFamily:"monospace",letterSpacing:"0.04em"}}>{loading?"…":"REFRESH"}</button>
      </div>
    </div>
    {err&&<div data-testid="text-error" style={{padding:12,background:"rgba(239,68,68,0.1)",border:"1px solid #ef444455",borderRadius:4,color:"#ef4444",fontSize:12,marginBottom:12}}>Error: {err}</div>}
    {loading&&!data&&<div style={{padding:24,textAlign:"center",color:C.textMuted,fontSize:12}}>Loading…</div>}
    {data&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:16}}>
        <div style={{padding:12,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,borderRadius:4}}>
          <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.06em",marginBottom:4}}>TOTAL</div>
          <div data-testid="text-total-rejections" style={{fontSize:22,fontWeight:800,fontFamily:"monospace"}}>{data.totalRejections??data.recent?.length??0}</div>
        </div>
        <div style={{padding:12,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,borderRadius:4}}>
          <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.06em",marginBottom:4}}>WINDOW</div>
          <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:C.accent}}>{data.window||windowParam}</div>
        </div>
        <div style={{padding:12,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,borderRadius:4}}>
          <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.06em",marginBottom:4}}>SOURCE</div>
          <div style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:data.source==="db"?"#22c55e":"#f59e0b"}}>{data.source||"memory"}</div>
        </div>
      </div>

      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",marginBottom:8,color:C.textMuted}}>BY REASON</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:8}}>
          {(data.byReason||[]).length===0&&<div style={{fontSize:11,color:C.textMuted,fontStyle:"italic",padding:8}}>No rejections in window</div>}
          {(data.byReason||[]).map(r=>(
            <div key={r.reason} data-testid={`row-reason-${r.reason}`} style={{padding:10,background:"rgba(255,255,255,0.03)",border:`1px solid ${reasonColor(r.reason)}55`,borderRadius:4}}>
              <div style={{fontSize:10,fontWeight:800,color:reasonColor(r.reason),fontFamily:"monospace",marginBottom:4}}>{r.reason}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace"}}>{r.count}</div>
                <div style={{fontSize:10,color:C.textMuted,fontFamily:"monospace"}}>{r.pct}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(data.byAsset||[]).length>0&&<div style={{marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",marginBottom:8,color:C.textMuted}}>TOP ASSETS</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {data.byAsset.map(a=>(
            <span key={a.token} data-testid={`badge-asset-${a.token}`} onClick={()=>{setAsset(a.token);setTimeout(fetchData,0);}} style={{padding:"4px 10px",fontSize:10,fontWeight:700,fontFamily:"monospace",background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,borderRadius:3,cursor:"pointer"}}>{a.token} <span style={{color:C.textMuted,marginLeft:4}}>{a.count}</span></span>
          ))}
        </div>
      </div>}

      <div>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",marginBottom:8,color:C.textMuted}}>RECENT ({data.recent?.length||0})</div>
        <div style={{maxHeight:500,overflow:"auto",border:`1px solid ${C.border}`,borderRadius:4}}>
          <table data-testid="table-rejections" style={{width:"100%",fontSize:11,fontFamily:"monospace",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)"}}>
              <tr style={{textAlign:"left",color:C.textMuted}}>
                <th style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>Time</th>
                <th style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>Asset</th>
                <th style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>Dir</th>
                <th style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>Reason</th>
                <th style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(data.recent||[]).map((row,i)=>(
                <tr key={row.id||i} data-testid={`row-rejection-${i}`} style={{borderBottom:`1px solid ${C.border}33`}}>
                  <td style={{padding:"6px 10px",color:C.textMuted,whiteSpace:"nowrap"}}>{fmtTs(row.ts)}</td>
                  <td style={{padding:"6px 10px",fontWeight:700}}>{row.token}</td>
                  <td style={{padding:"6px 10px",color:row.direction==="LONG"?"#22c55e":row.direction==="SHORT"?"#ef4444":C.textMuted}}>{row.direction||"—"}</td>
                  <td style={{padding:"6px 10px",color:reasonColor(row.reason),fontWeight:700,whiteSpace:"nowrap"}}>{row.reason}</td>
                  <td style={{padding:"6px 10px",color:C.textMuted,wordBreak:"break-word"}}>{row.detail}</td>
                </tr>
              ))}
              {(!data.recent||data.recent.length===0)&&<tr><td colSpan={5} style={{padding:24,textAlign:"center",color:C.textMuted,fontStyle:"italic"}}>No rejections recorded</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>}
  </div>);
}

function TrackRecordTab({isPro,onUpgrade}){
  const{C}=useContext(ThemeCtx);
  const[stats,setStats]=useState(null);
  const[history,setHistory]=useState([]);
  const[histLocked,setHistLocked]=useState(false);
  const[loading,setLoading]=useState(true);
  const[refreshing,setRefreshing]=useState(false);
  const[lastFetch,setLastFetch]=useState(null);
  const fetchData=useCallback((isManual=false)=>{
    if(isManual)setRefreshing(true);
    Promise.all([
      fetch("/api/track-record",{credentials:"include"}).then(r=>r.json()).catch(()=>null),
      fetch("/api/signal-history?limit=30",{credentials:"include"}).then(r=>r.json()).catch(()=>({signals:[],isPaidUser:false})),
    ]).then(([s,h])=>{
      if(s)setStats(s);
      setHistory(h.signals||[]);
      setHistLocked(!isPro);
      setLastFetch(new Date());
    }).finally(()=>{setLoading(false);setRefreshing(false);});
  },[isPro]);
  useEffect(()=>{
    fetchData();
    const iv=setInterval(()=>fetchData(),60000);
    return()=>clearInterval(iv);
  },[fetchData]);
  const panel2={background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,marginBottom:10};
  const winRate=stats?.winRate||0;
  const winColor=winRate>=60?C.green:winRate>=50?C.orange:C.red;
  const maxBar=stats?.weeklyData?Math.max(...stats.weeklyData.map(w=>w.wins+w.losses),1):1;
  if(loading)return<div style={{padding:32,textAlign:"center",fontFamily:MONO,fontSize:10,color:C.muted}}>Loading track record…</div>;
  return(<>
    <div style={{...panel2,border:`1px solid rgba(201,168,76,.18)`}}>
      <div style={{padding:"22px 18px 12px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{textAlign:"center",flex:1}}>
            <div style={{fontFamily:SERIF,fontSize:22,fontWeight:900,color:C.white}}>Signal <span style={{color:C.gold}}>Track Record</span></div>
            <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.3em",marginTop:4}}>LIVE PERFORMANCE ANALYTICS</div>
          </div>
          <button data-testid="btn-refresh-track-record" onClick={()=>fetchData(true)} disabled={refreshing} style={{flexShrink:0,fontFamily:MONO,fontSize:8,color:refreshing?C.muted:C.gold,background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,${refreshing?".1":".3"})`,borderRadius:3,padding:"5px 10px",cursor:refreshing?"default":"pointer",letterSpacing:"0.1em",transition:"all .2s"}}>{refreshing?"REFRESHING…":"↻ REFRESH"}</button>
        </div>
        {!stats?.total&&<div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:10,lineHeight:1.9,textAlign:"center"}}>Track record builds in real-time — signals are logged when assets move 0.8%+ in a 5-min window, then outcomes auto-resolve every 30 min. In low-volatility markets, fewer signals fire.<br/><span style={{color:C.gold,fontSize:7}}>Data accumulates automatically as the market generates qualifying moves.</span></div>}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
      {[
        {l:"WIN RATE",v:`${winRate}%`,c:winColor,s:"resolved signals"},
        {l:"TOTAL SIGNALS",v:stats?.total||0,c:C.white,s:"all-time tracked"},
        {l:"AVG PnL",v:stats?.avgPnl!=null&&stats.avgPnl!==0?`${stats.avgPnl>=0?"+":""}${stats.avgPnl}%`:"—",c:stats?.avgPnl!=null&&stats.avgPnl<0?C.red:C.green,s:"per resolved signal"},
        {l:"WINS / LOSSES",v:`${stats?.wins||0} / ${stats?.losses||0}`,c:C.muted2,s:"resolved outcomes"},
      ].map(({l,v,c,s})=>(
        <div key={l} style={{...panel2,marginBottom:0,padding:"14px",textAlign:"center"}}>
          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.12em",marginBottom:4}}>{l}</div>
          <div style={{fontFamily:MONO,fontSize:18,fontWeight:800,color:c}}>{v}</div>
          <div style={{fontFamily:MONO,fontSize:7,color:C.muted2,marginTop:2}}>{s}</div>
        </div>
      ))}
    </div>
    {stats?.weeklyData&&stats.weeklyData.length>0&&(
      <div style={panel2}>
        <div style={{padding:"12px 16px 16px"}}>
          <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.2em",marginBottom:12}}>WEEKLY WIN / LOSS</div>
          <div style={{display:"flex",gap:4,alignItems:"flex-end",height:72}}>
            {stats.weeklyData.map((w,i)=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:56,gap:2}}>
                  <div style={{width:"100%",height:`${Math.max((w.wins/maxBar)*48,2)}px`,background:C.gold+"99",borderRadius:"2px 2px 0 0",minHeight:2,boxShadow:`0 0 6px ${C.gold}44`}}/>
                  <div style={{width:"100%",height:`${Math.max((w.losses/maxBar)*48,2)}px`,background:C.red+"66",borderRadius:"2px 2px 0 0",minHeight:2}}/>
                </div>
                <div style={{fontFamily:MONO,fontSize:6,color:C.muted,marginTop:2}}>{w.week?.slice(5)||""}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:14,marginTop:8}}>
            <span style={{fontFamily:MONO,fontSize:7,color:C.gold}}>■ Wins</span>
            <span style={{fontFamily:MONO,fontSize:7,color:C.red}}>■ Losses</span>
          </div>
        </div>
      </div>
    )}
    {!isPro&&(
      <div style={{...panel2,background:"rgba(0,212,255,.03)",border:`1px solid rgba(0,212,255,.15)`}}>
        <div style={{padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:MONO,fontSize:8,color:C.cyan,letterSpacing:"0.18em",marginBottom:4}}>ASSET BREAKDOWN — PRO</div>
            <div style={{fontFamily:MONO,fontSize:9,color:C.muted2}}>Win rate & avg PnL per token, LONG vs SHORT split</div>
          </div>
          <button onClick={onUpgrade} style={{flexShrink:0,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:11,color:C.gold2,background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:4,padding:"6px 14px",cursor:"pointer"}}>Unlock →</button>
        </div>
      </div>
    )}
    {isPro&&stats?.byAsset&&stats.byAsset.length>0&&(
      <div style={panel2}>
        <div style={{padding:"12px 16px"}}>
          <div style={{fontFamily:MONO,fontSize:9,color:C.cyan,letterSpacing:"0.2em",marginBottom:10}}>BREAKDOWN BY ASSET</div>
          {stats.byAsset.map(a=>(
            <div key={a.token} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontFamily:MONO,fontSize:12,fontWeight:800,color:C.white,width:52}}>{a.token}</span>
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>{a.total} signals</span>
              <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:a.winRate>=60?C.green:C.orange}}>{a.winRate}% W</span>
              <span style={{fontFamily:MONO,fontSize:9,color:a.avgPnl>=0?C.green:C.red}}>{a.avgPnl>=0?"+":""}{a.avgPnl}%</span>
            </div>
          ))}
        </div>
      </div>
    )}
    {isPro&&stats?.byDirection&&(
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        {stats.byDirection.map(d=>(
          <div key={d.direction} style={{...panel2,marginBottom:0,padding:"14px",textAlign:"center"}}>
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em",marginBottom:5}}>{d.direction}</div>
            <div style={{fontFamily:MONO,fontSize:20,fontWeight:800,color:d.direction==="LONG"?C.green:C.red}}>{d.winRate}%</div>
            <div style={{fontFamily:MONO,fontSize:7,color:C.muted2}}>{d.total} signals</div>
          </div>
        ))}
      </div>
    )}
    <div style={panel2}>
      <div style={{padding:"12px 16px 8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.2em"}}>SIGNAL HISTORY</div>
        {histLocked&&<span style={{fontFamily:MONO,fontSize:8,color:C.orange}}>🔒 Pro & Elite</span>}
      </div>
      {histLocked&&(
        <div style={{margin:"0 12px 12px",background:"rgba(201,168,76,.04)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:4,padding:"14px 16px"}}>
          <div style={{fontFamily:SERIF,fontSize:13,fontWeight:700,color:C.gold2,marginBottom:8}}>What Pro unlocks in Signal History</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
            {[["📍","Entry, TP & Stop-Loss prices"],["📊",`PnL % per resolved signal`],["🏆","Asset-by-asset win rates"],["🧠","Full AI reasoning per trade"]].map(([icon,txt])=>(
              <div key={txt} style={{display:"flex",alignItems:"center",gap:6,fontFamily:MONO,fontSize:8,color:C.muted2}}>
                <span style={{flexShrink:0,fontSize:11}}>{icon}</span><span>{txt}</span>
              </div>
            ))}
          </div>
          <button data-testid="btn-unlock-history" onClick={onUpgrade} style={{width:"100%",padding:"9px 0",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,background:"rgba(201,168,76,.12)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:4,cursor:"pointer"}}>Upgrade to Pro — from $29.99/mo →</button>
        </div>
      )}
      {history.length===0?(
        <div style={{padding:"24px 16px",textAlign:"center",fontFamily:MONO,fontSize:9,color:C.muted}}>Signal history is building — new signals are tracked automatically.</div>
      ):(histLocked?history.slice(0,5):history).map(sig=>(
        <div key={sig.id} style={{borderTop:`1px solid ${C.border}`,padding:"10px 16px",position:"relative"}}>
          {histLocked?(
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontFamily:MONO,fontSize:9,padding:"2px 6px",borderRadius:2,background:sig.direction==="LONG"?"rgba(0,199,135,.08)":"rgba(255,64,96,.08)",color:sig.direction==="LONG"?C.green:C.red,border:`1px solid ${sig.direction==="LONG"?C.green:C.red}44`,fontWeight:700}}>{sig.direction}</span>
              <span style={{fontFamily:MONO,fontSize:12,fontWeight:800,color:C.white}}>{sig.token}</span>
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{new Date(sig.ts).toLocaleDateString()}</span>
              <span style={{fontFamily:MONO,fontSize:9,padding:"2px 6px",borderRadius:2,background:sig.outcome==="WIN"?"rgba(0,199,135,.08)":sig.outcome==="LOSS"?"rgba(255,64,96,.08)":"rgba(255,140,0,.06)",color:sig.outcome==="WIN"?C.green:sig.outcome==="LOSS"?C.red:C.orange,border:`1px solid ${sig.outcome==="WIN"?C.green:sig.outcome==="LOSS"?C.red:C.orange}44`,fontWeight:700}}>{sig.outcome}</span>
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted,filter:"blur(4px)",userSelect:"none"}}>Entry: ████ · TP1: ████ · SL: ████</span>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontFamily:MONO,fontSize:9,padding:"2px 6px",borderRadius:2,background:sig.direction==="LONG"?"rgba(0,199,135,.08)":"rgba(255,64,96,.08)",color:sig.direction==="LONG"?C.green:C.red,border:`1px solid ${sig.direction==="LONG"?C.green:C.red}44`,fontWeight:700}}>{sig.direction}</span>
              <span style={{fontFamily:MONO,fontSize:12,fontWeight:800,color:C.white}}>{sig.token}</span>
              {sig.entry&&<span style={{fontFamily:MONO,fontSize:9,color:C.muted2}}>Entry: {parseFloat(sig.entry).toLocaleString()}</span>}
              {sig.tp1&&<span style={{fontFamily:MONO,fontSize:9,color:C.green}}>TP1: {parseFloat(sig.tp1).toLocaleString()}</span>}
              {sig.stopLoss&&<span style={{fontFamily:MONO,fontSize:9,color:C.red}}>SL: {parseFloat(sig.stopLoss).toLocaleString()}</span>}
              <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{new Date(sig.ts).toLocaleDateString()}</span>
              <span style={{fontFamily:MONO,fontSize:9,padding:"2px 6px",borderRadius:2,background:sig.outcome==="WIN"?"rgba(0,199,135,.08)":sig.outcome==="LOSS"?"rgba(255,64,96,.08)":"rgba(255,140,0,.06)",color:sig.outcome==="WIN"?C.green:sig.outcome==="LOSS"?C.red:C.orange,border:`1px solid ${sig.outcome==="WIN"?C.green:sig.outcome==="LOSS"?C.red:C.orange}44`,fontWeight:700}}>{sig.outcome}</span>
              {sig.pnlPct&&sig.outcome!=="PENDING"&&<span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:parseFloat(sig.pnlPct)>=0?C.green:C.red}}>{parseFloat(sig.pnlPct)>=0?"+":""}{sig.pnlPct}% PnL</span>}
            </div>
          )}
        </div>
      ))}
      {histLocked&&history.length>5&&(
        <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,textAlign:"center"}}>
          <button onClick={onUpgrade} style={{fontFamily:MONO,fontSize:8,color:C.muted,background:"none",border:"none",cursor:"pointer",letterSpacing:"0.08em"}}>+ {history.length-5} more signals hidden — upgrade to see full history</button>
        </div>
      )}
    </div>
    <div style={{fontFamily:MONO,fontSize:7,color:C.muted,padding:"4px 0 12px",textAlign:"center"}}>
      Last updated: {lastFetch?lastFetch.toLocaleTimeString():"—"} · Auto-refreshes every 60s · Win/Loss based on TP1 hit
    </div>
  </>);
}

// ─── MACRO INTEL FEED (Elite only) ─────────────────────────
const MACRO_IMPACT_COLORS={red:{bg:"rgba(255,45,85,.1)",border:"rgba(255,45,85,.4)",text:"#ff2d55",label:"HIGH IMPACT"},orange:{bg:"rgba(255,140,0,.08)",border:"rgba(255,140,0,.35)",text:"#ff8c00",label:"MARKET MOVING"},yellow:{bg:"rgba(201,168,76,.06)",border:"rgba(201,168,76,.3)",text:"#c9a84c",label:"MACRO NOTE"}};
function MacroIntelFeed({isElite,onUpgrade,onAskAI}){
  const{C,isDark}=useContext(ThemeCtx);
  const[items,setItems]=useState([]);
  const[loading,setLoading]=useState(true);
  const[lastFetchTs,setLastFetchTs]=useState(null);
  const[newIds,setNewIds]=useState(new Set());
  const seenRef=useRef(new Set());
  const fetchItems=useCallback(async(isInitial=false)=>{
    if(isInitial)setLoading(true);
    try{
      const r=await fetch("/api/macro-intel");
      const d=await r.json();
      const list=d.items||[];
      if(!isInitial){
        const fresh=new Set(list.map(i=>i.id).filter(id=>!seenRef.current.has(id)));
        setNewIds(fresh);
      }
      list.forEach(i=>seenRef.current.add(i.id));
      setItems(list);
      setLastFetchTs(Date.now());
    }catch(e){}
    finally{if(isInitial)setLoading(false);}
  },[]);
  useEffect(()=>{
    fetchItems(true);
    const iv=setInterval(()=>fetchItems(false),60000);
    return()=>clearInterval(iv);
  },[fetchItems]);
  const timeAgo=ts=>{const diff=Math.floor((Date.now()-ts)/1000);if(diff<60)return`${diff}s ago`;if(diff<3600)return`${Math.floor(diff/60)}m ago`;if(diff<86400)return`${Math.floor(diff/3600)}h ago`;return`${Math.floor(diff/86400)}d ago`;};
  const panelBase={background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,marginBottom:8};
  // Impact colors adapt to theme
  const impactCfg={
    red:{bg:isDark?"rgba(255,45,85,.1)":"rgba(196,18,48,.06)",border:isDark?"rgba(255,45,85,.4)":"rgba(196,18,48,.35)",text:C.red,label:"HIGH IMPACT"},
    orange:{bg:isDark?"rgba(255,140,0,.08)":"rgba(179,90,0,.06)",border:isDark?"rgba(255,140,0,.35)":"rgba(179,90,0,.3)",text:C.orange,label:"MARKET MOVING"},
    yellow:{bg:isDark?"rgba(201,168,76,.06)":"rgba(138,108,24,.05)",border:isDark?"rgba(201,168,76,.3)":"rgba(138,108,24,.25)",text:C.gold,label:"MACRO NOTE"},
  };
  const liveGreen=isDark?"#00ff88":C.green;
  if(!isElite)return(
    <div style={{...panelBase,marginTop:16,padding:"18px 16px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.2em",marginBottom:6}}>MACRO INTEL FEED — ELITE</div>
          <div style={{fontFamily:SERIF,fontSize:14,fontWeight:700,color:C.text,marginBottom:6}}>Live Macro Intelligence</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {[["🔴","High-impact Fed, CPI & NFP alerts"],["🟠","Tariff, war & sanction triggers"],["🟡","GDP, liquidity & SEC headlines"],["🤖","Ask QuantBrain on any headline"]].map(([icon,txt])=>(
              <div key={txt} style={{display:"flex",alignItems:"center",gap:7,fontFamily:MONO,fontSize:8,color:C.muted}}><span>{icon}</span><span>{txt}</span></div>
            ))}
          </div>
        </div>
        <button data-testid="btn-upgrade-macro-intel" onClick={onUpgrade} style={{flexShrink:0,background:"rgba(138,108,24,.1)",border:`1px solid ${C.gold}`,borderRadius:4,padding:"9px 18px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold,cursor:"pointer"}}>Go Elite →</button>
      </div>
    </div>
  );
  return(
    <div style={{marginTop:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.2em"}}>MACRO INTEL FEED</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {lastFetchTs&&<span style={{fontFamily:MONO,fontSize:7,color:C.muted}}>refreshed {timeAgo(lastFetchTs)}</span>}
          <span style={{fontFamily:MONO,fontSize:7,color:liveGreen,animation:"pulse 2s infinite"}}>● LIVE</span>
        </div>
      </div>
      {loading&&<div style={{padding:24,textAlign:"center",fontFamily:MONO,fontSize:10,color:C.muted}}>Loading macro intel…</div>}
      {!loading&&items.length===0&&<div style={{...panelBase,padding:"16px",fontFamily:MONO,fontSize:9,color:C.muted,textAlign:"center"}}>No macro news items found — feed updates every 60 seconds.</div>}
      {items.map(item=>{
        const ic=impactCfg[item.impact]||impactCfg.yellow;
        const isNew=newIds.has(item.id);
        return(
          <div key={item.id} data-testid={`macro-intel-${item.id}`} style={{...panelBase,border:`1px solid ${ic.border}`,background:ic.bg,position:"relative"}}>
            {isNew&&<div style={{position:"absolute",top:8,right:8,width:7,height:7,borderRadius:"50%",background:liveGreen,boxShadow:`0 0 6px ${liveGreen}`,animation:"pulse 1.5s ease-in-out infinite"}}/>}
            <div style={{padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontFamily:MONO,fontSize:7,fontWeight:700,color:ic.text,background:isDark?"rgba(0,0,0,.3)":"rgba(255,255,255,.6)",padding:"2px 7px",borderRadius:2,letterSpacing:"0.12em",border:`1px solid ${ic.border}`}}>{ic.label}</span>
                {item.assets.map(a=><span key={a} style={{fontFamily:MONO,fontSize:7,color:C.muted,background:C.bg,border:`1px solid ${C.border}`,borderRadius:2,padding:"2px 5px"}}>{a}</span>)}
              </div>
              <div style={{fontFamily:MONO,fontSize:11,color:C.text,lineHeight:1.55,marginBottom:8}}>{item.title}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{item.source} · {timeAgo(item.ts)}</span>
                <button data-testid={`btn-macro-intel-ask-${item.id}`} onClick={()=>onAskAI(`Analyze the market impact of: ${item.title}`)} style={{background:"rgba(138,108,24,.08)",border:`1px solid ${C.gold2}`,borderRadius:2,padding:"5px 11px",fontFamily:MONO,fontSize:9,fontWeight:700,color:C.gold,cursor:"pointer",letterSpacing:"0.06em",flexShrink:0}}>Ask QuantBrain →</button>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{fontFamily:MONO,fontSize:7,color:C.muted2,textAlign:"center",paddingTop:4,letterSpacing:"0.08em"}}>SOURCE: CRYPTOPANIC · MACRO-FILTERED · AUTO-REFRESHES 60s</div>
    </div>
  );
}

// ─── TRADE JOURNAL TAB (Elite) ─────────────────────────────
function TradeJournalTab({isElite,onUpgrade}){
  const{C}=useContext(ThemeCtx);
  const[showForm,setShowForm]=useState(false);
  const[deleting,setDeleting]=useState(null);
  const[closing,setClosing]=useState(null);
  const[closeData,setCloseData]=useState({outcome:"WIN",pnlPct:""});
  const[form,setForm]=useState({asset:"",direction:"LONG",entry:"",stop:"",tp1:"",tp2:"",size:"",notes:"",status:"OPEN",outcome:"",pnlPct:"",pnlUsd:"",exit:""});
  const[saving,setSaving]=useState(false);
  const[importing,setImporting]=useState(false);
  const[importErr,setImportErr]=useState("");
  const[importMsg,setImportMsg]=useState("");
  const[importUrl,setImportUrl]=useState("");
  const[showImport,setShowImport]=useState(false);
  const[saveErr,setSaveErr]=useState("");
  const fileInRef=useRef(null);

  // Client-side downscale: shrinks any photo to max 1600px (long side) JPEG q=0.85.
  // Brings 8MB iPhone screenshots down to ~300-800KB so the upload always fits.
  async function fileToCompressedDataUrl(file){
    const MAX_DIM=1600;
    const dataUrl=await new Promise((resolve,reject)=>{
      const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Could not read file"));r.readAsDataURL(file);
    });
    const img=await new Promise((resolve,reject)=>{
      const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error("Could not decode image"));im.src=dataUrl;
    });
    let{width:w,height:h}=img;
    if(w>MAX_DIM||h>MAX_DIM){
      const scale=MAX_DIM/Math.max(w,h);
      w=Math.round(w*scale);h=Math.round(h*scale);
    }
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;
    const ctx=cv.getContext("2d");
    ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    const out=cv.toDataURL("image/jpeg",0.85);
    return{dataUrl:out,mediaType:"image/jpeg",sizeKB:Math.round(out.length*0.75/1024)};
  }

  async function extractFromImage(file){
    if(!file)return;
    setImportErr("");setImportMsg("Compressing image…");setImporting(true);
    try{
      const{dataUrl,mediaType,sizeKB}=await fileToCompressedDataUrl(file);
      setImportMsg(`Uploading (${sizeKB} KB) — analyzing with AI…`);
      const r=await fetch("/api/journal/extract",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageBase64:dataUrl,mediaType})});
      let j=null;try{j=await r.json();}catch{}
      if(!r.ok){
        const msg=j?.error||`Server error ${r.status}`;
        setImportErr(`Upload failed: ${msg}`);setImportMsg("");setImporting(false);return;
      }
      const ex=j?.extracted||{};
      const isClosed=String(ex.status||"").toUpperCase()==="CLOSED";
      setForm(f=>({
        asset:ex.asset||f.asset,
        direction:ex.direction||f.direction,
        entry:ex.entry||f.entry,
        stop:ex.stop||f.stop,
        tp1:ex.tp1||f.tp1,
        tp2:ex.tp2||f.tp2,
        size:ex.size||f.size,
        notes:ex.notes||f.notes,
        status:isClosed?"CLOSED":"OPEN",
        outcome:isClosed?(ex.outcome||""):"",
        pnlPct:isClosed?(ex.pnlPct||""):"",
        pnlUsd:isClosed?(ex.pnlUsd||""):"",
        exit:isClosed?(ex.exit||""):"",
      }));
      if(isClosed){
        const pct=ex.pnlPct?` ${parseFloat(ex.pnlPct)>=0?"+":""}${parseFloat(ex.pnlPct).toFixed(2)}%`:"";
        const usd=ex.pnlUsd?` (${parseFloat(ex.pnlUsd)>=0?"+":""}$${Math.abs(parseFloat(ex.pnlUsd)).toFixed(2)})`:"";
        setImportMsg(`Detected CLOSED ${ex.outcome||"trade"} —${pct}${usd}`);
      } else setImportMsg("");
      setShowImport(false);setShowForm(true);
    }catch(e){
      console.error("[journal import]",e);
      setImportErr(e?.message||"Upload failed — please retry or enter manually.");setImportMsg("");
    }
    setImporting(false);
    if(fileInRef.current)fileInRef.current.value="";
  }
  async function extractFromUrl(){
    if(!importUrl.trim())return;
    setImportErr("");setImporting(true);
    try{
      const r=await fetch("/api/journal/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:importUrl.trim()})});
      const j=await r.json();
      if(!r.ok){setImportErr(j.error||"Extraction failed");setImporting(false);return;}
      const ex=j.extracted||{};
      const isClosed=String(ex.status||"").toUpperCase()==="CLOSED";
      setForm(f=>({
        asset:ex.asset||f.asset,
        direction:ex.direction||f.direction,
        entry:ex.entry||f.entry,
        stop:ex.stop||f.stop,
        tp1:ex.tp1||f.tp1,
        tp2:ex.tp2||f.tp2,
        size:ex.size||f.size,
        notes:ex.notes||f.notes,
        status:isClosed?"CLOSED":"OPEN",
        outcome:isClosed?(ex.outcome||""):"",
        pnlPct:isClosed?(ex.pnlPct||""):"",
        pnlUsd:isClosed?(ex.pnlUsd||""):"",
        exit:isClosed?(ex.exit||""):"",
      }));
      setImportUrl("");setShowImport(false);setShowForm(true);
    }catch(e){setImportErr("Extraction failed — please enter manually.");}
    setImporting(false);
  }
  async function shareTradeCard(e){
    try{
      const W=900,H=1100;
      const cv=document.createElement("canvas");cv.width=W;cv.height=H;
      const ctx=cv.getContext("2d");
      // Background — luxury navy
      ctx.fillStyle="#080d18";ctx.fillRect(0,0,W,H);
      // Gold border
      ctx.strokeStyle="#c9a84c";ctx.lineWidth=4;ctx.strokeRect(20,20,W-40,H-40);
      // Header
      ctx.fillStyle="#c9a84c";ctx.font="bold 56px Georgia, serif";ctx.textAlign="center";
      ctx.fillText("CLVRQuant",W/2,110);
      ctx.fillStyle="#8b7d5a";ctx.font="14px 'IBM Plex Mono', monospace";
      ctx.fillText("AI · MARKET INTELLIGENCE",W/2,140);
      // Asset + direction
      ctx.fillStyle="#e8d5b7";ctx.font="bold 84px 'IBM Plex Mono', monospace";
      ctx.fillText(`${e.asset}`,W/2,260);
      const dirCol=e.direction==="LONG"?"#00c787":"#ff4060";
      ctx.fillStyle=dirCol;ctx.font="bold 36px 'IBM Plex Mono', monospace";
      ctx.fillText(e.direction,W/2,310);
      // Outcome / PnL big
      const isWin=e.outcome==="WIN";
      const pnlNum=e.pnlPct?parseFloat(e.pnlPct):null;
      const pnlCol=pnlNum==null?"#8b7d5a":pnlNum>0?"#00c787":"#ff4060";
      ctx.fillStyle=pnlCol;ctx.font="bold 110px 'IBM Plex Mono', monospace";
      const pnlTxt=pnlNum!=null?`${pnlNum>0?"+":""}${pnlNum.toFixed(1)}%`:e.outcome||"OPEN";
      ctx.fillText(pnlTxt,W/2,460);
      ctx.fillStyle="#8b7d5a";ctx.font="16px 'IBM Plex Mono', monospace";
      ctx.fillText(e.outcome==="OPEN"?"OPEN POSITION":(isWin?"WIN":"LOSS"),W/2,495);
      // Levels grid
      const lvls=[["Entry",e.entry],["Stop",e.stop],["TP1",e.tp1],["TP2",e.tp2]].filter(([,v])=>v);
      const startY=600,rowH=70;
      lvls.forEach(([lab,val],i)=>{
        const y=startY+i*rowH;
        ctx.fillStyle="#1a2540";ctx.fillRect(120,y-30,W-240,55);
        ctx.strokeStyle="#2a3960";ctx.lineWidth=1;ctx.strokeRect(120,y-30,W-240,55);
        ctx.fillStyle="#8b7d5a";ctx.font="14px 'IBM Plex Mono', monospace";ctx.textAlign="left";
        ctx.fillText(lab.toUpperCase(),150,y+5);
        ctx.fillStyle="#e8d5b7";ctx.font="bold 22px 'IBM Plex Mono', monospace";ctx.textAlign="right";
        ctx.fillText(String(val),W-150,y+5);
      });
      // Footer
      ctx.fillStyle="#8b7d5a";ctx.font="14px 'IBM Plex Mono', monospace";ctx.textAlign="center";
      ctx.fillText("CLVRQuantAI.com",W/2,H-70);
      ctx.fillStyle="#4a5d80";ctx.font="11px 'IBM Plex Mono', monospace";
      ctx.fillText("Educational use only. Not financial advice.",W/2,H-45);
      const dataUrl=cv.toDataURL("image/png");
      const fileName=`clvrquant-${e.asset}-${e.direction}-${e.id}.png`;
      // Try Web Share API
      if(navigator.canShare){
        const blob=await(await fetch(dataUrl)).blob();
        const file=new File([blob],fileName,{type:"image/png"});
        if(navigator.canShare({files:[file]})){
          try{await navigator.share({files:[file],title:`${e.asset} ${e.direction} ${pnlTxt}`,text:`${e.asset} ${e.direction} via CLVRQuant`});return;}catch(err){}
        }
      }
      // Fallback: download
      const a=document.createElement("a");a.href=dataUrl;a.download=fileName;document.body.appendChild(a);a.click();a.remove();
    }catch(err){console.error("share card failed",err);}
  }
  const{data,isLoading,refetch}=useQuery({queryKey:["/api/journal"],queryFn:async()=>{const r=await fetch("/api/journal");return r.json();},enabled:isElite,refetchInterval:120000});
  const entries=data?.entries||[];
  const closed=entries.filter(e=>e.outcome!=="OPEN");
  const wins=closed.filter(e=>e.outcome==="WIN").length;
  const losses=closed.filter(e=>e.outcome==="LOSS").length;
  const winRate=closed.length>0?Math.round(wins/closed.length*100):null;
  const pnls=closed.filter(e=>e.pnlPct).map(e=>parseFloat(e.pnlPct));
  const totalPnl=pnls.length>0?pnls.reduce((a,b)=>a+b,0):null;
  const bestTrade=pnls.length>0?Math.max(...pnls):null;
  const worstTrade=pnls.length>0?Math.min(...pnls):null;
  const avgRR=(()=>{
    const rrs=entries.filter(e=>e.entry&&e.stop&&e.tp1).map(e=>{
      const en=parseFloat(e.entry),st=parseFloat(e.stop),t1=parseFloat(e.tp1);
      if(!en||!st||!t1||en===st)return null;
      return Math.abs(t1-en)/Math.abs(en-st);
    }).filter(Boolean);
    return rrs.length>0?(rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2):null;
  })();
  const panelS={background:C.panel,border:`1px solid ${C.border}`,borderRadius:6,marginBottom:10};
  async function addEntry(){
    setSaveErr("");
    if(!form.asset||!form.entry){setSaveErr("ASSET and ENTRY PRICE are required.");return;}
    setSaving(true);
    try{
      const isClosed=form.status==="CLOSED"&&(form.outcome==="WIN"||form.outcome==="LOSS");
      const payload={
        asset:form.asset,direction:form.direction,entry:form.entry,
        stop:form.stop,tp1:form.tp1,tp2:form.tp2,size:form.size,notes:form.notes,
        ...(isClosed?{outcome:form.outcome,pnlPct:form.pnlPct||undefined}:{})
      };
      const r=await fetch("/api/journal",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      let j=null;try{j=await r.json();}catch{}
      if(!r.ok){
        const msg=j?.error||`Server error ${r.status}`;
        setSaveErr(`Save failed: ${msg}`);setSaving(false);return;
      }
      setForm({asset:"",direction:"LONG",entry:"",stop:"",tp1:"",tp2:"",size:"",notes:"",status:"OPEN",outcome:"",pnlPct:"",pnlUsd:"",exit:""});
      setShowForm(false);refetch();
    }catch(e){
      console.error("[journal save]",e);
      setSaveErr(e?.message||"Save failed — check your connection and try again.");
    }
    setSaving(false);
  }
  async function closeEntry(id){
    await fetch(`/api/journal/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome:closeData.outcome,pnlPct:closeData.pnlPct||undefined})});
    setClosing(null);setCloseData({outcome:"WIN",pnlPct:""});refetch();
  }
  async function deleteEntry(id){
    setDeleting(id);
    await fetch(`/api/journal/${id}`,{method:"DELETE"});
    setDeleting(null);refetch();
  }
  const inp={background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 10px",fontFamily:MONO,fontSize:11,color:C.text,outline:"none",width:"100%",boxSizing:"border-box"};
  if(!isElite)return(
    <div style={{...panelS,padding:"32px 20px",textAlign:"center",marginTop:10}}>
      <div style={{fontSize:28,marginBottom:12}}>📓</div>
      <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:"#d4af37",letterSpacing:"0.14em",marginBottom:8}}>TRADE JOURNAL</div>
      <div style={{fontFamily:MONO,fontSize:9,color:"#8b7d5a",marginBottom:18,lineHeight:1.7}}>Elite members can log every trade with entry, stop, targets, sizing and notes.<br/>Track your P&amp;L, win rate, average R:R, and best/worst trades.</div>
      <button onClick={onUpgrade} style={{padding:"10px 28px",background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.4)",borderRadius:4,fontFamily:MONO,fontSize:10,color:"#d4af37",cursor:"pointer",letterSpacing:"0.1em"}}>UPGRADE TO ELITE</button>
    </div>
  );
  return(<>
    <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:"#d4af37",letterSpacing:"0.16em",marginBottom:10}}>📓 TRADE JOURNAL</div>
    {/* Stats bar */}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
      {[
        {label:"TOTAL",val:entries.length,col:"#e8d5b7"},
        {label:"OPEN",val:entries.filter(e=>e.outcome==="OPEN").length,col:"#8b7d5a"},
        {label:"WIN RATE",val:winRate!=null?`${winRate}%`:"—",col:winRate!=null?(winRate>=55?C.green:winRate>=45?"#d4af37":C.red):"#8b7d5a"},
        {label:"TOTAL P&L",val:totalPnl!=null?`${totalPnl>0?"+":""}${totalPnl.toFixed(1)}%`:"—",col:totalPnl!=null?(totalPnl>0?C.green:C.red):"#8b7d5a"},
        {label:"AVG R:R",val:avgRR?`${avgRR}:1`:"—",col:"#d4af37"},
        {label:"BEST",val:bestTrade!=null?`+${bestTrade.toFixed(1)}%`:"—",col:C.green},
        {label:"WORST",val:worstTrade!=null?`${worstTrade.toFixed(1)}%`:"—",col:C.red},
      ].map(({label,val,col})=>(
        <div key={label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"7px 12px",textAlign:"center",minWidth:60}}>
          <div style={{fontFamily:MONO,fontSize:14,fontWeight:800,color:col}}>{val}</div>
          <div style={{fontFamily:MONO,fontSize:6,color:C.muted,letterSpacing:"0.1em"}}>{label}</div>
        </div>
      ))}
    </div>
    {/* Add trade buttons */}
    <div style={{marginBottom:10,display:"flex",gap:8,flexWrap:"wrap"}}>
      <button data-testid="btn-journal-add" onClick={()=>{setShowForm(v=>!v);setShowImport(false);}} style={{padding:"9px 18px",background:"rgba(201,168,76,.1)",border:"1px solid rgba(201,168,76,.35)",borderRadius:4,fontFamily:MONO,fontSize:10,color:"#d4af37",cursor:"pointer",letterSpacing:"0.1em"}}>{showForm?"✕ CANCEL":"+ LOG NEW TRADE"}</button>
      <button data-testid="btn-journal-import" onClick={()=>{setShowImport(v=>!v);setShowForm(false);setImportErr("");}} style={{padding:"9px 18px",background:"rgba(0,212,255,.08)",border:"1px solid rgba(0,212,255,.3)",borderRadius:4,fontFamily:MONO,fontSize:10,color:C.cyan,cursor:"pointer",letterSpacing:"0.1em"}}>{showImport?"✕ CANCEL":"📷 IMPORT FROM SCREENSHOT / LINK"}</button>
    </div>
    {/* Import dialog */}
    {showImport&&(
      <div style={{...panelS,padding:"16px"}}>
        <div style={{fontFamily:MONO,fontSize:8,color:"#8b7d5a",letterSpacing:"0.12em",marginBottom:12}}>IMPORT TRADE — CLAUDE WILL EXTRACT FIELDS</div>
        <div style={{marginBottom:12}}>
          <div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:6}}>OPTION 1: UPLOAD SCREENSHOT (Bybit, Hyperliquid, Binance, Phantom, etc.)</div>
          <input ref={fileInRef} type="file" accept="image/*" data-testid="input-journal-import-image" onChange={ev=>extractFromImage(ev.target.files?.[0])} style={{display:"none"}}/>
          <button data-testid="btn-journal-import-image" disabled={importing} onClick={()=>fileInRef.current?.click()} style={{padding:"10px 20px",background:"rgba(0,212,255,.08)",border:"1px solid rgba(0,212,255,.3)",borderRadius:4,fontFamily:MONO,fontSize:10,color:C.cyan,cursor:importing?"not-allowed":"pointer",opacity:importing?0.5:1}}>{importing?"Analyzing screenshot…":"📷 Choose Screenshot"}</button>
        </div>
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginBottom:8}}>
          <div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:6}}>OPTION 2: PASTE SHARE LINK (Bybit / Hyperliquid / Binance position URL)</div>
          <div style={{display:"flex",gap:6}}>
            <input data-testid="input-journal-import-url" value={importUrl} onChange={ev=>setImportUrl(ev.target.value)} placeholder="https://..." style={inp}/>
            <button data-testid="btn-journal-import-url" disabled={importing||!importUrl.trim()} onClick={extractFromUrl} style={{padding:"8px 16px",background:"rgba(0,212,255,.08)",border:"1px solid rgba(0,212,255,.3)",borderRadius:4,fontFamily:MONO,fontSize:10,color:C.cyan,cursor:importing||!importUrl.trim()?"not-allowed":"pointer",opacity:importing||!importUrl.trim()?0.5:1,whiteSpace:"nowrap"}}>{importing?"…":"Extract"}</button>
          </div>
        </div>
        {importErr&&<div style={{fontFamily:MONO,fontSize:8,color:C.red,marginTop:8}}>{importErr}</div>}
        <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginTop:8,fontStyle:"italic"}}>Extracted fields will pre-fill the new trade form — review before saving. Images are NOT stored.</div>
      </div>
    )}
    {/* Add trade form */}
    {showForm&&(
      <div style={{...panelS,padding:"16px"}}>
        <div style={{fontFamily:MONO,fontSize:8,color:"#8b7d5a",letterSpacing:"0.12em",marginBottom:12}}>NEW TRADE ENTRY</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>ASSET *</div><input data-testid="input-journal-asset" value={form.asset} onChange={e=>setForm(f=>({...f,asset:e.target.value.toUpperCase()}))} placeholder="e.g. BTC" style={inp}/></div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>DIRECTION *</div>
            <select data-testid="input-journal-direction" value={form.direction} onChange={e=>setForm(f=>({...f,direction:e.target.value}))} style={{...inp}}>
              <option value="LONG">LONG</option><option value="SHORT">SHORT</option>
            </select>
          </div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>ENTRY PRICE *</div><input data-testid="input-journal-entry" value={form.entry} onChange={e=>setForm(f=>({...f,entry:e.target.value}))} placeholder="e.g. 71500" style={inp}/></div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>STOP LOSS</div><input data-testid="input-journal-stop" value={form.stop} onChange={e=>setForm(f=>({...f,stop:e.target.value}))} placeholder="e.g. 70100" style={inp}/></div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>TP1</div><input data-testid="input-journal-tp1" value={form.tp1} onChange={e=>setForm(f=>({...f,tp1:e.target.value}))} placeholder="e.g. 73200" style={inp}/></div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>TP2</div><input data-testid="input-journal-tp2" value={form.tp2} onChange={e=>setForm(f=>({...f,tp2:e.target.value}))} placeholder="e.g. 75800" style={inp}/></div>
          <div><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>POSITION SIZE</div><input data-testid="input-journal-size" value={form.size} onChange={e=>setForm(f=>({...f,size:e.target.value}))} placeholder="e.g. 0.5 BTC / $5000 / 2%" style={inp}/></div>
        </div>
        <div style={{marginBottom:8}}><div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>NOTES</div><textarea data-testid="input-journal-notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Why you took this trade, market context, thesis..." style={{...inp,minHeight:56,resize:"vertical"}}/></div>
        {form.status==="CLOSED"&&(()=>{
          const isWin=form.outcome==="WIN";
          const col=isWin?"#00c787":"#ff4060";
          const pctNum=form.pnlPct?parseFloat(form.pnlPct):null;
          const usdNum=form.pnlUsd?parseFloat(form.pnlUsd):null;
          return(
            <div data-testid="banner-journal-closed" style={{marginBottom:10,padding:"10px 12px",background:`${col}10`,border:`1px solid ${col}55`,borderRadius:4}}>
              <div style={{fontFamily:MONO,fontSize:8,letterSpacing:"0.14em",color:col,marginBottom:6}}>CLOSED TRADE DETECTED — {isWin?"WIN":"LOSS"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>OUTCOME</div>
                  <select data-testid="select-journal-outcome" value={form.outcome||"WIN"} onChange={e=>setForm(f=>({...f,outcome:e.target.value}))} style={inp}>
                    <option value="WIN">WIN</option><option value="LOSS">LOSS</option>
                  </select>
                </div>
                <div>
                  <div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>P&L %</div>
                  <input data-testid="input-journal-pnlpct" value={form.pnlPct} onChange={e=>setForm(f=>({...f,pnlPct:e.target.value}))} placeholder="e.g. 9.32" style={inp}/>
                </div>
                <div>
                  <div style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginBottom:3}}>P&L $</div>
                  <input data-testid="input-journal-pnlusd" value={form.pnlUsd} onChange={e=>setForm(f=>({...f,pnlUsd:e.target.value}))} placeholder="e.g. 1.29" style={inp}/>
                </div>
              </div>
              {(pctNum!=null||usdNum!=null)&&(
                <div style={{marginTop:6,fontFamily:MONO,fontSize:9,color:col,fontWeight:700}}>
                  {usdNum!=null?`${usdNum>=0?"+":""}$${Math.abs(usdNum).toFixed(2)}`:""}{usdNum!=null&&pctNum!=null?" · ":""}{pctNum!=null?`${pctNum>=0?"+":""}${pctNum.toFixed(2)}%`:""}
                </div>
              )}
              <div style={{marginTop:6,fontFamily:MONO,fontSize:8,color:"#8b7d5a"}}>
                Saving will record this directly as a closed trade. Tap to switch back to OPEN if this looks wrong.
                <button data-testid="btn-journal-mark-open" onClick={()=>setForm(f=>({...f,status:"OPEN",outcome:"",pnlPct:"",pnlUsd:"",exit:""}))} style={{marginLeft:8,padding:"3px 8px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:3,fontFamily:MONO,fontSize:8,color:"#8b7d5a",cursor:"pointer"}}>MARK AS OPEN</button>
              </div>
            </div>
          );
        })()}
        {(()=>{const ready=!saving&&form.asset&&form.entry;const closed=form.status==="CLOSED";const bg=closed?(form.outcome==="LOSS"?"#ff4060":"#00c787"):"#00c787";return(
          <button data-testid="btn-journal-save" disabled={!ready} onClick={addEntry} style={{
            padding:"11px 26px",
            background:ready?bg:"rgba(0,199,135,.08)",
            border:`1px solid ${ready?bg:"rgba(0,199,135,.25)"}`,
            borderRadius:4,fontFamily:MONO,fontSize:11,fontWeight:700,letterSpacing:"0.12em",
            color:ready?"#000":"rgba(0,199,135,.45)",
            cursor:ready?"pointer":"not-allowed",
            WebkitAppearance:"none",WebkitTapHighlightColor:"transparent",touchAction:"manipulation",
          }}>{saving?"SAVING…":(closed?`SAVE CLOSED ${form.outcome||"TRADE"}`:"SAVE TRADE")}</button>
        );})()}
        {saveErr&&<div data-testid="text-journal-save-err" style={{marginTop:10,padding:"8px 10px",background:"rgba(255,64,96,.08)",border:"1px solid rgba(255,64,96,.3)",borderRadius:4,fontFamily:MONO,fontSize:9,color:C.red}}>{saveErr}</div>}
        {!form.asset||!form.entry?<div style={{marginTop:8,fontFamily:MONO,fontSize:8,color:"#8b7d5a",fontStyle:"italic"}}>Tip: ASSET and ENTRY PRICE must be filled in before saving.</div>:null}
      </div>
    )}
    {/* Trade list */}
    {isLoading?(
      <div style={{padding:24,textAlign:"center",fontFamily:MONO,fontSize:9,color:"#8b7d5a"}}>Loading journal…</div>
    ):entries.length===0?(
      <div style={{...panelS,padding:"24px",textAlign:"center",fontFamily:MONO,fontSize:9,color:"#8b7d5a"}}>No trades logged yet. Tap "+ LOG NEW TRADE" to start your journal.</div>
    ):(
      entries.map((e,i)=>{
        const isOpen=e.outcome==="OPEN";
        const oc=e.outcome==="WIN"?C.green:e.outcome==="LOSS"?C.red:"#8b7d5a";
        const obg=e.outcome==="WIN"?"rgba(0,199,135,.07)":e.outcome==="LOSS"?"rgba(255,64,96,.07)":"rgba(255,255,255,.02)";
        const rr=(()=>{if(!e.entry||!e.stop||!e.tp1)return null;const en=parseFloat(e.entry),st=parseFloat(e.stop),t1=parseFloat(e.tp1);if(!en||!st||!t1||en===st)return null;return(Math.abs(t1-en)/Math.abs(en-st)).toFixed(2);})();
        return(
          <div key={e.id} data-testid={`journal-entry-${e.id}`} style={{...panelS,background:obg,overflow:"hidden"}}>
            <div style={{padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                <span style={{fontFamily:MONO,fontSize:12,fontWeight:800,color:"#e8d5b7"}}>{e.asset}</span>
                <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:e.direction==="LONG"?C.green:C.red,background:e.direction==="LONG"?"rgba(0,199,135,.08)":"rgba(255,64,96,.07)",border:`1px solid ${e.direction==="LONG"?"rgba(0,199,135,.3)":"rgba(255,64,96,.3)"}`,borderRadius:3,padding:"2px 7px"}}>{e.direction}</span>
                <span style={{fontFamily:MONO,fontSize:8,color:oc,background:obg,border:`1px solid ${oc}44`,borderRadius:3,padding:"2px 7px"}}>{isOpen?"OPEN":e.outcome}{e.pnlPct?` · ${parseFloat(e.pnlPct)>0?"+":""}${e.pnlPct}%`:""}</span>
                {rr&&<span style={{fontFamily:MONO,fontSize:8,color:"#d4af37",border:"1px solid rgba(201,168,76,.2)",borderRadius:3,padding:"2px 7px"}}>R:R {rr}:1</span>}
                <span style={{fontFamily:MONO,fontSize:7,color:"#8b7d5a",marginLeft:"auto"}}>{e.createdAt?new Date(e.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}):"—"}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:4,marginBottom:e.notes?6:0}}>
                {[["Entry",e.entry],[" Stop",e.stop],["TP1",e.tp1],["TP2",e.tp2],["Size",e.size]].filter(([,v])=>v).map(([label,val])=>(
                  <div key={label} style={{background:"rgba(0,0,0,.25)",borderRadius:3,padding:"4px 8px"}}>
                    <div style={{fontFamily:MONO,fontSize:6,color:"#8b7d5a"}}>{label}</div>
                    <div style={{fontFamily:MONO,fontSize:9,color:"#e8d5b7",fontWeight:700}}>{val}</div>
                  </div>
                ))}
              </div>
              {e.notes&&<div style={{fontFamily:MONO,fontSize:8,color:"#8b7d5a",marginTop:6,lineHeight:1.5,fontStyle:"italic"}}>"{e.notes}"</div>}
              <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                {isOpen&&(
                  closing===e.id?(
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <select value={closeData.outcome} onChange={ev=>setCloseData(d=>({...d,outcome:ev.target.value}))} style={{...inp,width:"auto",padding:"4px 8px",fontSize:9}}>
                        <option value="WIN">WIN</option><option value="LOSS">LOSS</option>
                      </select>
                      <input value={closeData.pnlPct} onChange={ev=>setCloseData(d=>({...d,pnlPct:ev.target.value}))} placeholder="P&L %" style={{...inp,width:70,padding:"4px 8px",fontSize:9}}/>
                      <button data-testid={`btn-journal-close-confirm-${e.id}`} onClick={()=>closeEntry(e.id)} style={{padding:"4px 12px",background:"rgba(0,199,135,.12)",border:"1px solid rgba(0,199,135,.35)",borderRadius:3,fontFamily:MONO,fontSize:8,color:C.green,cursor:"pointer"}}>Confirm</button>
                      <button onClick={()=>setClosing(null)} style={{padding:"4px 8px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:3,fontFamily:MONO,fontSize:8,color:C.muted,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <button data-testid={`btn-journal-close-${e.id}`} onClick={()=>setClosing(e.id)} style={{padding:"4px 12px",background:"rgba(201,168,76,.08)",border:"1px solid rgba(201,168,76,.25)",borderRadius:3,fontFamily:MONO,fontSize:8,color:"#d4af37",cursor:"pointer"}}>Close Trade</button>
                  )
                )}
                <button data-testid={`btn-journal-share-${e.id}`} onClick={()=>shareTradeCard(e)} style={{padding:"4px 10px",background:"rgba(201,168,76,.08)",border:"1px solid rgba(201,168,76,.25)",borderRadius:3,fontFamily:MONO,fontSize:8,color:"#d4af37",cursor:"pointer"}}>📤 Share Card</button>
                <button data-testid={`btn-journal-delete-${e.id}`} disabled={deleting===e.id} onClick={()=>deleteEntry(e.id)} style={{padding:"4px 10px",background:"rgba(255,64,96,.06)",border:"1px solid rgba(255,64,96,.2)",borderRadius:3,fontFamily:MONO,fontSize:8,color:C.red,cursor:"pointer",opacity:deleting===e.id?0.5:1}}>{deleting===e.id?"…":"Delete"}</button>
              </div>
            </div>
          </div>
        );
      })
    )}
  </>);
}

// ─── SIGNAL GUIDE CARD (collapsible, Pro+) ─────────────────
const SIGNAL_STEPS=[
  {n:1,title:"Wait for Score ≥ 75 + Direction Confirmed",body:"Only act on signals that score 75 or above AND have a clear directional bias (LONG or SHORT). Lower scores are informational — not actionable entries."},
  {n:2,title:"Check Macro Kill Switch is CLEAR",body:"Head to the Radar tab and confirm the Macro Kill Switch shows CLEAR. If it shows ARMED (CPI, NFP, Fed day), skip the trade — macro events can invalidate any technical setup instantly."},
  {n:3,title:"Use Kelly % to Size Your Position",body:'CLVRQuant displays a Kelly fraction on every signal. Use it. Example: a 65% win-rate signal at 2:1 R:R gives Kelly ≈ 22.5% of risk capital. Never risk more than 2% of account on one signal regardless of Kelly output — this is the "half-Kelly" rule.'},
  {n:4,title:"Enter at the Suggested Zone, Set Stop Immediately",body:"Enter at or near the Entry price shown on the card. Place your stop-loss at the SL level before anything else. No stop = no trade. The engine calculates stops from recent ATR so they are volatility-adjusted."},
  {n:5,title:"Take 50% Off at TP1, Trail Stop to Entry",body:"When price reaches TP1, close half the position and move your stop to breakeven. This locks in a free trade — worst case from here is 0% loss. Let the remaining half run."},
  {n:6,title:"Exit Fully at TP2 or on Invalidation",body:"Close the remaining position at TP2. If price closes back through your entry zone (invalidation), exit early regardless of TP — the thesis is broken. Never hold a signal through a regime change."},
];
function SignalStatusBanner(){
  const{C,SERIF,MONO}=useContext(ThemeCtx);
  const[s,setS]=useState(null);
  useEffect(()=>{
    let alive=true;
    const load=()=>fetch("/api/signal-status",{credentials:"include"}).then(r=>r.json()).then(d=>{if(alive)setS(d);}).catch(()=>{});
    load();
    const iv=setInterval(load,60000);
    return()=>{alive=false;clearInterval(iv);};
  },[]);
  if(!s)return null;
  const cb=s.circuit_breaker||{};
  const halted=cb.active&&cb.level>=2;
  const suppCount=s.suppressed_count||0;
  if(!halted&&suppCount===0)return null;
  return(
    <div data-testid="banner-signal-status" style={{borderRadius:6,padding:"12px 14px",marginBottom:12,border:`1px solid ${halted?"rgba(255,80,80,.45)":"rgba(255,170,60,.35)"}`,background:halted?"rgba(255,80,80,.08)":"rgba(255,170,60,.06)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{fontSize:18,lineHeight:1}}>{halted?"🛑":"⚠️"}</div>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontFamily:MONO,fontSize:9,fontWeight:800,letterSpacing:"0.16em",color:halted?"#ff6b6b":"#ffae42",marginBottom:3}}>
            {halted?"SIGNAL ENGINE HALTED":`${suppCount} PAIR${suppCount===1?"":"S"} AUTO-SUPPRESSED`}
          </div>
          <div style={{fontFamily:SERIF,fontSize:12,color:C.muted2,lineHeight:1.5}}>
            {halted
              ? <>1-hour win rate dropped to <b style={{color:"#ff6b6b"}}>{cb.rolling?.winRate!=null?(cb.rolling.winRate*100).toFixed(1):"?"}%</b> over {cb.rolling?.n||0} signals. New signals are paused. Auto-resume when 1h WR recovers ≥45%.</>
              : <>Adaptive engine has paused these underperforming setups (Wilson 90% lower bound &lt; 30% over 10+ signals). They will be re-evaluated automatically as new outcomes resolve.</>
            }
          </div>
          {halted&&cb.reason&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:5,letterSpacing:"0.06em"}}>REASON: {cb.reason}</div>}
        </div>
      </div>
      {!halted&&suppCount>0&&suppCount<=12&&(
        <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
          {(s.suppressed_pairs||[]).map((p,i)=>(
            <span key={i} style={{fontFamily:MONO,fontSize:8,color:"#ffae42",background:"rgba(255,170,60,.08)",border:`1px solid rgba(255,170,60,.25)`,borderRadius:3,padding:"3px 7px",letterSpacing:"0.06em"}}>{p.token} {p.direction} · {p.winRate||"?"}%</span>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalGuideCard({isPro}){
  const{C}=useContext(ThemeCtx);
  const[open,setOpen]=useState(false);
  if(!isPro)return null;
  return(
    <div style={{background:"rgba(0,0,0,0.35)",border:`1px solid rgba(201,168,76,0.18)`,borderRadius:6,marginBottom:12,overflow:"hidden"}}>
      <button data-testid="btn-signal-guide-toggle" onClick={()=>setOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:MONO,fontSize:10,color:C.gold,fontWeight:700,letterSpacing:"0.12em"}}>📘 HOW TO USE A SIGNAL</span>
          <span style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.08em"}}>Trade walkthrough — 6 steps</span>
        </div>
        <span style={{fontFamily:MONO,fontSize:10,color:C.gold,transform:open?"rotate(180deg)":"rotate(0deg)",transition:"transform .25s"}}>▾</span>
      </button>
      {open&&(
        <div style={{padding:"0 16px 16px"}}>
          <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em",marginBottom:12,borderTop:`1px solid rgba(255,255,255,0.06)`,paddingTop:12}}>EXAMPLE: BTC LONG · Score 82/100 · Entry $71,500 · TP1 $73,200 · TP2 $75,800 · SL $70,100</div>
          {SIGNAL_STEPS.map(step=>(
            <div key={step.n} style={{display:"flex",gap:12,marginBottom:12}}>
              <div style={{flexShrink:0,width:22,height:22,background:"rgba(201,168,76,0.12)",border:`1px solid rgba(201,168,76,0.35)`,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,fontSize:10,fontWeight:800,color:C.gold,marginTop:1}}>{step.n}</div>
              <div>
                <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.gold2,marginBottom:3,letterSpacing:"0.06em"}}>{step.title}</div>
                <div style={{fontFamily:MONO,fontSize:9,color:C.muted,lineHeight:1.65}}>{step.body}</div>
              </div>
            </div>
          ))}
          <div style={{marginTop:8,padding:"8px 12px",background:"rgba(255,64,96,0.06)",border:"1px solid rgba(255,64,96,0.2)",borderRadius:4,fontFamily:MONO,fontSize:8,color:"#ff6b6b",lineHeight:1.6}}>⚠ DISCLAIMER: CLVRQuant signals are for informational purposes only and do not constitute financial advice. All trading involves significant risk of loss. Past signal performance does not guarantee future results.</div>
        </div>
      )}
    </div>
  );
}

// ─── SIGNAL HISTORY PANEL (Elite) ──────────────────────────
function SignalHistoryPanel({isElite,onUpgrade}){
  const{C}=useContext(ThemeCtx);
  const[markingId,setMarkingId]=useState(null);
  const[pnlInput,setPnlInput]=useState("");
  const[mutating,setMutating]=useState(false);
  const{data,isLoading,refetch}=useQuery({queryKey:["/api/signal-history"],queryFn:async()=>{const r=await fetch("/api/signal-history?limit=50");return r.json();},refetchInterval:60000});
  const sigs=data?.signals||[];
  const isDelayedHistory=data?.isDelayed||false;
  const wins=sigs.filter(s=>s.outcome==="WIN").length;
  const losses=sigs.filter(s=>s.outcome==="LOSS").length;
  const pending=sigs.filter(s=>s.outcome==="PENDING").length;
  const resolved=wins+losses;
  const winRate=resolved>0?Math.round(wins/resolved*100):null;
  // Per-asset stats
  const byAsset={};
  sigs.forEach(s=>{
    if(!byAsset[s.token])byAsset[s.token]={wins:0,losses:0,pending:0};
    if(s.outcome==="WIN")byAsset[s.token].wins++;
    else if(s.outcome==="LOSS")byAsset[s.token].losses++;
    else byAsset[s.token].pending++;
  });
  const assetList=Object.entries(byAsset).sort((a,b)=>(b[1].wins+b[1].losses+b[1].pending)-(a[1].wins+a[1].losses+a[1].pending)).slice(0,6);
  async function markOutcome(id,outcome){
    setMutating(true);
    try{
      await fetch(`/api/signal-history/${id}/outcome`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome,pnlPct:pnlInput||undefined})});
      setMarkingId(null);setPnlInput("");refetch();
    }catch(e){}
    setMutating(false);
  }
  const panelS={background:C.panel,border:`1px solid ${C.border}`,borderRadius:6,marginBottom:10};
  if(!isElite)return(
    <div style={{...panelS,padding:"20px 18px",textAlign:"center",marginTop:14}}>
      <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:C.gold,letterSpacing:"0.14em",marginBottom:6}}>⚡ SIGNAL PERFORMANCE TRACKER</div>
      <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginBottom:14,lineHeight:1.7}}>Elite unlocks full signal history — win rate per asset,<br/>entry prices, outcomes, and manual mark controls.</div>
      <button onClick={onUpgrade} style={{padding:"8px 22px",background:"rgba(201,168,76,.12)",border:`1px solid rgba(201,168,76,.4)`,borderRadius:4,fontFamily:MONO,fontSize:10,color:C.gold2,cursor:"pointer",letterSpacing:"0.1em"}}>UPGRADE TO ELITE</button>
    </div>
  );
  return(<>
    <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.gold,letterSpacing:"0.16em",marginBottom:8,marginTop:14}}>⚡ SIGNAL PERFORMANCE TRACKER</div>
    {/* Summary stats */}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
      {[
        {label:"TOTAL",val:sigs.length,col:C.white},
        {label:"WINS",val:wins,col:C.green},
        {label:"LOSSES",val:losses,col:C.red},
        {label:"OPEN",val:pending,col:C.muted},
        {label:"WIN RATE",val:winRate!=null?`${winRate}%`:"—",col:winRate!=null?(winRate>=55?C.green:winRate>=45?"#d4af37":C.red):C.muted},
      ].map(({label,val,col})=>(
        <div key={label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 14px",textAlign:"center",minWidth:64}}>
          <div style={{fontFamily:MONO,fontSize:16,fontWeight:800,color:col}}>{val}</div>
          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.1em"}}>{label}</div>
        </div>
      ))}
    </div>
    {/* Per-asset win rates */}
    {assetList.length>0&&(
      <div style={{...panelS,padding:"10px 14px",marginBottom:10}}>
        <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.14em",marginBottom:8}}>WIN RATE BY ASSET</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {assetList.map(([token,st])=>{
            const r=st.wins+st.losses;
            const wr=r>0?Math.round(st.wins/r*100):null;
            return(
              <div key={token} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"6px 12px",textAlign:"center",minWidth:56}}>
                <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.white}}>{token}</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:800,color:wr!=null?(wr>=55?C.green:wr>=45?"#d4af37":C.red):C.muted}}>{wr!=null?`${wr}%`:"—"}</div>
                <div style={{fontFamily:MONO,fontSize:6,color:C.muted}}>{r} resolved</div>
              </div>
            );
          })}
        </div>
      </div>
    )}
    {/* Delayed notice for free users */}
    {isDelayedHistory&&(
      <div data-testid="banner-history-delayed" style={{background:"rgba(255,140,0,.05)",border:"1px solid rgba(255,140,0,.2)",borderRadius:4,padding:"9px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:14}}>⏱</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:MONO,fontSize:8,fontWeight:700,color:"#ff8c00",letterSpacing:"0.12em",marginBottom:2}}>HISTORY DELAYED 30 MINUTES</div>
          <div style={{fontFamily:MONO,fontSize:8,color:C.muted,lineHeight:1.5}}>Free accounts see signals with a 30-min delay. Upgrade to Elite for the full real-time record with entry prices &amp; outcomes.</div>
        </div>
        <button data-testid="btn-upgrade-from-history-delay" onClick={onUpgrade} style={{padding:"6px 14px",background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.35)",borderRadius:3,fontFamily:MONO,fontSize:8,color:C.gold,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Upgrade →</button>
      </div>
    )}
    {/* Signal list */}
    <div style={{...panelS,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.14em"}}>LAST 50 SIGNALS · TAP OPEN TO MARK OUTCOME</div>
      </div>
      {isLoading?(
        <div style={{padding:24,textAlign:"center",fontFamily:MONO,fontSize:9,color:C.muted}}>Loading history…</div>
      ):sigs.length===0?(
        <div style={{padding:24,textAlign:"center",fontFamily:MONO,fontSize:9,color:C.muted}}>No signal history yet — signals are logged when fired.</div>
      ):(
        <div style={{maxHeight:420,overflowY:"auto"}}>
          {sigs.map((s,i)=>{
            const outcomeCol=s.outcome==="WIN"?C.green:s.outcome==="LOSS"?C.red:C.muted;
            const outcomeBg=s.outcome==="WIN"?"rgba(0,199,135,.08)":s.outcome==="LOSS"?"rgba(255,64,96,.08)":"rgba(255,255,255,.04)";
            const isMarking=markingId===s.id;
            return(
              <div key={s.id} data-testid={`signal-history-${s.id}`} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderBottom:i<sigs.length-1?`1px solid ${C.border}`:"none",flexWrap:"wrap"}}>
                <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:C.white,minWidth:38}}>{s.token}</span>
                <span style={{fontFamily:MONO,fontSize:9,color:s.direction==="LONG"?C.green:C.red,fontWeight:700,minWidth:36}}>{s.direction}</span>
                <span style={{fontFamily:MONO,fontSize:8,color:"#d4af37",minWidth:30}}>{s.advancedScore||s.conf}%</span>
                <span style={{fontFamily:MONO,fontSize:8,color:C.muted,flex:1}}>{s.entry?`@ ${s.entry}`:"—"}</span>
                <span style={{fontFamily:MONO,fontSize:7,color:C.muted,minWidth:60,textAlign:"right"}}>{s.ts?new Date(s.ts).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—"}</span>
                <span style={{background:outcomeBg,border:`1px solid ${outcomeCol}44`,borderRadius:3,padding:"2px 8px",fontFamily:MONO,fontSize:8,color:outcomeCol,minWidth:52,textAlign:"center"}}>{s.outcome==="PENDING"?"OPEN":s.outcome}</span>
                {s.outcome==="PENDING"&&(
                  isMarking?(
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input data-testid={`input-pnl-${s.id}`} value={pnlInput} onChange={e=>setPnlInput(e.target.value)} placeholder="P&L%" style={{width:52,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:3,padding:"3px 6px",fontFamily:MONO,fontSize:9,color:C.text,outline:"none"}}/>
                      <button data-testid={`btn-mark-win-${s.id}`} disabled={mutating} onClick={()=>markOutcome(s.id,"WIN")} style={{padding:"3px 8px",background:"rgba(0,199,135,.15)",border:`1px solid rgba(0,199,135,.4)`,borderRadius:3,fontFamily:MONO,fontSize:8,color:C.green,cursor:"pointer"}}>WIN</button>
                      <button data-testid={`btn-mark-loss-${s.id}`} disabled={mutating} onClick={()=>markOutcome(s.id,"LOSS")} style={{padding:"3px 8px",background:"rgba(255,64,96,.12)",border:`1px solid rgba(255,64,96,.35)`,borderRadius:3,fontFamily:MONO,fontSize:8,color:C.red,cursor:"pointer"}}>LOSS</button>
                      <button data-testid={`btn-mark-cancel-${s.id}`} onClick={()=>{setMarkingId(null);setPnlInput("");}} style={{padding:"3px 6px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:3,fontFamily:MONO,fontSize:8,color:C.muted,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <button data-testid={`btn-mark-open-${s.id}`} onClick={()=>{setMarkingId(s.id);setPnlInput("");}} style={{padding:"3px 10px",background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.25)`,borderRadius:3,fontFamily:MONO,fontSize:8,color:C.gold,cursor:"pointer"}}>Mark</button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </>);
}

// ═══════════════════════════════════════════════════════════
// APP
// ─── RESPONSIVE DEVICE HOOK ────────────────────────────────
function useWindowSize(){
  const [size,setSize]=useState(()=>({w:typeof window!=="undefined"?window.innerWidth:1200}));
  useEffect(()=>{
    const fn=()=>setSize({w:window.innerWidth});
    window.addEventListener("resize",fn);
    return()=>window.removeEventListener("resize",fn);
  },[]);
  return{w:size.w,isMobile:size.w<768,isTablet:size.w>=768&&size.w<=1024,isDesktop:size.w>1024};
}

// ─── SIDE NAV (tablet / desktop) ───────────────────────────
function SideNav({items,tab,onTab,C,MONO,SERIF,PRO_TABS_GATE2,isPro,isElite,isPreview,upcomingCount,isDark,toggleTheme,wide}){
  return(
    <div style={{position:"fixed",left:0,top:0,bottom:0,width:wide?180:64,background:isDark?"rgba(5,7,9,.98)":"rgba(255,255,255,.98)",borderRight:`1px solid ${C.border}`,backdropFilter:"blur(14px)",zIndex:100,display:"flex",flexDirection:"column",overflow:"hidden",paddingTop:"env(safe-area-inset-top,0px)"}}>
      <div style={{padding:wide?"16px 14px 14px":"16px 0 14px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
        {wide?(<><div style={{fontFamily:SERIF,fontSize:14,fontWeight:900,color:C.gold,lineHeight:1}}>✦ CLVRQuant</div><div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.2em",marginTop:3}}>AI · INTELLIGENCE</div></>):(<div style={{fontFamily:SERIF,fontSize:18,fontWeight:900,color:C.gold}}>✦</div>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"4px 0"}}>
        {items.map(item=>{
          const active=tab===item.k;
          const macroAlert=item.k==="macro"&&upcomingCount>0;
          const previewFreeTab=["about","help","account"].includes(item.k);
          const eliteGated=!isPreview&&ELITE_TABS_GATE.includes(item.k)&&!isElite;
          const proGated=!isPreview&&PRO_TABS_GATE2.includes(item.k)&&!isPro;
          const locked=(isPreview&&!previewFreeTab)||eliteGated||proGated;
          return(
            <button key={item.k} data-testid={`sidenav-${item.k}`} onClick={()=>{if(item.external){window.open(item.external,"_blank","noopener,noreferrer");return;}onTab(item.k);}} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:wide?"flex-start":"center",gap:wide?10:0,padding:wide?"9px 14px":"10px 0",background:"none",border:"none",borderLeft:`3px solid ${active?C.gold:"transparent"}`,cursor:"pointer",position:"relative",transition:"border-color .2s"}}>
              <span style={{fontSize:item.k==="ai"?11:14,lineHeight:1,fontFamily:item.k==="ai"?SERIF:"inherit",fontWeight:item.k==="ai"?900:"inherit",color:active?C.gold:locked?C.muted:C.muted2,flexShrink:0}}>{item.icon}</span>
              {wide&&<span style={{fontFamily:MONO,fontSize:9,color:active?C.gold:locked?C.muted:C.muted2,letterSpacing:"0.06em",fontWeight:active?700:400,textTransform:"uppercase"}}>{item.label}</span>}
              {macroAlert&&!active&&<div style={{position:"absolute",top:6,right:wide?8:2,width:5,height:5,borderRadius:"50%",background:C.red}}/>}
              {locked&&!active&&<div style={{position:"absolute",top:4,right:wide?8:4,fontSize:7,lineHeight:1,pointerEvents:"none"}}>{isPreview?"🔐":"🔒"}</div>}
            </button>
          );
        })}
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 0",textAlign:"center"}}>
        <button data-testid="btn-sidenav-theme" onClick={toggleTheme} style={{background:"none",border:"none",cursor:"pointer",fontSize:15,padding:"4px 8px"}} title={isDark?"Switch to light mode":"Switch to dark mode"}>{isDark?"☀️":"🌙"}</button>
        {wide&&<div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.1em",marginTop:2}}>{isDark?"LIGHT":"DARK"}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// "What's New This Week" — admin-driven, fetched from /api/weekly-update/latest.
// Falls back to a single placeholder card if no update has been posted yet.
function WhatsNewPanel({ panel, ph, PTitle, Badge, C, SERIF, SANS }){
  const [u,setU]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const r=await fetch("/api/weekly-update/latest");
        const j=await r.json();
        if(alive && j && j.id) setU(j);
      }catch{}
      if(alive) setLoading(false);
    })();
    return()=>{alive=false;};
  },[]);
  if(loading) return null;
  if(!u || !Array.isArray(u.items) || u.items.length===0) return null;
  const items = u.items;
  const versionLabel = u.version || "Latest";
  const headline = u.title || "What's New This Week";
  return (
    <div style={{...panel,border:`1px solid rgba(0,229,255,.22)`,background:"linear-gradient(180deg,rgba(0,229,255,.04),transparent)"}}>
      <div style={ph}><PTitle>{headline}</PTitle><Badge label={versionLabel} color="gold"/></div>
      {u?.summary && (
        <div style={{padding:"0 16px 8px",fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.7}}>{u.summary}</div>
      )}
      <div style={{padding:"4px 16px 16px"}}>
        {items.map((it,i)=>(
          <div key={i} data-testid={`whatsnew-item-${i}`} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 0",borderBottom:i<items.length-1?`1px solid ${C.border}`:"none"}}>
            <div style={{fontSize:16,lineHeight:1.2,flexShrink:0,width:22,textAlign:"center"}}>{it.emoji||"✨"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:SERIF,fontSize:13,fontWeight:700,color:C.gold2,marginBottom:3}}>{it.title}</div>
              <div style={{fontFamily:SANS,fontSize:11,color:C.muted2,lineHeight:1.7}}>{it.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App(){
  // ── Path-based routing for embedded Stripe Checkout (no router dependency) ──
  const _path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (_path === "/checkout" || _path.startsWith("/checkout?")) return <CheckoutPage/>;
  if (_path === "/payment-success" || _path.startsWith("/payment-success?")) return <PaymentSuccessPage/>;

  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  // After login, if a checkout URL was stashed before auth, navigate to it now
  const _checkPostLoginRedirect=()=>{
    try{
      const dest=sessionStorage.getItem("clvr_post_login_url");
      if(dest){sessionStorage.removeItem("clvr_post_login_url");setTimeout(()=>{window.location.href=dest;},80);}
    }catch{}
  };
  const [sessionChecked,setSessionChecked]=useState(false);
  const [isDark,setIsDark]=useState(()=>{try{return localStorage.getItem("clvr_theme")!=="light";}catch{return true;}});
  const toggleTheme=useCallback(()=>{setIsDark(d=>{const next=!d;try{localStorage.setItem("clvr_theme",next?"dark":"light");}catch{}return next;});},[]);
  const themeVal={C:isDark?DARK_C:LIGHT_C,isDark,toggle:toggleTheme};

  // Sync theme class on <html> for CSS overrides
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme",isDark?"dark":"light");
    document.documentElement.classList.toggle("light-mode",!isDark);
  },[isDark]);

  // Check for existing session on mount
  useEffect(()=>{
    fetch("/api/auth/me",{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.id){ setUser(d); _checkPostLoginRedirect(); } })
      .catch(()=>{})
      .finally(()=>setSessionChecked(true));
  },[]);

  // Brief splash while checking session
  if(!sessionChecked){
    return(
      <div style={{background:isDark?"#050709":LIGHT_C.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
        <div style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:28,fontWeight:900,color:"#c9a84c",letterSpacing:"-0.02em"}}>CLVRQuant</div>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,color:isDark?"#2a3650":LIGHT_C.muted,letterSpacing:"0.25em"}}>LOADING...</div>
      </div>
    );
  }

  // Sign-up / sign-in screen (triggered from locked-tab CTA while in preview)
  if(showAuth){
    return(
      <ThemeCtx.Provider value={themeVal}>
        <WelcomePage isDark={isDark} onToggleTheme={toggleTheme} onEnter={(u)=>{setUser(u);setShowAuth(false);_checkPostLoginRedirect();}} onBack={()=>setShowAuth(false)}/>
      </ThemeCtx.Provider>
    );
  }

  if(!user){
    return(
      <ThemeCtx.Provider value={themeVal}>
        <WelcomePage isDark={isDark} onToggleTheme={toggleTheme} onEnter={(u)=>{setUser(u);_checkPostLoginRedirect();}}/>
      </ThemeCtx.Provider>
    );
  }

  return(
    <DataBusProvider>
      <ThemeCtx.Provider value={themeVal}>
        <Dashboard user={user} setUser={setUser} onShowAuth={()=>setShowAuth(true)}/>
      </ThemeCtx.Provider>
    </DataBusProvider>
  );
}

function TradeIdeasDisplay({raw,C,MONO,SERIF}){
  const [data,setData]=useState(null);
  const [err,setErr]=useState(null);
  useEffect(()=>{
    try{
      const cleaned=raw.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
      let parsed;
      const arrStart=cleaned.indexOf("[");const objStart=cleaned.indexOf("{");
      if(objStart!==-1&&(arrStart===-1||objStart<arrStart)){
        const end=cleaned.lastIndexOf("}");
        if(end===-1)throw new Error("No JSON");
        parsed=JSON.parse(cleaned.substring(objStart,end+1));
      }else if(arrStart!==-1){
        const end=cleaned.lastIndexOf("]");
        if(end===-1)throw new Error("No JSON");
        const arr=JSON.parse(cleaned.substring(arrStart,end+1));
        parsed={trades:arr,generated:new Date().toISOString()};
      }else throw new Error("No JSON found");
      if(Array.isArray(parsed))parsed={trades:parsed,generated:new Date().toISOString()};
      if(!parsed.trades||!Array.isArray(parsed.trades))throw new Error("Missing trades array");
      setData(parsed);setErr(null);
    }catch(e){setErr(raw);setData(null);}
  },[raw]);
  if(err)return<div data-testid="text-ai-output" style={{marginTop:12,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:14,fontSize:13,lineHeight:1.9,color:C.text,whiteSpace:"pre-wrap",overflowY:"auto",WebkitOverflowScrolling:"touch",paddingBottom:24}}>{err}</div>;
  if(!data)return null;
  const convColor=(v)=>v>=70?"#00c787":v>=50?"#e8c96d":"#ff4060";
  const scoreColor=(v)=>v>=70?"rgba(0,199,135,.7)":v>=50?"rgba(232,201,109,.7)":"rgba(255,64,96,.7)";
  return(
    <div data-testid="trade-ideas-container" style={{marginTop:12}}>
      <div style={{background:"rgba(201,168,76,.04)",border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,padding:"12px 14px",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{fontFamily:SERIF,fontWeight:900,fontSize:16,color:C.gold,letterSpacing:"-0.02em"}}>TOP 4 TRADE IDEAS</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {data.generated&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.08em"}}>{new Date(data.generated).toLocaleString()}</span>}
            {data.regime&&<span data-testid="badge-regime" style={{fontFamily:MONO,fontSize:8,padding:"2px 8px",borderRadius:2,background:data.regime.score>60?"rgba(0,199,135,.1)":"rgba(255,64,96,.1)",border:`1px solid ${data.regime.score>60?"rgba(0,199,135,.3)":"rgba(255,64,96,.3)"}`,color:data.regime.score>60?C.green:C.red}}>{data.regime.label} {data.regime.score}/100</span>}
            {data.volRegime&&<span data-testid="badge-vol" style={{fontFamily:MONO,fontSize:8,padding:"2px 8px",borderRadius:2,background:data.volRegime==="HIGH"?"rgba(255,64,96,.08)":data.volRegime==="LOW"?"rgba(100,120,160,.08)":"rgba(0,199,135,.08)",border:`1px solid ${data.volRegime==="HIGH"?"rgba(255,64,96,.25)":data.volRegime==="LOW"?"rgba(100,120,160,.25)":"rgba(0,199,135,.25)"}`,color:data.volRegime==="HIGH"?C.red:data.volRegime==="LOW"?C.muted:C.green}}>VOL: {data.volRegime}</span>}
          </div>
        </div>
      </div>
      {data.macroStatus&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:data.macroStatus.clear?"rgba(0,199,135,.04)":"rgba(255,180,50,.06)",border:`1px solid ${data.macroStatus.clear?"rgba(0,199,135,.2)":"rgba(255,180,50,.25)"}`,borderRadius:2,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{fontFamily:MONO,fontSize:9,color:data.macroStatus.clear?C.green:"#ffb432",letterSpacing:"0.1em",fontWeight:700}}>{data.macroStatus.clear?"✅ MACRO: CLEAR":"⚠️ MACRO: CAUTION"}</span>
        {data.macroStatus.nextEvent&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>Next: {data.macroStatus.nextEvent}</span>}
        {data.macroStatus.notes&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>{data.macroStatus.notes}</span>}
      </div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {(data.trades||[]).map((trade,i)=>{
          const isLong=trade.direction==="LONG";
          const borderCol=isLong?"rgba(0,199,135,.4)":"rgba(255,64,96,.4)";
          return(
            <div key={i} data-testid={`trade-card-${i}`} style={{background:C.panel,border:`1px solid ${C.border}`,borderLeft:`3px solid ${borderCol}`,borderRadius:2,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:SERIF,fontWeight:900,fontSize:18,color:C.gold}}>#{trade.rank||i+1}</span>
                  <span style={{fontFamily:MONO,fontSize:14,fontWeight:800,color:C.white,letterSpacing:"0.04em"}}>{trade.asset}</span>
                  <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:2,background:isLong?"rgba(0,199,135,.08)":"rgba(255,64,96,.08)",color:isLong?C.green:C.red,border:`1px solid ${isLong?"rgba(0,199,135,.3)":"rgba(255,64,96,.3)"}`}}>{isLong?"🟢":"🔴"} {trade.direction}</span>
                </div>
                <span style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em",background:"rgba(201,168,76,.06)",padding:"2px 8px",borderRadius:2,border:`1px solid rgba(201,168,76,.15)`}}>{trade.tradeType}</span>
              </div>
              <div style={{padding:"8px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                  <span style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em"}}>CONVICTION</span>
                  <div style={{flex:1,height:14,background:"rgba(255,255,255,.04)",borderRadius:2,overflow:"hidden",position:"relative"}}>
                    <div style={{width:`${trade.conviction||0}%`,height:"100%",background:`linear-gradient(90deg, ${convColor(trade.conviction)}, ${convColor(trade.conviction)}aa)`,borderRadius:2,transition:"width .5s"}}/>
                    <span style={{position:"absolute",right:6,top:1,fontFamily:MONO,fontSize:9,fontWeight:700,color:C.white}}>{trade.conviction}%</span>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",fontFamily:MONO,fontSize:10,lineHeight:2}}>
                  <div style={{color:C.muted}}>📍 ENTRY <span style={{color:C.white,fontWeight:700}}>${trade.entry}</span></div>
                  <div style={{color:C.muted}}>🛑 STOP <span style={{color:C.red,fontWeight:700}}>${trade.sl}</span></div>
                  <div style={{color:C.muted}}>🎯 TP1 ({trade.tp1?.pct||50}%) <span style={{color:C.green,fontWeight:700}}>${trade.tp1?.price}</span>{trade.tp1?.rr&&<span style={{color:C.muted2,fontSize:8}}> {trade.tp1.rr}</span>}</div>
                  <div style={{color:C.muted}}>🎯 TP2 ({trade.tp2?.pct||30}%) <span style={{color:C.green,fontWeight:700}}>${trade.tp2?.price}</span>{trade.tp2?.rr&&<span style={{color:C.muted2,fontSize:8}}> {trade.tp2.rr}</span>}</div>
                  <div style={{color:C.muted}}>🎯 TP3 ({trade.tp3?.pct||20}%) <span style={{color:C.green,fontWeight:700}}>${trade.tp3?.price}</span>{trade.tp3?.trailing&&<span style={{fontSize:7,padding:"1px 5px",borderRadius:2,background:"rgba(0,199,135,.1)",color:C.green,border:"1px solid rgba(0,199,135,.2)",marginLeft:4}}>TRAIL</span>}</div>
                  <div/>
                </div>
                <div style={{display:"flex",gap:10,marginTop:6,padding:"6px 0",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                  {trade.leverage&&<span style={{fontFamily:MONO,fontSize:9,color:"#00d4ff"}}>⚡ {trade.leverage}</span>}
                  {trade.killClock&&<span style={{fontFamily:MONO,fontSize:9,color:C.muted}}>⏱ {trade.killClock}</span>}
                  {trade.edge&&<span style={{fontFamily:MONO,fontSize:9,color:C.gold}}>📊 {trade.edge} ({trade.edgeSource||"est"})</span>}
                  {trade.postTp1&&<span style={{fontFamily:MONO,fontSize:8,color:C.muted2}}>→ {trade.postTp1}</span>}
                </div>
                {trade.thesis&&<div style={{marginTop:8,padding:"8px 10px",background:"rgba(201,168,76,.03)",borderRadius:2,border:`1px solid rgba(201,168,76,.1)`}}>
                  <div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:11,color:C.text,lineHeight:1.7}}>{trade.thesis}</div>
                </div>}
                {trade.invalidation&&<div style={{marginTop:6,padding:"6px 10px",background:"rgba(255,64,96,.04)",borderRadius:2,border:`1px solid rgba(255,64,96,.12)`}}>
                  <span style={{fontFamily:MONO,fontSize:8,color:C.red,letterSpacing:"0.1em",fontWeight:700}}>INVALIDATION: </span>
                  <span style={{fontFamily:MONO,fontSize:9,color:C.muted2}}>{trade.invalidation}</span>
                </div>}
                {trade.flags&&trade.flags.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                  {trade.flags.map((f,fi)=><span key={fi} style={{fontFamily:MONO,fontSize:8,padding:"2px 8px",borderRadius:2,background:"rgba(255,180,50,.08)",border:"1px solid rgba(255,180,50,.2)",color:"#ffb432"}}>⚠️ {f}</span>)}
                </div>}
                {trade.scores&&<div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
                  {Object.entries(trade.scores).map(([k,v])=>(
                    <div key={k} style={{flex:"1 1 auto",minWidth:40,textAlign:"center"}}>
                      <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.08em",marginBottom:2}}>{k.substring(0,4).toUpperCase()}</div>
                      <div style={{height:4,background:"rgba(255,255,255,.04)",borderRadius:2,overflow:"hidden"}}>
                        <div style={{width:`${v}%`,height:"100%",background:scoreColor(v),borderRadius:2}}/>
                      </div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted2,marginTop:1}}>{v}</div>
                    </div>
                  ))}
                </div>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{textAlign:"center",padding:"10px 0",fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.12em",marginTop:6}}>⚠ AI ANALYSIS ONLY · NOT FINANCIAL ADVICE</div>
    </div>
  );
}

function Dashboard({user,setUser,onShowAuth}){
  const {C,isDark,toggle:toggleTheme}=useContext(ThemeCtx);
  const {regime:dbRegime,fearGreed:dbFearGreed,killSwitch:dbKillSwitch}=useDataBus();
  const {isMobile,isTablet,isDesktop}=useWindowSize();
  const sidebarW=isDesktop?180:isTablet?64:0;
  const [tab,setTab]=useState("radar");
  const [clockTick,setClockTick]=useState(0);
  // ── Global market bell state ───────────────────────────────────────────────
  const [bellFlash,setBellFlash]=useState(null); // "open"|"close"|null
  const bellOpenFiredRef=useRef("");
  const bellCloseFiredRef=useRef("");
  const bellFlashTimerRef=useRef(null);
  // ── Squawk Box ─────────────────────────────────────────────────────────────
  const [squawkMuted,setSquawkMuted]=useState(()=>{try{return localStorage.getItem("clvr_squawk")==="off";}catch(e){return false;}});
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
  const [notifPerm,setNotifPerm]=useState(()=>{try{return typeof Notification!=="undefined"?Notification.permission:"default";}catch(e){return"default";}});
  const [pushDisabled,setPushDisabled]=useState(()=>{try{return localStorage.getItem("clvr_push_disabled")==="1";}catch(e){return false;}});
  const [soundEnabled,setSoundEnabled]=useState(()=>{try{return localStorage.getItem("clvr_sound")!=="off";}catch(e){return true;}});
  const [cryptoPrices,setCryptoPrices]=useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,volume:0,live:false,oiHistory:[],volHistory:[],fundHistory:[]}])));
  const [perpPrices,setPerpPrices]=useState(()=>Object.fromEntries(CRYPTO_SYMS.map(k=>[k,{price:CRYPTO_BASE[k],chg:0,funding:0,oi:0,live:false}])));
  const [equityPrices,setEquityPrices]=useState(()=>Object.fromEntries(EQUITY_SYMS.map(k=>[k,{price:EQUITY_BASE[k],chg:0,live:false}])));
  const [metalPrices,setMetalPrices]=useState(()=>Object.fromEntries(METALS_SYMS.map(k=>[k,{price:METALS_BASE[k],chg:0,live:false}])));
  const [forexPrices,setForexPrices]=useState(()=>Object.fromEntries(FOREX_SYMS.map(k=>[k,{price:FOREX_BASE[k],chg:0,live:false}])));

  const [flashes,setFlashes]=useState({});
  const prevRef=useRef({});
  const [alerts,setAlerts]=useState([]);
  const alertsLoaded=useRef(false);
  const [alertForm,setAlertForm]=useState({sym:"BTC",field:"price",condition:"above",threshold:""});
  const [showAlertForm,setShowAlertForm]=useState(false);
  const [liveSignals,setLiveSignals]=useState([]);
  const [newsFeed,setNewsFeed]=useState([]);
  const [newsFilter,setNewsFilter]=useState("ALL");
  const [newsFilteredCount,setNewsFilteredCount]=useState(0);
  const [spikeFilter,setSpikeFilter]=useState(null);
  const [insiderData,setInsiderData]=useState([]);
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
  const [aiOutputMode,setAiOutputMode]=useState("text");
  const [aiLoading,setAiLoading]=useState(false);
  const [aiTimeframe,setAiTimeframe]=useState("today");
  const [aiMode,setAiMode]=useState("chat");
  const idRef=useRef(300);
  useEffect(()=>{
    if(!user||alertsLoaded.current)return;
    alertsLoaded.current=true;
    let alertRetries=0;
    const loadAlerts=()=>{
      fetch("/api/alerts",{credentials:"include"}).then(r=>{
        if(r.status===401){if(alertRetries++<3)setTimeout(loadAlerts,2000);return null;}
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
  const refreshAlerts=useCallback(()=>{
    fetch("/api/alerts",{credentials:"include"}).then(r=>r.ok?r.json():null).then(data=>{
      if(!data)return;
      const mapped=data.map(a=>({...a,threshold:Number(a.threshold)}));
      setAlerts(mapped);
      if(mapped.length>0)idRef.current=Math.max(...mapped.map(a=>a.id))+1;
    }).catch(()=>{});
  },[]);
  const volRef=useRef({});
  const fundRef=useRef({});
  const firedAlerts=useRef(new Set());
  const macroFired=useRef(new Set());
  const soundEnabledRef=useRef(soundEnabled);
  const toggleSound=useCallback(()=>{setSoundEnabled(v=>{const nv=!v;soundEnabledRef.current=nv;try{localStorage.setItem("clvr_sound",nv?"on":"off");}catch(e){}if(nv){unlockAudio();unlockSpeech();playBloombergPing();}return nv;});},[]);
  // Unlock AudioContext + speechSynthesis on the user's first interaction.
  // Required on iOS Safari and most mobile Chrome — without this, the bell
  // (called from a 1-second timer) and the Squawk Box (called from event
  // handlers and timers) stay silent forever even when SOUND is toggled ON,
  // because the user never explicitly tapped the SOUND/SQUAWK button (both
  // default to ON from localStorage on a brand-new browser).
  useEffect(()=>{
    const unlock=()=>{
      unlockAudio();
      unlockSpeech();
      document.removeEventListener("touchstart",unlock,true);
      document.removeEventListener("mousedown",unlock,true);
      document.removeEventListener("keydown",unlock,true);
    };
    document.addEventListener("touchstart",unlock,{once:true,capture:true});
    document.addEventListener("mousedown",unlock,{once:true,capture:true});
    document.addEventListener("keydown",unlock,{once:true,capture:true});
    return()=>{
      document.removeEventListener("touchstart",unlock,true);
      document.removeEventListener("mousedown",unlock,true);
      document.removeEventListener("keydown",unlock,true);
    };
  },[]);
  // Callback for owner test — fires bell + banner immediately
  const triggerTestBell=useCallback((type="open")=>{
    unlockAudio();
    playMarketBell(0.8,type==="open"?3:4);
    setBellFlash(type);
    clearTimeout(bellFlashTimerRef.current);
    bellFlashTimerRef.current=setTimeout(()=>setBellFlash(null),6000);
  },[]);
  // Sync pushDisabled state → module-level flag so sendPush respects toggle
  useEffect(()=>{_pushDisabledFlag=pushDisabled;},[pushDisabled]);
  const [activeAlerts,setActiveAlerts]=useState([]); // floating banner — auto-dismisses after 5s
  const [alertHistory,setAlertHistory]=useState(()=>{try{const s=localStorage.getItem("clvr_alert_history");return s?JSON.parse(s):[];}catch{return[];}});

  const [subEmail,setSubEmail]=useState("");
  const [subName,setSubName]=useState("");
  const [subLoading,setSubLoading]=useState(false);
  const [subList,setSubList]=useState([]);

  const [briefLoading,setBriefLoading]=useState(false);
  const [briefData,setBriefData]=useState(null);
  const [briefDate,setBriefDate]=useState(null);
  const [briefError,setBriefError]=useState("");

  const [userTier,setUserTier]=useState(()=>{try{return user?.tier||localStorage.getItem("clvr_tier")||"free";}catch{return"free";}});
  const isPreview=user?.preview===true;
  const isOwner=(user?.email||"").toLowerCase()==="mikeclaver@gmail.com";

  // ── Market Data Store (shared singleton, all tabs read from here) ──────────
  const {
    spot:storeSpot, perps:storePerps, spreads:storeSpreads,
    marketMode:storeMode, sentiment:storeSentiment, alerts:storeAlerts,
    discoveredAssets:storeAssets, byClass:storeByClass,
    loading:storeLoading, lastUpdate:storeLastUpdate, totalMarkets:storeTotalMarkets,
    refresh:storeRefresh,
  } = useMarketData();

  const { aiContext:twAiContext } = useTwitterIntelligence();

  const [accessCodeInput,setAccessCodeInput]=useState("");
  const [accessCodeMsg,setAccessCodeMsg]=useState("");
  const [showQRScanner,setShowQRScanner]=useState(false);
  const [drawerOpen,setDrawerOpen]=useState(false);
  useEffect(()=>{
    if(!drawerOpen) return;
    const onKey=(e)=>{ if(e.key==="Escape") setDrawerOpen(false); };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[drawerOpen]);
  const [showUpgrade,setShowUpgrade]=useState(false);
  const [upgradePlanTab,setUpgradePlanTab]=useState("pro");
  const [showPricingModal,setShowPricingModal]=useState(false);
  const [upgradeDefaultTier,setUpgradeDefaultTier]=useState(null);
  const [showBiometricSetup,setShowBiometricSetup]=useState(false);
  const [showTour,setShowTour]=useState(false);
  // Auto-show tour on first-ever login (localStorage-gated).
  // If isNewUser flag is set (fresh signup), always force the tour regardless of localStorage.
  useEffect(()=>{
    if(!user)return;
    try{
      if(user.isNewUser){
        localStorage.removeItem("clvr_tour_v1_done");
        setTimeout(()=>setShowTour(true),1000);
      } else if(!localStorage.getItem("clvr_tour_v1_done")){
        setTimeout(()=>setShowTour(true),800);
      }
    }catch{}
  },[user?.id]);
  const [resendLoading,setResendLoading]=useState(false);
  const [resendSent,setResendSent]=useState(false);
  const [verifyBannerDismissed,setVerifyBannerDismissed]=useState(false);
  const handleResendVerification=useCallback(async()=>{
    setResendLoading(true);
    try{const r=await fetch("/api/auth/resend-verification",{method:"POST",credentials:"include"});const d=await r.json();if(r.ok)setResendSent(true);else setToast(d.error||"Failed to send");}catch{setToast("Network error");}
    setResendLoading(false);
  },[]);
  const [mustChangePassword,setMustChangePassword]=useState(()=>!!(user?.mustChangePassword));
  const [newPwInput,setNewPwInput]=useState("");
  const [newPwInput2,setNewPwInput2]=useState("");
  const [changePwLoading,setChangePwLoading]=useState(false);
  const [changePwError,setChangePwError]=useState("");
  const [biometricRegistering,setBiometricRegistering]=useState(false);
  const [stripePrices,setStripePrices]=useState({monthly:null,yearly:null,eliteMonthly:null,eliteYearly:null});
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const isElite=userTier==="elite";
  const isPro=userTier==="pro"||isElite;
  // Stable ref so useCallback closures (addAlert etc.) always see current tier
  const isProRef=useRef(isPro);
  useEffect(()=>{isProRef.current=isPro;},[isPro]);
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
    if(!isProRef.current)return;
    const key=alert.id||alert.title+Date.now();
    const dedupeKey=alert.id||alert.title;
    if(firedAlerts.current.has(dedupeKey))return;
    firedAlerts.current.add(dedupeKey);
    const entry={...alert,id:key,ts:Date.now()};
    // Banner: shows briefly then auto-hides (5s)
    setActiveAlerts(prev=>[entry,...prev.slice(0,4)]);
    setTimeout(()=>setActiveAlerts(prev=>prev.filter(a=>a.id!==key)),5000);
    // History: persists in ALERTS tab until user manually clears
    setAlertHistory(prev=>{const next=[entry,...prev.slice(0,49)];try{localStorage.setItem("clvr_alert_history",JSON.stringify(next));}catch(e){}return next;});
    sendPush(alert.title,alert.body,dedupeKey);
    if(soundEnabledRef.current)playBloombergPing();
    setToast(alert.title);
  },[]);
  const dismissAlert=(id)=>{
    setActiveAlerts(prev=>prev.filter(a=>a.id!==id));
    setAlertHistory(prev=>{const next=prev.filter(a=>a.id!==id);try{localStorage.setItem("clvr_alert_history",JSON.stringify(next));}catch(e){}return next;});
  };
  const clearAllAlertHistory=()=>{setAlertHistory([]);try{localStorage.removeItem("clvr_alert_history");}catch(e){}firedAlerts.current.clear();};

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
        // Preserve the real 24h chg from the last Binance REST poll — never recalculate from a static base
        next[sym]={...prev[sym],price,live:true};
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
            setLiveSignals(prev=>{const existingIds=new Set(prev.map(s=>s.id));const fresh=newSigs.filter(s=>!existingIds.has(s.id));return[...fresh,...prev].slice(0,50);});
            setSigCount(c=>c+newSigs.length);
            setFlashSigId(newSigs[0].id);
            setTimeout(()=>setFlashSigId(null),3000);
            for(const s0 of newSigs){
              const nHash=createNotifHash(s0.ts,s0.token,s0.dir);
              if(!notifHashesRef.current.has(nHash)){
                notifHashesRef.current.add(nHash);
                if(notifHashesRef.current.size>50){const arr=[...notifHashesRef.current];notifHashesRef.current=new Set(arr.slice(-50));}
                // OS notification is handled server-side via the push subscription
                // (broadcastSignalPushParallel → service worker). Calling
                // new Notification() here would create a duplicate.
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

  // ── News Feed — auto-refreshes every 60 seconds ─────────────────────────
  useEffect(()=>{
    const doNews=async()=>{try{const data=await fetchNews();if(data){setNewsFeed(Array.isArray(data.items)?data.items:[]);setNewsFilteredCount(data.filtered||0);}}catch{}};
    doNews();
    const iv=setInterval(doNews,60000);
    return()=>clearInterval(iv);
  },[]);

  // ── Insider Feed — auto-refreshes every 15 minutes (Pro only) ──────────
  useEffect(()=>{
    const userIsPro=userTier==="pro";
    if(!userIsPro)return;
    const doInsider=async()=>{try{const r=await fetch("/api/insider",{credentials:"include"});if(r.ok){const d=await r.json();setInsiderData(d.trades||[]);}}catch{}};
    doInsider();
    const iv=setInterval(doInsider,15*60*1000);
    return()=>clearInterval(iv);
  },[userTier]);

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
        if(data.tier==="elite"){setUserTier("elite");try{localStorage.setItem("clvr_tier","elite");}catch{}setToast("✦ Welcome to CLVRQuant Elite!");}
        else if(data.tier==="pro"){setUserTier("pro");try{localStorage.setItem("clvr_tier","pro");}catch{}setToast("✦ Welcome to CLVRQuant Pro!");}
      }).catch(()=>{});
      window.history.replaceState({},document.title,window.location.pathname);
    }
    if(status==="cancel"){setToast("Checkout cancelled");window.history.replaceState({},document.title,window.location.pathname);}
  },[]);

  useEffect(()=>{
    fetch("/api/prices").then(r=>r.json()).then(data=>{
      if(data?.monthly&&data?.yearly)setStripePrices(data);
    }).catch(()=>{});
  },[]);

  const verifyAccessCode=useCallback(async(codeOverride)=>{
    const code=(codeOverride||accessCodeInput).trim();
    if(!code)return;
    if(codeOverride)setAccessCodeInput(codeOverride);
    try{
      const r=await fetch("/api/verify-code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
      const data=await r.json();
      if(data.valid){
        const grantedTier=data.tier||"elite";
        setUserTier(grantedTier);
        try{localStorage.setItem("clvr_tier",grantedTier);localStorage.setItem("clvr_code",code);}catch{}
        const tierLabel=grantedTier==="elite"?"Elite":"Pro";
        setAccessCodeMsg(`✦ ${data.label} — ${tierLabel} access activated`);
        setToast(`✦ ${tierLabel} access activated!`);
      } else{setAccessCodeMsg(data.error||"Invalid or expired code");}
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
        authenticatorSelection:{
          authenticatorAttachment:"platform",
          userVerification:"required",
          residentKey:"preferred",
        },
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

  const handleCheckout=(priceId)=>{
    if(!priceId){setToast("Plan unavailable");return;}
    // Embedded checkout: navigate to in-app /checkout page (URL stays on our domain)
    window.location.href=`/checkout?priceId=${encodeURIComponent(priceId)}`;
  };

  // ── Macro calendar (30s refresh — fast enough to catch 8:30 AM ET releases) ─
  const fetchMacro=useCallback(()=>{
    fetch("/api/macro").then(r=>r.json()).then(data=>{
      if(Array.isArray(data)) setMacroEvents(data);
      setMacroLoading(false);
    }).catch(()=>setMacroLoading(false));
  },[]);
  useEffect(()=>{fetchMacro();const iv=setInterval(fetchMacro,30000);return()=>clearInterval(iv);},[fetchMacro]);
  // Tick every 30s so nextEvents recomputes and hides the countdown box once an event passes
  useEffect(()=>{const iv=setInterval(()=>setClockTick(t=>t+1),30000);return()=>clearInterval(iv);},[]);

  // ── Global bell & countdown: 1-second tick ─────────────────────────────────
  const [bellSecTick,setBellSecTick]=useState(0);
  useEffect(()=>{const iv=setInterval(()=>setBellSecTick(t=>t+1),1000);return()=>clearInterval(iv);},[]);

  // Bell trigger — fires regardless of which tab the user is on
  useEffect(()=>{
    const soundOn=soundEnabledRef.current;
    if(!soundOn)return;
    const et=getBellET();
    const day=`${et.getFullYear()}-${et.getMonth()}-${et.getDate()}`;
    const h=et.getHours(),m=et.getMinutes(),s=et.getSeconds();
    const isWkd=et.getDay()>=1&&et.getDay()<=5;
    // Opening bell — 9:30 AM ET, within first 10 s
    if(isWkd&&h===9&&m===30&&s<=10&&bellOpenFiredRef.current!==day){
      bellOpenFiredRef.current=day;
      playMarketBell(0.7,3);
      setBellFlash("open");
      clearTimeout(bellFlashTimerRef.current);
      bellFlashTimerRef.current=setTimeout(()=>setBellFlash(null),5000);
    }
    // Closing bell — 4:00 PM ET, within first 10 s
    if(isWkd&&h===16&&m===0&&s<=10&&bellCloseFiredRef.current!==day){
      bellCloseFiredRef.current=day;
      playMarketBell(0.7,4);
      setBellFlash("close");
      clearTimeout(bellFlashTimerRef.current);
      bellFlashTimerRef.current=setTimeout(()=>setBellFlash(null),6000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[bellSecTick]);

  // Global secsToClose — last 60 s before market close
  const _bellEt=getBellET();
  const _bH=_bellEt.getHours(),_bM=_bellEt.getMinutes(),_bS=_bellEt.getSeconds();
  const _isWkd=_bellEt.getDay()>=1&&_bellEt.getDay()<=5;
  const globalSecsToClose=_isWkd
    ?(_bH===15&&_bM===59)?(60-_bS)
    :(_bH===16&&_bM===0&&_bS===0)?0
    :null
    :null;

  const fetchRegime=useCallback(async()=>{
    try{const r=await fetch("/api/regime");if(r.ok){const d=await r.json();setRegimeData(d);}}catch{}
  },[]);
  useEffect(()=>{fetchRegime();const iv=setInterval(fetchRegime,60000);return()=>clearInterval(iv);},[fetchRegime]);

  const askMacroAI=async(evt)=>{
    setMacroAiEvent(evt);setMacroAiResp(null);setMacroAiLoading(true);
    try{
      const sys=`You are QuantBrain, an elite quantitative market intelligence analyst for CLVRQuant. Provide concise, data-driven analysis of economic releases. Focus on: 1) What the data means for markets, 2) Which assets are most affected, 3) How this changes the macro picture, 4) What to watch next. Be precise and use numbers.`;
      const msg=`Analyze this economic release:\n\nEvent: ${evt.name}\nCountry/Region: ${evt.region||evt.country}\nForecast: ${evt.forecast} ${evt.unit||""}\nPrevious: ${evt.previous||evt.current} ${evt.unit||""}\nActual: ${evt.actual||"Not yet released"} ${evt.unit||""}\nImpact Level: ${evt.impact}\nToday: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}\n\n${evt.actual?`The actual came in ${parseFloat(evt.actual)>parseFloat(evt.forecast)?"ABOVE":"BELOW"} expectations.`:"This event has not yet been released."}\n\nWhat does this mean for markets? Which assets move? What's the macro implication? What should I watch next?`;
      const res=await fetch("/api/ai/analyze",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:msg})});
      const data=await res.json();
      if(!res.ok){
        if(res.status===401||res.status===403)setMacroAiResp("✦ PRO FEATURE — Upgrade to Pro to unlock AI-powered macro analysis.");
        else if(data.error==="__MAINTENANCE__"||res.status===503)setMacroAiResp("🔧 CLVR AI is currently undergoing maintenance. Intelligence will be back shortly — please try again in a few minutes.");
        else setMacroAiResp(data.error||"Error. Try again.");
        setMacroAiLoading(false);return;
      }
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
        // Show prominent in-app floating banner (visible even when push is off)
        addAlert({
          type:"price",
          title:`✦ CLVR ALERT: ${a.sym}`,
          body:a.label,
          assets:[a.sym],
          id:`user-alert-${a.id||a.sym}-${Math.floor(Date.now()/60000)}`,
        });
        if(user&&a.id)fetch(`/api/alerts/${a.id}/trigger`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:a.label,sym:a.sym,threshold:a.threshold,condition:a.condition})}).catch(()=>{});
        return{...a,triggered:true};
      }
      return a;
    }));
  },[cryptoPrices,equityPrices,metalPrices,forexPrices,addAlert]);

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
    const macroSnap=macroEvents.length>0?`\nMACRO EVENTS (LIVE): ${macroEvents.slice(0,12).map(e=>`${e.date} ${e.timeET||e.time||""} ${e.region||e.country}: ${e.name} (${e.impact}) prev:${e.previous||e.current} fcast:${e.forecast}${(({actual:a,tag:t}=macroActualLabel(e))=>a?` ACTUAL:${a} ${t}`:"")()}`).join(" | ")}`:"";
    // Detect FOMC/CPI within 48h from macro events
    const now48h=new Date(Date.now()+48*60*60*1000);
    const HIGH_MACRO_KW=["FOMC","CPI","NFP","Non-Farm","GDP","PCE","PPI","Interest Rate"];
    const macroRiskEvts=macroEvents.filter(e=>e.impact==="HIGH"&&e.date&&new Date(e.date)>=new Date()&&new Date(e.date)<=now48h&&HIGH_MACRO_KW.some(k=>(e.name||"").includes(k)));
    const macroRiskNote=macroRiskEvts.length>0?`🔴 MACRO RISK: ${macroRiskEvts.map(e=>e.name).join(", ")} within 48h — SIZE DOWN, cap leverage ≤2x`:"";
    const prompt=`You are CLVR AI — a senior markets correspondent (think Bloomberg / FT / Reuters) writing the morning brief for ${todayStr}. Voice: clear, calm, authoritative economic-journalism prose. Short concrete sentences. No marketing fluff, no hedging clichés. Always name the WHY, not just the WHAT.

⚠️ MANDATORY: Before writing the analysis sections, USE THE web_search TOOL to pull the latest 24-hour headlines for any asset that has moved >2%. In particular, you MUST research:
  • Geopolitics moving oil (US–Iran nuclear talks, OPEC+ statements, Strait of Hormuz, Russia/Ukraine, Red Sea shipping)
  • Fed / ECB / BOJ commentary in the last 24h
  • Any breaking macro story affecting today's price action
Cite the cause in your prose (e.g. "WTI fell 11% after US–Iran officials resumed talks in Muscat, easing supply-disruption premiums"). Do NOT speculate — only state causes you actually find via web_search.

LIVE PRICES (use these EXACT numbers, do not invent any):
CRYPTO: ${cryptoBrief}
EQUITIES: ${stockBrief}
COMMODITIES: ${metalBrief}
FOREX: ${fxBrief}${sigBrief}${newsFeed.length>0?`\nINTERNAL NEWS WIRE: ${newsFeed.slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,80)}`).join(" | ")}`:""}

MACRO CONTEXT:
${macroRiskNote||"No HIGH-impact macro events within 48h — normal risk environment."}
${macroSnap}

STYLE RULES:
• Each asset section is a tight paragraph (4–6 sentences). Lead with the move + the cause, then the technical level, then the outlook.
• Use full sentences and connective tissue ("because", "after", "as", "while"). No bullet-style fragments inside the prose fields.
• Embed risk colour at the END of each section as " 🟢 bias" / " 🟡 bias" / " 🔴 bias".
• Keep R:R for any trade idea ≥ 1.5:1.

Output STRICT JSON (no markdown, no commentary outside the JSON). Use the EXACT live prices above.
{"headline":"5-layer insight headline using actual prices and macro context","bias":"RISK ON|RISK OFF|NEUTRAL","macroRisk":"${macroRiskEvts.length>0?"HIGH":"NORMAL"}","btc":"2-3 sentences: price, trend structure, funding rate, key support/resistance, 🟢/🟡/🔴 bias","eth":"2 sentences ETH trend and BTC dominance context","sol":"1-2 sentences SOL with momentum signal","xau":"2-3 sentences: XAU price, real yield driver, DXY correlation, 🟢/🟡/🔴 bias","xag":"1 sentence XAG with XAU correlation","oil":"3-4 sentences covering WTI AND Brent prices, supply/demand drivers (OPEC+, US inventories, demand), geopolitical risk premium (Middle East, Russia/Ukraine, Strait of Hormuz, Red Sea), and natural gas price if notable. End with 🟢/🟡/🔴 bias for energy sector","equities":"3-4 sentences covering SPX AND NDX levels and overnight move, mega-cap leadership (NVDA/TSLA/AAPL/MSFT/META direction), breadth and sector rotation, key earnings or Fed cross-currents, VIX context. End with 🟢/🟡/🔴 bias for US equities","eurusd":"2-3 sentences: rate, DXY, ECB/Fed divergence, key level, 🟢/🟡/🔴 bias","usdjpy":"2-3 sentences: rate, BOJ stance, real yield spread, intervention risk, 🟢/🟡/🔴 bias","usdcad":"2-3 sentences: rate, oil price correlation, BOC context","impactfulNews":[{"title":"short headline (<80 chars)","impact":"BULLISH|BEARISH|NEUTRAL","assets":"comma-separated tickers most affected","takeaway":"one sentence — what a trader should DO or WATCH because of this"}],"watchToday":["7 specific actionable items with price levels and triggers — each one tells reader WHAT to watch and WHAT to do if it triggers"],"keyRisk":"single sentence: biggest tail risk today and how to hedge it","topTrade":{"asset":"Best trade today","dir":"LONG or SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence edge","riskLabel":"🟢 or 🟡 or 🔴","flags":"macro risk flags or None"},"additionalTrades":[{"asset":"2nd trade — different asset class","dir":"LONG or SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence","riskLabel":"🟢 or 🟡 or 🔴","flags":"any flags"},{"asset":"3rd trade — different asset class","dir":"LONG or SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence","riskLabel":"🟢 or 🟡 or 🔴","flags":"any flags"}]}`;
    // Retry with exponential backoff — never show "unavailable" without trying 3 times.
    // Classify errors so the user gets a real, actionable message instead of a
    // generic "taking longer than usual" toast that makes the button feel broken.
    setBriefError("");
    let lastErr = null;
    let lastErrKind = null; // "auth" | "tier" | "rate" | "maintenance" | "parse" | "empty" | "network"
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt - 2))); // 1.5s, 3s
        }
        const res = await fetch("/api/ai/analyze", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userMessage: prompt, maxTokens: 6000, skipTools: true, enableWebSearch: true }),
        });
        let data = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) {
          const errMsg = data?.error || `HTTP ${res.status}`;
          // Hard failures — don't waste retry attempts
          if (res.status === 401) { lastErrKind = "auth"; lastErr = new Error("Sign in required to generate the brief."); break; }
          if (res.status === 403) { lastErrKind = "tier"; lastErr = new Error("The Morning Brief is a Pro feature. Upgrade to unlock it."); break; }
          if (res.status === 429) { lastErrKind = "rate"; lastErr = new Error("Hourly AI limit reached — please try again later."); break; }
          if (res.status === 503 || errMsg === "__MAINTENANCE__") {
            lastErrKind = "maintenance";
            lastErr = new Error("CLVR AI is briefly under maintenance — please try again in a few minutes.");
            break;
          }
          lastErr = new Error(errMsg);
          lastErrKind = "network";
          continue;
        }
        const txt = data?.text || "";
        if (!txt) { lastErr = new Error("Empty response from CLVR AI"); lastErrKind = "empty"; continue; }
        const clean = txt.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { lastErr = new Error("Brief format unexpected"); lastErrKind = "parse"; continue; }
        let parsed;
        try { parsed = JSON.parse(jsonMatch[0]); }
        catch (pe) { lastErr = new Error("Brief format unexpected"); lastErrKind = "parse"; continue; }
        setBriefData(parsed);
        setBriefDate(todayStr);
        lastErr = null;
        lastErrKind = null;
        break;
      } catch (e) {
        lastErr = e;
        lastErrKind = "network";
      }
    }
    if (lastErr) {
      console.error("[generateBrief] failed:", lastErrKind, lastErr?.message);
      const friendly = lastErrKind === "auth"        ? "Sign in required to generate the morning brief."
                     : lastErrKind === "tier"        ? "The Morning Brief is a Pro feature — upgrade to unlock."
                     : lastErrKind === "rate"        ? "You've hit the hourly AI limit — please try again later."
                     : lastErrKind === "maintenance" ? "CLVR AI is briefly under maintenance. Try again in a few minutes."
                     : lastErrKind === "parse"       ? "Brief came back malformed — please tap Generate again."
                     : lastErrKind === "empty"       ? "CLVR AI returned no content — please tap Generate again."
                     :                                 "Couldn't reach CLVR AI — check your connection and tap Generate again.";
      setBriefError(friendly);
      setToast(friendly);
    }
    setBriefLoading(false);
  };

  // ── AI ────────────────────────────────────────────────
  const runAI=async()=>{
    if(!aiInput.trim()||aiLoading)return;
    setAiLoading(true);setAiOutput("");setAiOutputMode("text");
    const nowISO=new Date().toISOString();
    const nowET=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"America/New_York",hour12:false});
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" LIVE":" est"}`:"n/a";};
    // ── HL PERP data (WebSocket streaming — <1s latency) ──
    const fmtHLPerp=(sym)=>{const d=storePerps[sym];if(!d?.price)return null;const chg=d.change24h!=null?` (${d.change24h>=0?"+":""}${d.change24h.toFixed(2)}%)`:"";const fund=d.funding!=null?` Fund:${d.funding>=0?"+":""}${(d.funding*100).toFixed(4)}%/8h`:" Fund:n/a";const oi=d.openInterest&&d.price?` OI:$${((d.openInterest*d.price)/1e9).toFixed(2)}B`:"";return`${sym} $${mfmtPrice(d.price)}${chg}${fund}${oi}`;};
    const hlCryptoPerpSnap=CRYPTO_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ")||"HL perp data loading";
    const hlEquityPerpSnap=EQUITY_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ");
    const hlMetalPerpSnap=METALS_SYMS.map(fmtHLPerp).filter(Boolean).join(" | ");
    const hlSpotSnap=CRYPTO_SYMS.map(s=>{const d=storeSpot[s];if(!d?.price)return null;const chg=d.change24h!=null?` (${d.change24h>=0?"+":""}${d.change24h.toFixed(2)}%)`:"";return`${s} $${mfmtPrice(d.price)}${chg}`;}).filter(Boolean).join(" | ")||"HL spot data loading";
    // ── Legacy/additional market data ──
    const cryptoSnap=CRYPTO_SYMS.map(s=>{const d=cryptoPrices[s];const f=d?.funding?` F:${pct(d.funding,4)}/8h`:"";const oi=d?.oi?` OI:$${(d.oi/1e6).toFixed(0)}M`:"";return`${s}:${snap(s,cryptoPrices)}${f}${oi}`;}).join(" | ");
    const stockSnap=EQUITY_SYMS.map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ");
    const metalSnap=METALS_SYMS.map(s=>`${METAL_LABELS[s]||s}:${snap(s,metalPrices)}`).join(" | ");
    const fxSnap=FOREX_SYMS.map(s=>`${FOREX_LABELS[s]||s}:${snap(s,forexPrices)}`).join(" | ");
    const sigSnap=liveSignals.length>0?`\nLIVE SIGNALS [fetched:${nowISO}]: ${liveSignals.slice(0,5).map(s=>`${s.token} ${s.dir} ${s.pctMove?s.pctMove+"%":""} — ${s.desc.substring(0,80)}`).join(" | ")}`:"";
    const newsSnap=newsFeed.length>0?`\nLATEST NEWS [fetched:${nowISO}]: ${newsFeed.filter(n=>!n.political).slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,80)} (${n.assets?.join(",")}) sent:${(n.sentiment*100).toFixed(0)}%`).join(" | ")}`:"";
    const politicalItems=newsFeed.filter(n=>n.political);
    const politicalSnap=politicalItems.length>0?`\nPOLITICAL ALPHA [fetched:${nowISO}] — Market-moving political/macro news. Apply to risk assessment and asset-class bias:\n  ${politicalItems.slice(0,6).map(n=>`[${n.marketImpact?.toUpperCase()||"NEUTRAL"}] [${n.source}] ${n.title.substring(0,100)} (assets:${n.assets?.join(",")||"macro"})`).join("\n  ")}`:"";
    const conflictItems=newsFeed.filter(n=>n.isConflict);
    const conflictSnap=conflictItems.length>0?`\nCONFLICT & GEOPOLITICAL EVENTS [fetched:${nowISO}] — Active military, sanctions, and supply chain events. Factor into Oil, Gold, and defense bias:\n  ${conflictItems.slice(0,6).map(n=>`[${n.source}] ${n.title.substring(0,110)} (market impact: ${n.marketImpact||"BEARISH"})`).join("\n  ")}`:"";
    // SEC Insider buying signals
    const insiderSnap=insiderData.length>0?(()=>{const byTicker={};for(const t of insiderData){if(!byTicker[t.ticker])byTicker[t.ticker]=[];byTicker[t.ticker].push(t);}const sorted=Object.entries(byTicker).sort(([,a],[,b])=>b.reduce((s,x)=>s+(x.value||0),0)-a.reduce((s,x)=>s+(x.value||0),0)).slice(0,5);const lines=sorted.map(([tk,ins])=>{const tot=ins.reduce((s,x)=>s+(x.value||0),0);const fv=tot>=1e6?`$${(tot/1e6).toFixed(1)}M`:`$${(tot/1e3).toFixed(0)}K`;const cluster=ins.length>=2?" [CLUSTER BUY ⚠️]":"";return`  ${tk}: ${ins.length} insider${ins.length>1?"s":""} bought ${fv}${cluster}`;});return`\nSEC INSIDER BUYING SIGNALS (last 7 days, $100K+ purchases):\n${lines.join("\n")}`;})():"";
    const macroAiSnap=macroEvents.length>0?`\nMACRO EVENTS [fetched:${nowISO}]: ${macroEvents.slice(0,15).map(e=>`${e.date} ${e.timeET||e.time||""} ET | ${e.region||e.country}: ${e.name} | Impact:${e.impact} | Prev:${e.previous||e.current||"—"} | Fcast:${e.forecast||"—"}${(({actual:a,tag:t}=macroActualLabel(e))=>a?` | ACTUAL:${a} ${t}`:e.isPast?" | STATUS:PENDING DATA":"")()}`).join("\n  ")}`:"";
    const storeModeSnap=storeMode?`\nCLVR MARKET INTELLIGENCE [${storeTotalMarkets} live markets]: Regime=${storeMode.regime} Score=${storeMode.score}/100 | Crypto=${storeMode.crypto?.regime||"N/A"} ${storeMode.crypto?.score||"?"}% | Equities=${storeMode.equities?.regime||"N/A"} ${storeMode.equities?.score||"?"}% | Commodities=${storeMode.commodities?.regime||"N/A"} ${storeMode.commodities?.score||"?"}%${storeAlerts?.length>0?` | AUTO-ALERTS: ${storeAlerts.slice(0,3).map(a=>`${a.ticker} ${a.type} ${a.severity}`).join(", ")}`:""}${storeMode.correlations?.length>0?` | CROSS-ASSET: ${storeMode.correlations.slice(0,2).map(c=>`${c.signal}: ${c.msg.slice(0,60)}`).join(" | ")}`:""}`:"";
    // Detailed regime + crash risk + liquidity conditions (Command Center data)
    const regimeSnap=regimeData?`\nCOMMAND CENTER — RISK ENGINE: CrashProb=${regimeData.crash?.probability||0}% (${regimeData.crash?.probability>80?"⚠️ EXTREME":regimeData.crash?.probability>60?"⚠️ HIGH":regimeData.crash?.probability>40?"ELEVATED":"LOW"}) | Liquidity=${regimeData.liquidity?.mode||"N/A"} Score=${regimeData.liquidity?.score||50}/100 | Regime=${regimeData.regime?.regime||"N/A"} Score=${regimeData.regime?.score||50}/100${regimeData.regime?.components?` | Components: ${Object.entries(regimeData.regime.components).slice(0,4).map(([k,v])=>`${k}=${v}`).join(", ")}`:""}`:"";
    // Liquidation heatmap context (key price levels with estimated liq clusters)
    const liqHeatSnap=(()=>{const p=cryptoPrices;const liqCtx=["BTC","ETH","SOL"].map(sym=>{const d=p[sym];if(!d?.price)return null;const price=d.price;const oiM=(d.oi||0)/1e6;return`${sym}: mark=$${price.toLocaleString()} OI=$${oiM.toFixed(0)}M funding=${(d.funding||0).toFixed(4)}%`;}).filter(Boolean).join(" | ");return liqCtx?`\nLIQUIDATION HEATMAP CONTEXT (estimated from OI+funding — actual levels in SECTION A): ${liqCtx}`:""})();
    // Fetch Polymarket prediction odds live and inject into AI context
    let polySnap="";
    try{
      const pr=await fetch("/api/polymarket",{credentials:"include"});
      if(pr.ok){
        const pd=await pr.json();
        if(Array.isArray(pd)&&pd.length>0){
          polySnap=`\nPOLYMARKET PREDICTION ODDS [fetched:${nowISO}]: ${pd.slice(0,8).map(m=>`${m.question||m.slug}: ${m.probability!==undefined?(m.probability*100).toFixed(1)+"% YES":m.outcomePrices?JSON.stringify(m.outcomePrices):"N/A"}`).join(" | ")}`;
        }
      }
    }catch{}
    const sys=`You are CLVRQuantAI's AI Analyst for leveraged perp futures across crypto, FX, commodities, and equities. Be direct, data-driven, no fluff.

RULES — apply to EVERY output:

1. TRADE TYPE: Classify as SCALP (1-4H hold), DAY TRADE (4-24H), SWING (1-7D), or POSITION (1-4W). Default to DAY TRADE if unclear.

2. VOLATILITY REGIME: Compare current ATR to 20-period avg ATR on the trade type's reference timeframe.
   HIGH (ATR>1.5x avg): compress TP 30%, widen SL 20%, reduce size 25%.
   NORMAL (0.7-1.5x): standard params.
   LOW (ATR<0.7x): skip or reduce size 50%.

3. ATR-SCALED TP/SL — reference timeframes: SCALP=ATR(1H), DAY=ATR(4H), SWING=ATR(1D), POSITION=ATR(1W).
   TP1=0.5x ATR (50% position), TP2=1x ATR (30%), TP3=1.5x ATR (20% trailing).
   SL: SCALP=0.3-0.5x ATR, DAY=0.5-0.75x ATR, SWING=0.75-1x ATR, POSITION=1-1.5x ATR.
   Minimum R:R to TP1 must be 1.2:1 or reject the signal.

4. KILL CLOCK: SCALP=2-4H, DAY=12-24H, SWING=48-72H, POSITION=5-7D. If no TP1 progress at 50% of kill clock, flag momentum decay.

5. MACRO GATE: Block signals within 2H of FOMC/CPI/NFP/BOJ/ECB/BOE. Dampen 20% within 4H of PPI/GDP/retail sales/Fed speakers.

6. OI OVERLAY (when available): OI rising+price rising=bullish, OI rising+price falling=bearish, OI falling+price rising=squeeze (fragile), OI falling+price falling=liquidation (avoid longs). Funding >+0.03% reduces long edge, <-0.03% reduces short edge.

7. EDGE LABELING: Always state "OI-verified", "estimated", or "no OI" after the edge score. Never claim backtest win rates without data.

8. POST-TP1: Move SL to breakeven. After TP2: trail SL at 0.5x ATR. Kill clock expiry with no TP1: close at market.

OUTPUT FORMAT for signals:
[EMOJI] [ASSET]/USDT [DIRECTION] — [TRADE TYPE]
Vol Regime: [🔴/🟡/🟢] [HIGH/NORMAL/LOW]
Entry: [price] | TP1: [price] (50%) | TP2: [price] (30%) | TP3: [price] (20% trail) | SL: [price]
R:R: [X:1] to TP1 | Edge: [X]% ([source]) | Kill: [X]H | Leverage: [X]x
Thesis: [1-2 sentences] | Invalidation: [price/condition] | Post-TP1: SL→BE, trail TP3 at 0.5x ATR

OUTPUT FORMAT for analysis:
📊 [ASSET] — [TIMEFRAME] | Vol: [regime] | Bias: [LONG/SHORT/NEUTRAL]
Support: [S1], [S2] | Resistance: [R1], [R2]
Structure: [2-3 lines] | Flow: [OI/funding] | Macro: [upcoming events]
Playbook: IF [condition] → [action] (provide 2-3 scenarios)

SELF-AUDIT before every output: Trade type? Vol regime? Macro checked? ATR-scaled TP×3? Kill clock? R:R to TP1? OI applied? Post-TP1 plan?

TODAY: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})} | Current ET time: ${nowET}
[Data fetched: ${nowISO}]

━━━ SECTION A — HYPERLIQUID PERP DATA [LIVE STREAMING — <1s latency] ━━━
Authority source for ALL perpetuals/futures analysis. Mark prices direct from HL WebSocket.
CRYPTO PERPS (${hlCryptoPerpSnap.split("|").length} assets): ${hlCryptoPerpSnap}${hlEquityPerpSnap?`\nEQUITY PERPS (HL synthetic): ${hlEquityPerpSnap}`:""}${hlMetalPerpSnap?`\nCOMMODITY PERPS (HL synthetic): ${hlMetalPerpSnap}`:""}
Funding rate key: positive = longs pay shorts (crowded long, reversal risk); negative = shorts pay longs (short squeeze risk)

━━━ SECTION B — HYPERLIQUID SPOT DATA [LIVE] ━━━
${hlSpotSnap}

━━━ SECTION C — ADDITIONAL MARKET DATA [30-120s delayed — confirmation only] ━━━
CRYPTO spot (CoinGecko): ${cryptoSnap}
EQUITIES (Yahoo/FMP): ${stockSnap}
COMMODITIES: ${metalSnap}
FOREX (Yahoo/FMP — no HL forex perps): ${fxSnap}${sigSnap}${newsSnap}${politicalSnap}${storeModeSnap}${regimeSnap}${liqHeatSnap}
${macroAiSnap}${polySnap}${twAiContext||""}${conflictSnap}${insiderSnap}

⚡ DATA USAGE PROTOCOL — FOLLOW STRICTLY:
→ PERP/futures question → use SECTION A (HL mark price + funding + OI are definitive)
→ SPOT question → use SECTION B first, SECTION C as confirmation
→ EQUITY/COMMODITY → HL synthetic perps in SECTION A for futures; SECTION C for cash/spot
→ FOREX → SECTION C only (no HL forex perpetuals)
→ If SECTION A and SECTION C differ by >0.5% → flag the basis difference, trust SECTION A
→ "n/a" or missing HL data → state data unavailable; use SECTION C with "est" caveat

ANALYSIS STEPS (run mentally before every output):
1. DATA FRESHNESS: Flag any "n/a" as UNVERIFIED. 2. MACRO CHECK: HIGH-impact within 6h→⚠️ IMMINENT, within 48h→cap lev 2x. 3. STOP/TF CONSISTENCY: Scalp 1-1.5%/10x, Day 1.5-3%/5x, Swing 4-7%/3x. 4. RESISTANCE MAP: ID levels between entry and TP1. 5. FLAGS: Required — list all active flags or "CLEAN". 6. QUIET DAY FILTER: No macro within 8h→filter FX/Gold/stocks (crypto always OK). 7. TP VALIDATION: move needed = TP% ÷ leverage, compare to asset's daily range.

End every signal with:
━━━ CLVR SIGNAL ━━━
🔥/⚡/⚠️/❌ TIER [1/2/3/NO TRADE] | [ASSET] [LONG/SHORT]
Entry: $X | SL: $X (-X%) | TP1: $X (+X%) R:R X:1 | TP2: $X (+X%)
Leverage: Xx | Conviction: X% | Kelly: X% | Edge: [1 sentence]
Flags: [list or CLEAN] | Audit: Prices [FRESH/STALE] | Macro [CLEAR/RISK]

⚠️ AI analysis only. Always apply your own judgment and risk management.
Be decisive, specific, and numerical. Use exact live prices. Never force a signal.`;
    try{
      const res=await fetch("/api/ai/analyze",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:sys,userMessage:aiInput})});
      const data=await res.json();
      if(!res.ok){
        if(res.status===401||res.status===403)setAiOutput("✦ PRO FEATURE\n\nAI Market Analyst is exclusive to Pro subscribers. Upgrade to Pro to unlock:\n• CLVR AI analysis — powered by Claude Sonnet 4\n• Top 4 trade ideas with Entry / Stop / TP1 / TP2\n• Confidence levels & Kelly sizing\n• Cross-asset intelligence\n\nTap UPGRADE in the top bar.");
        else if(data.error==="__MAINTENANCE__"||res.status===503)setAiOutput("🔧 CLVR AI Maintenance\n\nOur AI intelligence engine is currently undergoing maintenance and will be back shortly.\n\nPlease try again in a few minutes — all other features remain fully operational.");
        else setAiOutput(data.error||`Error ${res.status}`);
        setAiLoading(false);return;
      }
      setAiOutput(data.text||"No response.");
    }catch(e){setAiOutput(`Error: ${e.message}`);}
    setAiLoading(false);
  };

  // ── Trade Ideas (QuantBrain integrated) ─────────────────
  const runTradeIdeas=async()=>{
    if(aiLoading)return;
    setAiLoading(true);setAiOutput("");setAiOutputMode("trades");
    const btc=cryptoPrices["BTC"]||{};
    const fundRate=btc.funding||0;
    const volH=btc.volHistory||[];const lastVol=volH[volH.length-1]||0;
    const avgVol=volH.length>=5?volH.slice(-5).reduce((a,b)=>a+b,0)/5:1;
    const volSpike=avgVol>0?lastVol/avgVol:1;
    const oiH=btc.oiHistory||[];
    const oiTrend=oiH.length>=2?(oiH[oiH.length-1]>oiH[oiH.length-2]*1.02?"rising":oiH[oiH.length-1]<oiH[oiH.length-2]*0.98?"falling":"flat"):"flat";
    let cScore=0;
    if(fundRate>0.01)cScore-=1;
    else if(fundRate<-0.01)cScore+=1;
    if(volSpike>=2)cScore+=1;
    if(oiTrend==="rising")cScore+=1;
    else if(oiTrend==="falling")cScore-=1;
    const regime=volSpike>=2&&oiTrend==="rising"?"MOMENTUM":"MEAN REVERSION";
    const prob=Math.max(5,Math.min(95,50+(cScore/8)*40));
    const kellyPct=Math.max(0,Math.min(25,(prob/100)-(1-prob/100)/2))*100;
    const snap=(sym,p)=>{const d=p[sym];return d?`${fmt(d.price,sym)} (${pct(d.chg)})${d.live?" LIVE":" est"}`:"n/a";};
    const fmtHLPerp2=(sym)=>{const d=storePerps[sym];if(!d?.price)return null;const chg=d.change24h!=null?` (${d.change24h>=0?"+":""}${d.change24h.toFixed(2)}%)`:"";const fund=d.funding!=null?` Fund:${d.funding>=0?"+":""}${(d.funding*100).toFixed(4)}%/8h`:" Fund:n/a";const oi=d.openInterest&&d.price?` OI:$${((d.openInterest*d.price)/1e9).toFixed(2)}B`:"";return`${sym} $${mfmtPrice(d.price)}${chg}${fund}${oi}`;};
    const hlCryptoPerpSnap2=CRYPTO_SYMS.map(fmtHLPerp2).filter(Boolean).join(" | ")||"HL perp data loading";
    const hlEquityPerpSnap2=EQUITY_SYMS.map(fmtHLPerp2).filter(Boolean).join(" | ");
    const hlMetalPerpSnap2=METALS_SYMS.map(fmtHLPerp2).filter(Boolean).join(" | ");
    const hlSpotSnap2=CRYPTO_SYMS.map(s=>{const d=storeSpot[s];if(!d?.price)return null;const chg=d.change24h!=null?` (${d.change24h>=0?"+":""}${d.change24h.toFixed(2)}%)`:"";return`${s} $${mfmtPrice(d.price)}${chg}`;}).filter(Boolean).join(" | ")||"HL spot data loading";
    const cryptoSnap=CRYPTO_SYMS.map(s=>{const d=cryptoPrices[s];const f=d?.funding?` F:${pct(d.funding,4)}/8h`:"";const oi=d?.oi?` OI:$${(d.oi/1e6).toFixed(0)}M`:"";return`${s}:${snap(s,cryptoPrices)}${f}${oi}`;}).join(" | ");
    const stockSnap=EQUITY_SYMS.map(s=>`${s}:${snap(s,equityPrices)}`).join(" | ");
    const metalSnap=METALS_SYMS.map(s=>`${METAL_LABELS[s]||s}:${snap(s,metalPrices)}`).join(" | ");
    const fxSnap=FOREX_SYMS.map(s=>`${FOREX_LABELS[s]||s}:${snap(s,forexPrices)}`).join(" | ");
    const nowISO2=new Date().toISOString();
    const nowET2=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",timeZone:"America/New_York",hour12:false});
    const sigSnap=liveSignals.length>0?`\nLIVE SIGNALS: ${liveSignals.slice(0,5).map(s=>`${s.token} ${s.dir} ${s.pctMove?s.pctMove+"%":""}`).join(" | ")}`:"";
    const newsSnap=newsFeed.length>0?`\nNEWS: ${newsFeed.filter(n=>!n.political).slice(0,5).map(n=>`[${n.source}] ${n.title.substring(0,60)}`).join(" | ")}`:"";
    const macroSnap2=macroEvents.length>0?`\nMACRO: ${macroEvents.slice(0,10).map(e=>`${e.date} ${e.timeET||e.time||""} ET ${e.region||e.country}: ${e.name} Impact:${e.impact}`).join(" | ")}`:"";
    const tfLabel=aiTimeframe==="midterm"?"MID-TERM (1-4 week)":aiTimeframe==="longterm"?"LONG-TERM (1-3 month)":"INTRADAY/SWING";
    const sys=`You are CLVRQuantAI's Trade Idea Generator. You MUST return exactly 4 trade ideas as a JSON object. No markdown. No prose. Only valid JSON.

RULES:
- Return EXACTLY 4 trades, ranked by conviction score (highest first)
- Cover diverse assets (mix of crypto, equity, FX, commodity — don't repeat asset classes unless one class dominates)
- Apply ATR-scaled TP/SL: TP1=0.5x ATR(4H) at 50%, TP2=1x ATR at 30%, TP3=1.5x ATR at 20% trailing
- Vol regime: compare ATR to 20-period avg. HIGH(>1.5x): compress TP 30%, widen SL 20%. LOW(<0.7x): skip asset.
- Macro gate: block if high-impact event within 2H, note upcoming events
- Minimum R:R to TP1: 1.2:1
- Kill clock: SCALP 2-4H, DAY 12-24H, SWING 48-72H
- If fewer than 4 qualify, relax threshold to 50% edge but flag as LOW CONVICTION
- Label edge: "OI-verified" if live OI, "estimated" if inferred, "no OI" if unavailable
- Timeframe focus: ${tfLabel}

TODAY: ${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})} | ET: ${nowET2}

PERPS [LIVE]: ${hlCryptoPerpSnap2}${hlEquityPerpSnap2?` | EQ: ${hlEquityPerpSnap2}`:""}${hlMetalPerpSnap2?` | CMD: ${hlMetalPerpSnap2}`:""}
SPOT: ${hlSpotSnap2}
DELAYED: CRYPTO: ${cryptoSnap} | EQ: ${stockSnap} | CMD: ${metalSnap} | FX: ${fxSnap}${sigSnap}${newsSnap}${macroSnap2}
CONFLUENCE: Score ${cScore > 0 ? "+" : ""}${cScore}/8 | Regime: ${regime} | Prob: ${prob.toFixed(1)}% | Kelly: ${kellyPct.toFixed(1)}%

RESPOND WITH THIS EXACT JSON STRUCTURE — nothing else:
{"generated":"ISO-DATE","regime":{"score":63,"label":"RISK-ON","bias":"Mean-Reversion"},"macroStatus":{"clear":true,"nextEvent":"FOMC Williams 08:35 ET Apr 16","notes":"No blocks active"},"volRegime":"HIGH","trades":[{"rank":1,"asset":"INJ/USDT","direction":"LONG","tradeType":"DAY TRADE","entry":3.29,"sl":3.07,"tp1":{"price":3.58,"pct":50,"rr":"1.3:1"},"tp2":{"price":3.82,"pct":30,"rr":"2.4:1"},"tp3":{"price":4.10,"pct":20,"trailing":true},"leverage":"3x","killClock":"24H","conviction":72,"edge":"72%","edgeSource":"estimated","thesis":"Short thesis here.","invalidation":"Break below $3.07 with volume","flags":["Small OI","HIGH vol"],"scores":{"trend":75,"momentum":80,"structure":68,"oi":65,"volume":55,"macro":70},"postTp1":"SL to breakeven at $3.29"}]}`;
    const userMsg=`Generate ${tfLabel} TOP 4 TRADE IDEAS. Return ONLY valid JSON matching the structure in your instructions. No markdown, no text before or after. Use live prices provided.`;
    // 90s client-side timeout: Claude with 4096 max_tokens can take 45-70s,
    // and Safari aborts fetches with the cryptic "Load failed" after ~60s on
    // some networks. AbortController gives us a clean error path either way.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 90_000);
    try{
      const res=await fetch("/api/ai/analyze",{
        method:"POST",
        credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({system:sys,userMessage:userMsg,maxTokens:4096}),
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      const data=await res.json();
      if(!res.ok){
        if(res.status===401||res.status===403){setAiOutput("✦ PRO FEATURE\n\nAI Trade Ideas are exclusive to Pro subscribers. Upgrade to Pro to unlock:\n• Top 4 trade ideas across all asset classes\n• Entry / Stop Loss / TP1 / TP2 for each trade\n• Confidence levels & Kelly position sizing\n• Bayesian probability estimates\n\nTap UPGRADE in the top bar.");setAiOutputMode("text");}
        else if(data.error==="__MAINTENANCE__"||res.status===503){setAiOutput("🔧 CLVR AI Maintenance\n\nOur AI intelligence engine is currently undergoing maintenance and will be back shortly.\n\nPlease try again in a few minutes — all other features remain fully operational.");setAiOutputMode("text");}
        else{setAiOutput(data.error||`Error ${res.status}`);setAiOutputMode("text");}
        setAiLoading(false);return;
      }
      setAiOutput(data.text||"No response.");
    }catch(e){
      clearTimeout(timeoutId);
      const msg = e.name === "AbortError"
        ? "⏱ Trade Ideas timed out (90s).\n\nClaude is taking longer than usual to generate your top 4 trade ideas. This usually clears in a minute — please tap GENERATE TRADE IDEAS again."
        : `Network error: ${e.message}.\n\nCheck your connection and tap GENERATE TRADE IDEAS to retry.`;
      setAiOutput(msg);
      setAiOutputMode("text");
    }
    setAiLoading(false);
  };

  // ─── Style Helpers ─────────────────────────────────────

  const panel={background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const onUpgrade=useCallback(()=>setShowPricingModal(true),[]);



  const onShareSig=useCallback((sig)=>shareSignal(sig),[shareSignal]);
  const onAiSig=useCallback((sig)=>{setAiInput(`Analyze: ${sig.token} ${sig.dir} — ${sig.desc}`);setTab("ai");},[]);
  const onAiChange=useCallback((v)=>setAiInput(v),[]);
  const openTradeModal=useCallback((sig)=>setTradeModalSig(sig),[]);

  const hlLive=hlStatus==="live",fhLive=fhStatus==="live";
  const allSignals=[...liveSignals].sort((a,b)=>(b.ts||0)-(a.ts||0));
  const filtSigs=allSignals.filter(s=>{
    if(sigSubTab==="all")return true;
    if(sigSubTab==="crypto")return s.src==="hyperliquid"||s.src==="alpha-detect";
    if(sigSubTab==="equity")return s.src==="trade.xyz";
    if(sigSubTab==="metals")return["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"].includes(s.token);
    if(sigSubTab==="forex")return FOREX_SYMS.includes(s.token);
    return true;
  });

  // ── Macro event helpers ──────────────────────────────
  const today=new Date();
  // Date string helpers: compare event dates as YYYY-MM-DD strings using ET timezone
  // This prevents the off-by-one day issue (e.g., "2026-03-12" at UTC midnight = March 11 7PM ET)
  const todayETStr=new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});
  const tomorrowETStr=new Date(Date.now()+86400000).toLocaleDateString("en-CA",{timeZone:"America/New_York"});
  const eventStatus=(dateStr)=>{
    if(!dateStr)return{label:"?",color:"muted"};
    if(dateStr<todayETStr)return{label:"PAST",color:"muted"};
    if(dateStr===todayETStr)return{label:"TODAY",color:"red"};
    if(dateStr===tomorrowETStr)return{label:"TMRW",color:"orange"};
    // Calculate day diff by comparing date strings directly (avoids DST/timezone issues)
    const diff=Math.round((new Date(dateStr+"T12:00:00")-new Date(todayETStr+"T12:00:00"))/(1000*60*60*24));
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

  // Use ET timezone for date comparisons so US economic events (e.g. 8:30 AM ET jobless claims) show on correct day
  const macroTodayStr=new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});// YYYY-MM-DD in ET
  const macroTodayEvents=macroEvents.filter(e=>e.date===macroTodayStr);
  const macroWeekEndDate=new Date();macroWeekEndDate.setDate(macroWeekEndDate.getDate()+(6-macroWeekEndDate.getDay()));macroWeekEndDate.setHours(23,59,59,999);
  const macroWeekStartStr=macroTodayStr;
  const macroWeekEndStr=macroWeekEndDate.toLocaleDateString("en-CA",{timeZone:"America/New_York"});
  const macroWeekEvents=macroEvents.filter(e=>e.date>=macroWeekStartStr&&e.date<=macroWeekEndStr);
  const macroAllFiltered=(macroCalTab==="today"?macroTodayEvents:macroWeekEvents)
    .filter(e=>macroRegionFilter==="ALL"||(e.country||"").toUpperCase()===macroRegionFilter)
    .filter(e=>macroImpactFilter==="ALL"||e.impact===macroImpactFilter)
    .sort((a,b)=>{const da=new Date(a.date).getTime();const db=new Date(b.date).getTime();if(da!==db)return da-db;const ta=a.timeET||a.time||"00:00";const tb=b.timeET||b.time||"00:00";return ta.localeCompare(tb);});
  const macroReleasedCount=macroAllFiltered.filter(e=>e.released||e.isPast).length;
  const macroPendingCount=macroAllFiltered.filter(e=>!e.released&&!e.isPast).length;
  const macroHighCount=macroAllFiltered.filter(e=>e.impact==="HIGH").length;
  const macroSortedForNext=[...macroEvents].filter(e=>!e.released&&!e.isPast&&e.date>=macroTodayStr).sort((a,b)=>{const da=new Date(a.date).getTime()-new Date(b.date).getTime();if(da!==0)return da;return(a.timeET||a.time||"00:00").localeCompare(b.timeET||b.time||"00:00");});
  const macroNextPending=macroSortedForNext[0]||null;

  const requestPush=async()=>{
    // ── Already granted + active → DISABLE ──────────────────────────────────
    if(notifPerm==="granted"&&!pushDisabled){
      try{
        if(typeof navigator!=="undefined"&&navigator.serviceWorker){
          const swReg=await navigator.serviceWorker.ready;
          const sub=await swReg.pushManager.getSubscription();
          if(sub) await sub.unsubscribe().catch(()=>{});
        }
      }catch(e){}
      try{await fetch("/api/push/unsubscribe",{method:"POST",credentials:"include"});}catch(e){}
      setPushDisabled(true);
      try{localStorage.setItem("clvr_push_disabled","1");}catch(e){}
      setToast("🔕 Push notifications disabled");
      return;
    }
    // ── Granted but disabled → RE-ENABLE ────────────────────────────────────
    if(notifPerm==="granted"&&pushDisabled){
      // Always clear the disabled flag first — in-app alerts will work regardless
      setPushDisabled(false);
      try{localStorage.removeItem("clvr_push_disabled");}catch(e){}
      // Then attempt to re-subscribe to OS push (best effort — non-blocking)
      try{
        const swReg=await navigator.serviceWorker.ready;
        const keyRes=await fetch("/api/push/public-key");
        const{publicKey}=await keyRes.json();
        const b64=publicKey.replace(/-/g,"+").replace(/_/g,"/");
        const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        const existing=await swReg.pushManager.getSubscription();
        if(existing) await existing.unsubscribe().catch(()=>{});
        const sub=await swReg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:raw});
        await fetch("/api/push/subscribe",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscription:sub.toJSON()})});
        setToast("🔔 Push notifications re-enabled");
      }catch(e){
        // Push subscription failed but in-app alerts are active
        setToast("🔔 Alerts re-enabled — in-app notifications active");
      }
      return;
    }
    // ── Not granted → REQUEST PERMISSION ────────────────────────────────────
    if(typeof Notification==="undefined"){setNotifPerm("granted");setToast("In-app alerts enabled");return;}
    try{
      const perm=await Notification.requestPermission();
      setNotifPerm(perm);
      if(perm==="granted"){
        try{
          const swReg=await navigator.serviceWorker.ready;
          const keyRes=await fetch("/api/push/public-key");
          const{publicKey}=await keyRes.json();
          const b64=publicKey.replace(/-/g,"+").replace(/_/g,"/");
          const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
          const existing=await swReg.pushManager.getSubscription();
          if(existing) await existing.unsubscribe().catch(()=>{});
          const sub=await swReg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:raw});
          await fetch("/api/push/subscribe",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscription:sub.toJSON()})});
          setPushDisabled(false);
          try{localStorage.removeItem("clvr_push_disabled");}catch(e){}
          setToast("🔔 Push notifications enabled — alerts will appear on your lock screen");
        }catch(e){setToast("Alerts enabled (in-app only)");}
        return;
      }
    }catch(e){}
    setToast("In-app alerts enabled");
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- clockTick forces periodic recompute so expired events disappear
  const todayDate=new Date();
  const nextEvents=macroEvents.map(e=>{const timeStr=e.timeET||e.time||"12:00";const{h,m,offsetUTC}=parseTimeET(timeStr);const[y,mo,d]=e.date.split("-").map(Number);const t=new Date(Date.UTC(y,mo-1,d,h+offsetUTC,m,0));return{...e,timeET:timeStr,target:t,diffMs:t-todayDate};}).filter(e=>e.diffMs>0).sort((a,b)=>a.diffMs-b.diffMs); // clockTick dependency: ${clockTick}
  const macroBankColor={FED:C.blue,ECB:C.purple,BOJ:C.teal,BOC:C.gold,BOE:C.green,RBA:C.cyan,"US CPI":C.orange,NFP:C.red,PCE:C.orange};

  const isGuest=!!user?.guest;
  const isAdmin=!!user?.isAdmin;
  const GUEST_TABS=["radar","prices","macro","about","help"];
  const NAV_ALL=[
    {k:"radar",icon:"📡",label:i18n.radar},
    {k:"prices",icon:"💹",label:i18n.markets},
    {k:"macro",icon:"🏦",label:i18n.macro},
    {k:"brief",icon:"📰",label:i18n.brief},
    {k:"signals",icon:"⚡",label:i18n.signals},
    ...(isAdmin?[{k:"track",icon:"📈",label:"RECORD"}]:[]),
    ...(isAdmin?[{k:"rejections",icon:"🚫",label:"REJECTS"}]:[]),
    {k:"insider",icon:"🏛",label:"INSIDER"},
    {k:"alerts",icon:"🔔",label:i18n.alerts},
    {k:"wallet",icon:"👛",label:i18n.wallet},
    {k:"ai",icon:"✦",label:i18n.ai},
    {k:"chartai",icon:<ScanLine size={14}/>,label:"CHART AI"},
    {k:"basket",icon:"🧺",label:"BASKET"},
    {k:"journal",icon:"📓",label:"JOURNAL"},
    {k:"about",icon:"📖",label:i18n.about},
    {k:"help",icon:"❓",label:"HELP"},
    {k:"account",icon:"⚙",label:i18n.account},
  ];
  const NAV=isGuest?NAV_ALL.filter(n=>GUEST_TABS.includes(n.k)):NAV_ALL;

  return(
    <div style={{fontFamily:SANS,background:C.bg,color:C.text,minHeight:"100vh",paddingBottom:isMobile?76:24,paddingTop:"env(safe-area-inset-top,0px)",paddingLeft:isMobile?0:sidebarW,maxWidth:isMobile?780:undefined,margin:isMobile?"0 auto":0,position:"relative"}}>
      {!isMobile&&<SideNav items={NAV} tab={tab} onTab={setTab} C={C} MONO={MONO} SERIF={SERIF} PRO_TABS_GATE2={PRO_TABS_GATE} isPro={isPro} isElite={isElite} isPreview={isPreview} upcomingCount={upcomingCount} isDark={isDark} toggleTheme={toggleTheme} wide={isDesktop}/>}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Barlow:wght@300;400;500;600;700&display=swap');
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        select,input,textarea{outline:none;}
        ::-webkit-scrollbar{display:none;}
        button{cursor:pointer;}
        html,body{background:${C.bg};margin:0;overflow-x:hidden;max-width:100vw;}
        body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(28,50,100,.4) 1px,transparent 1px),linear-gradient(90deg,rgba(28,50,100,.4) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0;will-change:transform;}
        body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 40% at 50% 0%,rgba(201,168,76,.07) 0%,transparent 60%);pointer-events:none;z-index:0;}
        @keyframes slideUp{from{transform:translateX(-50%) translateY(16px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        @keyframes slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
        @keyframes gold-pulse{0%,100%{box-shadow:0 0 4px rgba(245,158,11,.2)}50%{box-shadow:0 0 16px rgba(245,158,11,.4),0 0 32px rgba(245,158,11,.15)}}
        .high-confidence-glow{border:1px solid #F59E0B !important;animation:gold-pulse 2s infinite;}
        .capital-protection-pulse{background:linear-gradient(90deg,rgba(255,45,85,.15),rgba(245,158,11,.15));animation:cap-pulse 1.5s infinite;}
        @keyframes cap-pulse{0%,100%{opacity:.7}50%{opacity:1}}
        @keyframes clvrBellPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.02)}}
      `}</style>

      {/* QR Scanner overlay */}
      {showQRScanner&&<QRScanner onScan={async(raw)=>{setShowQRScanner(false);const code=raw.trim().toUpperCase();await verifyAccessCode(code);}} onClose={()=>setShowQRScanner(false)}/>}

      {/* ── Slide-out Menu Drawer ─────────────────────────────────────── */}
      <div
        data-testid="drawer-overlay"
        onClick={()=>setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
        style={{
          position:"fixed", inset:0, zIndex:90,
          background:"rgba(0,0,0,0.55)",
          backdropFilter:"blur(2px)",
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? "auto" : "none",
          transition:"opacity 220ms ease",
        }}
      />
      <aside
        data-testid="drawer-panel"
        role="dialog"
        aria-label="Menu"
        aria-hidden={!drawerOpen}
        onClick={(e)=>e.stopPropagation()}
        style={{
          position:"fixed", top:0, right:0, bottom:0, zIndex:91,
          width:"min(320px, 86vw)",
          background:"rgba(8,10,14,0.98)",
          borderLeft:`1px solid ${C.border}`,
          boxShadow:"-12px 0 40px rgba(0,0,0,0.5)",
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition:"transform 260ms cubic-bezier(.2,.8,.2,1)",
          display:"flex", flexDirection:"column",
        }}
      >
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontFamily:MONO,fontSize:9,color:C.gold2,letterSpacing:"0.18em"}}>MENU</span>
          <button data-testid="btn-close-drawer" onClick={()=>setDrawerOpen(false)} aria-label="Close menu"
            style={{background:"none",border:"none",color:C.muted2,cursor:"pointer",padding:4,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <X size={18}/>
          </button>
        </div>

        <nav style={{display:"flex",flexDirection:"column",padding:"10px 8px",gap:2,flex:1,overflowY:"auto"}}>
          {/* QR scanner */}
          <button data-testid="drawer-btn-qr" onClick={()=>{setDrawerOpen(false);setShowQRScanner(true);}}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"none",border:"none",borderRadius:4,color:C.muted2,fontFamily:MONO,fontSize:11,cursor:"pointer",textAlign:"left",letterSpacing:"0.06em"}}
            onMouseEnter={(e)=>e.currentTarget.style.background="rgba(255,255,255,.04)"}
            onMouseLeave={(e)=>e.currentTarget.style.background="none"}>
            <QrCode size={16} color={C.gold}/>
            <span style={{flex:1}}>SCAN QR CODE</span>
          </button>

          {/* Language switch */}
          <button data-testid="drawer-btn-lang" onClick={()=>{toggleLang();}}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"none",border:"none",borderRadius:4,color:C.muted2,fontFamily:MONO,fontSize:11,cursor:"pointer",textAlign:"left",letterSpacing:"0.06em"}}
            onMouseEnter={(e)=>e.currentTarget.style.background="rgba(255,255,255,.04)"}
            onMouseLeave={(e)=>e.currentTarget.style.background="none"}>
            <Languages size={16} color={C.gold}/>
            <span style={{flex:1}}>LANGUAGE · {lang}</span>
            <span style={{fontFamily:MONO,fontSize:9,color:C.gold,padding:"2px 8px",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,letterSpacing:"0.1em"}}>{lang==="EN"?"→ FR":"→ EN"}</span>
          </button>

          <div style={{height:1,background:C.border,margin:"8px 6px"}}/>

          {/* Sign out */}
          <button data-testid="drawer-btn-signout"
            onClick={async()=>{
              setDrawerOpen(false);
              try{await fetch("/api/auth/signout",{method:"POST"});}catch(e){}
              try{localStorage.removeItem("clvr_tier");localStorage.removeItem("clvr_code");}catch(e){}
              setUser(null);
            }}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"none",border:"none",borderRadius:4,color:C.red,fontFamily:MONO,fontSize:11,cursor:"pointer",textAlign:"left",letterSpacing:"0.06em"}}
            onMouseEnter={(e)=>e.currentTarget.style.background="rgba(255,64,96,.08)"}
            onMouseLeave={(e)=>e.currentTarget.style.background="none"}>
            <LogOut size={16}/>
            <span style={{flex:1}}>SIGN OUT</span>
          </button>
        </nav>

        <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.18em",textAlign:"center"}}>
          CLVRQUANT · v2
        </div>
      </aside>

      {/* ── EMAIL VERIFICATION BANNER ── */}
      {user?.pendingVerification&&!verifyBannerDismissed&&(
        <div style={{background:"rgba(201,168,76,.08)",borderBottom:`1px solid rgba(201,168,76,.2)`,padding:"10px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"relative",zIndex:50}}>
          <span style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.06em",flex:1,minWidth:160}}>
            {resendSent?"✓ Verification email sent — check your inbox":"✦ Please verify your email to activate your account"}
          </span>
          {!resendSent&&(
            <button onClick={handleResendVerification} disabled={resendLoading} style={{background:"rgba(201,168,76,.15)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:3,padding:"5px 12px",fontFamily:MONO,fontSize:9,color:C.gold2,cursor:"pointer",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>
              {resendLoading?"SENDING...":"RESEND EMAIL"}
            </button>
          )}
          <button onClick={()=>setVerifyBannerDismissed(true)} style={{background:"none",border:"none",color:C.muted,fontFamily:MONO,fontSize:11,cursor:"pointer",padding:"2px 4px",lineHeight:1}}>✕</button>
        </div>
      )}

      {/* Force-change-password modal — cannot be dismissed */}
      {mustChangePassword&&<div style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,.95)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:C.panel,border:`1px solid rgba(201,168,76,.4)`,borderRadius:14,maxWidth:400,width:"100%",padding:"28px 24px",position:"relative"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`,borderRadius:"14px 14px 0 0"}}/>
          <div style={{textAlign:"center",marginBottom:22}}>
            <div style={{fontSize:40,marginBottom:10}}>🔐</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.gold2,marginBottom:6}}>Create New Password</div>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted,lineHeight:1.7,letterSpacing:"0.04em"}}>A temporary password was issued.<br/>Please create a secure password to continue.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <input data-testid="input-new-password" type="password" placeholder="New password" value={newPwInput} onChange={e=>setNewPwInput(e.target.value)} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${C.border2}`,borderRadius:8,padding:"11px 14px",fontFamily:MONO,fontSize:12,color:C.text,outline:"none",width:"100%",boxSizing:"border-box"}}/>
            <input data-testid="input-confirm-password" type="password" placeholder="Confirm new password" value={newPwInput2} onChange={e=>setNewPwInput2(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")document.getElementById("btn-set-password")?.click();}} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${C.border2}`,borderRadius:8,padding:"11px 14px",fontFamily:MONO,fontSize:12,color:C.text,outline:"none",width:"100%",boxSizing:"border-box"}}/>
            {changePwError&&<div style={{fontFamily:MONO,fontSize:10,color:C.red,textAlign:"center"}}>{changePwError}</div>}
            <div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.04em"}}>Must be 8+ chars with uppercase, lowercase, and a number.</div>
            <button id="btn-set-password" data-testid="btn-set-password" disabled={changePwLoading} onClick={async()=>{
              setChangePwError("");
              if(newPwInput.length<8)return setChangePwError("At least 8 characters required.");
              if(newPwInput!==newPwInput2)return setChangePwError("Passwords don't match.");
              setChangePwLoading(true);
              try{
                const r=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({newPassword:newPwInput})});
                const d=await r.json();
                if(!r.ok)return setChangePwError(d.error||"Failed to update password.");
                setMustChangePassword(false);
                setNewPwInput("");setNewPwInput2("");
              }catch(e){setChangePwError("Network error. Please try again.");}
              finally{setChangePwLoading(false);}
            }} style={{background:`linear-gradient(135deg,rgba(201,168,76,.18),rgba(232,201,109,.12))`,border:`1px solid rgba(201,168,76,.4)`,borderRadius:8,padding:"13px 16px",fontFamily:MONO,fontSize:12,color:C.gold2,cursor:changePwLoading?"not-allowed":"pointer",letterSpacing:"0.08em",fontWeight:700,opacity:changePwLoading?0.6:1}}>
              {changePwLoading?"Saving...":"Set New Password →"}
            </button>
          </div>
        </div>
      </div>}

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

      <GlobalBellOverlay bellFlash={bellFlash} secsToClose={globalSecsToClose}/>
      {activeAlerts.length>0&&<div style={{animation:"slideDown .3s ease"}}><AlertBanner alerts={activeAlerts} onDismiss={dismissAlert} C={C}/></div>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
      <SquawkBox signals={liveSignals} soundEnabled={soundEnabled} isPro={isPro || isElite} muted={squawkMuted} onToggle={()=>setSquawkMuted(v=>{const nv=!v;try{localStorage.setItem("clvr_squawk",nv?"off":"on");}catch(e){}return nv;})}/>
      {tradeModalSig&&<TradeConfirmationModal sig={tradeModalSig} currentPrice={(cryptoPrices[tradeModalSig.token]||{}).price} masterScore={tradeModalSig.masterScore||50} riskOn={tradeModalSig.riskOn||50} onApprove={()=>{setToast(`Trade approved: ${tradeModalSig.token} ${tradeModalSig.dir}`);setTradeModalSig(null);}} onCancel={()=>setTradeModalSig(null)} C={C}/>}

      <PricingModal
        isOpen={showPricingModal}
        onClose={()=>{setShowPricingModal(false);setUpgradeDefaultTier(null);}}
        userTier={userTier||"free"}
        defaultTier={upgradeDefaultTier}
        onUpgrade={async(tierId,billing)=>{
          const isYearly=billing==="yearly";
          let price=null;
          if(tierId==="elite"){price=isYearly?stripePrices.eliteYearly:stripePrices.eliteMonthly;}
          else{price=isYearly?stripePrices.yearly:stripePrices.monthly;}
          if(!price?.price_id){
            setToast("Payment is loading — please try again in a moment");
            return;
          }
          const checkoutUrl=`/checkout?priceId=${encodeURIComponent(price.price_id)}&plan=${tierId}&cycle=${billing}`;

          // Already on this exact tier — bail out
          if((userTier||"free")===tierId){
            setToast(`You're already on CLVR ${tierId.charAt(0).toUpperCase()+tierId.slice(1)}`);
            setShowPricingModal(false);
            return;
          }

          // Logged out — stash destination and open auth modal
          if(!user){
            try{sessionStorage.setItem("clvr_post_login_url",checkoutUrl);}catch{}
            setShowPricingModal(false);
            setShowAuth(true);
            return;
          }

          // Downgrade (Elite → Pro) — confirm before routing
          const tiers=["free","pro","elite"];
          const isDowngrade=tiers.indexOf(tierId)<tiers.indexOf(userTier||"free");
          if(isDowngrade){
            const ok=window.confirm(
              `Downgrade to CLVR ${tierId.charAt(0).toUpperCase()+tierId.slice(1)}?\n\n`+
              `You'll lose access to Elite-only features (Chart AI, SEC Insider Flow, Macro Intel Feed, unlimited AI Analyst, Squawk Box).\n\n`+
              `Your new plan will start at the next billing cycle.`
            );
            if(!ok)return;
          }

          setShowPricingModal(false);
          window.location.href=checkoutUrl;
        }}
      />

      {showUpgrade&&<div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,.88)",backdropFilter:"blur(14px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowUpgrade(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:8,maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto",position:"relative"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
          <div style={{padding:"24px 20px 20px",textAlign:"center"}}>
            <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.3em",marginBottom:6}}>CLVR QUANTAI — SUBSCRIPTION PLANS</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:22,color:C.white,marginBottom:4}}>Institutional-Grade Intelligence</div>
            <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginBottom:20}}>Real-time markets · AI Quant Engine · SEC insider flow</div>

            {/* Plan toggle tabs */}
            {(()=>{
              const [upgTab,setUpgTab]=[upgradePlanTab||"pro",v=>{try{window.__upgTab=v;}catch(e){}setUpgradePlanTab(v);}];
              const proM=stripePrices.monthly, proY=stripePrices.yearly;
              const elM=stripePrices.eliteMonthly, elY=stripePrices.eliteYearly;
              const proReady=!!(proM?.price_id&&proY?.price_id);
              const elReady=!!(elM?.price_id&&elY?.price_id);
              return<>
                <div style={{display:"flex",gap:6,marginBottom:16,background:C.bg,borderRadius:6,padding:4}}>
                  {[{id:"pro",label:"CLVR Pro",color:C.gold},{id:"elite",label:"CLVR Elite",color:"#00e5ff"}].map(t=>(
                    <button key={t.id} onClick={()=>setUpgTab(t.id)} style={{flex:1,padding:"8px 4px",borderRadius:4,border:`1px solid ${upgTab===t.id?t.color+"60":C.border}`,background:upgTab===t.id?`${t.color}10`:"transparent",fontFamily:MONO,fontSize:9,color:upgTab===t.id?t.color:C.muted,cursor:"pointer",letterSpacing:"0.1em",fontWeight:upgTab===t.id?700:400,transition:"all 0.2s"}}>
                      {t.label}{t.id==="elite"&&<span style={{marginLeft:5,fontSize:7,background:"#00e5ff20",border:"1px solid #00e5ff40",borderRadius:10,padding:"1px 5px",color:"#00e5ff"}}>TOP</span>}
                    </button>
                  ))}
                </div>
                {upgTab==="pro"&&<>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:14,textAlign:"left"}}>
                    {["AI Quant Engine","QuantBrain AI · 30/day","Morning Briefs","Live anomaly signals","Full news & sentiment","Macro Calendar","Twitter/Stocktwits","Price alerts"].map(f=>(
                      <div key={f} style={{fontFamily:MONO,fontSize:8,color:C.text,display:"flex",alignItems:"center",gap:5}}>
                        <span style={{color:C.gold,fontSize:9}}>✦</span>{f}
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:14}}>
                    <button data-testid="btn-checkout-monthly" onClick={()=>proReady?handleCheckout(proM.price_id):setToast("Stripe loading, please try again")} disabled={checkoutLoading} style={{flex:1,padding:"14px 10px",background:"rgba(201,168,76,.07)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:4,cursor:checkoutLoading?"not-allowed":"pointer"}}>
                      <div style={{fontFamily:SERIF,fontWeight:900,fontSize:24,color:C.gold2}}>${proM?((proM.unit_amount||2999)/100).toFixed(2):"29.99"}</div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em",marginTop:2}}>PER MONTH</div>
                    </button>
                    <button data-testid="btn-checkout-yearly" onClick={()=>proReady?handleCheckout(proY.price_id):setToast("Stripe loading, please try again")} disabled={checkoutLoading} style={{flex:1,padding:"14px 10px",background:"rgba(0,199,135,.06)",border:`1px solid rgba(0,199,135,.3)`,borderRadius:4,cursor:checkoutLoading?"not-allowed":"pointer",position:"relative"}}>
                      <div style={{position:"absolute",top:-9,right:8,fontFamily:MONO,fontSize:7,color:C.bg,background:C.green,padding:"2px 8px",borderRadius:2,fontWeight:800}}>SAVE $60/yr</div>
                      <div style={{fontFamily:SERIF,fontWeight:900,fontSize:24,color:C.green}}>${proY?((proY.unit_amount||29900)/100).toFixed(0):"299"}</div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em",marginTop:2}}>PER YEAR</div>
                    </button>
                  </div>
                </>}
                {upgTab==="elite"&&<>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:14,textAlign:"left"}}>
                    {["All Pro features +","Chart AI · 5/day","Unlimited QuantBrain AI","SEC Insider Flow","Basket Analysis","Forex & Commodities","Whale tracking","Political Alpha"].map((f,i)=>(
                      <div key={f} style={{fontFamily:MONO,fontSize:8,color:i===0?C.muted:C.text,display:"flex",alignItems:"center",gap:5}}>
                        <span style={{color:"#00e5ff",fontSize:9}}>✦</span>{f}
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:14}}>
                    <button data-testid="btn-checkout-elite-monthly" onClick={()=>elReady?handleCheckout(elM.price_id):setToast("Stripe loading, please try again")} disabled={checkoutLoading} style={{flex:1,padding:"14px 10px",background:"rgba(0,229,255,.06)",border:`1px solid rgba(0,229,255,.35)`,borderRadius:4,cursor:checkoutLoading?"not-allowed":"pointer"}}>
                      <div style={{fontFamily:SERIF,fontWeight:900,fontSize:24,color:"#00e5ff"}}>${elM?((elM.unit_amount||12900)/100).toFixed(2):"129.00"}</div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em",marginTop:2}}>PER MONTH</div>
                    </button>
                    <button data-testid="btn-checkout-elite-yearly" onClick={()=>elReady?handleCheckout(elY.price_id):setToast("Stripe loading, please try again")} disabled={checkoutLoading} style={{flex:1,padding:"14px 10px",background:"rgba(0,199,135,.06)",border:`1px solid rgba(0,199,135,.3)`,borderRadius:4,cursor:checkoutLoading?"not-allowed":"pointer",position:"relative"}}>
                      <div style={{position:"absolute",top:-9,right:8,fontFamily:MONO,fontSize:7,color:C.bg,background:C.green,padding:"2px 8px",borderRadius:2,fontWeight:800}}>SAVE $349/yr</div>
                      <div style={{fontFamily:SERIF,fontWeight:900,fontSize:24,color:C.green}}>${elY?((elY.unit_amount||119900)/100).toFixed(0):"1,199"}</div>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.12em",marginTop:2}}>PER YEAR</div>
                    </button>
                  </div>
                </>}
              </>;
            })()}

            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,marginBottom:2}}>
              <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.15em",marginBottom:8}}>HAVE AN ACCESS CODE?</div>
              <div style={{display:"flex",gap:6}}>
                <button data-testid="btn-scan-qr" onClick={()=>setShowQRScanner(true)} title="Scan QR code" style={{background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.2)`,borderRadius:2,padding:"8px 10px",cursor:"pointer",fontSize:15,display:"flex",alignItems:"center"}}>📷</button>
                <input data-testid="input-access-code" value={accessCodeInput} onChange={e=>setAccessCodeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&verifyAccessCode()} placeholder="CLVR-VIP-XXXX or CLVR-FF-XXXX" style={{flex:1,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"8px 10px",color:C.text,fontFamily:MONO,fontSize:10}}/>
                <button data-testid="btn-verify-code" onClick={()=>verifyAccessCode()} style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,padding:"8px 14px",fontFamily:MONO,fontSize:9,color:C.gold,cursor:"pointer",letterSpacing:"0.1em"}}>VERIFY</button>
              </div>
              {accessCodeMsg&&<div style={{fontFamily:MONO,fontSize:9,color:accessCodeMsg.includes("✦")?C.green:C.red,marginTop:6}}>{accessCodeMsg}</div>}
            </div>
            <div style={{fontFamily:MONO,fontSize:7,color:C.muted,marginTop:10}}>Cancel anytime · Secure checkout via Stripe · USD</div>
            <button onClick={()=>setShowUpgrade(false)} style={{marginTop:10,background:"none",border:"none",color:C.muted,fontFamily:MONO,fontSize:9,cursor:"pointer",letterSpacing:"0.1em"}}>CLOSE</button>
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
          <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
            {/* ── Sound ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontFamily:MONO,fontSize:6,color:soundEnabled?C.cyan:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>SOUND</span>
              <button data-testid="btn-sound-toggle" onClick={toggleSound} title={soundEnabled?"Sound ON":"Sound OFF"} style={{background:"none",border:`1px solid ${soundEnabled?C.cyan:C.border}`,borderRadius:2,padding:"4px 7px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:soundEnabled?C.cyan:C.muted2,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center"}}>{soundEnabled?"🔊":"🔇"}</button>
            </div>
            {/* ── Squawk Box (Elite only) ── */}
            {isElite?(()=>{
              const sqActive=!squawkMuted&&soundEnabled;
              const toggleSq=()=>{
                setSquawkMuted(v=>{
                  const nv=!v;
                  try{localStorage.setItem("clvr_squawk",nv?"off":"on");}catch(e){}
                  if(!nv) unlockSpeechSynthesis();
                  return nv;
                });
              };
              return(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontFamily:MONO,fontSize:6,color:sqActive?C.gold:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>SQUAWK</span>
                  <div style={{position:"relative",display:"inline-flex"}}>
                    <button data-testid="btn-squawk-toggle" onClick={toggleSq}
                      title={sqActive?"Squawk Box LIVE — tap to mute":"Squawk Box OFF — tap to enable"}
                      style={{background:sqActive?"rgba(201,168,76,.07)":"none",border:`1px solid ${sqActive?"rgba(201,168,76,.5)":C.border}`,borderRadius:2,padding:"4px 7px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:sqActive?C.gold:C.muted2,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      📣
                    </button>
                    {!sqActive&&(
                      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} viewBox="0 0 30 24">
                        <line x1="4" y1="20" x2="26" y2="4" stroke="#ff4060" strokeWidth="2.2" strokeLinecap="round"/>
                      </svg>
                    )}
                    {sqActive&&(
                      <span data-testid="squawk-live-dot" style={{
                        position:"absolute",top:-2,right:-2,width:8,height:8,borderRadius:"50%",
                        background:"#22c55e",boxShadow:"0 0 0 0 rgba(34,197,94,0.7)",
                        animation:"squawkPulse 1.6s ease-out infinite",pointerEvents:"none",
                      }}/>
                    )}
                  </div>
                </div>
              );
            })():isPro?(
              /* Pro users see a locked teaser — nudge to Elite */
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <span style={{fontFamily:MONO,fontSize:6,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>SQUAWK</span>
                <button data-testid="btn-squawk-locked" onClick={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}
                  title="Squawk Box — Elite feature. Tap to upgrade."
                  style={{background:"rgba(201,168,76,.04)",border:`1px solid rgba(201,168,76,.15)`,borderRadius:2,padding:"4px 7px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:C.muted,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                  📣
                  <span style={{position:"absolute",top:-1,right:-1,fontSize:7,lineHeight:1}}>🔒</span>
                </button>
              </div>
            ):null}
            {/* ── Alerts / Push ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontFamily:MONO,fontSize:6,color:isPro?(notifPerm==="granted"&&!pushDisabled?C.gold:C.red):C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>ALERTS</span>
              <div style={{position:"relative",display:"inline-flex"}}>
                {isPro?(
                  <>
                    <button data-testid="btn-push-notif" onClick={requestPush}
                      title={notifPerm==="granted"&&!pushDisabled?"Alerts ON — tap to pause":notifPerm==="granted"&&pushDisabled?"Alerts paused — tap to re-enable":"Tap to enable alerts"}
                      style={{background:notifPerm==="granted"&&!pushDisabled?"none":notifPerm==="granted"&&pushDisabled?"rgba(201,168,76,.06)":"rgba(255,64,96,.06)",border:`1px solid ${notifPerm==="granted"&&!pushDisabled?C.gold:notifPerm==="granted"&&pushDisabled?"rgba(201,168,76,.3)":"rgba(255,64,96,.4)"}`,borderRadius:2,padding:"4px 7px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:notifPerm==="granted"&&!pushDisabled?C.gold:notifPerm==="granted"&&pushDisabled?C.muted:C.red,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {notifPerm==="granted"&&!pushDisabled?"🔔":"🔕"}
                    </button>
                    {(notifPerm!=="granted"||pushDisabled)&&<div style={{position:"absolute",top:-4,right:-4,width:9,height:9,borderRadius:"50%",background:C.red,border:`2px solid ${C.bg}`,boxShadow:`0 0 6px ${C.red}`,animation:"pulse 1.5s ease-in-out infinite"}}/>}
                  </>
                ):(
                  <button data-testid="btn-alerts-locked" onClick={()=>{setUpgradeDefaultTier(null);setShowPricingModal(true);}} title="Upgrade to Pro for real-time alerts"
                    style={{background:"rgba(201,168,76,.05)",border:"1px solid rgba(201,168,76,.18)",borderRadius:2,padding:"4px 7px",cursor:"pointer",fontFamily:MONO,fontSize:10,color:C.muted,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    🔒
                  </button>
                )}
              </div>
            </div>
            {/* ── Tier badge (clickable) ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontFamily:MONO,fontSize:6,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>{isElite?"TIER":isPro?"TIER":"PLAN"}</span>
              {isElite?<button data-testid="badge-elite" onClick={()=>{setUpgradeDefaultTier("pro");setShowPricingModal(true);}} title="Click to manage plan" style={{background:"rgba(201,168,76,.18)",border:`1px solid rgba(201,168,76,.55)`,borderRadius:2,padding:"0 8px",fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.15em",fontWeight:700,textShadow:"0 0 8px rgba(201,168,76,.4)",height:26,display:"flex",alignItems:"center",cursor:"pointer"}}>ELITE</button>
              :isPro?<button data-testid="badge-pro" onClick={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}} title="Click to upgrade to Elite" style={{background:"rgba(201,168,76,.12)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"0 8px",fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.15em",fontWeight:700,height:26,display:"flex",alignItems:"center",cursor:"pointer"}}>PRO</button>
              :<button data-testid="btn-upgrade-header" onClick={()=>{setUpgradeDefaultTier(null);setShowPricingModal(true);}} style={{background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,padding:"0 8px",fontFamily:MONO,fontSize:8,color:C.gold2,letterSpacing:"0.1em",cursor:"pointer",fontWeight:600,height:26,display:"flex",alignItems:"center"}}>UPGRADE</button>}
            </div>
            {/* ── Hamburger menu (opens drawer with QR / LANG / SIGN-OUT) ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontFamily:MONO,fontSize:6,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",height:9,lineHeight:"9px",display:"block"}}>MENU</span>
              <button data-testid="btn-open-drawer" onClick={()=>setDrawerOpen(true)} title="Open menu" aria-label="Open menu"
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:2,padding:"4px 7px",cursor:"pointer",color:C.muted2,height:26,width:32,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Menu size={14}/>
              </button>
            </div>
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
          {["BTC","ETH","SOL","XAU","WTI","EURUSD","DXY","TSLA","NVDA"].map(sym=>{
            // DXY: derived from EURUSD inverse (Finnhub free tier lacks DXY directly).
            // Approx: DXY ≈ 1.08 / EURUSD * 100  (calibrated so EUR/USD=1.08 → DXY≈100).
            let d, flash, derived=false;
            if(sym==="DXY"){
              const eu=forexPrices.EURUSD;
              if(eu?.price){
                const dxy=(1.08/eu.price)*100;
                const dxyChg=-(eu.chg||0);
                d={price:dxy,chg:dxyChg,live:!!eu.live};
              }else d=null;
              flash=null; derived=true;
            }else{
              d=allPrices[sym]; flash=flashes[sym];
            }
            const isUp=Number(d?.chg)>=0;
            const label=sym==="DXY"?"DXY*":sym;
            return(
              <div key={sym} data-testid={`ticker-${sym}`} title={derived?"DXY derived from EUR/USD inverse (proxy)":undefined}
                onClick={()=>{setAiInput(`${sym==="DXY"?"DXY (Dollar Index)":sym} — long or short right now?`);setTab("ai");}}
                style={{background:flash==="green"?"rgba(0,199,135,.08)":flash==="red"?"rgba(255,64,96,.06)":C.panel,
                  border:`1px solid ${d?.live?"rgba(201,168,76,.18)":C.border}`,borderRadius:2,padding:"5px 9px",flexShrink:0,cursor:"pointer",minWidth:64,transition:"background .35s"}}>
                <div style={{fontFamily:MONO,fontSize:8,color:d?.live?C.gold:C.muted,letterSpacing:"0.08em"}}>{label}</div>
                <div style={{fontFamily:MONO,fontSize:11,fontWeight:600,color:flash==="green"?C.green:flash==="red"?C.red:C.white,transition:"color .5s ease-out",marginTop:1,display:"flex",alignItems:"center",gap:2}}>{flash==="green"?"↑":flash==="red"?"↓":""}{d?.price!=null?(sym==="DXY"?d.price.toFixed(2):fmt(d.price,sym)):"—"}</div>
                <div style={{fontFamily:MONO,fontSize:9,color:isUp?C.green:C.red}}>{pct(d?.chg)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{padding:"10px 12px",position:"relative",zIndex:1}}>

        {/* ── Kill Switch banner — shown when backend halts signal generation ── */}
        {dbKillSwitch?.active&&(
          <div data-testid="banner-kill-switch" style={{background:"rgba(255,20,50,.08)",border:"1px solid rgba(255,20,50,.5)",borderRadius:4,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:20}}>🛑</span>
            <div style={{flex:1,minWidth:160}}>
              <div style={{fontFamily:MONO,fontSize:9,fontWeight:800,color:C.red,letterSpacing:"0.18em",marginBottom:3}}>CLVR MARKET HALT — SIGNAL ENGINE PAUSED</div>
              <div style={{fontFamily:MONO,fontSize:8,color:C.muted2,lineHeight:1.6}}>
                {dbKillSwitch.reason||"High-impact macro event detected — trading signals suspended until volatility normalises."}
                {dbKillSwitch.nearest_event&&<span style={{color:C.orange}}> Next: {typeof dbKillSwitch.nearest_event==="object"?`${dbKillSwitch.nearest_event.name} at ${dbKillSwitch.nearest_event.time} (${dbKillSwitch.nearest_event.hours_away}h away)`:dbKillSwitch.nearest_event}</span>}
              </div>
            </div>
            <div style={{fontFamily:SERIF,fontSize:11,fontStyle:"italic",color:C.red,fontWeight:700,flexShrink:0}}>Exercise caution</div>
          </div>
        )}

        {/* ── Preview (unauthenticated) full-screen overlay — skips about/help/account ── */}
        {isPreview&&!["about","help","account"].includes(tab)&&(
          <div style={{position:"fixed",top:54,left:0,right:0,bottom:60,background:C.bg,zIndex:50,overflowY:"auto"}}>
            <PreviewGate tab={tab} C2={C} MONO2={MONO} SERIF2={SERIF}
              onSignUp={()=>onShowAuth&&onShowAuth()}
              onSignIn={()=>onShowAuth&&onShowAuth()}
            />
          </div>
        )}

        {/* ── Free-user tab gates ── */}
        {/* Pro-tier gate for Pro-only tabs (free users) */}
        {!isPreview&&!isPro&&PRO_TABS_GATE.includes(tab)&&<TabUpgradeGate tab={tab} tier="pro" C2={C} MONO2={MONO} SERIF2={SERIF} onUpgrade={onUpgrade}/>}
        {/* Elite-tier gate for Elite-only tabs (free AND pro users) */}
        {!isPreview&&!isElite&&ELITE_TABS_GATE.includes(tab)&&<TabUpgradeGate tab={tab} tier="elite" C2={C} MONO2={MONO} SERIF2={SERIF} onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}/>}

        {/* ══ RADAR ══ */}
        {tab==="radar"&&<>
          <div style={{marginBottom:14}}><SLabel>{i18n.commandCenter}</SLabel></div>
          <PerformanceHighlights/>
          <TwitterMarketModeStrip onSpikeClick={(tk)=>setSpikeFilter(tk)} activeSpike={spikeFilter}/>

          {/* ── Fear & Greed widget — uses live data from useDataBus ── */}
          {dbFearGreed?.value!=null&&(()=>{
            const fgv=dbFearGreed.value, fgc=fearGreedColor(fgv), fgcl=dbFearGreed.classification||"Neutral";
            const fgLabel=fgv<=25?"EXTREME FEAR":fgv<=45?"FEAR":fgv<=55?"NEUTRAL":fgv<=75?"GREED":"EXTREME GREED";
            const fgHint=fgv<=25?"Contrarian bullish — capitulation zone":fgv>=75?"Distribution risk — froth zone":"Balanced sentiment";
            return(
              <div data-testid="panel-fear-greed" style={{background:C.panel,border:`1px solid ${fgc}44`,borderRadius:4,padding:"12px",marginBottom:12,display:"flex",alignItems:"center",gap:14}}>
                <div style={{flexShrink:0,width:64,height:64,borderRadius:"50%",border:`3px solid ${fgc}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`${fgc}10`}}>
                  <div style={{fontFamily:MONO,fontSize:20,fontWeight:900,color:fgc,lineHeight:1}}>{fgv}</div>
                  <div style={{fontFamily:MONO,fontSize:6,color:C.muted,marginTop:2,letterSpacing:"0.1em"}}>/100</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.18em",marginBottom:4}}>FEAR &amp; GREED INDEX</div>
                  <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:fgc,letterSpacing:"0.1em",marginBottom:5}}>{fgLabel} · <span style={{color:C.muted2,fontWeight:500}}>{fgcl}</span></div>
                  <div style={{height:5,background:"rgba(255,255,255,.05)",borderRadius:3,overflow:"hidden",marginBottom:5,position:"relative"}}>
                    <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,#ff4060 0%,#ff8c00 25%,#c9a84c 50%,#86c554 75%,#00c787 100%)",opacity:.35}}/>
                    <div style={{position:"absolute",top:-2,bottom:-2,left:`${fgv}%`,width:2,background:fgc,boxShadow:`0 0 6px ${fgc}`}}/>
                  </div>
                  <div style={{fontFamily:MONO,fontSize:8,color:C.muted,lineHeight:1.4}}>{fgHint}</div>
                </div>
              </div>
            );
          })()}

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

          {(notifPerm!=="granted"||pushDisabled)&&<div data-testid="push-prompt" style={{background:"rgba(201,168,76,.06)",border:`1px solid ${C.border}`,borderRadius:4,padding:"14px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:MONO,fontSize:20,color:C.gold}}>{pushDisabled?"⏸":"!"}</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:3}}>{pushDisabled?"ALERTS PAUSED":i18n.liveAlerts}</div>
              <div style={{fontFamily:SANS,fontSize:13,color:C.muted2,lineHeight:1.5}}>{pushDisabled?"Push notifications are disabled. Tap ENABLE to re-activate alerts on your lock screen.":"Enable in-app alerts for macro events, volume spikes, funding flips, and price targets."}</div>
            </div>
            <button data-testid="btn-enable-push" onClick={requestPush} style={{background:C.gold,border:"none",borderRadius:2,padding:"6px 14px",fontFamily:MONO,fontSize:9,color:C.bg,fontWeight:700,letterSpacing:"0.1em",cursor:"pointer"}}>ENABLE</button>
          </div>}

          {/* QR Scanner button — scan an access code */}
          <button data-testid="btn-qr-scan-alerts" onClick={()=>setShowQRScanner(true)} style={{width:"100%",marginBottom:12,padding:"10px 14px",background:"rgba(201,168,76,.08)",border:`1px solid rgba(201,168,76,.3)`,borderRadius:6,fontFamily:MONO,fontSize:11,color:C.gold2,cursor:"pointer",letterSpacing:"0.1em",display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
            <span style={{fontSize:16}}>📷</span> SCAN ACCESS CODE
          </button>

          {isPro&&alertHistory.length>0&&<div style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em"}}>ALERT HISTORY ({alertHistory.length})</div>
              <button onClick={clearAllAlertHistory} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:2,padding:"2px 8px",fontFamily:MONO,fontSize:8,color:C.muted,cursor:"pointer",letterSpacing:"0.08em"}}>CLEAR ALL</button>
            </div>
            {alertHistory.map(a=>{const tc={macro:C.orange,volume:C.cyan,funding:C.green,liq:C.red,price:C.gold}[a.type]||C.gold;return(
              <div key={a.id} data-testid={`alert-history-${a.id}`} style={{background:"rgba(12,18,32,.8)",border:`1px solid ${C.border}`,borderLeft:`2px solid ${tc}`,borderRadius:2,padding:"10px 12px",marginBottom:4,display:"flex",gap:8,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:tc,fontWeight:700,letterSpacing:"0.1em",marginBottom:2}}>{a.title}</div>
                  <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.5}}>{a.body}</div>
                  {a.ts&&<div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:4}}>{new Date(a.ts).toLocaleTimeString()}</div>}
                </div>
                <button onClick={()=>dismissAlert(a.id)} style={{background:"none",border:"none",color:C.muted,fontSize:14,cursor:"pointer",padding:0}}>×</button>
              </div>
            );})}
          </div>}

          {(()=>{
            const politicalFeed=newsFeed.filter(n=>n.political).slice(0,6);
            if(politicalFeed.length===0)return null;
            const impactColors={"bullish":C.green,"bearish":C.red,"neutral":C.gold};
            const impactLabels={"bullish":"BULLISH","bearish":"BEARISH","neutral":"NEUTRAL"};
            return(
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:"#ff4060",boxShadow:"0 0 6px #ff406080"}}/>
                    <div style={{fontFamily:MONO,fontSize:10,color:"#ff6b6b",letterSpacing:"0.15em"}}>POLITICAL ALPHA</div>
                  </div>
                  <div style={{fontFamily:MONO,fontSize:8,color:C.muted,letterSpacing:"0.1em"}}>{politicalFeed.length} SIGNALS</div>
                </div>
                {politicalFeed.map(n=>{
                  const impact=n.marketImpact||"neutral";
                  const ic=impactColors[impact]||C.muted;
                  const ago=((Date.now()-n.ts)/60000);const agoStr=ago<60?`${Math.floor(ago)}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
                  return(
                    <div key={n.id} data-testid={`political-${n.id}`} style={{background:"rgba(255,64,96,.04)",border:`1px solid rgba(255,64,96,.15)`,borderLeft:`3px solid ${ic}`,borderRadius:3,padding:"10px 12px",marginBottom:5,cursor:"pointer"}} onClick={()=>{if(n.url&&n.url!=="#")window.open(n.url,"_blank");}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontFamily:SANS,fontSize:12,color:C.text,lineHeight:1.4,marginBottom:5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{n.title}</div>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{n.source}</span>
                            <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{agoStr} ago</span>
                            <span style={{fontFamily:MONO,fontSize:8,fontWeight:700,color:ic,background:`${ic}15`,border:`1px solid ${ic}30`,borderRadius:2,padding:"2px 7px",letterSpacing:"0.1em"}}>{impactLabels[impact]}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {newsFeed.length>0&&(()=>{
            // Source-diversity counts (Stocktwits/X/CryptoPanic/CryptoCompare/Conflict)
            const counts={twitter:0,stocktwits:0,cryptopanic:0,cryptocompare:0,conflict:0,other:0};
            for(const n of newsFeed){
              if(n.isConflict||n.id?.startsWith?.("geo-")) counts.conflict++;
              else if(n.src==="twitter"||n.id?.startsWith?.("x-")) counts.twitter++;
              else if(n.src==="stocktwits"||n.id?.startsWith?.("st-")) counts.stocktwits++;
              else if(n.id?.startsWith?.("cp-")) counts.cryptopanic++;
              else if(n.id?.startsWith?.("cc-")) counts.cryptocompare++;
              else counts.other++;
            }
            const total=newsFeed.length||1;
            const srcBar=[
              {k:"X",      label:"X / RAPIDAPI",   c:C.cyan,   v:counts.twitter},
              {k:"ST",     label:"STOCKTWITS",     c:C.gold,   v:counts.stocktwits},
              {k:"CP",     label:"CRYPTOPANIC",    c:C.purple, v:counts.cryptopanic},
              {k:"CC",     label:"CRYPTOCOMPARE",  c:C.blue,   v:counts.cryptocompare},
              {k:"GEO",    label:"CONFLICT",       c:C.red,    v:counts.conflict},
              {k:"OTHER",  label:"OTHER",          c:C.muted2, v:counts.other},
            ].filter(s=>s.v>0);
            return(
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontFamily:MONO,fontSize:10,color:C.blue,letterSpacing:"0.15em"}}>{i18n.newsIntel}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {newsFilteredCount>0&&<div data-testid="badge-noise-filter" title={`${newsFilteredCount} item(s) hidden by noise filter`} style={{fontFamily:MONO,fontSize:8,color:C.muted,padding:"2px 7px",border:`1px solid ${C.border}`,borderRadius:2,letterSpacing:"0.08em"}}>🛡 NOISE FILTERED · {newsFilteredCount}</div>}
                <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{newsFeed.length} STORIES</div>
              </div>
            </div>

            {/* Source-diversity breakdown bar */}
            <div data-testid="bar-source-diversity" style={{marginBottom:8,background:C.panel,border:`1px solid ${C.border}`,borderRadius:3,padding:"7px 9px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.12em"}}>SOURCE DIVERSITY · {srcBar.length} CHANNELS</div>
              </div>
              <div style={{display:"flex",height:5,borderRadius:2,overflow:"hidden",background:"rgba(255,255,255,.04)"}}>
                {srcBar.map(s=><div key={s.k} title={`${s.label}: ${s.v}`} style={{width:`${(s.v/total)*100}%`,background:s.c,opacity:.85}}/>)}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
                {srcBar.map(s=>(
                  <div key={s.k} data-testid={`src-chip-${s.k}`} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:6,height:6,borderRadius:1,background:s.c,display:"inline-block"}}/>
                    <span style={{fontFamily:MONO,fontSize:7,color:C.muted2,letterSpacing:"0.06em"}}>{s.label} · <span style={{color:C.text,fontWeight:700}}>{s.v}</span></span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active spike filter pill */}
            {spikeFilter&&(
              <div data-testid="pill-spike-filter" style={{marginBottom:8,display:"flex",alignItems:"center",gap:8,background:`${C.gold}10`,border:`1px solid ${C.gold}44`,borderRadius:3,padding:"6px 10px"}}>
                <span style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.12em",fontWeight:700}}>⚠ FILTERED BY SPIKE: ${spikeFilter}</span>
                <span style={{flex:1,fontFamily:MONO,fontSize:8,color:C.muted}}>showing news mentioning {spikeFilter}</span>
                <button data-testid="btn-clear-spike" onClick={()=>setSpikeFilter(null)} style={{background:"none",border:`1px solid ${C.gold}55`,borderRadius:2,padding:"2px 8px",fontFamily:MONO,fontSize:8,color:C.gold,cursor:"pointer",letterSpacing:"0.1em"}}>CLEAR ×</button>
              </div>
            )}
            <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
              {[
                {k:"ALL",label:"ALL",col:C.blue},
                {k:"CONFLICT",label:"⚡ CONFLICT",col:C.red},
                {k:"SOCIAL",label:"SOCIAL",col:C.cyan},
                {k:"BTC",label:"BTC",col:C.gold},
                {k:"ETH",label:"ETH",col:C.purple},
                {k:"SOL",label:"SOL",col:C.green},
                {k:"XRP",label:"XRP",col:C.blue},
                {k:"EQUITIES",label:"STOCKS",col:C.green},
              ].map(f=>(
                <button key={f.k} data-testid={`news-filter-${f.k}`} onClick={()=>setNewsFilter(f.k)} style={{background:newsFilter===f.k?`${f.col}18`:"transparent",border:`1px solid ${newsFilter===f.k?f.col:C.border}`,borderRadius:2,padding:"4px 10px",fontFamily:MONO,fontSize:9,color:newsFilter===f.k?f.col:C.muted,cursor:"pointer",letterSpacing:"0.08em",flexShrink:0,whiteSpace:"nowrap"}}>{f.label}</button>
              ))}
            </div>

            {/* Conflict events special section */}
            {newsFilter==="CONFLICT"&&(()=>{
              const conflictFeed=newsFeed.filter(n=>n.isConflict);
              if(conflictFeed.length===0)return(
                <div style={{textAlign:"center",padding:"24px 14px",fontFamily:MONO,fontSize:9,color:C.muted,background:"rgba(255,64,96,.04)",border:`1px solid rgba(255,64,96,.15)`,borderRadius:4}}>
                  <div style={{fontSize:20,marginBottom:8}}>🌐</div>
                  No active conflict or geopolitical events detected in current news cycle.
                  <div style={{marginTop:6,color:C.muted,fontSize:8}}>Feed auto-updates every 60 seconds · Sources: Reuters, BBC, DW</div>
                </div>
              );
              return(
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,padding:"8px 12px",background:"rgba(255,64,96,.05)",border:`1px solid rgba(255,64,96,.2)`,borderRadius:4}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:C.red,boxShadow:`0 0 8px ${C.red}`,flexShrink:0}}/>
                    <div style={{fontFamily:MONO,fontSize:9,color:C.red,letterSpacing:"0.15em"}}>{conflictFeed.length} ACTIVE GEOPOLITICAL ALERTS</div>
                    <div style={{fontFamily:SANS,fontSize:11,color:C.muted2,flex:1,textAlign:"right"}}>Feeds into AI context automatically</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                    {["OIL LONG BIAS","GOLD SAFE HAVEN","DEFENSE RISK"].map((tag,i)=>(
                      <div key={tag} style={{background:"rgba(255,64,96,.04)",border:`1px solid rgba(255,64,96,.15)`,borderRadius:3,padding:"7px 8px",textAlign:"center"}}>
                        <div style={{fontFamily:MONO,fontSize:7,color:i===0?C.orange:i===1?C.gold:C.red,letterSpacing:"0.1em",fontWeight:700}}>{tag}</div>
                        <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:3}}>{i===0?"↑ Conflict →Oil":i===1?"↑ Risk-off →XAU":"⚠ Monitor"}</div>
                      </div>
                    ))}
                  </div>
                  {conflictFeed.map(n=>{
                    const ago=((Date.now()-n.ts)/60000);const agoStr=ago<60?`${Math.floor(ago)}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
                    const oilTag=n.assets?.includes("WTI")||n.assets?.includes("BRENT");
                    const goldTag=n.assets?.includes("XAU");
                    return(
                      <div key={n.id} data-testid={`conflict-${n.id}`} style={{background:"rgba(255,64,96,.03)",border:`1px solid rgba(255,64,96,.18)`,borderLeft:`3px solid ${C.red}`,borderRadius:3,padding:"10px 12px",marginBottom:6,cursor:"pointer"}} onClick={()=>{if(n.url&&n.url!=="#")window.open(n.url,"_blank");}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                          <div style={{flexShrink:0,width:22,height:22,borderRadius:3,background:"rgba(255,64,96,.12)",border:`1px solid rgba(255,64,96,.25)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🌐</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontFamily:SANS,fontSize:13,color:C.text,lineHeight:1.4,marginBottom:5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{n.title}</div>
                            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                              <span style={{fontFamily:MONO,fontSize:8,color:C.muted2,fontWeight:600}}>{n.source}</span>
                              <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{agoStr} ago</span>
                              <span style={{fontFamily:MONO,fontSize:7,fontWeight:800,padding:"2px 7px",borderRadius:2,background:"rgba(255,64,96,.12)",color:C.red,border:`1px solid rgba(255,64,96,.3)`,letterSpacing:"0.1em"}}>HIGH IMPACT</span>
                              {oilTag&&<span style={{fontFamily:MONO,fontSize:7,padding:"2px 6px",borderRadius:2,background:"rgba(255,140,0,.1)",color:C.orange,border:`1px solid rgba(255,140,0,.25)`}}>⛽ OIL</span>}
                              {goldTag&&<span style={{fontFamily:MONO,fontSize:7,padding:"2px 6px",borderRadius:2,background:"rgba(201,168,76,.1)",color:C.gold,border:`1px solid rgba(201,168,76,.25)`}}>Au GOLD</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Regular news feed (non-conflict filters) */}
            {newsFilter!=="CONFLICT"&&(()=>{
              let base=newsFilter==="ALL"?newsFeed:newsFeed.filter(n=>{if(newsFilter==="SOCIAL")return n.categories?.includes("twitter");if(newsFilter==="EQUITIES")return n.assets?.some(a=>["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"].includes(a));return n.assets?.includes(newsFilter);});
              if(spikeFilter)base=base.filter(n=>n.assets?.includes(spikeFilter)||n.title?.toUpperCase().includes("$"+spikeFilter));
              return base;
            })().slice(0,12).map(n=>{
              const sentColor=n.sentiment>0.3?C.green:n.sentiment<-0.3?C.red:C.muted2;
              const srcColor={blue:C.blue,cyan:C.cyan,orange:C.orange,green:C.green,gold:C.gold}[n.color]||C.blue;
              const ago=((Date.now()-n.ts)/60000);const agoStr=ago<60?`${Math.floor(ago)}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
              const impactColor=n.isConflict?C.red:n.political?C.orange:n.sentiment>0.3?C.green:n.sentiment<-0.3?C.red:null;
              const impactLabel=n.isConflict?"HIGH":n.political?n.marketImpact?.toUpperCase()||"POLITICAL":n.sentiment>0.4?"BULLISH":n.sentiment<-0.4?"BEARISH":null;
              return(
                <div key={n.id} data-testid={`news-${n.id}`} style={{background:C.panel,border:`1px solid ${n.isConflict?"rgba(255,64,96,.2)":n.political?"rgba(255,140,0,.12)":C.border}`,borderLeft:impactColor?`2px solid ${impactColor}`:"none",borderRadius:3,padding:"10px 12px",marginBottom:4,cursor:"pointer"}} onClick={()=>{if(n.url&&n.url!=="#")window.open(n.url,"_blank");}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                    <div style={{flexShrink:0,width:22,height:22,borderRadius:3,background:`${srcColor}15`,border:`1px solid ${srcColor}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:n.icon?.length>2?12:undefined}}>
                      {n.icon?.length>2?<span style={{fontSize:12}}>{n.icon}</span>:<span style={{fontFamily:MONO,fontSize:7,fontWeight:900,color:srcColor}}>{n.icon}</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:SANS,fontSize:13,color:C.text,lineHeight:1.4,marginBottom:4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{n.title}</div>
                      <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                        <span style={{fontFamily:MONO,fontSize:8,color:C.muted,fontWeight:600}}>{n.source}</span>
                        <span style={{fontFamily:MONO,fontSize:8,color:C.muted}}>{agoStr} ago</span>
                        {impactLabel&&<span style={{fontFamily:MONO,fontSize:7,fontWeight:800,padding:"2px 6px",borderRadius:2,background:`${impactColor}12`,color:impactColor,border:`1px solid ${impactColor}30`,letterSpacing:"0.08em"}}>{impactLabel}</span>}
                        {n.sentiment!==0&&!impactLabel&&<span style={{fontFamily:MONO,fontSize:8,color:sentColor,fontWeight:600}}>{n.sentiment>0?"+":""}{(n.sentiment*100).toFixed(0)}%</span>}
                        {n.assets?.length>0&&n.assets.filter(a=>a!=="CONFLICT").slice(0,3).map(a=><span key={a} style={{fontFamily:MONO,fontSize:7,color:srcColor,background:`${srcColor}10`,border:`1px solid ${srcColor}22`,borderRadius:2,padding:"2px 5px"}}>{a}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {newsFilter!=="CONFLICT"&&newsFeed.length>12&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,textAlign:"center",padding:"6px 0",letterSpacing:"0.1em"}}>{newsFeed.length-12} MORE STORIES</div>}
          </div>
            );
          })()}

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
              {(()=>{
                const VOL_BASE={BTC:3e9,ETH:1e9,SOL:4e8,DOGE:1.5e8,XRP:1.2e8,AVAX:8e7};
                const fmtVol=v=>v>=1e9?`$${(v/1e9).toFixed(1)}B`:v>=1e6?`$${(v/1e6).toFixed(0)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:"--";
                return ["BTC","ETH","SOL","DOGE","XRP","AVAX"].map(sym=>{
                  const vol=storePerps[sym]?.volume24h||cryptoPrices[sym]?.volume||0;
                  const base=VOL_BASE[sym]||1e8;
                  const ratio=vol>0?vol/base:0;
                  const hot=ratio>1.8;
                  const veryHot=ratio>3;
                  const barW=vol>0?Math.min(ratio/4*100,100):0;
                  const col=veryHot?C.orange:hot?C.cyan:"rgba(0,212,255,.3)";
                  return(
                    <div key={sym} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontFamily:MONO,fontSize:10,color:veryHot?C.orange:hot?C.cyan:C.muted2}}>{sym}</span>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:40,height:5,background:"rgba(0,212,255,.08)",borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${barW}%`,background:col,borderRadius:1,transition:"width 1s"}}/></div>
                        <span style={{fontFamily:MONO,fontSize:9,color:C.muted,width:32,textAlign:"right"}}>{fmtVol(vol)}</span>
                        {veryHot&&<span style={{fontFamily:MONO,fontSize:8,color:C.orange,fontWeight:700}}>HOT</span>}
                      </div>
                    </div>
                  );
                });
              })()}
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
          {briefData&&<>
            <div style={{background:isDark?"linear-gradient(135deg,#080d18,#0f1a2e)":C.panel,borderRadius:2,border:`1px solid ${C.border2}`,padding:"22px 18px",marginBottom:10,textAlign:"center",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
              <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.28em",marginBottom:5}}>CLVRQuant · MORNING BRIEF</div>
              <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.white,fontStyle:"italic",marginBottom:4}}>Market Summary</div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{briefDate}</div>
              <div style={{marginTop:10,display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                <span style={{padding:"4px 14px",borderRadius:2,fontFamily:MONO,fontSize:8,letterSpacing:"0.15em",
                  background:briefData.bias==="RISK ON"?"rgba(0,199,135,.1)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.1)":"rgba(201,168,76,.1)",
                  color:briefData.bias==="RISK ON"?C.green:briefData.bias==="RISK OFF"?C.red:C.gold,
                  border:`1px solid ${briefData.bias==="RISK ON"?"rgba(0,199,135,.3)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.3)":"rgba(201,168,76,.3)"}`}}>
                  {briefData.bias}
                </span>
                {briefData.macroRisk==="HIGH"&&<span style={{padding:"4px 14px",borderRadius:2,fontFamily:MONO,fontSize:8,letterSpacing:"0.15em",background:"rgba(255,64,96,.1)",color:C.red,border:"1px solid rgba(255,64,96,.3)"}}>🔴 MACRO RISK</span>}
              </div>
              <div style={{marginTop:12,fontFamily:SERIF,fontSize:15,color:C.text,fontStyle:"italic",lineHeight:1.7}}>"{briefData.headline}"</div>
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Live Prices</PTitle></div>
              {[{sym:"BTC",label:"BTC/USD",prices:cryptoPrices},{sym:"ETH",label:"ETH/USD",prices:cryptoPrices},{sym:"SOL",label:"SOL/USD",prices:cryptoPrices},{sym:"EURUSD",label:"EUR/USD",prices:forexPrices},{sym:"USDJPY",label:"USD/JPY",prices:forexPrices},{sym:"USDCAD",label:"USD/CAD",prices:forexPrices},{sym:"XAU",label:"Gold XAU",prices:metalPrices},{sym:"XAG",label:"Silver XAG",prices:metalPrices},{sym:"WTI",label:"Oil WTI",prices:metalPrices},{sym:"BRENT",label:"Oil Brent",prices:metalPrices},{sym:"NATGAS",label:"Nat Gas",prices:metalPrices}].map(({sym,label,prices})=>{
                const d=prices[sym];const chg=d?.chg||0;
                return(<div key={sym} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,alignItems:"center",padding:"12px 14px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:MONO,fontSize:12,color:C.muted2,letterSpacing:"0.06em"}}>{label}</div>
                  <div style={{fontFamily:MONO,fontSize:13,color:C.white}}>{fmt(d?.price,sym)}</div>
                  <div style={{fontFamily:MONO,fontSize:12,fontWeight:600,color:chg>=0?C.green:C.red}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)}%</div>
                </div>);
              })}
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Analysis & Outlook</PTitle></div>
              {[{icon:"₿",label:"Bitcoin",key:"btc",col:C.gold},{icon:"Ξ",label:"Ethereum",key:"eth",col:C.purple},{icon:"◎",label:"Solana",key:"sol",col:C.cyan},{icon:"📈",label:"US Equities (SPX · NDX)",key:"equities",col:C.blue},{icon:"▣",label:"Gold XAU",key:"xau",col:C.gold2},{icon:"◈",label:"Silver XAG",key:"xag",col:C.muted2},{icon:"🛢️",label:"Oil & Gas (WTI · Brent · NatGas)",key:"oil",col:C.orange},{icon:"€",label:"EUR/USD",key:"eurusd",col:C.blue},{icon:"¥",label:"USD/JPY",key:"usdjpy",col:C.teal},{icon:"$",label:"USD/CAD",key:"usdcad",col:C.green}].filter(s=>briefData[s.key]).map(s=>(
                <div key={s.key} style={{padding:"16px 16px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:16,color:s.col,marginBottom:8,fontStyle:"italic"}}>{s.icon} {s.label}</div>
                  <div style={{fontSize:14,color:C.text,lineHeight:1.75,fontFamily:SERIF}}>{briefData[s.key]}</div>
                </div>
              ))}
            </div>
            {Array.isArray(briefData.impactfulNews)&&briefData.impactfulNews.length>0&&<div style={{...panel,border:`1px solid rgba(6,182,212,.22)`}}>
              <div style={{...ph,background:"rgba(6,182,212,.05)"}}><PTitle>Impactful News for Trading</PTitle></div>
              {briefData.impactfulNews.slice(0,5).map((n,i)=>{
                const impact=(n.impact||"").toUpperCase();
                const iColor=impact==="BULLISH"?C.green:impact==="BEARISH"?C.red:C.gold;
                const iBg=impact==="BULLISH"?"rgba(0,199,135,.1)":impact==="BEARISH"?"rgba(255,64,96,.1)":"rgba(201,168,76,.1)";
                return(<div key={i} style={{padding:"12px 14px",borderBottom:i<Math.min(briefData.impactfulNews.length,5)-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.white,lineHeight:1.4,flex:1}}>{n.title||"—"}</div>
                    <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:iColor,background:iBg,border:`1px solid ${iColor}40`,borderRadius:2,padding:"3px 8px",letterSpacing:"0.1em",flexShrink:0}}>{impact||"NEUTRAL"}</span>
                  </div>
                  {n.assets&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:6}}>📍 {n.assets}</div>}
                  {n.takeaway&&<div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:13,color:C.text,lineHeight:1.7}}>→ {n.takeaway}</div>}
                </div>);
              })}
            </div>}
            {briefData.watchToday&&<div style={{...panel,border:`1px solid ${C.border2}`}}>
              <div style={{...ph,background:"rgba(201,168,76,.04)"}}><PTitle>What to Watch Today</PTitle></div>
              {briefData.watchToday.map((item,i)=>(
                <div key={i} style={{padding:"12px 14px",borderBottom:i<briefData.watchToday.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,color:C.gold,flexShrink:0}}>{i+1}.</span>
                  <div style={{fontSize:13,color:C.text,lineHeight:1.7,fontFamily:SERIF}}>{item}</div>
                </div>
              ))}
            </div>}
            {briefData.keyRisk&&<div style={{...panel,border:`1px solid rgba(255,64,96,.2)`}}>
              <div style={{padding:"14px 16px",background:"rgba(255,64,96,.04)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontFamily:MONO,fontSize:10,color:C.red,letterSpacing:"0.15em",fontWeight:600,flexShrink:0,marginTop:3}}>RISK</span>
                <div style={{fontSize:13.5,color:C.text,lineHeight:1.75,fontFamily:SERIF}}>{briefData.keyRisk}</div>
              </div>
            </div>}
            {(() => {
              const briefTradeCount = userTier === "elite" ? 3 : userTier === "pro" ? 1 : 0;
              if (briefTradeCount === 0) {
                return (
                  <div style={{...panel,border:`1px solid rgba(201,168,76,.25)`,padding:"22px 18px",textAlign:"center"}}>
                    <div style={{fontSize:24,marginBottom:8}}>🔒</div>
                    <div style={{fontFamily:SERIF,fontWeight:700,fontSize:15,color:C.gold,marginBottom:6,fontStyle:"italic"}}>Trade Ideas — Pro Feature</div>
                    <div style={{fontFamily:MONO,fontSize:10,color:C.muted,letterSpacing:"0.06em",marginBottom:14,lineHeight:1.6}}>
                      Upgrade to see today's top trade ideas — entry, stops, targets, confidence, and edge.
                    </div>
                    <button data-testid="btn-upgrade-trade-ideas" onClick={()=>setShowUpgrade && setShowUpgrade(true)} style={{background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.4)",borderRadius:2,padding:"10px 22px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,cursor:"pointer",letterSpacing:"0.04em"}}>
                      Upgrade to Pro — $29.99/mo
                    </button>
                  </div>
                );
              }
              const trades = [
                ...(briefData.topTrade ? [briefData.topTrade] : []),
                ...(briefTradeCount >= 3 && Array.isArray(briefData.additionalTrades) ? briefData.additionalTrades.slice(0, 2) : []),
              ];
              if (trades.length === 0) return null;
              const titleLabel = briefTradeCount === 1 ? "Today's Top Trade Idea" : `Trade Ideas (Elite — ${trades.length} Ideas)`;
              return (
                <div style={{...panel,border:`1px solid rgba(201,168,76,.2)`}}>
                  <div style={{...ph,background:"rgba(201,168,76,.04)"}}><PTitle>{titleLabel}</PTitle></div>
                  {trades.map((trade,idx)=>(
                    <div key={idx} style={{padding:"14px",borderBottom:idx<trades.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.18em",marginBottom:8,fontWeight:700}}>⚡ TRADE IDEA {idx+1}</div>
                      <div style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white,marginBottom:10,fontStyle:"italic"}}>{trade.riskLabel||"🟡"} {trade.asset||""} {trade.dir||""}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 16px",fontFamily:MONO,fontSize:10,color:C.text,lineHeight:2}}>
                        <div>📍 Entry: <span style={{color:C.white}}>{trade.entry||"—"}</span></div>
                        <div>🛑 Stop: <span style={{color:C.red}}>{trade.stop||"—"}</span></div>
                        <div>🎯 TP1: <span style={{color:C.green}}>{trade.tp1||"—"}</span></div>
                        <div>🎯 TP2: <span style={{color:C.green}}>{trade.tp2||"—"}</span></div>
                        <div>📊 Confidence: <span style={{color:C.gold}}>{trade.confidence||"—"}</span></div>
                        <div>⚠️ Flags: <span style={{color:C.muted}}>{trade.flags||"None"}</span></div>
                      </div>
                      {trade.edge&&<div style={{marginTop:8,fontFamily:SERIF,fontStyle:"italic",fontSize:11,color:C.muted,lineHeight:1.6}}>💡 {trade.edge}</div>}
                    </div>
                  ))}
                  {userTier === "pro" && <div style={{padding:"10px 14px",background:"rgba(201,168,76,.04)",textAlign:"center",fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.1em"}}>
                    🔒 <span style={{color:C.gold}}>Elite members get 3 trade ideas daily.</span> Upgrade at CLVRQuantAI.com
                  </div>}
                </div>
              );
            })()}
            <div style={panel}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:36,height:36,border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:SERIF,fontWeight:900,fontSize:14,color:C.gold}}>CQ</span>
                </div>
                <div>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white}}>CLVRQuant Support</div>
                  <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:2}}>Questions or issues? Support@CLVRQuantAI.com</div>
                </div>
              </div>
              <div style={{padding:"9px 14px",fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",letterSpacing:"0.12em"}}>⚠ INFORMATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE</div>
            </div>
          </>}

          <TwitterMorningBrief />

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

        {/* ══ PRICES ══ */}
        {tab==="prices"&&<MarketTab cryptoPrices={cryptoPrices} equityPrices={equityPrices} metalPrices={metalPrices} forexPrices={forexPrices} flashes={flashes}/>}

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
            const isLiveNow=!evt.released&&!evt.isPast&&isToday&&(evt.timeET||"").slice(0,5)===nowTime;
            return(
              <MacroCard key={evt.id||evt.name+evt.date} evt={evt} imp={imp} surprise={surprise} marketImpacts={marketImpacts} bc={bc} isToday={isToday} isLiveNow={isLiveNow} status={status} onAskAI={()=>askMacroAI(evt)} onAddCal={()=>{const cal=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${evt.bank} - ${evt.name}\nDTSTART:${evt.date.replace(/-/g,"")}\nDTEND:${evt.date.replace(/-/g,"")}\nDESCRIPTION:${evt.desc||evt.name}\nEND:VEVENT\nEND:VCALENDAR`;const blob=new Blob([cal],{type:"text/calendar"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${evt.bank}-${evt.date}.ics`;a.click();setToast("Calendar event saved");}} onGoAI={()=>{setAiInput(`${evt.bank} ${evt.name} on ${evt.date}: forecast ${evt.forecast}, previous ${evt.previous||evt.current}${evt.actual?`, actual ${evt.actual}`:""}. How to position? Which assets most affected?`);setTab("ai");}}/>
            );
          })}

          <div style={{marginTop:12,display:"flex",gap:10,flexWrap:"wrap",fontFamily:MONO,fontSize:8,color:C.muted,justifyContent:"center"}}>
            <span>HIGH Impact</span><span>MED Impact</span><span>LOW Impact</span><span>· Tap any card for analysis</span>
          </div>

          <div style={{fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",padding:"8px 0",marginTop:4,letterSpacing:"0.1em"}}>CLVRQuant v2 · ALL DATA LIVE · Not financial advice</div>

          {/* ── Macro Intel Feed (Elite) ── */}
          <div style={{marginTop:6,marginBottom:4}}>
            <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.2em",marginBottom:4}}>MACRO INTEL</div>
            <MacroIntelFeed
              isElite={isElite}
              onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}
              onAskAI={(q)=>{setAiInput(q);setTab("ai");}}
            />
          </div>

          {macroAiEvent&&(
            <div data-testid="macro-ai-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px 16px 72px"}} onClick={()=>{setMacroAiEvent(null);setMacroAiResp(null);}}>
              <div style={{background:C.panel,border:`1px solid ${C.border2}`,borderRadius:4,padding:20,width:"100%",maxWidth:520,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
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
                <div style={{marginTop:14,fontFamily:MONO,fontSize:7,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:10,letterSpacing:"0.08em"}}>For informational purposes only. Not financial advice. CLVRQuant · Support@CLVRQuantAI.com</div>
              </div>
            </div>
          )}
        </>}

        {/* ══ BRIEF ══ */}
        {tab==="brief"&&isPro&&<>
          <div style={{marginBottom:14}}><SLabel>Morning Market Brief</SLabel></div>
          <div style={panel}>
            <div style={ph}><PTitle>Daily Intelligence Brief</PTitle><Badge label="AI · Live Prices" color="gold"/></div>
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:C.muted2,lineHeight:1.8,marginBottom:14,fontStyle:"italic"}}>Same analysis as the 6AM email — generated live with current prices.</div>
              <button data-testid="button-generate-brief" onClick={()=>{ setBriefError(""); generateBrief(); }} disabled={briefLoading} style={{width:"100%",height:44,background:"rgba(201,168,76,.1)",color:briefLoading?C.muted:C.gold2,border:`1px solid ${briefLoading?"rgba(201,168,76,.15)":"rgba(201,168,76,.35)"}`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:briefLoading?"not-allowed":"pointer",letterSpacing:"0.04em"}}>
                {briefLoading?"Generating brief — this can take 30–60s...":"Generate Today's Brief →"}
              </button>

              {briefLoading&&(
                <div data-testid="status-brief-loading" style={{marginTop:14,padding:"12px 14px",border:`1px solid ${C.border}`,borderRadius:2,fontFamily:MONO,fontSize:10,color:C.muted2,letterSpacing:"0.06em",textAlign:"center"}}>
                  CLVR AI is pulling prices, scanning the wire and writing your brief. Please don't navigate away — the results panel will appear here when ready.
                </div>
              )}

              {!briefLoading&&briefError&&(
                <div data-testid="status-brief-error" style={{marginTop:14,padding:"12px 14px",border:"1px solid rgba(255,64,96,.35)",background:"rgba(255,64,96,.08)",borderRadius:2,fontFamily:SANS,fontSize:13,color:C.text,lineHeight:1.55}}>
                  <div style={{fontFamily:MONO,fontSize:9,letterSpacing:"0.15em",color:C.red,marginBottom:6}}>BRIEF FAILED</div>
                  {briefError}
                </div>
              )}

              {!briefLoading&&!briefError&&briefData&&(
                <div data-testid="status-brief-ready" style={{marginTop:14,padding:"12px 14px",border:"1px solid rgba(0,199,135,.3)",background:"rgba(0,199,135,.06)",borderRadius:2,fontFamily:SANS,fontSize:13,color:C.text,lineHeight:1.55}}>
                  <span style={{fontFamily:MONO,fontSize:9,letterSpacing:"0.15em",color:C.green,marginRight:8}}>READY</span>Today's brief is below — scroll to read.
                </div>
              )}
            </div>
          </div>
          {briefData&&<>
            <div style={{background:isDark?"linear-gradient(135deg,#080d18,#0f1a2e)":C.panel,borderRadius:2,border:`1px solid ${C.border2}`,padding:"22px 18px",marginBottom:10,textAlign:"center",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${C.gold},transparent)`}}/>
              <div style={{fontFamily:MONO,fontSize:7,color:C.muted,letterSpacing:"0.28em",marginBottom:5}}>CLVRQuant · MORNING BRIEF</div>
              <div style={{fontFamily:SERIF,fontWeight:900,fontSize:20,color:C.white,fontStyle:"italic",marginBottom:4}}>Market Summary</div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.muted}}>{briefDate}</div>
              <div style={{marginTop:10,display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                <span style={{padding:"4px 14px",borderRadius:2,fontFamily:MONO,fontSize:8,letterSpacing:"0.15em",
                  background:briefData.bias==="RISK ON"?"rgba(0,199,135,.1)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.1)":"rgba(201,168,76,.1)",
                  color:briefData.bias==="RISK ON"?C.green:briefData.bias==="RISK OFF"?C.red:C.gold,
                  border:`1px solid ${briefData.bias==="RISK ON"?"rgba(0,199,135,.3)":briefData.bias==="RISK OFF"?"rgba(255,64,96,.3)":"rgba(201,168,76,.3)"}`}}>
                  {briefData.bias}
                </span>
                {briefData.macroRisk==="HIGH"&&<span style={{padding:"4px 14px",borderRadius:2,fontFamily:MONO,fontSize:8,letterSpacing:"0.15em",background:"rgba(255,64,96,.1)",color:C.red,border:"1px solid rgba(255,64,96,.3)"}}>🔴 MACRO RISK</span>}
              </div>
              <div style={{marginTop:12,fontFamily:SERIF,fontSize:15,color:C.text,fontStyle:"italic",lineHeight:1.7}}>"{briefData.headline}"</div>
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Live Prices</PTitle></div>
              {[{sym:"BTC",label:"BTC/USD",prices:cryptoPrices},{sym:"ETH",label:"ETH/USD",prices:cryptoPrices},{sym:"SOL",label:"SOL/USD",prices:cryptoPrices},{sym:"EURUSD",label:"EUR/USD",prices:forexPrices},{sym:"USDJPY",label:"USD/JPY",prices:forexPrices},{sym:"USDCAD",label:"USD/CAD",prices:forexPrices},{sym:"XAU",label:"Gold XAU",prices:metalPrices},{sym:"XAG",label:"Silver XAG",prices:metalPrices},{sym:"WTI",label:"Oil WTI",prices:metalPrices},{sym:"BRENT",label:"Oil Brent",prices:metalPrices},{sym:"NATGAS",label:"Nat Gas",prices:metalPrices}].map(({sym,label,prices})=>{
                const d=prices[sym];const chg=d?.chg||0;
                return(<div key={sym} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,alignItems:"center",padding:"12px 14px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:MONO,fontSize:12,color:C.muted2,letterSpacing:"0.06em"}}>{label}</div>
                  <div style={{fontFamily:MONO,fontSize:13,color:C.white}}>{fmt(d?.price,sym)}</div>
                  <div style={{fontFamily:MONO,fontSize:12,fontWeight:600,color:chg>=0?C.green:C.red}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)}%</div>
                </div>);
              })}
            </div>
            <div style={panel}>
              <div style={ph}><PTitle>Analysis & Outlook</PTitle></div>
              {[{icon:"₿",label:"Bitcoin",key:"btc",col:C.gold},{icon:"Ξ",label:"Ethereum",key:"eth",col:C.purple},{icon:"◎",label:"Solana",key:"sol",col:C.cyan},{icon:"📈",label:"US Equities (SPX · NDX)",key:"equities",col:C.blue},{icon:"▣",label:"Gold XAU",key:"xau",col:C.gold2},{icon:"◈",label:"Silver XAG",key:"xag",col:C.muted2},{icon:"🛢️",label:"Oil & Gas (WTI · Brent · NatGas)",key:"oil",col:C.orange},{icon:"€",label:"EUR/USD",key:"eurusd",col:C.blue},{icon:"¥",label:"USD/JPY",key:"usdjpy",col:C.teal},{icon:"$",label:"USD/CAD",key:"usdcad",col:C.green}].filter(s=>briefData[s.key]).map(s=>(
                <div key={s.key} style={{padding:"16px 16px",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:16,color:s.col,marginBottom:8,fontStyle:"italic"}}>{s.icon} {s.label}</div>
                  <div style={{fontSize:14,color:C.text,lineHeight:1.75,fontFamily:SERIF}}>{briefData[s.key]}</div>
                </div>
              ))}
            </div>
            {Array.isArray(briefData.impactfulNews)&&briefData.impactfulNews.length>0&&<div style={{...panel,border:`1px solid rgba(6,182,212,.22)`}}>
              <div style={{...ph,background:"rgba(6,182,212,.05)"}}><PTitle>Impactful News for Trading</PTitle></div>
              {briefData.impactfulNews.slice(0,5).map((n,i)=>{
                const impact=(n.impact||"").toUpperCase();
                const iColor=impact==="BULLISH"?C.green:impact==="BEARISH"?C.red:C.gold;
                const iBg=impact==="BULLISH"?"rgba(0,199,135,.1)":impact==="BEARISH"?"rgba(255,64,96,.1)":"rgba(201,168,76,.1)";
                return(<div key={i} style={{padding:"12px 14px",borderBottom:i<Math.min(briefData.impactfulNews.length,5)-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.white,lineHeight:1.4,flex:1}}>{n.title||"—"}</div>
                    <span style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:iColor,background:iBg,border:`1px solid ${iColor}40`,borderRadius:2,padding:"3px 8px",letterSpacing:"0.1em",flexShrink:0}}>{impact||"NEUTRAL"}</span>
                  </div>
                  {n.assets&&<div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:6}}>📍 {n.assets}</div>}
                  {n.takeaway&&<div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:13,color:C.text,lineHeight:1.7}}>→ {n.takeaway}</div>}
                </div>);
              })}
            </div>}
            {briefData.watchToday&&<div style={{...panel,border:`1px solid ${C.border2}`}}>
              <div style={{...ph,background:"rgba(201,168,76,.04)"}}><PTitle>What to Watch Today</PTitle></div>
              {briefData.watchToday.map((item,i)=>(
                <div key={i} style={{padding:"12px 14px",borderBottom:i<briefData.watchToday.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:14,color:C.gold,flexShrink:0}}>{i+1}.</span>
                  <div style={{fontSize:13,color:C.text,lineHeight:1.7,fontFamily:SERIF}}>{item}</div>
                </div>
              ))}
            </div>}
            {briefData.keyRisk&&<div style={{...panel,border:`1px solid rgba(255,64,96,.2)`}}>
              <div style={{padding:"14px 16px",background:"rgba(255,64,96,.04)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontFamily:MONO,fontSize:10,color:C.red,letterSpacing:"0.15em",fontWeight:600,flexShrink:0,marginTop:3}}>RISK</span>
                <div style={{fontSize:13.5,color:C.text,lineHeight:1.75,fontFamily:SERIF}}>{briefData.keyRisk}</div>
              </div>
            </div>}
            {(() => {
              const briefTradeCount = userTier === "elite" ? 3 : userTier === "pro" ? 1 : 0;
              if (briefTradeCount === 0) {
                return (
                  <div style={{...panel,border:`1px solid rgba(201,168,76,.25)`,padding:"22px 18px",textAlign:"center"}}>
                    <div style={{fontSize:24,marginBottom:8}}>🔒</div>
                    <div style={{fontFamily:SERIF,fontWeight:700,fontSize:15,color:C.gold,marginBottom:6,fontStyle:"italic"}}>Trade Ideas — Pro Feature</div>
                    <div style={{fontFamily:MONO,fontSize:10,color:C.muted,letterSpacing:"0.06em",marginBottom:14,lineHeight:1.6}}>
                      Upgrade to see today's top trade ideas — entry, stops, targets, confidence, and edge.
                    </div>
                    <button data-testid="btn-upgrade-trade-ideas" onClick={()=>setShowUpgrade && setShowUpgrade(true)} style={{background:"rgba(201,168,76,.12)",border:"1px solid rgba(201,168,76,.4)",borderRadius:2,padding:"10px 22px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,cursor:"pointer",letterSpacing:"0.04em"}}>
                      Upgrade to Pro — $29.99/mo
                    </button>
                  </div>
                );
              }
              const trades = [
                ...(briefData.topTrade ? [briefData.topTrade] : []),
                ...(briefTradeCount >= 3 && Array.isArray(briefData.additionalTrades) ? briefData.additionalTrades.slice(0, 2) : []),
              ];
              if (trades.length === 0) return null;
              const titleLabel = briefTradeCount === 1 ? "Today's Top Trade Idea" : `Trade Ideas (Elite — ${trades.length} Ideas)`;
              return (
                <div style={{...panel,border:`1px solid rgba(201,168,76,.2)`}}>
                  <div style={{...ph,background:"rgba(201,168,76,.04)"}}><PTitle>{titleLabel}</PTitle></div>
                  {trades.map((trade,idx)=>(
                    <div key={idx} style={{padding:"14px",borderBottom:idx<trades.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.18em",marginBottom:8,fontWeight:700}}>⚡ TRADE IDEA {idx+1}</div>
                      <div style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white,marginBottom:10,fontStyle:"italic"}}>{trade.riskLabel||"🟡"} {trade.asset||""} {trade.dir||""}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 16px",fontFamily:MONO,fontSize:10,color:C.text,lineHeight:2}}>
                        <div>📍 Entry: <span style={{color:C.white}}>{trade.entry||"—"}</span></div>
                        <div>🛑 Stop: <span style={{color:C.red}}>{trade.stop||"—"}</span></div>
                        <div>🎯 TP1: <span style={{color:C.green}}>{trade.tp1||"—"}</span></div>
                        <div>🎯 TP2: <span style={{color:C.green}}>{trade.tp2||"—"}</span></div>
                        <div>📊 Confidence: <span style={{color:C.gold}}>{trade.confidence||"—"}</span></div>
                        <div>⚠️ Flags: <span style={{color:C.muted}}>{trade.flags||"None"}</span></div>
                      </div>
                      {trade.edge&&<div style={{marginTop:8,fontFamily:SERIF,fontStyle:"italic",fontSize:11,color:C.muted,lineHeight:1.6}}>💡 {trade.edge}</div>}
                    </div>
                  ))}
                  {userTier === "pro" && <div style={{padding:"10px 14px",background:"rgba(201,168,76,.04)",textAlign:"center",fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.1em"}}>
                    🔒 <span style={{color:C.gold}}>Elite members get 3 trade ideas daily.</span> Upgrade at CLVRQuantAI.com
                  </div>}
                </div>
              );
            })()}
            <div style={panel}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:36,height:36,border:`1px solid rgba(201,168,76,.25)`,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:SERIF,fontWeight:900,fontSize:14,color:C.gold}}>CQ</span>
                </div>
                <div>
                  <div style={{fontFamily:SERIF,fontWeight:700,fontSize:13,color:C.white}}>CLVRQuant Support</div>
                  <div style={{fontFamily:MONO,fontSize:8,color:C.muted,marginTop:2}}>Questions or issues? Support@CLVRQuantAI.com</div>
                </div>
              </div>
              <div style={{padding:"9px 14px",fontFamily:MONO,fontSize:7,color:C.muted,textAlign:"center",letterSpacing:"0.12em"}}>⚠ INFORMATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE</div>
            </div>
          </>}

        </>}

        {/* ══ SIGNALS ══ */}
        {tab==="signals"&&<>
          <div style={{marginBottom:10}}><SLabel>Quant AI Signals</SLabel></div>

          {/* ── Signal engine status (circuit breaker + suppressed pairs) ── */}
          <SignalStatusBanner/>

          {/* ── 30-min delay banner for free users ── */}
          {!isPro&&(
            <div data-testid="banner-signal-delay" style={{background:isDark?"rgba(255,140,0,.06)":"rgba(179,90,0,.05)",border:`1px solid ${isDark?"rgba(255,140,0,.25)":"rgba(179,90,0,.2)"}`,borderRadius:4,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:160}}>
                <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:C.orange,letterSpacing:"0.14em",marginBottom:3}}>⏱ SIGNALS DELAYED 30 MINUTES</div>
                <div style={{fontFamily:MONO,fontSize:8,color:C.muted,lineHeight:1.6}}>Free accounts see signals with a 30-minute delay. Entry, TP & Stop-Loss prices are hidden. Upgrade to Pro for real-time alerts with full trade data.</div>
              </div>
              <button data-testid="btn-upgrade-from-delay-banner" onClick={onUpgrade} style={{padding:"9px 20px",background:"rgba(201,168,76,.14)",border:`1px solid rgba(201,168,76,.4)`,borderRadius:3,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:12,color:C.gold2,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Upgrade to Pro →</button>
            </div>
          )}

          {/* ── How to Use a Signal guide (collapsible, Pro+) ── */}
          <SignalGuideCard isPro={isPro}/>

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
            {[{k:"all",l:"All"},{k:"crypto",l:"Crypto",col:"green"},{k:"equity",l:"Equities",col:"blue"},{k:"metals",l:"Metals"},{k:"forex",l:"Forex",col:"teal"}].map(t=>(
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

          {/* 6-Dimension methodology panel */}
          <div style={{background:"rgba(0,0,0,.2)",border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontFamily:MONO,fontSize:8,color:C.gold,letterSpacing:"0.2em",marginBottom:8}}>6-DIMENSION ANALYSIS ENGINE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px"}}>
              {[
                {dot:"#3b82f6",label:"Technical Analysis",sub:"RSI · EMA · Bollinger Bands (30pts)"},
                {dot:"#a855f7",label:"Statistics / Math",sub:"Z-Score deviation from mean (20pts)"},
                {dot:"#06b6d4",label:"News Sentiment",sub:"CryptoPanic live signals (15pts)"},
                {dot:"#c9a84c",label:"Fundamentals",sub:"Open Interest · Funding Rate (20pts)"},
                {dot:"#f97316",label:"Pattern Recognition",sub:"Chart patterns H&S, flags (10pts)"},
                {dot:"#22c55e",label:"Back Testing",sub:"Historical win rate for setup (10pts)"},
              ].map(({dot,label,sub})=>(
                <div key={label} style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:3}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0,marginTop:3}}/>
                  <div>
                    <div style={{fontFamily:MONO,fontSize:8,color:C.white,fontWeight:700}}>{label}</div>
                    <div style={{fontFamily:MONO,fontSize:7,color:C.muted}}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,fontFamily:MONO,fontSize:8,color:C.green}}>⚡ Score ≥ 80 = STRONG SIGNAL → push notification sent to your device as LONG or SHORT</div>
          </div>

          {/* Score legend */}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {[{label:"STRONG (80+)",color:C.green,bg:"rgba(0,199,135,.08)"},{label:"HIGH (70-79)",color:"#86efac",bg:"rgba(134,239,172,.06)"},{label:"MED (55-69)",color:C.orange,bg:"rgba(255,140,0,.06)"},{label:"LOW (<55)",color:C.red,bg:"rgba(255,64,96,.06)"}].map(({label,color,bg})=>(
              <div key={label} style={{background:bg,border:`1px solid ${color}33`,borderRadius:2,padding:"3px 10px",fontFamily:MONO,fontSize:8,color,fontWeight:700,letterSpacing:"0.08em"}}>● {label}</div>
            ))}
            <div style={{fontFamily:MONO,fontSize:8,color:C.muted,padding:"3px 0"}}>Tap card for full breakdown →</div>
          </div>

          {/* Signal feed */}
          {(()=>{
            const regimeName=mapRegimeLabel(dbRegime?.label);
            const regimeMult=regimeMultiplier(dbRegime?.label);
            const getSigScore=(s)=>Math.min(100,Math.round((s.advancedScore!=null?s.advancedScore:scoreSignal({priceMoveAbs:Math.abs(s.pctMove||0),direction:s.dir==="LONG"?"long":"short",fundingRate:(cryptoPrices[s.token]||{}).funding||0,oiM:Math.round(((cryptoPrices[s.token]||{}).oi||0)/1e6),volumeMultiplier:1}).total)*regimeMult));
            let pool=highConfOnly?filtSigs.filter(s=>getSigScore(s)>=75):filtSigs;
            const sorted=sigSort==="score"?[...pool].sort((a,b)=>getSigScore(b)-getSigScore(a)):pool;
            return sorted.length===0?<div style={{padding:32,textAlign:"center"}}>
              <div style={{color:C.muted,fontFamily:MONO,fontSize:10,marginBottom:8}}>
                {liveSignals.length===0?"Monitoring markets for significant moves...":(highConfOnly?"No high-confidence signals currently.":"No signals for this filter.")}
              </div>
              {liveSignals.length===0&&<div style={{color:C.muted2,fontFamily:MONO,fontSize:8,lineHeight:"1.6"}}>
                Signals appear when any tracked token moves &gt;0.8% within a 5-minute window.<br/>
                Tracking {sigTracking} tokens in real-time. Detector is armed.
              </div>}
            </div>:sorted.map(sig=><SignalCard key={sig.id} sig={sig} marketData={cryptoPrices} onShare={onShareSig} onAiAnalyze={onAiSig} onTrade={openTradeModal} whaleAlerts={whaleAlerts} isPro={isPro} onUpgrade={onUpgrade} regimeName={regimeName} regimeMult={regimeMult}/>);
          })()}

          {/* ── Signal Performance Tracker — owner-only diagnostic; the
              public Track Record tab already exposes per-user history. ── */}
        </>}


        {tab==="track"&&<TrackRecordTab isPro={isPro} onUpgrade={onUpgrade}/>}

        {tab==="rejections"&&isAdmin&&<AdminRejectionsTab/>}

        {/* ══ INSIDER ══ */}
        {tab==="insider"&&isElite&&<>
          <InsiderTab
            isPro={isElite}
            onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}
            onAskAI={(q)=>{setAiInput(q);setTab("ai");}}
          />
        </>}

        {/* ══ JOURNAL ══ */}
        {tab==="journal"&&<TradeJournalTab isElite={isElite} onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}/>}
        {tab==="chartai"&&isElite&&<ChartAITab C={C} MONO={MONO} SERIF={SERIF} SANS={SANS} isMobile={isMobile}/>}

        {/* ══ ALERTS ══ */}
        {tab==="alerts"&&isPro&&<>
          <div style={{marginBottom:10}}><SLabel>Alerts & Anomalies</SLabel></div>

          {/* ── Store auto-generated alerts (internal only — hidden from users) ── */}

          <div style={panel}>
            <div style={ph}>
              <PTitle>My Price Alerts</PTitle>
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
        {tab==="wallet"&&isPro&&<>
          <div style={{marginBottom:14}}><SLabel>Phantom Wallet</SLabel></div>
          <PhantomWalletPanel />
        </>}

        {/* ══ AI ══ */}
        {tab==="ai"&&<>
          <AIQuantTab
            isPro={isPro} isElite={isElite} isPreview={isPreview}
            storePerps={storePerps} storeSpot={storeSpot}
            cryptoPrices={cryptoPrices} equityPrices={equityPrices}
            metalPrices={metalPrices} forexPrices={forexPrices}
            liveSignals={liveSignals} newsFeed={newsFeed}
            macroEvents={macroEvents} insiderData={insiderData}
            regimeData={regimeData} storeMode={storeMode}
            storeTotalMarkets={storeTotalMarkets} storeAlerts={storeAlerts}
            allPrices={allPrices} fmt={fmt}
            onUpgrade={onUpgrade}
            onAlertCreated={refreshAlerts}
          />

          <div style={{...panel,border:`1px solid rgba(255,140,0,.12)`}}>
            <div style={{padding:"11px 14px",background:"rgba(255,140,0,.03)"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.orange,letterSpacing:"0.22em",marginBottom:5}}>LEGAL DISCLAIMER</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.9}}>CLVRQuant is an AI-powered research and analytics platform for <strong style={{color:C.muted2}}>informational and educational purposes only</strong>. Nothing constitutes financial advice, investment advice, or trading advice. AI signals are not recommendations. All trading involves significant risk of loss. Past performance does not predict future results. © 2026 CLVRQuant. All rights reserved.</div>
            </div>
          </div>
        </>}

        {/* ══ BASKET ══ */}
        {tab==="basket"&&<>
          <div style={{marginBottom:6}}><SLabel>My Basket</SLabel></div>
          <ProGate feature="basket" tier="elite" isPro={isElite} onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}>
          <MyBasket
            isPro={isElite}
            onUpgrade={()=>{setUpgradeDefaultTier("elite");setShowPricingModal(true);}}
            aiLoading={aiLoading}
            setAiLoading={setAiLoading}
            setAiOutput={setAiOutput}
            storePerps={storePerps}
            storeSpot={storeSpot}
            cryptoPrices={cryptoPrices}
            equityPrices={equityPrices}
            metalPrices={metalPrices}
          />
          </ProGate>
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
          <div style={{...panel,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",gap:12}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted2,letterSpacing:"0.08em"}}>New here? Take a quick walkthrough</div>
            <button data-testid="btn-take-tour" onClick={()=>{try{localStorage.removeItem("clvr_tour_v1_done");}catch{}setShowTour(true);}} style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.3)`,padding:"7px 16px",fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:13,color:C.gold2,cursor:"pointer",whiteSpace:"nowrap",borderRadius:4}}>
              Take the Tour
            </button>
          </div>

          {/* ── WHAT'S NEW THIS WEEK (admin-driven, latest replaces prior) ── */}
          <WhatsNewPanel panel={panel} ph={ph} PTitle={PTitle} Badge={Badge} C={C} SERIF={SERIF} SANS={SANS}/>
          <div style={panel}>
            <div style={ph}><PTitle>Why CLVRQuant?</PTitle></div>
            <div style={{padding:"8px 16px 16px"}}>
              {[
                {t:"One Dashboard, All Markets",d:"Crypto, equities, commodities, forex, and macro events — all live, all in one place. No more tab-switching."},
                {t:"AI-Powered Intelligence — Two Tiers",d:"Pro members get CLVR AI Market Chat: ask Claude anything about markets, get trade ideas, macro breakdowns, and sector rotations in real-time. Elite members get everything in Pro plus the full AI Quant Engine — MasterBrain Analysis with automated entry, stop, and target generation across SPOT and PERP markets."},
                {t:"AI Quant Engine — Elite Exclusive",d:"The ⚡ Quant Engine is CLVRQuant's most powerful feature. MasterBrain runs a 12-factor confluence analysis — price, funding, OI, momentum, macro context, sentiment, and more — to generate a complete trade blueprint with Kelly-sized position sizing. Available exclusively to Elite members."},
                {t:"Real Alpha Signals",d:"QuantBrain detects price moves, anomalies, and momentum shifts across 32 crypto assets, 16 equities, and commodities in real-time. Every signal is scored using multiple on-chain and market factors — available to all Pro and Elite members."},
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
          {/* ── Pro vs Elite Comparison ── */}
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={ph}><PTitle>Plan Comparison</PTitle><Badge label="Tiers" color="gold"/></div>
            <div style={{padding:"8px 16px 16px"}}>
              {[
                {feature:"Live market data (crypto, equities, forex, commodities)",free:true,pro:true,elite:true},
                {feature:"Macro Calendar & Morning Brief (daily trade ideas)",free:"Locked",pro:"1 idea",elite:"3 ideas"},
                {feature:"QuantBrain signals & anomaly alerts",free:false,pro:true,elite:true},
                {feature:"CLVR AI Market Chat (Claude)",free:false,pro:"30/day",elite:"Unlimited"},
                {feature:"⚡ AI Quant Engine — MasterBrain",free:false,pro:false,elite:true},
                {feature:"SEC Insider Flow & Whale Tracking",free:false,pro:false,elite:true},
                {feature:"Basket Analysis (3+ assets)",free:false,pro:false,elite:true},
                {feature:"Custom price alerts & push notifications",free:false,pro:true,elite:true},
                {feature:"Squawk Box (live signal announcer)",free:false,pro:false,elite:true},
              ].map(({feature,free,pro,elite},i)=>{
                const cell=(v,col)=><div style={{width:48,textAlign:"center",fontFamily:MONO,fontSize:9,color:v===false?C.muted:v===true?C.green:col,flexShrink:0}}>{v===false?"—":v===true?"✓":v}</div>;
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:10,borderBottom:i<8?`1px solid ${C.border}`:"none"}}>
                    <div style={{flex:1,fontFamily:SANS,fontSize:11,color:C.muted2,lineHeight:1.4}}>{feature}</div>
                    {cell(free,C.muted2)}{cell(pro,C.gold)}{cell(elite,"#00e5ff")}
                  </div>
                );
              })}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:4}}>
                {[{l:"FREE",c:C.muted2},{l:"PRO",c:C.gold},{l:"ELITE",c:"#00e5ff"}].map(({l,c})=>(
                  <div key={l} style={{fontFamily:MONO,fontSize:7,color:c,background:`${c}10`,border:`1px solid ${c}30`,borderRadius:3,padding:"2px 6px",letterSpacing:"0.1em"}}>{l}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{...panel,border:`1px solid rgba(201,168,76,.15)`}}>
            <div style={{padding:"16px 18px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.2em",marginBottom:12}}>CONTACT & SUPPORT</div>
              <div style={{fontFamily:SANS,fontSize:13,color:C.muted2,lineHeight:1.8,marginBottom:12}}>
                Questions, feedback, or business inquiries? Our support team is here to help.
              </div>
              <a href="mailto:Support@CLVRQuantAI.com" data-testid="link-contact-email" style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:MONO,fontSize:12,color:C.gold2,textDecoration:"none",border:`1px solid rgba(201,168,76,.25)`,borderRadius:4,padding:"8px 14px",background:"rgba(201,168,76,.06)"}}>
                ✉ Support@CLVRQuantAI.com
              </a>
            </div>
          </div>
          <div style={{...panel,border:`1px solid rgba(100,180,255,.12)`}}>
            <div style={{padding:"16px 18px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.blue,letterSpacing:"0.2em",marginBottom:12}}>📚 HELP CENTER & FAQ</div>
              <div style={{fontFamily:SANS,fontSize:13,color:C.muted2,lineHeight:1.8,marginBottom:12}}>
                Find answers to common questions, tutorials, and platform guides. Tap the ❓ HELP tab in the navigation bar below.
              </div>
              <button data-testid="btn-goto-help" onClick={()=>setTab("help")} style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:MONO,fontSize:12,color:C.blue,background:"rgba(100,180,255,.06)",border:`1px solid rgba(100,180,255,.25)`,borderRadius:4,padding:"8px 14px",cursor:"pointer"}}>
                Open Help Center →
              </button>
            </div>
          </div>
          {/* Social media panel */}
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={{padding:"18px 18px"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.2em",marginBottom:6}}>FOLLOW CLVRQUANT</div>
              <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.7,marginBottom:16}}>
                Follow for live signals, market insights, and daily trade setups.
              </div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <a
                  data-testid="link-instagram-about"
                  href="https://www.instagram.com/clvrquantai?igsh=MTU0d25zcm5uaGp1cg%3D%3D&utm_source=qr"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display:"flex",alignItems:"center",gap:9,
                    minHeight:44,padding:"0 18px",
                    borderRadius:6,
                    background:"rgba(201,168,76,0.07)",
                    border:`1px solid rgba(201,168,76,0.25)`,
                    color:C.gold2,
                    textDecoration:"none",
                    fontFamily:MONO,fontSize:11,letterSpacing:"0.08em",
                    fontWeight:600,
                  }}
                >
                  <SiInstagram size={18} />
                  <span>@clvrquantai</span>
                </a>
                <a
                  data-testid="link-tiktok-about"
                  href="https://www.tiktok.com/@clvrquantai"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display:"flex",alignItems:"center",gap:9,
                    minHeight:44,padding:"0 18px",
                    borderRadius:6,
                    background:"rgba(201,168,76,0.07)",
                    border:`1px solid rgba(201,168,76,0.25)`,
                    color:C.gold2,
                    textDecoration:"none",
                    fontFamily:MONO,fontSize:11,letterSpacing:"0.08em",
                    fontWeight:600,
                  }}
                >
                  <SiTiktok size={17} />
                  <span>@clvrquantai</span>
                </a>
              </div>
            </div>
          </div>

          <div style={{...panel,border:`1px solid rgba(201,168,76,.12)`}}>
            <div style={{padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontFamily:SERIF,fontSize:13,color:C.muted2,fontStyle:"italic",lineHeight:1.8}}>
                "Markets reward the prepared. CLVRQuant keeps you prepared."
              </div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,marginTop:8,letterSpacing:"0.15em"}}>CLVRQUANT</div>
            </div>
          </div>
        </>}

        {tab==="help"&&<>
          <div style={{...panel,border:`1px solid rgba(201,168,76,.18)`}}>
            <div style={{padding:"22px 18px 12px",textAlign:"center"}}>
              <div style={{fontFamily:SERIF,fontSize:24,fontWeight:900,color:C.white,letterSpacing:"-0.02em"}}>Help <span style={{color:C.gold}}>Center</span></div>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.3em",marginTop:4,marginBottom:8}}>FREQUENTLY ASKED QUESTIONS</div>
              <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.7}}>Everything you need to know about CLVRQuant. Can't find an answer? Email us.</div>
              <a href="mailto:Support@CLVRQuantAI.com" style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:12,fontFamily:MONO,fontSize:11,color:C.gold2,textDecoration:"none",border:`1px solid rgba(201,168,76,.25)`,borderRadius:4,padding:"6px 14px",background:"rgba(201,168,76,.06)"}}>✉ Support@CLVRQuantAI.com</a>
            </div>
          </div>

          {[
            {cat:"What's New (April 2026)",color:"#00e5ff",items:[
              {q:"What changed with the price feeds?",a:"Migrated off Finnhub. Equities, forex, and commodity-spot now stream from Yahoo Finance (primary) with FMP as fallback — same real-time refresh, far higher rate limits, no more 429 outages. Crypto spot also opens a direct browser→Binance WebSocket for sub-second tick updates on top of Hyperliquid."},
              {q:"Why did 'Generate Trade Idea' sometimes show 'Load failed'?",a:"Safari and some mobile browsers silently abort fetch requests longer than ~60 seconds, and Claude trade-idea generation occasionally takes 70-90s on heavy market data. We added an explicit 90-second controller — you'll now see a clean '⏱ Trade Ideas timed out (90s)' message instead of a confusing 'Load failed' if it ever runs over."},
              {q:"Are commodity perps now live from Hyperliquid?",a:"Yes. The COMMODITIES tab → PERP · TRADE.XYZ toggle now reads live mids from the Hyperliquid Trade.xyz HIP-3 dex for everything: Gold, Silver, WTI (CL), Brent, NatGas, Copper, Platinum, Palladium. Each row shows the live mark + funding rate + open interest. CME futures only display if a HL contract drifts >10% from spot (illiquidity safeguard) — labelled 'HL STALE'."},
              {q:"Why is gold spot price slightly different from CME futures?",a:"Spot gold (XAU) and CME front-month futures (GC=F) typically trade $5-30 apart due to contango (cost of carry). Bloomberg's 'Gold Spot $/Oz' tab shows true LBMA spot, not futures. Our Commodities → SPOT tab now matches Bloomberg spot exactly via gold-api.com (LBMA fix). The PERP tab shows live HL/Trade.xyz mids."},
              {q:"How do I import a trade from a screenshot or link?",a:"Open the 📓 Journal tab and tap '📷 Import from Screenshot / Link'. Upload a screenshot of your open position from any broker (Phantom, Hyperliquid, Binance, IBKR…) or paste a URL — Claude vision reads asset, direction, entry, stop, TP1, TP2 and pre-fills the new-trade form. Review and tap SAVE TRADE."},
              {q:"My iPhone screenshot is huge — will it upload?",a:"Yes. Your browser now auto-compresses every image (max 1600px wide JPEG ~85% quality) before sending — typically 300–800 KB instead of multi-MB. You'll see live status: Compressing → Uploading (XXX KB) → Analyzing with AI."},
              {q:"What is the Share Card on closed trades?",a:"On any closed trade tap '📤 Share Card' to generate a luxury navy/gold PNG showing the asset, R-multiple, and your P&L. Share it to X, Instagram, or Discord with one tap, or download the PNG."},
              {q:"What changed in the Squawk Box?",a:"(Elite) The 📣 button now shows a pulsing green LIVE dot when active so you can confirm at a glance it's listening. High-conviction signals are now spoken with urgent priority — louder, faster, and they cut to the front of the speech queue."},
              {q:"What are the new Today timeframes?",a:"In the signals view, the Today filter now splits into Quick (<1h), Hours (1–8h), and Full Day so you can see only setups that fit your trading window. Tap the sub-filter chips above the signal list."},
              {q:"How does the new Adaptive Learning work?",a:"The engine recalculates win-rate thresholds every 30 minutes (was 4 hours). Any setup with under 25% historical win rate over 10+ signals is automatically suppressed. Per-asset signals are also capped per hour to prevent noise."},
              {q:"Where do I see leverage and hold time on signals?",a:"Every signal card now displays the suggested leverage (1x–10x based on conviction) and the expected hold time prominently — no need to dig into details to plan size and timing."},
              {q:"Why did my Morning Brief change?",a:"The commentary is now a tighter 4-block summary (BTC, FX Majors, Gold, Oil) so it generates faster and lands more reliably. The reply-to address is also now no-reply@clvrquantai.com — for support, write to Support@CLVRQuantAI.com (still in the email body)."},
            ]},
            {cat:"Getting Started",color:C.blue,items:[
              {q:"What is CLVRQuant?",a:"CLVRQuant is a mobile-first AI-powered market intelligence dashboard. It aggregates live prices across crypto, equities, commodities, and forex — combined with AI analysis, macro event tracking, and real-time signals — all in one clean app."},
              {q:"How do I create an account?",a:"Tap the Account tab (⚙) in the navigation bar, then choose Sign Up. Enter your email and password. That's it — you're in. Free accounts get access to all core market data, signals, and the daily brief."},
              {q:"What's the difference between Free, Pro, and Elite?",a:"Free: live prices, macro calendar, basic signals, 1 morning brief idea. Pro ($29.99/mo): CLVR AI Market Chat, 4 daily brief ideas, full signals, sentiment feed, and custom price alerts. Elite ($129/mo): everything in Pro plus the exclusive ⚡ AI Quant Engine (MasterBrain 12-factor analysis), SEC Insider Flow, My Basket Analysis, Squawk Box live signal announcer, whale tracking, and Hyperliquid perpetuals data. The Squawk Box, SEC Insider tab, and Basket Analysis are Elite-only — Pro users see a locked preview with an upgrade prompt. Tap your tier badge in the header to upgrade."},
              {q:"Can I use CLVRQuant on my phone?",a:"Yes — CLVRQuant is designed mobile-first. You can add it to your home screen as a PWA (Progressive Web App) for a native app experience. On iPhone, tap Share → Add to Home Screen. On Android, tap the browser menu → Install App."},
            ]},
            {cat:"Market Data & Signals",color:C.green,items:[
              {q:"Where does the market data come from?",a:"Live crypto prices come from Binance (direct WebSocket) and Hyperliquid. Equities, forex, and commodity futures come from Yahoo Finance (primary) with FMP as fallback. Spot metals (gold, silver, platinum, palladium) come from gold-api.com (LBMA fix). Commodity perps come live from Hyperliquid Trade.xyz. Macro events come from ForexFactory. All data is real-time — no delayed or simulated prices."},
              {q:"What does 'AWAITING RESULT' mean on the macro calendar?",a:"This appears when a high-impact economic event (like an FOMC rate decision) has passed its scheduled release time but the actual result hasn't been published yet on ForexFactory. This typically resolves within 30–60 minutes of the announcement. The system refreshes automatically."},
              {q:"What is a QuantBrain Signal?",a:"QuantBrain signals are generated when an asset passes at least 4 out of 5 technical checks — price move magnitude, volume spike, funding rate, open interest shift, and momentum. Each signal shows a conviction score (55–100), suggested entry/target/stop, and Kelly position sizing."},
              {q:"How often do signals refresh?",a:"Signal checks run continuously. The dashboard refreshes market data every 30 seconds. New signals appear as soon as they're detected."},
              {q:"Why does a signal say SIM instead of LIVE?",a:"SIM means the data source for that asset is temporarily unavailable and a reference price is shown. LIVE means the price is fetched in real-time from market data providers."},
            ]},
            {cat:"CLVR AI",color:C.gold2,items:[
              {q:"What is CLVR AI?",a:"CLVR AI is your personal AI market analyst, powered by Anthropic's Claude model. It analyzes live prices, signals, macro events, and market regime data in real-time to answer your questions and suggest trade setups."},
              {q:"Is CLVR AI available on the Free plan?",a:"Free users see the morning brief (1 trade idea). Pro unlocks CLVR AI Market Chat — ask Claude anything about markets, get trade ideas and analysis. Elite unlocks everything in Pro PLUS the ⚡ Quant Engine — MasterBrain runs a full 12-factor analysis generating precise entry, stop, and target levels with Kelly-sized position sizing. The Quant Engine is Elite exclusive."},
              {q:"What is the AI Quant Engine and who can use it?",a:"The ⚡ Quant Engine is the most advanced feature in CLVRQuant, available exclusively to Elite members. It runs MasterBrain Analysis — a 12-factor confluence model across price action, funding rates, open interest, momentum, macro context, and sentiment — then generates a complete trade blueprint with entry, stop-loss, two profit targets, and an optimal position size. In the AI tab, tap ⚡ QUANT ENGINE to access it (Elite members only)."},
              {q:"Does the AI give financial advice?",a:"CLVRQuant and CLVR AI are for educational and informational purposes only. Nothing on this platform constitutes financial advice. Always do your own research and consult a licensed financial advisor before making investment decisions."},
            ]},
            {cat:"Alerts & Notifications",color:C.orange,items:[
              {q:"How do I set a price alert?",a:"Tap the 🔔 Alerts tab in the navigation bar. Enter the asset, price target, and direction (above/below). Tap Save. You'll get a push notification when the price hits your target — even if the app is closed."},
              {q:"Why aren't I receiving push notifications?",a:"First, make sure you've allowed notifications when prompted. On iPhone, go to Settings → Notifications → Safari (or your browser) and enable notifications for CLVRQuant. If you added the app to your home screen, you may need to re-enable notifications from Settings → CLVRQuant."},
              {q:"What is the Morning Brief?",a:"The Morning Brief is a daily AI-generated market summary delivered every day at 6:00 AM ET. It covers overnight moves across crypto, equities, and commodities; key macro events for the day; and top trade setups. You can also receive it by email — subscribe in the Account tab."},
              {q:"What is the Squawk Box and who can use it?",a:"The Squawk Box (📣 in the header) is an Elite-only live signal announcer. When active, it uses your device's text-to-speech to call out new QuantBrain signals in real-time — hands-free market awareness while you work. Pro users see a locked 📣 icon with a 🔒 badge; tap it to upgrade. Enable SOUND first, then tap 📣 SQUAWK to go live."},
            ]},
            {cat:"Billing & Subscription",color:C.red,items:[
              {q:"How much does it cost?",a:"CLVR Pro is $29.99/month or $299/year (save $60). CLVR Elite is $129/month or $1,199/year (save $349) — includes SEC insider flow, unlimited AI, basket analysis, forex & commodities, and whale tracking. Both plans can be cancelled anytime."},
              {q:"How do I upgrade to Pro or Elite?",a:"Tap your tier badge in the top navigation bar (the one showing UPGRADE, PRO, or ELITE). Free users are taken directly to the plan selector. Pro users who tap their PRO badge are directed straight to the Elite upgrade. Elite users who tap their ELITE badge can view downgrade options. You can also go to Account → Upgrade. All payments are processed by Stripe."},
              {q:"How do I downgrade from Elite to Pro or Free?",a:"Tap your ELITE badge in the header — this opens the pricing modal where you can select Pro or Free. For billing changes mid-cycle, go to Account → Manage Subscription to access the Stripe billing portal where you can switch plans or cancel anytime."},
              {q:"Can I cancel my subscription?",a:"Yes, you can cancel anytime. Go to Account → Manage Subscription. Your Pro access continues until the end of your current billing period, then reverts to Free. No questions asked."},
              {q:"Is my payment information secure?",a:"All payments are processed by Stripe, the industry-standard payments platform used by thousands of businesses. CLVRQuant never stores your card details."},
            ]},
            {cat:"Phantom Wallet & DeFi",color:C.muted2,items:[
              {q:"What is the Phantom Wallet integration?",a:"The Wallet tab lets you connect your Phantom wallet to view your Solana balances and positions directly in CLVRQuant. You can also view your Hyperliquid perpetual futures account. This is read-only — no transactions are initiated from CLVRQuant."},
              {q:"Is my wallet safe to connect?",a:"Yes. CLVRQuant only reads your public wallet address and balances. No private keys are ever requested or stored. You can disconnect at any time from the Wallet tab."},
            ]},
          ].map(({cat,color,items},ci)=>(
            <div key={ci} style={panel}>
              <div style={{padding:"14px 16px 8px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontFamily:MONO,fontSize:9,color,letterSpacing:"0.2em",fontWeight:700}}>{cat.toUpperCase()}</div>
              </div>
              <div style={{padding:"8px 16px 14px"}}>
                {items.map(({q,a},qi)=>{
                  const key=`faq-${ci}-${qi}`;
                  return(
                    <HelpItem key={key} q={q} a={a}/>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{...panel,border:`1px solid rgba(201,168,76,.15)`,marginBottom:4}}>
            <div style={{padding:"16px 18px",textAlign:"center"}}>
              <div style={{fontFamily:MONO,fontSize:9,color:C.gold,letterSpacing:"0.2em",marginBottom:8}}>STILL NEED HELP?</div>
              <div style={{fontFamily:SANS,fontSize:12,color:C.muted2,lineHeight:1.8,marginBottom:12}}>Our support team typically responds within 24 hours.</div>
              <a href="mailto:Support@CLVRQuantAI.com" style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:MONO,fontSize:12,color:C.gold2,textDecoration:"none",border:`1px solid rgba(201,168,76,.25)`,borderRadius:4,padding:"8px 16px",background:"rgba(201,168,76,.06)"}}>✉ Support@CLVRQuantAI.com</a>
            </div>
          </div>
        </>}

        {tab==="account"&&isPreview&&<PreviewPricingPage C2={C} MONO2={MONO} SERIF2={SERIF} onSignUp={()=>onShowAuth&&onShowAuth()} onSignIn={()=>onShowAuth&&onShowAuth()}/>}
        {tab==="account"&&!isPreview&&<AccountPage user={user} onSignOut={async()=>{try{await fetch("/api/auth/signout",{method:"POST"});}catch(e){}try{localStorage.removeItem("clvr_tier");localStorage.removeItem("clvr_code");}catch(e){}setUser(null);}} isPro={isPro} setShowUpgrade={()=>setShowPricingModal(true)} onTestBell={triggerTestBell}/>}

        <div style={{textAlign:"center",fontFamily:MONO,fontSize:8,color:C.muted,marginTop:6,letterSpacing:"0.1em"}}>
          BINANCE · HYPERLIQUID · FMP · PHANTOM · NOT FINANCIAL ADVICE · CLVRQUANT
        </div>
      </div>

      {/* ── ONBOARDING TOUR ── */}
      {showTour&&<OnboardingTour isPro={isPro} onClose={()=>setShowTour(false)} onNavigateTab={(t)=>{setTab(t);setShowTour(false);}}/>}

      {/* ── BOTTOM NAV (mobile only) ── */}
      {isMobile&&<div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:isDark?"rgba(5,7,9,.97)":"rgba(255,255,255,.97)",borderTop:`1px solid ${C.navBorder}`,backdropFilter:"blur(14px)",display:"flex",paddingBottom:"env(safe-area-inset-bottom,0px)",overflowX:"auto"}}>
        {NAV.map(item=>{
          const active=tab===item.k;const macroAlert=item.k==="macro"&&upcomingCount>0;
          const previewFreeTab=["about","help","account"].includes(item.k);
          const eliteGatedTab=!isPreview&&ELITE_TABS_GATE.includes(item.k)&&!isElite;
          const proGatedTab=!isPreview&&PRO_TABS_GATE.includes(item.k)&&!isPro;
          const isTabLocked=(isPreview&&!previewFreeTab)||eliteGatedTab||proGatedTab;
          return(
            <button key={item.k} data-testid={`nav-${item.k}`} onClick={()=>{if(item.external){window.open(item.external,"_blank","noopener,noreferrer");return;}setTab(item.k);}} style={{flex:"0 0 auto",minWidth:52,minHeight:48,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"9px 4px 11px",background:"none",border:"none",borderTop:`2px solid ${active&&!item.external?C.gold:"transparent"}`,position:"relative",transition:"border-color .2s",cursor:"pointer"}}>
              <span style={{fontSize:item.k==="ai"?11:13,lineHeight:1,fontFamily:item.k==="ai"?SERIF:"inherit",fontWeight:item.k==="ai"?900:"inherit",color:active?C.gold:isTabLocked?C.muted:C.muted2}}>{item.icon}</span>
              {macroAlert&&!active&&!isPreview&&<div style={{position:"absolute",top:4,right:8,width:5,height:5,borderRadius:"50%",background:C.red}}/>}
              {isTabLocked&&!active&&<div style={{position:"absolute",top:3,right:6,fontSize:7,lineHeight:1}}>{isPreview?"🔐":"🔒"}</div>}
              {isTabLocked&&active&&isPreview&&<div style={{position:"absolute",top:3,right:6,fontSize:7,lineHeight:1}}>🔐</div>}
              <span style={{fontFamily:MONO,fontSize:7,marginTop:3,color:active?C.gold:isTabLocked?C.muted:C.muted,letterSpacing:"0.06em",fontWeight:active?600:400,textTransform:"uppercase"}}>{item.label}</span>
            </button>
          );
        })}
        <button data-testid="btn-theme-toggle" onClick={toggleTheme} title={isDark?"Switch to light mode":"Switch to dark mode"} style={{flex:"0 0 auto",minWidth:44,minHeight:48,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"9px 4px 11px",background:"none",border:"none",borderTop:"2px solid transparent",cursor:"pointer"}}>
          <span style={{fontSize:13,lineHeight:1}}>{isDark?"☀️":"🌙"}</span>
          <span style={{fontFamily:MONO,fontSize:7,marginTop:3,color:C.muted,letterSpacing:"0.06em"}}>{isDark?"LIGHT":"DARK"}</span>
        </button>
      </div>}
    </div>
  );
}
