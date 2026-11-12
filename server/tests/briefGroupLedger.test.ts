import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRIEF_GROUP_KEY_MIGRATION, createBriefGroupLedger, isTerminalBriefAttempt } from "../lib/briefGroupLedger";

test("migration widens legacy keys without deleting delivery history or uniqueness", () => {
  assert.match(BRIEF_GROUP_KEY_MIGRATION, /character_maximum_length IS NOT NULL/);
  assert.match(BRIEF_GROUP_KEY_MIGRATION, /ALTER COLUMN date_key TYPE VARCHAR;/);
  assert.doesNotMatch(BRIEF_GROUP_KEY_MIGRATION, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  const startup = readFileSync("server/initDb.ts", "utf8");
  assert.ok(startup.indexOf("await client.query(BRIEF_GROUP_KEY_MIGRATION)") >
    startup.indexOf("CREATE TABLE IF NOT EXISTS daily_briefs_log"));
});

test("group lookup distinguishes absent, existing and failed reads", async () => {
  const absent = createBriefGroupLedger({ query: async () => ({ rows: [], rowCount: 0 }) });
  const existing = createBriefGroupLedger({ query: async () => ({ rows: [{}], rowCount: 1 }) });
  const failed = createBriefGroupLedger({ query: async () => { throw new Error("database unavailable"); } });
  assert.equal(await absent.has("local:America/Toronto:2026-11-12"), false);
  assert.equal(await existing.has("local:America/Toronto:2026-11-12"), true);
  await assert.rejects(failed.has("key"), /database unavailable/);
});

test("a length-limit failure is never reported as an already-claimed group", async () => {
  const failed = createBriefGroupLedger({ query: async () => {
    throw new Error("value too long for type character varying(10)");
  } });
  await assert.rejects(failed.claim("local:America/Toronto:2026-11-12"), /value too long/);
});

test("atomic group claims remain parameterized and unique across replicas", async () => {
  const keys = new Set<string>();
  const ledger = createBriefGroupLedger({ query: async (sql, values) => {
    assert.match(sql, /ON CONFLICT \(date_key\) DO NOTHING/);
    assert.doesNotMatch(sql, /America\/Toronto/);
    const key = values![0];
    const inserted = !keys.has(key);
    keys.add(key);
    return { rows: inserted ? [{ date_key: key }] : [], rowCount: inserted ? 1 : 0 };
  } });
  const results = await Promise.all(Array.from({ length: 10 }, () => ledger.claim("local:America/Toronto:2026-11-12")));
  assert.equal(results.filter(Boolean).length, 1);
});

test("pre-send failures stay retryable, while queued or successful attempts pause", () => {
  assert.equal(isTerminalBriefAttempt({ errors: ["Delivery record unavailable"] }), false);
  assert.equal(isTerminalBriefAttempt({ errors: [] }), true);
  assert.equal(isTerminalBriefAttempt(null), true);
  const daily = readFileSync("server/dailyBrief.ts", "utf8");
  const worker = readFileSync("server/workers/notifications.ts", "utf8");
  assert.match(daily, /isTerminalBriefAttempt\(queued\)/);
  assert.match(worker, /if \(result\.errors\.length > 0\)/);
});
