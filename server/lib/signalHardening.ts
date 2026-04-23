// ============================================================================
// signalHardening — mechanical post-signal gates that protect against the
// failure modes documented in the ONDO short stop-out (tight SL inside one-
// candle noise + sitting on a visible liquidity cluster + counter to a clear
// higher-low microstructure).
//
// Five gates, applied in order:
//   1) ATR-gated SL          — SL distance must be ≥ 1.5·ATR(14)
//   2) Counter-trend micro   — −15 conviction if signal fights last-6-candle bias
//   3) Liquidity-aware SL    — shift SL beyond clusters within 0.2% of stop
//   4) Funding/OI crowded    — reject when one side is provably overcrowded
//   5) Friction-adjusted R:R — require post-cost R:R ≥ 1.8
//
// Each gate returns either ACCEPT, ADJUST (with `adjustments_applied` notes
// and possibly a sized-down position), or REJECT (with a structured reason).
// ============================================================================

import { calcATR14, detectMicrostructure, type Candle } from "../services/ta";
import { logRejection, type RejectionReason } from "./rejectionLog";

export type HoldHorizon = "scalp" | "swing";       // <4h vs ≥4h

export interface HardeningInput {
  token:           string;
  direction:       "LONG" | "SHORT";
  entry:           number;
  stopLoss:        number;
  tp1:             number;
  tp2:             number;
  conviction:      number;          // 0–100, the engine's own score
  candles:         Candle[];        // entry-timeframe OHLC, oldest → newest
  fundingRate?:    number;          // %/8h, e.g. 0.012 == +0.012%
  oiChange6hPct?:  number;          // % change in OI over last 6h
  expectedHoldHrs?: number;         // for friction calc, default = scalp/swing inferred
  holdHorizon?:    HoldHorizon;
  liquidityClusters?: Array<{ price: number; side: "LONG" | "SHORT" }>; // stub today
  source:          "auto_scanner" | "ai_signal" | "manual";
}

export interface HardeningAdjustment {
  type:    "atr_widened" | "size_reduced" | "liquidity_shifted" | "conviction_penalty";
  detail:  string;
  before?: number;
  after?:  number;
}

export type HardeningResult =
  | {
      action:        "ACCEPT";
      signal:        Pick<HardeningInput, "entry" | "stopLoss" | "tp1" | "tp2" | "conviction"> & { sizeMultiplier: number; rrAfterFriction: number };
      adjustments:   HardeningAdjustment[];
    }
  | {
      action:        "ADJUST";
      signal:        Pick<HardeningInput, "entry" | "stopLoss" | "tp1" | "tp2" | "conviction"> & { sizeMultiplier: number; rrAfterFriction: number };
      adjustments:   HardeningAdjustment[];
    }
  | {
      action:        "REJECT";
      reason:        RejectionReason;
      detail:        string;
      adjustments:   HardeningAdjustment[];
    };

// ── Tunables (centralized so they're easy to tweak in one place) ────────────
const MIN_ATR_MULTIPLE        = 1.5;
const MIN_CONFIDENCE          = 55;
const COUNTER_TREND_PENALTY   = 15;
const LIQUIDITY_PROXIMITY_PCT = 0.002;   // 0.2%
const LIQUIDITY_BUFFER_PCT    = 0.0015;  // 0.15%
const FUNDING_SHORT_THRESHOLD = -0.01;   // %/8h — shorts crowded if funding ≤ this
const FUNDING_LONG_THRESHOLD  =  0.03;   // %/8h — longs crowded if funding ≥ this
const OI_CROWDED_THRESHOLD    =  3.0;    // % growth over 6h
const SLIPPAGE_BPS            =  2;      // each side
const MIN_RR_AFTER_FRICTION   =  1.8;

// ── Stub for Coinglass heatmap — returns [] today.
// When a Coinglass client is added, swap this for the real fetch and the
// liquidity-aware SL gate becomes active automatically.
export async function getLiquidityClusters(_token: string): Promise<Array<{ price: number; side: "LONG" | "SHORT" }>> {
  return [];
}

