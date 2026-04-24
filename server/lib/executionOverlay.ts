// ── Execution Overlay Eligibility & Session Anchor Config ────────────────────
// Single source of truth for: which symbols are eligible for VWAP/ORH/ORL
// overlays, and which session anchor + opening-range window applies to each
// asset class. Hard-excludes every crypto and every perp.
//
// Used by both backend (executionLevels.ts, /api/execution_levels route) and
// the frontend (Chart AI overlay component, AI Analyst context block) — the
// frontend mirrors this gate via /api/execution_levels/eligible.

import { CRYPTO_SYMS, HL_PERP_SYMS, EQUITY_SYMS } from "../config/assets";

export type ExecutionAssetClass = "equity_spot" | "fx_spot" | "commodity_spot";

// ── Spot equity universe ─────────────────────────────────────────────────────
// EQUITY_SYMS already lives in assets.ts and matches the MarketTab basket.
// We reuse it directly so any new equity added there inherits the overlay.
const EQUITY_SET = new Set<string>(EQUITY_SYMS);

// ── Spot FX universe ─────────────────────────────────────────────────────────
// Major + cross pairs already wired through Yahoo. Excludes synthetic pairs
// and any "PERP" or futures-style FX contract.
const FX_SET = new Set<string>([
  "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD",
  "EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD",
]);

// ── Spot commodity universe ──────────────────────────────────────────────────
// Underlying CME/COMEX/NYMEX contracts pulled via Yahoo (=F suffix).
// All listed here open 13:30 UTC for OR purposes (COMEX pit / NYMEX RTH).
const COMMODITY_SET = new Set<string>([
  "XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM","PALLADIUM",
]);

// ── Hard exclusion sets — symbols that must NEVER receive an overlay ─────────
const CRYPTO_EXCLUDE = new Set<string>([
  ...CRYPTO_SYMS,
  ...HL_PERP_SYMS,
  ...CRYPTO_SYMS.map(s => `${s}USDT`),
  ...CRYPTO_SYMS.map(s => `${s}-PERP`),
  ...CRYPTO_SYMS.map(s => `${s}-USD`),
]);

// ── Yahoo ticker map for OHLCV fetches ───────────────────────────────────────
const YF_FX_MAP: Record<string, string> = {
  EURUSD:"EURUSD=X", GBPUSD:"GBPUSD=X", USDJPY:"USDJPY=X", USDCHF:"USDCHF=X",
  AUDUSD:"AUDUSD=X", USDCAD:"USDCAD=X", NZDUSD:"NZDUSD=X", EURGBP:"EURGBP=X",
  EURJPY:"EURJPY=X", GBPJPY:"GBPJPY=X", USDMXN:"USDMXN=X", USDZAR:"USDZAR=X",
  USDTRY:"USDTRY=X", USDSGD:"USDSGD=X",
};

const YF_COMMODITY_MAP: Record<string, string> = {
  XAU:"GC=F", XAG:"SI=F", WTI:"CL=F", BRENT:"BZ=F",
  NATGAS:"NG=F", COPPER:"HG=F", PLATINUM:"PL=F", PALLADIUM:"PA=F",
};

// ── Public API ───────────────────────────────────────────────────────────────

export function getExecutionAssetClass(symbol: string): ExecutionAssetClass | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase().trim();
  if (CRYPTO_EXCLUDE.has(s)) return null;
  if (s.includes("-PERP") || s.includes("PERP")) return null;
  if (s.endsWith("USDT") || s.endsWith("-USD")) return null;
  if (EQUITY_SET.has(s)) return "equity_spot";
  if (FX_SET.has(s)) return "fx_spot";
  if (COMMODITY_SET.has(s)) return "commodity_spot";
  return null;
}

export function isExecutionOverlayEligible(symbol: string): boolean {
  return getExecutionAssetClass(symbol) !== null;
}

export function getYahooTickerFor(symbol: string): string | null {
  const cls = getExecutionAssetClass(symbol);
  if (!cls) return null;
  const s = symbol.toUpperCase().trim();
  if (cls === "equity_spot") return s;
  if (cls === "fx_spot") return YF_FX_MAP[s] || `${s}=X`;
  if (cls === "commodity_spot") return YF_COMMODITY_MAP[s] || null;
  return null;
}

export function getEligibleSymbols(): { equity: string[]; fx: string[]; commodity: string[] } {
  return {
    equity: Array.from(EQUITY_SET).sort(),
    fx: Array.from(FX_SET).sort(),
    commodity: Array.from(COMMODITY_SET).sort(),
  };
}

// ── Session anchor + opening-range window ───────────────────────────────────
// Returns the most recent session anchor in UTC ms that is <= now, plus the
// OR window length in minutes for that asset class.
//
// equity_spot:    NYSE/Nasdaq RTH open 13:30 UTC, 15-min OR
// fx_spot:        Sydney/Wellington open 22:00 UTC (FX daily roll), 60-min OR
// commodity_spot: COMEX/NYMEX RTH open 13:30 UTC, 30-min OR
//
// For equity & commodity: skip Sat/Sun. For FX: anchor walks Sun 22:00 UTC →
// Fri 21:59 UTC (the standard FX week). We do not handle holidays — the
// caller can detect "no bars after anchor" and skip rendering.
export function getSessionAnchor(
  cls: ExecutionAssetClass,
  now: Date = new Date()
): { anchorMs: number; orMinutes: number } {
  const orMinutes = cls === "equity_spot" ? 15 : cls === "fx_spot" ? 60 : 30;
  const anchorHourUTC = cls === "fx_spot" ? 22 : 13;
  const anchorMinuteUTC = cls === "fx_spot" ? 0 : 30;

  // Build today's anchor in UTC, then walk backwards if it's in the future
  // or lands on a weekend day we should skip.
  const anchor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    anchorHourUTC, anchorMinuteUTC, 0, 0
  ));

  // If today's anchor hasn't happened yet, step back one calendar day.
  if (anchor.getTime() > now.getTime()) {
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }

  // Skip weekend anchors per asset class.
  for (let i = 0; i < 4; i++) {
    const dow = anchor.getUTCDay(); // 0 Sun, 6 Sat
    if (cls === "equity_spot" || cls === "commodity_spot") {
      // Equity/commodity: Mon–Fri only (UTC weekday must be 1–5).
      if (dow >= 1 && dow <= 5) break;
    } else if (cls === "fx_spot") {
      // FX week opens Sun 22:00 UTC, closes Fri 22:00 UTC.
      // Valid anchor days (UTC): Sun (after 22:00), Mon, Tue, Wed, Thu.
      // A Fri 22:00 anchor would land in the closed market.
      if (dow >= 0 && dow <= 4) break;
    }
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }

  return { anchorMs: anchor.getTime(), orMinutes };
}
