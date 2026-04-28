// Prod-DB mirror for the improvement log.
//
// Why this exists:
//   The agent's `logImprovement()` helper writes a one-line entry into
//   `update_log_entries` every time we ship a small user-visible change.
//   Those writes go to whatever DATABASE_URL the running process has — which
//   in dev is the workspace DB, NOT the live production DB. As a result the
//   admin "Improvement Log" panel on the deployed site stays empty even
//   though the dev panel fills up.
//
//   This module gives the dev process a second, narrowly-scoped Pool that
//   points at the production DB so improvement-log entries can be mirrored
//   there in real time as features ship.
//
// Safety guarantees:
//   - Only used by `logImprovement()`. Nothing else in the app touches this
//     pool — there's no general-purpose "write to prod" affordance here.
//   - If PROD_DATABASE_URL is missing, this is a no-op (dev still works).
//   - If PROD_DATABASE_URL === DATABASE_URL (i.e. we're already running in
//     prod), this is a no-op so prod doesn't try to mirror onto itself.
//   - Same 7-day dedupe as the local insert, evaluated against the prod DB,
//     so retries / restarts don't create duplicate prod rows.
//   - All failures are caught and logged. A broken prod-mirror never breaks
//     the local insert, never bubbles up, never breaks the calling feature.
//   - Pool size is capped tight (max 2) since this path is low-volume.

import { Pool } from "pg";

let prodPool: Pool | null = null;
let initialized = false;

function getProdPool(): Pool | null {
  if (initialized) return prodPool;
  initialized = true;

  const url = process.env.PROD_DATABASE_URL;
  if (!url) {
    return null;
  }
  if (url === process.env.DATABASE_URL) {
    console.log("[prod-mirror] PROD_DATABASE_URL == DATABASE_URL — already running in prod, mirror disabled");
    return null;
  }

  try {
    const useSSL = /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url) || /\.replit\./i.test(url);
    prodPool = new Pool({
      connectionString: url,
      max: 2,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    });
    prodPool.on("error", (e: any) => {
      console.warn("[prod-mirror] pool error:", e?.message || e);
    });
    console.log("[prod-mirror] enabled — improvement-log entries will mirror to prod DB");
    return prodPool;
  } catch (e: any) {
    console.warn("[prod-mirror] failed to init prod pool:", e?.message || e);
    prodPool = null;
    return null;
  }
}

export interface MirrorInput {
  headline: string;
  detail: string | null;
  emoji: string | null;
  addedBy: string;
}

export async function mirrorImprovementToProd(input: MirrorInput): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    const dup = await pool.query(
      `SELECT id FROM update_log_entries
        WHERE headline = $1
          AND created_at > NOW() - INTERVAL '7 days'
        LIMIT 1`,
      [input.headline],
    );
    if (dup.rowCount && dup.rowCount > 0) {
      return;
    }
    await pool.query(
      `INSERT INTO update_log_entries (headline, detail, emoji, added_by)
       VALUES ($1, $2, $3, $4)`,
      [input.headline, input.detail, input.emoji, input.addedBy],
    );
    console.log(`[prod-mirror] +${input.emoji || "•"} ${input.headline}`);
  } catch (e: any) {
    console.warn(`[prod-mirror] mirror failed for "${input.headline}":`, e?.message || e);
  }
}
