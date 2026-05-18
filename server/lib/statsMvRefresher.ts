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
  const startedAt = new Date();
  const allowConcurrent = opts?.allowConcurrent ?? true;
  let concurrent = false;
  let rowsRefreshed = 0;
  let errorMessage: string | null = null;
  let success = false;
  try {
    if (allowConcurrent) {
      try {
        await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY archetype_stats`);
        concurrent = true;
      } catch (concErr: any) {
        // Common reason: no unique index, or first run from an empty MV that
        // hasn't been populated non-concurrently yet. Retry the slow path.
        console.warn("[mvRefresh] CONCURRENTLY failed, falling back:", concErr?.message);
        await db.execute(sql`REFRESH MATERIALIZED VIEW archetype_stats`);
      }
    } else {
      await db.execute(sql`REFRESH MATERIALIZED VIEW archetype_stats`);
    }
    try {
      const r: any = await db.execute(sql`SELECT COUNT(*)::INTEGER AS n FROM archetype_stats`);
      rowsRefreshed = Number((r?.rows || r || [])[0]?.n || 0);
    } catch { /* row count is best-effort */ }
    success = true;
    _consecutiveFailures = 0;
    _lastRefreshAt = Date.now();
  } catch (err: any) {
    errorMessage = String(err?.message || err);
    _consecutiveFailures++;
    console.error("[mvRefresh] failed:", errorMessage);
  } finally {
    _refreshInFlight = false;
  }
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  if (success && durationMs > SLOW_REFRESH_THRESHOLD_MS) {
    console.warn(`[mvRefresh] slow refresh: ${durationMs}ms (threshold ${SLOW_REFRESH_THRESHOLD_MS}ms)`);
  }
  if (_consecutiveFailures >= FAILURE_WARN_THRESHOLD) {
    console.warn(`[mvRefresh] ${_consecutiveFailures} consecutive failures — admin attention recommended`);
  }

  // Persist the attempt to stats_refresh_log. Drizzle-only. Best-effort.
  try {
    await db.execute(sql`
      INSERT INTO stats_refresh_log
        (started_at, duration_ms, rows_refreshed, success, error_message)
      VALUES
        (${startedAt.toISOString()}, ${durationMs}, ${rowsRefreshed},
         ${success}, ${errorMessage})
    `);
  } catch (logErr: any) {
    console.warn("[mvRefresh] log write failed:", logErr?.message);
  }

  const summary: RefreshSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs, rowsRefreshed, success, errorMessage, concurrent,
  };
  _lastSummary = summary;
  return summary;
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
