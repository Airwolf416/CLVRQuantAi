import React, { useState } from "react";

const C = {
  bg: "#070b11", panel: "#0d1420", panel2: "#101a28", line: "#1d2a3b",
  lineHi: "#2b3d52", text: "#dce6f2", muted: "#8191a6", dim: "#56677c",
  gold: "#d8b45a", cyan: "#53c8cf", green: "#47c99b", red: "#f07878",
  amber: "#e7a956", blue: "#86a8d6",
};
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";
const SANS = "'Barlow', 'Segoe UI', sans-serif";

const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const num = (v, digits = 1) => finite(v) ? Number(v).toFixed(digits) : "—";
const pct = (v, digits = 1, signed = false) => finite(v)
  ? `${signed && Number(v) > 0 ? "+" : ""}${Number(v).toFixed(digits)}%` : "—";
const pp = (v, digits = 1) => finite(v) ? `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(digits)} pp` : "—";
const asDate = (value) => {
  if (!value) return "Not available";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not available" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const labelize = (s) => String(s || "Unavailable").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const statusColor = (s) => {
  const v = String(s || "").toLowerCase();
  if (v.includes("error") || v.includes("unavailable")) return C.red;
  if (v.includes("stale") || v.includes("partial") || v.includes("warming")) return C.amber;
  if (v === "ready" || v === "live") return C.green;
  return C.muted;
};

const TIPS = {
  asi: "Altcoin Season Index: the share of eligible top-100 altcoins that outperformed Bitcoin across 30-, 60- and 90-day windows. The composite weights the three horizons; it is breadth, not a price target.",
  cap: "The market-cap-weighted share of eligible altcoin value that beat Bitcoin over 90 days. Larger assets contribute more than smaller assets.",
  momentum: "30-day ASI minus 90-day ASI. A positive reading means recent participation is stronger than the longer-term backdrop.",
  dominance: "Bitcoin's share of total crypto market capitalization. Ex-stables removes stablecoin capitalization from the denominator to better isolate risk appetite.",
  ethbtc: "ETH/BTC compares Ethereum's value with Bitcoin. A rising ratio suggests ETH leadership; moving averages provide trend context, not a forecast.",
  macro: "Macro score blends standardized 20-day changes across available factors. Positive readings imply a more supportive risk backdrop; missing or warming factors are not treated as zero.",
};

function Tip({ children }) {
  return <details className="rb-tip"><summary aria-label="Metric explanation">i</summary><div>{children}</div></details>;
}

function Badge({ children, tone }) {
  const color = tone || statusColor(children);
  return <span className="rb-badge" style={{ "--badge": color }}>{children}</span>;
}

function Panel({ title, eyebrow, aside, children, className = "" }) {
  return <section className={`rb-panel ${className}`}>
    <header className="rb-panel-head">
      <div><div className="rb-eyebrow">{eyebrow}</div><h2>{title}</h2></div>
      {aside && <div className="rb-panel-aside">{aside}</div>}
    </header>
    {children}
  </section>;
}

function Metric({ label, value, sub, color, tip }) {
  return <div className="rb-metric">
    <div className="rb-metric-label">{label}{tip && <Tip>{tip}</Tip>}</div>
    <div className="rb-metric-value" style={color ? { color } : undefined}>{value}</div>
    {sub && <div className="rb-metric-sub">{sub}</div>}
  </div>;
}

function Progress({ value, color = C.cyan }) {
  if (!finite(value)) return <div className="rb-progress-empty">No score yet</div>;
  const n = Math.max(0, Math.min(100, Number(value)));
  return <div className="rb-progress" aria-label={`${n.toFixed(1)} percent`}>
    <span style={{ width: `${n}%`, background: color }} />
  </div>;
}

function Skeleton() {
  return <main className="rb-shell">
    <style>{STYLES}</style>
    <div className="rb-loading-top motion-shimmer" />
    <div className="rb-skeleton-grid">{[0, 1, 2, 3].map(n => <div className="rb-skeleton-card motion-shimmer" key={n} />)}</div>
    <div className="rb-skeleton-card rb-skeleton-wide motion-shimmer" />
    <div className="rb-skeleton-card rb-skeleton-wide motion-shimmer" />
    <span className="rb-sr">Loading market rotation intelligence</span>
  </main>;
}

function ErrorState({ error, onRetry }) {
  return <div className="rb-state rb-error">
    <div className="rb-state-mark">!</div>
    <div><div className="rb-eyebrow">DATA REQUEST FAILED</div><h2>Rotation data could not be loaded</h2>
      <p>{typeof error === "string" ? error : error?.message || "The latest market-intelligence snapshot is unavailable. Existing market data has not been inferred."}</p>
      {onRetry && <button className="rb-button" onClick={onRetry}>Retry snapshot <span aria-hidden="true">↗</span></button>}
    </div>
  </div>;
}

function EmptyState({ onRetry }) {
  return <div className="rb-state">
    <div className="rb-state-mark">—</div>
    <div><div className="rb-eyebrow">AWAITING SNAPSHOT</div><h2>Rotation context is not ready</h2>
      <p>No usable crypto or macro snapshot was supplied. Scores remain unavailable until source history is sufficient.</p>
      {onRetry && <button className="rb-button" onClick={onRetry}>Check again <span aria-hidden="true">↗</span></button>}
    </div>
  </div>;
}

const FACTOR_NAMES = {
  netLiquidity: "Net liquidity", dxy: "US dollar index", treasury10y: "10Y Treasury yield",
  vix: "Volatility index", btcEtfFlows: "Bitcoin ETF flows", nasdaq: "Nasdaq",
  wti: "WTI crude", fedPolicyProxy: "Fed policy proxy", gold: "Gold",
};

