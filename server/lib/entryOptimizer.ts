// ── Entry Optimizer (Jul 2026) ──────────────────────────────────────────────
// Pure, deterministic helper that proposes a PREFERRED LIMIT pullback entry
// near the invalidation level (support for LONG, resistance for SHORT) so the
// trade's reward-to-risk improves — "enter closer to invalidation so winners
// pay more". It NEVER mutates the caller's tracked market entry; the caller
// attaches the result as an additive, display-only field ("show BOTH": the
// tracked market fill AND this better-priced limit alternative). All functions
// are side-effect free.
//
// The improvement comes from a lower entry (LONG) / higher entry (SHORT) with
// the SAME structural target, so the reward leg grows while risk stays at the
// 1.5×ATR floor — the exact floor the downstream hardening/geometry gates use,
// so an optimized card is born geometry-valid and never triggers a correction.

export type EntryDirection = "LONG" | "SHORT";
export type EntryAssetClass = "crypto" | "equity" | "commodity" | "fx";

export interface PullbackInput {
  direction: EntryDirection;
  /** Current/last price — the tracked MARKET entry we compare against. */
  marketEntry: number;
  /** ATR(14) in PRICE units (not percent). */
  atr14: number;
  assetClass: EntryAssetClass;
  /** Structural first target — kept fixed; the reward leg is measured to this. */
  tp1: number;
  /** R:R of the market entry, so we only surface a STRICTLY better alternative. */
  primaryRr: number | null;
  supportLevels?: (number | null | undefined)[];
  resistanceLevels?: (number | null | undefined)[];
  /** Direction-appropriate 0.382 retracement level. */
  fibConserv?: number | null;
  /** Direction-appropriate 0.500 retracement level. */
  fibAggr?: number | null;
  low24?: number | null;
  high24?: number | null;
  /** e.g. "8–20" — the minutes the limit is valid before it VOIDs. */
  windowMin?: string | null;
}

export interface PullbackEntry {
  type: "LIMIT_PULLBACK";
  price: number;
  zone: { low: number; high: number };
  stopLoss: number;
  /** Directional R:R at the pullback entry. */
  rr: number;
  /** How far the limit sits from market, as a positive percent. */
  distancePct: number;
  windowMin: string | null;
  /** Which structural level the entry snapped to. */
  source: string;
  invalidation: string;
}

export interface PullbackResult {
  entry: PullbackEntry | null;
  /** Populated when entry is null so callers can shadow-log why. */
  reason?: string;
  delta?: {
    marketRr: number | null;
    pullbackRr: number | null;
    improvementPct: number | null;
  };
}

// Max realistic pullback distance per asset class, as a percent of price.
// Mirrors the NO_MOMENTUM_RANGE_PCT convention already used by the scanner so
// a "wait for pullback" is calibrated to how far each class actually moves.
const MAX_PULL_PCT: Record<EntryAssetClass, number> = {
  crypto: 1.5,
  equity: 0.8,
  commodity: 0.8,
  fx: 0.3,
};

export function normalizeEntryAssetClass(raw?: string | null): EntryAssetClass {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s.startsWith("equit") || s === "stock" || s === "stocks") return "equity";
  if (s.startsWith("commod") || s === "metal" || s === "metals") return "commodity";
  if (s === "fx" || s.startsWith("forex") || s === "currency") return "fx";
  return "crypto";
}

const round = (v: number, dp: number): number =>
  parseFloat(v.toFixed(dp));

const fmt = (v: number): string =>
  v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v >= 1 ? v.toFixed(2)
      : v.toFixed(6);

const finiteBelow = (arr: (number | null | undefined)[] | undefined, ref: number): number[] =>
  (arr ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < ref);

const finiteAbove = (arr: (number | null | undefined)[] | undefined, ref: number): number[] =>
  (arr ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v > ref);

/**
 * Nearest structural invalidation just BEYOND the chosen entry (used to place
 * the alt stop): for LONG the highest support strictly below entry, else the
 * 24h low; for SHORT the lowest resistance strictly above entry, else 24h high.
 */
function structuralBeyond(input: PullbackInput, entry: number): number | undefined {
  if (input.direction === "LONG") {
    const below = finiteBelow(input.supportLevels, entry);
    if (below.length) return Math.max(...below);
    if (typeof input.low24 === "number" && Number.isFinite(input.low24) && input.low24 < entry) return input.low24;
    return undefined;
  }
  const above = finiteAbove(input.resistanceLevels, entry);
  if (above.length) return Math.min(...above);
  if (typeof input.high24 === "number" && Number.isFinite(input.high24) && input.high24 > entry) return input.high24;
  return undefined;
}

