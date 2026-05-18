import { useEffect, useState, useCallback } from "react";

const MONO = "IBM Plex Mono, ui-monospace, monospace";
const SERIF = "Playfair Display, ui-serif, serif";

const ARCH_COLORS = {
  NEWS_MOMO: "#f87171",
  MEAN_REVERSION_EXHAUSTION: "#a78bfa",
  BREAKOUT_RETEST: "#22d3ee",
  VWAP_RECLAIM: "#34d399",
  TREND_PULLBACK: "#fbbf24",
  RANGE_FADE: "#94a3b8",
  UNCLASSIFIED: "#6b7280",
};

function pct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function Panel({ title, children, right }) {
  return (
    <div style={{
      border: "1px solid rgba(201,168,76,0.18)", borderRadius: 8,
      background: "rgba(10,14,26,0.6)", padding: 14, marginBottom: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700, color: "#c9a84c", margin: 0, letterSpacing: "0.04em" }}>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function ArchetypeAdminPanel() {
  const [summary, setSummary] = useState(null);
  const [refreshLog, setRefreshLog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lookback, setLookback] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([
        fetch(`/api/admin/archetype/summary?lookbackDays=${lookback}`, { credentials: "include" }),
        fetch(`/api/admin/archetype/refresh-log`, { credentials: "include" }),
      ]);
      if (!s.ok) throw new Error(`summary HTTP ${s.status}`);
      setSummary(await s.json());
      if (l.ok) setRefreshLog(await l.json());
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [lookback]);

  useEffect(() => { load(); }, [load]);

  const onRefreshNow = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/admin/archetype/refresh-stats`, { method: "POST", credentials: "include" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`Refresh failed: ${body?.message || body?.error || r.status}`);
      } else {
        await load();
      }
    } catch (e) {
      alert(`Refresh error: ${e?.message || e}`);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !summary) {
    return <div style={{ padding: 20, color: "#94a3b8", fontFamily: MONO }}>Loading archetype diagnostics…</div>;
  }
  if (err) {
    return <div style={{ padding: 20, color: "#f87171", fontFamily: MONO }} data-testid="text-archetype-admin-error">Error: {err}</div>;
  }
  if (!summary) return null;

  const last = summary.last_refresh;
  const lastAt = last?.completedAt || last?.startedAt;

  return (
    <div data-testid="panel-archetype-admin" style={{ padding: "12px 16px", color: "#e0e0e0", fontFamily: MONO, fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontFamily: SERIF, fontSize: 18, color: "#c9a84c", margin: 0, letterSpacing: "0.04em" }}>Archetype Coverage</h2>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            Lookback {summary.lookback_days}d · Global WR {pct(summary.global_wr)} · Last refresh {fmtTime(lastAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            data-testid="select-archetype-lookback"
            value={lookback}
            onChange={e => setLookback(Number(e.target.value))}
            style={{ background: "#0a0e1a", color: "#e0e0e0", border: "1px solid rgba(201,168,76,0.3)", padding: "4px 8px", fontFamily: MONO, fontSize: 11, borderRadius: 4 }}>
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
          </select>
          <button
            data-testid="button-archetype-reload"
            onClick={load} disabled={loading}
            style={{ background: "rgba(201,168,76,0.10)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.3)", padding: "4px 10px", fontFamily: MONO, fontSize: 11, borderRadius: 4, cursor: "pointer" }}>
            {loading ? "…" : "Reload"}
          </button>
          <button
            data-testid="button-archetype-refresh-stats"
            onClick={onRefreshNow} disabled={refreshing}
            style={{ background: "rgba(34,197,94,0.10)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", padding: "4px 10px", fontFamily: MONO, fontSize: 11, borderRadius: 4, cursor: "pointer" }}>
            {refreshing ? "Refreshing…" : "Refresh Stats Now"}
          </button>
        </div>
      </div>

      {/* Panel 1 — Coverage by asset class */}
      <Panel title="Coverage by Asset Class">
        {summary.coverage_by_asset_class.length === 0
          ? <div style={{ color: "#94a3b8" }}>No signals in lookback window.</div>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-coverage">
              <thead>
                <tr style={{ color: "#94a3b8", fontSize: 10, textAlign: "left" }}>
                  <th style={{ padding: 4 }}>ASSET CLASS</th>
                  <th style={{ padding: 4, textAlign: "right" }}>CLASSIFIED</th>
                  <th style={{ padding: 4, textAlign: "right" }}>UNCLASSIFIED</th>
                  <th style={{ padding: 4, textAlign: "right" }}>% CLASSIFIED</th>
                </tr>
              </thead>
              <tbody>
                {summary.coverage_by_asset_class.map((r, i) => {
                  const total = Number(r.total) || 0;
                  const classified = Number(r.classified) || 0;
                  const ratio = total > 0 ? classified / total : 0;
                  const color = ratio >= 0.8 ? "#22c55e" : ratio >= 0.5 ? "#fbbf24" : "#f87171";
                  return (
                    <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>{r.asset_class}</td>
                      <td style={{ padding: 6, textAlign: "right", color: "#22c55e" }}>{classified}</td>
                      <td style={{ padding: 6, textAlign: "right", color: "#94a3b8" }}>{Number(r.unclassified) || 0}</td>
                      <td style={{ padding: 6, textAlign: "right", color, fontWeight: 700 }}>{pct(ratio)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </Panel>

      {/* Panel 2 — Per-endpoint distribution */}
      <Panel title="Per-Endpoint Distribution (/quant · /analyze · /kronos)">
        {summary.endpoint_distribution.length === 0
          ? <div style={{ color: "#94a3b8" }}>No endpoint diagnostics populated yet — classification_diagnostics.source_endpoint will fill in as new signals flow.</div>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-endpoint-distribution">
              <thead>
                <tr style={{ color: "#94a3b8", fontSize: 10, textAlign: "left" }}>
                  <th style={{ padding: 4 }}>ENDPOINT</th>
                  <th style={{ padding: 4 }}>ARCHETYPE</th>
                  <th style={{ padding: 4, textAlign: "right" }}>COUNT</th>
                </tr>
              </thead>
              <tbody>
                {summary.endpoint_distribution.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: 6, color: "#c9a84c" }}>{r.endpoint}</td>
                    <td style={{ padding: 6, color: ARCH_COLORS[r.archetype] || "#e0e0e0", fontWeight: 700 }}>{r.archetype}</td>
                    <td style={{ padding: 6, textAlign: "right", fontFamily: MONO }}>{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Panel>

      {/* Panel 3 — WR per archetype */}
      <Panel title="Win Rate per Archetype (live · backfill · combined)">
        <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-wr-per-archetype">
          <thead>
            <tr style={{ color: "#94a3b8", fontSize: 10, textAlign: "left" }}>
              <th style={{ padding: 4 }}>ARCHETYPE</th>
              <th style={{ padding: 4, textAlign: "right" }}>LIVE (n)</th>
              <th style={{ padding: 4, textAlign: "right" }}>BACKFILL (n)</th>
              <th style={{ padding: 4, textAlign: "right" }}>COMBINED (n)</th>
              <th style={{ padding: 4, textAlign: "right" }}>Δ GLOBAL</th>
            </tr>
          </thead>
          <tbody>
            {summary.wr_per_archetype.length === 0
              ? <tr><td colSpan={5} style={{ padding: 8, color: "#94a3b8" }}>No outcomes yet.</td></tr>
              : summary.wr_per_archetype.map((r, i) => {
                const color = ARCH_COLORS[r.archetype] || "#e0e0e0";
                const delta = (r.combined.wr != null && summary.global_wr != null)
                  ? r.combined.wr - summary.global_wr : null;
                const deltaColor = delta == null ? "#94a3b8" : delta >= 0 ? "#22c55e" : "#f87171";
                return (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: r.divergent_15pp ? "rgba(245,158,11,0.06)" : "transparent" }}>
                    <td style={{ padding: 6, color, fontWeight: 700 }}>
                      {r.archetype}
                      {r.divergent_15pp && <span title=">15pp divergence from global WR" style={{ marginLeft: 6, color: "#f59e0b", fontSize: 10 }}>⚠</span>}
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>{pct(r.live.wr)} <span style={{ color: "#94a3b8", marginLeft: 4 }}>({r.live.n})</span></td>
                    <td style={{ padding: 6, textAlign: "right" }}>{pct(r.backfill.wr)} <span style={{ color: "#94a3b8", marginLeft: 4 }}>({r.backfill.n})</span></td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>{pct(r.combined.wr)} <span style={{ color: "#94a3b8", marginLeft: 4, fontWeight: 400 }}>({r.combined.n})</span></td>
                    <td style={{ padding: 6, textAlign: "right", color: deltaColor }}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`}</td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </Panel>

      {/* Panel 4 — Top UNCLASSIFIED near-miss reasons */}
      <Panel title="Top 5 UNCLASSIFIED Near-Miss Reasons">
        {summary.top_unclassified_reasons.length === 0
          ? <div style={{ color: "#94a3b8" }}>No unclassified signals with diagnostics in this window.</div>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-near-miss">
              <thead>
                <tr style={{ color: "#94a3b8", fontSize: 10, textAlign: "left" }}>
                  <th style={{ padding: 4 }}>REASON</th>
                  <th style={{ padding: 4, textAlign: "right" }}>COUNT</th>
                </tr>
              </thead>
              <tbody>
                {summary.top_unclassified_reasons.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: 6, color: "#e0e0e0" }}>{r.reason}</td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Panel>

      {/* Bonus — recent refresh log */}
      <Panel title="Recent MV Refresh Log (last 24h)">
        {(!refreshLog?.rows || refreshLog.rows.length === 0)
          ? <div style={{ color: "#94a3b8" }}>No refreshes recorded in the last 24h.</div>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="table-refresh-log">
              <thead>
                <tr style={{ color: "#94a3b8", fontSize: 10, textAlign: "left" }}>
                  <th style={{ padding: 4 }}>STARTED</th>
                  <th style={{ padding: 4, textAlign: "right" }}>DUR (ms)</th>
                  <th style={{ padding: 4, textAlign: "right" }}>ROWS</th>
                  <th style={{ padding: 4 }}>STATUS</th>
                  <th style={{ padding: 4 }}>ERROR</th>
                </tr>
              </thead>
              <tbody>
                {refreshLog.rows.slice(0, 20).map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: 6, color: "#94a3b8" }}>{fmtTime(r.started_at)}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.duration_ms ?? "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.rows_refreshed ?? "—"}</td>
                    <td style={{ padding: 6, color: r.success ? "#22c55e" : "#f87171", fontWeight: 700 }}>{r.success ? "OK" : "FAIL"}</td>
                    <td style={{ padding: 6, color: "#f87171", fontSize: 10 }}>{r.error_message || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Panel>
    </div>
  );
}
