import type { Pool } from "pg";
import type { WeeklyUpdate } from "@shared/schema";
import { DELIVERY_LOCK, withDigestLock } from "./weeklyDigestStore";
import { DigestError, SAFE_PROVIDER_RETRY_MS, providerIdempotencyKey, recipientIdentity } from "./weeklyDigestPolicy";

export type DigestMailer = {
  send: (payload: any, options: { idempotencyKey: string }) => Promise<any>;
};
export type WeeklyDigestDeliveryResult = {
  sent: number; total: number; updateId: number; complete: boolean;
  skipped?: number; remaining?: number; uncertain?: number; alreadySent?: boolean; busy?: boolean;
};

export async function deliverWeeklyDigest(
  db: Pool,
  update: WeeklyUpdate,
  render: (update: WeeklyUpdate, email: string) => string,
  getMailer: () => Promise<DigestMailer>,
  now: () => Date = () => new Date(),
): Promise<WeeklyDigestDeliveryResult> {
  const held = await withDigestLock(db, DELIVERY_LOCK, update.id, async lock => {
    const prior = await lock.query("SELECT email_sent_at FROM weekly_updates WHERE id=$1", [update.id]);
    // Manual freshness overrides must never override recipient deduplication.
    if (prior.rows[0]?.email_sent_at) {
      return { sent: 0, total: 0, complete: true, alreadySent: true };
    }
    await lock.query("BEGIN");
    try {
      await lock.query("INSERT INTO weekly_update_sources(update_id) VALUES ($1) ON CONFLICT DO NOTHING", [update.id]);
      const source = (await lock.query("SELECT audience_initialized FROM weekly_update_sources WHERE update_id=$1", [update.id])).rows[0];
      if (!source.audience_initialized) {
        // Preserve the old audience: active subscribers only, not all accounts.
        const audience = (await lock.query("SELECT email FROM subscribers WHERE active=true ORDER BY created_at DESC")).rows;
        const identities = [...new Map(audience.map(s => {
          const identity = recipientIdentity(s.email);
          return [identity.key, identity] as const;
        })).values()];
        await lock.query(`
          INSERT INTO weekly_update_deliveries(update_id,recipient_key,email)
          SELECT $1,x.key,x.email FROM unnest($2::text[],$3::text[]) AS x(key,email)
          ON CONFLICT DO NOTHING`,
        [update.id, identities.map(x => x.key), identities.map(x => x.email)]);
        await lock.query("UPDATE weekly_update_sources SET audience_initialized=true WHERE update_id=$1", [update.id]);
      }
      await lock.query("COMMIT");
    } catch (error) {
      await lock.query("ROLLBACK");
      throw error;
    }

    const recipients = (await lock.query(`
      SELECT * FROM weekly_update_deliveries
      WHERE update_id=$1 AND status NOT IN ('accepted','unsubscribed')
      ORDER BY recipient_key`, [update.id])).rows;
    let mailer: DigestMailer | undefined;
    let requests = 0;
    for (const recipient of recipients) {
      // Check eligibility again on every attempt; never undo an unsubscribe.
      const eligible = await lock.query(
        "SELECT 1 FROM subscribers WHERE active=true AND lower(trim(email))=$1 LIMIT 1", [recipient.email]);
      if (!eligible.rowCount) {
        await lock.query("UPDATE weekly_update_deliveries SET status='unsubscribed',error_code=NULL WHERE update_id=$1 AND recipient_key=$2",
          [update.id, recipient.recipient_key]);
        continue;
      }
      if (recipient.first_attempt_at &&
          now().getTime() - new Date(recipient.first_attempt_at).getTime() >= SAFE_PROVIDER_RETRY_MS) {
        await lock.query("UPDATE weekly_update_deliveries SET status='uncertain',error_code='PROVIDER_RECONCILIATION_REQUIRED' WHERE update_id=$1 AND recipient_key=$2",
          [update.id, recipient.recipient_key]);
        continue; // Never risk another email after provider idempotency expires.
      }
      if (!mailer) {
        try { mailer = await getMailer(); }
        catch { throw new DigestError("email_configuration", "EMAIL_CLIENT_UNAVAILABLE"); }
      }
      const payload = recipient.payload ? JSON.parse(recipient.payload) : {
        from: "CLVRQuant <hello@clvrquantai.com>",
        to: recipient.email,
        replyTo: "noreply@clvrquantai.com",
        subject: `🆕 What's New on CLVRQuant — ${update.title}`,
        headers: {
          "List-Unsubscribe": `<https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(recipient.email)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        html: render(update, recipient.email),
      };
      if (requests++ > 0) await new Promise(resolve => setTimeout(resolve, 250));
      // Persist the EXACT payload before contacting the provider. Retries after
      // restarts/deploys must use both the same body and the same idempotency key.
      await lock.query(`
        UPDATE weekly_update_deliveries SET status='sending',payload=$3,
          first_attempt_at=COALESCE(first_attempt_at,$4),error_code=NULL
        WHERE update_id=$1 AND recipient_key=$2`,
      [update.id, recipient.recipient_key, JSON.stringify(payload), now()]);
      let response: any;
      try {
        response = await mailer.send(payload, { idempotencyKey: providerIdempotencyKey(update.id, recipient.recipient_key) });
      } catch {
        await lock.query("UPDATE weekly_update_deliveries SET error_code='EMAIL_REQUEST_UNCONFIRMED' WHERE update_id=$1 AND recipient_key=$2",
          [update.id, recipient.recipient_key]);
        continue; // Still 'sending': provider acceptance is unknown.
      }
      if (response?.error || !response?.data?.id) {
        const status = Number(response?.error?.statusCode);
        const code = status >= 400 && status <= 599 ? `EMAIL_HTTP_${status}` : "EMAIL_PROVIDER_INVALID_RESPONSE";
        await lock.query("UPDATE weekly_update_deliveries SET status='failed',error_code=$3 WHERE update_id=$1 AND recipient_key=$2",
          [update.id, recipient.recipient_key, code]);
        continue;
      }
      // Keep this OUTSIDE the provider catch. A database failure after provider
      // acceptance is ambiguous, not a known failed send.
      await lock.query(`
        UPDATE weekly_update_deliveries SET status='accepted',provider_id=$3,
          accepted_at=$4,error_code=NULL WHERE update_id=$1 AND recipient_key=$2`,
      [update.id, recipient.recipient_key, response.data.id, now()]);
    }
    const counts = (await lock.query(`
      SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status='accepted')::int AS sent,
        count(*) FILTER(WHERE status='unsubscribed')::int AS skipped,
        count(*) FILTER(WHERE status NOT IN ('accepted','unsubscribed'))::int AS remaining,
        count(*) FILTER(WHERE status='uncertain')::int AS uncertain
      FROM weekly_update_deliveries WHERE update_id=$1`, [update.id])).rows[0];
    const complete = counts.remaining === 0;
    if (complete) {
      await lock.query("BEGIN");
      try {
        await lock.query("UPDATE weekly_updates SET email_sent_at=COALESCE(email_sent_at,$2),email_recipient_count=$3 WHERE id=$1",
          [update.id, now(), counts.sent]);
        // Consume ONLY the exact curated entries used to generate this update.
        await lock.query(`
          UPDATE update_log_entries SET included_in_update_id=$1
          WHERE included_in_update_id IS NULL AND id=ANY(
            SELECT unnest(log_ids) FROM weekly_update_sources WHERE update_id=$1)`, [update.id]);
        await lock.query("COMMIT");
      } catch (error) {
        await lock.query("ROLLBACK");
        throw error;
      }
    }
    return { sent: counts.sent, total: counts.total, skipped: counts.skipped,
      remaining: counts.remaining, uncertain: counts.uncertain, complete };
  });
  return held.acquired ? { ...held.value, updateId: update.id } :
    { sent: 0, total: 0, updateId: update.id, complete: false, busy: true };
}
