import { useState, useCallback } from "react";
import SignalCard, { SuppressedSignal } from "./SignalCard.jsx";
import ScanSummary from "./ScanSummary.jsx";
import { useDataBus } from "../../context/DataBusContext.jsx";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

const FULL_ASSET_LIBRARY = [
  { ticker:"BTC", name:"Bitcoin", cat:"CRYPTO" },{ ticker:"ETH", name:"Ethereum", cat:"CRYPTO" },
  { ticker:"SOL", name:"Solana", cat:"CRYPTO" },{ ticker:"BNB", name:"BNB", cat:"CRYPTO" },
  { ticker:"XRP", name:"XRP", cat:"CRYPTO" },{ ticker:"DOGE", name:"Dogecoin", cat:"CRYPTO" },
  { ticker:"AVAX", name:"Avalanche", cat:"CRYPTO" },{ ticker:"LINK", name:"Chainlink", cat:"CRYPTO" },
  { ticker:"ARB", name:"Arbitrum", cat:"CRYPTO" },{ ticker:"HYPE", name:"Hyperliquid", cat:"CRYPTO" },
  { ticker:"INJ", name:"Injective", cat:"CRYPTO" },{ ticker:"SUI", name:"Sui", cat:"CRYPTO" },
  { ticker:"WIF", name:"dogwifhat", cat:"CRYPTO" },{ ticker:"PEPE", name:"Pepe", cat:"CRYPTO" },
  { ticker:"TRUMP", name:"Trump", cat:"CRYPTO" },{ ticker:"HBAR", name:"Hedera", cat:"CRYPTO" },
  { ticker:"TIA", name:"Celestia", cat:"CRYPTO" },{ ticker:"NEAR", name:"NEAR", cat:"CRYPTO" },
  { ticker:"APT", name:"Aptos", cat:"CRYPTO" },{ ticker:"SEI", name:"Sei", cat:"CRYPTO" },
  { ticker:"ONDO", name:"Ondo", cat:"CRYPTO" },{ ticker:"RENDER", name:"Render", cat:"CRYPTO" },
  { ticker:"PENDLE", name:"Pendle", cat:"CRYPTO" },{ ticker:"TAO", name:"Bittensor", cat:"CRYPTO" },
  { ticker:"TSLA", name:"Tesla", cat:"EQUITY" },{ ticker:"NVDA", name:"NVIDIA", cat:"EQUITY" },
  { ticker:"AAPL", name:"Apple", cat:"EQUITY" },{ ticker:"MSFT", name:"Microsoft", cat:"EQUITY" },
  { ticker:"META", name:"Meta", cat:"EQUITY" },{ ticker:"MSTR", name:"MicroStrategy", cat:"EQUITY" },
  { ticker:"AMD", name:"AMD", cat:"EQUITY" },{ ticker:"COIN", name:"Coinbase", cat:"EQUITY" },
  { ticker:"PLTR", name:"Palantir", cat:"EQUITY" },
  { ticker:"XAU", name:"Gold", cat:"COMMODITY" },{ ticker:"XAG", name:"Silver", cat:"COMMODITY" },
  { ticker:"WTI", name:"Oil WTI", cat:"COMMODITY" },
  { ticker:"EURUSD", name:"EUR/USD", cat:"FX" },{ ticker:"GBPUSD", name:"GBP/USD", cat:"FX" },
  { ticker:"USDJPY", name:"USD/JPY", cat:"FX" },
];

const CAT_COLORS = { CRYPTO: "#9945ff", EQUITY: "#3b82f6", COMMODITY: "#d4af37", FX: "#00e5ff" };
const TOP_5 = ["BTC", "ETH", "SOL", "BNB", "NVDA"];

function ASSET_CLASS(ticker) {
  const a = FULL_ASSET_LIBRARY.find(x => x.ticker === ticker);
  if (!a) return "crypto";
  if (a.cat === "EQUITY") return "equity";
  if (a.cat === "COMMODITY") return "commodity";
  if (a.cat === "FX") return "fx";
  return "crypto";
}

