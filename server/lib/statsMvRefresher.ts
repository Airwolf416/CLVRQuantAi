// ─────────────────────────────────────────────────────────────────────────────
// Module 2 T09 — archetype_stats materialized view refresher
//
// Fires every 5 min from the boot path; debounces against last-refresh so the
// MV gets touched at most ~once per hour under normal load, with an extra
// refresh at :35 past the hour during US cash hours (13:30-21:00 UTC) so the
// admin dashboard reflects mid-session signal resolution without a full
// hourly wait.
//
// Every attempt — success OR failure — writes one row to `stats_refresh_log`
// for the T12 admin panel + alerting. Two consecutive failures or any
// duration >30s triggers a console.warn (no new alerting infrastructure;
// existing log channel is the source of truth per project preference).
//
// Fail-open: scheduler errors never block the signal flow. The signal path
// reads via the repository abstraction (T10) which falls back to TS
// computation when the MV is stale or unreachable.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";

const REFRESH_TICK_MS = 5 * 60 * 1000;        // 5 min scheduler heartbeat
const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // never refresh more often than every 15 min
const SLOW_REFRESH_THRESHOLD_MS = 30 * 1000;  // warn at 30s
const FAILURE_WARN_THRESHOLD = 2;             // warn after N consecutive failures

let _lastRefreshAt = 0;
let _refreshInFlight = false;
let _consecutiveFailures = 0;
let _lastSummary: RefreshSummary | null = null;

export interface RefreshSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  rowsRefreshed: number;
  success: boolean;
  errorMessage: string | null;
  concurrent: boolean;
  mvName?: string;
}

/** Returns timing/counts of the most recent refresh attempt (for the admin panel). */
export function getLastRefreshSummary(): RefreshSummary | null {
  return _lastSummary;
}

/** Is one refresh currently in flight? Used by the admin endpoint for guard. */
export function isRefreshInFlight(): boolean {
  return _refreshInFlight;
}

/**
 * Run a single MV refresh. Tries CONCURRENTLY first (zero blocking on
 * readers) and falls back to plain REFRESH if the unique index is missing
 * for some reason — the fallback is mostly a safety net for fresh DBs that
 * raced the boot path. Returns a structured summary.
 *
 * Always writes a row to stats_refresh_log, including on failure.
 */
async function refreshOneMV(
  mvName: "archetype_stats" | "archetype_scorecard",
  allowConcurrent: boolean,
): Promise<RefreshSummary> {
  const startedAt = new Date();
  let concurrent = false;
  let rowsRefreshed = 0;
  let errorMessage: string | null = null;
  let success = false;
  try {
    if (allowConcurrent) {
      try {
        await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mvName}`));
        concurrent = true;
      } catch (concErr: any) {
        console.warn(`[mvRefresh:${mvName}] CONCURRENTLY failed, falling back:`, concErr?.message);
        await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${mvName}`));
      }
    } else {
      await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${mvName}`));
    }
    try {
      const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::INTEGER AS n FROM ${mvName}`));
      rowsRefreshed = Number((r?.rows || r || [])[0]?.n || 0);
    } catch { /* best-effort */ }
    success = true;
  } catch (err: any) {
    errorMessage = String(err?.message || err);
    console.error(`[mvRefresh:${mvName}] failed:`, errorMessage);
  }
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  if (success && durationMs > SLOW_REFRESH_THRESHOLD_MS) {
    console.warn(`[mvRefresh:${mvName}] slow refresh: ${durationMs}ms`);
  }
  // Per-MV row in stats_refresh_log (Module 3 T04 — mv_name added).
  try {
    await db.execute(sql`
      INSERT INTO stats_refresh_log
        (started_at, duration_ms, rows_refreshed, success, error_message, mv_name)
      VALUES
        (${startedAt.toISOString()}, ${durationMs}, ${rowsRefreshed},
         ${success}, ${errorMessage}, ${mvName})
    `);
  } catch (logErr: any) {
    console.warn(`[mvRefresh:${mvName}] log write failed:`, logErr?.message);
  }
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs, rowsRefreshed, success, errorMessage, concurrent, mvName,
  };
}

export async function refreshArchetypeStatsMV(opts?: { allowConcurrent?: boolean }): Promise<RefreshSummary> {
  if (_refreshInFlight) {
    // Caller should respect this; we still need to return a sentinel.
    return {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0, rowsRefreshed: 0, success: false,
      errorMessage: "refresh_already_in_flight", concurrent: false,
    };
  }
  _refreshInFlight = true;
  const allowConcurrent = opts?.allowConcurrent ?? true;
  let primary: RefreshSummary;
  try {
    // Refresh both MVs back-to-back. Independent try/catch in refreshOneMV
    // ensures a failure in one never aborts the other. Each gets its own
    // stats_refresh_log row tagged with mv_name.
    primary = await refreshOneMV("archetype_stats", allowConcurrent);
    // Module 3 T04 — also refresh the per-archetype scorecard.
    await refreshOneMV("archetype_scorecard", allowConcurrent);
    if (primary.success) {
      _consecutiveFailures = 0;
      _lastRefreshAt = Date.now();
    } else {
      _consecutiveFailures++;
    }
  } finally {
    _refreshInFlight = false;
  }
  if (_consecutiveFailures >= FAILURE_WARN_THRESHOLD) {
    console.warn(`[mvRefresh] ${_consecutiveFailures} consecutive failures — admin attention recommended`);
  }
  _lastSummary = primary;
  return primary;
}

/**
 * Should we fire a refresh at this tick? Two trigger windows:
 *   1. :05 past every hour (always)
 *   2. :35 past every hour during US cash hours (13:30-21:00 UTC)
 * Plus a hard floor: never run more often than MIN_REFRESH_INTERVAL_MS apart.
 */
function shouldRefreshNow(now = new Date()): boolean {
  if (Date.now() - _lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return false;
  const minute = now.getUTCMinutes();
  const hourUtc = now.getUTCHours();
  // 5-min window around :05
  if (minute >= 5 && minute < 10) return true;
  // 5-min window around :35 during cash hours
  if (minute >= 35 && minute < 40 && hourUtc >= 13 && hourUtc <= 20) return true;
  return false;
}

/**
 * Boot-time scheduler. Idempotent — safe to call once from server/index.ts.
 * Returns the interval handle for tests.
 */
export function startStatsMvRefreshScheduler(): NodeJS.Timeout {
  console.log("[mvRefresh] scheduler started (tick=5min, min_interval=15min)");
  const handle = setInterval(async () => {
    try {
      if (!shouldRefreshNow()) return;
      console.log("[mvRefresh] tick → refreshing archetype_stats MV…");
      await refreshArchetypeStatsMV();
    } catch (err: any) {
      console.error("[mvRefresh] scheduler tick failed:", err?.message);
    }
  }, REFRESH_TICK_MS);
  // Don't keep the process alive solely because of this timer.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
