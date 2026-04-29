import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog, signalShadowInversions } from "@shared/schema";
import { livePrices, hlData } from "../state";

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
}

async function resolveOnce(): Promise<void> {
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
    })
    .from(aiSignalLog)
    .where(eq(aiSignalLog.outcome, "PENDING"))
    .limit(500)) as PendingRow[];

  if (!pending.length) return;

  const now = new Date();
  let resolvedCount = 0;

  for (const row of pending) {
    const entry = parseFloat(row.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const price = getLivePrice(row.token);

    // Check TP/SL hits first (if we have a live price)
    if (price != null && Number.isFinite(price)) {
      const dir = row.direction;
      const tp1 = row.tp1Price != null ? parseFloat(row.tp1Price) : null;
      const tp2 = row.tp2Price != null ? parseFloat(row.tp2Price) : null;
      const tp3 = row.tp3Price != null ? parseFloat(row.tp3Price) : null;
      const sl  = row.stopLoss  != null ? parseFloat(row.stopLoss)  : null;

      const hit = (target: number | null) => {
        if (target == null || !Number.isFinite(target)) return false;
        return dir === "LONG" ? price >= target : price <= target;
      };
      const stopHit = (target: number | null) => {
        if (target == null || !Number.isFinite(target)) return false;
        return dir === "LONG" ? price <= target : price >= target;
      };

      // Check most-ambitious TP first (TP3 > TP2 > TP1)
      let outcome: string | null = null;
      let exitPrice: number | null = null;
      if (hit(tp3)) { outcome = "TP3_HIT"; exitPrice = tp3; }
      else if (hit(tp2)) { outcome = "TP2_HIT"; exitPrice = tp2; }
      else if (hit(tp1)) { outcome = "TP1_HIT"; exitPrice = tp1; }
      else if (stopHit(sl)) { outcome = "SL_HIT"; exitPrice = sl; }

      if (outcome && exitPrice != null) {
        const pnl = computePnlPct(entry, exitPrice, dir);
        // Compare-and-set on outcome='PENDING' so a slow tick that races the
        // next tick (or any future concurrent worker) can never double-resolve.
        await db.update(aiSignalLog)
          .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now })
          .where(and(eq(aiSignalLog.id, row.id), eq(aiSignalLog.outcome, "PENDING")));
        resolvedCount++;
        continue;
      }
    }

    // Check kill-clock expiry (use current price to mark as EXPIRED_WIN/LOSS)
    if (row.killClockExpires && row.killClockExpires <= now) {
      const cur = price != null && Number.isFinite(price) ? price : entry;
      const pnl = computePnlPct(entry, cur, row.direction);
      const outcome = pnl >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
      await db.update(aiSignalLog)
        .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now })
        .where(and(eq(aiSignalLog.id, row.id), eq(aiSignalLog.outcome, "PENDING")));
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
