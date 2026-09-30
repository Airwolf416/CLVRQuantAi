import { enforceGeometry, type GeometryLevels } from "./geometryGuard";
import { costFromFinalGeometry, evaluateExpectancy, getExpectancyGateMode, type CostContext, type ExpectancyState } from "./expectancyGate";
import { pool } from "../db";
import { getHyperliquidEmissionEligibility, isNewListingPending } from "./assetUniverse";
import { applyNewListingSoftGate } from "./empiricalFilters";

export interface EmissionCandidate extends GeometryLevels {
  source: string;
  symbol?: string;
  assetClass?: string;
  regime?: string;
  leverageTier?: string;
  holdHorizonBand?: string;
  venueProfile?: CostContext["venueProfile"];
  volume24hUsd?: number | null;
  fundingRatePct?: number | null;
  expectedHoldHours?: number | null;
  conviction?: number | null;
  marketType?: string | null;
}
export interface EmissionDecision {
  mode: "off" | "shadow" | "on";
  state: ExpectancyState;
  suppress: boolean;
  /** Admin persistence only; never merge this into card DTOs. */
  snapshot: Record<string, unknown>;
}
/** Shared caller contract: only approved `on` decisions remove an emission. */
export function shouldEmitPolicy(decision: Pick<EmissionDecision, "suppress">): boolean {
  return !decision.suppress;
}

/** Explicit DTO boundary. Policy internals are never response-card properties. */
export function redactPolicyForDto<T>(dto: T): T {
  return dto;
}

function auditPolicy(source: string, decision: EmissionDecision): void {
  // Deliberately fire-and-forget: policy telemetry can never block emission.
  // The snapshot excludes prose, user data, and client DTO fields.
  void pool.query(
    `INSERT INTO signal_policy_audit (source, decision_state, policy_mode, suppressed, snapshot)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [source, decision.state, decision.mode, decision.suppress, JSON.stringify(decision.snapshot)],
  ).catch(() => {});
}

/**
 * Normalized pre-persist/pre-serialization adapter. It does not replace
 * existing hardening, friction, circuit, or suppression controls. New
 * calibration is intentionally unavailable here until the persisted
 * calibration review promotes it, so shadow logging is safe by default.
 */
export function applyEmissionPolicy(candidate: EmissionCandidate, calibratedPWin: number | null = null): { candidate: EmissionCandidate & ReturnType<typeof enforceGeometry>; decision: EmissionDecision } {
  const geometry = enforceGeometry(candidate, { symbol: candidate.source, source: "ai_signal" });
  const canonical = { ...candidate, ...geometry };
  const listingGate = applyNewListingSoftGate(candidate.conviction, isNewListingPending(candidate.symbol || ""));
  if (candidate.conviction != null && listingGate.auditFlag) canonical.conviction = listingGate.conviction;
  const cost = costFromFinalGeometry(canonical, candidate.venueProfile ? {
    venueProfile: candidate.venueProfile, volume24hUsd: candidate.volume24hUsd,
    fundingRatePct: candidate.fundingRatePct, expectedHoldHours: candidate.expectedHoldHours,
  } : undefined);
  const evaluated = evaluateExpectancy(canonical, calibratedPWin, cost);
  const mode = getExpectancyGateMode();
  const universeGate = getHyperliquidEmissionEligibility(candidate.symbol || "", {
    marketType: candidate.marketType,
    assetClass: candidate.assetClass,
    forceHyperliquid: candidate.venueProfile === "hyperliquid_native",
  });
  // Insufficient evidence/context never creates a made-up probability or new
  // suppression. Only an explicitly reviewed calibrated negative result can.
  const suppress = (universeGate.applies && !universeGate.allowed)
    || (mode === "on" && (evaluated.state === "NEGATIVE_EXPECTANCY" || evaluated.state === "INVALID_GEOMETRY"));
  const result = {
    candidate: canonical,
    decision: {
      mode, state: evaluated.state, suppress,
      snapshot: {
        policyVersion: "signal_policy_v1", geometry: {
          corrected: geometry.corrected, correctedLegs: geometry.correctedLegs, rr: geometry.rr,
        }, cost, pWin: calibratedPWin, netEV: evaluated.netEV, rewardR: evaluated.rewardR,
        newListing: listingGate.auditFlag, convictionCappedForNewListing: listingGate.capped,
        universeEligibility: universeGate,
      },
    },
  };
  auditPolicy(candidate.source, result.decision);
  return result;
}