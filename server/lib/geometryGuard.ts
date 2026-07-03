// ── Shared directional geometry guard ───────────────────────────────────────
// Single implementation of the "mirror wrong-side levels around entry" repair
// that used to live inline in /api/quant (FINAL GEOMETRY GUARD). Every card
// emission point calls this as the LAST step before serialization/persist so
// a direction badge can never ship with contradicting SL/TP geometry.
//
// Policy (do not revisit): REPAIR mode — mirror wrong-side levels around
// entry so the card matches its direction badge. Never silently flip the
// badge, never drop the card for geometry alone. Direction decisions belong
// to the edge policy / brain modules, not this guard.

import { logRejection } from "./rejectionLog";

export type GeometryLevels = {
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2?: number | null;
  tp3?: number | null;
};

export type GeometryResult = GeometryLevels & {
  corrected: boolean;
  correctedLegs: string[];        // e.g. ["SL","TP1"] — "-UNMIRRORABLE" suffix when the mirror would be <= 0
  rr: number | null;              // DIRECTIONAL R:R from tp1 (never Math.abs on both legs)
  tpGainPct: number | null;
  slDistancePct: number | null;
};

export type GeometryMeta = {
  symbol?: string;
  source?: "auto_scanner" | "ai_signal" | "manual";
};

export function enforceGeometry(input: GeometryLevels, meta?: GeometryMeta): GeometryResult {
  const direction = input.direction;
  const isLong = direction === "LONG";
  const ep = Number(input.entry);
  let stopLoss = Number(input.stopLoss);
  let tp1 = Number(input.tp1);
  let tp2 = input.tp2 == null ? (input.tp2 ?? null) : Number(input.tp2);
  let tp3 = input.tp3 == null ? (input.tp3 ?? null) : Number(input.tp3);
  const correctedLegs: string[] = [];

  const baseValid =
    Number.isFinite(ep) && ep > 0 && Number.isFinite(stopLoss) && Number.isFinite(tp1);

  if (baseValid) {
    // A level is "wrong side" if it sits on the side the badge says it
    // shouldn't. LONG → SL must be < entry, TPs must be > entry; SHORT → mirror.
    const wrongSide = (lvl: number | null | undefined, isStop: boolean): boolean => {
      if (lvl == null) return false;
      const n = Number(lvl);
      if (!Number.isFinite(n)) return false;
      if (isLong) return isStop ? n >= ep : n <= ep;
      /* short */ return isStop ? n <= ep : n >= ep;
    };
    // Only mirror legs that are on the wrong side; mirror = 2*entry - level.
    // A mirror result <= 0 can't be traded — keep the original leg and record
    // it with a "-UNMIRRORABLE" suffix so telemetry still sees the anomaly.
    const repairLeg = (lvl: number, isStop: boolean, name: string): number => {
      if (!wrongSide(lvl, isStop)) return lvl;
      const m = 2 * ep - Number(lvl);
      if (m > 0) {
        correctedLegs.push(name);
        return m;
      }
      correctedLegs.push(`${name}-UNMIRRORABLE`);
      return lvl;
    };
    stopLoss = repairLeg(stopLoss, true, "SL");
    tp1 = repairLeg(tp1, false, "TP1");
    if (tp2 != null && Number.isFinite(tp2)) tp2 = repairLeg(tp2, false, "TP2");
    if (tp3 != null && Number.isFinite(tp3)) tp3 = repairLeg(tp3, false, "TP3");
  }

  // Directional metrics from the FINAL (possibly repaired) levels.
  // CRITICAL: rr is directional — LONG (tp1-entry)/(entry-sl), SHORT
  // (entry-tp1)/(sl-entry). If the denominator is <= 0 after repair, rr is
  // null. Absolute math here is what let an inverted card display "1.0:1".
  let rr: number | null = null;
  let tpGainPct: number | null = null;
  let slDistancePct: number | null = null;
  if (baseValid) {
    const denom = isLong ? ep - stopLoss : stopLoss - ep;
    const numer = isLong ? tp1 - ep : ep - tp1;
    if (denom > 0 && Number.isFinite(numer / denom)) {
      rr = parseFloat((numer / denom).toFixed(2));
    }
    tpGainPct = parseFloat((Math.abs(tp1 - ep) / ep * 100).toFixed(2));
    slDistancePct = parseFloat((Math.abs(ep - stopLoss) / ep * 100).toFixed(2));
  }

  const corrected = correctedLegs.length > 0;
  if (corrected) {
    const symbol = meta?.symbol || "?";
    console.warn(`[GeometryGuard] ${symbol} ${direction}: mirrored ${correctedLegs.join(",")} to match badge`);
    try {
      // Informational telemetry — NOT a drop. Shows up in the rejection ring
      // + admin tuning dashboard so repairs are measurable.
      logRejection(
        {
          source: meta?.source || "ai_signal",
          token: symbol,
          direction,
          reason: "GEOMETRY_REPAIRED",
          detail: `informational (not a drop) — mirrored ${correctedLegs.join(",")} around entry=${ep}`,
        },
        { proposedEntry: ep, proposedSl: Number(input.stopLoss), proposedTp1: Number(input.tp1) },
      );
    } catch { /* telemetry must never block emission */ }
  }

  return { direction, entry: ep, stopLoss, tp1, tp2, tp3, corrected, correctedLegs, rr, tpGainPct, slDistancePct };
}
