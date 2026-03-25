// ── InsiderTab — SEC EDGAR Form 4 insider cluster buys & large purchases ───
import { useState, useEffect, useCallback } from "react";

const C = {
  bg:"#050709", navy:"#080d18", panel:"#0c1220",
  border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7",
};
const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS  = "'Barlow', system-ui, sans-serif";

function fmtValue(v) {
  if (!v && v !== 0) return "—";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toFixed(0);
}

function fmtNum(n) {
  if (!n) return "—";
  return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : String(n);
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

const ROLE_COLOR = {
  "CEO": "#a855f7",
  "CFO": "#3b82f6",
  "COO": "#14b8a6",
  "CTO": "#00d4ff",
  "Director": "#c9a84c",
  "Chairman": "#e8c96d",
  "President": "#c9a84c",
  "10%+ Owner": "#ff8c00",
  "Officer": "#6b7fa8",
};
function roleColor(title) {
  return ROLE_COLOR[title] || C.muted2;
}

// Group trades by ticker for cluster visualization
function groupByTicker(trades) {
  const map = {};
  for (const t of trades) {
    if (!map[t.ticker]) map[t.ticker] = { ticker: t.ticker, trades: [], totalValue: 0, company: t.company };
    map[t.ticker].trades.push(t);
    map[t.ticker].totalValue += t.value || 0;
  }
  return Object.values(map).sort((a, b) => {
    if (b.trades.length !== a.trades.length) return b.trades.length - a.trades.length;
    return b.totalValue - a.totalValue;
  });
}

export default function InsiderTab({ isPro, onUpgrade, onAskAI }) {
  const [trades, setTrades]         = useState([]);
  const [loading, setLoading]       = useState(false);
  const [lastFetch, setLastFetch]   = useState(null);
  const [error, setError]           = useState(null);
  const [view, setView]             = useState("cluster"); // cluster | list
  const [filterMin, setFilterMin]   = useState(25000);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatus, setScanStatus]   = useState(null); // { phase, done, total }

  const loadInsider = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/insider", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setTrades(data.trades || []);
      const stillScanning = data.scanning || (data.loading && (data.trades || []).length === 0);
      setScanLoading(stillScanning);
      if (data.scanPhase) setScanStatus({ phase: data.scanPhase, done: data.scanDone || 0, total: data.scanTotal || 0 });
      setLastFetch(data.fetchedAt || Date.now());
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll scan status every 8s while scan is in progress
  useEffect(() => {
    if (!isPro || !scanLoading) return;
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/insider/status", { credentials: "include" });
        if (!r.ok) return;
        const s = await r.json();
        setScanStatus({ phase: s.phase, done: s.done, total: s.total });
        if (!s.scanning) {
          setScanLoading(false);
          loadInsider();
        }
      } catch {}
    }, 8000);
    return () => clearInterval(poll);
  }, [isPro, scanLoading, loadInsider]);

  useEffect(() => {
    if (isPro) {
      loadInsider();
      const interval = setInterval(loadInsider, 20 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isPro, loadInsider]);

  const filtered = trades.filter(t => (t.value || 0) >= filterMin);
  const grouped  = groupByTicker(filtered);
  const clusters = grouped.filter(g => g.trades.length >= 2);
  const singles  = grouped.filter(g => g.trades.length === 1);

  const panel = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 10 };
  const ph = { padding: "11px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" };

  if (!isPro) {
    return (
      <div data-testid="progate-insider" style={{ position: "relative" }}>
        <div style={{ filter: "blur(4px)", opacity: 0.3, pointerEvents: "none", maxHeight: 200, overflow: "hidden" }}>
          <div style={{ ...panel }}>
            <div style={ph}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.gold }}>INSIDER CLUSTER BUYS</span>
            </div>
            <div style={{ padding: 14 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 60, background: C.border, borderRadius: 4, marginBottom: 8 }} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(5,7,9,.85)", backdropFilter: "blur(8px)", borderRadius: 4 }}>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 16, color: C.gold2, marginBottom: 4 }}>Pro Feature</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, letterSpacing: "0.12em", marginBottom: 12, textTransform: "uppercase" }}>SEC Insider Intelligence</div>
          <button data-testid="btn-upgrade-insider" onClick={onUpgrade} style={{ background: "rgba(201,168,76,.12)", border: `1px solid rgba(201,168,76,.35)`, borderRadius: 2, padding: "8px 20px", fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 13, color: C.gold2, cursor: "pointer" }}>Upgrade to Pro</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.2em", marginBottom: 2 }}>SEC INSIDER INTELLIGENCE</div>
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 900, color: C.white }}>Insider Flow Tracker</div>
        </div>
        <button data-testid="btn-refresh-insider" onClick={loadInsider} disabled={loading} style={{ background: "rgba(201,168,76,.08)", border: `1px solid rgba(201,168,76,.25)`, borderRadius: 2, padding: "6px 12px", fontFamily: MONO, fontSize: 9, color: loading ? C.muted : C.gold2, cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.1em" }}>
          {loading ? "LOADING..." : "↻ REFRESH"}
        </button>
      </div>

      {lastRefresh && (
        <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginBottom: 10, letterSpacing: "0.1em" }}>
          LAST UPDATED {lastRefresh.toLocaleTimeString()} · AUTO-REFRESH EVERY 20 MIN · SEC FILINGS ≥$25K · LAST 14 DAYS
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(255,64,96,.08)", border: `1px solid rgba(255,64,96,.25)`, borderRadius: 4, padding: "10px 14px", marginBottom: 10, fontFamily: MONO, fontSize: 10, color: C.red }}>
          ⚠ Unable to fetch insider data: {error}. SEC EDGAR may be temporarily unavailable.
        </div>
      )}

      {/* Stats bar */}
      {filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
          {[
            { label: "CLUSTER BUYS", value: clusters.length, color: C.gold },
            { label: "UNIQUE TICKERS", value: grouped.length, color: C.cyan },
            { label: "TOTAL VALUE", value: fmtValue(filtered.reduce((s, t) => s + (t.value || 0), 0)), color: C.green },
          ].map(s => (
            <div key={s.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontFamily: MONO, fontSize: 7, color: C.muted, letterSpacing: "0.12em", marginTop: 3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* View toggle + min-value filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
        {["cluster", "list"].map(v => (
          <button key={v} data-testid={`insider-view-${v}`} onClick={() => setView(v)} style={{ padding: "5px 12px", borderRadius: 2, border: `1px solid ${view === v ? C.gold : C.border}`, background: view === v ? "rgba(201,168,76,.08)" : "transparent", color: view === v ? C.gold : C.muted, fontFamily: MONO, fontSize: 9, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {v === "cluster" ? "Cluster View" : "All Trades"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {[25000, 100000, 500000].map(min => (
            <button key={min} onClick={() => setFilterMin(min)} style={{ padding: "4px 8px", borderRadius: 2, border: `1px solid ${filterMin === min ? C.cyan : C.border}`, background: filterMin === min ? "rgba(0,212,255,.06)" : "transparent", color: filterMin === min ? C.cyan : C.muted, fontFamily: MONO, fontSize: 8, cursor: "pointer" }}>
              {min === 25000 ? "$25K+" : min === 100000 ? "$100K+" : "$500K+"}
            </button>
          ))}
        </div>
      </div>

      {(loading || scanLoading) && trades.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, fontFamily: MONO, color: C.muted }}>
          <div style={{ fontSize: 28, marginBottom: 14, animation: "spin 2s linear infinite", display: "inline-block" }}>⟳</div>
          <div style={{ fontSize: 12, color: C.muted2, marginBottom: 6 }}>
            {scanStatus?.phase === "submissions"
              ? `Scanning ${scanStatus.total} companies — checking Form 4 submissions...`
              : scanStatus?.phase === "filings"
              ? `Reading Form 4 XMLs — ${scanStatus.done} of ${scanStatus.total} filings parsed...`
              : "Scanning SEC EDGAR Form 4 filings..."}
          </div>
          {scanStatus && scanStatus.total > 0 && (
            <div style={{ maxWidth: 240, margin: "10px auto" }}>
              <div style={{ height: 3, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.round((scanStatus.done / scanStatus.total) * 100)}%`,
                  background: `linear-gradient(90deg, ${C.gold}, ${C.gold2})`,
                  borderRadius: 3, transition: "width 1s ease",
                }}/>
              </div>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 5 }}>
                {scanStatus.done}/{scanStatus.total} · {Math.round((scanStatus.done / scanStatus.total) * 100)}%
              </div>
            </div>
          )}
          <div style={{ fontSize: 8, color: C.muted, marginTop: 8, opacity: 0.6 }}>
            SEC EDGAR rate-limited · First load takes 2-4 min · Updates auto-refresh every 20 min
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {!loading && !scanLoading && filtered.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: 40, fontFamily: MONO, fontSize: 10, color: C.muted }}>
          No insider purchases ≥${(filterMin / 1000).toFixed(0)}K found in the last 14 days for watchlist companies.
        </div>
      )}

      {/* CLUSTER VIEW */}
      {view === "cluster" && (
        <div>
          {clusters.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, boxShadow: `0 0 8px ${C.gold}` }} />
                <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.18em" }}>CLUSTER BUYS · {clusters.length} TICKERS</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>(2+ insiders buying same stock within 14 days)</div>
              </div>
              {clusters.map(g => (
                <ClusterCard key={g.ticker} group={g} onAskAI={onAskAI} />
              ))}
            </div>
          )}
          {singles.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, letterSpacing: "0.15em", marginBottom: 8, paddingTop: 4 }}>LARGE INDIVIDUAL PURCHASES</div>
              {singles.map(g => (
                <SingleCard key={g.ticker} trade={g.trades[0]} onAskAI={onAskAI} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div>
          {filtered.sort((a, b) => (b.value || 0) - (a.value || 0)).map(t => (
            <SingleCard key={t.id} trade={t} showClusterBadge onAskAI={onAskAI} />
          ))}
        </div>
      )}

      {/* AI context tip */}
      <div style={{ background: "rgba(201,168,76,.04)", border: `1px solid rgba(201,168,76,.15)`, borderRadius: 4, padding: "10px 14px", marginTop: 8 }}>
        <div style={{ fontFamily: MONO, fontSize: 8, color: C.gold, letterSpacing: "0.15em", marginBottom: 4 }}>AI INTEGRATION ACTIVE</div>
        <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted2, lineHeight: 1.6 }}>
          Insider data is automatically injected into CLVR AI's analysis context. When you ask AI about a stock that has recent insider buying, it will factor the insider signal into its recommendation.
        </div>
      </div>

      <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, marginTop: 10, textAlign: "center", lineHeight: 1.8 }}>
        Data sourced from SEC EDGAR · Form 4 filings · 56 watchlist companies · Purchases ≥$25K in last 14 days
        <br />Not investment advice. Insider activity does not guarantee future performance.
      </div>
    </div>
  );
}

function ClusterCard({ group, onAskAI }) {
  const [open, setOpen] = useState(false);
  const total = fmtValue(group.totalValue);
  const count = group.trades.length;

  return (
    <div data-testid={`cluster-card-${group.ticker}`} style={{ background: "rgba(201,168,76,.04)", border: `1px solid rgba(201,168,76,.2)`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, marginBottom: 8, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ background: "rgba(201,168,76,.12)", border: `1px solid rgba(201,168,76,.3)`, borderRadius: 3, padding: "4px 10px", fontFamily: MONO, fontSize: 13, fontWeight: 900, color: C.gold2, letterSpacing: "0.06em", minWidth: 58, textAlign: "center" }}>
          {group.ticker}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SANS, fontSize: 12, color: C.text, marginBottom: 2, lineHeight: 1.3 }}>{group.company}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: C.gold, background: "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.25)`, borderRadius: 2, padding: "2px 8px" }}>
              {count} INSIDERS
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 900, color: C.green }}>{total}</span>
            <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>total bought</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button data-testid={`btn-insider-ai-${group.ticker}`} onClick={e => { e.stopPropagation(); onAskAI && onAskAI(`${group.ticker} — ${count} insiders just bought $${(group.totalValue/1e6).toFixed(2)}M total. Is this a bullish signal? What's the trade thesis?`); }} style={{ padding: "5px 10px", borderRadius: 2, background: "rgba(201,168,76,.08)", border: `1px solid rgba(201,168,76,.3)`, fontFamily: MONO, fontSize: 8, color: C.gold, cursor: "pointer", letterSpacing: "0.08em" }}>ASK AI ✦</button>
          <span style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid rgba(201,168,76,.15)`, padding: "8px 14px 12px" }}>
          {group.trades.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: i < group.trades.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: roleColor(t.title), flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: SANS, fontSize: 12, color: C.text }}>{t.insiderName}</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: roleColor(t.title) }}>{t.title}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.green }}>{fmtValue(t.value)}</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>{fmtNum(t.qty)} shares @ ${t.price?.toFixed(2)}</div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, minWidth: 40, textAlign: "right" }}>{timeAgo(t.filingDate)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SingleCard({ trade: t, showClusterBadge, onAskAI }) {
  if (!t) return null;
  return (
    <div data-testid={`insider-card-${t.id}`} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: "11px 14px", marginBottom: 7, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ background: "rgba(59,130,246,.08)", border: `1px solid rgba(59,130,246,.2)`, borderRadius: 3, padding: "3px 8px", fontFamily: MONO, fontSize: 11, fontWeight: 900, color: C.blue, letterSpacing: "0.06em", minWidth: 50, textAlign: "center", flexShrink: 0 }}>
        {t.ticker}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: SANS, fontSize: 12, color: C.text, marginBottom: 3 }}>{t.insiderName}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 8, color: roleColor(t.title), fontWeight: 700 }}>{t.title}</span>
          <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>{fmtNum(t.qty)} shares</span>
          {showClusterBadge && t.isCluster && (
            <span style={{ fontFamily: MONO, fontSize: 7, color: C.gold, background: "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.25)`, borderRadius: 2, padding: "1px 5px" }}>CLUSTER</span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>{timeAgo(t.filingDate)}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color: C.green }}>{fmtValue(t.value)}</div>
        <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted }}>@ ${t.price?.toFixed(2) || "—"}</div>
      </div>
      <button data-testid={`btn-single-ai-${t.id}`} onClick={() => onAskAI && onAskAI(`${t.ticker} — ${t.title} ${t.insiderName} just bought ${fmtValue(t.value)}. Is this bullish? Trade thesis?`)} style={{ padding: "5px 9px", borderRadius: 2, background: "rgba(201,168,76,.06)", border: `1px solid rgba(201,168,76,.2)`, fontFamily: MONO, fontSize: 8, color: C.gold, cursor: "pointer", flexShrink: 0, letterSpacing: "0.06em" }}>AI ✦</button>
    </div>
  );
}
