import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog, signalShadowInversions } from "@shared/schema";
import { livePrices, hlData, priceHistory } from "../state";
import { resolvePrediction, mapOutcomeToWinLoss } from "./calibrationLog";
import { enqueuePostTradeAnalysis } from "./postTradeAnalyzerWorker";
import { observeAuthoritativeInterval, type BarrierObservation } from "./barrierObservation";
import {
  CLOSED_INTERVAL_MS,
  CLOSED_INTERVAL_VERSION,
  getClosedIntervals,
  type ClosedInterval,
  type ClosedIntervalResult,
} from "./closedIntervalProvider";

const INTERVAL_MS = 60 * 1000;
let started = false;
let timer: NodeJS.Timeout | null = null;
// Single-flight guard so a tick that overruns 60s can't race the next tick
// and double-resolve the same row.
let tickInFlight = false;

function getLivePrice(token: string): number | null {
  const sym = (token || "").toUpperCase();
  // Crypto perp via Hyperliquid
  const hl = hlData?.[sym];
  if (hl && Number.isFinite(hl.perpPrice) && hl.perpPrice > 0) return Number(hl.perpPrice);
  // Equities / metals / FX via Finnhub-fed livePrices
  const lp = livePrices?.[sym];
  if (lp && Number.isFinite(lp.price) && lp.price > 0) return Number(lp.price);
  return null;
}

function computePnlPct(entry: number, exit: number, direction: string): number {
  if (!entry || !Number.isFinite(entry) || entry === 0) return 0;
  return direction === "LONG"
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
}

interface PendingRow {
  id: number;
  token: string;
  direction: string;
  entryPrice: string;
  tp1Price: string | null;
  tp2Price: string | null;
  tp3Price: string | null;
  stopLoss: string | null;
  killClockExpires: Date | null;
  entryFillStatus: string;
  entryFilledAt: Date | null;
  observationCursorAt: Date | null;
}

export function evaluateClosedIntervals(args: {
  result: ClosedIntervalResult | undefined;
  boundaryTs: number;
  nowMs: number;
  direction: string;
  tp1: number | null;
  stopLoss: number | null;
}): { observation: BarrierObservation; intervals: ClosedInterval[]; source: string | null; version: string | null } {
  const { result } = args;
  if (!result || result.kind === "UNAVAILABLE") {
    return {
      observation: { kind: "CENSORED", reason: result?.reason ?? "AUTHORITATIVE_INTERVAL_MISSING", points: [] },
      intervals: [],
      source: null,
      version: null,
    };
  }
  const requiredStart = Math.ceil(args.boundaryTs / CLOSED_INTERVAL_MS) * CLOSED_INTERVAL_MS;
  const intervals = result.intervals.filter(i => i.startTs >= requiredStart);
  if (!intervals.length) {
    if (requiredStart + CLOSED_INTERVAL_MS <= args.nowMs) {
      return {
        observation: { kind: "CENSORED", reason: "AUTHORITATIVE_INTERVAL_MISSING", points: [] },
        intervals: [],
        source: result.source,
        version: result.version,
      };
    }
    return {
      observation: { kind: "PENDING", points: [] },
      intervals: [],
      source: result.source,
      version: result.version,
    };
  }
  if (intervals[0].startTs !== requiredStart) {
    return {
      observation: { kind: "CENSORED", reason: "AUTHORITATIVE_INTERVAL_GAP", points: [] },
      intervals: [],
      source: result.source,
      version: result.version,
    };
  }
  const consumed: ClosedInterval[] = [];
  for (const interval of intervals) {
    if (consumed.length && interval.startTs !== consumed[consumed.length - 1].endTs) {
      return {
        observation: { kind: "CENSORED", reason: "AUTHORITATIVE_INTERVAL_GAP", points: [] },
        intervals: consumed,
        source: result.source,
        version: result.version,
      };
    }
    consumed.push(interval);
    const observation = observeAuthoritativeInterval({
      interval,
      direction: args.direction,
      tp1: args.tp1,
      stopLoss: args.stopLoss,
    });
    if (observation.kind !== "PENDING") {
      return { observation, intervals: consumed, source: result.source, version: result.version };
    }
  }
  return {
    observation: {
      kind: "PENDING",
      points: consumed.flatMap(i => [{ price: i.low, ts: i.startTs }, { price: i.high, ts: i.endTs }]),
    },
    intervals: consumed,
    source: result.source,
    version: result.version,
  };
}

