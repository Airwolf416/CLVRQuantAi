// ─────────────────────────────────────────────────────────────────────────────
// Module 2 T10 — stats repository abstraction
//
// Two implementations behind one interface so the live signal path can switch
// from in-process Drizzle queries to the pre-computed `archetype_stats`
// materialized view via a single env flag (STATS_SOURCE = "ts" | "mv"). No
// caller-side changes required when the flag flips — `getArchetypeStats` in
// statisticalBrain.ts delegates here.
//
//   - TsStatsRepository:           current Module 1 behavior, 5-min cache,
//                                  filters by (token, direction, archetype).
//   - MaterializedViewStatsRepository: reads from `archetype_stats` MV;
//                                  the MV is aggregated by (archetype,
//                                  classification_source) ONLY — there's no
//                                  per-(token, direction) partition in the
//                                  MV today, so this repo returns the
//                                  cross-token archetype stats and the per-
//                                  pair filter is dropped. Acceptable for
//                                  cards because the on-card stats already
//                                  surface "this archetype, this side" at
//                                  the archetype level — per-pair specificity
//                                  is best-effort.
//
// Shadow-compare: `runShadowCompare()` queries both repositories for the
// same input and writes any divergence >1pp to `stats_divergence_log`. Wired
// from a 30-min interval in the boot path (T09 scheduler module imports it).
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { ArchetypeStats } from "./statisticalBrain";
// Cycle-safe: use the TS-only path so MV fallback / shadow-compare never
// re-enter the STATS_SOURCE check inside statisticalBrain.getArchetypeStats.
import { getArchetypeStatsTsOnly } from "./statisticalBrain";
import { statsSource } from "./featureFlags";

export interface IStatsRepository {
  /** Source label ("ts" | "mv") for diagnostics. */
  source(): "ts" | "mv";
  getArchetypeStats(token: string, direction: "LONG" | "SHORT", archetype: string): Promise<ArchetypeStats>;
}

export class TsStatsRepository implements IStatsRepository {
  source(): "ts" | "mv" { return "ts"; }
  async getArchetypeStats(token: string, direction: "LONG" | "SHORT", archetype: string): Promise<ArchetypeStats> {
    // Always raw-TS — never consult STATS_SOURCE. This keeps shadow-compare
    // logically valid even when the flag flips to "mv" in production.
    return getArchetypeStatsTsOnly(token, direction, archetype);
  }
}

export class MaterializedViewStatsRepository implements IStatsRepository {
  source(): "ts" | "mv" { return "mv"; }
  async getArchetypeStats(token: string, direction: "LONG" | "SHORT", archetype: string): Promise<ArchetypeStats> {
    const empty: ArchetypeStats = {
      token, direction, archetype,
      n: 0, wins: 0, losses: 0,
      wrPointEst: 0, wrWilsonLB: 0, wrWilsonLB80: 0, medianR: 0,
      p75HoldMinutes: 0, medianTimeToTpMin: 0, medianTimeToSlMin: 0,
      lowSample: true,
    };
    try {
      // MV is partitioned by (archetype, classification_source). We collapse
      // 'live' + 'backfill' here so the card sees combined counts — the
      // admin dashboard (T12) reads the un-collapsed rows directly.
      const result: any = await db.execute(sql`
        SELECT
          SUM(n)::INTEGER     AS n,
          SUM(wins)::INTEGER  AS wins,
          SUM(losses)::INTEGER AS losses,
          -- recompute wrs from totals so the LCB is over the pooled n
          CASE WHEN SUM(n) > 0 THEN SUM(wins)::FLOAT / SUM(n)::FLOAT ELSE 0 END AS wr_point,
          wilson_lcb(SUM(wins)::INTEGER, SUM(n)::INTEGER, 0.80) AS wr_lcb_80,
          wilson_lcb(SUM(wins)::INTEGER, SUM(n)::INTEGER, 0.95) AS wr_lcb_95,
          AVG(median_r)               AS median_r,
          AVG(p75_hold_minutes)       AS p75_hold,
          AVG(median_time_to_tp_min)  AS med_tp,
          AVG(median_time_to_sl_min)  AS med_sl
        FROM archetype_stats
        WHERE archetype = ${archetype}
      `);
      const row: any = (result?.rows || result || [])[0];
      if (!row || !Number(row.n)) return empty;
      const n = Number(row.n);
      return {
        token, direction, archetype,
        n, wins: Number(row.wins) || 0, losses: Number(row.losses) || 0,
        wrPointEst: Number(row.wr_point) || 0,
        wrWilsonLB: Number(row.wr_lcb_95) || 0,
        wrWilsonLB80: Number(row.wr_lcb_80) || 0,
        medianR: Number(row.median_r) || 0,
        p75HoldMinutes: Number(row.p75_hold) || 0,
        medianTimeToTpMin: Number(row.med_tp) || 0,
        medianTimeToSlMin: Number(row.med_sl) || 0,
        lowSample: n <= 20,
      };
    } catch (err: any) {
      console.warn(`[mvRepo] getArchetypeStats(${archetype}) failed — falling back to TS raw:`, err?.message);
      return getArchetypeStatsTsOnly(token, direction, archetype);
    }
  }
}

