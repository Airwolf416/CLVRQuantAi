import { useState, useEffect, useRef } from "react";
import { fmtPrice } from "../store/MarketDataStore";
import { useTwitterIntelligence, buildAssetTwitterContext } from "../store/TwitterIntelligence";

const mono  = "'IBM Plex Mono', monospace";
const serif = "'Playfair Display', serif";

const RISK_PROFILES = {
  low: {
    id:"low", label:"CONSERVATIVE", icon:"🛡",
    color:"#4ade80", hex:"74,222,128",
    desc:"Wide stops · Low leverage · Capital first",
    slMultiplier:2.5, leverage:[1,3], riskPct:1, minWinProb:85,
    tpRatios:[2.0,4.0],
  },
  mid: {
    id:"mid", label:"BALANCED", icon:"⚖",
    color:"#f59e0b", hex:"245,158,11",
    desc:"Standard quant · Risk/reward optimized",
    slMultiplier:1.8, leverage:[3,7], riskPct:2, minWinProb:80,
    tpRatios:[1.5,3.0],
  },
  high: {
    id:"high", label:"AGGRESSIVE", icon:"⚡",
    color:"#ff2d55", hex:"255,45,85",
    desc:"Tight stops · High leverage · Max upside",
    slMultiplier:1.2, leverage:[5,15], riskPct:4, minWinProb:75,
    tpRatios:[1.2,2.5],
  },
};

const TIMEFRAMES = {
  today: { id:"today", label:"Today",     sublabel:"Scalp–Intraday", interval:"15m", count:200 },
  mid:   { id:"mid",   label:"Mid-Term",  sublabel:"1–4 weeks",     interval:"4h",  count:300 },
  long:  { id:"long",  label:"Long-Term", sublabel:"1–3 months",    interval:"1d",  count:200 },
};

const ASSETS = [
  "BTC","ETH","SOL","HYPE","TRUMP","WIF","DOGE","AVAX","XRP","LINK",
  "NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR",
  "XAU","CL","SILVER","NATGAS","COPPER",
];

const ASSET_CLASS = (a) => {
  if (["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD"].includes(a)) return "equity";
  if (["XAU","CL","SILVER","NATGAS","COPPER","BRENTOIL","PLATINUM","PALLADIUM"].includes(a)) return "commodity";
  return "crypto";
};

const sigColors = {
  STRONG_LONG:"#00ff88", LONG:"#4ade80",
  NEUTRAL:"#f59e0b",
  SHORT:"#f87171", STRONG_SHORT:"#ff2d55",
};

const TIER_CONFIG = {
  A: { label:"ELITE",    color:"#00ff88", bg:"rgba(0,255,136,0.08)",  border:"rgba(0,255,136,0.3)",  desc:"≥80% Bayesian confidence · All signals aligned" },
  B: { label:"HIGH",     color:"#d4af37", bg:"rgba(212,175,55,0.08)", border:"rgba(212,175,55,0.3)", desc:"≥70% Bayesian confidence · Strong setup" },
  C: { label:"MODERATE", color:"#f59e0b", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.3)", desc:"≥60% Bayesian confidence · Proceed with caution" },
  D: { label:"WEAK",     color:"#ff2d55", bg:"rgba(255,45,85,0.08)",  border:"rgba(255,45,85,0.3)",  desc:"<60% confidence · Stand aside or reduce size" },
};

const TREND_ARROW = { BULLISH:"↑", BEARISH:"↓", NEUTRAL:"→", LEANING_BULL:"↗", LEANING_BEAR:"↘", MIXED:"↔" };
const TREND_COLOR = { BULLISH:"#00ff88", BEARISH:"#ff2d55", NEUTRAL:"#f59e0b", LEANING_BULL:"#4ade80", LEANING_BEAR:"#f87171", MIXED:"#6b7a99" };

const LOAD_STEPS = [
  "Fetching candle history…",
  "Running multi-timeframe confluence…",
  "Computing Bayesian brain score…",
  "Scanning chart patterns…",
  "Fetching Fear & Greed index…",
  "Checking macro kill switch…",
  "Routing to CLVR Quant Engine…",
  "Synthesising AI analysis…",
];

function StatBox({ label, value, color, sub }) {
  return (
    <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:8, padding:"11px 12px" }}>
      <div style={{ fontSize:9, color:"#6b7a99", fontFamily:mono, marginBottom:4, letterSpacing:1 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:800, color:color||"#e8e8f0", fontFamily:mono }}>{value}</div>
      {sub && <div style={{ fontSize:8, color:"#3a4560", fontFamily:mono, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function LevelRow({ label, price, color, note }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
      <div>
        <div style={{ fontSize:10, color:"#a0aec0", fontFamily:mono }}>{label}</div>
        {note && <div style={{ fontSize:8, color:"#3a4560", fontFamily:mono, marginTop:2 }}>{note}</div>}
      </div>
      <div style={{ fontSize:16, fontWeight:900, color, fontFamily:mono }}>{fmtPrice(price)}</div>
    </div>
  );
}

function BayesianMeter({ probability, tier, interpretation }) {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.C;
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDisplayed(probability), 100);
    return () => clearTimeout(t);
  }, [probability]);

  return (
    <div style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:"16px 16px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:8, color:"#6b7a99", letterSpacing:1.5, marginBottom:4 }}>BAYESIAN BRAIN SCORE</div>
          <div style={{ fontSize:11, color:cfg.color, fontWeight:800, letterSpacing:1 }}>{interpretation}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:9, color:"#6b7a99", marginBottom:2 }}>CONVICTION TIER</div>
          <div style={{
            fontSize:28, fontWeight:900, color:cfg.color, fontFamily:mono,
            background:cfg.bg, border:`2px solid ${cfg.color}`,
            borderRadius:8, width:48, height:48,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>{tier}</div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
        <div style={{ fontSize:36, fontWeight:900, color:cfg.color, fontFamily:mono, lineHeight:1 }}>
          {displayed.toFixed(1)}<span style={{ fontSize:18 }}>%</span>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:8, color:"#3a4560", marginBottom:4 }}>probability of successful trade</div>
          <div style={{ height:6, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
            <div style={{
              height:"100%", width:`${displayed}%`,
              background:`linear-gradient(90deg,${cfg.color}60,${cfg.color})`,
              borderRadius:3, transition:"width 1.5s cubic-bezier(.4,0,.2,1)",
            }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
            <span style={{ fontSize:7, color:"#2a3550" }}>0%</span>
            <span style={{ fontSize:7, color:"#2a3550" }}>50%</span>
            <span style={{ fontSize:7, color:"#2a3550" }}>100%</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize:8, color:"#3a4560", lineHeight:1.5 }}>{cfg.desc}</div>
    </div>
  );
}

