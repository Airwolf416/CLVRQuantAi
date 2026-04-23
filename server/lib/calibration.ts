// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION — empirical learning surface shared by /api/quant + auto-scanner.
//
// Levers powered by this module:
//   1. getEmpiricalPWin(score)        — replaces hardcoded score→pWin buckets
//                                       in routes.ts with a posterior fit on
//                                       realized outcomes (5-pt bins, Beta(2,2)
//                                       smoothed). Falls back to legacy buckets
//                                       on cache miss / insufficient sample.
//   2. getComboPrior(token, dir)      — replaces fixed 0.50 Bayesian prior in
//                                       computeBayesianScore() with the
//                                       per-(token,direction) recency-weighted
//                                       posterior. Falls back to 0.50.
//   3. getRecencyWeightedCombos()     — exponential-decay (half-life 7d) view
//                                       of the last 30d of combos, consumed by
//                                       performanceContext.ts to bias the
//                                       prompt toward recent reality.
//
// Design notes:
//   * Everything is read from a 5-minute background-refreshed in-memory cache,
//     so callers stay synchronous and can't be slowed by a DB round-trip.
//   * Beta(α=2,β=2) prior keeps low-sample buckets/combos from collapsing to
//     0% or 100% — equivalent to "imagine 2 prior wins and 2 prior losses".
//   * On any DB failure the cache stays at its last good snapshot; callers
//     receive `null` and fall back to legacy hardcoded behavior. Fails open.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";

const REFRESH_MS    = 5 * 60 * 1000;   // recompute caches every 5 min
const HALF_LIFE_DAYS = 7;              // recency decay
const WIN_OUTCOMES   = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES  = new Set(["SL_HIT", "EXPIRED_LOSS"]);

// Beta(α,β) smoothing — equivalent to α prior wins + β prior losses.
// 2/2 is mildly informative: stops 1-of-1 from reading as 100%.
const BETA_ALPHA = 2;
const BETA_BETA  = 2;

// Score bucket size for empirical pWin curve. 5 means buckets are 50-55,
// 55-60, …, 95-100. Smaller buckets = higher resolution but slower to
// accumulate enough samples per bucket.
const SCORE_BUCKET = 5;
// Stability guards (raised after architect review):
//   - MIN_BUCKET_N at 12 prevents flap on cutoff (a bucket sitting at ~8
//     weighted N would oscillate between empirical and fallback as recency
//     decay shifted the count by tenths between refreshes).
//   - MIN_COMBO_N at 6 prevents priors from moving on tiny effective evidence;
//     with 7d half-life, a few losses across recent days would otherwise
//     swing a sparse combo's prior dramatically.
const MIN_BUCKET_N = 12;
const MIN_COMBO_N  = 6;

// ── Cache shapes ────────────────────────────────────────────────────────────
interface BucketStat   { lo: number; hi: number; weightedWins: number; weightedN: number; pWin: number; }
interface ComboStat    { token: string; direction: string; weightedWins: number; weightedN: number; rawWins: number; rawTotal: number; pWin: number; recencyWinRate: number; }

let _bucketCache: Map<number, BucketStat> = new Map();   // key = lo edge of bucket
let _comboCache:  Map<string, ComboStat>  = new Map();   // key = `${token}|${direction}`
let _lastRefresh = 0;
let _started = false;

function comboKey(token: string, direction: string) { return `${token.toUpperCase()}|${direction.toUpperCase()}`; }
function smooth(wins: number, n: number) { return (wins + BETA_ALPHA) / (n + BETA_ALPHA + BETA_BETA); }

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the empirical win-rate (0..1) for signals whose adjusted score
 * falls in the same 5-point bucket as `score`. Returns null if the cache is
 * cold or the bucket has <MIN_BUCKET_N samples — caller should fall back to
 * the legacy hardcoded mapping in that case.
 */
export function getEmpiricalPWin(score: number): number | null {
  if (!Number.isFinite(score)) return null;
  const lo = Math.floor(score / SCORE_BUCKET) * SCORE_BUCKET;
  const stat = _bucketCache.get(lo);
  if (!stat || stat.weightedN < MIN_BUCKET_N) return null;
  return stat.pWin;
}

/**
 * Returns the per-(token,direction) posterior win-rate (0..1) suitable for
 * use as a Bayesian prior. Beta(2,2) smoothed and recency-weighted.
 * Returns null when no data — caller falls back to 0.50.
 */
export function getComboPrior(token: string, direction: string): number | null {
  const stat = _comboCache.get(comboKey(token, direction));
  if (!stat || stat.weightedN < MIN_COMBO_N) return null;
  return stat.pWin;
}

/**
 * Recency-weighted view of all (token, direction) combos. Used by
 * performanceContext.ts to render the per-combo table with weights that
 * privilege recent outcomes. Returns an empty array on cache miss.
 */
