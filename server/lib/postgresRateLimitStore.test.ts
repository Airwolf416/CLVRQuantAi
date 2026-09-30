import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRateLimitStore, isAuthMeRead, type RateLimitQueryable } from "./postgresRateLimitStore";

test("only GET /api/auth/me qualifies for the independent account-check budget", () => {
  assert.equal(isAuthMeRead({ method: "GET", path: "/api/auth/me" }), true);
  for (const req of [
    { method: "POST", path: "/api/auth/me" },
    { method: "HEAD", path: "/api/auth/me" },
    { method: "GET", path: "/api/auth/signin" },
    { method: "POST", path: "/api/auth/signin" },
    { method: "POST", path: "/api/auth/signup" },
    { method: "GET", path: "/api/auth/me/other" },
  ]) assert.equal(isAuthMeRead(req), false);
});

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