export function computePullbackEntry(input: PullbackInput): PullbackResult {
  const { direction, marketEntry, atr14, tp1 } = input;
  const cls = input.assetClass;
  const marketRr = typeof input.primaryRr === "number" && Number.isFinite(input.primaryRr) ? input.primaryRr : null;

  if (!Number.isFinite(marketEntry) || marketEntry <= 0) return { entry: null, reason: "bad_market_entry" };
  if (!Number.isFinite(atr14) || atr14 <= 0) return { entry: null, reason: "bad_atr" };
  if (!Number.isFinite(tp1) || tp1 <= 0) return { entry: null, reason: "bad_tp1" };

  // Fill budget: the limit must be reachable. Bound by BOTH 1×ATR and the
  // per-class max pullback percent, whichever is tighter.
  const maxPullDist = Math.min(1.0 * atr14, (MAX_PULL_PCT[cls] / 100) * marketEntry);
  if (!(maxPullDist > 0)) return { entry: null, reason: "no_pull_budget" };

  // Gather candidate pullback levels (correct side of market) with a source tag.
  const raw: Array<{ price: number; source: string }> = [];
  const push = (v: number | null | undefined, src: string) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) raw.push({ price: v, source: src });
  };
  if (direction === "LONG") {
    (input.supportLevels ?? []).forEach((v) => push(v, "support"));
    push(input.fibConserv, "fib_0.382");
    push(input.fibAggr, "fib_0.500");
    push(input.low24, "24h_low");
  } else {
    (input.resistanceLevels ?? []).forEach((v) => push(v, "resistance"));
    push(input.fibConserv, "fib_0.382");
    push(input.fibAggr, "fib_0.500");
    push(input.high24, "24h_high");
  }

  const inBudget = raw.filter(({ price }) =>
    direction === "LONG"
      ? price < marketEntry && marketEntry - price <= maxPullDist
      : price > marketEntry && price - marketEntry <= maxPullDist,
  );
  if (inBudget.length === 0) {
    return { entry: null, reason: "no_candidate_in_budget", delta: { marketRr, pullbackRr: null, improvementPct: null } };
  }

  // Pick the candidate CLOSEST to market (most likely to fill): for LONG the
  // highest below price; for SHORT the lowest above price.
  const chosen = inBudget.reduce((best, c) =>
    direction === "LONG" ? (c.price > best.price ? c : best) : (c.price < best.price ? c : best),
  );
  const entryPrice = round(chosen.price, 6);

  // Stop sits just beyond structure, floored at 1.5×ATR so downstream gates
  // never widen it (which would erase the R:R gain).
  const buffer = 0.15 * atr14;
  const beyond = structuralBeyond(input, entryPrice);
  let slDist: number;
  if (direction === "LONG") {
    const structural = typeof beyond === "number" ? entryPrice - (beyond - buffer) : 0;
    slDist = Math.max(1.5 * atr14, structural);
  } else {
    const structural = typeof beyond === "number" ? (beyond + buffer) - entryPrice : 0;
    slDist = Math.max(1.5 * atr14, structural);
  }
  const stopLoss = round(direction === "LONG" ? entryPrice - slDist : entryPrice + slDist, 6);

  const reward = direction === "LONG" ? tp1 - entryPrice : entryPrice - tp1;
  const rr = slDist > 0 && reward > 0 ? round(reward / slDist, 2) : null;

  const geomOk = direction === "LONG"
    ? stopLoss < entryPrice && entryPrice < tp1
    : stopLoss > entryPrice && entryPrice > tp1;
  if (!geomOk || rr == null) {
    return { entry: null, reason: "geometry_or_rr_invalid", delta: { marketRr, pullbackRr: rr, improvementPct: null } };
  }

  const improvementPct = marketRr != null && marketRr > 0 ? round(((rr - marketRr) / marketRr) * 100, 0) : null;
  // Only surface an alternative that is STRICTLY better than the market entry.
  if (marketRr != null && marketRr > 0 && rr <= marketRr) {
    return { entry: null, reason: "not_better_than_market", delta: { marketRr, pullbackRr: rr, improvementPct } };
  }

  const distancePct = round((Math.abs(marketEntry - entryPrice) / marketEntry) * 100, 2);
  const invalidation = direction === "LONG"
    ? `Limit — waits for a dip to $${fmt(entryPrice)}. Void if price closes below $${fmt(stopLoss)} first, or runs up without pulling back.`
    : `Limit — waits for a bounce to $${fmt(entryPrice)}. Void if price closes above $${fmt(stopLoss)} first, or drops without bouncing.`;

  return {
    entry: {
      type: "LIMIT_PULLBACK",
      price: entryPrice,
      zone: { low: round(entryPrice - buffer, 6), high: round(entryPrice + buffer, 6) },
      stopLoss,
      rr,
      distancePct,
      windowMin: input.windowMin ?? null,
      source: chosen.source,
      invalidation,
    },
    delta: { marketRr, pullbackRr: rr, improvementPct },
  };
}
