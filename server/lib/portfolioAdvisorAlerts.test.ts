import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { claimPortfolioAdvisorAlert } from "./portfolioAdvisor";

test("PostgreSQL deduplicates a verified close alert and enforces its four-hour cooldown",
  { skip: process.env.PORTFOLIO_ADVISOR_DB_INTEGRATION !== "1" }, async () => {
    assert.notEqual(process.env.NODE_ENV, "production");
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(!/railway|rlwy/i.test(url.hostname), "Never run fixtures on Railway");
    const schema = `portfolio_alert_test_${randomUUID().replaceAll("-", "")}`;
    const control = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    await control.query(`CREATE SCHEMA ${schema}`);
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, options: `-c search_path=${schema}` });
    try {
      await db.query(`
        CREATE TABLE portfolio_advisor_alerts (
          id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,position_key TEXT NOT NULL,
          alert_type TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,payload JSONB NOT NULL,
          email_status TEXT NOT NULL DEFAULT 'pending',push_status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const payload = { symbol: "SIM", message: "Close fill confirmed" };
      const firstKey = "simulated-tp-fill-unique-key";
      const parallel = await Promise.all(Array.from({ length: 5 }, () =>
        claimPortfolioAdvisorAlert(db, "fixture-user", "main:SIM", "position_closed", firstKey, payload)));
      assert.equal(parallel.filter(Boolean).length, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM portfolio_advisor_alerts")).rows[0].n, 1);
      assert.equal(await claimPortfolioAdvisorAlert(db, "fixture-user", "main:SIM", "position_closed", "replayed-fill", payload), false);
      await db.query("UPDATE portfolio_advisor_alerts SET created_at=NOW()-INTERVAL '5 hours'");
      assert.equal(await claimPortfolioAdvisorAlert(db, "fixture-user", "main:SIM", "position_closed", "later-close", payload), true);
      assert.equal((await db.query("SELECT count(*)::int n FROM portfolio_advisor_alerts")).rows[0].n, 2);
    } finally {
      await db.end();
      await control.query(`DROP SCHEMA ${schema} CASCADE`);
      await control.end();
    }
  });
