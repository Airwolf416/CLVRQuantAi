import { useEffect, useState } from "react";

export default function PaymentSuccessPage() {
  const [status, setStatus] = useState("loading");
  const [plan, setPlan] = useState(null);
  const [email, setEmail] = useState(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) { setStatus("error"); return; }
    fetch(`/api/stripe/checkout-session-status?session_id=${encodeURIComponent(sessionId)}`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data?.status === "complete") {
          setStatus("complete");
          setPlan(data.plan);
          setEmail(data.customer_email);
          // Refresh tier in DB via the existing subscription endpoint (back-compat)
          fetch(`/api/stripe/subscription?session_id=${encodeURIComponent(sessionId)}`, { credentials: "include" }).catch(() => {});
        } else if (data?.status === "open") {
          setStatus("open");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  const wrap = { minHeight: "100vh", background: "#0a0e1a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "ui-sans-serif, system-ui" };

  if (status === "loading") return (
    <div data-testid="page-payment-success" style={wrap}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, color: "#9aa3b2", fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>Confirming payment…</div>
      </div>
    </div>
  );

  if (status === "complete") return (
    <div data-testid="page-payment-success" style={wrap}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>✓</div>
        <h1 style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 32, fontWeight: 900, margin: "0 0 14px 0", color: "#c9a84c" }}>
          Welcome to CLVR {plan || "Pro"}
        </h1>
        <p style={{ color: "#9aa3b2", margin: "0 0 8px 0", lineHeight: 1.6 }}>
          Your account has been upgraded. You now have full access to {plan === "Elite" ? "every Elite feature including Chart AI, SEC Insider Flow, and unlimited AI Analyst." : "all Pro features."}
        </p>
        {email && <p style={{ color: "#666", fontSize: 12, fontFamily: "ui-monospace, monospace", margin: "0 0 24px 0" }}>Receipt sent to {email}</p>}
        <a href="/" data-testid="link-dashboard" style={{ display: "inline-block", padding: "13px 28px", background: "#c9a84c", color: "#000", borderRadius: 4, textDecoration: "none", fontWeight: 800, fontFamily: "ui-monospace, monospace", letterSpacing: "0.06em" }}>
          Go to Dashboard
        </a>
      </div>
    </div>
  );

  if (status === "open") return (
    <div data-testid="page-payment-success" style={wrap}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, marginBottom: 10 }}>Payment not yet completed</div>
        <a href="/" style={{ color: "#c9a84c" }}>Return to app</a>
      </div>
    </div>
  );

  return (
    <div data-testid="page-payment-success" style={wrap}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, marginBottom: 10, color: "#ff4060" }}>Something went wrong</div>
        <div style={{ color: "#9aa3b2", marginBottom: 20 }}>If you were charged, please contact support — your account will be upgraded shortly.</div>
        <a href="/" style={{ color: "#c9a84c" }}>Return to app</a>
      </div>
    </div>
  );
}