export function getRecencyWeightedCombos(): ComboStat[] {
  return Array.from(_comboCache.values());
}

export function getCalibrationDebug() {
  return {
    lastRefreshAgoMs: _lastRefresh ? Date.now() - _lastRefresh : null,
    bucketCount: _bucketCache.size,
    comboCount:  _comboCache.size,
    buckets: Array.from(_bucketCache.values()).sort((a,b) => a.lo - b.lo),
  };
}

// ── Refresh loop ────────────────────────────────────────────────────────────

async function refreshCalibration(): Promise<void> {
  const t0 = Date.now();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Pull token/direction/outcome/score/age in one shot. `scores` is a JSONB
  // blob — we extract the adjusted/quant score the same way it's written in
  // routes.ts (key: `quantScore` at the top level, fallback to `adjScore`).
  const rowsRes: any = await db.execute(sql`
    SELECT
      token,
      direction,
      outcome,
      EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0 AS age_days,
      -- Adjusted score is written as scores.advanced by /api/quant
      -- (see routes.ts ~4923) and as scores.adjScore / quantScore by other
      -- emitters. Try every known key in priority order; conviction is the
      -- final fallback for legacy rows.
      COALESCE(
        (scores ->> 'advanced')::float,
        (scores ->> 'adjScore')::float,
        (scores ->> 'quantScore')::float,
        (scores ->> 'score')::float,
        conviction::float
      ) AS score
    FROM ai_signal_log
    WHERE outcome IS NOT NULL
      AND outcome <> 'PENDING'
      AND created_at >= ${thirtyDaysAgo}
  `);
  const rows: Array<{ token: string; direction: string; outcome: string; age_days: string | number; score: string | number | null }> =
    Array.isArray(rowsRes) ? rowsRes : (rowsRes?.rows || []);

  const nextBuckets = new Map<number, BucketStat>();
  const nextCombos  = new Map<string, ComboStat>();

  for (const r of rows) {
    const ageDays = Number(r.age_days) || 0;
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);   // exponential decay
    const isWin  = WIN_OUTCOMES.has(r.outcome);
    const isLoss = LOSS_OUTCOMES.has(r.outcome);
    if (!isWin && !isLoss) continue;

    // ── Per-combo aggregation ───────────────────────────────────────────
    const ck = comboKey(r.token, r.direction);
    let combo = nextCombos.get(ck);
    if (!combo) {
      combo = { token: r.token, direction: r.direction, weightedWins: 0, weightedN: 0, rawWins: 0, rawTotal: 0, pWin: 0, recencyWinRate: 0 };
      nextCombos.set(ck, combo);
    }
    combo.weightedN += w;
    combo.rawTotal++;
    if (isWin) { combo.weightedWins += w; combo.rawWins++; }

    // ── Per-score-bucket aggregation ────────────────────────────────────
    const score = r.score != null ? Number(r.score) : NaN;
    if (Number.isFinite(score) && score >= 0 && score <= 100) {
      const lo = Math.floor(score / SCORE_BUCKET) * SCORE_BUCKET;
      let b = nextBuckets.get(lo);
      if (!b) {
        b = { lo, hi: lo + SCORE_BUCKET, weightedWins: 0, weightedN: 0, pWin: 0 };
        nextBuckets.set(lo, b);
      }
      b.weightedN += w;
      if (isWin) b.weightedWins += w;
    }
  }

  for (const b of nextBuckets.values()) {
    b.pWin = smooth(b.weightedWins, b.weightedN);
  }
  for (const c of nextCombos.values()) {
    c.pWin           = smooth(c.weightedWins, c.weightedN);
    c.recencyWinRate = c.weightedN > 0 ? c.weightedWins / c.weightedN : 0;
  }

  // Atomic swap — readers always see a consistent snapshot.
  _bucketCache = nextBuckets;
  _comboCache  = nextCombos;
  _lastRefresh = Date.now();

  console.log(`[Calibration] refreshed in ${Date.now() - t0}ms — ${rows.length} resolved signals → ${nextBuckets.size} score buckets, ${nextCombos.size} combos`);
}

export function startCalibration(): void {
  if (_started) return;
  _started = true;
  // First run after 90s (let DB warm + outcomeResolver get a tick in).
  setTimeout(() => {
    refreshCalibration().catch(e => console.error("[Calibration] initial refresh failed:", e?.message || e));
    setInterval(() => {
      refreshCalibration().catch(e => console.error("[Calibration] refresh failed:", e?.message || e));
    }, REFRESH_MS);
  }, 90 * 1000);
  console.log(`[Calibration] started — refreshing every ${REFRESH_MS / 60000} min, recency half-life ${HALF_LIFE_DAYS}d`);
}
