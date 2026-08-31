import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRateLimitStore, type RateLimitQueryable } from "./postgresRateLimitStore";

test("rate store uses an atomic expiry-aware upsert with a namespaced key", async () => {
  const calls: Array<{ query: string; values?: unknown[] }> = [];
  const client: RateLimitQueryable = {
    async query(query, values) {
      calls.push({ query, values });
      return { rows: [{ hits: 2, reset_at: new Date("2030-01-01T00:00:00Z") }] };
    },
  };
  const store = new PostgresRateLimitStore("auth", client);
  store.init({ windowMs: 60_000 } as any);
  const result = await store.increment("203.0.113.1");
  assert.equal(result.totalHits, 2);
  assert.equal(calls[0].values?.[0], "pg:auth:203.0.113.1");
  assert.match(calls[0].query, /ON CONFLICT/);
  assert.match(calls[0].query, /reset_at <= NOW/);
});