// ── Gate 1: ATR-gated SL ────────────────────────────────────────────────────
function gate_atr(input: HardeningInput, atr: number, adj: HardeningAdjustment[]): { stopLoss: number; sizeMultiplier: number } | { reject: { reason: RejectionReason; detail: string } } {
  const slDist = Math.abs(input.entry - input.stopLoss);
  const minDist = MIN_ATR_MULTIPLE * atr;
  if (atr <= 0) return { stopLoss: input.stopLoss, sizeMultiplier: 1 };  // no candle data → skip
  if (slDist >= minDist) return { stopLoss: input.stopLoss, sizeMultiplier: 1 };

  const horizon: HoldHorizon = input.holdHorizon || ((input.expectedHoldHrs ?? 1) >= 4 ? "swing" : "scalp");
  if (horizon === "swing") {
    return { reject: { reason: "SL_TOO_TIGHT_VS_ATR", detail: `swing signal: SL ${slDist.toFixed(6)} < 1.5·ATR ${minDist.toFixed(6)}` } };
  }
  // Scalp: widen SL to 1.5·ATR, scale size down proportionally to preserve $ risk.
  const newStop = input.direction === "LONG" ? input.entry - minDist : input.entry + minDist;
  const sizeMultiplier = slDist / minDist;
  adj.push({
    type: "atr_widened",
    detail: `ATR-adjusted SL: ${input.stopLoss.toFixed(6)} → ${newStop.toFixed(6)} (1.5·ATR floor)`,
    before: input.stopLoss, after: newStop,
  });
  adj.push({
    type: "size_reduced",
    detail: `Position size scaled to ${(sizeMultiplier * 100).toFixed(0)}% to preserve original $ risk`,
    before: 1, after: sizeMultiplier,
  });
  return { stopLoss: newStop, sizeMultiplier };
}

// ── Gate 2: Counter-trend microstructure penalty ────────────────────────────
function gate_microstructure(input: HardeningInput, conv: number, adj: HardeningAdjustment[]): { conviction: number } | { reject: { reason: RejectionReason; detail: string } } {
  const ms = detectMicrostructure(input.candles, 6);
  const fightsTrend =
    (input.direction === "SHORT" && ms.microUp) ||
    (input.direction === "LONG"  && ms.microDown);
  if (!fightsTrend) return { conviction: conv };
  const after = conv - COUNTER_TREND_PENALTY;
  adj.push({
    type: "conviction_penalty",
    detail: `Counter-trend micro (HH:${ms.hhCount} HL:${ms.hlCount} LH:${ms.lhCount} LL:${ms.llCount}) → −${COUNTER_TREND_PENALTY}`,
    before: conv, after,
  });
  if (after < MIN_CONFIDENCE) {
    return { reject: { reason: "COUNTER_TREND_MICRO", detail: `conv ${conv}→${after} < ${MIN_CONFIDENCE} after counter-trend penalty` } };
  }
  return { conviction: after };
}

// ── Gate 3: Liquidity-aware SL placement ────────────────────────────────────
function gate_liquidity(input: HardeningInput, currentStop: number, adj: HardeningAdjustment[]): { stopLoss: number } | { reject: { reason: RejectionReason; detail: string } } {
  const clusters = input.liquidityClusters || [];
  if (!clusters.length) return { stopLoss: currentStop };  // no data → no-op
  const proximity = currentStop * LIQUIDITY_PROXIMITY_PCT;
  // For SHORT, sweep side is ABOVE entry (clusters above stop are dangerous).
  // For LONG,  sweep side is BELOW entry (clusters below stop are dangerous).
  const sweepSide = input.direction === "SHORT" ? "LONG" : "SHORT";
  const danger = clusters.find(c => c.side === sweepSide && Math.abs(c.price - currentStop) <= proximity);
  if (!danger) return { stopLoss: currentStop };

  const buffer = currentStop * LIQUIDITY_BUFFER_PCT;
  const newStop = input.direction === "SHORT" ? danger.price + buffer : danger.price - buffer;
  // Verify R:R hasn't collapsed (target must still be > 1× shifted SL distance).
  const newSlDist = Math.abs(input.entry - newStop);
  const tp1Dist = Math.abs(input.entry - input.tp1);
  if (newSlDist > 0 && (tp1Dist / newSlDist) < 1) {
    return { reject: { reason: "SL_IN_LIQUIDITY_POCKET", detail: `cluster at ${danger.price} blocks safe SL placement (R:R would invert)` } };
  }
  adj.push({
    type: "liquidity_shifted",
    detail: `Liquidity-shifted SL: ${currentStop.toFixed(6)} → ${newStop.toFixed(6)} (cluster @ ${danger.price})`,
    before: currentStop, after: newStop,
  });
  return { stopLoss: newStop };
}

