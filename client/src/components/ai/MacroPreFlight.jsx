const MONO = "'IBM Plex Mono', monospace";
const SANS = "'Barlow', system-ui, sans-serif";

const STATUS_COLORS = {
  CLEAR: { bg: "rgba(0,199,135,0.06)", border: "rgba(0,199,135,0.2)", icon: "✅", color: "#00c787", label: "MACRO CLEAR" },
  CAUTION: { bg: "rgba(255,140,0,0.06)", border: "rgba(255,140,0,0.2)", icon: "⚠️", color: "#ff8c00", label: "MACRO CAUTION" },
  BLOCKED: { bg: "rgba(255,68,68,0.06)", border: "rgba(255,68,68,0.2)", icon: "🚫", color: "#ff4444", label: "MACRO BLOCKED" },
};

export default function MacroPreFlight({ data, loading }) {
  if (loading) {
    return (
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(201,168,76,0.1)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12 }}>📡</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Checking macro conditions...</span>
      </div>
    );
  }

  if (!data) return null;

  const cfg = STATUS_COLORS[data.status] || STATUS_COLORS.CLEAR;
  const checkedTime = data.timestamp ? new Date(data.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York", hour12: true }) + " ET" : "";

  return (
    <div data-testid="macro-preflight-bar" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: data.breakingNews?.length > 0 || data.eventsNext2H?.length > 0 || data.eventsNext4H?.length > 0 ? 8 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>📡</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, fontFamily: MONO, letterSpacing: "0.06em" }}>{cfg.label}</span>
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>Checked {checkedTime}</span>
      </div>

      {data.eventsNext2H?.filter(e => e.status === "UPCOMING").length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.eventsNext2H.filter(e => e.status === "UPCOMING").map((e, i) => (
            <div key={i} style={{ fontSize: 9, color: "#ff4444", fontFamily: SANS, lineHeight: 1.6 }}>
              {cfg.icon} {e.impact === "HIGH" ? "🔴" : "🟡"} {e.event} at {e.time} — {e.impact} impact
            </div>
          ))}
        </div>
      )}

      {data.eventsNext4H?.filter(e => e.status === "UPCOMING").length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.eventsNext4H.filter(e => e.status === "UPCOMING").map((e, i) => (
            <div key={i} style={{ fontSize: 9, color: "#ff8c00", fontFamily: SANS, lineHeight: 1.6 }}>
              ⚠️ {e.event} at {e.time} — {e.impact}
            </div>
          ))}
        </div>
      )}

      {data.eventsNext24H?.length > 0 && data.eventsNext2H?.filter(e => e.status === "UPCOMING").length === 0 && (
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: SANS, lineHeight: 1.6 }}>
          Next event: {data.eventsNext24H[0].event} at {data.eventsNext24H[0].time} {data.eventsNext24H[0].date}
        </div>
      )}

      {data.breakingNews?.length > 0 && data.breakingNews.map((n, i) => (
        <div key={i} style={{ fontSize: 9, color: "#ff4444", fontFamily: SANS, lineHeight: 1.6, marginTop: 2 }}>
          🔴 Breaking: {n.headline}{n.affectedAssets?.length > 0 ? ` → Affects: ${n.affectedAssets.join(", ")}` : ""}
        </div>
      ))}
    </div>
  );
}