const _tsRepo = new TsStatsRepository();
const _mvRepo = new MaterializedViewStatsRepository();

/**
 * Pick the active repository based on STATS_SOURCE. Default is "ts" so the
 * live cutover happens only after the operator flips the env var. Falls back
 * to TS for any unknown value to fail-closed.
 */
export function getActiveStatsRepository(): IStatsRepository {
  return statsSource() === "mv" ? _mvRepo : _tsRepo;
}

/**
 * Shadow compare TS vs MV for a fixed list of "important" archetypes. Writes
 * any divergence >1pp on the 80% LCB to stats_divergence_log. Fail-open.
 */
const SHADOW_ARCHETYPES = [
  "NEWS_MOMO", "MEAN_REVERSION_EXHAUSTION", "BREAKOUT_RETEST",
  "VWAP_RECLAIM", "TREND_PULLBACK", "RANGE_FADE", "UNCLASSIFIED",
];
const DIVERGENCE_THRESHOLD = 0.01; // 1pp

export async function runShadowCompare(): Promise<{ checked: number; divergent: number }> {
  let checked = 0, divergent = 0;
  for (const arch of SHADOW_ARCHETYPES) {
    try {
      const [ts, mv] = await Promise.all([
        _tsRepo.getArchetypeStats("BTC", "LONG", arch),  // token/dir ignored by MV repo
        _mvRepo.getArchetypeStats("BTC", "LONG", arch),
      ]);
      checked++;
      const div = Math.abs((ts.wrWilsonLB80 || 0) - (mv.wrWilsonLB80 || 0));
      if (div > DIVERGENCE_THRESHOLD) {
        divergent++;
        await db.execute(sql`
          INSERT INTO stats_divergence_log
            (archetype, ts_n, mv_n, ts_wr_lcb, mv_wr_lcb, divergence_abs)
          VALUES
            (${arch}, ${ts.n}, ${mv.n},
             ${ts.wrWilsonLB80}, ${mv.wrWilsonLB80}, ${div})
        `).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`[shadowCompare] ${arch} failed:`, err?.message);
    }
  }
  return { checked, divergent };
}

/**
 * Boot-time scheduler — runs shadow compare every 30 min. Lightweight (just
 * 7 archetype comparisons), so always-on is fine. Returns the interval
 * handle. Idempotent if called multiple times — caller is responsible for
 * guarding (we only invoke once from server/index.ts).
 */
export function startShadowCompareScheduler(): NodeJS.Timeout {
  console.log("[shadowCompare] scheduler started (30min cadence)");
  const handle = setInterval(async () => {
    try {
      const { checked, divergent } = await runShadowCompare();
      if (divergent > 0) {
        console.warn(`[shadowCompare] ${divergent}/${checked} archetypes diverge >1pp — see stats_divergence_log`);
      }
    } catch (err: any) {
      console.warn("[shadowCompare] tick failed:", err?.message);
    }
  }, 30 * 60 * 1000);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
