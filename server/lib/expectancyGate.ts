import { enforceGeometry, type GeometryLevels } from "./geometryGuard";

export type PolicyMode = "off" | "shadow" | "on";
export type VenueProfile = "phantom" | "hyperliquid_native";
export type ExpectancyState = "PASS" | "NEGATIVE_EXPECTANCY" | "INVALID_GEOMETRY" | "CALIBRATION_INSUFFICIENT" | "COST_CONTEXT_MISSING";

export interface CostContext {
  venueProfile: VenueProfile;
  volume24hUsd?: number | null;
  /** Signed percent per 8h: positive means longs pay shorts. */
  fundingRatePct?: number | null;
  expectedHoldHours?: number | null;
  holdContextSource?: string | null;
}
export interface CostSnapshot {
  modelVersion: "cost_v1";
  venueProfile: VenueProfile;
  feePct: number;
  slippagePct: number;
  fundingPct: number;
  rawFundingRatePct: number | null;
  normalizedFundingRatePct: number | null;
  fundingSignConvention: "positive_longs_pay_shorts";
  holdContextSource: string;
  expectedHoldHours: number;
  volume24hUsd: number;
  finalStopDistancePct: number;
  costR: number;
  fundingPayer: "LONG" | "SHORT" | "NONE";
}

export function getExpectancyGateMode(): PolicyMode {
  const value = (process.env.EXPECTANCY_GATE_MODE || "shadow").toLowerCase();
  if (value === "off") return "off";
  // A configured mode alone is never approval to alter customer output.
  // This separate acknowledgement is intentionally runtime-only.
  if (value === "on" && process.env.EXPECTANCY_ENFORCEMENT_APPROVED === "1") return "on";
  return "shadow";
}

export function costFromFinalGeometry(levels: GeometryLevels, context?: CostContext): CostSnapshot | null {
  if (!context || !Number.isFinite(context.volume24hUsd)) return null;
  const g = enforceGeometry(levels, { silent: true });
  const stopPct = g.slDistancePct;
  if (!stopPct || stopPct <= 0 || g.correctedLegs.some(x => x.endsWith("-UNMIRRORABLE"))) return null;
  const volume = Number(context.volume24hUsd);
  const slippage = volume >= 500_000_000 ? .02 : volume >= 100_000_000 ? .05 : volume >= 25_000_000 ? .10 : null;
  if (slippage == null) return null;
  if (!Number.isFinite(context.expectedHoldHours) || Number(context.expectedHoldHours) < 0) return null;
  const hold = Number(context.expectedHoldHours);
  const rawFunding = Number(context.fundingRatePct);
  const paysFunding = Number.isFinite(rawFunding) && rawFunding !== 0 &&
    ((rawFunding > 0 && g.direction === "LONG") || (rawFunding < 0 && g.direction === "SHORT"));
  const fundingPct = paysFunding ? Math.abs(rawFunding) * (hold / 8) : 0;
  const feePct = context.venueProfile === "phantom" ? .19 : .09; // round trip, per-side rates
  const total = feePct + (slippage * 2) + fundingPct;
  return {
    modelVersion: "cost_v1", venueProfile: context.venueProfile, feePct, slippagePct: slippage,
    fundingPct, rawFundingRatePct: Number.isFinite(rawFunding) ? rawFunding : null,
    normalizedFundingRatePct: Number.isFinite(rawFunding) ? rawFunding : null,
    fundingSignConvention: "positive_longs_pay_shorts", holdContextSource: context.holdContextSource || "candidate_declared",
    expectedHoldHours: hold, volume24hUsd: volume, finalStopDistancePct: stopPct,
    costR: total / stopPct, fundingPayer: !paysFunding ? "NONE" : g.direction,
  };
}

export function evaluateExpectancy(levels: GeometryLevels, pWin: number | null, cost: CostSnapshot | null): { state: ExpectancyState; netEV: number | null; rewardR: number | null } {
  const g = enforceGeometry(levels, { silent: true });
  if (!g.rr || g.rr <= 0 || g.correctedLegs.some(x => x.endsWith("-UNMIRRORABLE"))) return { state: "INVALID_GEOMETRY", netEV: null, rewardR: null };
  if (!cost) return { state: "COST_CONTEXT_MISSING", netEV: null, rewardR: g.rr };
  if (pWin == null || !Number.isFinite(pWin) || pWin < 0 || pWin > 1) return { state: "CALIBRATION_INSUFFICIENT", netEV: null, rewardR: g.rr };
  const netEV = pWin * g.rr - (1 - pWin) - cost.costR;
  return { state: netEV >= .10 ? "PASS" : "NEGATIVE_EXPECTANCY", netEV, rewardR: g.rr };
}