// ── Gate 4: Funding + OI crowded ────────────────────────────────────────────
function gate_funding_oi(input: HardeningInput): { reject: { reason: RejectionReason; detail: string } } | null {
  const fr = input.fundingRate;
  const oiChg = input.oiChange6hPct;
  if (fr === undefined || oiChg === undefined) return null;     // gracefully skip when data missing
  if (input.direction === "SHORT" && fr < FUNDING_SHORT_THRESHOLD && oiChg > OI_CROWDED_THRESHOLD) {
    return { reject: { reason: "SHORTS_CROWDED", detail: `funding ${fr.toFixed(4)}%/8h, OI +${oiChg.toFixed(1)}% (squeeze risk)` } };
  }
  if (input.direction === "LONG" && fr > FUNDING_LONG_THRESHOLD && oiChg > OI_CROWDED_THRESHOLD) {
    return { reject: { reason: "LONGS_CROWDED", detail: `funding ${fr.toFixed(4)}%/8h, OI +${oiChg.toFixed(1)}% (flush risk)` } };
  }
  return null;
}

// ── Gate 5: Friction-adjusted R:R ───────────────────────────────────────────
// Returns the computed friction-adjusted R:R alongside any rejection so the
// caller can surface it on the signal card (spec requires displayed R:R to
// reflect real execution cost).
export function computeFrictionRR(input: { entry: number; stopLoss: number; tp: number; fundingRate?: number; expectedHoldHrs?: number; holdHorizon?: HoldHorizon }): number {
  const slDist = Math.abs(input.entry - input.stopLoss);
  if (slDist <= 0) return 0;
  const tpDist = Math.abs(input.entry - input.tp);
  const slipCost = input.entry * (SLIPPAGE_BPS / 10_000) * 2;
  const holdHrs  = input.expectedHoldHrs ?? (input.holdHorizon === "swing" ? 12 : 2);
  const fundingCost = input.fundingRate !== undefined ? Math.abs(input.entry * (input.fundingRate / 100) * (holdHrs / 8)) : 0;
  const adjReward = Math.max(0, tpDist - slipCost - fundingCost);
  return adjReward / slDist;
}
function gate_friction(input: HardeningInput, currentStop: number): { reject: { reason: RejectionReason; detail: string } } | null {
  const adjRR = computeFrictionRR({ entry: input.entry, stopLoss: currentStop, tp: input.tp1, fundingRate: input.fundingRate, expectedHoldHrs: input.expectedHoldHrs, holdHorizon: input.holdHorizon });
  if (adjRR > 0 && adjRR < MIN_RR_AFTER_FRICTION) {
    return { reject: { reason: "RR_TOO_LOW_AFTER_FRICTION", detail: `post-friction R:R ${adjRR.toFixed(2)} < ${MIN_RR_AFTER_FRICTION}` } };
  }
  return null;
}

