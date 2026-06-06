// ============================================================
// server/signalGate.ts
// CLVRQuant — Deterministic signal gate
// ------------------------------------------------------------
// Fixes the four structural leaks the backtest exposed:
//   1. CONVICTION INVERSION — engine scored confidence off raw move
//      size, so high-conviction = post-spike chases that mean-revert.
//      Fix: recalibrate conviction to reward STRUCTURE/CHECK QUALITY
//      and PENALIZE over-extension. Hard-cap the toxic high band.
//   2. ALT BLEED — edge concentrates in liquid majors; alts gated
//      behind a much higher bar (tiered allowlist).
//   3. LEVERAGE — 3x+ underperformed; cap at 2x (3x only for a major
//      with strong calibrated conviction).
//   4. OVER-TRADING — first-week firehose drove the -98% curve.
//      Suppress post-spike entries + hourly throttle.
//
// Deterministic by design (regime-gate principle: the engine/AI
// proposes, this rule layer validates before anything reaches users).
// Information & education only — this is risk control, not a profit
// claim. Re-validate the allowlist quarterly with signal_backtest.js.
// ============================================================

// ---- CONFIG (tune here; provenance: OOS window 2026-04-16→06-05) ----
export const GATE = {
  // Asset tiers. Majors = full access. Tier-2 = validated positive-
  // expectancy names (revalidate). Everything else = alt (high bar).
  MAJORS:       ["BTC", "ETH", "BNB"],
  TIER2_ALLOW:  ["DOGE", "JUP", "HYPE", "WIF", "ONDO"],

  SPIKE_PCT:        8,    // move ≥ this % in the detection window = chase → suppress
  MIN_CONV_FLOOR:   45,   // global floor — never surface below this, any tier
  TIER2_MIN_CONV:   60,   // tier-2 names must clear this
  ALT_MIN_CONV:     82,   // tier-3 alts must be near-perfect to surface
  LEVERAGE_MAX:     2,    // global leverage cap
  LEVERAGE_MAX_T1:  3,    // majors only, and only when conviction ≥ STRONG
  STRONG_CONV:      75,
  THROTTLE_PER_HOUR: 6,   // max signals surfaced per rolling hour
};

export function tierOf(token: string): 1 | 2 | 3 {
  if (GATE.MAJORS.includes(token)) return 1;
  if (GATE.TIER2_ALLOW.includes(token)) return 2;
  return 3;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// Recalibrate conviction: quality-driven, over-extension-penalized.
// This is the inversion fix — large moves now REDUCE conviction.
export function calibrateConviction(sig: any): number {
  const passed = sig.checksPassedCount ?? 0;
  const total  = sig.checksTotalCount  ?? 5;
  const checkQ = total > 0 ? passed / total : 0;            // 0..1
  const adv    = clamp(sig.advancedScore ?? 0, 0, 100) / 100; // 0..1
  const absMove = Math.abs(sig.pctMove ?? 0);
  let c = 8 + checkQ * 45 + adv * 40;                       // ~8..93 from quality
  c -= Math.min(35, Math.max(0, (absMove - 2) * 4));        // discount moves beyond ~2%
  return clamp(Math.round(c), 0, 100);
}

export interface GateResult {
  pass: boolean;
  conf: number;
  lev: number;
  tier: 1 | 2 | 3;
  reasons: string[];
}

// signal = the built signal object (token, dir, lev, pctMove,
//   checksPassedCount/Total, advancedScore …)
// ctx.surfacedTs = timestamps (ms) of recently surfaced signals (for throttle)
export function applySignalGate(sig: any, ctx: { surfacedTs?: number[] } = {}): GateResult {
  const reasons: string[] = [];
  const tier = tierOf(sig.token);
  const absMove = Math.abs(sig.pctMove ?? 0);

  let conf = calibrateConviction(sig);

  // 4. over-trading / chase suppression
  if (absMove >= GATE.SPIKE_PCT)
    return { pass: false, conf, lev: 0, tier, reasons: [`post-spike ${absMove.toFixed(1)}% — mean-reversion risk`] };

  // global quality floor — drop garbage regardless of tier
  if (conf < GATE.MIN_CONV_FLOOR)
    return { pass: false, conf, lev: 0, tier, reasons: [`below quality floor (${conf}<${GATE.MIN_CONV_FLOOR})`] };

  // 2. asset gate
  if (tier === 3 && conf < GATE.ALT_MIN_CONV)
    return { pass: false, conf, lev: 0, tier, reasons: [`alt below bar (${conf}<${GATE.ALT_MIN_CONV})`] };
  if (tier === 2 && conf < GATE.TIER2_MIN_CONV)
    return { pass: false, conf, lev: 0, tier, reasons: [`tier-2 below bar (${conf}<${GATE.TIER2_MIN_CONV})`] };

  // 4. hourly throttle (keep best, drop the firehose)
  const hourAgo = Date.now() - 3_600_000;
  const recent = (ctx.surfacedTs || []).filter(t => t > hourAgo).length;
  if (recent >= GATE.THROTTLE_PER_HOUR)
    return { pass: false, conf, lev: 0, tier, reasons: [`hourly throttle (${recent}/${GATE.THROTTLE_PER_HOUR})`] };

  // 3. leverage cap
  let lev = parseInt(String(sig.lev)) || 2;
  const maxLev = tier === 1 && conf >= GATE.STRONG_CONV ? GATE.LEVERAGE_MAX_T1 : GATE.LEVERAGE_MAX;
  if (lev > maxLev) { lev = maxLev; reasons.push(`leverage capped ${maxLev}x`); }

  return { pass: true, conf, lev, tier, reasons };
}
