import { useEffect, useState, useCallback, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

let stripePromiseCache = null;
function getStripePromise() {
  if (stripePromiseCache) return stripePromiseCache;
  stripePromiseCache = fetch("/api/stripe/publishable-key", { credentials: "include" })
    .then(r => r.json())
    .then(d => {
      if (!d?.publishableKey) throw new Error("Missing Stripe publishable key");
      return loadStripe(d.publishableKey);
    });
  return stripePromiseCache;
}

export default function CheckoutPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const priceId = urlParams.get("priceId");
  const [stripe, setStripe] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const fetchedSecretRef = useRef(null);

  useEffect(() => {
    getStripePromise()
      .then(s => setStripe(s))
      .catch(e => setLoadErr(e?.message || "Failed to load Stripe"));
  }, []);

  const fetchClientSecret = useCallback(async () => {
    if (fetchedSecretRef.current) return fetchedSecretRef.current;
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ priceId }),
    });
    const data = await res.json();
    if (!res.ok || !data.clientSecret) throw new Error(data?.error || "Failed to create session");
    fetchedSecretRef.current = data.clientSecret;
    return data.clientSecret;
  }, [priceId]);

  if (!priceId) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 22, marginBottom: 10 }}>Missing plan</div>
          <div style={{ color: "#9aa3b2", marginBottom: 20 }}>No priceId in the URL — return to pricing and pick a plan.</div>
          <a href="/" style={{ display: "inline-block", padding: "12px 22px", background: "#c9a84c", color: "#000", borderRadius: 4, textDecoration: "none", fontWeight: 700 }}>Back to app</a>
        </div>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#ff4060", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Stripe failed to load</div>
          <div style={{ color: "#9aa3b2", fontSize: 13 }}>{loadErr}</div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="page-checkout" style={{ minHeight: "100vh", background: "#0a0e1a", padding: "32px 0" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <a href="/" data-testid="link-back" style={{ color: "#9aa3b2", textDecoration: "none", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>← Back</a>
          <div style={{ color: "#9aa3b2", fontSize: 11, fontFamily: "ui-monospace, monospace", letterSpacing: "0.12em" }}>SECURE · STRIPE</div>
        </div>
        <h1 style={{ fontFamily: "ui-serif, Georgia, serif", color: "#fff", fontSize: 24, fontWeight: 800, textAlign: "center", margin: "0 0 22px 0" }}>
          Complete your subscription
        </h1>
        <div id="checkout" style={{ borderRadius: 8, overflow: "hidden", background: "#fff", minHeight: 480 }}>
          {stripe ? (
            <EmbeddedCheckoutProvider stripe={stripe} options={{ fetchClientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "#666", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>Loading secure checkout…</div>
          )}
        </div>
      </div>
    </div>
  );
}