// ── Public entry point — runs all gates in order ────────────────────────────
export function applySignalHardening(input: HardeningInput): HardeningResult {
  const adjustments: HardeningAdjustment[] = [];
  let stopLoss   = input.stopLoss;
  let conviction = input.conviction;
  const sizeMultiplier = 1;

  const atr = calcATR14(input.candles);

  // 1) ATR
  const r1 = gate_atr(input, atr, adjustments);
  if ("reject" in r1) {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason: r1.reject.reason, detail: r1.reject.detail });
    return { action: "REJECT", reason: r1.reject.reason, detail: r1.reject.detail, adjustments };
  }
  stopLoss = r1.stopLoss;
  let resultSizeMul = r1.sizeMultiplier;

  // 2) Microstructure
  const r2 = gate_microstructure(input, conviction, adjustments);
  if ("reject" in r2) {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason: r2.reject.reason, detail: r2.reject.detail });
    return { action: "REJECT", reason: r2.reject.reason, detail: r2.reject.detail, adjustments };
  }
  conviction = r2.conviction;

  // 3) Liquidity
  const r3 = gate_liquidity(input, stopLoss, adjustments);
  if ("reject" in r3) {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason: r3.reject.reason, detail: r3.reject.detail });
    return { action: "REJECT", reason: r3.reject.reason, detail: r3.reject.detail, adjustments };
  }
  stopLoss = r3.stopLoss;

  // 4) Funding / OI
  const r4 = gate_funding_oi(input);
  if (r4) {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason: r4.reject.reason, detail: r4.reject.detail });
    return { action: "REJECT", reason: r4.reject.reason, detail: r4.reject.detail, adjustments };
  }

  // 5) Friction-adjusted R:R (use the post-liquidity SL)
  const r5 = gate_friction({ ...input, stopLoss }, stopLoss);
  if (r5) {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason: r5.reject.reason, detail: r5.reject.detail });
    return { action: "REJECT", reason: r5.reject.reason, detail: r5.reject.detail, adjustments };
  }

  const action = adjustments.length > 0 ? "ADJUST" : "ACCEPT";
  const rrAfterFriction = computeFrictionRR({ entry: input.entry, stopLoss, tp: input.tp1, fundingRate: input.fundingRate, expectedHoldHrs: input.expectedHoldHrs, holdHorizon: input.holdHorizon });
  return {
    action,
    signal: { entry: input.entry, stopLoss, tp1: input.tp1, tp2: input.tp2, conviction, sizeMultiplier: resultSizeMul, rrAfterFriction: +rrAfterFriction.toFixed(2) },
    adjustments,
  };
}

// ── Lightweight OI-history cache for 6h delta computation ───────────────────
// Keyed by token; stores {ts, oi} samples and exposes pctChange over a window.
// The auto-scanner ticks frequently so this stays warm without any DB hit.
const oiSamples = new Map<string, Array<{ ts: number; oi: number }>>();
const OI_TTL_MS = 7 * 60 * 60 * 1000;  // keep 7h so 6h lookback is always covered
export function recordOiSample(token: string, oi: number, now = Date.now()): void {
  if (!Number.isFinite(oi) || oi <= 0) return;
  const arr = oiSamples.get(token) || [];
  arr.push({ ts: now, oi });
  // Drop expired samples from the head (oldest first)
  const cutoff = now - OI_TTL_MS;
  while (arr.length > 0 && arr[0].ts < cutoff) arr.shift();
  oiSamples.set(token, arr);
}
export function getOiChangePct(token: string, windowMs = 6 * 60 * 60 * 1000, now = Date.now()): number | undefined {
  const arr = oiSamples.get(token);
  if (!arr || arr.length < 2) return undefined;
  const target = now - windowMs;
  // Find the sample closest to target time (binary not needed — array small)
  let baseline = arr[0];
  for (const s of arr) {
    if (s.ts <= target) baseline = s;
    else break;
  }
  // Require the baseline to actually be near the requested window (within 25%)
  const ageMs = now - baseline.ts;
  if (ageMs < windowMs * 0.75) return undefined;
  const latest = arr[arr.length - 1];
  if (baseline.oi <= 0) return undefined;
  return ((latest.oi - baseline.oi) / baseline.oi) * 100;
}
