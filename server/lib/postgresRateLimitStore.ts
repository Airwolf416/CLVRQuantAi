import type { Options, Store } from "express-rate-limit";
import { pool } from "../db";

export type RateLimitQueryable = {
  query(query: string, values?: unknown[]): Promise<{ rows: Array<{ hits?: number; reset_at?: Date | string }> }>;
};

/** Only this read may use the independent account-check budget. */
export function isAuthMeRead(req: { method: string; path: string }): boolean {
  return req.method === "GET" && req.path === "/api/auth/me";
}

/** Shared, atomic rate-limit store for all replica-safe security limiters. */
export class PostgresRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;

  constructor(prefix: string, private readonly client: RateLimitQueryable = pool) {
    this.prefix = `pg:${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    const resetTime = new Date(Date.now() + this.windowMs);
    const result = await this.client.query(
      `INSERT INTO rate_limit_entries (key, hits, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
         SET hits = CASE WHEN rate_limit_entries.reset_at <= NOW() THEN 1 ELSE rate_limit_entries.hits + 1 END,
             reset_at = CASE WHEN rate_limit_entries.reset_at <= NOW() THEN EXCLUDED.reset_at ELSE rate_limit_entries.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, resetTime],
    );
    return {
      totalHits: Number(result.rows[0]?.hits || 1),
      resetTime: new Date(result.rows[0]?.reset_at || resetTime),
    };
  }

  async decrement(key: string): Promise<void> {
    await this.client.query(
      "UPDATE rate_limit_entries SET hits = GREATEST(hits - 1, 0) WHERE key = $1",
      [this.prefix + key],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.client.query("DELETE FROM rate_limit_entries WHERE key = $1", [this.prefix + key]);
  }

  async resetAll(): Promise<void> {
    await this.client.query("DELETE FROM rate_limit_entries WHERE key LIKE $1", [`${this.prefix}%`]);
  }
}