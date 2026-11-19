import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";

const REFRESH_MS = 15_000;
const COLORS = {
  panel: "#0b101b",
  border: "rgba(148,163,184,.18)",
  text: "#d8deea",
  muted: "#758198",
  green: "#21c58e",
  red: "#ff6174",
  gold: "#d9b85b",
};

function priceLabel(coin, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const fx = new Set(["EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "MXN", "ZAR", "TRY", "SGD", "HKD", "NOK", "SEK"]);
  const decimals = fx.has(coin) ? 4 : 2;
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function pctLabel(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(2)}%`;
}

function fundingLabel(value) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : `${(Number(value) * 100).toFixed(4)}% / 8h`;
}

function timeLabel(value) {
  if (!Number.isFinite(value)) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function EquitiesMoreSignals() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [progress, setProgress] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      const response = await apiFetch("/api/xyz-signals", { signal });
      if (!response.ok) throw new Error("Live xyz market data could not be loaded.");
      const data = await response.json();
      if (data?.status === "loading") {
        setProgress({ completed: data.candlesCompleted || 0, total: data.candlesTotal || 0 });
        setError("");
        setLoading(true);
        return;
      }
      if (data?.status === "error") throw new Error(data.error || "Live xyz market data could not be loaded.");
      const counts = data?.counts || {};
      const countTotal = ["LONG", "SHORT", "NEUTRAL", "NO_DATA"]
        .reduce((sum, key) => sum + Number(counts[key] || 0), 0);
      if (!Array.isArray(data?.rows) || data.rows.length !== data.universeSize
        || countTotal !== data.universeSize) {
        throw new Error("The xyz market response is incomplete. Retry shortly.");
      }
      setSnapshot(data);
      setProgress(null);
      setError("");
      setLoading(false);
    } catch (caught) {
      if (caught?.name === "AbortError") return;
      setError(caught?.message || "Live xyz market data could not be loaded.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => {
      void load(controller.signal);
    }, REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load, refreshCount]);

  const retry = () => {
    setLoading(true);
    setRefreshCount(count => count + 1);
  };

  const counts = snapshot?.counts || { LONG: 0, SHORT: 0, NEUTRAL: 0, NO_DATA: 0 };
  const columnStyle = {
    padding: "8px 9px",
    borderBottom: `1px solid ${COLORS.border}`,
    textAlign: "right",
    whiteSpace: "nowrap",
  };
  const headingStyle = {
    ...columnStyle,
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: ".08em",
    position: "sticky",
    top: 0,
    background: COLORS.panel,
    zIndex: 1,
  };

  return (
    <section
      aria-labelledby="xyz-signals-title"
      data-testid="equities-more-signals"
      style={{
        marginTop: 18,
        overflow: "hidden",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        background: COLORS.panel,
      }}
    >
      <header style={{ padding: "13px 14px 10px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 id="xyz-signals-title" style={{ margin: 0, color: COLORS.gold, fontFamily: "Georgia, serif", fontSize: 17 }}>
            Equities &amp; more
          </h2>
          <span style={{ color: snapshot?.stale ? COLORS.gold : COLORS.green, fontFamily: "monospace", fontSize: 9 }}>
            {snapshot?.stale ? "CACHED DATA · REFRESH RETRYING" : snapshot ? `LIVE · ${timeLabel(snapshot.fetchedAt)}` : "CONNECTING"}
          </span>
        </div>
        <p style={{ margin: "7px 0 0", color: COLORS.muted, fontFamily: "monospace", fontSize: 9, lineHeight: 1.6 }}>
          Hyperliquid xyz synthetic perpetuals. Each displayed price is a perp mark price, not the underlying stock, index, FX, or commodity price.
          Pre-IPO perps (ANT, SHEIN, MINIMAX, ZHIPU, UNITREE) provide no shares, votes, or IPO allocation.
        </p>
      </header>

      {snapshot && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "9px 12px", borderBottom: `1px solid ${COLORS.border}`, fontFamily: "monospace", fontSize: 8 }}>
          {[
            ["LONG", counts.LONG, COLORS.green],
            ["SHORT", counts.SHORT, COLORS.red],
            ["NEUTRAL", counts.NEUTRAL, COLORS.gold],
            ["NO DATA", counts.NO_DATA, COLORS.muted],
          ].map(([label, value, color]) => (
            <span key={label} style={{ color, border: `1px solid ${color}55`, borderRadius: 3, padding: "4px 7px" }}>
              {label} {value}
            </span>
          ))}
          <span style={{ color: COLORS.muted, padding: "4px 2px" }}>
            {snapshot.rows.length} / {snapshot.universeSize} markets · candles {timeLabel(snapshot.candlesAsOf)}
          </span>
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: 16, color: "#ff8d9b", fontFamily: "monospace", fontSize: 10 }}>
          {error}{" "}
          <button type="button" onClick={retry} style={{ color: COLORS.gold, background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 3, padding: "5px 9px", cursor: "pointer" }}>
            Retry
          </button>
        </div>
      )}
      {loading && !snapshot && !error && (
        <div role="status" style={{ padding: 18, color: COLORS.muted, fontFamily: "monospace", fontSize: 10 }}>
          Loading live xyz perpetuals and daily history
          {progress?.total ? ` · ${progress.completed}/${progress.total} markets processed` : "…"}
        </div>
      )}
      {!snapshot && !loading && !error && (
        <div style={{ padding: 18, color: COLORS.muted, fontFamily: "monospace", fontSize: 10 }}>No xyz market snapshot is available yet.</div>
      )}

      {snapshot && (
        <div style={{ overflowX: "auto", maxHeight: 560 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", color: COLORS.text, fontFamily: "monospace", fontSize: 9 }}>
            <thead>
              <tr>
                {["COIN", "PERP MARK PRICE", "SIGNAL", "CONVICTION", "RSI(14)", "7D RETURN", "30D RETURN", "FUNDING / 8H"].map((label, index) => (
                  <th key={label} scope="col" style={{ ...headingStyle, textAlign: index === 0 || index === 2 ? "left" : "right" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map(row => {
                const noData = row.signal === "NO_DATA";
                const signalColor = row.signal === "LONG" ? COLORS.green
                  : row.signal === "SHORT" ? COLORS.red
                    : noData ? COLORS.muted : COLORS.gold;
                return (
                  <tr key={row.coin} data-testid={`xyz-signal-${row.coin}`} style={{ color: noData ? COLORS.muted : COLORS.text, opacity: noData ? 0.55 : 1 }}>
                    <td style={{ ...columnStyle, textAlign: "left", fontWeight: 700 }}>
                      {row.coin}
                      {row.historyLabel && <div style={{ marginTop: 3, color: COLORS.muted, fontSize: 8 }}>{row.historyLabel}</div>}
                      {noData && <div style={{ marginTop: 3, fontSize: 8 }}>no daily candles in 90 days</div>}
                    </td>
                    <td style={columnStyle}>{priceLabel(row.coin, row.markPrice)}</td>
                    <td style={{ ...columnStyle, textAlign: "left", color: signalColor, fontWeight: 800 }}>{row.signal}</td>
                    <td style={columnStyle}>{row.conviction || "—"}</td>
                    <td style={columnStyle}>{row.rsi14 == null ? "—" : row.rsi14.toFixed(1)}</td>
                    <td style={{ ...columnStyle, color: row.return7d == null ? COLORS.muted : row.return7d >= 0 ? COLORS.green : COLORS.red }}>{pctLabel(row.return7d)}</td>
                    <td style={{ ...columnStyle, color: row.return30d == null ? COLORS.muted : row.return30d >= 0 ? COLORS.green : COLORS.red }}>{pctLabel(row.return30d)}</td>
                    <td style={{ ...columnStyle, color: row.fundingRate == null ? COLORS.muted : row.fundingRate >= 0 ? COLORS.green : COLORS.red }}>{fundingLabel(row.fundingRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
