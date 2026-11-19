import type { Pool, PoolClient } from "pg";

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
