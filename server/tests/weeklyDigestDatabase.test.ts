import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { initializeWeeklyDigestTables, publishWeeklyDigestOnce } from "../lib/weeklyDigestStore";
import { deliverWeeklyDigest } from "../lib/weeklyDigestDelivery";
import { runWeeklyDigestTick } from "../lib/weeklyDigestScheduler";
import { DigestError } from "../lib/weeklyDigestPolicy";

// Opt in locally with WEEKLY_DB_INTEGRATION=1. Uses a disposable schema, never
// app tables, never production, and mock mail only. CI still runs pure tests.
test("PostgreSQL scheduling, restarts, concurrent replicas and delivery failures",
  { skip: process.env.WEEKLY_DB_INTEGRATION !== "1" }, async t => {
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(!/railway|rlwy/i.test(url.hostname), "Never run test fixtures on Railway");
    const schema = `weekly_test_${randomUUID().replaceAll("-", "")}`;
    const control = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    await control.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString: process.env.DATABASE_URL, ssl: false as const, options: `-c search_path=${schema}`, max: 8 };
    const db = new pg.Pool(config);
    const replica = new pg.Pool(config);
    const now = new Date("2026-11-21T15:00:00Z");
    let mailRequests = 0;
    const receipts = new Map<string, { id: string; body: string }>();
    const mockMailer = {
      async send(payload: any, options: { idempotencyKey: string }) {
        mailRequests++;
        const prior = receipts.get(options.idempotencyKey);
        if (prior) {
          assert.equal(JSON.stringify(payload), prior.body, "provider retry body must be unchanged");
          return { data: { id: prior.id } };
        }
        const receipt = { id: `fixture-${receipts.size + 1}`, body: JSON.stringify(payload) };
        receipts.set(options.idempotencyKey, receipt);
        return { data: { id: receipt.id } };
      },
    };
    const render = () => "<p>Verified fixture update</p>";
    const reset = async () => {
      await db.query("TRUNCATE weekly_update_deliveries,weekly_update_sources,weekly_digest_runs,weekly_updates,update_log_entries,subscribers RESTART IDENTITY CASCADE");
      mailRequests = 0;
      receipts.clear();
    };
    const makeUpdate = async () => {
      const row = (await db.query(`INSERT INTO weekly_updates(title,summary,items,created_at)
        VALUES ('Fixture update','Fixture summary','[]',$1) RETURNING *`, [now])).rows[0];
      await db.query("INSERT INTO weekly_update_sources(update_id,log_ids) VALUES($1,'{1}')", [row.id]);
      return { id: row.id, title: row.title, summary: row.summary, items: [], createdAt: now, emailSentAt: null } as any;
    };
    try {
      await db.query(`
        CREATE TABLE weekly_updates(id SERIAL PRIMARY KEY,title TEXT,summary TEXT,items JSONB,
          version TEXT,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),email_sent_at TIMESTAMPTZ,email_recipient_count INTEGER DEFAULT 0);
        CREATE TABLE subscribers(email TEXT,active BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE update_log_entries(id SERIAL PRIMARY KEY,included_in_update_id INTEGER);
      `);
      const client = await db.connect();
      try { await initializeWeeklyDigestTables(client); } finally { client.release(); }

      await t.test("concurrent workers generate and send once; a new process resumes the completed week", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        let generations = 0;
        const options = {
          db, now, latest: async () => null,
          generate: async () => { generations++; await new Promise(r => setTimeout(r, 30)); return makeUpdate(); },
          send: async (id: number) => {
            try { return await deliverWeeklyDigest(db, { ...(await db.query("SELECT * FROM weekly_updates WHERE id=$1", [id])).rows[0], id } as any, render, async () => mockMailer, () => now); }
            catch (error: any) { console.error("Fixture delivery error:", error.message); throw error; }
          },
        };
        const results = await Promise.all([runWeeklyDigestTick(options), runWeeklyDigestTick({ ...options, db: replica })]);
        assert.ok(results.some(r => r.status === "complete"), JSON.stringify(results));
        assert.equal(generations, 1);
        assert.equal(receipts.size, 1);
        assert.equal((await runWeeklyDigestTick({ ...options, db: replica })).status, "complete");
        assert.equal(generations, 1);
        assert.equal(mailRequests, 1);
      });

      await t.test("failed GitHub or AI generation remains retryable and never looks like no changes", async () => {
        for (const stage of ["github", "ai", "compliance"]) {
          await reset();
          let attempts = 0;
          const options = { db, now, latest: async () => null,
            generate: async () => { attempts++; throw new DigestError(stage, "FIXTURE_UNAVAILABLE"); },
            send: async () => { throw new Error("Must not send"); } };
          assert.equal((await runWeeklyDigestTick(options)).status, "retry");
          assert.equal((await db.query("SELECT error_stage FROM weekly_digest_runs")).rows[0].error_stage, stage);
          assert.equal((await runWeeklyDigestTick({ ...options, db: replica })).status, "retry_wait");
          await runWeeklyDigestTick({ ...options, db: replica, now: new Date(now.getTime() + 6 * 60_000) });
          assert.equal(attempts, 2);
          assert.equal((await db.query("SELECT count(*)::int n FROM weekly_updates")).rows[0].n, 0);
        }
      });

      await t.test("a genuine no-change week is durable across restarts, but does not suppress the next week", async () => {
        await reset();
        let generations = 0;
        const options = { db, now, latest: async () => null,
          generate: async () => { generations++; return null; },
          send: async () => { throw new Error("Must not send"); } };
        assert.equal((await runWeeklyDigestTick(options)).status, "no_changes");
        assert.equal((await runWeeklyDigestTick({ ...options, db: replica })).status, "no_changes");
        assert.equal(generations, 1);
        await runWeeklyDigestTick({ ...options, now: new Date("2026-11-28T15:00:00Z") });
        assert.equal(generations, 2);
      });

      await t.test("a restart after publication resumes the attached update without generating another", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        const update = await makeUpdate();
        await db.query("INSERT INTO weekly_digest_runs(week_key,status,update_id,attempts) VALUES('2026-11-21','running',$1,1)", [update.id]);
        const fail = async () => { throw new Error("Must not regenerate a published update"); };
        const result = await runWeeklyDigestTick({
          db: replica, now: new Date(now.getTime() + 6 * 60_000), latest: fail, generate: fail,
          send: async () => deliverWeeklyDigest(replica, update, render, async () => mockMailer, () => now),
        });
        assert.equal(result.status, "complete");
        assert.equal(receipts.size, 1);
        assert.equal((await db.query("SELECT count(*)::int n FROM weekly_updates")).rows[0].n, 1);
      });

      await t.test("publication is fenced even when two processes reach it without the advisory lock", async () => {
        await reset();
        await db.query("INSERT INTO weekly_digest_runs(week_key,status) VALUES('2026-11-21','running')");
        let publications = 0;
        const save = async (client: any) => {
          publications++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return (await client.query("INSERT INTO weekly_updates(title) VALUES('One publication') RETURNING *")).rows[0];
        };
        const [a, b] = await Promise.all([
          publishWeeklyDigestOnce(db, "2026-11-21", save, "winner"),
          publishWeeklyDigestOnce(replica, "2026-11-21", save, "other"),
        ]);
        assert.equal(a.id, b.id);
        assert.equal(publications, 1);
        assert.equal((await db.query("SELECT count(*)::int n FROM weekly_updates")).rows[0].n, 1);
        const attached = (await db.query("SELECT update_id,source_head_sha FROM weekly_digest_runs")).rows[0];
        assert.equal(attached.update_id, a.id);
        assert.ok(["winner", "other"].includes(attached.source_head_sha));
      });

      await t.test("partial sends retry only failures; duplicate addresses collapse and unrelated changes stay pending", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES(' One@example.test '),('one@EXAMPLE.test'),('two@example.test')");
        await db.query("INSERT INTO update_log_entries DEFAULT VALUES");
        const update = await makeUpdate();
        const failing = { send: async (payload: any, options: any) => payload.to === "two@example.test"
          ? { error: { statusCode: 429 } } : mockMailer.send(payload, options) };
        const first = await deliverWeeklyDigest(db, update, render, async () => failing, () => now);
        assert.equal(first.total, 2);
        assert.equal(first.sent, 1);
        assert.equal(first.complete, false);
        assert.equal((await db.query("SELECT email_sent_at FROM weekly_updates")).rows[0].email_sent_at, null);
        assert.equal((await db.query("SELECT included_in_update_id FROM update_log_entries")).rows[0].included_in_update_id, null);
        await db.query("INSERT INTO update_log_entries DEFAULT VALUES");
        const second = await deliverWeeklyDigest(replica, update, render, async () => mockMailer, () => new Date(now.getTime() + 6 * 60_000));
        assert.equal(second.complete, true);
        assert.equal(second.sent, 2);
        assert.equal(mailRequests, 2);
        assert.deepEqual((await db.query("SELECT included_in_update_id FROM update_log_entries ORDER BY id")).rows.map(r => r.included_in_update_id), [update.id, null]);
        assert.equal((await deliverWeeklyDigest(db, update, render, async () => mockMailer)).alreadySent, true);
        assert.equal(mailRequests, 2);
      });

      await t.test("provider acceptance followed by a lost database receipt replays the same key and payload safely", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        const update = await makeUpdate();
        let fail = true;
        const interrupted = new Proxy(db, {
          get(target, property) {
            if (property === "connect") return async () => {
              const real = await target.connect();
              return new Proxy(real, {
                get(client, field) {
                  if (field === "query") return (...args: any[]) => {
                    if (fail && String(args[0]).includes("SET status='accepted'")) {
                      fail = false; throw new Error("Simulated crash before receipt persistence");
                    }
                    return (client.query as any)(...args);
                  };
                  const value = (client as any)[field];
                  return typeof value === "function" ? value.bind(client) : value;
                },
              });
            };
            const value = (target as any)[property];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await assert.rejects(deliverWeeklyDigest(interrupted, update, render, async () => mockMailer, () => now));
        assert.equal(receipts.size, 1);
        const retried = await deliverWeeklyDigest(replica, update, () => "<p>Changed renderer after deploy</p>", async () => mockMailer, () => new Date(now.getTime() + 6 * 60_000));
        assert.equal(retried.complete, true);
        assert.equal(mailRequests, 2); // Two HTTP requests, ONE provider email.
        assert.equal(receipts.size, 1);
      });

      await t.test("unsubscribe before retry wins; newly subscribed addresses do not join an existing snapshot", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        const update = await makeUpdate();
        await assert.rejects(deliverWeeklyDigest(db, update, render, async () => { throw new Error("No client"); }, () => now), /email_configuration/);
        await db.query("UPDATE subscribers SET active=false");
        await db.query("INSERT INTO subscribers(email) VALUES('new@example.test')");
        const result = await deliverWeeklyDigest(db, update, render, async () => mockMailer, () => now);
        assert.equal(result.complete, true);
        assert.equal(result.skipped, 1);
        assert.equal(result.total, 1);
        assert.equal(mailRequests, 0);
      });

      await t.test("ambiguous requests past safe provider retention require review, never a blind resend", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        const update = await makeUpdate();
        const unknown = { send: async () => { throw new Error("Network lost after possible acceptance"); } };
        await deliverWeeklyDigest(db, update, render, async () => unknown, () => now);
        const result = await deliverWeeklyDigest(replica, update, render, async () => mockMailer,
          () => new Date(now.getTime() + 23.5 * 3600_000));
        assert.equal(result.complete, false);
        assert.equal(result.uncertain, 1);
        assert.equal(mailRequests, 0);
        assert.equal((await db.query("SELECT email_sent_at FROM weekly_updates")).rows[0].email_sent_at, null);
      });

      await t.test("concurrent manual sends cannot duplicate a recipient", async () => {
        await reset();
        await db.query("INSERT INTO subscribers(email) VALUES('one@example.test')");
        const update = await makeUpdate();
        await Promise.all([
          deliverWeeklyDigest(db, update, render, async () => mockMailer, () => now),
          deliverWeeklyDigest(replica, update, render, async () => mockMailer, () => now),
        ]);
        assert.equal(receipts.size, 1);
        assert.equal(mailRequests, 1);
      });
    } finally {
      await db.end();
      await replica.end();
      await control.query(`DROP SCHEMA ${schema} CASCADE`);
      await control.end();
    }
  });
