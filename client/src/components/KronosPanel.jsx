import { useState } from "react";

const mono  = "'IBM Plex Mono', monospace";
const serif = "'Playfair Display', serif";

const KRONOS_ASSETS = ["BTC","ETH","SOL","HYPE","DOGE","AVAX","XRP","LINK","NVDA","TSLA","XAU","CL"];
const KRONOS_TFS = [
  { id:"15m", label:"15m" },
  { id:"1h",  label:"1H"  },
  { id:"4h",  label:"4H"  },
  { id:"1d",  label:"1D"  },
];

const SIG_COLOR = {
  STRONG_LONG:  "#00ff88",
  LONG:         "#4ade80",
  NEUTRAL:      "#f59e0b",
  SHORT:        "#f87171",
  STRONG_SHORT: "#ff2d55",
};

const SIG_LABEL = {
  STRONG_LONG:  "⬆ STRONG LONG",
  LONG:         "↑ LONG",
  NEUTRAL:      "→ NEUTRAL",
  SHORT:        "↓ SHORT",
  STRONG_SHORT: "⬇ STRONG SHORT",
};

const VOL_COLOR = {
  LOW:      "#4ade80",
  MODERATE: "#f59e0b",
  HIGH:     "#f97316",
  EXTREME:  "#ff2d55",
};

function MiniSparkline({ prices, color }) {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={w} cy={h - ((prices[prices.length - 1] - min) / range) * h} r={2.5} fill={color} />
    </svg>
  );
}

function TrajectoryCard({ traj, color, label, icon, currentPrice }) {
  if (!traj) return null;
  const pct = traj.final_pct_change ?? 0;
  const pctStr = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
  return (
    <div style={{
      background: `${color}09`,
      border: `1px solid ${color}33`,
      borderRadius: 8,
      padding: "10px 11px",
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <div style={{ fontSize:9, fontWeight:800, color, fontFamily:mono, letterSpacing:1 }}>
          {icon} {label}
        </div>
        <div style={{
          fontSize:9, fontWeight:800, fontFamily:mono,
          color: pct > 0 ? "#00ff88" : pct < 0 ? "#ff2d55" : "#f59e0b",
          background: pct > 0 ? "rgba(0,255,136,.08)" : pct < 0 ? "rgba(255,45,85,.08)" : "rgba(245,158,11,.08)",
          border: `1px solid ${pct > 0 ? "rgba(0,255,136,.25)" : pct < 0 ? "rgba(255,45,85,.25)" : "rgba(245,158,11,.25)"}`,
          borderRadius:3, padding:"2px 6px",
        }}>
          {pctStr}
        </div>
      </div>
      <MiniSparkline prices={traj.prices} color={color} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:5 }}>
        <div style={{ fontSize:8, color:"#6b7a99", fontFamily:mono }}>
          P({Math.round(traj.probability)}%)
        </div>
        <div style={{ fontSize:10, fontWeight:900, color, fontFamily:mono }}>
          ${traj.prices?.[4]?.toLocaleString("en-US", { maximumFractionDigits:2 }) ?? "—"}
        </div>
      </div>
      {traj.catalyst && (
        <div style={{ marginTop:5, fontSize:7, color:"#3a4560", fontFamily:mono, lineHeight:1.5, borderTop:"1px solid rgba(255,255,255,0.04)", paddingTop:5 }}>
          {traj.catalyst}
        </div>
      )}
    </div>
  );
}