function MacroFactors({ factors }) {
  if (!Array.isArray(factors) || !factors.length) {
    return <div className="rb-empty-inline">Factor observations will appear when macro history is available.</div>;
  }
  return <div className="rb-factor-list">
    {factors.map((f, i) => {
      const tone = f.error ? C.red : f.stale || f.status === "warming_up" ? C.amber : C.green;
      return <div className="rb-factor" key={`${f.factor || "factor"}-${i}`}>
        <div className="rb-factor-name"><span className="rb-factor-dot" style={{ background: tone }} />
          <span>{FACTOR_NAMES[f.factor] || labelize(f.factor)}</span>
        </div>
        <div className="rb-factor-value">{finite(f.rawValue) ? num(f.rawValue, 2) : "—"}</div>
        <div className={`rb-factor-change ${finite(f.change20d) ? Number(f.change20d) >= 0 ? "is-up" : "is-down" : ""}`}>
          {finite(f.change20d) ? `${Number(f.change20d) > 0 ? "+" : ""}${num(f.change20d, 2)}` : "—"}
        </div>
        <div className="rb-factor-score">{finite(f.scaledScore) ? num(f.scaledScore, 0) : "—"}</div>
        <div className="rb-factor-weight">{finite(f.weight) ? `${(Number(f.weight) * 100).toFixed(0)}%` : "—"}</div>
        <Badge tone={tone}>{f.error ? "error" : f.stale && f.status === "ready" ? "stale" : f.status || "unavailable"}</Badge>
        <div className="rb-factor-date">{asDate(f.rawAsOf)}</div>
        {f.error && <div className="rb-factor-error">{f.error}</div>}
      </div>;
    })}
  </div>;
}

