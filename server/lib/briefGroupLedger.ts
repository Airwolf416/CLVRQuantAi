// Existing Railway databases may still have the old date-only VARCHAR limit.
// Widen only bounded character columns; preserve rows and the unique index.
export const BRIEF_GROUP_KEY_MIGRATION = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'daily_briefs_log' AND column_name = 'date_key'
        AND data_type = 'character varying'
        AND character_maximum_length IS NOT NULL
    ) THEN
      ALTER TABLE daily_briefs_log ALTER COLUMN date_key TYPE VARCHAR;
    END IF;
  END $$
`;

type Query = (sql: string, values?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export function createBriefGroupLedger(database: { query: Query }) {
  return {
    async has(key: string): Promise<boolean> {
      const result = await database.query(
        "SELECT 1 FROM daily_briefs_log WHERE date_key = $1 LIMIT 1", [key],
      );
      return result.rows.length > 0;
    },
    async claim(key: string): Promise<boolean> {
      const result = await database.query(`
        INSERT INTO daily_briefs_log (date_key, sent_at, recipient_count)
        VALUES ($1, NOW(), 0)
        ON CONFLICT (date_key) DO NOTHING
        RETURNING date_key
      `, [key]);
      // Only a successful query with no inserted row means "already claimed".
      // Database failures must propagate without allowing a provider call.
      return (result.rowCount || 0) > 0;
    },
  };
}

export function isTerminalBriefAttempt(result: { errors: readonly string[] } | null): boolean {
  // null means handed to the durable queue. Explicit failures remain retryable,
  // including a pre-send ledger failure where ran=false.
  return result === null || result.errors.length === 0;
}
