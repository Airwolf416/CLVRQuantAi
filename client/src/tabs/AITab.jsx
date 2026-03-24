import { useState } from "react";
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
    tpRatios:[2.0, 4.0],
  },
  mid: {
    id:"mid", label:"BALANCED", icon:"⚖",
    color:"#f59e0b", hex:"245,158,11",
    desc:"Standard quant · Risk/reward optimized",
    slMultiplier:1.8, leverage:[3,7], riskPct:2, minWinProb:80,
    tpRatios:[1.5, 3.0],
  },
  high: {
    id:"high", label:"AGGRESSIVE", icon:"⚡",
    color:"#ff2d55", hex:"255,45,85",
    desc:"Tight stops · High leverage · Max upside",
    slMultiplier:1.2, leverage:[5,15], riskPct:4, minWinProb:75,
    tpRatios:[1.2, 2.5],
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

  const twitterData = useTwitterIntelligence();

  const handleAnalyze = async () => {
    if (!asset) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      setStep("Fetching candle history...");
      const twitterCtx = buildAssetTwitterContext(twitterData, asset);

      setStep("Running quant analysis...");
      const response = await fetch("/api/quant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
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

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Analysis failed (${response.status}): ${txt}`);
      }

      const data = await response.json();

      if (!data.signal || !data.win_probability || !data.entry?.price) {
        throw new Error("Incomplete data from Quant Engine.");
      }

      if (data.rr === undefined && data.tp1?.price && data.stopLoss?.price && data.entry?.price) {
        const risk_amt   = Math.abs(data.entry.price - data.stopLoss.price);
        const reward_amt = Math.abs(data.tp1.price   - data.entry.price);
        data.rr = risk_amt > 0.000001 ? reward_amt / risk_amt : 0;
      }

      setResult(data);
    } catch (err) {
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

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #1a2235", paddingBottom:15, marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontFamily:serif, color:"#e8e8f0" }}>CLVRQuant AI</h2>
          <div style={{ fontSize:8, color:"#3a4560", letterSpacing:1.5, marginTop:3 }}>ELITE QUANT ENGINE · HL + BINANCE + TWITTER INTELLIGENCE</div>
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

      {/* STEP 2: ASSET PILLS */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:8, color:"#d4af37", letterSpacing:2, marginBottom:10, fontWeight:700 }}>◆ STEP 2 — SELECT ASSET</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {ASSETS.map(a => {
            const cls    = ASSET_CLASS(a);
            const clsCol = cls==="equity"?"#3b82f6":cls==="commodity"?"#d4af37":"#9945ff";
            const active = asset === a;
            return (
              <button key={a} onClick={() => setAsset(a)} style={{
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
        <button onClick={() => setMarket("PERP")} style={{
          background: market==="PERP" ? "rgba(0,229,255,0.1)" : "transparent",
          border:`1px solid ${market==="PERP" ? "#00e5ff" : "#1a2235"}`,
          color: market==="PERP" ? "#00e5ff" : "#6b7a99",
          padding:12, borderRadius:6, cursor:"pointer", fontWeight:"bold", fontSize:12,
        }}>📊 PERP Markets</button>
        <button onClick={() => setMarket("SPOT")} style={{
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
              <button key={t.id} onClick={() => setTf(t.id)} style={{
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
        {loading ? `⟳ ${step || "Routing to Quant Engine..."}` : `${profile.icon} Execute Quant Analysis →`}
      </button>

      {/* ERROR */}
      {error && (
        <div style={{ background:"rgba(255,45,85,0.1)", border:"1px solid #ff2d55", color:"#ff2d55", padding:12, borderRadius:8, marginBottom:20, fontSize:12 }}>
          ⚠ {error}
        </div>
      )}

      {/* RESULTS */}
      {result && !loading && !error && (
        <div style={{ animation:"fadeIn 0.5s ease" }}>

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
                <div style={{ fontSize:9, color:"#6b7a99", marginBottom:3 }}>WIN PROBABILITY</div>
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

          {/* Entry zone */}
          {result.entry?.zone_low && (
            <div style={{ background:"rgba(212,175,55,0.06)", border:"1px solid rgba(212,175,55,0.2)", borderRadius:10, padding:"11px 14px", marginBottom:12 }}>
              <div style={{ fontSize:8, color:"#d4af37", letterSpacing:1.5, marginBottom:5 }}>ENTRY ZONE</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:20, fontWeight:900, color:"#d4af37", fontFamily:mono }}>{fmtPrice(result.entry.price)}</div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:9, color:"#6b7a99" }}>{fmtPrice(result.entry.zone_low)} — {fmtPrice(result.entry.zone_high)}</div>
                  <div style={{ fontSize:7, color:"#3a4560" }}>entry zone</div>
                </div>
              </div>
              {result.entry.rationale && (
                <div style={{ fontSize:8, color:"#a0aec0", marginTop:5, lineHeight:1.5 }}>{result.entry.rationale}</div>
              )}
            </div>
          )}

          {/* Trade targets */}
          <div style={{ background:"#0d1321", border:"1px solid #1a2235", borderRadius:12, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ fontSize:9, color:"#d4af37", letterSpacing:2, marginBottom:12, fontWeight:700 }}>◆ TRADE LEVELS</div>
            <LevelRow
              label="TP1 — First Target"
              price={result.tp1?.price}
              color="#00ff88"
              note={result.tp1?.gain_pct ? `+${result.tp1.gain_pct?.toFixed(2)}% · R:R ${result.rr?.toFixed(2)}:1` : `R:R ${result.rr?.toFixed(2)}:1`}
            />
            {result.tp2?.price && (
              <LevelRow
                label="TP2 — Final Target"
                price={result.tp2.price}
                color="#4ade80"
                note={result.tp2.gain_pct ? `+${result.tp2.gain_pct?.toFixed(2)}% · R:R ${result.tp2.rr_ratio?.toFixed(2)}:1` : "final target"}
              />
            )}
            <LevelRow
              label="Stop Loss"
              price={result.stopLoss?.price}
              color="#ff2d55"
              note={result.stopLoss?.distance_pct ? `-${result.stopLoss.distance_pct?.toFixed(2)}% · ${result.stopLoss.rationale || ""}` : ""}
            />
          </div>

          {/* Leverage + Hold */}
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
              <div style={{ fontSize:8, color:"#3a4560", marginBottom:5 }}>HOLD DURATION</div>
              <div style={{ fontSize:13, fontWeight:800, color:"#00e5ff", fontFamily:mono, lineHeight:1.3 }}>
                {result.hold?.duration || result.hold_duration || "Monitor actively"}
              </div>
              {result.hold?.exit_conditions?.[0] && (
                <div style={{ fontSize:8, color:"#a0aec0", marginTop:7, lineHeight:1.5 }}>
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

          {/* Risks */}
          {result.risks && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
              {result.risks.map((r, i) => (
                <span key={i} style={{ background:"rgba(255,45,85,0.07)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:5, padding:"3px 9px", fontSize:8, color:"#f87171" }}>
                  ⚠ {r}
                </span>
              ))}
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
