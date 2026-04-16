import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog } from "@shared/schema";
import { livePrices, hlData } from "../state";

const INTERVAL_MS = 60 * 1000;
let started = false;
let timer: NodeJS.Timeout | null = null;

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
        await db.update(aiSignalLog)
          .set({ outcome, pnlPct: pnl.toFixed(4), resolvedAt: now })
          .where(eq(aiSignalLog.id, row.id));
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
        .where(eq(aiSignalLog.id, row.id));
      resolvedCount++;
    }
  }

  if (resolvedCount > 0) {
    console.log(`[outcomeResolver] resolved ${resolvedCount}/${pending.length} pending signals`);
  }
}

export function startOutcomeResolver(): void {
  if (started) return;
  started = true;
  // Initial run after 30s to let price feeds warm up
  setTimeout(() => {
    resolveOnce().catch((e) => console.error("[outcomeResolver] tick failed:", e));
    timer = setInterval(() => {
      resolveOnce().catch((e) => console.error("[outcomeResolver] tick failed:", e));
    }, INTERVAL_MS);
  }, 30_000);
  console.log("[outcomeResolver] started (60s interval)");
}

export function stopOutcomeResolver(): void {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}
