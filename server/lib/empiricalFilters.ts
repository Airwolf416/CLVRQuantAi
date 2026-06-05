// ── Empirical Expectancy Filters (June 2026) ────────────────────────────────
// Derived from the 1,260-resolved-signal expectancy study on `ai_signal_log`
// (2026-04-16 → 2026-06-05; see scripts/signal_backtest.cjs and
// .agents/memory/signal-expectancy-diagnostics.md). The raw scanner book is
// net-negative (profit factor ~0.74). Three leaks drive it:
//
//   1. LEVERAGE  — losses concentrate in the 3x+ tail. Cap live signals at 2x.
//   2. CONVICTION — the score INVERTS above 50 (PF ~0.40 at 50-60, ~0.13 at
//      60-80). The highest-"conviction" signals are the worst trades. Suppress
//      that tail outright (PREFERRED brain verdicts exempt — those are proven
//      edge, not unverified over-confidence).
//   3. TOKEN MIX — a small allowlist of names held positive expectancy
//      out-of-sample. SOFT gate: off-list coins still publish but their
//      displayed conviction is capped (nothing hidden, just down-weighted).
//
// An OOS-validated combination (conviction in [30,50) + 2x + allowlist) flipped
// profit factor to ~1.41 on the held-out 40% of trades.
//
// Pure module — no DB, no I/O. Every helper is flag-gated by the caller via
// server/lib/featureFlags.ts so an operator can toggle each lever independently.
//
// NOTE: POSITIVE_EXPECTANCY_TOKENS is SNAPSHOT-DERIVED and will drift as the
// book grows. It is intentionally a single editable constant — revisit it after
// re-running scripts/signal_backtest.cjs on fresh data.

/** Hard ceiling for leverage on live signals (the 3x+ tail is where losses concentrate). */
export const EMPIRICAL_LEVERAGE_CAP = 2;

/** Raw conviction at or above this is the empirically-inverted toxic tail. */
export const CONVICTION_TAIL_THRESHOLD = 50;

/** Displayed-conviction ceiling applied to off-list crypto tokens (soft gate). */
export const OFFLIST_CONVICTION_CAP = 40;

/**
 * Out-of-sample-validated positive-expectancy crypto universe. Off-list coins
 * are NOT dropped (soft gate) — only down-weighted. SNAPSHOT-DERIVED: re-derive
 * from scripts/signal_backtest.cjs as the trade book grows.
 */
export const POSITIVE_EXPECTANCY_TOKENS: ReadonlySet<string> = new Set([
  "ONDO", "HYPE", "WIF", "BTC", "ETH", "BNB", "JUP",
]);

export function isPositiveExpectancyToken(token: string): boolean {
  return POSITIVE_EXPECTANCY_TOKENS.has(String(token || "").toUpperCase().trim());
}

/** Parse a leverage value ("3x", "3", 3) to a positive number; defaults to 1. */
export function parseLeverageNum(lev: unknown): number {
  if (typeof lev === "number" && Number.isFinite(lev) && lev > 0) return lev;
  const n = parseFloat(String(lev ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Returns the empirical leverage ceiling to fold into existing `Math.min(...)`
 * leverage caps. Returns Infinity when disabled so callers can always write
 * `Math.min(lev, regimeCap, empiricalLeverageCeiling(enabled))`.
 */
export function empiricalLeverageCeiling(enabled: boolean): number {
  return enabled ? EMPIRICAL_LEVERAGE_CAP : Infinity;
}

/**
 * True when a signal sits in the empirically-toxic conviction tail and should
 * be dropped. PREFERRED brain verdicts (>=60% historical WR over n>=20) are
 * exempt — the inversion is a property of UNVERIFIED high conviction, not of
 * proven edge.
 */
export function isConvictionTailToxic(
  rawConvictionPct: number,
  brainVerdict: string | null | undefined,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (brainVerdict === "PREFERRED") return false;
  return Number(rawConvictionPct) >= CONVICTION_TAIL_THRESHOLD;
}

export interface TokenSoftGateResult {
  offList: boolean;
  conviction: number; // possibly-capped, 0..100
  capped: boolean;
}

/**
 * Soft token gate: off-list CRYPTO tokens keep publishing but their displayed
 * conviction is capped to OFFLIST_CONVICTION_CAP. Non-crypto and on-list tokens
 * pass through untouched. Nothing is ever dropped here — that is the whole point
 * of the "soft" choice; the only thing that drops an off-list coin is the
 * independent conviction-tail rule (same as for any coin).
 */
export function applyTokenSoftGate(
  token: string,
  isCrypto: boolean,
  displayedConvictionPct: number,
  enabled: boolean,
): TokenSoftGateResult {
  const conv = Math.max(0, Math.min(100, Number(displayedConvictionPct) || 0));
  if (!enabled || !isCrypto || isPositiveExpectancyToken(token)) {
    return { offList: false, conviction: conv, capped: false };
  }
  const capped = conv > OFFLIST_CONVICTION_CAP;
  return { offList: true, conviction: Math.min(conv, OFFLIST_CONVICTION_CAP), capped };
}
