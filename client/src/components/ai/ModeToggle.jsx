const MONO = "'IBM Plex Mono', monospace";

export default function ModeToggle({ mode, onChange, isPro }) {
  if (!isPro) return null;

  return (
    <div style={{ display: "flex", background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, overflow: "hidden" }}>
      <button
        data-testid="btn-mode-simple"
        onClick={() => onChange("simple")}
        style={{
          flex: 1, padding: "8px 16px", background: mode === "simple" ? "rgba(201,168,76,0.12)" : "transparent",
          border: "none", borderRight: "1px solid rgba(201,168,76,0.15)",
          color: mode === "simple" ? "#e8c96d" : "rgba(255,255,255,0.4)",
          fontFamily: MONO, fontSize: 10, fontWeight: mode === "simple" ? 700 : 400,
          letterSpacing: "0.08em", cursor: "pointer", transition: "all 0.2s",
        }}
      >
        Simple
      </button>
      <button
        data-testid="btn-mode-pro"
        onClick={() => onChange("pro")}
        style={{
          flex: 1, padding: "8px 16px", background: mode === "pro" ? "rgba(201,168,76,0.12)" : "transparent",
          border: "none",
          color: mode === "pro" ? "#e8c96d" : "rgba(255,255,255,0.4)",
          fontFamily: MONO, fontSize: 10, fontWeight: mode === "pro" ? 700 : 400,
          letterSpacing: "0.08em", cursor: "pointer", transition: "all 0.2s",
        }}
      >
        Pro
      </button>
    </div>
  );
}