export default function KronosPanel({ defaultAsset = "BTC" }) {
  const [asset,   setAsset]   = useState(defaultAsset);
  const [tf,      setTf]      = useState("4h");
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const [open,    setOpen]    = useState(false);

  const handleForecast = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/kronos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticker: asset, timeframe: tf }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Kronos Engine failed (${res.status}): ${txt}`);
      }
      const data = await res.json();
      if (!data.trajectories || !data.ensemble_signal) throw new Error("Incomplete Kronos response");
      setResult(data);
      setOpen(true);
      // ── Publish latest forecast to a window-level cache so TopTradeIdeas can feed it to Claude ──
      try {
        if (typeof window !== "undefined") {
          if (!window.__clvrKronosCache) window.__clvrKronosCache = {};
          window.__clvrKronosCache[asset] = {
            ts: Date.now(),
            timeframe: tf,
            ensemble_signal: data.ensemble_signal,
            volatility_regime: data.volatility_forecast?.regime,
            annualized_vol_pct: data.volatility_forecast?.annualized_pct,
            next_candle_range_pct: data.volatility_forecast?.next_candle_range_pct,
            trajectories_summary: {
              bull: data.trajectories?.bull?.[data.trajectories?.bull?.length - 1]?.close,
              base: data.trajectories?.base?.[data.trajectories?.base?.length - 1]?.close,
              bear: data.trajectories?.bear?.[data.trajectories?.bear?.length - 1]?.close,
            },
          };
        }
      } catch { /* ignore cache errors */ }
    } catch (err) {
      setError(err.message || "Kronos Engine error");
    } finally {
      setLoading(false);
    }
  };

  const ensigCol = result ? (SIG_COLOR[result.ensemble_signal] || "#f59e0b") : "#f59e0b";
  const volCol   = result ? (VOL_COLOR[result.volatility_forecast?.regime] || "#f59e0b") : "#f59e0b";

  return (
    <div style={{
      background: "rgba(10,15,30,0.6)",
      border: "1px solid rgba(90,60,200,0.25)",
      borderRadius: 10,
      marginBottom: 12,
      overflow: "hidden",
    }}>
      {/* Header row (always visible) */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"10px 14px", cursor:"pointer",
          borderBottom: open ? "1px solid rgba(90,60,200,0.2)" : "none",
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{
            width:22, height:22, borderRadius:5,
            background:"rgba(90,60,200,0.2)", border:"1px solid rgba(90,60,200,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:11,
          }}>⏱</div>
          <div>
            <div style={{ fontSize:9, fontWeight:800, color:"#9b8cff", fontFamily:mono, letterSpacing:1.5 }}>
              KRONOS FORECAST ENGINE
            </div>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, marginTop:1 }}>
              Multi-trajectory K-line forecasting · Inspired by AAAI 2026 research
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {result && !loading && (
            <div style={{
              fontSize:9, fontWeight:800, fontFamily:mono, color:ensigCol,
              background:`${ensigCol}12`, border:`1px solid ${ensigCol}33`,
              borderRadius:3, padding:"2px 7px", letterSpacing:0.5,
            }}>
              {SIG_LABEL[result.ensemble_signal] || result.ensemble_signal}
            </div>
          )}
          <div style={{ fontSize:10, color:"#3a4560" }}>{open ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Collapsible body */}
      {open && (
        <div style={{ padding:"12px 14px" }}>
          {/* Controls */}
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1 }}>
              {KRONOS_ASSETS.map(a => (
                <button
                  key={a}
                  data-testid={`kronos-asset-${a}`}
                  onClick={() => { setAsset(a); setResult(null); }}
                  style={{
                    background: asset === a ? "rgba(155,140,255,0.12)" : "transparent",
                    border: `1px solid ${asset === a ? "rgba(155,140,255,0.5)" : "#1a2235"}`,
                    color: asset === a ? "#9b8cff" : "#6b7a99",
                    padding:"4px 10px", borderRadius:4,
                    cursor:"pointer", fontFamily:mono, fontSize:9, fontWeight: asset === a ? 800 : 400,
                  }}
                >{a}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {KRONOS_TFS.map(t => (
                <button
                  key={t.id}
                  data-testid={`kronos-tf-${t.id}`}
                  onClick={() => { setTf(t.id); setResult(null); }}
                  style={{
                    background: tf === t.id ? "rgba(155,140,255,0.12)" : "transparent",
                    border: `1px solid ${tf === t.id ? "rgba(155,140,255,0.5)" : "#1a2235"}`,
                    color: tf === t.id ? "#9b8cff" : "#6b7a99",
                    padding:"4px 10px", borderRadius:4,
                    cursor:"pointer", fontFamily:mono, fontSize:9, fontWeight: tf === t.id ? 800 : 400,
                  }}
                >{t.label}</button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            data-testid="btn-run-kronos"
            onClick={handleForecast}
            disabled={loading}
            style={{
              width:"100%",
              background: loading ? "rgba(155,140,255,0.03)" : "rgba(155,140,255,0.08)",
              border: `1px solid ${loading ? "#1a2235" : "rgba(155,140,255,0.4)"}`,
              color: loading ? "#3a4560" : "#9b8cff",
              padding:"11px 16px", borderRadius:6,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily:serif, fontStyle:"italic", fontSize:14,
              letterSpacing:0.5, marginBottom:14,
              transition:"all 0.2s",
              boxShadow: loading ? "none" : "0 0 18px rgba(155,140,255,0.1)",
            }}
          >
            {loading
              ? "⏳ Kronos Engine running…"
              : result
              ? `⏱ Re-run Kronos Forecast — ${asset} ${tf.toUpperCase()}`
              : `⏱ Run Kronos Forecast — ${asset} ${tf.toUpperCase()} →`}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              background:"rgba(255,45,85,0.08)", border:"1px solid #ff2d55",
              color:"#f87171", padding:"10px 12px", borderRadius:6,
              fontFamily:mono, fontSize:10, marginBottom:12,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <>
              <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                {/* Ensemble signal */}
                <div style={{
                  flex:2, minWidth:120,
                  background:`${ensigCol}10`, border:`1px solid ${ensigCol}35`,
                  borderRadius:8, padding:"10px 12px",
                  display:"flex", flexDirection:"column", gap:4,
                }}>
                  <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5 }}>ENSEMBLE SIGNAL</div>
                  <div style={{ fontSize:16, fontWeight:900, color:ensigCol, fontFamily:mono, letterSpacing:0.5 }}>
                    {SIG_LABEL[result.ensemble_signal] || result.ensemble_signal}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ flex:1, height:4, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden" }}>
                      <div style={{
                        height:"100%", width:`${result.ensemble_confidence || 0}%`,
                        background:`linear-gradient(90deg,${ensigCol}60,${ensigCol})`,
                        borderRadius:2, transition:"width 1s",
                      }} />
                    </div>
                    <span style={{ fontSize:9, fontWeight:800, color:ensigCol, fontFamily:mono }}>
                      {result.ensemble_confidence}%
                    </span>
                  </div>
                </div>

                {/* Volatility */}
                <div style={{
                  flex:1, minWidth:90,
                  background:`${volCol}10`, border:`1px solid ${volCol}35`,
                  borderRadius:8, padding:"10px 12px",
                }}>
                  <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5, marginBottom:4 }}>VOLATILITY</div>
                  <div style={{ fontSize:13, fontWeight:900, color:volCol, fontFamily:mono }}>
                    {result.volatility_forecast?.regime}
                  </div>
                  <div style={{ fontSize:8, color:volCol, fontFamily:mono, marginTop:2, opacity:0.8 }}>
                    {result.volatility_forecast?.annualized_pct?.toFixed(1)}% ann.
                  </div>
                  <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, marginTop:2 }}>
                    ±{result.volatility_forecast?.next_candle_range_pct?.toFixed(2)}% / candle
                  </div>
                </div>

                {/* Key levels */}
                {result.key_levels && (
                  <div style={{
                    flex:1, minWidth:90,
                    background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235",
                    borderRadius:8, padding:"10px 12px",
                  }}>
                    <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5, marginBottom:6 }}>KEY LEVELS</div>
                    <div style={{ fontSize:8, color:"#ff2d55", fontFamily:mono, marginBottom:4 }}>
                      R: ${result.key_levels.resistance?.toLocaleString("en-US", { maximumFractionDigits:2 })}
                    </div>
                    <div style={{ fontSize:8, color:"#00ff88", fontFamily:mono }}>
                      S: ${result.key_levels.support?.toLocaleString("en-US", { maximumFractionDigits:2 })}
                    </div>
                  </div>
                )}
              </div>

              {/* Trajectory header */}
              <div style={{
                fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:2,
                marginBottom:8, paddingTop:4,
              }}>
                ◆ 5-CANDLE TRAJECTORIES — {asset} · {tf.toUpperCase()}
              </div>

              {/* 3 trajectory cards */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                <TrajectoryCard traj={result.trajectories?.bull} color="#00ff88" label="BULL" icon="⬆" currentPrice={result.current_price} />
                <TrajectoryCard traj={result.trajectories?.base} color="#9b8cff" label="BASE" icon="→" currentPrice={result.current_price} />
                <TrajectoryCard traj={result.trajectories?.bear} color="#ff2d55" label="BEAR" icon="⬇" currentPrice={result.current_price} />
              </div>

              {/* ── TRADE PLAN (entry / TP1 / TP2 / SL / leverage / RSI) ── */}
              {result.trade_plan && (() => {
                const tp = result.trade_plan;
                const ind = result.indicators || {};
                const dirIsLong = tp.direction === "LONG";
                const dirIsShort = tp.direction === "SHORT";
                const noTrade = tp.direction === "NO_TRADE" || (!dirIsLong && !dirIsShort);
                const dirCol = noTrade ? "#6b7a99" : dirIsLong ? "#00ff88" : "#ff2d55";
                const rsiVal = ind.rsi;
                const rsiCol = rsiVal >= 70 ? "#ff2d55" : rsiVal <= 30 ? "#00ff88" : "#f59e0b";
                const fmt = (v) => (v == null || Number.isNaN(parseFloat(v)))
                  ? "—"
                  : `$${parseFloat(v).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
                return (
                  <div style={{
                    background: `${dirCol}08`,
                    border: `1px solid ${dirCol}33`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 10,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ fontSize:8, color:"#9b8cff", fontFamily:mono, letterSpacing:1.5, fontWeight:800 }}>
                        ◆ TRADE PLAN
                      </div>
                      <div style={{
                        fontSize:9, fontWeight:800, fontFamily:mono, color: dirCol,
                        background: `${dirCol}12`, border: `1px solid ${dirCol}33`,
                        borderRadius:3, padding:"2px 7px", letterSpacing:0.5,
                      }}>
                        {noTrade ? "⛔ NO TRADE" : dirIsLong ? "⬆ LONG" : "⬇ SHORT"}
                      </div>
                    </div>

                    {/* RSI + leverage strip */}
                    <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                      <div style={{ flex:1, minWidth:90, background:`${rsiCol}10`, border:`1px solid ${rsiCol}33`, borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>RSI(14)</div>
                        <div style={{ fontSize:12, fontWeight:900, color:rsiCol, fontFamily:mono }}>
                          {typeof rsiVal === "number" ? rsiVal.toFixed(1) : "—"}
                        </div>
                        <div style={{ fontSize:7, color:rsiCol, fontFamily:mono, opacity:0.8 }}>
                          {ind.rsi_zone || "—"}
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:90, background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>LEVERAGE</div>
                        <div style={{ fontSize:11, fontWeight:900, color:"#e8c96d", fontFamily:mono }}>
                          {tp.leverage || ind.suggested_leverage || "—"}
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:90, background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>ATR</div>
                        <div style={{ fontSize:11, fontWeight:900, color:"#9b8cff", fontFamily:mono }}>
                          {typeof ind.atr_pct === "number" ? `${ind.atr_pct.toFixed(2)}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {!noTrade && (
                      <>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6, marginBottom:6 }}>
                          <div style={{ background:"rgba(232,201,109,0.06)", border:"1px solid rgba(232,201,109,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>ENTRY</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#e8c96d", fontFamily:mono }}>{fmt(tp.entry)}</div>
                          </div>
                          <div style={{ background:"rgba(255,45,85,0.06)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>STOP LOSS</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#ff2d55", fontFamily:mono }}>{fmt(tp.sl)}</div>
                          </div>
                          <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>TP1 · {tp.rr_tp1 || "—"}</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#00ff88", fontFamily:mono }}>{fmt(tp.tp1)}</div>
                          </div>
                          <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>TP2 · {tp.rr_tp2 || "—"}</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#00ff88", fontFamily:mono }}>{fmt(tp.tp2)}</div>
                          </div>
                        </div>
                        {tp.entry_logic && (
                          <div style={{ fontSize:8, color:"#a0aec0", fontFamily:mono, lineHeight:1.6, marginTop:6 }}>
                            <span style={{ color:"#9b8cff" }}>Entry logic:</span> {tp.entry_logic}
                          </div>
                        )}
                        {tp.invalidation && (
                          <div style={{ fontSize:8, color:"#a0aec0", fontFamily:mono, lineHeight:1.6, marginTop:3 }}>
                            <span style={{ color:"#ff2d55" }}>Invalidation:</span> {tp.invalidation}
                          </div>
                        )}
                      </>
                    )}
                    {tp.notes && (
                      <div style={{ fontSize:8, color:"#6b7a99", fontFamily:mono, lineHeight:1.6, marginTop:5, borderTop:"1px solid rgba(255,255,255,0.04)", paddingTop:5 }}>
                        {tp.notes}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Pattern detected */}
              {result.sequence_pattern && (
                <div style={{
                  background:"rgba(155,140,255,0.05)", border:"1px solid rgba(155,140,255,0.15)",
                  borderRadius:6, padding:"8px 12px", marginBottom:10,
                  display:"flex", gap:8, alignItems:"flex-start",
                }}>
                  <span style={{ fontSize:12 }}>🔍</span>
                  <div>
                    <div style={{ fontSize:8, color:"#9b8cff", fontFamily:mono, fontWeight:700, marginBottom:2, letterSpacing:1 }}>
                      SEQUENCE PATTERN DETECTED
                    </div>
                    <div style={{ fontSize:9, color:"#a0aec0", fontFamily:mono, lineHeight:1.6 }}>
                      {result.sequence_pattern}
                    </div>
                  </div>
                </div>
              )}

              {/* Volatility note */}
              {result.volatility_forecast?.note && (
                <div style={{ fontSize:7, color:"#2a3550", fontFamily:mono, lineHeight:1.6 }}>
                  ◦ {result.volatility_forecast.note}
                </div>
              )}

              {/* Timestamp + disclaimer */}
              <div style={{
                marginTop:10, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.04)",
                display:"flex", justifyContent:"space-between", alignItems:"center",
              }}>
                <div style={{ fontSize:7, color:"#2a3550", fontFamily:mono }}>
                  Kronos-inspired · Claude Sonnet 4 · {result.generated_at ? new Date(result.generated_at).toLocaleTimeString() : "—"}
                </div>
                <div style={{
                  fontSize:7, color:"#9b8cff", fontFamily:mono,
                  background:"rgba(155,140,255,0.08)", border:"1px solid rgba(155,140,255,0.15)",
                  borderRadius:3, padding:"2px 6px",
                }}>
                  AAAI 2026 METHODOLOGY
                </div>
              </div>
            </>
          )}

          {/* Empty state */}
          {!result && !loading && !error && (
            <div style={{
              textAlign:"center", padding:"16px 0",
              fontSize:8, color:"#2a3550", fontFamily:mono, lineHeight:2,
            }}>
              Probabilistic 5-candle forecast · BULL / BASE / BEAR trajectories<br />
              Volatility regime · Ensemble signal · Sequence pattern detection<br />
              <span style={{ color:"#3a4560" }}>Methodology inspired by Kronos (arXiv:2508.02739)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