export default function QuantScanner({ mode, isPro, isElite }) {
  const [selected, setSelected] = useState(["BTC"]);
  const [market, setMarket] = useState("PERP");
  const [risk, setRisk] = useState("mid");
  const [tf, setTf] = useState("today");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");

  const { regime, killSwitch, macroEvents: macroEvts, prices, funding, oi } = useDataBus();

  const toggle = useCallback((t) => {
    setSelected(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
  }, []);

  const runScan = async () => {
    if (selected.length === 0 || scanning) return;
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: selected.length });

    const collected = [];
    for (let i = 0; i < selected.length; i++) {
      const ticker = selected[i];
      const ac = ASSET_CLASS(ticker);
      const assetMarket = ac !== "crypto" ? "SPOT" : market;
      try {
        const res = await fetch("/api/quant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ticker, marketType: assetMarket, riskId: risk, timeframeId: tf, assetClass: ac,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed (${res.status})`);
        }
        const data = await res.json();
        if (data.signal !== "SUPPRESSED" && !data.rr && data.entry?.price && data.tp1?.price && data.stopLoss?.price) {
          const r = Math.abs(data.entry.price - data.stopLoss.price);
          const w = Math.abs(data.tp1.price - data.entry.price);
          data.rr = r > 0.000001 ? w / r : 0;
        }
        collected.push({ ticker, result: data, error: null, fundingRate: funding[ticker] || 0 });
      } catch (err) {
        collected.push({ ticker, result: null, error: err.message });
      }
      setProgress({ done: i + 1, total: selected.length });
    }
    setScanning(false);
    setResults(collected);
  };

  const qualifying = results.filter(r => r.result && r.result.signal !== "SUPPRESSED" && r.result.signal && r.result.entry?.price && (r.result.rr == null || r.result.rr >= 1.3))
    .sort((a, b) => (b.result.win_probability || 0) - (a.result.win_probability || 0));
  const suppressed = results.filter(r => r.result && r.result.signal === "SUPPRESSED");
  const errors = results.filter(r => r.error);
  const hasDone = results.length > 0 && !scanning;

  const filtered = FULL_ASSET_LIBRARY.filter(a => {
    const mc = catFilter === "ALL" || a.cat === catFilter;
    const q = search.toLowerCase();
    const ms = !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    return mc && ms;
  });

  return (
    <div data-testid="section-quant-scanner" style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: SERIF, color: "#e0e0e0", fontWeight: 700 }}>Quant Scanner</h3>
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginTop: 2, letterSpacing: "0.08em" }}>
          MASTERBRAIN · BAYESIAN SCORING · MULTI-TF CONFLUENCE
        </div>
      </div>

      <div style={{ background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            type="text" placeholder="Search assets..." value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-scanner-search"
            style={{ width: "100%", boxSizing: "border-box", background: "#0a0f1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "9px 12px 9px 32px", color: "#e0e0e0", fontFamily: MONO, fontSize: 11, outline: "none" }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: 0.3 }}>🔍</span>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {["ALL", "CRYPTO", "EQUITY", "COMMODITY", "FX"].map(c => (
            <button key={c} data-testid={`btn-scan-cat-${c}`} onClick={() => setCatFilter(c)} style={{
              padding: "4px 10px", borderRadius: 5,
              border: `1px solid ${catFilter === c ? (CAT_COLORS[c] || "rgba(201,168,76,0.4)") : "rgba(255,255,255,0.06)"}`,
              background: catFilter === c ? `${CAT_COLORS[c] || "#c9a84c"}15` : "transparent",
              color: catFilter === c ? (CAT_COLORS[c] || "#c9a84c") : "rgba(255,255,255,0.3)",
              fontFamily: MONO, fontSize: 8, cursor: "pointer", fontWeight: catFilter === c ? 700 : 400,
            }}>{c}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>{selected.length}/5</span>
          <button data-testid="btn-top5" onClick={() => setSelected(TOP_5.slice())} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.06)", color: "#22c55e", fontFamily: MONO, fontSize: 8, cursor: "pointer" }}>⭐ TOP 5</button>
          {selected.length > 0 && <button data-testid="btn-clear-scan" onClick={() => setSelected([])} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)", color: "#ef4444", fontFamily: MONO, fontSize: 8, cursor: "pointer" }}>CLEAR</button>}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 200, overflowY: "auto" }}>
          {filtered.map(a => {
            const isSel = selected.includes(a.ticker);
            const col = CAT_COLORS[a.cat] || "#6b7a99";
            const disabled = !isSel && selected.length >= 5;
            return (
              <button key={a.ticker} data-testid={`scan-chip-${a.ticker}`} onClick={() => !disabled && toggle(a.ticker)} style={{
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${isSel ? col : "rgba(255,255,255,0.06)"}`,
                background: isSel ? `${col}18` : "transparent",
                color: isSel ? col : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.3 : 1, fontWeight: isSel ? 700 : 400,
              }}>{a.ticker}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <select data-testid="select-scan-tf" value={tf} onChange={e => setTf(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <option value="today">Scalp / Intraday</option>
          <option value="mid">Mid-Term (1-4 wks)</option>
          <option value="long">Long-Term (1-3 mo)</option>
        </select>
        <select data-testid="select-scan-market" value={market} onChange={e => setMarket(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <option value="PERP">PERP</option>
          <option value="SPOT">SPOT</option>
        </select>
        <select data-testid="select-scan-risk" value={risk} onChange={e => setRisk(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <option value="low">Conservative</option>
          <option value="mid">Balanced</option>
          <option value="high">Aggressive</option>
        </select>
        <button
          data-testid="btn-execute-scan"
          onClick={runScan}
          disabled={scanning || selected.length === 0}
          style={{
            padding: "9px 18px", borderRadius: 8,
            background: scanning ? "rgba(201,168,76,0.04)" : "linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08))",
            border: `1px solid ${scanning ? "rgba(201,168,76,0.1)" : "rgba(201,168,76,0.3)"}`,
            color: scanning ? "rgba(255,255,255,0.3)" : "#e8c96d",
            fontFamily: MONO, fontSize: 10, fontWeight: 700, cursor: scanning ? "not-allowed" : "pointer",
          }}
        >
          {scanning ? "Scanning..." : "Execute →"}
        </button>
      </div>

      {scanning && (
        <div style={{ textAlign: "center", padding: "24px 16px" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🧠</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#e8c96d", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 8 }}>MASTERBRAIN ACTIVE</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Analyzing {progress.done} / {progress.total} assets...</div>
          <div style={{ width: "60%", margin: "10px auto", height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`, background: "linear-gradient(90deg, #c9a84c, #22c55e)", borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
        </div>
      )}

      {hasDone && (
        <ScanSummary scanned={results.length} found={qualifying.length} suppressed={suppressed.length} errors={errors.length} regime={regime} />
      )}

      {qualifying.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {qualifying.slice(0, 3).map((r, i) => (
            <SignalCard key={r.ticker} ticker={r.ticker} result={r.result} rank={i} mode={mode} />
          ))}
        </div>
      )}

      {suppressed.length > 0 && hasDone && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.08em", marginBottom: 6 }}>SUPPRESSED</div>
          {suppressed.map(r => <SuppressedSignal key={r.ticker} ticker={r.ticker} result={r.result} />)}
        </div>
      )}

      {hasDone && qualifying.length === 0 && suppressed.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⛔</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>NO SETUPS FOUND</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: SANS, marginTop: 6 }}>Conditions prevented signal generation. Try different assets or timeframe.</div>
        </div>
      )}

      {errors.length > 0 && hasDone && (
        <div style={{ marginTop: 10 }}>
          {errors.map(e => (
            <div key={e.ticker} style={{ fontSize: 9, color: "#ef4444", fontFamily: MONO, padding: "4px 0" }}>⚠ {e.ticker}: {e.error}</div>
          ))}
        </div>
      )}
    </div>
  );
}
