import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { aiSignalLog, adaptiveThresholds } from "@shared/schema";

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let started = false;

export async function recalculateThresholds(): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const resolved = await db.select({
    token: aiSignalLog.token,
    direction: aiSignalLog.direction,
    outcome: aiSignalLog.outcome,
  }).from(aiSignalLog).where(and(
    ne(aiSignalLog.outcome, "PENDING"),
    gte(aiSignalLog.createdAt, thirtyDaysAgo),
  ));

  const groups: Record<string, { token: string; direction: string; wins: number; total: number }> = {};
  for (const s of resolved) {
    const key = `${s.token}__${s.direction}`;
    if (!groups[key]) groups[key] = { token: s.token, direction: s.direction, wins: 0, total: 0 };
    groups[key].total++;
    if (WIN_OUTCOMES.has(s.outcome || "")) groups[key].wins++;
  }

  let updated = 0;
  for (const g of Object.values(groups)) {
    if (g.total < 5) continue;

    const winRate = (g.wins / g.total) * 100;
    let adjustment = 0;
    if      (winRate < 40)  adjustment =  15;
    else if (winRate < 50)  adjustment =  10;
    else if (winRate < 55)  adjustment =   5;
    else if (winRate <= 65) adjustment =   0;
    else if (winRate <= 75) adjustment =  -5;
    else                    adjustment = -10;
    adjustment = Math.max(-20, Math.min(20, adjustment));

    const suppressed = winRate < 40 && g.total >= 10;
    const winRateRounded = Math.round(winRate * 100) / 100;

    // Upsert via raw SQL to respect manual_override (skip auto-updates when true)
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO adaptive_thresholds (token, direction, trade_type, baseline_threshold, current_threshold, adjustment, win_rate_30d, sample_size, suppressed, last_recalc, updated_at)
         VALUES ($1, $2, 'ALL', 75, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (token, direction, trade_type) DO UPDATE SET
           current_threshold = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.current_threshold ELSE EXCLUDED.current_threshold END,
           adjustment        = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.adjustment        ELSE EXCLUDED.adjustment        END,
           suppressed        = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.suppressed        ELSE EXCLUDED.suppressed        END,
           win_rate_30d      = EXCLUDED.win_rate_30d,
           sample_size       = EXCLUDED.sample_size,
           last_recalc       = NOW(),
           updated_at        = NOW()`,
        [g.token, g.direction, 75 + adjustment, adjustment, winRateRounded, g.total, suppressed]
      );
      updated++;
    } finally {
      client.release();
    }
    console.log(`[AdaptiveThresholds] ${g.token} ${g.direction}: ${winRate.toFixed(0)}% (${g.total}) → threshold ${75 + adjustment}% (adj ${adjustment >= 0 ? "+" : ""}${adjustment})${suppressed ? " ⛔SUPPRESSED" : ""}`);
  }
  if (updated > 0) console.log(`[AdaptiveThresholds] Recalculated ${updated} combos`);
  return updated;
}

export async function getThresholdFor(token: string, direction: string): Promise<{ threshold: number; suppressed: boolean; winRate: number | null; sampleSize: number } | null> {
  try {
    const rows = await db.select().from(adaptiveThresholds).where(and(
      eq(adaptiveThresholds.token, token),
      eq(adaptiveThresholds.direction, direction),
    )).limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      threshold: r.currentThreshold ?? 75,
      suppressed: !!r.suppressed,
      winRate: r.winRate30d != null ? parseFloat(r.winRate30d) : null,
      sampleSize: r.sampleSize ?? 0,
    };
  } catch (e) {
    console.error("[AdaptiveThresholds] getThresholdFor failed:", e);
    return null;
  }
}

export function startAdaptiveThresholds(): void {
  if (started) return;
  started = true;
  // First run after 2 min (let app settle)
  setTimeout(() => {
    recalculateThresholds().catch(e => console.error("[AdaptiveThresholds] recalc failed:", e));
    setInterval(() => {
      recalculateThresholds().catch(e => console.error("[AdaptiveThresholds] recalc failed:", e));
    }, INTERVAL_MS);
  }, 2 * 60 * 1000);
  console.log("[AdaptiveThresholds] Started — recalculating every hour");
}
