import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { BRIEF_RECIPIENT_LEDGER_DDL, createBriefDeliveryLedger, deliverBriefOnce, type BriefLedgerDatabase } from "./briefDelivery";

// Real PostgreSQL concurrency tests in a uniquely named disposable schema.
// No production tables or email transport are used.
test("recipient-level daily brief delivery protection", async t => {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing delivery tests in production");
  const schema = `brief_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^brief_test_[a-f0-9]+$/);
  const rewrite = (sql: string) => sql.replaceAll("daily_brief_recipient_deliveries", `"${schema}".daily_brief_recipient_deliveries`);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  t.after(async () => {
    try { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await pool.end(); }
  });
  const db: BriefLedgerDatabase = {
    query: (sql, values) => pool.query(rewrite(sql), values),
    connect: async () => {
      const client = await pool.connect();
      return { query: (sql, values) => client.query(rewrite(sql), values), release: () => client.release() };
    },
  };
  await db.query(BRIEF_RECIPIENT_LEDGER_DDL);
  const ledger = createBriefDeliveryLedger(db);
  const date = "2026-11-10";
  const accepted = async () => ({ data: { id: randomUUID() }, error: null });

  await t.test("twelve concurrent replicas claim one normalized recipient only once", async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return accepted();
    };
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      deliverBriefOnce(ledger, i % 2 ? "Concurrent@example.invalid" : " concurrent@example.invalid ", date, send)));
    assert.equal(calls, 1);
    assert.equal(results.filter(r => r.status === "sent").length, 1);
    assert.equal(results.filter(r => r.status === "skipped").length, 11);
  });

  await t.test("same-date zone changes and adjacent-date jumps cannot send twice", async () => {
    const email = "timezone@example.invalid";
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "sent");
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
    assert.equal((await deliverBriefOnce(ledger, email, "2026-11-11", accepted)).status, "skipped");
  });

  await t.test("a normal next morning, including a 23-hour DST day, is permitted", async () => {
    const id = randomUUID();
    const email = "nextday@example.invalid";
    await deliverBriefOnce(ledger, email, date, async () => ({ data: { id } }));
    await db.query("UPDATE daily_brief_recipient_deliveries SET updated_at=NOW()-INTERVAL '23 hours' WHERE provider_id=$1", [id]);
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
    assert.equal((await deliverBriefOnce(ledger, email, "2026-11-11", accepted)).status, "sent");
  });

  await t.test("explicit rate-limit rejection may retry but success is then protected", async () => {
    const email = "ratelimit@example.invalid";
    const rejected = await deliverBriefOnce(ledger, email, date, async () => ({
      data: null, error: { name: "rate_limit_exceeded", message: "Test rejection" },
    }));
    assert.equal(rejected.status, "retryable");
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "sent");
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
  });

  await t.test("partial batch retries call the provider only for the rejected recipient", async () => {
    const calls = [0, 0];
    const sendA = async () => { calls[0]++; return accepted(); };
    const sendB = async () => {
      calls[1]++;
      return calls[1] === 1 ? { error: { name: "rate_limit_exceeded" } } : accepted();
    };
    await deliverBriefOnce(ledger, "partial-a@example.invalid", date, sendA);
    await deliverBriefOnce(ledger, "partial-b@example.invalid", date, sendB);
    assert.equal((await deliverBriefOnce(ledger, "partial-a@example.invalid", date, sendA)).status, "skipped");
    assert.equal((await deliverBriefOnce(ledger, "partial-b@example.invalid", date, sendB)).status, "sent");
    assert.deepEqual(calls, [1, 2]);
  });

  for (const [label, send] of [
    ["transport timeout", async () => { throw new Error("Simulated timeout"); }],
    ["provider server error", async () => ({ error: { name: "internal_server_error" } })],
    ["missing acknowledgement", async () => ({ data: null, error: null })],
  ] as const) {
    await t.test(`${label} remains held rather than risking a duplicate`, async () => {
      const email = `${label.replaceAll(" ", "-")}@example.invalid`;
      assert.equal((await deliverBriefOnce(ledger, email, date, send)).status, "uncertain");
      assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
    });
  }

  await t.test("a ledger outage fails closed before any provider call", async () => {
    let called = false;
    const broken = { ...ledger, claim: async () => { throw new Error("Database unavailable"); } };
    await assert.rejects(deliverBriefOnce(broken, "outage@example.invalid", date, async () => {
      called = true; return accepted();
    }), /Database unavailable/);
    assert.equal(called, false);
  });

  await t.test("a database failure after acceptance retains the pending lock", async () => {
    const broken = { ...ledger, finish: async () => { throw new Error("Database unavailable after acceptance"); } };
    const email = "finalization@example.invalid";
    assert.equal((await deliverBriefOnce(broken, email, date, accepted)).status, "sent");
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
  });

  await t.test("a process crash after claim is not automatically replayed", async () => {
    const email = "crash@example.invalid";
    assert.ok(await ledger.claim(email, date));
    assert.equal((await deliverBriefOnce(ledger, email, date, accepted)).status, "skipped");
  });

  await t.test("a stale attempt cannot finalize a newer retry", async () => {
    const first = await ledger.claim("stale@example.invalid", date);
    assert.ok(first);
    await ledger.finish(first, "retryable");
    const second = await ledger.claim("stale@example.invalid", date);
    assert.ok(second);
    await assert.rejects(ledger.finish(first, "sent"), /not finalized/);
    await ledger.finish(second, "sent", "test-provider-id");
  });
});