export async function resolveOnce(): Promise<void> {
  const pending = (await db
    .select({
      id: aiSignalLog.id,
      token: aiSignalLog.token,
      direction: aiSignalLog.direction,
      entryPrice: aiSignalLog.entryPrice,
      tp1Price: aiSignalLog.tp1Price,
      tp2Price: aiSignalLog.tp2Price,
      tp3Price: aiSignalLog.tp3Price,
      stopLoss: aiSignalLog.stopLoss,
      killClockExpires: aiSignalLog.killClockExpires,
      entryFillStatus: aiSignalLog.entryFillStatus,
       entryFilledAt: aiSignalLog.entryFilledAt,
       observationCursorAt: aiSignalLog.observationCursorAt,
    })
    .from(aiSignalLog)
    .where(eq(aiSignalLog.outcome, "PENDING"))
    .limit(500)) as PendingRow[];

  if (!pending.length) return;

  const now = new Date();
  const intervalRequests = new Map<string, number>();
  for (const row of pending) {
    if (row.entryFillStatus !== "VERIFIED" || !row.entryFilledAt || !Number.isFinite(row.entryFilledAt.getTime())) continue;
    const boundary = Math.max(row.entryFilledAt.getTime(), row.observationCursorAt?.getTime() ?? -Infinity);
    const symbol = row.token.toUpperCase();
    intervalRequests.set(symbol, Math.min(intervalRequests.get(symbol) ?? Infinity, boundary));
  }
  const intervalResults = await getClosedIntervals(
    [...intervalRequests].map(([symbol, startTs]) => ({ symbol, startTs })),
    { nowMs: now.getTime() },
  );
  let resolvedCount = 0;

  for (const row of pending) {
    const entry = parseFloat(row.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const price = getLivePrice(row.token);
    const tp1 = row.tp1Price != null ? parseFloat(row.tp1Price) : null;
    const sl = row.stopLoss != null ? parseFloat(row.stopLoss) : null;
    const boundaryTs = Math.max(row.entryFilledAt?.getTime() ?? NaN, row.observationCursorAt?.getTime() ?? -Infinity);
    const evaluated = row.entryFillStatus !== "VERIFIED"
      ? { observation: { kind: "CENSORED" as const, reason: "ENTRY_UNVERIFIED", points: [] }, intervals: [], source: null, version: null }
      : !Number.isFinite(boundaryTs)
        ? { observation: { kind: "CENSORED" as const, reason: "ENTRY_FILL_TIME_MISSING", points: [] }, intervals: [], source: null, version: null }
        : evaluateClosedIntervals({
            result: intervalResults.get(row.token.toUpperCase()),
            boundaryTs,
            nowMs: now.getTime(),
            direction: row.direction,
            tp1,
            stopLoss: sl,
          });
    const observation = evaluated.observation;

    // Update every sampled high-water mark and cursor in the same statement as
    // the terminal flip. This prevents a restart between observation and
    // resolution from losing the path evidence.
    // Complete OHLC ranges are authoritative for both labels and excursions.
    // Discrete priceHistory remains excursion-only and is never passed to the
    // barrier observer, so a sampled mark crossing cannot create a label.
    const observed = evaluated.intervals.flatMap(interval => [
      { price: interval.low, ts: interval.endTs },
      { price: interval.high, ts: interval.endTs },
    ]);
    if (Number.isFinite(boundaryTs)) {
      const excursionEndTs = evaluated.intervals[evaluated.intervals.length - 1]?.endTs ?? now.getTime();
      for (const point of priceHistory[(row.token || "").toUpperCase()] ?? []) {
        if (point.ts > boundaryTs && point.ts <= excursionEndTs && Number.isFinite(point.price) && point.price > 0) observed.push(point);
      }
    }
    let maxFavorable = 0, maxAdverse = 0;
    let maxFavorableAt: Date | null = null, maxAdverseAt: Date | null = null;
    for (const point of observed) {
      const pnl = computePnlPct(entry, point.price, row.direction);
      if (pnl > maxFavorable) { maxFavorable = pnl; maxFavorableAt = new Date(point.ts); }
      if (-pnl > maxAdverse) { maxAdverse = -pnl; maxAdverseAt = new Date(point.ts); }
    }
    const lastInterval = evaluated.intervals[evaluated.intervals.length - 1];
    const cursorJson = lastInterval ? JSON.stringify({
      startTs: lastInterval.startTs,
      endTs: lastInterval.endTs,
      source: evaluated.source,
      provider: evaluated.source,
      version: evaluated.version,
    }) : null;
    const terminal = observation.kind === "WIN" || observation.kind === "LOSS" || observation.kind === "CENSORED";
    const legacyOutcome = observation.kind === "WIN" ? "TP1_HIT" : observation.kind === "LOSS" ? "SL_HIT" : "CENSORED";
    const exitPrice = observation.kind === "WIN" ? tp1 : observation.kind === "LOSS" ? sl : null;
    const pnl = exitPrice == null ? null : computePnlPct(entry, exitPrice, row.direction);
    const censorReason = observation.kind === "CENSORED" ? observation.reason : null;
    const result = await db.execute(sql`
      UPDATE ai_signal_log
         SET observed_mfe_pct = CASE WHEN ${maxFavorable} > 0 AND (observed_mfe_pct IS NULL OR observed_mfe_pct < ${maxFavorable}) THEN ${maxFavorable} ELSE observed_mfe_pct END,
             observed_mfe_at = CASE WHEN ${maxFavorable} > 0 AND (observed_mfe_pct IS NULL OR observed_mfe_pct < ${maxFavorable}) THEN ${maxFavorableAt} ELSE observed_mfe_at END,
             observed_mae_pct = CASE WHEN ${maxAdverse} > 0 AND (observed_mae_pct IS NULL OR observed_mae_pct < ${maxAdverse}) THEN ${maxAdverse} ELSE observed_mae_pct END,
             observed_mae_at = CASE WHEN ${maxAdverse} > 0 AND (observed_mae_pct IS NULL OR observed_mae_pct < ${maxAdverse}) THEN ${maxAdverseAt} ELSE observed_mae_at END,
             observation_cursor = COALESCE(${cursorJson}::jsonb, observation_cursor),
              observation_cursor_at = COALESCE(${lastInterval ? new Date(lastInterval.endTs) : null}, observation_cursor_at),
              observation_method_version = COALESCE(${evaluated.version ?? (row.entryFillStatus === "VERIFIED" ? CLOSED_INTERVAL_VERSION : null)}, observation_method_version),
             outcome = CASE WHEN ${terminal} THEN ${legacyOutcome} ELSE outcome END,
             pnl_pct = CASE WHEN ${terminal && pnl != null} THEN ${pnl?.toFixed(4) ?? null} ELSE pnl_pct END,
             resolved_at = CASE WHEN ${terminal} THEN ${now} ELSE resolved_at END,
             calibration_label = CASE WHEN ${terminal} THEN ${observation.kind === "WIN" ? "WIN" : observation.kind === "LOSS" ? "LOSS" : "CENSORED"} ELSE calibration_label END,
             calibration_exclusion_reason = CASE WHEN ${terminal && observation.kind === "CENSORED"} THEN ${censorReason} ELSE calibration_exclusion_reason END
       WHERE id = ${row.id} AND outcome = 'PENDING'
       RETURNING id
    `);
    const wrote = (result as any).rows?.length > 0;
    if (terminal && wrote) {
      if (observation.kind === "WIN" || observation.kind === "LOSS") {
        resolvePrediction({ predictionId: row.id, outcome: mapOutcomeToWinLoss(legacyOutcome), exitPrice, pnlPct: pnl });
      }
      enqueuePostTradeAnalysis(row.id).catch(() => {});
      resolvedCount++;
      continue;
    }

    // Expiry is a display lifecycle event only; it is never forwarded as a
    // TP-before-SL win/loss label.
    if (row.killClockExpires && row.killClockExpires <= now) {
      const cur = price != null && Number.isFinite(price) ? price : entry;
      const pnl = computePnlPct(entry, cur, row.direction);
      const outcome = pnl >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
      // Preserve legacy EXPIRED_* display semantics, but it is never a
      // TP-before-SL label for the new calibration contract.
      const updated = await db.update(aiSignalLog)
        .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now, calibrationLabel: "CENSORED", calibrationExclusionReason: price == null ? "PRICE_MISSING_AT_EXPIRY" : "HORIZON_EXPIRED" })
        .where(and(eq(aiSignalLog.id, row.id), eq(aiSignalLog.outcome, "PENDING")))
        .returning({ id: aiSignalLog.id });
      if (updated && updated.length > 0) {
        enqueuePostTradeAnalysis(row.id).catch(() => {});
      }
      resolvedCount++;
    }
  }

  if (resolvedCount > 0) {
    console.log(`[outcomeResolver] resolved ${resolvedCount}/${pending.length} pending signals`);
  }
}