function MultiTFStrip({ multiTf }) {
  if (!multiTf) return null;
  const tfs = [
    { key:"15m", label:"15m", sub:"Scalp" },
    { key:"4h",  label:"4H",  sub:"Swing" },
    { key:"1d",  label:"1D",  sub:"Trend" },
  ];
  const dirColor  = TREND_COLOR[multiTf.direction] || "#6b7a99";
  const confluent = multiTf.confluent;

  return (
    <div style={{ background:"#0a0f1e", border:"1px solid #1a2235", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, fontWeight:700 }}>◆ MULTI-TIMEFRAME CONFLUENCE</div>
        <div style={{
          fontSize:8, fontWeight:800, letterSpacing:1,
          color: confluent ? "#00ff88" : "#f59e0b",
          background: confluent ? "rgba(0,255,136,0.08)" : "rgba(245,158,11,0.08)",
          border:`1px solid ${confluent ? "rgba(0,255,136,0.3)" : "rgba(245,158,11,0.3)"}`,
          padding:"3px 8px", borderRadius:4,
        }}>
          {confluent ? "✓ CONFLUENT" : "⚡ MIXED"} · {multiTf.strength}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        {tfs.map(({ key, label, sub }) => {
          const tf = multiTf[key];
          const trend  = tf?.trend || "NEUTRAL";
          const col    = TREND_COLOR[trend] || "#6b7a99";
          const arrow  = TREND_ARROW[trend] || "→";
          return (
            <div key={key} style={{
              background:`rgba(${col === "#00ff88" ? "0,255,136" : col === "#ff2d55" ? "255,45,85" : "245,158,11"},0.05)`,
              border:`1px solid ${col}30`, borderRadius:8, padding:"10px 10px", textAlign:"center",
            }}>
              <div style={{ fontSize:8, color:"#6b7a99", marginBottom:4, letterSpacing:1 }}>{label} · {sub}</div>
              <div style={{ fontSize:24, color:col, fontWeight:900, lineHeight:1, marginBottom:4 }}>{arrow}</div>
              <div style={{ fontSize:8, fontWeight:800, color:col, letterSpacing:0.5 }}>{trend.replace("_"," ")}</div>
              {tf?.ema9 > 0 && (
                <div style={{ fontSize:7, color:"#2a3550", marginTop:4, lineHeight:1.6 }}>
                  EMA9 {fmtPrice(tf.ema9)}<br/>EMA21 {fmtPrice(tf.ema21)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:8, color:"#3a4560" }}>Overall direction:</span>
        <span style={{ fontSize:9, fontWeight:800, color:dirColor }}>
          {TREND_ARROW[multiTf.direction] || "↔"} {multiTf.direction?.replace("_"," ")}
        </span>
      </div>
    </div>
  );
}

function MacroKillBanner({ macroKillSwitch }) {
  if (!macroKillSwitch || macroKillSwitch.safe) return null;
  const evt = macroKillSwitch.nearest_event;
  return (
    <div style={{
      background:"rgba(255,45,85,0.08)", border:"1px solid rgba(255,45,85,0.35)",
      borderRadius:10, padding:"12px 14px", marginBottom:14,
      display:"flex", alignItems:"flex-start", gap:10,
    }}>
      <div style={{ fontSize:18, flexShrink:0 }}>🛑</div>
      <div>
        <div style={{ fontSize:10, fontWeight:800, color:"#ff2d55", letterSpacing:1, marginBottom:3 }}>
          MACRO KILL SWITCH TRIGGERED
        </div>
        <div style={{ fontSize:9, color:"#f87171", lineHeight:1.6 }}>
          {evt?.name} in <strong>{evt?.hours_away}h</strong> ({evt?.time}) — High impact event nearby.
        </div>
        <div style={{ fontSize:8, color:"#6b7a99", marginTop:4 }}>
          MasterBrain recommends reducing position size or standing aside until after the event.
        </div>
      </div>
    </div>
  );
}

function FearGreedPanel({ fng }) {
  if (!fng) return null;
  const val = fng.value || 50;
  const col = val <= 25 ? "#00ff88" : val >= 75 ? "#ff2d55" : val <= 45 ? "#f87171" : val >= 60 ? "#f59e0b" : "#6b7a99";
  const emoji = val <= 25 ? "😱" : val >= 75 ? "🤑" : val <= 45 ? "😨" : val >= 60 ? "😎" : "😐";
  const label = fng.classification || "Neutral";

  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:10, padding:"11px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, fontWeight:700 }}>◆ FEAR & GREED INDEX</div>
        <div style={{ fontSize:8, color:"#3a4560" }}>MacroSentimentWorker</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:28, lineHeight:1 }}>{emoji}</div>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontSize:13, fontWeight:900, color:col, fontFamily:mono }}>{val}/100</span>
            <span style={{ fontSize:10, fontWeight:700, color:col }}>{label.toUpperCase()}</span>
          </div>
          <div style={{ height:5, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${val}%`, background:`linear-gradient(90deg,#00ff88,#f59e0b,#ff2d55)`, borderRadius:3 }}/>
            <div style={{ position:"relative", height:0 }}>
              <div style={{ position:"absolute", top:-9, left:`${Math.min(val,97)}%`, width:2, height:14, background:"#fff", borderRadius:2, transform:"translateX(-50%)" }}/>
            </div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
            <span style={{ fontSize:7, color:"#00ff88" }}>FEAR</span>
            <span style={{ fontSize:7, color:"#6b7a99" }}>NEUTRAL</span>
            <span style={{ fontSize:7, color:"#ff2d55" }}>GREED</span>
          </div>
        </div>
      </div>
      {fng.signal && (
        <div style={{ marginTop:8, fontSize:8, color:col, background:`${col}10`, border:`1px solid ${col}30`, borderRadius:5, padding:"4px 8px" }}>
          🧠 Contrarian signal active: {fng.signal.replace(/_/g," ")}
        </div>
      )}
    </div>
  );
}

function PatternPanel({ patterns }) {
  if (!patterns) return null;
  const { detected, patterns: pList } = patterns;
  const anyDetected = detected.head_and_shoulders || detected.bull_flag || detected.bear_flag || detected.double_top || detected.double_bottom;

  const PATS = [
    { key:"bull_flag",        icon:"📈", label:"BULL FLAG",        color:"#00ff88", desc:"DETECTED — continuation",    descNo:"Not detected" },
    { key:"bear_flag",        icon:"📉", label:"BEAR FLAG",        color:"#ff2d55", desc:"DETECTED — continuation ↓",  descNo:"Not detected" },
    { key:"head_and_shoulders",icon:"🔻",label:"HEAD & SHOULDERS", color:"#ff2d55", desc:"DETECTED — reversal risk",   descNo:"Not detected" },
    { key:"double_top",       icon:"⛰", label:"DOUBLE TOP",       color:"#f87171", desc:"DETECTED — resistance zone", descNo:"Not detected" },
    { key:"double_bottom",    icon:"🏔", label:"DOUBLE BOTTOM",    color:"#4ade80", desc:"DETECTED — support zone",    descNo:"Not detected" },
  ];

  const detectedPats = PATS.filter(p => detected[p.key]);
  const undetectedPats = PATS.filter(p => !detected[p.key]);
  const displayPats = anyDetected
    ? [...detectedPats, ...undetectedPats].slice(0, 4)
    : PATS.slice(0, 4);

  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:10, padding:"11px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, fontWeight:700 }}>◆ PATTERN RECOGNITION ENGINE</div>
        <div style={{ fontSize:8, color:"#3a4560" }}>Flag · H&S · Double Top/Bottom</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        {displayPats.map(p => {
          const hit = !!detected[p.key];
          return (
            <div key={p.key} style={{
              background: hit ? `${p.color}11` : "rgba(255,255,255,0.02)",
              border:`1px solid ${hit ? `${p.color}55` : "#1a2235"}`,
              borderRadius:8, padding:"10px", textAlign:"center",
            }}>
              <div style={{ fontSize:16, marginBottom:4 }}>{p.icon}</div>
              <div style={{ fontSize:9, fontWeight:800, color: hit ? p.color : "#3a4560", marginBottom:3 }}>{p.label}</div>
              <div style={{ fontSize:8, color: hit ? p.color : "#2a3550" }}>{hit ? p.desc : p.descNo}</div>
            </div>
          );
        })}
      </div>
      {anyDetected ? (
        <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:4 }}>
          {detectedPats.map(p => (
            <span key={p.key} style={{ fontSize:8, color:p.color, background:`${p.color}11`, border:`1px solid ${p.color}30`, borderRadius:4, padding:"2px 6px", fontFamily:mono }}>
              ✓ {p.label}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ textAlign:"center", marginTop:8, fontSize:8, color:"#2a3550" }}>
          No dominant patterns in current price structure
        </div>
      )}
    </div>
  );
}

function LoadingBrain({ step }) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPulse(p => (p + 1) % 3), 400);
    return () => clearInterval(t);
  }, []);
  const dots = ".".repeat(pulse + 1);

  return (
    <div style={{
      background:"rgba(212,175,55,0.04)", border:"1px solid rgba(212,175,55,0.15)",
      borderRadius:12, padding:"20px 16px", marginBottom:20, textAlign:"center",
    }}>
      <div style={{ fontSize:32, marginBottom:8 }}>🧠</div>
      <div style={{ fontSize:11, fontWeight:800, color:"#d4af37", letterSpacing:1, marginBottom:6 }}>
        MASTERBRAIN ACTIVE
      </div>
      <div style={{ fontSize:10, color:"#6b7a99", marginBottom:14 }}>{step}{dots}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
        {["Multi-TF Confluence","Bayesian Scoring","Pattern Recognition","Macro Kill Switch"].map((label, i) => (
          <div key={i} style={{
            background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235",
            borderRadius:6, padding:"6px 4px", fontSize:7, color:"#3a4560", textAlign:"center",
          }}>
            <div style={{ fontSize:10, marginBottom:3 }}>{["🔀","🎯","📊","🛡"][i]}</div>
            {label}
          </div>
        ))}
      </div>
      <div style={{ fontSize:8, color:"#2a3550" }}>All engines running concurrently…</div>
    </div>
  );
}

