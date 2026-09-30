import { BILLING_CURRENCY, SUBSCRIPTION_PRICES } from "../../../shared/billingPricing.js";

// Public CAD list prices never change based on untrusted/misconfigured Stripe data.
export const TIERS = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Start exploring markets",
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: "CAD",
    color: "#6b7a99",
    borderColor: "#1a2235",
    features: [
      { label: "Live crypto, equities & forex prices",      locked: false },
      { label: "Macro Calendar & market regime",            locked: false },
      { label: "Signals delayed 30 min — direction only",  locked: false },
      { label: "Signal history log",       locked: false },
      { label: "Real-time signals — entry, SL & TP",       locked: true,  note: "Pro" },
      { label: "AI confidence breakdown per signal",        locked: true,  note: "Pro" },
      { label: "Signal history, PnL & full AI reasoning",  locked: true,  note: "Pro" },
      { label: "AI Chat · Morning Brief trade ideas · Price Alerts", locked: true, note: "Pro" },
      { label: "Optional 6 AM daily Morning Brief email (market summary)", locked: false },
      { label: "AI Quant Engine · SEC Insider Flow",       locked: true,  note: "Elite only" },
    ],
  },
  pro: {
    id: "pro",
    name: "CLVR Pro",
    tagline: "The Retail Advantage",
    monthlyPrice: SUBSCRIPTION_PRICES.pro_monthly1.amount / 100,
    yearlyPrice: SUBSCRIPTION_PRICES.pro_yearly1.amount / 100,
    currency: BILLING_CURRENCY.toUpperCase(),
    color: "#d4af37",
    borderColor: "rgba(212,175,55,0.45)",
    badge: null,
    features: [
      { label: "Real-time signals — zero delay",                      locked: false },
      { label: "Full entry, stop-loss & take-profit targets",         locked: false },
      { label: "AI confidence breakdown & full reasoning",            locked: false },
      { label: "Full signal history + PnL records",                   locked: false },
      { label: "CLVR AI Market Chat · 30 req/day",                    locked: false },
      { label: "Morning Brief · Full Macro Calendar",                 locked: false },
      { label: "Custom price alerts & push notifications",            locked: false },
      { label: "AI Quant Engine",                                     locked: true,  note: "Elite only" },
      { label: "SEC Insider Flow · Basket Analysis",                  locked: true,  note: "Elite only" },
    ],
  },
  elite: {
    id: "elite",
    name: "CLVR Elite",
    tagline: "The Institutional Edge",
    monthlyPrice: SUBSCRIPTION_PRICES.elite_monthly.amount / 100,
    yearlyPrice: SUBSCRIPTION_PRICES.elite_yearly.amount / 100,
    currency: BILLING_CURRENCY.toUpperCase(),
    color: "#00e5ff",
    borderColor: "rgba(0,229,255,0.55)",
    badge: "RECOMMENDED",
    features: [
      { label: "All Pro markets + Forex & Commodities", locked: false, elite: true },
      { label: "QuantBrain AI · Unlimited requests",    locked: false, elite: true },
      { label: "AI Quant Engine — full access",         locked: false, elite: true },
      { label: "SEC Insider Flow · Whale tracking",     locked: false, elite: true, tag: "ELITE EXCLUSIVE" },
      { label: "Basket Analysis (3+ assets)",           locked: false, elite: true, tag: "ELITE EXCLUSIVE" },
      { label: "Squawk Box — Live Signal Announcer",    locked: false, elite: true, tag: "ELITE EXCLUSIVE" },
      { label: "Political Alpha · Deep news correlation",locked: false, elite: true, tag: "ELITE EXCLUSIVE" },
      { label: "Custom SMS & browser price alerts",     locked: false, elite: true },
      { label: "Funding rate flip alerts",              locked: false, elite: true },
    ],
  },
};

export const TIER_ORDER = ["free", "pro", "elite"];

export const BRIEF_RULE = "Optional 6 AM ET daily email for subscribers on every plan: Free gets the market summary without trade-idea cards; Pro gets up to 1 trade idea and Elite up to 3.";
export const SIGNAL_RULE = "Free: signals delayed 30 minutes with prices hidden. Pro & Elite: real-time signals with full trade data.";

export function annualSavings(tier) {
  return tier.monthlyPrice * 12 - tier.yearlyPrice;
}
export function annualDiscount(tier) {
  return tier.monthlyPrice ? Math.round(annualSavings(tier) / (tier.monthlyPrice * 12) * 100) : 0;
}
export function formatPrice(amount) {
  return `$${amount.toLocaleString("en-CA", { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

// Retain the hook interface used by public pages; checkout availability is
// fetched separately, but must never override the advertised CAD amounts.
export function usePricing() {
  return TIERS;
}

export function canAccess(userTier, requiredTier) {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}
