type CooldownDb = {
  query(sql: string, values: unknown[]): Promise<{ rows: Array<{ hits: number; retry_after: number }> }>;
};

/** Atomic per-account resend claim, persisted in the shared rate-limit table. */
export async function claimResendCooldown(db: CooldownDb, userId: string): Promise<number> {
  const claim = await db.query(
    `INSERT INTO rate_limit_entries (key, hits, reset_at) VALUES ($1, 1, NOW() + INTERVAL '60 seconds')
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limit_entries.reset_at <= NOW() THEN 1 ELSE rate_limit_entries.hits + 1 END,
       reset_at = CASE WHEN rate_limit_entries.reset_at <= NOW() THEN NOW() + INTERVAL '60 seconds' ELSE rate_limit_entries.reset_at END
     RETURNING hits, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (reset_at - NOW()))))::int AS retry_after`,
    [`email-verification:${userId}`],
  );
  return Number(claim.rows[0].hits) > 1 ? Number(claim.rows[0].retry_after) || 1 : 0;
}