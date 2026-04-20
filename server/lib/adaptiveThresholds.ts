import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { aiSignalLog, adaptiveThresholds } from "@shared/schema";

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const INTERVAL_MS = 15 * 60 * 1000; // 15 min — aggressive adaptation cadence (tightened Apr 2026)
let started = false;

// Wilson lower bound at 90% one-sided (z=1.645).
// Conservative: doesn't trip on small samples, statistically sound.
export function wilsonLower(wins: number, n: number, z = 1.645): number {
  if (n <= 0) return 0;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return Math.max(0, centre - margin);
}

const WILSON_SUPPRESS_THRESHOLD = 0.30; // suppress if Wilson lower bound < 30%

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
    // AGGRESSIVE adjustment scale — matched to overall ~32% win rate problem
    let adjustment = 0;
    if      (winRate < 20)  adjustment =  25;  // catastrophic
    else if (winRate < 30)  adjustment =  20;  // very bad
    else if (winRate < 40)  adjustment =  15;  // bad
    else if (winRate < 50)  adjustment =  10;  // below average
    else if (winRate < 55)  adjustment =   5;
    else if (winRate <= 65) adjustment =   0;
    else if (winRate <= 75) adjustment =  -5;
    else if (winRate <= 85) adjustment = -10;
    else                    adjustment = -15;
    adjustment = Math.max(-25, Math.min(25, adjustment));

    // Auto-suppress when EITHER:
    //   (a) Wilson lower bound < 30% with 10+ resolved signals (conservative), OR
    //   (b) raw win rate < 30% with 20+ resolved signals (per Apr 2026 spec — catches
    //       persistent bleeders that Wilson takes too long to lock down).
    const wLow = wilsonLower(g.wins, g.total);
    const wilsonSuppress = g.total >= 10 && wLow < WILSON_SUPPRESS_THRESHOLD;
    const rawSuppress    = g.total >= 20 && winRate < 30;
    const suppressed     = wilsonSuppress || rawSuppress;
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
    console.log(`[AdaptiveThresholds] ${g.token} ${g.direction}: ${winRate.toFixed(0)}% (${g.total}, wL=${(wLow * 100).toFixed(0)}%) → threshold ${75 + adjustment}% (adj ${adjustment >= 0 ? "+" : ""}${adjustment})${suppressed ? " ⛔SUPPRESSED" : ""}`);
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

// One-time on-startup migration: suppress every token+direction with
// <25% win rate over 10+ resolved signals. Catches up the system to reality
// even before the first 30-min recalc runs. Idempotent — safe to call repeatedly.
export async function suppressHistoricalBleeders(): Promise<number> {
  try {
    const client = await pool.connect();
    try {
      const winSql = `(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN') THEN 1 ELSE 0 END)`;
      const result = await client.query(`
        WITH stats AS (
          SELECT token, direction,
                 COUNT(*) AS total,
                 ROUND(100.0 * SUM(${winSql}) / COUNT(*), 2) AS win_rate
          FROM ai_signal_log
          WHERE outcome IS NOT NULL AND outcome <> 'PENDING'
          GROUP BY token, direction
          HAVING COUNT(*) >= 10
             AND (100.0 * SUM(${winSql}) / COUNT(*)) < 30
        )
        INSERT INTO adaptive_thresholds
          (token, direction, trade_type, baseline_threshold, current_threshold,
           adjustment, win_rate_30d, sample_size, suppressed, manual_override,
           last_recalc, updated_at)
        SELECT token, direction, 'ALL', 75, 95, 20, win_rate, total, true, false, NOW(), NOW()
        FROM stats
        ON CONFLICT (token, direction, trade_type) DO UPDATE SET
          suppressed        = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.suppressed        ELSE true  END,
          current_threshold = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.current_threshold ELSE 95    END,
          adjustment        = CASE WHEN adaptive_thresholds.manual_override THEN adaptive_thresholds.adjustment        ELSE 20    END,
          win_rate_30d      = EXCLUDED.win_rate_30d,
          sample_size       = EXCLUDED.sample_size,
          last_recalc       = NOW(),
          updated_at        = NOW()
        RETURNING token, direction, win_rate_30d, sample_size
      `);
      const count = result.rowCount || 0;
      if (count > 0) {
        console.log(`[AdaptiveThresholds] ⛔ Suppressed ${count} historical bleeders:`);
        for (const r of result.rows) {
          console.log(`  • ${r.token} ${r.direction}: ${r.win_rate_30d}% over ${r.sample_size} signals`);
        }
      } else {
        console.log("[AdaptiveThresholds] No historical bleeders to suppress");
      }
      return count;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[AdaptiveThresholds] suppressHistoricalBleeders failed:", e);
    return 0;
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
  console.log(`[AdaptiveThresholds] Started — recalculating every ${INTERVAL_MS / 60000} min`);
}