export default function AITab() {
  const [asset,   setAsset]   = useState("BTC");
  const [market,  setMarket]  = useState("PERP");
  const [query,   setQuery]   = useState("");
  const [risk,    setRisk]    = useState("mid");
  const [tf,      setTf]      = useState("today");
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const [step,    setStep]    = useState("");
  const stepIdx   = useRef(0);

  const twitterData = useTwitterIntelligence();

  const handleAnalyze = async () => {
    if (!asset) return;
    setLoading(true);
    setError(null);
    setResult(null);
    stepIdx.current = 0;

    const nextStep = () => {
      stepIdx.current = Math.min(stepIdx.current + 1, LOAD_STEPS.length - 1);
      setStep(LOAD_STEPS[stepIdx.current]);
    };

    setStep(LOAD_STEPS[0]);
    const t1 = setTimeout(nextStep, 1200);
    const t2 = setTimeout(nextStep, 2400);
    const t3 = setTimeout(nextStep, 3600);
    const t4 = setTimeout(nextStep, 4800);

    try {
      const twitterCtx = buildAssetTwitterContext(twitterData, asset);
      setStep(LOAD_STEPS[4]);

      const response = await fetch("/api/quant", {
        method:  "POST",
        headers: { "Content-Type":"application/json" },
        credentials: "include",
        body: JSON.stringify({
          ticker:         asset,
          marketType:     market,
          userQuery:      query,
          riskId:         risk,
          timeframeId:    tf,
          assetClass:     ASSET_CLASS(asset),
          twitterContext: twitterCtx,
        }),
      });

      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4);
      setStep(LOAD_STEPS[5]);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "✦ PRO FEATURE — Upgrade to Pro to unlock CLVR Quant AI.");
        }
        const txt = await response.text();
        throw new Error(`Analysis failed (${response.status}): ${txt}`);
      }

      const data = await response.json();
      // Allow suppressed signals through without requiring entry/price fields
      if (!data.signal) throw new Error("Incomplete data from Quant Engine.");
      if (data.signal !== "SUPPRESSED" && !data.entry?.price) throw new Error("Incomplete data from Quant Engine.");
      if (data.rr === undefined && data.tp1?.price && data.stopLoss?.price && data.entry?.price) {
        const r = Math.abs(data.entry.price - data.stopLoss.price);
        const w = Math.abs(data.tp1.price - data.entry.price);
        data.rr = r > 0.000001 ? w / r : 0;
      }
      setResult(data);
    } catch (err) {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4);
      setError(err.message || "System error during analysis.");
    } finally {
      setLoading(false);
      setStep("");
    }
  };

  const profile = RISK_PROFILES[risk];
  const sigCol  = result ? (sigColors[result.signal] || "#f59e0b") : "#f59e0b";

  return (
    <div style={{ backgroundColor:"#060a13", minHeight:"100vh", padding:"20px 16px", fontFamily:mono, color:"#e8e8f0" }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #1a2235", paddingBottom:15, marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontFamily:serif, color:"#e8e8f0" }}>CLVRQuant AI</h2>
          <div style={{ fontSize:7, color:"#3a4560", letterSpacing:1.5, marginTop:3 }}>
            MASTERBRAIN · BAYESIAN SCORING · MULTI-TF CONFLUENCE · MACRO KILL SWITCH
          </div>
        </div>
        <div style={{ border:"1px solid #d4af37", color:"#d4af37", padding:"5px 12px", borderRadius:4, fontSize:11, fontWeight:"bold", letterSpacing:1 }}>
          CLVR AI · SECURE
        </div>
      </div>

      {/* STEP 1: RISK PROFILE */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 1 — RISK PROFILE</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {Object.values(RISK_PROFILES).map(p => {
            const active = risk === p.id;
            return (
              <div key={p.id} onClick={() => setRisk(p.id)} style={{
                background: active ? `rgba(${p.hex},0.1)` : "rgba(255,255,255,0.02)",
                border:`2px solid ${active ? p.color : "#1a2235"}`,
                borderRadius:12, padding:"12px 10px", cursor:"pointer",
                transition:"all 0.2s", textAlign:"center",
              }}>
                <div style={{ fontSize:20, marginBottom:5 }}>{p.icon}</div>
                <div style={{ fontSize:9, fontWeight:800, color:active?p.color:"#6b7a99", letterSpacing:1, marginBottom:5 }}>{p.label}</div>
                <div style={{ fontSize:7, color:"#3a4560", lineHeight:1.6 }}>{p.desc}</div>
                {active && (
                  <div style={{ marginTop:7, fontSize:7, color:p.color }}>
                    SL {p.slMultiplier}×ATR · {p.leverage[0]}–{p.leverage[1]}x · {p.riskPct}% risk
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* STEP 2: ASSET */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 2 — SELECT ASSET</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {ASSETS.map(a => {
            const cls    = ASSET_CLASS(a);
            const clsCol = cls==="equity"?"#3b82f6":cls==="commodity"?"#d4af37":"#9945ff";
            const active = asset === a;
            return (
              <button key={a} onClick={() => setAsset(a)} data-testid={`button-asset-${a}`} style={{
                background:"transparent",
                border:`1px solid ${active ? clsCol : "#1a2235"}`,
                color:active ? clsCol : "#6b7a99",
                padding:"8px 14px", borderRadius:6,
                cursor:"pointer", fontWeight:"bold", fontSize:11,
                transition:"all 0.2s",
              }}>
                {a} {active ? "✦" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 3: PERP / SPOT */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <button onClick={() => setMarket("PERP")} data-testid="button-market-perp" style={{
          background: market==="PERP" ? "rgba(0,229,255,0.1)" : "transparent",
          border:`1px solid ${market==="PERP" ? "#00e5ff" : "#1a2235"}`,
          color: market==="PERP" ? "#00e5ff" : "#6b7a99",
          padding:12, borderRadius:6, cursor:"pointer", fontWeight:"bold", fontSize:12,
        }}>📊 PERP Markets</button>
        <button onClick={() => setMarket("SPOT")} data-testid="button-market-spot" style={{
          background: market==="SPOT" ? "rgba(255,255,255,0.05)" : "transparent",
          border:`1px solid ${market==="SPOT" ? "#fff" : "#1a2235"}`,
          color: market==="SPOT" ? "#fff" : "#6b7a99",
          padding:12, borderRadius:6, cursor:"pointer", fontWeight:"bold", fontSize:12,
        }}>📈 SPOT Markets</button>
      </div>

      {/* STEP 4: TIMEFRAME */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 3 — TIME HORIZON</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {Object.values(TIMEFRAMES).map(t => {
            const active = tf === t.id;
            return (
              <button key={t.id} onClick={() => setTf(t.id)} data-testid={`button-tf-${t.id}`} style={{
                background: active ? "rgba(0,255,136,0.08)" : "transparent",
                border:`1px solid ${active ? "#00ff88" : "#1a2235"}`,
                color: active ? "#00ff88" : "#6b7a99",
                padding:"11px 8px", borderRadius:6, cursor:"pointer", fontSize:10,
              }}>
                <div style={{ fontWeight:"bold", marginBottom:3 }}>{t.label}</div>
                <div style={{ fontSize:8, opacity:0.7 }}>{t.sublabel}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CUSTOM PROMPT */}
      <textarea
        placeholder={`"Long ${asset} now?" · "Is ${asset} overextended?" · "Best entry for ${asset}?"`}
        value={query}
        onChange={e => setQuery(e.target.value)}
        data-testid="input-custom-query"
        style={{
          width:"100%", background:"#0d1321", border:"1px solid #1a2235",
          borderRadius:8, padding:15, color:"#e8e8f0", fontFamily:mono,
          fontSize:14, height:90, resize:"none", marginBottom:16,
          boxSizing:"border-box", outline:"none",
        }}
      />

      {/* Twitter badge */}
      {twitterData.hasKey && !twitterData.loading && (
        <div style={{ marginBottom:16, display:"flex", alignItems:"center", gap:8,
          background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235",
          borderRadius:8, padding:"8px 12px" }}>
          <span style={{ fontSize:12 }}>𝕏</span>
          <span style={{ fontSize:9, color:"#6b7a99" }}>Twitter intelligence active ·</span>
          <span style={{ fontSize:9, fontWeight:700,
            color:twitterData.sentiment.score>55?"#00ff88":twitterData.sentiment.score<45?"#ff2d55":"#f59e0b" }}>
            {twitterData.sentiment.label} ({twitterData.sentiment.score}%)
          </span>
          <span style={{ fontSize:8, color:"#2a3550", marginLeft:"auto" }}>feeds AI automatically</span>
        </div>
      )}

      {/* MasterBrain Capability Overview */}
      {!result && !loading && !error && (
        <div style={{ marginBottom:16, background:"rgba(212,175,55,0.03)", border:"1px solid #1a2235", borderRadius:10, padding:"12px 14px" }}>
          <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:8, fontWeight:700 }}>◆ MASTERBRAIN ENGINES</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { icon:"🔀", label:"Multi-TF Confluence",      desc:"15m · 1h · 4h · 1d EMA9/EMA21 trend alignment" },
              { icon:"🎯", label:"Bayesian Scoring",         desc:"9 weighted signals · A/B/C/D conviction tiers" },
              { icon:"📊", label:"Pattern Recognition",      desc:"Head & Shoulders · Bull Flag · Pivot analysis" },
              { icon:"😱", label:"Fear & Greed Index",       desc:"Crypto sentiment · Contrarian signal detection" },
              { icon:"🛡", label:"Macro Kill Switch",        desc:"Halts near HIGH impact events within 4h" },
              { icon:"🚫", label:"Signal Suppression Rules", desc:"6-rule engine: macro · trend · drawdown · support · NY open · kill switch" },
              { icon:"🤖", label:"CLVR AI (Claude)",         desc:"HL · Binance · Finnhub · claude-sonnet-4" },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize:8, fontWeight:700, color:"#a0aec0", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:7, color:"#3a4560", lineHeight:1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ANALYZE BUTTON */}
      <button
        onClick={handleAnalyze}
        disabled={loading}
        data-testid="button-quant-analyze"
        style={{
          width:"100%",
          background: loading ? "#0d1321" : `rgba(${profile.hex},0.08)`,
          border:`1px solid ${loading ? "#1a2235" : profile.color}`,
          color: loading ? "#6b7a99" : profile.color,
          padding:16, borderRadius:8, fontSize:16,
          fontFamily:serif, fontStyle:"italic",
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom:20, transition:"all 0.2s",
          letterSpacing:0.5,
          boxShadow: loading ? "none" : `0 0 20px rgba(${profile.hex},0.15)`,
        }}
      >
        {loading ? `⟳ ${step || "Routing to Quant Engine..."}` : `${profile.icon} Execute MasterBrain Analysis →`}
      </button>

      {/* ERROR */}
      {error && (
        <div style={{ background:"rgba(255,45,85,0.1)", border:"1px solid #ff2d55", color:"#ff2d55", padding:12, borderRadius:8, marginBottom:20, fontSize:12 }}>
          ⚠ {error}
        </div>
      )}

      {/* LOADING BRAIN */}
      {loading && <LoadingBrain step={step} />}

      {/* RESULTS — SUPPRESSED SIGNAL */}
      {result && result.signal === "SUPPRESSED" && !loading && !error && (
        <div style={{ animation:"fadeIn 0.5s ease" }}>
          <div style={{ background:"rgba(255,45,85,0.06)", border:"2px solid rgba(255,45,85,0.4)", borderRadius:14, padding:"20px 16px", marginBottom:14 }}>
            <div style={{ fontSize:8, color:"#ff2d55", letterSpacing:2, marginBottom:8, fontWeight:700 }}>◆ SIGNAL ENGINE DECISION</div>
            <div style={{ fontSize:22, fontWeight:900, color:"#ff2d55", fontFamily:mono, marginBottom:8, lineHeight:1.2 }}>
              {result.suppression_message || "SIGNAL SUPPRESSED"}
            </div>
            <div style={{ fontSize:11, color:"#6b7a99", marginBottom:16, lineHeight:1.6 }}>
              The CLVR Signal Suppression Engine blocked this signal before AI analysis. Capital preservation takes priority — no trade is better than a bad trade.
            </div>
            {result.suppression_rules?.length > 0 && (
              <div>
                <div style={{ fontSize:8, color:"#ff2d55", letterSpacing:1.5, marginBottom:8, fontWeight:700 }}>RULES TRIGGERED:</div>
                {result.suppression_rules.map((rule, i) => (
                  <div key={i} style={{
                    background:"rgba(255,45,85,0.04)", border:"1px solid rgba(255,45,85,0.2)",
                    borderRadius:8, padding:"8px 12px", marginBottom:6,
                    display:"flex", gap:10, alignItems:"flex-start",
                  }}>
                    <span style={{ fontSize:10, color:"#ff2d55", fontWeight:700, flexShrink:0 }}>R{rule.id}</span>
                    <div>
                      <div style={{ fontSize:9, color:"#e8e8f0", fontWeight:700 }}>{rule.name}</div>
                      <div style={{ fontSize:8, color:"#6b7a99", marginTop:2 }}>{rule.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop:14, padding:"10px 12px", background:"rgba(212,175,55,0.04)", border:"1px solid rgba(212,175,55,0.15)", borderRadius:8 }}>
              <div style={{ fontSize:8, color:"#d4af37", letterSpacing:1, marginBottom:4 }}>BAYESIAN SCORE AT SUPPRESSION</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#d4af37", fontFamily:mono }}>{result.win_probability}% — {result.bayesian?.interpretation || "N/A"}</div>
              <div style={{ fontSize:8, color:"#3a4560", marginTop:3 }}>Signal would need ≥80% conviction after rule adjustments to proceed</div>
            </div>
          </div>
          {result.bayesian && <BayesianMeter probability={result.win_probability} tier={result.conviction_tier || result.bayesian.tier} interpretation={result.bayesian.interpretation} />}
          {result.multi_tf && <MultiTFStrip multiTf={result.multi_tf} />}
          <FearGreedPanel fng={result.fear_greed} />
        </div>
      )}

      {/* RESULTS — NORMAL SIGNAL */}
      {result && result.signal !== "SUPPRESSED" && !loading && !error && (
        <div style={{ animation:"fadeIn 0.5s ease" }}>

          {/* Macro Kill Switch Warning */}
          <MacroKillBanner macroKillSwitch={result.macro_kill_switch} />

          {/* Active Suppression Flags (soft rules — DOWNGRADE / FLAG) */}
          {result.suppression?.triggered?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              {result.suppression.triggered.map((rule, i) => (
                <div key={i} style={{
                  background: rule.action === "DOWNGRADE" ? "rgba(245,158,11,0.06)" : "rgba(0,229,255,0.04)",
                  border:`1px solid ${rule.action === "DOWNGRADE" ? "rgba(245,158,11,0.3)" : "rgba(0,229,255,0.2)"}`,
                  borderRadius:8, padding:"8px 12px", marginBottom:6,
                  display:"flex", gap:8, alignItems:"flex-start",
                }}>
                  <span style={{ fontSize:14, flexShrink:0 }}>{rule.action === "DOWNGRADE" ? "⚠️" : "🔵"}</span>
                  <div>
                    <div style={{ fontSize:8, fontWeight:700, color: rule.action === "DOWNGRADE" ? "#f59e0b" : "#00e5ff" }}>
                      RULE {rule.id} — {rule.name}
                    </div>
                    <div style={{ fontSize:8, color:"#6b7a99", marginTop:2 }}>{rule.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bayesian Confidence Meter + Conviction Tier */}
          {result.bayesian && (
            <BayesianMeter
              probability={result.bayesian.probability}
              tier={result.conviction_tier || result.bayesian.tier}
              interpretation={result.bayesian.interpretation}
            />
          )}

          {/* Multi-Timeframe Confluence */}
          {result.multi_tf && <MultiTFStrip multiTf={result.multi_tf} />}

          {/* Fear & Greed */}
          <FearGreedPanel fng={result.fear_greed} />

          {/* Pattern Recognition */}
          <PatternPanel patterns={result.patterns} />

          {/* Bayesian Active Signals */}
          {result.bayesian?.signals_used?.length > 0 && (
            <div style={{ marginBottom:12, display:"flex", flexWrap:"wrap", gap:5 }}>
              {result.bayesian.signals_used.map((sig, i) => (
                <span key={i} style={{
                  background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)",
                  borderRadius:4, padding:"3px 8px", fontSize:8, color:"#00ff88",
                }}>
                  ✓ {sig.replace(/_/g," ")}
                </span>
              ))}
            </div>
          )}

          {/* Signal header */}
          <div style={{
            background:`rgba(${result.signal?.includes("LONG")?"0,255,136":result.signal?.includes("SHORT")?"255,45,85":"245,158,11"},0.06)`,
            border:`1px solid ${sigCol}40`,
            borderRadius:14, padding:"18px 16px", marginBottom:14,
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
              <div>
                <div style={{ fontSize:9, color:"#6b7a99", marginBottom:4 }}>
                  {RISK_PROFILES[risk].label} · {TIMEFRAMES[tf].label} · {asset} {market}
                </div>
                <div style={{ fontSize:28, fontWeight:"bold", color:sigCol, fontFamily:mono }}>
                  {result.signal?.replace(/_/g," ")}
                </div>
                <div style={{ fontSize:8, color:"#3a4560", marginTop:3 }}>
                  Generated {new Date().toLocaleTimeString()} · HL Perps Live
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"#6b7a99", marginBottom:3 }}>AI WIN PROBABILITY</div>
                <div style={{ fontSize:32, fontWeight:"bold", color:sigCol, fontFamily:mono, lineHeight:1 }}>
                  {result.win_probability}<span style={{ fontSize:18 }}>%</span>
                </div>
                {result.opportunity_score && (
                  <div style={{ fontSize:8, color:"#3a4560", marginTop:3 }}>
                    opportunity: {result.opportunity_score}/100
                  </div>
                )}
              </div>
            </div>
            <div style={{ height:4, background:"rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${result.win_probability}%`, background:`linear-gradient(90deg,${sigCol}50,${sigCol})`, borderRadius:3, transition:"width 1.5s ease" }}/>
            </div>
          </div>

          {/* Signal Validation Gate Panel */}
          {(result.adjusted_score != null || result.ev != null) && (
            <div style={{ background:"rgba(212,175,55,0.03)", border:"1px solid rgba(212,175,55,0.15)", borderRadius:12, padding:"13px 14px", marginBottom:12 }}>
              <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:11, fontWeight:700 }}>◆ SIGNAL VALIDATION GATE</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:7, padding:"8px 10px" }}>
                  <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>ADJUSTED SCORE</div>
                  <div style={{ fontSize:18, fontWeight:900, color: result.adjusted_score >= 85 ? "#00ff88" : result.adjusted_score >= 75 ? "#d4af37" : result.adjusted_score >= 65 ? "#f59e0b" : "#ff2d55", fontFamily:mono }}>
                    {result.adjusted_score}
                  </div>
                  <div style={{ fontSize:7, color:"#3a4560" }}>{result.signal_tier || ""}</div>
                </div>
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:7, padding:"8px 10px" }}>
                  <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>EXPECTED VALUE</div>
                  <div style={{ fontSize:18, fontWeight:900, color: result.ev > 0 ? "#00ff88" : "#ff2d55", fontFamily:mono }}>
                    {result.ev > 0 ? "+" : ""}{result.ev?.toFixed(3)}%
                  </div>
                  <div style={{ fontSize:7, color:"#3a4560" }}>per trade</div>
                </div>
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:7, padding:"8px 10px" }}>
                  <div style={{ fontSize:7, color:"#6b7a99", letterSpacing:1, marginBottom:4 }}>KELLY f*</div>
                  <div style={{ fontSize:18, fontWeight:900, color:"#d4af37", fontFamily:mono }}>
                    {result.position_size?.kelly_fraction?.toFixed(1)}%
                  </div>
                  <div style={{ fontSize:7, color:"#3a4560" }}>{result.position_size?.tier}</div>
                </div>
              </div>
              {result.position_size && (
                <div style={{ background:"rgba(212,175,55,0.06)", border:"1px solid rgba(212,175,55,0.2)", borderRadius:7, padding:"8px 12px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:8, color:"#d4af37", fontWeight:700, letterSpacing:0.5 }}>📦 POSITION SIZE: {result.position_size.tier}</div>
                    <div style={{ fontSize:8, color:"#6b7a99", marginTop:2 }}>
                      Use max <span style={{ color:"#d4af37", fontWeight:700 }}>{result.position_size.margin_pct}%</span> of margin
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:8, color:"#a0aec0", maxWidth:160, lineHeight:1.4 }}>{result.position_size.rationale}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Entry zone — Fibonacci */}
          {result.entry?.price && (
            <div style={{ background:"rgba(212,175,55,0.06)", border:"1px solid rgba(212,175,55,0.2)", borderRadius:10, padding:"11px 14px", marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontSize:8, color:"#d4af37", letterSpacing:1.5, fontWeight:700 }}>⏳ ENTRY ZONE</div>
                {result.fib_entry && (
                  <div style={{ fontSize:7, color:"#6b7a99", background:"rgba(212,175,55,0.08)", border:"1px solid rgba(212,175,55,0.2)", borderRadius:4, padding:"2px 7px" }}>
                    Fib {result.fib_entry.fib_level}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontSize:20, fontWeight:900, color:"#d4af37", fontFamily:mono }}>{fmtPrice(result.entry.price)}</div>
                <div style={{ textAlign:"right" }}>
                  {result.entry.zone_low && <div style={{ fontSize:9, color:"#6b7a99" }}>{fmtPrice(result.entry.zone_low)} — {fmtPrice(result.entry.zone_high)}</div>}
                  <div style={{ fontSize:7, color:"#3a4560" }}>entry zone</div>
                </div>
              </div>
              {result.fib_entry && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
                  <div style={{ background:"rgba(0,0,0,0.15)", borderRadius:5, padding:"5px 8px" }}>
                    <div style={{ fontSize:7, color:"#6b7a99", marginBottom:2 }}>0.382 CONSERVATIVE</div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#d4af37", fontFamily:mono }}>{fmtPrice(result.fib_entry.conservative)}</div>
                  </div>
                  <div style={{ background:"rgba(0,0,0,0.15)", borderRadius:5, padding:"5px 8px" }}>
                    <div style={{ fontSize:7, color:"#6b7a99", marginBottom:2 }}>0.500 AGGRESSIVE</div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#d4af37", fontFamily:mono }}>{fmtPrice(result.fib_entry.aggressive)}</div>
                  </div>
                </div>
              )}
              <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:result.entry.rationale ? 6 : 0 }}>
                <div style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:5, padding:"4px 8px", fontSize:7, color:"#f59e0b", fontWeight:700 }}>
                  ⏱ ENTER WITHIN {result.fib_entry?.window_min || result.entry.window_min || "4–10"} MIN
                </div>
                <div style={{ background:"rgba(255,45,85,0.07)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:5, padding:"4px 8px", fontSize:7, color:"#ff2d55", fontWeight:700 }}>
                  VOID IF MISSED
                </div>
              </div>
              {result.entry.rationale && (
                <div style={{ fontSize:8, color:"#a0aec0", marginTop:6, lineHeight:1.5 }}>{result.entry.rationale}</div>
              )}
            </div>
          )}

          {/* Trade targets */}
          <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:12, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:12, fontWeight:700 }}>◆ TRADE LEVELS</div>
            <LevelRow
              label={`TP1 — First Target${result.tp1?.size_pct ? ` (${result.tp1.size_pct}% position)` : " (60% position)"}`}
              price={result.tp1?.price}
              color="#00ff88"
              note={result.tp1?.gain_pct ? `+${result.tp1.gain_pct?.toFixed(2)}% · R:R ${result.rr?.toFixed(2)}:1` : `R:R ${result.rr?.toFixed(2)}:1`}
            />
            {result.tp2?.price && (
              <LevelRow
                label={`TP2 — Extended Target${result.tp2?.size_pct ? ` (${result.tp2.size_pct}% position)` : " (30% position)"}`}
                price={result.tp2.price}
                color="#4ade80"
                note={result.tp2.gain_pct ? `+${result.tp2.gain_pct?.toFixed(2)}% · R:R ${result.tp2.rr_ratio?.toFixed(2)}:1` : "extended target"}
              />
            )}
            {result.tp3?.price && (
              <LevelRow
                label="TP3 — Runner (10% position)"
                price={result.tp3.price}
                color="#a78bfa"
                note={result.tp3.gain_pct ? `+${result.tp3.gain_pct?.toFixed(2)}% · R:R ${result.tp3.rr_ratio?.toFixed(2)}:1 · runner` : "runner target"}
              />
            )}
            <LevelRow
              label="Stop Loss"
              price={result.stopLoss?.price}
              color="#ff2d55"
              note={result.stopLoss?.distance_pct ? `-${result.stopLoss.distance_pct?.toFixed(2)}% · ${result.stopLoss.rationale || ""}` : ""}
            />
            {result.tp1?.price && result.stopLoss?.price && (
              <div style={{ marginTop:10, paddingTop:8, borderTop:"1px solid #1a2235", fontSize:8, color:"#6b7a99", lineHeight:1.8 }}>
                <span style={{ color:"#00ff88" }}>✓ TP1 hit</span> → move SL to entry (breakeven) ·{" "}
                <span style={{ color:"#4ade80" }}>✓ Halfway to TP2</span> → trail SL to TP1 level
              </div>
            )}
          </div>

          {/* Leverage + Hold Timers */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            <div style={{ background:`rgba(${profile.hex},0.08)`, border:`1px solid rgba(${profile.hex},0.2)`, borderRadius:10, padding:"13px 14px" }}>
              <div style={{ fontSize:8, color:"#3a4560", marginBottom:5 }}>RECOMMENDED LEVERAGE</div>
              <div style={{ fontSize:26, fontWeight:900, color:profile.color, fontFamily:mono }}>
                {result.leverage?.recommended || profile.leverage[0]}x
              </div>
              <div style={{ fontSize:8, color:"#6b7a99", marginTop:3 }}>
                max {result.leverage?.max || profile.leverage[1]}x · {profile.riskPct}% risk/trade
              </div>
              {result.leverage?.rationale && (
                <div style={{ fontSize:8, color:"#a0aec0", marginTop:7, lineHeight:1.5 }}>{result.leverage.rationale}</div>
              )}
            </div>
            <div style={{ background:"rgba(0,229,255,0.06)", border:"1px solid rgba(0,229,255,0.2)", borderRadius:10, padding:"13px 14px" }}>
              <div style={{ fontSize:8, color:"#3a4560", marginBottom:6, letterSpacing:2 }}>HOLD DURATION</div>

              {/* Strategic horizon — always shown prominently */}
              <div style={{ fontSize:14, fontWeight:900, color:"#00e5ff", fontFamily:mono, lineHeight:1.3, marginBottom:6 }}>
                {result.hold?.duration || "Monitor actively"}
              </div>

              {/* Tactical minute timers — supplementary, only when present */}
              {result.hold?.target_exit_min && (
                <>
                  <div style={{ fontSize:7, color:"#6b7a99", marginBottom:5, letterSpacing:1 }}>TACTICAL EXIT WINDOWS</div>
                  <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                    <div style={{ flex:1, background:"rgba(0,229,255,0.06)", border:"1px solid rgba(0,229,255,0.2)", borderRadius:5, padding:"4px 7px", textAlign:"center" }}>
                      <div style={{ fontSize:7, color:"#6b7a99", marginBottom:2 }}>⏱ TARGET EXIT</div>
                      <div style={{ fontSize:13, fontWeight:900, color:"#00e5ff", fontFamily:mono }}>{result.hold.target_exit_min}<span style={{ fontSize:8 }}>m</span></div>
                    </div>
                    <div style={{ flex:1, background:"rgba(255,45,85,0.06)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:5, padding:"4px 7px", textAlign:"center" }}>
                      <div style={{ fontSize:7, color:"#6b7a99", marginBottom:2 }}>🔴 HARD EXIT</div>
                      <div style={{ fontSize:13, fontWeight:900, color:"#ff2d55", fontFamily:mono }}>{result.hold.hard_exit_min}<span style={{ fontSize:8 }}>m</span></div>
                    </div>
                  </div>
                  <div style={{ fontSize:7, color:"#f59e0b", lineHeight:1.4 }}>
                    ⚠ If TP1 not hit within {result.hold.target_exit_min}m → cut 50% immediately
                  </div>
                </>
              )}

              {result.hold?.exit_conditions?.[0] && (
                <div style={{ fontSize:7, color:"#a0aec0", marginTop:6, lineHeight:1.5 }}>
                  Exit if: {result.hold.exit_conditions[0]}
                </div>
              )}
            </div>
          </div>

          {/* Technical summary */}
          {result.technical_summary && (
            <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:12, padding:"14px 16px", marginBottom:12 }}>
              <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ TECHNICAL SUMMARY</div>
              {result.indicators && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:7, marginBottom:10 }}>
                  {[
                    { label:"RSI(14)",  value:`${result.indicators.rsi} · ${result.indicators.rsiLabel}`,  color:result.indicators.rsi>60?"#00ff88":result.indicators.rsi<40?"#ff2d55":"#f59e0b" },
                    { label:"MACD",     value:result.indicators.macdCrossing,                               color:result.indicators.macdCrossing?.includes("BULL")?"#00ff88":"#ff2d55" },
                    { label:"TREND",    value:result.indicators.trend,                                      color:result.indicators.trend?.includes("UP")?"#00ff88":result.indicators.trend?.includes("DOWN")?"#ff2d55":"#f59e0b" },
                    { label:"ATR",      value:`${result.indicators.atrPct?.toFixed(2)}%`,                   color:"#6b7a99" },
                    { label:"VOLUME",   value:result.indicators.volumeSignal,                               color:result.indicators.volumeSignal==="SURGE"?"#00ff88":"#6b7a99" },
                    { label:"MOMENTUM", value:`${result.indicators.momentumScore}/100`,                     color:result.indicators.momentumScore>60?"#00ff88":result.indicators.momentumScore<40?"#ff2d55":"#f59e0b" },
                  ].map(({ label, value, color }) => (
                    <StatBox key={label} label={label} value={value} color={color}/>
                  ))}
                </div>
              )}
              {result.technical_summary?.pattern && (
                <div style={{ background:"rgba(212,175,55,0.06)", border:"1px solid rgba(212,175,55,0.15)", borderRadius:7, padding:"7px 10px", marginBottom:8, fontSize:9, color:"#d4af37" }}>
                  📊 Pattern: {result.technical_summary.pattern}
                </div>
              )}
              <div style={{ fontSize:9, color:"#a0aec0", lineHeight:1.65 }}>
                {result.technical_summary.key_levels}
              </div>
            </div>
          )}

          {/* Quant rationale */}
          {result.quant_rationale && (
            <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:10, padding:"14px 16px", marginBottom:12 }}>
              <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:8, fontWeight:700 }}>◆ QUANT RATIONALE</div>
              <div style={{ fontSize:13, color:"#e8e8f0", lineHeight:1.7 }}>{result.quant_rationale}</div>
            </div>
          )}

          {/* Invalidation + Watch */}
          <div style={{ display:"flex", gap:10, marginBottom:12 }}>
            <div style={{ flex:1, background:"rgba(255,45,85,0.1)", border:"1px solid rgba(255,45,85,0.3)", padding:12, borderRadius:8, fontSize:11, color:"#ff2d55" }}>
              <div style={{ fontWeight:"bold", marginBottom:5, letterSpacing:1 }}>INVALIDATION</div>
              <div style={{ lineHeight:1.6 }}>{result.invalidation || "Technical structure broken"}</div>
            </div>
            <div style={{ flex:1, background:"rgba(0,229,255,0.1)", border:"1px solid rgba(0,229,255,0.3)", padding:12, borderRadius:8, fontSize:11, color:"#00e5ff" }}>
              <div style={{ fontWeight:"bold", marginBottom:5, letterSpacing:1 }}>WATCH FOR</div>
              {result.hold?.key_events?.map((e, i) => (
                <div key={i} style={{ lineHeight:1.6, marginBottom:3 }}>• {e}</div>
              )) || <div style={{ lineHeight:1.6 }}>Monitor price action closely</div>}
            </div>
          </div>

          {/* Risk Flags */}
          {(result.risk_flags?.length > 0 || result.risks?.length > 0) && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:8, fontWeight:700 }}>⚠ RISK FLAGS</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {(result.risk_flags || result.risks || []).map((r, i) => {
                  const isMacro = r.toLowerCase().includes("macro") || r.toLowerCase().includes("fed") || r.toLowerCase().includes("cpi");
                  const isOI    = r.toLowerCase().includes("oi") || r.toLowerCase().includes("interest");
                  const isSess  = r.toLowerCase().includes("session") || r.toLowerCase().includes("weekend") || r.toLowerCase().includes("asia");
                  const col     = isMacro ? "#f59e0b" : isOI ? "#a78bfa" : isSess ? "#00e5ff" : "#f87171";
                  const bg      = isMacro ? "rgba(245,158,11,0.07)" : isOI ? "rgba(167,139,250,0.07)" : isSess ? "rgba(0,229,255,0.07)" : "rgba(255,45,85,0.07)";
                  const border  = isMacro ? "rgba(245,158,11,0.25)" : isOI ? "rgba(167,139,250,0.25)" : isSess ? "rgba(0,229,255,0.25)" : "rgba(255,45,85,0.2)";
                  return (
                    <span key={i} style={{ background:bg, border:`1px solid ${border}`, borderRadius:5, padding:"4px 9px", fontSize:8, color:col }}>
                      ⚠ {r}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize:8, color:"#1a2235", textAlign:"center", lineHeight:1.8 }}>
            © 2025 CLVRQuant · Mike Claver™ · Not financial advice · For informational purposes only
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        textarea:focus { border-color: rgba(212,175,55,0.4) !important; outline: none; }
      `}</style>
    </div>
  );
}