function LadderSummary({ ladder }) {
  if (!ladder || typeof ladder !== "object") {
    return <div className="rb-empty-inline">Ladder readings are unavailable in this snapshot.</div>;
  }
  const rungs = Array.isArray(ladder.rungs) ? ladder.rungs : [];
  const entries = Object.entries(ladder)
    .filter(([key, value]) => key !== "rungs" && (value == null || ["string", "number", "boolean"].includes(typeof value)))
    .slice(0, 8);
  return <>
    {rungs.length > 0 && <div style={{ display: "grid", gap: 7 }}>
      {rungs.map((rung, index) => <div key={`${rung.name || "rung"}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(90px,1fr) repeat(3,minmax(70px,1fr))", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 10 }}>
        <strong style={{ color: C.text }}>{labelize(rung.name)}</strong>
        <span style={{ color: C.muted }}>20D {pct(finite(rung.return20d) ? Number(rung.return20d) * 100 : null)}</span>
        <span style={{ color: C.muted }}>VOL {pct(finite(rung.realizedVol) ? Number(rung.realizedVol) * 100 : null)}</span>
        <span style={{ color: C.cyan }}>ADJ {num(rung.riskAdjustedReturn, 2)}</span>
      </div>)}
    </div>}
    {entries.length > 0 && <div className="rb-ladder-grid" style={{ marginTop: rungs.length ? 14 : 0 }}>{entries.map(([key, value]) => (
      <div className="rb-ladder-cell" key={key}><span>{labelize(key)}</span>
        <strong>{typeof value === "boolean" ? (value ? "Yes" : "No") : finite(value) ? num(value, 2) : value == null ? "—" : String(value)}</strong>
      </div>
    ))}</div>}
    {!entries.length && !rungs.length && <div className="rb-empty-inline">No ladder readings reported.</div>}
  </>;
}

export default function RotationBrainPage({ data, loading = false, error, onRetry }) {
  const [showAllFactors, setShowAllFactors] = useState(false);
  if (loading && !data) return <Skeleton />;
  if (error && !data) return <main className="rb-shell"><style>{STYLES}</style><ErrorState error={error} onRetry={onRetry} /></main>;
  if (!data) return <main className="rb-shell"><style>{STYLES}</style><EmptyState onRetry={onRetry} /></main>;

  const crypto = data.crypto || {};
  const asi = crypto.asi || {};
  const dominance = crypto.dominance || {};
  const ethBtc = crypto.ethBtc || {};
  const macro = data.macro || {};
  const factors = Array.isArray(macro.factors) ? macro.factors : [];
  const macroFactors = showAllFactors ? factors : factors.filter(f => f.factor !== "gold");
  const cryptoStatus = crypto.status || data.status;
  const status = error ? "partial" : data.status || "unavailable";
  const isPartial = ["partial", "warming_up"].includes(status) || cryptoStatus === "warming_up";
  const asiValue = asi.composite;
  const asiColor = finite(asiValue) ? Number(asiValue) >= 60 ? C.green : Number(asiValue) >= 40 ? C.gold : C.blue : C.muted;
  const dayRows = [
    ["30 day", asi.day30], ["60 day", asi.day60], ["90 day", asi.day90],
  ];
  const tierRows = [
    ["Ranks 2–10", asi.tiers?.ranks2to10],
    ["Ranks 11–50", asi.tiers?.ranks11to50],
    ["Ranks 51–100", asi.tiers?.ranks51to100],
  ];
  const macroScore = macro.score;
  const macroTone = finite(macroScore) ? Number(macroScore) >= 30 ? C.green : Number(macroScore) <= -30 ? C.red : C.gold : C.muted;
  const macroLabel = macro.label || "UNAVAILABLE";
  const leaders = String(ethBtc.leadership || "").toUpperCase();
  const leadershipColor = leaders === "LEADING" ? C.green : leaders === "LAGGING" ? C.red : C.gold;

  return <main className="rb-shell">
    <style>{STYLES}</style>
    <div className="rb-topline"><span className="rb-brand-mark">CQ</span><span>CLVRQUANT</span><span className="rb-topline-sep">/</span><span className="rb-topline-section">ROTATION BRAIN</span>
      <div className="rb-live-context"><span className={`rb-status-dot ${status === "ready" ? "is-live" : ""}`} /> MARKET INTELLIGENCE
        <Badge tone={statusColor(status)}>{labelize(status)}</Badge>
      </div>
    </div>

    {error && data && <div className="rb-inline-alert" role="status"><strong>Refresh issue</strong> Showing the last available snapshot. {typeof error === "string" ? error : error.message || ""}{onRetry && <button onClick={onRetry}>Retry</button>}</div>}
    {loading && data && <div className="rb-refresh-line"><span /> Updating snapshot · last data remains visible</div>}
    {isPartial && <div className="rb-quality-note"><span className="rb-note-mark">i</span><span><strong>Coverage is incomplete.</strong> Some indicators are warming up, stale, or missing source history. Unavailable readings are shown as dashes and are not counted as zero.</span></div>}

    <header className="rb-page-head">
      <div><div className="rb-eyebrow">MARKET REGIME / DAILY READ</div><h1>Rotation <span>Brain</span></h1>
        <p>Measure whether breadth is moving beyond Bitcoin — then check if the wider tape agrees.</p>
      </div>
      <div className="rb-snapshot-meta">
        <div><span>CRYPTO SNAPSHOT</span><strong>{asDate(data.cryptoSnapshotDate || crypto.asOf)}</strong></div>
        <div><span>MACRO SNAPSHOT</span><strong>{asDate(data.macroSnapshotDate || macro.asOf)}</strong></div>
      </div>
    </header>

    <div className="rb-overview">
      <section className="rb-hero-score">
        <div className="rb-hero-head"><span className="rb-eyebrow">ALTCOIN BREADTH INDEX <Tip>{TIPS.asi}</Tip></span><Badge tone={statusColor(cryptoStatus)}>{labelize(cryptoStatus)}</Badge></div>
        <div className="rb-score-row">
          <div className="rb-score-number" style={{ color: asiColor }}>{finite(asiValue) ? num(asiValue, 1) : "—"}<small>{finite(asiValue) ? "/100" : ""}</small></div>
          <div className="rb-score-copy">
            <div className="rb-regime">{labelize(asi.confirmedLabel || asi.candidateLabel || "warming_up")}</div>
            <div className="rb-regime-sub">{asi.confirmedLabel ? "Confirmed regime" : asi.candidateLabel ? "Candidate · awaiting confirmation" : "Regime not yet established"}</div>
          </div>
        </div>
        <Progress value={asiValue} color={asiColor} />
        <div className="rb-hero-foot">
          <span>{finite(asi.eligible) ? `${asi.eligible} eligible assets` : "Eligible universe unavailable"}</span>
          <span>{finite(asi.candidateConsecutiveDays) ? `${asi.candidateConsecutiveDays} consecutive day${Number(asi.candidateConsecutiveDays) === 1 ? "" : "s"}` : "Confirmation history unavailable"}</span>
        </div>
      </section>
      <section className="rb-overview-side">
        <Metric label="90D CAP-WEIGHTED" value={pct(asi.capWeighted90)} sub="Outperforming altcoin cap share" tip={TIPS.cap} />
        <Metric label="BREADTH MOMENTUM" value={pp(asi.momentum30Minus90)} sub="30D index less 90D index" tip={TIPS.momentum} color={finite(asi.momentum30Minus90) ? Number(asi.momentum30Minus90) >= 0 ? C.green : C.red : C.muted} />
        <Metric label="MEDIAN 90D EXCESS" value={pct(asi.medianExcess90, 1, true)} sub="Median altcoin return above BTC" />
        <Metric label="INSUFFICIENT HISTORY" value={finite(asi.excludedInsufficientHistory) ? num(asi.excludedInsufficientHistory, 0) : "—"} sub="Excluded from eligible set" />
      </section>
    </div>

    <div className="rb-main-grid">
      <Panel title="Breadth across time" eyebrow="CRYPTO ROTATION" aside={<Tip>{TIPS.asi}</Tip>}>
        <div className="rb-window-grid">
          {dayRows.map(([label, row]) => <div className="rb-window" key={label}>
            <div className="rb-window-label">{label}</div><div className="rb-window-score">{pct(row?.asi, 1)}</div>
            <Progress value={row?.asi} color={C.cyan} />
            <div className="rb-window-note">{finite(row?.wins) ? `${row.wins} winners` : "Winners unavailable"} / {finite(row?.eligible) ? `${row.eligible} eligible` : "—"}</div>
          </div>)}
        </div>
        <div className="rb-subhead"><span>UNIVERSE TIERS</span><span>90D COMPOSITE · WINS</span></div>
        <div className="rb-tier-table">
          {tierRows.map(([name, row]) => <div className="rb-tier-row" key={name}>
            <span>{name}</span><span className="rb-tier-bar"><Progress value={row?.asi} color={C.gold} /></span>
            <strong>{pct(row?.asi, 1)}</strong><span className="rb-tier-wins">{finite(row?.wins) ? `${row.wins} wins` : "—"}{finite(row?.eligible) ? ` / ${row.eligible}` : ""}</span>
          </div>)}
        </div>
        <div className="rb-footnote">ASI compares each eligible asset's total return with BTC over the same horizon. It is not a forecast.</div>
      </Panel>

      <Panel title="Bitcoin dominance" eyebrow="CAPITAL ROTATION" aside={<Tip>{TIPS.dominance}</Tip>}>
        <div className="rb-dominance-banner">
          <div><span className="rb-metric-label">30D EX-STABLE CHANGE</span><strong className={finite(dominance.change30dPp) ? Number(dominance.change30dPp) < 0 ? "is-up" : Number(dominance.change30dPp) > 0 ? "is-down" : "" : ""}>{pp(dominance.change30dPp)}</strong></div>
          <Badge tone={dominance.regime === "ALT_ROTATION" ? C.green : dominance.regime === "STRONG_BTC" ? C.red : C.gold}>{labelize(dominance.regime || "warming_up")}</Badge>
        </div>
        <div className="rb-compact-metrics">
          <Metric label="RAW BTC SHARE" value={pct(dominance.raw)} />
          <Metric label="EX-STABLE SHARE" value={pct(dominance.exStables)} />
          <Metric label="USDT + USDC SHARE" value={pct(dominance.usdtUsdcShare)} />
          <Metric label="STABLE SHARE · 30D" value={pp(dominance.stableShareChange30dPp)} />
        </div>
        {dominance.divergence === true && <div className="rb-divergence"><span>REGIME DIVERGENCE</span> Breadth is elevated, but dominance has not confirmed broad alt rotation.</div>}
        {dominance.altSeasonConfirmed === true && <div className="rb-confirmed">ALT SEASON CONFIRMED · breadth, persistence and dominance align</div>}
      </Panel>
    </div>

    <div className="rb-main-grid rb-second-grid">
      <Panel title="Leadership quality" eyebrow="ETH / BTC" aside={<Tip>{TIPS.ethbtc}</Tip>}>
        <div className="rb-leadership">
          <div><span className="rb-metric-label">ETH / BTC RATIO</span><strong>{finite(ethBtc.ratio) ? Number(ethBtc.ratio).toFixed(5) : "—"}</strong></div>
          <Badge tone={leadershipColor}>{labelize(ethBtc.leadership || "unavailable")}</Badge>
        </div>
        <div className="rb-compact-metrics">
          <Metric label="30D RELATIVE RETURN" value={finite(ethBtc.return30d) ? `${Number(ethBtc.return30d) > 0 ? "+" : ""}${(Number(ethBtc.return30d) * 100).toFixed(1)}%` : "—"} color={finite(ethBtc.return30d) ? Number(ethBtc.return30d) >= 0 ? C.green : C.red : C.muted} />
          <Metric label="ABOVE 50D AVG" value={ethBtc.above50d == null ? "—" : ethBtc.above50d ? "YES" : "NO"} />
          <Metric label="ABOVE 200D AVG" value={ethBtc.above200d == null ? "—" : ethBtc.above200d ? "YES" : "NO"} />
          <Metric label="RALLY BREADTH" value={ethBtc.narrowRally == null ? "—" : ethBtc.narrowRally ? "NARROW" : "BROAD"} />
        </div>
        <div className="rb-footnote">A leadership signal requires sustained relative strength; moving-average readings are unavailable when history is insufficient.</div>
      </Panel>
      <Panel title="Risk backdrop" eyebrow="MACRO REGIME" aside={<Tip>{TIPS.macro}</Tip>}>
        <div className="rb-macro-score">
          <div className="rb-macro-value" style={{ color: macroTone }}>{finite(macroScore) ? `${Number(macroScore) > 0 ? "+" : ""}${num(macroScore, 1)}` : "—"}</div>
          <div><div className="rb-regime">{labelize(macroLabel)}</div><div className="rb-regime-sub">{finite(macro.activeFactorCount) ? `${macro.activeFactorCount} / ${factors.filter(f => Number(f.weight) > 0).length || 8} active factors` : "Factor coverage unavailable"}</div></div>
          <Badge tone={statusColor(macro.status)}>{labelize(macro.status || "unavailable")}</Badge>
        </div>
        <div className="rb-macro-meta">
          <span>WEIGHT COVERED <strong>{finite(macro.activeWeight) ? `${(Number(macro.activeWeight) * 100).toFixed(0)}%` : "—"}</strong></span>
          <span>VIX SHOCK <strong style={{ color: macro.vixShock === true ? C.red : macro.vixShock === false ? C.green : C.muted }}>{macro.vixShock == null ? "UNKNOWN" : macro.vixShock ? "YES" : "NO"}</strong></span>
          {finite(macro.activeFactorCount) && <span>ACTIVE FACTORS <strong>{num(macro.activeFactorCount, 0)}</strong></span>}
        </div>
      </Panel>
    </div>

    <Panel title="Macro factor monitor" eyebrow="EVIDENCE PANEL" className="rb-factor-panel"
      aside={<button className="rb-text-button" onClick={() => setShowAllFactors(v => !v)}>{showAllFactors ? "Hide zero-weight reference" : "Show all factors"} <span aria-hidden="true">{showAllFactors ? "−" : "+"}</span></button>}>
      <div className="rb-factor-header"><span>FACTOR</span><span>RAW</span><span>20D Δ</span><span>SCORE</span><span>WEIGHT</span><span>QUALITY</span><span>OBSERVED</span></div>
      <MacroFactors factors={macroFactors} />
      <div className="rb-footnote">Score is a clipped standardized change scaled to −100…+100, with direction adjusted for risk impact. Raw units vary by factor. Stale, errored and warming-up inputs are not included.</div>
    </Panel>

    <Panel title="Risk appetite" eyebrow="POSITIONING & SENTIMENT" aside={<Badge tone={statusColor(crypto.sentiment?.status)}>{labelize(crypto.sentiment?.status || "unavailable")}</Badge>}>
      <div className="rb-sentiment-row">
        <div className="rb-sentiment-score">
          <span className="rb-metric-label">NORMALIZED SCORE</span>
          <strong>{finite(crypto.sentiment?.score) ? num(crypto.sentiment.score, 1) : "—"}</strong>
          <Badge tone={C.gold}>{labelize(crypto.sentiment?.label || "unavailable")}</Badge>
        </div>
        <div className="rb-sentiment-factors">
          {Array.isArray(crypto.sentiment?.factors) && crypto.sentiment.factors.length
           ? crypto.sentiment.components.map((f, i) => <div className="rb-sentiment-factor" key={`${f.name || f.factor || i}`}>
              <span>{labelize(f.name || f.factor)}</span><strong>{finite(f.percentile) ? `${num(f.percentile, 0)}th pct` : finite(f.value) ? num(f.value, 2) : "—"}</strong>
              <span className="rb-sentiment-weight">{finite(f.weight) ? `${(Number(f.weight) * 100).toFixed(0)}% weight` : f.stale ? "stale" : "unavailable"}</span>
            </div>)
            : <div className="rb-empty-inline">Sentiment component history is still accumulating.</div>}
        </div>
      </div>
    </Panel>

    <Panel title="Rotation ladder" eyebrow="CROSS-ASSET CHECK">
      <LadderSummary ladder={crypto.ladder} />
    </Panel>
    <footer className="rb-footer"><span>CLVRQUANT / ROTATION BRAIN</span><span>Evidence first. Missing is not zero.</span><span>Snapshot · {asDate(data.cryptoSnapshotDate || crypto.asOf)}</span></footer>
  </main>;
}

const STYLES = `
.rb-shell{--bg:${C.bg};--panel:${C.panel};--panel2:${C.panel2};--line:${C.line};--linehi:${C.lineHi};--text:${C.text};--muted:${C.muted};--dim:${C.dim};--gold:${C.gold};--cyan:${C.cyan};max-width:1440px;margin:0 auto;padding:24px clamp(16px,3.3vw,48px) 34px;background:radial-gradient(ellipse at 86% 0%,rgba(83,200,207,.07),transparent 33%),var(--bg);color:var(--text);font-family:${SANS};min-height:100dvh;font-size:14px;line-height:1.45}
.rb-shell *{box-sizing:border-box}.rb-shell button{font-family:inherit}.rb-topline{height:34px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);font:600 10px ${MONO};letter-spacing:.11em;color:#b5c2d1;padding-bottom:13px}.rb-brand-mark{width:23px;height:23px;border:1px solid rgba(216,180,90,.55);color:var(--gold);display:grid;place-items:center;font:700 9px ${MONO};letter-spacing:-.06em}.rb-topline-sep{color:var(--dim)}.rb-topline-section{color:var(--gold);letter-spacing:.14em}.rb-live-context{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:9px}.rb-status-dot{width:6px;height:6px;border-radius:50%;background:${C.amber}}.rb-status-dot.is-live{background:${C.green};box-shadow:0 0 0 3px rgba(71,201,155,.11)}
.rb-page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:32px 0 25px}.rb-eyebrow{font:600 9px ${MONO};letter-spacing:.15em;color:var(--cyan);text-transform:uppercase;display:flex;gap:7px;align-items:center}.rb-page-head h1{font:600 clamp(34px,4.5vw,56px)/1.05 ${SANS};letter-spacing:-.045em;margin:7px 0 9px;color:#eef3f8}.rb-page-head h1 span{color:var(--gold);font-weight:400}.rb-page-head p{margin:0;color:#91a0b2;font-size:14px}.rb-snapshot-meta{display:flex;gap:25px;padding-bottom:4px}.rb-snapshot-meta div{display:grid;gap:5px}.rb-snapshot-meta span{font:500 8px ${MONO};letter-spacing:.12em;color:var(--dim)}.rb-snapshot-meta strong{font:500 10px ${MONO};color:#aab8c9}
.rb-badge{display:inline-flex;align-items:center;white-space:nowrap;border:1px solid color-mix(in srgb,var(--badge) 32%,transparent);background:color-mix(in srgb,var(--badge) 9%,transparent);color:var(--badge);padding:4px 7px;border-radius:2px;font:600 8px ${MONO};letter-spacing:.075em;text-transform:uppercase}.rb-tip{position:relative;display:inline-flex;vertical-align:middle}.rb-tip summary{list-style:none;cursor:pointer;width:15px;height:15px;display:grid;place-items:center;color:#91a0b2;border:1px solid #334457;border-radius:50%;font:600 9px ${MONO};transition:color .15s,border-color .15s}.rb-tip summary::-webkit-details-marker{display:none}.rb-tip summary:hover{color:var(--cyan);border-color:var(--cyan)}.rb-tip[open] div{position:absolute;z-index:5;top:23px;left:-4px;width:min(270px,75vw);padding:11px 12px;background:#172333;border:1px solid #34465a;box-shadow:0 12px 28px #0009;color:#c0ccda;font:400 11px/1.55 ${SANS};letter-spacing:0;white-space:normal}.rb-tip[open] summary{color:var(--cyan);border-color:var(--cyan)}
.rb-overview{display:grid;grid-template-columns:minmax(300px,.92fr) minmax(0,1.6fr);gap:12px;margin-bottom:12px}.rb-hero-score{position:relative;overflow:hidden;padding:20px 22px 17px;background:linear-gradient(115deg,#13202d 0%,#101822 64%,#111925 100%);border:1px solid #33404c;min-height:200px}.rb-hero-score:after{content:"";position:absolute;width:260px;height:260px;border:1px solid rgba(83,200,207,.10);border-radius:50%;right:-90px;top:-120px;box-shadow:0 0 0 30px rgba(83,200,207,.025),0 0 0 65px rgba(83,200,207,.02);pointer-events:none}.rb-hero-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.rb-score-row{display:flex;align-items:center;gap:17px;margin:18px 0 12px}.rb-score-number{font:500 clamp(54px,6vw,76px)/.95 ${MONO};letter-spacing:-.09em}.rb-score-number small{font-size:14px;letter-spacing:0;color:var(--dim);margin-left:7px}.rb-regime{font:600 15px ${MONO};color:#edf3f7;letter-spacing:.035em}.rb-regime-sub{font:400 10px ${SANS};color:var(--muted);margin-top:4px}.rb-progress{height:4px;background:#283443;overflow:hidden}.rb-progress span{height:100%;display:block;transition:width 450ms ease;transform-origin:left}.rb-progress-empty{height:4px;background:repeating-linear-gradient(135deg,#263442,#263442 4px,#1a2632 4px,#1a2632 8px);font-size:0}.rb-hero-foot{display:flex;justify-content:space-between;gap:10px;padding-top:9px;color:#8494a7;font:400 9px ${MONO}}
.rb-overview-side{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--panel);border:1px solid var(--line)}.rb-metric{min-width:0;padding:17px 15px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.rb-overview-side .rb-metric:nth-child(4n){border-right:0}.rb-overview-side .rb-metric:nth-child(n+5){border-bottom:0}.rb-metric-label{display:flex;align-items:center;gap:6px;color:#8292a5;font:500 8px ${MONO};letter-spacing:.1em;min-height:15px}.rb-metric-value{color:#e1e9f1;font:500 clamp(19px,2vw,25px)/1.25 ${MONO};margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rb-metric-sub{color:var(--dim);font-size:10px;margin-top:5px;line-height:1.35}
.rb-main-grid{display:grid;grid-template-columns:1.12fr .88fr;gap:12px;margin-bottom:12px}.rb-panel{background:var(--panel);border:1px solid var(--line);padding:18px 19px;margin-bottom:12px;min-width:0}.rb-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:17px}.rb-panel-head h2{font:600 18px/1.2 ${SANS};letter-spacing:-.015em;color:#e3ebf3;margin:5px 0 0}.rb-panel-aside{display:flex;align-items:center;gap:8px}.rb-window-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line)}.rb-window{padding:13px 14px;border-right:1px solid var(--line)}.rb-window:last-child{border-right:0}.rb-window-label{font:500 9px ${MONO};color:var(--muted);letter-spacing:.07em}.rb-window-score{font:500 24px ${MONO};color:#dbe6ef;margin:8px 0 11px}.rb-window-note{color:var(--dim);font:400 9px ${MONO};margin-top:8px}.rb-subhead{display:flex;justify-content:space-between;margin:20px 0 7px;color:var(--dim);font:500 8px ${MONO};letter-spacing:.12em}.rb-tier-row{display:grid;grid-template-columns:100px minmax(45px,1fr) 54px 78px;gap:12px;align-items:center;padding:10px 0;border-top:1px solid rgba(29,42,59,.75);font:500 10px ${MONO};color:#b4c1ce}.rb-tier-row strong{text-align:right;color:#dce6f2;font-weight:500}.rb-tier-wins{text-align:right;color:var(--dim);font-size:9px}.rb-footnote{font:400 10px/1.5 ${SANS};color:#697a8e;margin-top:14px}
.rb-dominance-banner{display:flex;justify-content:space-between;align-items:center;background:#111c29;border:1px solid #263849;padding:14px 15px;margin:2px 0 11px}.rb-dominance-banner>div{display:grid;gap:5px}.rb-dominance-banner strong{font:500 26px ${MONO};color:#e2eaf0}.is-up{color:${C.green}!important}.is-down{color:${C.red}!important}.rb-compact-metrics{display:grid;grid-template-columns:1fr 1fr}.rb-compact-metrics .rb-metric{padding:12px 12px;border-bottom:1px solid var(--line)}.rb-compact-metrics .rb-metric:nth-child(odd){border-right:1px solid var(--line)}.rb-compact-metrics .rb-metric:nth-child(even){border-right:0}.rb-compact-metrics .rb-metric:nth-last-child(-n+2){border-bottom:0}.rb-compact-metrics .rb-metric-value{font-size:17px;margin-top:5px}.rb-divergence,.rb-confirmed{margin-top:13px;padding:10px 11px;border-left:2px solid ${C.amber};background:rgba(231,169,86,.07);color:#b7a27f;font-size:10px;line-height:1.5}.rb-divergence span{font:600 8px ${MONO};letter-spacing:.1em;color:${C.amber};display:block;margin-bottom:2px}.rb-confirmed{border-color:${C.green};background:rgba(71,201,155,.06);color:${C.green};font:600 8px ${MONO};letter-spacing:.08em}.rb-leadership{display:flex;align-items:center;justify-content:space-between;background:#111c29;padding:14px;border:1px solid #263849;margin-bottom:10px}.rb-leadership>div{display:grid;gap:4px}.rb-leadership strong{font:500 23px ${MONO};color:#e4edf4}.rb-macro-score{display:flex;align-items:center;gap:13px;padding:3px 0 15px;border-bottom:1px solid var(--line)}.rb-macro-value{font:500 42px/.95 ${MONO};letter-spacing:-.07em;min-width:95px}.rb-macro-score .rb-badge{margin-left:auto}.rb-macro-meta{display:flex;gap:22px;flex-wrap:wrap;padding-top:13px}.rb-macro-meta span{display:grid;gap:4px;font:500 8px ${MONO};color:var(--dim);letter-spacing:.08em}.rb-macro-meta strong{font:500 11px ${MONO};color:#d1dce7;letter-spacing:0}
.rb-factor-panel{padding-bottom:13px}.rb-text-button{border:0;background:transparent;color:var(--cyan);cursor:pointer;font:500 9px ${MONO};letter-spacing:.05em;padding:6px 0}.rb-text-button:hover{color:#b9f5f1}.rb-factor-header,.rb-factor{display:grid;grid-template-columns:minmax(145px,1.5fr) .65fr .65fr .55fr .5fr 94px 150px;gap:10px;align-items:center}.rb-factor-header{padding:0 9px 8px;color:var(--dim);font:500 8px ${MONO};letter-spacing:.1em;border-bottom:1px solid var(--line)}.rb-factor{position:relative;padding:10px 9px;border-bottom:1px solid rgba(29,42,59,.72);font:400 10px ${MONO};color:#abb9c8}.rb-factor:hover{background:rgba(83,200,207,.035)}.rb-factor-name{display:flex;gap:9px;align-items:center;color:#d0dbe6;font:500 11px ${SANS}}.rb-factor-dot{width:6px;height:6px;border-radius:50%}.rb-factor-change,.rb-factor-score,.rb-factor-value,.rb-factor-weight{color:#bdc9d6}.rb-factor-weight{color:var(--muted)}.rb-factor .rb-badge{justify-self:start}.rb-factor-date{color:var(--dim);font-size:9px}.rb-factor-error{grid-column:1/-1;color:${C.red};font:400 10px ${SANS};padding:2px 15px}.rb-empty-inline{padding:18px 6px;color:var(--muted);font:400 11px ${SANS};text-align:center}.rb-sentiment-row{display:grid;grid-template-columns:200px 1fr;gap:20px}.rb-sentiment-score{display:flex;align-items:flex-start;gap:8px;flex-direction:column;padding:13px;background:#111c29;border:1px solid #263849}.rb-sentiment-score strong{font:500 34px ${MONO};color:#e0eaf4}.rb-sentiment-factors{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rb-sentiment-factor{display:grid;gap:6px;padding:10px 11px;background:#101923;border:1px solid var(--line);min-width:0}.rb-sentiment-factor span:first-child{font:500 9px ${SANS};color:#aab8c6}.rb-sentiment-factor strong{font:500 13px ${MONO};color:#dce5ee}.rb-sentiment-weight{font:400 8px ${MONO};color:var(--dim)}.rb-ladder-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.rb-ladder-cell{border:1px solid var(--line);padding:11px;display:flex;flex-direction:column;gap:8px}.rb-ladder-cell span{font:500 8px ${MONO};color:var(--muted);letter-spacing:.06em}.rb-ladder-cell strong{font:500 13px ${MONO};color:#d7e1eb}.rb-footer{padding:15px 0 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;color:var(--dim);font:500 8px ${MONO};letter-spacing:.07em}
.rb-quality-note,.rb-inline-alert,.rb-refresh-line{display:flex;align-items:center;gap:9px;margin-top:12px;padding:10px 12px;background:rgba(231,169,86,.07);border:1px solid rgba(231,169,86,.2);color:#b9a987;font-size:11px;line-height:1.4}.rb-quality-note strong{color:#e3c27e}.rb-note-mark{display:grid;place-items:center;flex:0 0 17px;height:17px;border:1px solid #8d7142;border-radius:50%;font:600 9px ${MONO};color:${C.amber}}.rb-inline-alert{background:rgba(240,120,120,.07);border-color:rgba(240,120,120,.24);color:#d3a3a3}.rb-inline-alert strong{color:#f09595}.rb-inline-alert button{margin-left:auto;color:#f09595;background:transparent;border:1px solid rgba(240,120,120,.35);padding:5px 9px;cursor:pointer;font:500 9px ${MONO}}.rb-refresh-line{position:relative;overflow:hidden;height:2px;padding:0;border:0;background:#182536;font-size:0;margin-top:0}.rb-refresh-line span{position:absolute;inset:0 auto 0 0;width:32%;background:var(--cyan);animation:rb-refresh 1.4s ease-in-out infinite}.rb-state{max-width:690px;margin:70px auto;display:flex;gap:20px;padding:25px;background:#101923;border:1px solid var(--linehi);align-items:flex-start}.rb-error{border-color:rgba(240,120,120,.35)}.rb-state-mark{display:grid;place-items:center;width:42px;height:42px;flex-shrink:0;border:1px solid #36495d;color:var(--cyan);font:500 20px ${MONO}}.rb-error .rb-state-mark{color:${C.red};border-color:rgba(240,120,120,.4)}.rb-state h2{margin:7px 0;color:#e4edf5;font:600 20px ${SANS}}.rb-state p{margin:0 0 14px;color:#91a0b2;font:400 12px/1.6 ${SANS};max-width:500px}.rb-button{border:1px solid rgba(83,200,207,.38);background:rgba(83,200,207,.08);color:#8de0df;padding:9px 12px;font:500 10px ${MONO};cursor:pointer;transition:transform .15s,background .15s}.rb-button:hover{background:rgba(83,200,207,.14);transform:translateY(-1px)}.rb-button span{margin-left:10px}.rb-loading-top,.rb-skeleton-card{background:#121c29;border:1px solid var(--line);}.rb-loading-top{height:34px;margin-bottom:25px}.rb-skeleton-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}.rb-skeleton-card{height:200px}.rb-skeleton-grid .rb-skeleton-card{height:185px}.rb-skeleton-wide{height:280px;margin-bottom:12px}.rb-shell .motion-shimmer{position:relative;overflow:hidden}.rb-shell .motion-shimmer:after{content:"";position:absolute;inset:0;width:35%;background:linear-gradient(90deg,transparent,rgba(172,205,221,.06),transparent);animation:rb-shimmer 1.5s ease-in-out infinite;transform:translateX(-200%)}.rb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@keyframes rb-shimmer{to{transform:translateX(400%)}}@keyframes rb-refresh{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}
@media(max-width:980px){.rb-overview{grid-template-columns:1fr}.rb-overview-side{min-height:132px}.rb-main-grid{grid-template-columns:1fr}.rb-factor-header,.rb-factor{grid-template-columns:minmax(130px,1.4fr) .6fr .7fr .5fr 75px 125px}.rb-factor-header span:nth-child(5),.rb-factor-weight{display:none}.rb-factor-header{grid-template-columns:minmax(130px,1.4fr) .6fr .7fr .5fr 75px 125px}.rb-factor{grid-template-columns:minmax(130px,1.4fr) .6fr .7fr .5fr 75px 125px}.rb-factor .rb-badge{grid-column:5}.rb-factor-date{grid-column:6}}
@media(max-width:680px){.rb-shell{padding:15px 12px 25px}.rb-topline{gap:7px}.rb-live-context{font-size:0;gap:5px}.rb-live-context .rb-badge{font-size:7px}.rb-page-head{align-items:flex-start;flex-direction:column;padding:25px 0 18px;gap:16px}.rb-snapshot-meta{width:100%;justify-content:space-between;gap:10px}.rb-snapshot-meta strong{font-size:9px}.rb-overview-side{grid-template-columns:1fr 1fr}.rb-overview-side .rb-metric:nth-child(2n){border-right:0}.rb-overview-side .rb-metric:nth-child(4n){border-right:0}.rb-overview-side .rb-metric:nth-child(n+5){border-bottom:0}.rb-overview-side .rb-metric:nth-child(n+3){border-bottom:1px solid var(--line)}.rb-overview-side .rb-metric:nth-child(n+3):nth-last-child(-n+2){border-bottom:0}.rb-hero-score{padding:17px;min-height:180px}.rb-panel{padding:15px 13px}.rb-panel-head h2{font-size:17px}.rb-window{padding:11px 9px}.rb-window-score{font-size:19px}.rb-tier-row{grid-template-columns:79px minmax(28px,1fr) 48px 65px;gap:7px;font-size:9px}.rb-tier-wins{font-size:8px}.rb-compact-metrics .rb-metric{padding:11px 9px}.rb-compact-metrics .rb-metric-value{font-size:15px}.rb-sentiment-row{grid-template-columns:1fr}.rb-sentiment-factors{grid-template-columns:repeat(2,minmax(0,1fr))}.rb-ladder-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rb-factor-header{display:none}.rb-factor-list{display:grid;grid-template-columns:1fr 1fr;gap:7px}.rb-factor{grid-template-columns:1fr auto;gap:6px;padding:10px;border:1px solid var(--line);align-content:start}.rb-factor-name{grid-column:1/-1}.rb-factor-value:before{content:"RAW ";color:var(--dim);font-size:8px}.rb-factor-change:before{content:"20D Δ ";color:var(--dim);font-size:8px}.rb-factor-score:before{content:"SCORE ";color:var(--dim);font-size:8px}.rb-factor-weight{display:none}.rb-factor .rb-badge{grid-column:1;grid-row:4}.rb-factor-date{grid-column:2;grid-row:4;text-align:right;font-size:8px}.rb-factor-error{grid-column:1/-1;padding:0}.rb-macro-score{gap:9px}.rb-macro-value{font-size:35px;min-width:80px}.rb-macro-score .rb-regime{font-size:12px}.rb-macro-score .rb-badge{font-size:7px}.rb-footer{flex-wrap:wrap}.rb-footer span:last-child{width:100%}.rb-state{margin:35px auto;padding:17px;gap:13px}.rb-skeleton-grid{grid-template-columns:1fr 1fr}.rb-skeleton-grid .rb-skeleton-card{height:145px}}
@media(max-width:380px){.rb-window-grid{grid-template-columns:1fr}.rb-window{border-right:0;border-bottom:1px solid var(--line)}.rb-window:last-child{border-bottom:0}.rb-tier-row{grid-template-columns:70px 1fr 43px 56px}.rb-sentiment-factors{grid-template-columns:1fr}.rb-macro-meta{gap:12px}.rb-factor-list{grid-template-columns:1fr}.rb-hero-foot{font-size:8px}.rb-page-head p{font-size:12px}}
@media(prefers-reduced-motion:reduce){.rb-shell *,.rb-shell *:before,.rb-shell *:after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
`;
