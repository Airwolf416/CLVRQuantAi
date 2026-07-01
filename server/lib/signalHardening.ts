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
  liquidityClusters?: Array<{ price: number; side: "LONG" | "SHORT"; notionalUsd?: number }>;
  volume24hUsd?:   number;          // for cluster-significance threshold (passed through to caller)
  source:          "auto_scanner" | "ai_signal" | "manual";
}

export interface HardeningAdjustment {
  type:    "atr_widened" | "size_reduced" | "liquidity_shifted" | "conviction_penalty" | "direction_repair";
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
// Lowered from 1.8 → 1.65 (Apr 2026) after rejection-log analysis showed
// the engine consistently produces post-friction R:R in the 1.60–1.72
// band; the 1.80 floor was killing ~3,000 borderline signals/day for no
// statistical benefit. 1.65 still rejects truly thin setups (< 1.5 R:R
// after costs) while letting the engine's normal output flow through.
const MIN_RR_AFTER_FRICTION   =  1.65;

// Real Coinglass heatmap is fetched by the caller (server/services/coinglass.ts);
// the gate accepts an optional cluster array so the hardening module stays
// dependency-free and unit-testable.

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
  // For a LONG setup the stop sits BELOW entry; if a LONG-liquidation cluster
  // sits at/just past the stop, a flush there triggers a cascade that sweeps
  // the stop. Symmetric reasoning for SHORT (cluster of shorts above stop →
  // squeeze cascade). So the dangerous side equals the trade direction.
  const sweepSide = input.direction;
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
    return { reject: { reason: "RR_TOO_LOW_AFTER_FRICTION", detail: `post-friction R:R ${adjRR.toFixed(4)} < ${MIN_RR_AFTER_FRICTION}` } };
  }
  return null;
}

// ── Statistical Brain limits gate (STRICT) ──────────────────────────────────
// Empirical floor/ceiling on TP, SL, and kill clock derived from this combo's
// historical resolved trades. Vetoes signals that violate physically-realistic
// limits the engine has demonstrated in the wild.
//
// Returns { ok: true } when the proposal is within limits or the brain has
// no data. Returns { reject } when STRICT mode trips a violation.
//
// Inputs in price units. Brain limits are in R-multiples — caller passes
// limits and we convert against the proposal's own SL distance.
// Note on minSlR: R is always 1.0 relative to the proposal's own SL by
// definition, so a minSlR floor cannot be enforced from R alone. Caller must
// translate the brain's avgLossPct into minSlPct and pass that.
export interface BrainLimitsCheck {
  entry:        number;
  stopLoss:     number;
  tp1:          number;
  killClockHrs: number;
  direction:    "LONG" | "SHORT";  // kept for log/debug context
}
export interface BrainLimitsInput {
  maxTpR?:            number;     // strict cap on TP1 R-multiple
  minSlPct?:          number;     // strict floor on SL distance as % of price
  maxKillClockHours?: number;     // strict cap on planned hold duration
}
export type BrainLimitsResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason; detail: string };

export function applyBrainLimits(
  proposal: BrainLimitsCheck,
  limits:   BrainLimitsInput,
): BrainLimitsResult {
  const slDist = Math.abs(proposal.entry - proposal.stopLoss);
  if (slDist <= 0 || !Number.isFinite(slDist)) return { ok: true };  // trust earlier gates
  const tpDist = Math.abs(proposal.entry - proposal.tp1);
  const tpR    = tpDist / slDist;

  // 1) TP cap — can't exceed empirical winner reach × headroom
  if (limits.maxTpR != null && tpR > limits.maxTpR) {
    return { ok: false, reason: "TP_BEYOND_BRAIN_LIMIT" as RejectionReason,
      detail: `TP1 R=${tpR.toFixed(2)} exceeds Brain max ${limits.maxTpR.toFixed(2)}R (historical winners cap here)` };
  }

  // 2) SL distance floor — can't be tighter than empirical noise band
  if (limits.minSlPct != null) {
    const slPct = (slDist / proposal.entry) * 100;
    if (slPct < limits.minSlPct) {
      return { ok: false, reason: "SL_TIGHTER_THAN_BRAIN_LIMIT" as RejectionReason,
        detail: `SL distance ${slPct.toFixed(2)}% < Brain min ${limits.minSlPct.toFixed(2)}% (avg loser depth)` };
    }
  }

  // 3) Kill clock cap — must resolve in empirically-observed window
  if (limits.maxKillClockHours != null && proposal.killClockHrs > limits.maxKillClockHours) {
    return { ok: false, reason: "KILL_CLOCK_BEYOND_BRAIN_LIMIT" as RejectionReason,
      detail: `kill clock ${proposal.killClockHrs}h > Brain max ${limits.maxKillClockHours}h (median resolution time)` };
  }

  return { ok: true };
}

