import type { Pool, PoolClient } from "pg";
import { DigestError } from "./weeklyDigestPolicy";

// Additive tables only. Production uses the existing Railway initDb path.
export async function initializeWeeklyDigestTables(db: Pick<PoolClient, "query">): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS weekly_digest_runs (
      week_key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      update_id INTEGER REFERENCES weekly_updates(id),
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_after TIMESTAMPTZ,
      error_stage TEXT,
      error_code TEXT,
      source_head_sha TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS weekly_update_sources (
      update_id INTEGER PRIMARY KEY REFERENCES weekly_updates(id),
      source_head_sha TEXT,
      source_since TIMESTAMPTZ,
      commit_shas TEXT[] NOT NULL DEFAULT '{}',
      log_ids INTEGER[] NOT NULL DEFAULT '{}',
      audience_initialized BOOLEAN NOT NULL DEFAULT false
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS weekly_update_deliveries (
      update_id INTEGER NOT NULL REFERENCES weekly_updates(id),
      recipient_key TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT,
      first_attempt_at TIMESTAMPTZ,
      provider_id TEXT,
      error_code TEXT,
      accepted_at TIMESTAMPTZ,
      PRIMARY KEY (update_id, recipient_key)
    )`);
}

// The dedicated connection owns this lock until the whole callback finishes.
// PostgreSQL releases it after a process crash; durable rows retain progress.
export async function withDigestLock<T>(
  db: Pool, namespace: number, key: number, work: (lock: PoolClient) => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const client = await db.connect();
  let broken = false;
  const onError = () => { broken = true; };
  client.on("error", onError);
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1,$2) AS acquired", [namespace, key]);
    if (!result.rows[0].acquired) return { acquired: false };
    try {
      return { acquired: true, value: await work(client) };
    } finally {
      if (!broken) await client.query("SELECT pg_advisory_unlock($1,$2)", [namespace, key]);
    }
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

export const WEEK_LOCK = 548201;
export const DELIVERY_LOCK = 548202;

/** Fence publication even if an advisory-lock connection dies during AI work. */
export async function publishWeeklyDigestOnce<T extends { id: number }>(
  db: Pool,
  weekKey: string | undefined,
  save: (client: PoolClient) => Promise<T>,
  sourceHeadSha?: string,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (weekKey) {
      const run = await client.query("SELECT update_id FROM weekly_digest_runs WHERE week_key=$1 FOR UPDATE", [weekKey]);
      if (!run.rows[0]) throw new DigestError("publication", "WEEKLY_RUN_MISSING");
      if (run.rows[0].update_id) {
        const existing = await client.query("SELECT * FROM weekly_updates WHERE id=$1", [run.rows[0].update_id]);
        if (!existing.rows[0]) throw new DigestError("publication", "ATTACHED_UPDATE_MISSING");
        await client.query("COMMIT");
        return existing.rows[0] as T;
      }
    }
    const update = await save(client);
    if (weekKey) await client.query(
      "UPDATE weekly_digest_runs SET update_id=$2,source_head_sha=COALESCE($3,source_head_sha),updated_at=NOW() WHERE week_key=$1",
      [weekKey, update.id, sourceHeadSha || null],
    );
    await client.query("COMMIT");
    return update;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
