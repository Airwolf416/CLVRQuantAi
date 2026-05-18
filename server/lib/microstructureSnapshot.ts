// ── Microstructure Snapshot — single source of truth for funding+OI ──────────
// Module 2 — Setup Taxonomy. Reads funding rate and open-interest from the
// Hyperliquid in-process cache (`hlData`) with per-asset staleness checks and
// asset-class awareness. Distinguishes three states per metric:
//
//   "ok"          — value present, cache fresh
//   "unavailable" — asset CONCEPTUALLY has this metric (crypto perp) but the
//                   cache is missing or stale (transient gap)
//   "no_concept"  — asset cannot have this metric by definition
//                   (spot, equity, FX, commodity — none of them have perp
//                    funding rates or perp OI)
//
// The tri-state distinction is what lets the classifier diagnostics record an
// honest picture: a NULL funding rate on AAPL should NOT show up the same as
// a NULL funding rate on BTC during an HL outage.
//
// MEAN_REVERSION_EXHAUSTION's OR clauses in `server/lib/archetype.ts` already
// evaluate independently with "default permissive on null", so this helper
// does not alter classifier behavior — it only enriches the diagnostics that
// get persisted to `ai_signal_log.classification_diagnostics`.

import { hlData } from "../state";

export type MicroStatus = "ok" | "unavailable" | "no_concept";

export type MicrostructureSnapshot = {
  /** Funding rate as %/8h (HL convention). null when status !== "ok". */
  funding: number | null;
  /** Open interest in USD notional. null when status !== "ok". */
  oi: number | null;
  /** Wall-clock ms of the underlying cache tick. null for no-concept assets. */
  ts: number | null;
  fundingStatus: MicroStatus;
  oiStatus: MicroStatus;
};

// ── Staleness thresholds ────────────────────────────────────────────────────
// Funding rate refreshes every 8h on HL but the cache itself ticks every 5s.
// 30min staleness means the HL worker has been down for 360 ticks — clearly an
// outage. OI moves continuously, so 5min staleness (60 ticks) is the bound.
const FUNDING_STALE_MS = 30 * 60 * 1000;
const OI_STALE_MS = 5 * 60 * 1000;

/** Asset-class taxonomy used for the no_concept gate. */
export type MicroAssetClass = "crypto" | "equity" | "commodity" | "fx" | "spot";

/**
 * Returns a microstructure snapshot for `token` given `assetClass`.
 *
 * - Crypto perp (assetClass === "crypto"): attempts to read from hlData; missing
 *   or stale → "unavailable" with null value.
 * - Anything else: both metrics returned as "no_concept" with null values.
 *
 * Pure; safe to call repeatedly. Caller is responsible for normalizing the
 * symbol to the form the HL worker stores (e.g. "BTC" not "BTC/USD").
 */
export function getMicrostructureSnapshot(
  token: string,
  assetClass: MicroAssetClass,
): MicrostructureSnapshot {
  if (assetClass !== "crypto") {
    return {
      funding: null,
      oi: null,
      ts: null,
      fundingStatus: "no_concept",
      oiStatus: "no_concept",
    };
  }

  const sym = String(token || "").toUpperCase();
  const entry = hlData[sym];
  if (!entry) {
    return {
      funding: null,
      oi: null,
      ts: null,
      fundingStatus: "unavailable",
      oiStatus: "unavailable",
    };
  }

  const now = Date.now();
  const tickTs = typeof entry.ts === "number" ? entry.ts : null;

  // Funding: "ok" only if value is finite AND cache is fresh. Note we treat
  // funding === 0 as legitimate (some assets have zero funding); the staleness
  // gate is what catches outages, not the value itself.
  let fundingStatus: MicroStatus;
  let funding: number | null;
  if (typeof entry.funding === "number" && Number.isFinite(entry.funding)) {
    if (tickTs === null || now - tickTs <= FUNDING_STALE_MS) {
      fundingStatus = "ok";
      funding = entry.funding;
    } else {
      fundingStatus = "unavailable";
      funding = null;
    }
  } else {
    fundingStatus = "unavailable";
    funding = null;
  }

  // OI: tighter staleness window. Zero OI is treated as unavailable since every
  // tradable HL perp has nonzero open interest in practice.
  let oiStatus: MicroStatus;
  let oi: number | null;
  if (typeof entry.oi === "number" && Number.isFinite(entry.oi) && entry.oi > 0) {
    if (tickTs === null || now - tickTs <= OI_STALE_MS) {
      oiStatus = "ok";
      oi = entry.oi;
    } else {
      oiStatus = "unavailable";
      oi = null;
    }
  } else {
    oiStatus = "unavailable";
    oi = null;
  }

  return { funding, oi, ts: tickTs, fundingStatus, oiStatus };
}

