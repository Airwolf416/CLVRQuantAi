import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, ReferenceLine, ReferenceArea,
  ResponsiveContainer, Tooltip,
} from "recharts";

// ── Live Intraday Chart with Session VWAP + Opening Range Overlay ───────────
// Renders ONLY for spot equities, spot FX, spot commodities. Asset-class
// gating happens server-side (the bars + levels endpoints both 404 with
// asset_class_not_eligible for crypto/perps), so this component bails if
// either fetch returns non-200.
//
// Spec colors (locked, do not theme):
//   VWAP:    solid gold #D4AF37, 1.5px
//   bands:   dashed gold #D4AF37 @ 40% opacity, 1px
//   ORH:     dashed green #00FF88, labeled
//   ORL:     dashed red   #FF4444, labeled
//   shaded:  green #00FF88 @ 8% opacity between ORL/ORH

const VWAP_COLOR = "#D4AF37";
const ORH_COLOR  = "#00FF88";
const ORL_COLOR  = "#FF4444";
const PRICE_COLOR = "#9aa4b2";
const MONO = "'IBM Plex Mono', monospace";

function fmt(n, dec) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toFixed(dec);
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function LiveOverlayChart({ symbol }) {
  const [eligible, setEligible] = useState(null);   // {equity, fx, commodity}
  const [sym, setSym] = useState((symbol || "AAPL").toUpperCase());
  const [bars, setBars] = useState([]);
  const [levels, setLevels] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load eligible symbol list once for the selector
  useEffect(() => {
    let cancelled = false;
    fetch("/api/execution_levels/eligible", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j) setEligible(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sync internal sym with parent symbol prop when it changes (e.g. user
  // switches asset elsewhere). Only adopt the new prop value if it's a
  // non-empty eligible-looking ticker.
  useEffect(() => {
    if (!symbol) return;
    const next = symbol.toUpperCase();
    if (next !== sym) setSym(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Fetch bars + levels whenever sym changes; refresh every 30s
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [barsRes, lvlRes] = await Promise.all([
          fetch(`/api/execution_levels/${sym}/bars`, { credentials: "include" }),
          fetch(`/api/execution_levels/${sym}`,      { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (barsRes.status === 404 || lvlRes.status === 404) {
          setBars([]); setLevels(null);
          setError(`${sym} is not eligible for VWAP/Opening-Range overlay (spot equities, spot FX, spot commodities only).`);
          return;
        }
        if (!barsRes.ok || !lvlRes.ok) {
          setBars([]); setLevels(null);
          if (lvlRes.status === 503) {
            setError("No session data yet — market hasn't opened or no bars available.");
          } else if (lvlRes.status === 401 || barsRes.status === 401) {
            setError("Sign in to view live execution levels.");
          } else {
            setError("Failed to load execution levels.");
          }
          return;
        }
        const barsJson = await barsRes.json();
        const lvlJson  = await lvlRes.json();
        setBars(barsJson.bars || []);
        setLevels(lvlJson);
      } catch (e) {
        if (!cancelled) {
          setBars([]); setLevels(null);
          setError("Network error loading execution levels.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    timer = setInterval(load, 30_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [sym]);

  const chartData = useMemo(() => bars.map(b => ({ t: b.t, c: b.c, v: b.v })), [bars]);
  const dec = useMemo(() => {
    const px = levels?.current_price ?? bars[bars.length - 1]?.c ?? 1;
    return px < 10 ? 4 : 2;
  }, [levels, bars]);

  const yDomain = useMemo(() => {
    if (!chartData.length || !levels) return ["auto", "auto"];
    const vals = [
      ...chartData.map(d => d.c),
      levels.vwap, levels.vwap_upper_1sd, levels.vwap_lower_1sd,
      levels.orh, levels.orl,
    ].filter(n => isFinite(n));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || hi * 0.001;
    return [lo - pad, hi + pad];
  }, [chartData, levels]);

  const xTicks = useMemo(() => {
    if (chartData.length < 4) return undefined;
    const first = chartData[0].t;
    const last  = chartData[chartData.length - 1].t;
    const span  = last - first;
    const step  = span / 4;
    return [0, 1, 2, 3, 4].map(i => first + Math.round(step * i));
  }, [chartData]);

  // Eligibility gate UI: pick from spot symbols only
  const eligibleSymbols = useMemo(() => {
    if (!eligible) return [];
    return [...eligible.equity, ...eligible.fx, ...eligible.commodity];
  }, [eligible]);

  return (
    <div data-testid="live-overlay-chart" style={{
      background: "#000",
      border: "1px solid rgba(212,175,55,0.18)",
      borderRadius: 10,
      padding: 14,
      marginBottom: 16,
      fontFamily: MONO,
    }}>
      {/* Header row */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 10, gap: 12, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 8, color: "rgba(212,175,55,0.7)", letterSpacing: "0.14em" }}>
            EXECUTION OVERLAY · LIVE
          </div>
          <div style={{ fontSize: 14, color: "#e8c96d", fontWeight: 700, marginTop: 2 }}>
            {sym} {levels && `· $${fmt(levels.current_price, dec)}`}
            {levels && (
              <span style={{
                marginLeft: 10, fontSize: 9, fontWeight: 400,
                color: levels.price_vs_vwap_pct >= 0 ? "#00FF88" : "#FF4444",
              }}>
                {levels.price_vs_vwap_pct >= 0 ? "+" : ""}{levels.price_vs_vwap_pct}% vs VWAP
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            data-testid="select-overlay-symbol"
            value={sym}
            onChange={e => setSym(e.target.value)}
            style={{
              background: "#0c1220",
              border: "1px solid rgba(212,175,55,0.25)",
              color: "#e8c96d",
              padding: "5px 10px",
              fontFamily: MONO,
              fontSize: 10,
              borderRadius: 5,
              outline: "none",
              cursor: "pointer",
            }}
          >
            {eligible?.equity?.length > 0 && <optgroup label="Equities">
              {eligible.equity.map(s => <option key={s} value={s}>{s}</option>)}
            </optgroup>}
            {eligible?.fx?.length > 0 && <optgroup label="Forex">
              {eligible.fx.map(s => <option key={s} value={s}>{s}</option>)}
            </optgroup>}
            {eligible?.commodity?.length > 0 && <optgroup label="Commodities">
              {eligible.commodity.map(s => <option key={s} value={s}>{s}</option>)}
            </optgroup>}
            {!eligible && <option value={sym}>{sym}</option>}
          </select>
          {loading && <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 9 }}>loading…</span>}
        </div>
      </div>

      {/* Chart */}
      {error && (
        <div data-testid="overlay-error" style={{
          padding: "20px 12px", color: "rgba(255,255,255,0.5)",
          fontSize: 11, textAlign: "center",
          border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6,
        }}>{error}</div>
      )}

      {!error && chartData.length > 0 && levels && (
        <>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 8, right: 48, bottom: 18, left: 8 }}>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  ticks={xTicks}
                  tickFormatter={fmtTime}
                  scale="time"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9, fontFamily: MONO }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
                />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(v) => fmt(v, dec)}
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9, fontFamily: MONO }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  width={60}
                  orientation="right"
                />
                <Tooltip
                  contentStyle={{
                    background: "#0c1220",
                    border: "1px solid rgba(212,175,55,0.3)",
                    fontFamily: MONO, fontSize: 10, color: "#e8c96d",
                  }}
                  labelFormatter={(l) => fmtTime(l) + " UTC"}
                  formatter={(v) => [fmt(v, dec), "Price"]}
                />

                {/* Shaded opening range zone */}
                <ReferenceArea
                  y1={levels.orl} y2={levels.orh}
                  fill={ORH_COLOR} fillOpacity={0.08}
                  stroke="none"
                />

                {/* VWAP bands (drawn before VWAP so the solid line sits on top) */}
                <ReferenceLine
                  y={levels.vwap_upper_1sd}
                  stroke={VWAP_COLOR} strokeOpacity={0.4}
                  strokeWidth={1} strokeDasharray="4 4"
                />
                <ReferenceLine
                  y={levels.vwap_lower_1sd}
                  stroke={VWAP_COLOR} strokeOpacity={0.4}
                  strokeWidth={1} strokeDasharray="4 4"
                />

                {/* Session VWAP — solid gold */}
                <ReferenceLine
                  y={levels.vwap}
                  stroke={VWAP_COLOR} strokeWidth={1.5}
                />

                {/* Opening Range high/low — dashed green/red with labels */}
                <ReferenceLine
                  y={levels.orh} stroke={ORH_COLOR}
                  strokeWidth={1} strokeDasharray="4 4"
                  label={{
                    value: `ORH $${fmt(levels.orh, dec)}`,
                    fill: ORH_COLOR, fontSize: 9, fontFamily: MONO,
                    position: "insideTopRight",
                  }}
                />
                <ReferenceLine
                  y={levels.orl} stroke={ORL_COLOR}
                  strokeWidth={1} strokeDasharray="4 4"
                  label={{
                    value: `ORL $${fmt(levels.orl, dec)}`,
                    fill: ORL_COLOR, fontSize: 9, fontFamily: MONO,
                    position: "insideBottomRight",
                  }}
                />

                {/* Price line — drawn last, on top */}
                <Line
                  type="monotone" dataKey="c"
                  stroke={PRICE_COLOR} strokeWidth={1.25}
                  dot={false} isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend + ORB status */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 8, gap: 14, flexWrap: "wrap",
            fontSize: 9, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em",
          }}>
            <div style={{ display: "flex", gap: 14 }}>
              <span><span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: VWAP_COLOR, marginRight: 5, verticalAlign: "middle",
              }} />VWAP</span>
              <span><span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: ORH_COLOR, marginRight: 5, verticalAlign: "middle",
              }} />ORH</span>
              <span><span style={{
                display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: ORL_COLOR, marginRight: 5, verticalAlign: "middle",
              }} />ORL</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <span>OR width <span style={{ color: "#e8c96d" }}>{levels.or_width_pct}%</span></span>
              <span>ORB <span style={{
                color: levels.orb_status === "broken_up" ? ORH_COLOR
                     : levels.orb_status === "broken_down" ? ORL_COLOR
                     : levels.orb_status === "failed_breakout" ? "#e8c96d"
                     : "rgba(255,255,255,0.55)",
                fontWeight: 700,
              }}>{levels.orb_status.toUpperCase().replace("_", " ")}</span></span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
