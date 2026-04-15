const MONO = "'IBM Plex Mono', monospace";

export default function ScanSummary({ scanned, found, suppressed, errors, regime }) {
  const crashProb = Math.round((100 - (regime?.score || 50)) * 0.8);
  const crashColor = crashProb > 60 ? "#ff4444" : crashProb > 30 ? "#ff8c00" : "#22c55e";

  return (
    <div data-testid="scan-summary" style={{ background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { label: "SCANNED", value: scanned, color: "#e0e0e0" },
          { label: "SIGNALS", value: found, color: found > 0 ? "#22c55e" : "#ef4444" },
          { label: "REGIME", value: `${regime?.label || "NEUTRAL"} ${regime?.score || 50}/100`, color: regime?.label === "RISK_ON" ? "#22c55e" : regime?.label === "RISK_OFF" ? "#ef4444" : "#f59e0b" },
          { label: "CRASH PROB", value: `${crashProb}%`, color: crashColor },
        ].map(s => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 12px", flex: 1, minWidth: 80 }}>
            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.08em", marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: s.color, fontFamily: MONO }}>{s.value}</div>
          </div>
        ))}
      </div>
      {suppressed > 0 && (
        <div style={{ fontSize: 8, color: "#ff8c00", fontFamily: MONO, marginTop: 8 }}>
          🛑 {suppressed} signal{suppressed > 1 ? "s" : ""} suppressed by risk rules
        </div>
      )}
      {errors > 0 && (
        <div style={{ fontSize: 8, color: "#ef4444", fontFamily: MONO, marginTop: 4 }}>
          ⚠ {errors} asset{errors > 1 ? "s" : ""} failed to analyze
        </div>
      )}
    </div>
  );
}
