import { useState } from "react";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

function convictionColor(v) {
  if (v >= 65) return "#22c55e";
  if (v >= 40) return "#f59e0b";
  return "#ef4444";
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch { }
}

export default function TradeIdeaCard({ trade, rank, mode, isElite, locked, onAlertCreated }) {
  const [copied, setCopied] = useState(false);
  const [alertStatus, setAlertStatus] = useState(null);
  const isLong = trade.direction === "LONG";
  const borderColor = trade.kronos ? "#c9a84c" : isLong ? "#22c55e" : "#ef4444";
  const dirColor = isLong ? "#22c55e" : "#ef4444";
  const dirEmoji = isLong ? "🟢" : "🔴";

  const entry = trade.entry;
  const tp1 = trade.tp1?.price || trade.tp1;
  const sl = trade.sl;
  const tp1Pct = entry && tp1 ? (((tp1 - entry) / entry) * 100).toFixed(1) : null;
  const slPct = entry && sl ? (((sl - entry) / entry) * 100).toFixed(1) : null;
  const rr = trade.tp1?.rr || (entry && tp1 && sl ? `${(Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(1)}:1` : "—");
  const conviction = trade.conviction || 0;
  const cColor = convictionColor(conviction);

  const fmtP = (p) => {
    if (!p && p !== 0) return "—";
    const n = Number(p);
    if (isNaN(n)) return "—";
    if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return "$" + n.toFixed(2);
    return "$" + n.toFixed(6);
  };

  const handleCopy = () => {
    const txt = `${trade.asset} ${trade.direction} | Entry: ${fmtP(entry)} | TP1: ${fmtP(tp1)} | SL: ${fmtP(sl)} | R:R: ${rr}`;
    copyToClipboard(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetAlert = async () => {
    if (alertStatus === "saving" || alertStatus === "done") return;
    if (!entry) return;
    setAlertStatus("saving");
    try {
      const sym = (trade.asset || "").replace(/\/USDT?$/i, "").replace(/\/USD$/i, "").trim();
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sym,
          field: "price",
          condition: isLong ? "<=": ">=",
          threshold: entry,
          label: `${trade.direction} ${sym} entry @ ${fmtP(entry)}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed");
      }
      setAlertStatus("done");
      if (onAlertCreated) onAlertCreated();
      setTimeout(() => setAlertStatus(null), 3000);
    } catch {
      setAlertStatus("error");
      setTimeout(() => setAlertStatus(null), 2500);
    }
  };

  const killClockSimple = (kc) => {
    if (!kc) return "";
    const h = parseInt(kc);
    if (h <= 4) return "Exit within a few hours";
    if (h <= 24) return "Exit by tonight if no move";
    if (h <= 72) return "Hold 1-3 days";
    return `Hold up to ${kc}`;
  };

  return (
    <div
      data-testid={`trade-idea-card-${rank}`}
      style={{
        background: locked ? "#0c1220" : "#0c1220",
        border: "1px solid rgba(201,168,76,0.15)",
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 12,
        overflow: "hidden",
        transition: "box-shadow 0.2s",
        filter: locked ? "blur(6px)" : "none",
        userSelect: locked ? "none" : "auto",
        pointerEvents: locked ? "none" : "auto",
        position: "relative",
      }}
    >
      {trade.kronos && (
        <div style={{ background: "rgba(201,168,76,0.08)", padding: "4px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
          <span style={{ fontSize: 10 }}>⚡</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#c9a84c", fontFamily: MONO, letterSpacing: "0.1em" }}>KRONOS — HIGH CONVICTION</span>
        </div>
      )}

      <div style={{ padding: "14px 14px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "#e0e0e0", fontFamily: MONO }}>#{rank}</span>
              {mode === "pro" && trade.tradeType && (
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>{trade.tradeType}</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#e0e0e0", fontFamily: SERIF }}>{trade.asset}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {mode === "pro" && trade.volRegime && (
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Vol: {trade.volRegime === "HIGH" ? "🔴" : trade.volRegime === "LOW" ? "🟢" : "🟡"} {trade.volRegime}</span>
            )}
            <span style={{
              fontSize: 11, fontWeight: 800, color: dirColor,
              background: `${dirColor}15`, border: `1px solid ${dirColor}40`,
              borderRadius: 6, padding: "4px 10px", fontFamily: MONO,
            }}>
              {dirEmoji} {trade.direction}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 14px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
        <div style={{ display: "grid", gridTemplateColumns: mode === "pro" ? "1fr" : "1fr", gap: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Entry</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#c9a84c", fontFamily: MONO }}>{fmtP(entry)}</span>
          </div>

          {mode === "simple" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Target</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>
                  {fmtP(tp1)}{tp1Pct ? <span style={{ fontSize: 9, marginLeft: 6, color: "#22c55e88" }}>({tp1Pct > 0 ? "+" : ""}{tp1Pct}%)</span> : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Stop</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>
                  {fmtP(sl)}{slPct ? <span style={{ fontSize: 9, marginLeft: 6, color: "#ef444488" }}>({slPct > 0 ? "+" : ""}{slPct}%)</span> : ""}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP1 ({trade.tp1?.pct || 50}%)</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(tp1)} <span style={{ fontSize: 8, color: "#22c55e88" }}>{trade.tp1?.rr || ""}</span></span>
              </div>
              {trade.tp2 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP2 ({trade.tp2?.pct || 30}%)</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(trade.tp2?.price || trade.tp2)} <span style={{ fontSize: 8, color: "#22c55e88" }}>{trade.tp2?.rr || ""}</span></span>
                </div>
              )}
              {trade.tp3 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP3 ({trade.tp3?.pct || 20}%) {trade.tp3?.trailing ? "trail" : ""}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(trade.tp3?.price || trade.tp3)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>SL</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>{fmtP(sl)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>R:R</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#e0e0e0", fontFamily: MONO }}>{rr}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${conviction}%`,
              background: `linear-gradient(90deg, ${cColor}80, ${cColor})`,
              borderRadius: 3, transition: "width 1.2s ease",
            }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: cColor, fontFamily: MONO, minWidth: 32, textAlign: "right" }}>{conviction}%</span>
        </div>

        {mode === "pro" && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {trade.edge && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: MONO }}>Edge: {trade.edge} ({trade.edgeSource || "est"})</span>}
            {trade.leverage && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Lev: {trade.leverage}</span>}
            {trade.killClock && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Kill: {trade.killClock}</span>}
          </div>
        )}

        {mode === "pro" && trade.scores && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, marginTop: 10 }}>
            {Object.entries(trade.scores).map(([k, v]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 2 }}>{k.substring(0, 4).toUpperCase()}</div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${v}%`, height: "100%", background: v >= 65 ? "#22c55e" : v >= 40 ? "#f59e0b" : "#ef4444", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontFamily: MONO, marginTop: 1 }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ fontSize: 11, color: "#e0e0e0", fontFamily: SANS, lineHeight: 1.7 }}>{trade.thesis}</div>

        {mode === "simple" && trade.killClock && (
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: SANS, marginTop: 6 }}>
            ⏱ {killClockSimple(trade.killClock)}
          </div>
        )}

        {mode === "pro" && trade.invalidation && (
          <div style={{ fontSize: 9, color: "#ef4444", fontFamily: SANS, marginTop: 6 }}>
            ✖ {trade.invalidation}
          </div>
        )}
        {mode === "pro" && trade.postTp1 && (
          <div style={{ fontSize: 9, color: "#22c55e", fontFamily: SANS, marginTop: 4 }}>
            ✓ Post-TP1: {trade.postTp1}
          </div>
        )}

        {trade.flags?.length > 0 && mode === "pro" && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {trade.flags.map((f, i) => (
              <span key={i} style={{ fontSize: 7, color: "#ff8c00", fontFamily: MONO, background: "rgba(255,140,0,0.08)", padding: "2px 6px", borderRadius: 3 }}>{f}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: "1px solid rgba(201,168,76,0.08)" }}>
        <button
          data-testid={`btn-copy-trade-${rank}`}
          onClick={handleCopy}
          style={{ padding: "10px 8px", background: "transparent", border: "none", borderRight: "1px solid rgba(201,168,76,0.08)", color: copied ? "#22c55e" : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}
        >
          {copied ? "✓ Copied!" : "📋 Copy Trade"}
        </button>
        <button
          data-testid={`btn-alert-trade-${rank}`}
          onClick={handleSetAlert}
          disabled={alertStatus === "saving" || alertStatus === "done"}
          style={{
            padding: "10px 8px", background: "transparent", border: "none",
            color: alertStatus === "done" ? "#22c55e" : alertStatus === "error" ? "#ef4444" : alertStatus === "saving" ? "rgba(255,255,255,0.3)" : "#c9a84c",
            cursor: alertStatus === "saving" || alertStatus === "done" ? "default" : "pointer",
            fontFamily: MONO, fontSize: 9, fontWeight: 600,
          }}
        >
          {alertStatus === "saving" ? "⏳ Saving..." : alertStatus === "done" ? "✓ Alert Set!" : alertStatus === "error" ? "✖ Failed" : "⏰ Set Alert"}
        </button>
      </div>
    </div>
  );
}
