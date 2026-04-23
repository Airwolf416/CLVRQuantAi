import { useState } from "react";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

function convictionColor(v) {
  if (v >= 65) return "#22c55e";
  if (v >= 40) return "#f59e0b";
  return "#ef4444";
}

function tierLabel(score) {
  if (score >= 90) return { key: "S", color: "#c9a84c", bg: "rgba(201,168,76,0.15)", border: "#c9a84c" };
  if (score >= 80) return { key: "A", color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "#22c55e" };
  if (score >= 70) return { key: "B", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "#f59e0b" };
  return { key: "C", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "#ef4444" };
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch { }
}

export default function SignalCard({ ticker, result, rank, mode }) {
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!result || result.signal === "SUPPRESSED") return null;

  const isLong = result.signal?.includes("LONG");
  const borderColor = result.kronos ? "#c9a84c" : isLong ? "#22c55e" : "#ef4444";
  const dirColor = isLong ? "#22c55e" : "#ef4444";

  const winProb = result.win_probability || result.adjusted_score || 75;
  const tier = tierLabel(winProb);
  const cColor = convictionColor(winProb);

  const entry = result.entry?.price;
  const tp1 = result.tp1?.price;
  const tp2 = result.tp2?.price;
  const sl = result.stopLoss?.price;
  const rr = result.rr || (entry && tp1 && sl ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : null);
  const leverage = result.leverage?.recommended || result.leverage?.max || result.leverage?.min || "—";
  const duration = result.hold?.duration || result.hold || "—";

  const fmtP = (p) => {
    if (!p && p !== 0) return "—";
    const n = Number(p);
    if (isNaN(n)) return "—";
    if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return "$" + n.toFixed(2);
    return "$" + n.toFixed(6);
  };

  const handleCopy = () => {
    const txt = `${ticker} ${isLong ? "LONG" : "SHORT"} | Entry: ${fmtP(entry)} | TP1: ${fmtP(tp1)} | SL: ${fmtP(sl)} | LEV: ${leverage}x`;
    copyToClipboard(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-testid={`signal-card-${ticker}`} style={{
      background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)",
      borderLeft: `4px solid ${borderColor}`, borderRadius: 12, overflow: "hidden",
    }}>
      {result.kronos && (
        <div style={{ background: "rgba(201,168,76,0.08)", padding: "4px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
          <span style={{ fontSize: 10 }}>⚡</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#c9a84c", fontFamily: MONO, letterSpacing: "0.1em" }}>KRONOS — HIGH CONVICTION</span>
        </div>
      )}

      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#e0e0e0", fontFamily: MONO }}>#{rank + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#e0e0e0", fontFamily: SERIF }}>{ticker}/USDT</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: dirColor,
              background: `${dirColor}15`, border: `1px solid ${dirColor}40`,
              borderRadius: 6, padding: "3px 10px", fontFamily: MONO,
            }}>{isLong ? "↑ LONG" : "↓ SHORT"}</span>
            {tier.key && (
              <div style={{
                fontSize: 14, fontWeight: 900, color: tier.color,
                background: tier.bg, border: `2px solid ${tier.border}`,
                borderRadius: 6, width: 30, height: 30,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{tier.key}</div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${winProb}%`, background: `linear-gradient(90deg, ${cColor}80, ${cColor})`, borderRadius: 3, transition: "width 1.2s ease" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: cColor, fontFamily: MONO }}>{winProb}%</span>
        </div>
      </div>

      {result.hardening?.adjustments?.length > 0 && (
        <div data-testid={`hardening-badges-${ticker}`} style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {result.hardening.adjustments.map((a, i) => {
            const palette = a.type === "atr_widened"        ? { fg: "#22c55e", bg: "rgba(34,197,94,0.10)",  bd: "#22c55e55", label: "ATR-adjusted SL" }
                          : a.type === "size_reduced"       ? { fg: "#f59e0b", bg: "rgba(245,158,11,0.10)", bd: "#f59e0b55", label: `Size ${Math.round((a.after ?? 1) * 100)}%` }
                          : a.type === "liquidity_shifted"  ? { fg: "#22c55e", bg: "rgba(34,197,94,0.10)",  bd: "#22c55e55", label: "Liquidity-shifted SL" }
                          : a.type === "conviction_penalty" ? { fg: "#f59e0b", bg: "rgba(245,158,11,0.10)", bd: "#f59e0b55", label: "Counter-trend −15" }
                          :                                   { fg: "#e0e0e0", bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.10)", label: a.type };
            return (
              <span key={i} title={a.detail} style={{
                fontSize: 9, fontWeight: 700, color: palette.fg, background: palette.bg,
                border: `1px solid ${palette.bd}`, borderRadius: 4, padding: "2px 7px",
                fontFamily: MONO, letterSpacing: "0.04em", textTransform: "uppercase",
              }}>{palette.label}</span>
            );
          })}
        </div>
      )}

      {entry && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {[
            { label: "ENTRY", value: fmtP(entry), color: "#c9a84c" },
            { label: "TP1 🎯", value: fmtP(tp1), color: "#22c55e" },
            { label: "TP2", value: fmtP(tp2), color: "#22c55eaa" },
            { label: "SL 🛑", value: fmtP(sl), color: "#ef4444" },
          ].map((item, i) => (
            <div key={item.label} style={{ padding: "8px 10px", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.04)" : "none", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 3 }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: item.color, fontFamily: MONO }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ padding: "8px", borderRight: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>LEVERAGE</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#e0e0e0", fontFamily: MONO }}>{leverage}x</div>
        </div>
        <div style={{ padding: "8px", borderRight: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>R:R</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: rr >= 2 ? "#22c55e" : rr >= 1.5 ? "#f59e0b" : "#ef4444", fontFamily: MONO }}>{rr ? `${rr.toFixed ? rr.toFixed(1) : rr}:1` : "—"}</div>
          {result.rrAfterFriction !== undefined && result.rrAfterFriction !== null && (
            <div title="R:R after slippage + funding cost" style={{ fontSize: 8, color: "rgba(255,255,255,0.45)", fontFamily: MONO, marginTop: 2 }}>
              net {Number(result.rrAfterFriction).toFixed(2)}:1
            </div>
          )}
        </div>
        <div style={{ padding: "8px", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>DURATION</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#00d4ff", fontFamily: MONO }}>{duration}</div>
        </div>
      </div>

      {result.quant_rationale && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 10, color: "#e0e0e0", fontFamily: SANS, fontStyle: "italic", lineHeight: 1.7 }}>{result.quant_rationale}</div>
        </div>
      )}

      {result.invalidation && mode === "pro" && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ fontSize: 10, flexShrink: 0 }}>❌</span>
          <div style={{ fontSize: 9, color: "#ef4444", fontFamily: SANS, lineHeight: 1.6 }}>{result.invalidation}</div>
        </div>
      )}

      {mode === "pro" && (result.indicators || result.multi_tf || result.bayesian) && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button data-testid={`btn-detail-${ticker}`} onClick={() => setDetailExpanded(d => !d)} style={{ width: "100%", background: "transparent", border: "none", padding: "7px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>Advanced Quant Detail</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{detailExpanded ? "▾" : "▸"}</span>
          </button>
          {detailExpanded && (
            <div style={{ padding: "0 12px 12px" }}>
              {result.indicators && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                  {[
                    { label: "RSI(14)", value: result.indicators.rsi, color: result.indicators.rsi > 60 ? "#22c55e" : result.indicators.rsi < 40 ? "#ef4444" : "#f59e0b" },
                    { label: "TREND", value: result.indicators.trend || "—", color: "rgba(255,255,255,0.5)" },
                    { label: "MOM", value: `${result.indicators.momentumScore || "—"}/100`, color: "rgba(255,255,255,0.5)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color, fontFamily: MONO }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
              {result.bayesian && (
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO, marginBottom: 4 }}>
                  Bayesian: {result.bayesian.probability}% ({result.bayesian.tier || result.conviction_tier})
                </div>
              )}
              {result.multi_tf && (
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>
                  Multi-TF: {Object.entries(result.multi_tf).map(([tf, v]) => `${tf}: ${v?.trend || v}`).join(" | ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <button data-testid={`btn-copy-${ticker}`} onClick={handleCopy} style={{ padding: "10px 8px", background: "transparent", border: "none", borderRight: "1px solid rgba(201,168,76,0.08)", color: copied ? "#22c55e" : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}>
          {copied ? "✓ Copied!" : "📋 Copy Trade"}
        </button>
        <button data-testid={`btn-alert-${ticker}`} style={{ padding: "10px 8px", background: "transparent", border: "none", color: "#c9a84c", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}>
          ⏰ Set Alert
        </button>
      </div>
    </div>
  );
}

export function SuppressedSignal({ ticker, result }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid={`suppressed-card-${ticker}`} style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
      <div data-testid={`btn-expand-suppressed-${ticker}`} onClick={() => setExpanded(!expanded)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", fontFamily: MONO }}>🛑 {ticker}</span>
          <span style={{ fontSize: 8, color: "#ef444488" }}>SUPPRESSED</span>
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {result?.suppression_message && <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO, lineHeight: 1.5 }}>{result.suppression_message}</div>}
          {result?.suppression_rules?.length > 0 && (
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {result.suppression_rules.slice(0, 3).map((r, i) => (
                <span key={i} style={{ fontSize: 7, color: "#ef4444", background: "rgba(239,68,68,0.08)", borderRadius: 3, padding: "2px 6px", fontFamily: MONO }}>R{r.id}: {r.name}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
