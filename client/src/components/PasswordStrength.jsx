import { passwordHints } from "../config/passwordPolicy.js";

export default function PasswordStrength({ password, requireMixedCaseAndNumber = false }) {
  const hints = passwordHints(password);
  const passed = hints.filter(h => h.met).length;
  return <div aria-live="polite" style={{ marginTop: 7, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#8b9ab5" }}>
    <div role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={passed}
      style={{ height: 4, borderRadius: 4, background: "#1c2b4a", overflow: "hidden", marginBottom: 6 }}>
      <div style={{ width: `${passed * 25}%`, height: "100%", background: passed === 4 ? "#00c787" : passed >= 2 ? "#c9a84c" : "#ff8c00", transition: "width .2s" }} />
    </div>
    {hints.map(h => <span key={h.label} style={{ display: "inline-block", marginRight: 8, color: h.met ? "#00c787" : "#8b9ab5" }}>{h.met ? "✓" : "○"} {h.label}</span>)}
    <div style={{ marginTop: 3 }}>{requireMixedCaseAndNumber ? "10 characters, mixed case and a number are required here; a symbol improves strength." : "Only 10 characters are required; mixed case, number and symbol improve strength."}</div>
  </div>;
}