// ── Public entry point — runs all gates in order ────────────────────────────
export function applySignalHardening(input: HardeningInput): HardeningResult {
  const adjustments: HardeningAdjustment[] = [];
  let stopLoss   = input.stopLoss;
  let tp1        = input.tp1;
  let tp2        = input.tp2;
  let conviction = input.conviction;

  // Helper to consistently log + return REJECT with the proposal context so
  // the admin tuning dashboard sees the entry/SL/TP that would have shipped.
  const ctx = { proposedEntry: input.entry, proposedSl: input.stopLoss, proposedTp1: input.tp1, conviction: input.conviction };
  const reject = (reason: RejectionReason, detail: string): HardeningResult => {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason, detail }, ctx);
    return { action: "REJECT", reason, detail, adjustments };
  };

  // ── Gate 0: Directional geometry coherence (REPAIR, runs before all others) ─
  // Every downstream gate measures distance with Math.abs(), so a level on the
  // WRONG side of entry for the trade's `direction` (e.g. a SHORT whose target
  // sits ABOVE entry) still yields a healthy positive R:R and would slip
  // straight through. Enforce the invariant here and mirror any offending level
  // across entry so entry / stop / targets are always coherent with direction.
  // MODE="repair" fixes in place (matches the /api/quant inline behaviour and
  // keeps signal throughput up); MODE="reject" would drop-and-log instead.
  const MODE: "repair" | "reject" = "repair";
  {
    const { entry, direction } = input;
    const slDist = Math.abs(entry - stopLoss) || entry * 0.01;
    const R1 = 1.5, R2 = 2.5;   // default TP R-multiples when a target must be rebuilt
    const hasTp2 = Number.isFinite(tp2) && tp2 > 0;
    const geomBad =
      Number.isFinite(entry) && Number.isFinite(stopLoss) && Number.isFinite(tp1) &&
      (direction === "LONG"
        ? (stopLoss >= entry || tp1 <= entry || (hasTp2 && tp2 <= entry))
        : (stopLoss <= entry || tp1 >= entry || (hasTp2 && tp2 >= entry)));
    if (geomBad) {
      if (MODE === "reject") {
        return reject(
          "DIRECTION_GEOMETRY_MISMATCH",
          `${direction} levels inverted vs entry (entry=${entry}, sl=${stopLoss}, tp1=${tp1}${hasTp2 ? `, tp2=${tp2}` : ""})`,
        );
      }
      const fixes: string[] = [];
      if (direction === "LONG") {
        if (stopLoss >= entry)      { const b = stopLoss; stopLoss = entry - slDist;     fixes.push(`SL ${b}→${stopLoss.toFixed(6)}`); }
        if (tp1 <= entry)           { const b = tp1;      tp1 = entry + slDist * R1;      fixes.push(`TP1 ${b}→${tp1.toFixed(6)}`); }
        if (hasTp2 && tp2 <= entry) { const b = tp2;      tp2 = entry + slDist * R2;      fixes.push(`TP2 ${b}→${tp2.toFixed(6)}`); }
      } else {
        if (stopLoss <= entry)      { const b = stopLoss; stopLoss = entry + slDist;     fixes.push(`SL ${b}→${stopLoss.toFixed(6)}`); }
        if (tp1 >= entry)           { const b = tp1;      tp1 = entry - slDist * R1;      fixes.push(`TP1 ${b}→${tp1.toFixed(6)}`); }
        if (hasTp2 && tp2 >= entry) { const b = tp2;      tp2 = entry - slDist * R2;      fixes.push(`TP2 ${b}→${tp2.toFixed(6)}`); }
      }
      // A partial repair can leave the ladder non-monotonic (a rebuilt TP1 landing
      // beyond an already-valid but nearby TP2, or vice-versa). Keep TP2 strictly
      // beyond TP1 in the trade direction so R-multiples stay coherent downstream.
      if (hasTp2) {
        if (direction === "LONG"  && tp2 <= tp1) { const b = tp2; tp2 = tp1 + slDist; fixes.push(`TP2(order) ${b}→${tp2.toFixed(6)}`); }
        if (direction === "SHORT" && tp2 >= tp1) { const b = tp2; tp2 = tp1 - slDist; fixes.push(`TP2(order) ${b}→${tp2.toFixed(6)}`); }
      }
      if (fixes.length) {
        const detail = `Direction geometry repair (${direction}): ${fixes.join("; ")}`;
        adjustments.push({ type: "direction_repair", detail });
        console.warn(`[hardening] ${input.token} ${direction}: inverted levels auto-corrected — ${fixes.join("; ")}`);
      }
    }
  }

  // Every downstream gate + the returned signal use the geometry-repaired levels.
  const gi: HardeningInput = { ...input, stopLoss, tp1, tp2 };
  const atr = calcATR14(gi.candles);

  // 1) ATR
  const r1 = gate_atr(gi, atr, adjustments);
  if ("reject" in r1) return reject(r1.reject.reason, r1.reject.detail);
  stopLoss = r1.stopLoss;
  let resultSizeMul = r1.sizeMultiplier;

  // 2) Microstructure
  const r2 = gate_microstructure(gi, conviction, adjustments);
  if ("reject" in r2) return reject(r2.reject.reason, r2.reject.detail);
  conviction = r2.conviction;

  // 3) Liquidity
  const r3 = gate_liquidity(gi, stopLoss, adjustments);
  if ("reject" in r3) return reject(r3.reject.reason, r3.reject.detail);
  stopLoss = r3.stopLoss;

  // 4) Funding / OI
  const r4 = gate_funding_oi(gi);
  if (r4) return reject(r4.reject.reason, r4.reject.detail);

  // 5) Friction-adjusted R:R (use the post-liquidity SL)
  const r5 = gate_friction({ ...gi, stopLoss }, stopLoss);
  if (r5) return reject(r5.reject.reason, r5.reject.detail);

  const action = adjustments.length > 0 ? "ADJUST" : "ACCEPT";
  const rrAfterFriction = computeFrictionRR({ entry: gi.entry, stopLoss, tp: tp1, fundingRate: gi.fundingRate, expectedHoldHrs: gi.expectedHoldHrs, holdHorizon: gi.holdHorizon });
  return {
    action,
    signal: { entry: input.entry, stopLoss, tp1, tp2, conviction, sizeMultiplier: resultSizeMul, rrAfterFriction: +rrAfterFriction.toFixed(2) },
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

// ============================================================================
// hardenSignal — post-LLM hardening for Trade Ideas cards (separate API from
// the older applySignalHardening / quant-scanner gates above; intentionally
// kept side-by-side, no shared types). Wired from /api/ai/analyze AFTER the
// LLM JSON parses, BEFORE response cache + res.json.
//
// Companion: server/lib/rationalePrompt.ts (RATIONALE_REGEN_SYSTEM_PROMPT +
// buildRationaleUserMsg) for the optional prose-regen call.
// ============================================================================

export type HSDirection = "LONG" | "SHORT";
export type HSRegime = "MACRO_CLEAR" | "RISK_ON" | "RISK_OFF" | "MACRO_EVENT";

export interface HSLiquidationCluster {
  price: number;
  side: "long" | "short";
  size_usd: number;
}

export interface SignalContext {
  symbol: string;
  direction: HSDirection;
  entry: number;
  proposedStop: number;
  proposedTargets: number[]; // TP1, TP2, TP3 prices from the LLM card
  rawConviction: number;     // 0..1
  atr1h: number;
  pctChange24h: number;      // +0.0548 = +5.48%
  funding8h: number;         // percent units, e.g. +0.0013 = +0.0013%/8h
  oiUsd: number;
  oiChange24hPct: number;    // 6h proxy from getOiChangePct() in production —
                             // 24h feed not on databus; documented in caller.
  liquidationClusters: HSLiquidationCluster[];
  backtestN: number;
  backtestWr: number;        // 0..1
  backtestAvgR: number;
  regime: HSRegime;          // MUST come from same source as UI banner
  edgeSource?: "OI-verified" | "estimated" | "no OI";
}

export interface HardenedSignal {
  accept: boolean;
  reasonsRejected: string[];
  direction: HSDirection;
  entry: number;
  stop: number;
  targets: number[];         // recomputed; preserves LLM's R-multiples off the new stop
  rrFirst: number;
  leverageCap: number;
  finalConviction: number;   // 0..1
  sizeMultiplier: number;    // 0..1
  wrCiLow: number;
  wrCiHigh: number;
  chaseFlag: boolean;
  crowdingFlag: boolean;
  lowSampleFlag: boolean;
  regimeUsed: HSRegime;
  notes: string[];
  materiallyMutated: boolean;
}

export interface HardenConfig {
  minBacktestN?: number;
  minRr?: number;
  minPostHaircutConviction?: number;
  maxChasePct?: number;
  materialStopMovePct?: number;
  materialConvictionDelta?: number;
  atrStopMult?: number;
}

function _wilsonCi(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function _kellySize(ciLow: number, avgR: number, fraction = 0.25): number {
  const p = ciLow;
  const b = Math.max(0.1, avgR);
  if (p <= 0) return 0;
  const kelly = (p * (b + 1) - 1) / b;
  return Math.max(0, Math.min(1, kelly * fraction));
}

function _atrStopFloor(entry: number, atr1h: number, direction: HSDirection, mult: number): number {
  const distance = atr1h * mult;
  return direction === "LONG" ? entry - distance : entry + distance;
}

function _liquidityAwareStop(
  entry: number,
  direction: HSDirection,
  clusters: HSLiquidationCluster[],
  atr1h: number,
  maxAtrExtension = 3.0,
): number | null {
  if (!clusters.length || atr1h <= 0) return null;
  const band = atr1h * maxAtrExtension;
  const candidates: Array<{ size: number; price: number }> = [];
  for (const c of clusters) {
    if (direction === "LONG" && c.price < entry && entry - c.price <= band) {
      candidates.push({ size: c.size_usd, price: c.price });
    } else if (direction === "SHORT" && c.price > entry && c.price - entry <= band) {
      candidates.push({ size: c.size_usd, price: c.price });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.size - a.size);
  const clusterPrice = candidates[0].price;
  const buffer = atr1h * 0.3;
  return direction === "LONG" ? clusterPrice - buffer : clusterPrice + buffer;
}

function _detectChase(ctx: SignalContext, threshold: number): boolean {
  if (ctx.direction === "LONG" && ctx.pctChange24h > threshold) return true;
  if (ctx.direction === "SHORT" && ctx.pctChange24h < -threshold) return true;
  return false;
}

function _detectCrowding(ctx: SignalContext): [boolean, string] {
  if (ctx.edgeSource === "no OI") return [false, ""];
  const elevatedFunding =
    (ctx.direction === "LONG" && ctx.funding8h > 0.01) ||
    (ctx.direction === "SHORT" && ctx.funding8h < -0.01);
  const risingOi = ctx.oiChange24hPct > 0.10;
  if (elevatedFunding && risingOi) {
    return [
      true,
      `Crowded: funding ${ctx.funding8h.toFixed(4)}%/8h with OI ${(ctx.oiChange24hPct * 100).toFixed(1)}%`,
    ];
  }
  return [false, ""];
}

const _REGIME_LEVERAGE_CAP: Record<HSRegime, number> = {
  MACRO_CLEAR: 5.0,
  RISK_ON:     5.0,
  RISK_OFF:    3.0,
  MACRO_EVENT: 2.0,
};

export function hardenSignal(ctx: SignalContext, config: HardenConfig = {}): HardenedSignal {
  const {
    minBacktestN = 30,
    minRr = 1.8,
    minPostHaircutConviction = 0.5,
    maxChasePct = 0.04,
    materialStopMovePct = 0.15,
    materialConvictionDelta = 0.15,
    atrStopMult = 1.8,
  } = config;

  const notes: string[] = [];
  const rejected: string[] = [];

  // 1. Stop: take the FURTHER of (ATR floor, liquidity-aware) from entry
  const atrFloor = _atrStopFloor(ctx.entry, ctx.atr1h, ctx.direction, atrStopMult);
  const liqStop = _liquidityAwareStop(
    ctx.entry, ctx.direction, ctx.liquidationClusters, ctx.atr1h,
  );
  let finalStop: number;
  if (liqStop !== null) {
    finalStop = ctx.direction === "LONG"
      ? Math.min(liqStop, atrFloor)
      : Math.max(liqStop, atrFloor);
    notes.push("Stop placed beyond liquidation cluster (ATR-validated)");
  } else {
    finalStop = atrFloor;
    notes.push(`Stop = entry ± ${atrStopMult}x ATR(1h) (no liq cluster data)`);
  }

  // 2. TP ladder: preserve LLM's R-multiples off NEW stop; floor TP1 at minRr
  const origRisk = Math.abs(ctx.entry - ctx.proposedStop);
  const newRisk = Math.abs(ctx.entry - finalStop);
  const rMultiples = ctx.proposedTargets.map((tp) =>
    origRisk > 0 ? Math.abs(tp - ctx.entry) / origRisk : 0,
  );
  const adjustedR = rMultiples.map((r, i) => (i === 0 ? Math.max(r, minRr) : r));
  const hardenedTargets = adjustedR.map((r) =>
    ctx.direction === "LONG" ? ctx.entry + newRisk * r : ctx.entry - newRisk * r,
  );
  const rrFirst = adjustedR[0] ?? minRr;

  // 3. Flags
  const chase = _detectChase(ctx, maxChasePct);
  if (chase) notes.push(`CHASE: entering after ${(ctx.pctChange24h * 100).toFixed(1)}% 24h move`);
  const [crowded, crowdMsg] = _detectCrowding(ctx);
  if (crowded) notes.push(crowdMsg);

  // 4. Backtest CI
  const wins = Math.round(ctx.backtestWr * ctx.backtestN);
  const [ciLow, ciHigh] = _wilsonCi(wins, ctx.backtestN);
  const lowSample = ctx.backtestN < minBacktestN;
  if (lowSample) {
    notes.push(
      `Low sample: n=${ctx.backtestN} (<${minBacktestN}); WR 95% CI [${(ciLow * 100).toFixed(0)}%, ${(ciHigh * 100).toFixed(0)}%]`,
    );
  }

  // 5. Leverage cap from regime
  const leverageCap = _REGIME_LEVERAGE_CAP[ctx.regime] ?? 3.0;

  // 6. Conviction haircuts (multiplicative)
  let finalConv = ctx.rawConviction;
  if (chase) finalConv *= 0.70;
  if (crowded) finalConv *= 0.75;
  if (lowSample) finalConv *= 0.80;

  // 7. Quarter-Kelly off CI lower bound
  const sizeMultiplier = _kellySize(ciLow, ctx.backtestAvgR);

  // 8. Veto checks
  if (chase && crowded) {
    rejected.push("VETO: chase + crowded = late entry into already-positioned move");
  }
  if (finalConv < minPostHaircutConviction) {
    rejected.push(
      `VETO: post-haircut conviction ${(finalConv * 100).toFixed(0)}% below ${(minPostHaircutConviction * 100).toFixed(0)}%`,
    );
  }
  if (rrFirst < minRr) {
    rejected.push(`VETO: RR ${rrFirst.toFixed(2)} below min ${minRr}`);
  }
  if (ctx.atr1h <= 0) {
    rejected.push("VETO: missing ATR data — cannot validate stop placement");
  }

  // 9. Material mutation → gates prose regen
  const stopMovePctOfRisk = origRisk > 0 ? Math.abs(ctx.proposedStop - finalStop) / origRisk : 0;
  const convictionDelta = ctx.rawConviction - finalConv;
  const materiallyMutated =
    stopMovePctOfRisk > materialStopMovePct ||
    convictionDelta > materialConvictionDelta ||
    chase ||
    crowded;

  return {
    accept: rejected.length === 0,
    reasonsRejected: rejected,
    direction: ctx.direction,
    entry: ctx.entry,
    stop: finalStop,
    targets: hardenedTargets,
    rrFirst,
    leverageCap,
    finalConviction: finalConv,
    sizeMultiplier,
    wrCiLow: ciLow,
    wrCiHigh: ciHigh,
    chaseFlag: chase,
    crowdingFlag: crowded,
    lowSampleFlag: lowSample,
    regimeUsed: ctx.regime,
    notes,
    materiallyMutated,
  };
}
