import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/apiClient";

const C = {
  bg: "#000000",
  panel: "#090909",
  panel2: "#101010",
  line: "#242116",
  lineSoft: "#191710",
  gold: "#D4AF37",
  mint: "#00FF88",
  red: "#FF4D5E",
  text: "#E7E2D5",
  muted: "#918B7C",
  dim: "#625D52",
};
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";
const NA = "N/A";
const HERO_SYMBOLS = ["USDCAD", "EURUSD", "BTC", "WTI"];
const MACRO_SYMBOLS = ["VIX", "DXY", "US10Y", "SPX"];
const columns = [
  ["symbol", "Instrument"], ["price", "Last"], ["dayChangePct", "Day %"],
  ["trend", "Trend"], ["atr14", "ATR 14"], ["support", "Support"],
  ["resistance", "Resistance"], ["status", "Setup status"],
];
const valid = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const fmt = (value, digits = 2) => valid(value) ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : NA;
const signedPct = value => valid(value) ? `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%` : NA;
const stamp = value => {
  if (!valid(value)) return NA;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? NA : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
const ago = value => {
  if (!valid(value)) return NA;
  const seconds = Math.max(0, Math.floor((Date.now() - Number(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};
const safeArray = value => Array.isArray(value) ? value : [];
const toneFor = value => {
  const text = String(value || "").toLowerCase();
  if (text.includes("ready") || text.includes("on") || text.includes("bull")) return C.mint;
  if (text.includes("off") || text.includes("risk") || text.includes("bear")) return C.red;
  return C.gold;
};
const priceDigits = symbol => ["BTC", "WTI", "SPX", "VIX", "GOLD"].includes(symbol) ? 2 : ["US10Y"].includes(symbol) ? 3 : ["DXY"].includes(symbol) ? 3 : 5;
const displayPrice = (value, symbol) => valid(value) ? fmt(value, priceDigits(symbol)) : NA;

function SectionTitle({ kicker, children, aside }) {
  return <div className="ad-section-title"><div><span className="ad-kicker">{kicker}</span><h2>{children}</h2></div>{aside}</div>;
}

function Badge({ children, color }) {
  const hue = color || toneFor(children);
  return <span className="ad-badge" style={{ "--badge-color": hue }}>{children || NA}</span>;
}

function Metric({ label, value, sub, color }) {
  return <div className="ad-metric">
    <span className="ad-kicker">{label}</span>
    <strong style={color ? { color } : undefined}>{value}</strong>
    {sub && <small>{sub}</small>}
  </div>;
}

function MiniChart({ assets }) {
  const rows = assets.slice(0, 8).filter(asset => valid(asset.dayChangePct));
  if (!rows.length) return <div className="ad-chart-empty">Change observations unavailable in this snapshot.</div>;
  const max = Math.max(...rows.map(row => Math.abs(Number(row.dayChangePct))), 0.001);
  return <div className="ad-change-chart" role="img" aria-label="Single-session percentage changes across available assets">
    {rows.map(asset => {
      const value = Number(asset.dayChangePct);
      const width = Math.max(2, Math.abs(value) / max * 100);
      return <div className="ad-change-row" key={asset.symbol}>
        <span>{asset.symbol}</span>
        <div className="ad-change-track"><i className={value < 0 ? "negative" : ""} style={{ width: `${width}%` }} /></div>
        <b className={value < 0 ? "is-negative" : "is-positive"}>{signedPct(value)}</b>
      </div>;
    })}
  </div>;
}

function LevelChart({ asset }) {
  const entries = [
    { label: "Resistance", value: asset.resistance, color: C.red },
    { label: "MA 200", value: asset.ma200, color: "#8A7B56" },
    { label: "MA 50", value: asset.ma50, color: "#B99942" },
    { label: "MA 20", value: asset.ma20, color: "#E5C65B" },
    { label: "Last price", value: asset.price, color: C.mint, bold: true },
    { label: "Support", value: asset.support, color: C.gold },
    { label: "Stop", value: asset.stop, color: C.red },
    { label: "TP3", value: safeArray(asset.targets)[2], color: C.mint },
  ].filter(item => valid(item.value));
  if (!entries.length) return <div className="ad-chart-empty">Price and moving-average levels are unavailable.</div>;
  const values = entries.map(item => Number(item.value));
  const low = Math.min(...values), high = Math.max(...values);
  const span = high - low || Math.max(Math.abs(high) * 0.02, 1);
  return <div className="ad-level-plot">
    <div className="ad-level-scale"><span>{displayPrice(high, asset.symbol)}</span><span>{displayPrice(low, asset.symbol)}</span></div>
    <div className="ad-level-track">
      {[...entries].sort((a, b) => Number(b.value) - Number(a.value)).map((item, index) => {
        const top = 7 + ((high - Number(item.value)) / span) * 84;
        return <div className={`ad-level-line ${item.bold ? "current" : ""}`} key={`${item.label}-${index}`} style={{ top: `${top}%`, "--line-color": item.color }}>
          <span>{item.label}</span><b>{displayPrice(item.value, asset.symbol)}</b>
        </div>;
      })}
    </div>
    <p className="ad-chart-caption">Snapshot levels only · no intraday price history supplied</p>
  </div>;
}

function AssetDrawer({ asset, onClose }) {
  useEffect(() => {
    const handleKey = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  const levels = [
    ["Entry / last", displayPrice(asset.price, asset.symbol)],
    ["Day change", valid(asset.dayChange) ? `${Number(asset.dayChange) > 0 ? "+" : ""}${fmt(asset.dayChange, priceDigits(asset.symbol))}` : NA],
    ["Day change %", signedPct(asset.dayChangePct)],
    ["Previous close", displayPrice(asset.previousClose, asset.symbol)],
    ["52-week high", NA], ["52-week low", NA],
    ["ATR 14", displayPrice(asset.atr14, asset.symbol)],
    ["Support", displayPrice(asset.support, asset.symbol)],
    ["Resistance", displayPrice(asset.resistance, asset.symbol)],
    ["Stop", displayPrice(asset.stop, asset.symbol)],
    ["Risk / unit", displayPrice(asset.risk, asset.symbol)],
    ["TP3", displayPrice(safeArray(asset.targets)[2], asset.symbol)],
    ["R:R to TP3", valid(safeArray(asset.rrTargets)[2]) ? `${Number(asset.rrTargets[2]).toFixed(2)}R` : NA],
    ["Structural R:R", valid(asset.rrStructural) ? `${Number(asset.rrStructural).toFixed(2)}R` : NA],
  ];
  return <div className="ad-drawer-shade" onMouseDown={onClose}>
    <aside className="ad-drawer" role="dialog" aria-modal="true" aria-label={`${asset.symbol} detail`} onMouseDown={event => event.stopPropagation()}>
      <header className="ad-drawer-head"><div><span className="ad-kicker">INSTRUMENT DETAIL</span><h2>{asset.symbol}</h2></div><button className="ad-icon-button" onClick={onClose} aria-label="Close detail">×</button></header>
      <div className="ad-drawer-meta"><Badge color={toneFor(asset.status)}>{asset.status || NA}</Badge><span>Price source · {asset.priceSource || NA}</span></div>
      <div className="ad-detail-grid">{levels.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <section className="ad-drawer-section"><SectionTitle kicker="PRICE STRUCTURE">Levels & moving averages</SectionTitle><LevelChart asset={asset} /></section>
      <section className="ad-drawer-section"><SectionTitle kicker="RISK PROFILE">Volatility</SectionTitle>
        <div className="ad-vol-grid"><Metric label="REALIZED VOL · 30D" value={valid(asset.realizedVol30) ? `${(Number(asset.realizedVol30) * 100).toFixed(2)}%` : NA} />
          <Metric label="REALIZED VOL · 90D" value={valid(asset.realizedVol90) ? `${(Number(asset.realizedVol90) * 100).toFixed(2)}%` : NA} /></div>
        <div className="ad-atr-meter"><span>ATR 14</span><div><i style={{ width: valid(asset.atr14) && valid(asset.price) && Number(asset.price) !== 0 ? `${Math.min(100, Number(asset.atr14) / Number(asset.price) * 1000)}%` : "0%" }} /></div><b>{valid(asset.atr14) && valid(asset.price) && Number(asset.price) !== 0 ? `${(Number(asset.atr14) / Number(asset.price) * 100).toFixed(2)}% of price` : NA}</b></div>
        <p className="ad-chart-caption">ATR display is normalized to the supplied last price. Missing history is not inferred.</p>
      </section>
      <footer className="ad-drawer-foot">Observed {stamp(asset.updatedAt)} · {asset.supportBars ?? NA} support bars{asset.supportLimited ? " · limited history" : ""}</footer>
    </aside>
  </div>;
}

function UpgradeCard({ onUpgrade }) {
  return <main className="ad-shell"><style>{STYLES}</style>
    <div className="ad-upgrade">
      <span className="ad-mark">CQ</span><span className="ad-kicker">CLVRQUANT / ELITE ACCESS</span>
      <h1>Alpha Desk</h1><p>Cross-asset risk, live market context, and evidence-led technical levels are reserved for Elite traders.</p>
      <button className="ad-button ad-button-primary" onClick={() => onUpgrade?.()}>Explore Elite access</button>
    </div>
  </main>;
}

export default function AlphaDeskPage({ isElite, tier, onUpgrade }) {
  const elite = isElite !== false && (!tier || String(tier).toLowerCase() === "elite");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSuccess, setLastSuccess] = useState(null);
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState({ key: "symbol", dir: 1 });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [corrWindow, setCorrWindow] = useState(60);
  const [query, setQuery] = useState("");

  const load = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const response = await apiFetch("/api/alpha-desk/overview", { method: "GET", credentials: "include" });
      if (!response.ok) throw new Error(`Overview request failed (${response.status})`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("Market overview response was invalid");
      setData(payload);
      setError("");
      setLastSuccess(Date.now());
    } catch (requestError) {
      setError(requestError?.message || "Market data could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!elite) return undefined;
    load(true);
    const interval = window.setInterval(() => load(false), 45_000);
    return () => window.clearInterval(interval);
  }, [elite, load]);

  const assets = safeArray(data?.assets);
  const macro = safeArray(data?.macro);
  const allAssets = useMemo(() => [...assets, ...macro], [assets, macro]);
  const filteredAssets = useMemo(() => {
    const search = query.trim().toLowerCase();
    return assets.filter(asset => {
      const matchesSearch = !search || String(asset.symbol || "").toLowerCase().includes(search);
      const matchesStatus = statusFilter === "ALL" || String(asset.status || NA).toUpperCase() === statusFilter;
      return matchesSearch && matchesStatus;
    }).sort((a, b) => {
      const left = a[sort.key], right = b[sort.key];
      if (!valid(left) && !valid(right)) return String(left || "").localeCompare(String(right || "")) * sort.dir;
      if (!valid(left)) return 1;
      if (!valid(right)) return -1;
      return (typeof left === "number" ? Number(left) - Number(right) : String(left).localeCompare(String(right))) * sort.dir;
    });
  }, [assets, query, sort, statusFilter]);
  const statusOptions = useMemo(() => ["ALL", ...new Set(assets.map(asset => String(asset.status || NA).toUpperCase()))], [assets]);
  const freshnessTs = data?.sourceStatus?.livePricesUpdatedAt ?? data?.asOf;
  const stale = Boolean(error) || (valid(freshnessTs) && Date.now() - Number(freshnessTs) > 120_000);
  const heroAssets = HERO_SYMBOLS.map(symbol => assets.find(asset => asset.symbol === symbol)).filter(Boolean);
  const macroValue = symbol => macro.find(asset => asset.symbol === symbol);
  const correlationSymbols = useMemo(() => {
    const source = data?.correlationWindows?.[corrWindow] || data?.correlationMatrix;
    const names = safeArray(source).map(row => row.symbol);
    return names.length ? names : [];
  }, [data?.correlationMatrix, data?.correlationWindows, corrWindow]);
  const correlationMap = useMemo(() => new Map(safeArray(data?.correlationWindows?.[corrWindow] || data?.correlationMatrix).map(row => [row.symbol, row.values || {}])), [data?.correlationMatrix, data?.correlationWindows, corrWindow]);

  if (!elite) return <UpgradeCard onUpgrade={onUpgrade} />;

  const toggleSort = key => setSort(current => current.key === key ? { key, dir: -current.dir } : { key, dir: 1 });
  const corrValue = (left, right) => corrWindow === 60 ? correlationMap.get(left)?.[right] : null;
  const corrColor = value => {
    if (!valid(value)) return "rgba(212,175,55,.045)";
    const magnitude = Math.abs(Number(value));
    return Number(value) >= 0
      ? `rgba(0,255,136,${0.08 + magnitude * 0.44})`
      : `rgba(255,77,94,${0.08 + magnitude * 0.44})`;
  };

  return <main className="ad-shell">
    <style>{STYLES}</style>
    <div className="ad-topline"><span className="ad-mark">CQ</span><span>CLVRQUANT</span><i>/</i><strong>ALPHA DESK</strong><span className="ad-top-right"><span className={`ad-live-dot ${data && !stale ? "live" : ""}`} />{stale ? "STALE SNAPSHOT" : data ? "LIVE SNAPSHOT" : "CONNECTING"}</span></div>
    <div className="ad-riskbar">
      <span className="ad-risk-label">MARKET RISK</span>
      {[
        ["VIX", macroValue("VIX") ? displayPrice(macroValue("VIX").price, "VIX") : NA],
        ["REGIME", data?.vixRegime || NA],
        ["DXY", macroValue("DXY") ? displayPrice(macroValue("DXY").price, "DXY") : NA],
        ["US10Y", macroValue("US10Y") ? displayPrice(macroValue("US10Y").price, "US10Y") : NA],
        ["SPX", macroValue("SPX") ? displayPrice(macroValue("SPX").price, "SPX") : NA],
        ["RISK TONE", data?.riskTone || NA],
      ].map(([label, value]) => <div className="ad-risk-item" key={label}><span>{label}</span><b style={label === "RISK TONE" || label === "REGIME" ? { color: toneFor(value) } : undefined}>{value}</b></div>)}
      <div className="ad-risk-source"><span>LIVE PRICES</span><b>{ago(data?.sourceStatus?.livePricesUpdatedAt)}</b></div>
    </div>

    {error && <div className={`ad-alert ${data ? "stale-alert" : "error-alert"}`} role="status">
      <div><strong>{data ? "Refresh delayed — showing last available snapshot" : "Market overview unavailable"}</strong><span>{error}</span></div>
      <button className="ad-button" onClick={() => load(false)}>Retry</button>
    </div>}
    {loading && !data && <div className="ad-loading" aria-label="Loading market overview">
      <div className="ad-skeleton ad-skeleton-head" /><div className="ad-skeleton-grid">{[0, 1, 2, 3].map(item => <div className="ad-skeleton" key={item} />)}</div>
      <div className="ad-skeleton ad-skeleton-wide" /><span>Loading live market overview…</span>
    </div>}
    {!loading && !data && !error && <div className="ad-empty-state"><span className="ad-kicker">NO SNAPSHOT</span><h2>Market context is not available</h2><p>No usable overview was returned. Nothing has been estimated or filled in.</p><button className="ad-button" onClick={() => load(false)}>Check again</button></div>}

    {data && <>
      <header className="ad-page-head"><div><span className="ad-kicker">CROSS-ASSET ANALYTICS / ELITE</span><h1>Alpha <em>Desk</em></h1><p>Risk context and technical levels, grounded in the latest available market snapshot.</p></div>
        <div className="ad-snapshot"><span>SNAPSHOT TIME</span><b>{stamp(data.asOf)}</b><span className={stale ? "is-negative" : "is-positive"}>{stale ? "SOURCE MAY BE STALE" : "SOURCE CURRENT"}</span></div>
      </header>
      {loading && <div className="ad-refresh-note"><i /> Refreshing snapshot · current readings remain visible</div>}

      <section className="ad-hero-grid" aria-label="Featured instruments">
        {HERO_SYMBOLS.map((symbol, index) => {
          const asset = assets.find(row => row.symbol === symbol);
          return <button className={`ad-hero-card hero-${index}`} key={symbol} onClick={() => asset && setSelected(asset)} disabled={!asset}>
            <span className="ad-hero-top"><span>{symbol}</span><span className="ad-arrow">↗</span></span>
            <strong className="ad-hero-price">{asset ? displayPrice(asset.price, symbol) : NA}</strong>
            <span className={`ad-hero-change ${valid(asset?.dayChangePct) ? Number(asset.dayChangePct) >= 0 ? "is-positive" : "is-negative" : ""}`}>{asset ? signedPct(asset.dayChangePct) : NA}<small> / SESSION</small></span>
            <span className="ad-hero-bottom"><span>{asset?.trend || NA}</span><span>ATR {asset ? displayPrice(asset.atr14, symbol) : NA}</span></span>
          </button>;
        })}
      </section>

      <section className="ad-panel ad-screener">
        <SectionTitle kicker="UNIVERSE / LIVE SCREENER" aside={<span className="ad-count">{filteredAssets.length} / {assets.length} instruments</span>}>Asset monitor</SectionTitle>
        <div className="ad-controls">
          <label className="ad-search"><span>FIND</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search symbol" aria-label="Search symbols" /></label>
          <label className="ad-filter"><span>STATUS</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by status">
            {statusOptions.map(option => <option key={option} value={option}>{option === "ALL" ? "All statuses" : option}</option>)}
          </select></label>
          <span className="ad-table-hint">Select a row for full levels</span>
        </div>
        <div className="ad-table-wrap"><table className="ad-table">
          <thead><tr>{columns.map(([key, label]) => <th key={key}><button onClick={() => toggleSort(key)}>{label}<span>{sort.key === key ? sort.dir === 1 ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead>
          <tbody>{filteredAssets.map(asset => <tr key={asset.symbol} onClick={() => setSelected(asset)} tabIndex="0" onKeyDown={event => { if (event.key === "Enter") setSelected(asset); }}>
            <td className="ad-symbol">{asset.symbol}</td><td>{displayPrice(asset.price, asset.symbol)}</td>
            <td className={valid(asset.dayChangePct) ? Number(asset.dayChangePct) >= 0 ? "is-positive" : "is-negative" : ""}>{signedPct(asset.dayChangePct)}</td>
            <td><span className="ad-trend" style={{ color: toneFor(asset.trend) }}>{asset.trend || NA}</span></td>
            <td>{displayPrice(asset.atr14, asset.symbol)}</td><td>{displayPrice(asset.support, asset.symbol)}</td><td>{displayPrice(asset.resistance, asset.symbol)}</td>
            <td><Badge>{asset.status || NA}</Badge></td>
          </tr>)}
          {!filteredAssets.length && <tr><td colSpan="8" className="ad-no-rows">{assets.length ? "No instruments match these filters." : "Asset readings are not available."}</td></tr>}</tbody>
        </table></div>
        <div className="ad-table-foot"><span>Price source and observation time are shown in instrument detail.</span><span>Missing values remain N/A.</span></div>
      </section>

      <div className="ad-mid-grid">
        <section className="ad-panel ad-correlation">
          <SectionTitle kicker="DEPENDENCY / RETURN CORRELATION" aside={<div className="ad-segment">
            {[30, 60, 90].map(days => <button key={days} className={corrWindow === days ? "active" : ""} onClick={() => setCorrWindow(days)}>{days}D</button>)}
          </div>}>Correlation matrix</SectionTitle>
          <p className="ad-panel-desc">Pearson correlation of aligned daily close-to-close returns; cells are N/A when history is insufficient.</p>
          {correlationSymbols.length ? <div className="ad-heat-wrap"><table className="ad-heatmap"><thead><tr><th></th>{correlationSymbols.map(symbol => <th key={symbol}>{symbol}</th>)}</tr></thead><tbody>{correlationSymbols.map(row => <tr key={row}><th>{row}</th>{correlationSymbols.map(column => {
            const value = corrValue(row, column);
            return <td key={column} title={`${row} / ${column}: ${valid(value) ? Number(value).toFixed(2) : NA}`} style={{ background: corrColor(value) }}>{valid(value) ? Number(value).toFixed(2) : NA}</td>;
          })}</tr>)}</tbody></table></div> : <div className="ad-chart-empty">Correlation observations are unavailable.</div>}
          <div className="ad-legend"><span><i className="pos" /> Positive</span><span><i className="neg" /> Negative</span><span>Color intensity = magnitude</span></div>
        </section>
        <section className="ad-panel ad-change-panel">
          <SectionTitle kicker="DAILY CROSS-ASSET TAPE">Single-session change</SectionTitle>
          <p className="ad-panel-desc">Available day-change observations only. This is not a historical momentum series.</p>
          <MiniChart assets={allAssets} />
        </section>
      </div>

      <div className="ad-flow-grid">
        <section className="ad-panel ad-flow-panel">
          <SectionTitle kicker="FOREIGN EXCHANGE / POSITIONING">FX money flow</SectionTitle>
          <div className="ad-flow-callout"><span className="ad-flow-mark">FX</span><div><strong>Flow data not supplied</strong><p>This snapshot contains prices and technical measures, not capital-flow or positioning observations.</p></div></div>
          <div className="ad-flow-assets">{assets.filter(asset => ["USDCAD", "EURUSD"].includes(asset.symbol)).map(asset => <div key={asset.symbol}><span>{asset.symbol}</span><b className={valid(asset.dayChangePct) ? Number(asset.dayChangePct) >= 0 ? "is-positive" : "is-negative" : ""}>{signedPct(asset.dayChangePct)}</b><small>session change</small></div>)}</div>
        </section>
        <section className="ad-panel ad-flow-panel">
          <SectionTitle kicker="DIGITAL ASSETS / POSITIONING">Crypto money flow</SectionTitle>
          <div className="ad-flow-callout"><span className="ad-flow-mark">CR</span><div><strong>Flow data not supplied</strong><p>No exchange flow, ETF flow, or order-book measurements are present in the overview.</p></div></div>
          <div className="ad-flow-assets">{assets.filter(asset => ["BTC", "ETH", "SOL"].includes(asset.symbol)).map(asset => <div key={asset.symbol}><span>{asset.symbol}</span><b className={valid(asset.dayChangePct) ? Number(asset.dayChangePct) >= 0 ? "is-positive" : "is-negative" : ""}>{signedPct(asset.dayChangePct)}</b><small>{asset.trend || NA} trend</small></div>)}</div>
        </section>
      </div>

      <section className="ad-panel ad-source-panel">
        <div><span className="ad-kicker">DATA PROVENANCE</span><h2>Source & freshness</h2><p>Market readings are presented as received. Missing history and unavailable fields are not backfilled.</p></div>
        <div className="ad-source-cells"><div><span>LIVE PRICE UPDATE</span><b>{stamp(data.sourceStatus?.livePricesUpdatedAt)}</b></div><div><span>OVERVIEW SNAPSHOT</span><b>{stamp(data.asOf)}</b></div><div><span>LAST SUCCESSFUL POLL</span><b>{lastSuccess ? ago(lastSuccess) : NA}</b></div></div>
      </section>
      <footer className="ad-footer"><span>CLVRQUANT / ALPHA DESK</span><span>Levels are informational, not financial advice.</span><span>{stale ? "LAST KNOWN SNAPSHOT" : "AUTO-REFRESH · 45 SEC"}</span></footer>
    </>}
    {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
  </main>;
}

const STYLES = `
.ad-shell{--gold:${C.gold};--mint:${C.mint};--red:${C.red};--text:${C.text};--muted:${C.muted};--line:${C.line};min-height:100dvh;background:${C.bg};color:var(--text);font-family:${MONO};padding:0 clamp(14px,3.2vw,48px) 32px;max-width:1600px;margin:0 auto;font-size:12px;line-height:1.5}
.ad-shell *{box-sizing:border-box}.ad-shell button,.ad-shell input,.ad-shell select{font:inherit}.ad-topline{height:53px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);font-size:10px;letter-spacing:.12em;color:#aaa18b}.ad-mark{display:grid;place-items:center;width:25px;height:25px;border:1px solid rgba(212,175,55,.55);color:var(--gold);font-weight:700;font-size:9px}.ad-topline i{color:#4f493b;font-style:normal}.ad-topline strong{color:var(--gold);font-weight:600}.ad-top-right{margin-left:auto;display:flex;align-items:center;gap:8px;color:#8b8475;font-size:9px}.ad-live-dot{width:6px;height:6px;border-radius:50%;background:var(--gold)}.ad-live-dot.live{background:var(--mint)}
.ad-riskbar{position:sticky;top:0;z-index:8;margin:0 calc(clamp(14px,3.2vw,48px)*-1);padding:0 clamp(14px,3.2vw,48px);min-height:58px;background:rgba(5,5,5,.96);backdrop-filter:blur(14px);border-bottom:1px solid rgba(212,175,55,.28);display:flex;align-items:center;gap:clamp(14px,2.8vw,39px);overflow-x:auto;scrollbar-width:thin}.ad-risk-label,.ad-risk-item>span,.ad-risk-source>span{font-size:8px;letter-spacing:.14em;color:#817966;white-space:nowrap}.ad-risk-label{color:var(--gold);font-weight:700}.ad-risk-item{display:grid;gap:2px;white-space:nowrap}.ad-risk-item b,.ad-risk-source b{font-size:11px;color:#d8d1bf;font-weight:500}.ad-risk-source{display:grid;gap:2px;margin-left:auto;white-space:nowrap}.ad-page-head{display:flex;justify-content:space-between;align-items:flex-end;padding:30px 0 24px;gap:20px}.ad-kicker{font-size:8px;letter-spacing:.15em;color:var(--gold);text-transform:uppercase}.ad-page-head h1{font-size:clamp(34px,5vw,57px);letter-spacing:-.08em;line-height:1.05;margin:5px 0 7px;font-weight:500}.ad-page-head h1 em{font-style:normal;color:var(--gold)}.ad-page-head p,.ad-panel-desc{color:#8e887b;font-size:10px;margin:0;line-height:1.65}.ad-snapshot{display:grid;gap:4px;text-align:right;font-size:8px;letter-spacing:.08em;color:#827c6d}.ad-snapshot b{font-size:10px;font-weight:500;color:#d1c9b8;letter-spacing:0}.is-positive{color:var(--mint)!important}.is-negative{color:var(--red)!important}
.ad-hero-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}.ad-hero-card{position:relative;min-width:0;text-align:left;padding:17px 16px 13px;border:1px solid #342d1a;background:linear-gradient(140deg,#10100d,#080808 70%);color:var(--text);cursor:pointer;transition:transform 150ms ease,border-color 150ms ease;overflow:hidden}.ad-hero-card:hover:not(:disabled){transform:translateY(-2px);border-color:rgba(212,175,55,.7)}.ad-hero-card:disabled{cursor:default}.ad-hero-card:before{content:"";position:absolute;top:0;left:0;height:1px;width:58%;background:linear-gradient(90deg,var(--gold),transparent)}.ad-hero-top,.ad-hero-bottom{display:flex;justify-content:space-between;align-items:center}.ad-hero-top{font-size:9px;letter-spacing:.14em;color:var(--gold)}.ad-arrow{font-size:12px;color:#786c47}.ad-hero-price{display:block;margin:12px 0 1px;font-size:clamp(21px,2.4vw,29px);font-weight:500;letter-spacing:-.055em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ad-hero-change{font-size:10px;color:#9e9787}.ad-hero-change small{font-size:7px;color:#5f594d}.ad-hero-bottom{border-top:1px solid #201e18;margin-top:16px;padding-top:9px;color:#8b8475;font-size:8px;letter-spacing:.04em;gap:4px}
.ad-panel{background:${C.panel};border:1px solid #26231b;padding:17px 18px;min-width:0}.ad-section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:15px}.ad-section-title h2,.ad-source-panel h2{font-size:15px;font-weight:500;letter-spacing:-.035em;margin:4px 0 0;color:#e2dccd}.ad-count{font-size:8px;color:#847d6e}.ad-controls{display:flex;gap:8px;align-items:center;margin-bottom:10px}.ad-search,.ad-filter{display:flex;align-items:center;gap:9px;padding:0 10px;height:32px;border:1px solid #302b20;background:#050505;color:#837b69;font-size:8px;letter-spacing:.08em}.ad-search input,.ad-filter select{min-width:130px;background:transparent;border:0;outline:0;color:#e2dccd;font-size:9px}.ad-search input::placeholder{color:#5d584e}.ad-filter select option{background:#101010;color:#eee}.ad-table-hint{margin-left:auto;color:#635e53;font-size:8px}.ad-table-wrap{overflow:auto;max-height:560px;scrollbar-color:#3e3622 #080808}.ad-table{width:100%;border-collapse:collapse;min-width:820px}.ad-table th{position:sticky;top:0;background:#0a0a09;z-index:1;text-align:left;border-bottom:1px solid #383121;padding:8px 9px;font-size:7px;font-weight:500;letter-spacing:.1em;color:#817966;white-space:nowrap}.ad-table th button{border:0;background:none;color:inherit;cursor:pointer;padding:0;font-size:inherit;letter-spacing:inherit}.ad-table th button:hover{color:var(--gold)}.ad-table th button span{color:#514a39}.ad-table td{padding:10px 9px;border-bottom:1px solid #1a1915;font-size:9px;color:#c7c0b1;white-space:nowrap}.ad-table tbody tr{cursor:pointer;transition:background 120ms ease}.ad-table tbody tr:hover{background:rgba(212,175,55,.055)}.ad-table tbody tr:focus{outline:1px solid var(--gold);outline-offset:-1px}.ad-table .ad-symbol{color:var(--gold);letter-spacing:.05em;font-weight:600}.ad-trend{font-size:8px}.ad-badge{display:inline-flex;border:1px solid color-mix(in srgb,var(--badge-color) 37%,transparent);background:color-mix(in srgb,var(--badge-color) 8%,transparent);color:var(--badge-color);font-size:7px;letter-spacing:.07em;padding:3px 6px;white-space:nowrap;text-transform:uppercase}.ad-no-rows{text-align:center!important;color:#777!important;padding:24px!important}.ad-table-foot{display:flex;justify-content:space-between;gap:10px;padding-top:10px;color:#5e594f;font-size:8px}
.ad-mid-grid{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(260px,.72fr);gap:10px;margin:10px 0}.ad-segment{display:flex;border:1px solid #393222}.ad-segment button{border:0;border-right:1px solid #393222;background:#070707;color:#817966;padding:6px 8px;font-size:8px;cursor:pointer}.ad-segment button:last-child{border-right:0}.ad-segment button.active{background:rgba(212,175,55,.14);color:var(--gold)}.ad-panel-desc{margin:-7px 0 12px}.ad-heat-wrap{overflow:auto;max-height:400px;scrollbar-width:thin;scrollbar-color:#3e3622 #080808}.ad-heatmap{border-collapse:separate;border-spacing:2px;font-size:7px}.ad-heatmap th{position:sticky;top:0;background:#090909;color:#938b79;font-weight:500;padding:5px;white-space:nowrap}.ad-heatmap th:first-child{left:0;z-index:2}.ad-heatmap tbody th{left:0}.ad-heatmap td{width:38px;height:29px;text-align:center;color:#d6d1c4;border:1px solid rgba(255,255,255,.035);font-size:7px}.ad-legend{display:flex;gap:14px;align-items:center;margin-top:10px;color:#6f695d;font-size:7px}.ad-legend span{display:flex;align-items:center;gap:5px}.ad-legend i{width:8px;height:8px;display:inline-block;background:rgba(0,255,136,.45)}.ad-legend i.neg{background:rgba(255,77,94,.45)}.ad-change-chart{display:grid;gap:11px;padding:8px 0}.ad-change-row{display:grid;grid-template-columns:44px 1fr 54px;align-items:center;gap:8px;font-size:8px}.ad-change-row>span{color:#c1b9a7}.ad-change-row>b{text-align:right;font-size:8px;font-weight:500}.ad-change-track{height:4px;background:#1b1915;position:relative}.ad-change-track i{display:block;height:100%;background:var(--mint);min-width:2px}.ad-change-track i.negative{background:var(--red)}.ad-chart-empty{padding:20px 10px;text-align:center;color:#6f695d;font-size:9px;border:1px dashed #302b20}
.ad-flow-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ad-flow-callout{display:flex;gap:12px;align-items:flex-start;padding:14px 12px;border:1px solid #211f18;background:#070707}.ad-flow-mark{width:31px;height:31px;display:grid;place-items:center;border:1px solid rgba(212,175,55,.35);color:var(--gold);font-size:8px}.ad-flow-callout strong{color:#d6cfbd;font-size:9px;font-weight:500}.ad-flow-callout p{color:#6f695d;font-size:8px;line-height:1.6;margin:4px 0 0}.ad-flow-assets{display:flex;flex-wrap:wrap;margin-top:10px;border-top:1px solid #201e18}.ad-flow-assets>div{flex:1;min-width:90px;display:grid;gap:3px;padding:9px 10px 0;border-right:1px solid #201e18}.ad-flow-assets>div:last-child{border:0}.ad-flow-assets span{font-size:8px;color:#b8b09e}.ad-flow-assets b{font-size:10px;font-weight:500}.ad-flow-assets small{font-size:7px;color:#666054}
.ad-source-panel{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:10px}.ad-source-panel p{color:#777164;font-size:8px;max-width:350px;margin:5px 0 0}.ad-source-cells{display:flex;flex-wrap:wrap;gap:20px}.ad-source-cells>div{display:grid;gap:4px}.ad-source-cells span{font-size:7px;letter-spacing:.09em;color:#6d675a}.ad-source-cells b{font-size:8px;color:#c7c0b1;font-weight:400}.ad-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:17px 1px 5px;color:#5e594e;font-size:7px;letter-spacing:.07em}.ad-alert{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin-top:11px;border:1px solid rgba(255,77,94,.35);background:rgba(255,77,94,.06)}.ad-alert.stale-alert{border-color:rgba(212,175,55,.35);background:rgba(212,175,55,.045)}.ad-alert>div{display:grid;gap:2px}.ad-alert strong{font-size:9px;color:#dfc982;font-weight:500}.ad-alert span{font-size:8px;color:#8b8475}.ad-button{padding:7px 11px;border:1px solid #463b1d;background:#0b0a07;color:var(--gold);font-size:8px;letter-spacing:.07em;cursor:pointer}.ad-button:hover{background:rgba(212,175,55,.1)}.ad-button-primary{background:var(--gold);color:#080704;border-color:var(--gold);font-weight:700}.ad-refresh-note{padding:7px 10px;color:#8d8261;font-size:8px;border-left:1px solid var(--gold);background:rgba(212,175,55,.04);margin:0 0 9px}.ad-refresh-note i{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--gold);margin-right:7px}.ad-loading{padding-top:30px}.ad-skeleton{height:114px;background:linear-gradient(90deg,#090909,#15140f,#090909);background-size:200% 100%;animation:ad-shimmer 1.5s linear infinite;border:1px solid #1c1a15}.ad-skeleton-head{height:62px;max-width:48%;margin-bottom:12px}.ad-skeleton-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:12px}.ad-skeleton-wide{height:300px}.ad-loading>span{display:block;margin-top:12px;color:#766f60;font-size:8px}@keyframes ad-shimmer{to{background-position:-200% 0}}.ad-empty-state,.ad-upgrade{max-width:570px;margin:15vh auto;padding:34px;border:1px solid #38301a;background:linear-gradient(145deg,#11100b,#050505);text-align:left}.ad-empty-state h2,.ad-upgrade h1{font-size:29px;letter-spacing:-.06em;margin:9px 0}.ad-empty-state p,.ad-upgrade p{font-size:10px;line-height:1.8;color:#938b79;margin:0 0 20px}.ad-upgrade .ad-mark{margin-bottom:22px}
.ad-drawer-shade{position:fixed;inset:0;z-index:30;background:rgba(0,0,0,.72);display:flex;justify-content:flex-end}.ad-drawer{width:min(560px,100%);height:100%;overflow:auto;background:#080807;border-left:1px solid #54451f;padding:20px clamp(16px,3vw,28px);box-shadow:-24px 0 80px rgba(0,0,0,.55);animation:ad-slide 190ms ease-out both}.ad-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #30291b;padding-bottom:14px}.ad-drawer-head h2{font-size:29px;letter-spacing:-.06em;margin:4px 0 0;color:var(--gold);font-weight:500}.ad-icon-button{height:31px;width:31px;border:1px solid #373123;background:#0b0b09;color:#b8b09e;font-size:19px;cursor:pointer}.ad-drawer-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;color:#777164;font-size:8px}.ad-detail-grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #201e18;border-left:1px solid #201e18}.ad-detail-grid>div{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border-right:1px solid #201e18;border-bottom:1px solid #201e18;font-size:8px}.ad-detail-grid span{color:#777164}.ad-detail-grid strong{color:#d4cdbd;text-align:right;font-weight:500}.ad-drawer-section{padding-top:21px}.ad-drawer-section .ad-section-title{margin-bottom:11px}.ad-level-plot{position:relative;min-height:220px;border:1px solid #29251b;background:repeating-linear-gradient(to bottom,transparent 0,transparent 43px,rgba(212,175,55,.07) 44px)}.ad-level-scale{position:absolute;left:6px;top:5px;bottom:5px;display:flex;flex-direction:column;justify-content:space-between;color:#696354;font-size:7px}.ad-level-track{position:absolute;left:86px;right:10px;top:7px;bottom:26px}.ad-level-line{position:absolute;width:100%;height:1px;border-top:1px dashed var(--line-color);display:flex;justify-content:space-between;align-items:center;color:var(--line-color);font-size:7px}.ad-level-line span,.ad-level-line b{position:relative;background:#080807;padding:1px 4px;font-weight:500}.ad-level-line.current{border-top-style:solid;border-top-width:2px}.ad-level-line.current span,.ad-level-line.current b{font-weight:700}.ad-chart-caption{margin:8px 0 0;color:#686254;font-size:7px}.ad-level-plot .ad-chart-caption{position:absolute;bottom:4px;left:9px}.ad-vol-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #201e18}.ad-vol-grid .ad-metric{padding:10px}.ad-metric{display:grid;gap:5px}.ad-metric strong{font-size:14px;font-weight:500;color:#d5cebd}.ad-metric small{font-size:7px;color:#696354}.ad-atr-meter{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:8px;margin-top:13px;color:#8e8778;font-size:8px}.ad-atr-meter>div{height:4px;background:#211e17}.ad-atr-meter i{display:block;height:100%;background:var(--gold)}.ad-atr-meter>b{font-size:7px;font-weight:400;color:#bbb29f}.ad-drawer-foot{margin-top:20px;padding:11px 0;border-top:1px solid #2b261b;color:#6f695d;font-size:8px}@keyframes ad-slide{from{opacity:.6;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:900px){.ad-riskbar{gap:19px}.ad-hero-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ad-mid-grid{grid-template-columns:1fr}.ad-source-panel{align-items:flex-start;flex-direction:column}.ad-source-cells{width:100%;justify-content:space-between}.ad-skeleton-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){.ad-shell{padding-left:12px;padding-right:12px}.ad-topline{height:47px;gap:8px;font-size:8px}.ad-riskbar{margin-left:-12px;margin-right:-12px;padding:0 12px;min-height:54px;gap:16px}.ad-risk-item b,.ad-risk-source b{font-size:9px}.ad-page-head{align-items:flex-start;flex-direction:column;padding:22px 0 17px;gap:13px}.ad-snapshot{text-align:left;grid-template-columns:auto auto auto;align-items:center;gap:8px}.ad-snapshot b{font-size:8px}.ad-hero-grid{gap:7px}.ad-hero-card{padding:13px 11px 10px}.ad-hero-price{font-size:20px;margin-top:9px}.ad-hero-bottom{margin-top:12px;font-size:7px}.ad-panel{padding:13px 11px}.ad-controls{align-items:stretch;flex-wrap:wrap}.ad-search{flex:1;min-width:100%}.ad-search input{flex:1}.ad-filter{flex:1}.ad-filter select{flex:1;min-width:0}.ad-table-hint{display:none}.ad-table-foot{flex-direction:column;gap:3px}.ad-flow-grid{grid-template-columns:1fr}.ad-source-cells{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ad-footer{font-size:6px}.ad-skeleton-head{max-width:85%}.ad-skeleton-grid{gap:7px}.ad-skeleton{height:98px}.ad-drawer{padding-top:14px}.ad-detail-grid>div{padding:8px 7px;font-size:7px}.ad-drawer-meta{align-items:flex-start;flex-direction:column}.ad-level-track{left:72px}.ad-atr-meter{grid-template-columns:48px 1fr}.ad-atr-meter>b{grid-column:2}.ad-alert{align-items:flex-start}.ad-upgrade{margin:12vh auto;padding:24px}}
@media(prefers-reduced-motion:reduce){.ad-shell *, .ad-shell *:before,.ad-shell *:after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;