// ── Classification diagnostics builder ──────────────────────────────────────
// Persisted to ai_signal_log.classification_diagnostics so admin tooling can
// answer: "for the UNCLASSIFIED signals, which inputs were missing?"
//
// Shape:
//   {
//     populated: ["price","dayOpen","atrDaily","oiZScore30d", ...],
//     null:      ["fundingRate","vwapSession"],
//     no_concept:["fundingRate","oiChange6hPct"],
//     clauses_fired: ["mean_rev_oi_hot","mean_rev_funding_permissive"],
//     source_endpoint: "quant" | "analyze" | "kronos",
//     micro: { fundingStatus, oiStatus, ts },
//   }

export type ClassificationDiagnostics = {
  populated: string[];
  null: string[];
  no_concept: string[];
  clauses_fired: string[];
  source_endpoint: "quant" | "analyze" | "kronos";
  micro: {
    fundingStatus: MicroStatus;
    oiStatus: MicroStatus;
    ts: number | null;
  };
};

/**
 * Builds the diagnostics payload from a classifier-context-like object plus the
 * microstructure snapshot. `ctx` is loose-typed (Record<string, unknown>) so we
 * can call this for any caller-shape without coupling to ArchetypeContext.
 *
 * Fields considered:
 *   price, dayOpen, dayHigh, dayLow, atrDaily, vwapSession, htfEma20,
 *   htfEma20PrevN, breakoutLevel, breakoutWasUp, oiZScore30d, oiChange6hPct,
 *   fundingRate, recentNewsMinutesAgo
 *
 * A field counts as:
 *   - "populated" if its value is a finite number or non-null primitive
 *   - "no_concept" if it's a funding/OI field on a non-crypto asset (per micro)
 *   - "null" otherwise
 */
export function buildClassificationDiagnostics(args: {
  ctx: Record<string, unknown>;
  micro: MicrostructureSnapshot;
  clausesFired: string[];
  sourceEndpoint: "quant" | "analyze" | "kronos";
}): ClassificationDiagnostics {
  const tracked = [
    "price", "dayOpen", "dayHigh", "dayLow", "atrDaily",
    "vwapSession", "htfEma20", "htfEma20PrevN",
    "breakoutLevel", "breakoutWasUp",
    "oiZScore30d", "oiChange6hPct", "fundingRate",
    "recentNewsMinutesAgo",
  ];
  const populated: string[] = [];
  const nullFields: string[] = [];
  const noConcept: string[] = [];

  const isMicroField = (k: string) =>
    k === "fundingRate" || k === "oiZScore30d" || k === "oiChange6hPct";

  for (const k of tracked) {
    const v = args.ctx[k];
    const hasValue = typeof v === "number"
      ? Number.isFinite(v)
      : v !== null && v !== undefined;
    if (hasValue) {
      populated.push(k);
      continue;
    }
    // Classify nulls: funding/OI on no-concept assets get bucketed correctly.
    if (isMicroField(k)) {
      const noFunding = k === "fundingRate" && args.micro.fundingStatus === "no_concept";
      const noOi = (k === "oiZScore30d" || k === "oiChange6hPct") && args.micro.oiStatus === "no_concept";
      if (noFunding || noOi) {
        noConcept.push(k);
        continue;
      }
    }
    nullFields.push(k);
  }

  return {
    populated,
    null: nullFields,
    no_concept: noConcept,
    clauses_fired: args.clausesFired,
    source_endpoint: args.sourceEndpoint,
    micro: {
      fundingStatus: args.micro.fundingStatus,
      oiStatus: args.micro.oiStatus,
      ts: args.micro.ts,
    },
  };
}
