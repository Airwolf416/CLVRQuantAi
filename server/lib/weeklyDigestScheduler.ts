import type { Pool } from "pg";
import type { WeeklyUpdate } from "@shared/schema";
import { DigestError, WEEKLY_RETRY_MS, saturdayDigestWindow } from "./weeklyDigestPolicy";
import { WEEK_LOCK, withDigestLock } from "./weeklyDigestStore";

export async function runWeeklyDigestTick(options: {
  db: Pool;
  now: Date;
  latest: () => Promise<WeeklyUpdate | null>;
  generate: (weekKey: string) => Promise<WeeklyUpdate | null>;
  send: (updateId: number) => Promise<{ complete: boolean; busy?: boolean; uncertain?: number }>;
}) {
  const { db, now } = options;
  const weekKey = saturdayDigestWindow(now);
  if (!weekKey) return { status: "outside_window" };
  const held = await withDigestLock(db, WEEK_LOCK, 1, async lock => {
    await lock.query("INSERT INTO weekly_digest_runs(week_key) VALUES ($1) ON CONFLICT DO NOTHING", [weekKey]);
    const run = (await lock.query("SELECT * FROM weekly_digest_runs WHERE week_key=$1", [weekKey])).rows[0];
    if (["complete", "no_changes", "needs_attention"].includes(run.status)) return { status: run.status };
    if (run.retry_after && new Date(run.retry_after) > now) return { status: "retry_wait" };
    await lock.query(`
      UPDATE weekly_digest_runs SET status='running',attempts=attempts+1,
        retry_after=$2,error_stage=NULL,error_code=NULL,updated_at=$3 WHERE week_key=$1`,
    [weekKey, new Date(now.getTime() + WEEKLY_RETRY_MS), now]);
    let stage = "generation";
    try {
      let updateId: number | null = run.update_id;
      if (!updateId) {
        const latest = await options.latest();
        if (latest && !latest.emailSentAt && now.getTime() - new Date(latest.createdAt!).getTime() < 7 * 86400_000) {
          updateId = latest.id;
          await lock.query("UPDATE weekly_digest_runs SET update_id=$2 WHERE week_key=$1", [weekKey, updateId]);
        } else {
          const generated = await options.generate(weekKey);
          if (!generated) {
            await lock.query(`
              UPDATE weekly_digest_runs SET status='no_changes',completed_at=$2,
                updated_at=$2,retry_after=NULL WHERE week_key=$1`, [weekKey, now]);
            return { status: "no_changes" };
          }
          updateId = generated.id;
          // The real generator also assigns this in its publication transaction
          // so a crash between return and this statement cannot orphan a digest.
          await lock.query("UPDATE weekly_digest_runs SET update_id=$2 WHERE week_key=$1", [weekKey, updateId]);
        }
      }
      stage = "delivery";
      const sent = await options.send(updateId);
      const status = sent.complete ? "complete" : sent.uncertain ? "needs_attention" : "retry";
      await lock.query(`
        UPDATE weekly_digest_runs SET status=$2::text,updated_at=$3::timestamptz,
          completed_at=CASE WHEN $2='complete' THEN $3::timestamptz ELSE NULL END,
          error_stage=CASE WHEN $2='complete' THEN NULL ELSE 'email' END,
          error_code=CASE WHEN $2='complete' THEN NULL ELSE $4::text END,
          retry_after=CASE WHEN $2='complete' THEN NULL ELSE retry_after END
        WHERE week_key=$1`,
      [weekKey, status, now, sent.uncertain ? "PROVIDER_RECONCILIATION_REQUIRED" : sent.busy ? "DELIVERY_BUSY" : "PARTIAL_DELIVERY"]);
      return { status };
    } catch (error) {
      const sqlState = typeof (error as any)?.code === "string" && /^[A-Z0-9]{5}$/.test((error as any).code)
        ? `DATABASE_${(error as any).code}` : "DATABASE_OR_PIPELINE_ERROR";
      const failure = error instanceof DigestError ? error : new DigestError(stage, sqlState);
      await lock.query(`
        UPDATE weekly_digest_runs SET status='retry',error_stage=$2,error_code=$3,updated_at=$4
        WHERE week_key=$1`, [weekKey, failure.stage, failure.code, now]);
      console.warn(`[weekly-update] ${weekKey} ${failure.message}; retry retained`);
      return { status: "retry", stage: failure.stage, code: failure.code };
    }
  });
  return held.acquired ? held.value : { status: "busy" };
}
