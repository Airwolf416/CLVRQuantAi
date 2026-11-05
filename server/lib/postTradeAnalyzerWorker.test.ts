import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { processOne } from "./postTradeAnalyzerWorker";

test("worker diagnoses real PostgreSQL rows without asset_class and preserves resolved outcomes", { skip: !process.env.DATABASE_URL }, async () => {
  const rollback = new Error("rollback test fixtures");
  try {
    await db.transaction(async tx => {
      for (const outcome of ["TP1_HIT", "SL_HIT"]) {
        const inserted: any = await tx.execute(sql`
          INSERT INTO ai_signal_log (source,token,direction,entry_price,tp1_price,stop_loss,outcome,resolved_at,created_at)
          VALUES ('worker_test','TEST','LONG',100,110,95,${outcome},NOW()-INTERVAL '1 hour',NOW()-INTERVAL '2 hours')
          RETURNING id`);
        const id = inserted.rows[0].id;
        await tx.execute(sql`INSERT INTO post_trade_analysis(signal_id,primary_tag) VALUES(${id},'PENDING_ANALYSIS')`);
        await processOne(id, tx);
        const result: any = await tx.execute(sql`
          SELECT p.primary_tag,p.secondary_tags,p.analyzed_at,s.outcome
          FROM post_trade_analysis p JOIN ai_signal_log s ON s.id=p.signal_id WHERE s.id=${id}`);
        const row = result.rows[0];
        assert.notEqual(row.primary_tag, "PENDING_ANALYSIS");
        assert.ok(row.analyzed_at);
        assert.ok(Array.isArray(row.secondary_tags));
        assert.equal(row.outcome, outcome);
        // Reprocessing must not rewrite an already-completed diagnosis.
        await processOne(id, tx);
        const again: any = await tx.execute(sql`SELECT analyzed_at FROM post_trade_analysis WHERE signal_id=${id}`);
        assert.equal(String(again.rows[0].analyzed_at), String(row.analyzed_at));
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => { await pool.end(); });