// ── Shadow-inverted resolver ────────────────────────────────────────────────
// Runs against signal_shadow_inversions using the SAME live-price feed and
// SAME hit-detection logic as the real resolver, so the shadow outcomes are
// path-aware and directly comparable to the real ones.
interface PendingShadowRow {
  id: number;
  token: string;
  invertedDirection: string;
  entryPrice: string;
  invertedTp1: string | null;
  invertedTp2: string | null;
  invertedTp3: string | null;
  invertedSl: string | null;
  killClockExpires: Date | null;
}

async function resolveShadowsOnce(): Promise<void> {
  const pending = (await db
    .select({
      id: signalShadowInversions.id,
      token: signalShadowInversions.token,
      invertedDirection: signalShadowInversions.invertedDirection,
      entryPrice: signalShadowInversions.entryPrice,
      invertedTp1: signalShadowInversions.invertedTp1,
      invertedTp2: signalShadowInversions.invertedTp2,
      invertedTp3: signalShadowInversions.invertedTp3,
      invertedSl: signalShadowInversions.invertedSl,
      killClockExpires: signalShadowInversions.killClockExpires,
    })
    .from(signalShadowInversions)
    .where(eq(signalShadowInversions.outcome, "PENDING"))
    .limit(500)) as PendingShadowRow[];

  if (!pending.length) return;

  const now = new Date();
  let resolvedCount = 0;

  for (const row of pending) {
    const entry = parseFloat(row.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const price = getLivePrice(row.token);

    if (price != null && Number.isFinite(price)) {
      const dir = row.invertedDirection;
      const tp1 = row.invertedTp1 != null ? parseFloat(row.invertedTp1) : null;
      const tp2 = row.invertedTp2 != null ? parseFloat(row.invertedTp2) : null;
      const tp3 = row.invertedTp3 != null ? parseFloat(row.invertedTp3) : null;
      const sl  = row.invertedSl  != null ? parseFloat(row.invertedSl)  : null;

      const hit = (target: number | null) => {
        if (target == null || !Number.isFinite(target)) return false;
        return dir === "LONG" ? price >= target : price <= target;
      };
      const stopHit = (target: number | null) => {
        if (target == null || !Number.isFinite(target)) return false;
        return dir === "LONG" ? price <= target : price >= target;
      };

      let outcome: string | null = null;
      let exitPrice: number | null = null;
      if (hit(tp3)) { outcome = "TP3_HIT"; exitPrice = tp3; }
      else if (hit(tp2)) { outcome = "TP2_HIT"; exitPrice = tp2; }
      else if (hit(tp1)) { outcome = "TP1_HIT"; exitPrice = tp1; }
      else if (stopHit(sl)) { outcome = "SL_HIT"; exitPrice = sl; }

      if (outcome && exitPrice != null) {
        const pnl = computePnlPct(entry, exitPrice, dir);
        await db.update(signalShadowInversions)
          .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now })
          .where(and(eq(signalShadowInversions.id, row.id), eq(signalShadowInversions.outcome, "PENDING")));
        resolvedCount++;
        continue;
      }
    }

    if (row.killClockExpires && row.killClockExpires <= now) {
      const cur = price != null && Number.isFinite(price) ? price : entry;
      const pnl = computePnlPct(entry, cur, row.invertedDirection);
      const outcome = pnl >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
      await db.update(signalShadowInversions)
        .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now })
        .where(and(eq(signalShadowInversions.id, row.id), eq(signalShadowInversions.outcome, "PENDING")));
      resolvedCount++;
    }
  }

  if (resolvedCount > 0) {
    console.log(`[outcomeResolver] resolved ${resolvedCount}/${pending.length} shadow inversions`);
  }
}

export function startOutcomeResolver(): void {
  if (started) return;
  started = true;
  // Initial run after 30s to let price feeds warm up. Single-flight guard
  // prevents an overrunning tick from racing the next interval.
  const tick = async () => {
    if (tickInFlight) {
      console.warn("[outcomeResolver] previous tick still in flight — skipping this interval");
      return;
    }
    tickInFlight = true;
    try {
      try { await resolveOnce(); } catch (e) { console.error("[outcomeResolver] tick failed:", e); }
      try { await resolveShadowsOnce(); } catch (e) { console.error("[outcomeResolver] shadow tick failed:", e); }
    } finally {
      tickInFlight = false;
    }
  };
  setTimeout(() => {
    void tick();
    timer = setInterval(() => { void tick(); }, INTERVAL_MS);
  }, 30_000);
  console.log("[outcomeResolver] started (60s interval, real + shadow)");
}

export function stopOutcomeResolver(): void {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}
