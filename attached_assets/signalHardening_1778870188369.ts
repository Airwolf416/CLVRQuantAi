/**
 * signalHardening.ts
 * -----------------
 * Post-LLM hardening wrapper for Trade Ideas cards.
 *
 * Drop into server/lib/. Called from server/routes.ts /api/ai/analyze handler
 * AFTER the LLM returns parsed JSON, BEFORE response.json().
 *
 * Enforces:
 *   - 1.8x ATR(1h) stop floor
 *   - Liquidation-cluster-aware SL (when Coinglass returns data)
 *   - Funding + OI crowding detector
 *   - Chase detector (>4% 24h move in trade direction)
 *   - Wilson 95% CI on backtest WR; haircut for n<30
 *   - Quarter-Kelly sizing off CI LOWER bound (conservative)
 *   - Regime-driven leverage cap from the SAME classifier as the UI banner
 *   - materiallyMutated flag → gates the optional prose-regen call
 */

export type Direction = "LONG" | "SHORT";
export type Regime = "MACRO_CLEAR" | "RISK_ON" | "RISK_OFF" | "MACRO_EVENT";

export interface LiquidationCluster {
  price: number;
  side: "long" | "short";
  size_usd: number;
}

export interface SignalContext {
  symbol: string;
  direction: Direction;
  entry: number;
  proposedStop: number;
  proposedTargets: number[]; // TP1, TP2, TP3 prices from the LLM card
  rawConviction: number; // 0..1
  atr1h: number;
  pctChange24h: number; // +0.0548 = +5.48%
  funding8h: number; // percent units, e.g. +0.0013 = +0.0013%/8h
  oiUsd: number;
  oiChange24hPct: number;
  liquidationClusters: LiquidationCluster[];
  backtestN: number;
  backtestWr: number; // 0..1
  backtestAvgR: number;
  regime: Regime; // MUST come from the same source as the UI banner
  edgeSource?: "OI-verified" | "estimated" | "no OI";
}

export interface HardenedSignal {
  accept: boolean;
  reasonsRejected: string[];
  direction: Direction;
  entry: number;
  stop: number;
  targets: number[]; // recomputed; preserves LLM's R-multiples off the new stop
  rrFirst: number;
  leverageCap: number;
  finalConviction: number; // 0..1
  sizeMultiplier: number; // 0..1
  wrCiLow: number;
  wrCiHigh: number;
  chaseFlag: boolean;
  crowdingFlag: boolean;
  lowSampleFlag: boolean;
  regimeUsed: Regime;
  notes: string[];
  materiallyMutated: boolean; // true → trigger prose regen
}

export interface HardenConfig {
  minBacktestN?: number;
  minRr?: number;
  minPostHaircutConviction?: number;
  maxChasePct?: number;
  materialStopMovePct?: number; // as fraction of original risk distance
  materialConvictionDelta?: number;
  atrStopMult?: number;
}

// ---- statistics --------------------------------------------------------------

function wilsonCi(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function kellySize(ciLow: number, avgR: number, fraction = 0.25): number {
  const p = ciLow;
  const b = Math.max(0.1, avgR);
  if (p <= 0) return 0;
  const kelly = (p * (b + 1) - 1) / b;
  return Math.max(0, Math.min(1, kelly * fraction));
}

// ---- stop placement ----------------------------------------------------------

function atrStopFloor(
  entry: number,
  atr1h: number,
  direction: Direction,
  mult: number,
): number {
  const distance = atr1h * mult;
  return direction === "LONG" ? entry - distance : entry + distance;
}

function liquidityAwareStop(
  entry: number,
  direction: Direction,
  clusters: LiquidationCluster[],
  atr1h: number,
  maxAtrExtension = 3.0,
): number | null {
  if (!clusters.length || atr1h <= 0) return null;
  const band = atr1h * maxAtrExtension;
  const candidates: Array<{ size: number; price: number }> = [];
  for (const c of clusters) {
    if (
      direction === "LONG" &&
      c.price < entry &&
      entry - c.price <= band
    ) {
      candidates.push({ size: c.size_usd, price: c.price });
    } else if (
      direction === "SHORT" &&
      c.price > entry &&
      c.price - entry <= band
    ) {
      candidates.push({ size: c.size_usd, price: c.price });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.size - a.size);
  const clusterPrice = candidates[0].price;
  const buffer = atr1h * 0.3;
  return direction === "LONG" ? clusterPrice - buffer : clusterPrice + buffer;
}

// ---- flag detectors ----------------------------------------------------------

function detectChase(ctx: SignalContext, threshold: number): boolean {
  if (ctx.direction === "LONG" && ctx.pctChange24h > threshold) return true;
  if (ctx.direction === "SHORT" && ctx.pctChange24h < -threshold) return true;
  return false;
}

function detectCrowding(ctx: SignalContext): [boolean, string] {
  if (ctx.edgeSource === "no OI") return [false, ""]; // can't crowd-check without OI
  const elevatedFunding =
    (ctx.direction === "LONG" && ctx.funding8h > 0.01) ||
    (ctx.direction === "SHORT" && ctx.funding8h < -0.01);
  const risingOi = ctx.oiChange24hPct > 0.10;
  if (elevatedFunding && risingOi) {
    return [
      true,
      `Crowded: funding ${ctx.funding8h.toFixed(4)}%/8h with OI ${(ctx.oiChange24hPct * 100).toFixed(1)}%/24h`,
    ];
  }
  return [false, ""];
}

const REGIME_LEVERAGE_CAP: Record<Regime, number> = {
  MACRO_CLEAR: 5.0,
  RISK_ON: 5.0,
  RISK_OFF: 3.0,
  MACRO_EVENT: 2.0,
};

// ---- main entrypoint ---------------------------------------------------------

export function hardenSignal(
  ctx: SignalContext,
  config: HardenConfig = {},
): HardenedSignal {
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
  const atrFloor = atrStopFloor(ctx.entry, ctx.atr1h, ctx.direction, atrStopMult);
  const liqStop = liquidityAwareStop(
    ctx.entry,
    ctx.direction,
    ctx.liquidationClusters,
    ctx.atr1h,
  );
  let finalStop: number;
  if (liqStop !== null) {
    finalStop =
      ctx.direction === "LONG"
        ? Math.min(liqStop, atrFloor)
        : Math.max(liqStop, atrFloor);
    notes.push("Stop placed beyond liquidation cluster (ATR-validated)");
  } else {
    finalStop = atrFloor;
    notes.push(`Stop = entry ± ${atrStopMult}x ATR(1h) (no liq cluster data)`);
  }

  // 2. TP ladder: preserve LLM's R-multiples, recompute prices off new stop
  const origRisk = Math.abs(ctx.entry - ctx.proposedStop);
  const newRisk = Math.abs(ctx.entry - finalStop);
  const rMultiples = ctx.proposedTargets.map((tp) =>
    origRisk > 0 ? Math.abs(tp - ctx.entry) / origRisk : 0,
  );
  // Floor TP1 R at minRr; preserve TP2/TP3 R as-is
  const adjustedR = rMultiples.map((r, i) => (i === 0 ? Math.max(r, minRr) : r));
  const hardenedTargets = adjustedR.map((r) =>
    ctx.direction === "LONG" ? ctx.entry + newRisk * r : ctx.entry - newRisk * r,
  );
  const rrFirst = adjustedR[0] ?? minRr;

  // 3. Flags
  const chase = detectChase(ctx, maxChasePct);
  if (chase)
    notes.push(
      `CHASE: entering after ${(ctx.pctChange24h * 100).toFixed(1)}% 24h move`,
    );

  const [crowded, crowdMsg] = detectCrowding(ctx);
  if (crowded) notes.push(crowdMsg);

  // 4. Backtest CI
  const wins = Math.round(ctx.backtestWr * ctx.backtestN);
  const [ciLow, ciHigh] = wilsonCi(wins, ctx.backtestN);
  const lowSample = ctx.backtestN < minBacktestN;
  if (lowSample) {
    notes.push(
      `Low sample: n=${ctx.backtestN} (<${minBacktestN}); WR 95% CI [${(ciLow * 100).toFixed(0)}%, ${(ciHigh * 100).toFixed(0)}%]`,
    );
  }

  // 5. Leverage cap from regime
  const leverageCap = REGIME_LEVERAGE_CAP[ctx.regime] ?? 3.0;

  // 6. Conviction haircuts (multiplicative)
  let finalConv = ctx.rawConviction;
  if (chase) finalConv *= 0.70;
  if (crowded) finalConv *= 0.75;
  if (lowSample) finalConv *= 0.80;

  // 7. Quarter-Kelly off CI lower bound
  const sizeMultiplier = kellySize(ciLow, ctx.backtestAvgR);

  // 8. Veto checks
  if (chase && crowded) {
    rejected.push(
      "VETO: chase + crowded = late entry into already-positioned move",
    );
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
  const stopMovePctOfRisk =
    origRisk > 0 ? Math.abs(ctx.proposedStop - finalStop) / origRisk : 0;
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
