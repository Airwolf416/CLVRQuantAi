import { createHash, randomUUID } from "node:crypto";

export const BRIEF_RECIPIENT_LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS daily_brief_recipient_deliveries (
    recipient_key TEXT NOT NULL,
    local_date DATE NOT NULL,
    attempt_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','sent','retryable','uncertain')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_id TEXT,
    PRIMARY KEY (recipient_key, local_date)
  )
`;

type QueryResult = { rows: any[]; rowCount: number | null };
type Query = (sql: string, values?: any[]) => Promise<QueryResult>;
export type BriefLedgerDatabase = {
  query: Query;
  connect(): Promise<{ query: Query; release(): void }>;
};
type Claim = { recipientKey: string; localDate: string; attemptId: string };
type DeliveryState = "sent" | "retryable" | "uncertain";
export type BriefDeliveryLedger = {
  claim(email: string, localDate: string): Promise<Claim | null>;
  finish(claim: Claim, status: DeliveryState, providerId?: string): Promise<void>;
};

export function createBriefDeliveryLedger(db: BriefLedgerDatabase): BriefDeliveryLedger {
  return {
    async claim(email, localDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("Invalid brief delivery date");
      const recipientKey = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
      const claim = { recipientKey, localDate, attemptId: randomUUID() };
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // Serialize claims for this recipient across ALL local dates/zones.
        // The transaction ends before the provider call; pending is the durable lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [recipientKey]);
        const blocked = await client.query(`
          SELECT 1 FROM daily_brief_recipient_deliveries
          WHERE recipient_key=$1 AND status IN ('pending','sent','uncertain')
            AND (local_date=$2::date OR updated_at > NOW() - INTERVAL '20 hours')
          LIMIT 1
        `, [recipientKey, localDate]);
        if (blocked.rows.length) {
          await client.query("COMMIT");
          return null;
        }
        const inserted = await client.query(`
          INSERT INTO daily_brief_recipient_deliveries
            (recipient_key,local_date,attempt_id,status)
          VALUES ($1,$2::date,$3,'pending')
          ON CONFLICT (recipient_key,local_date) DO UPDATE
            SET attempt_id=EXCLUDED.attempt_id,status='pending',updated_at=NOW(),provider_id=NULL
            WHERE daily_brief_recipient_deliveries.status='retryable'
          RETURNING recipient_key
        `, [recipientKey, localDate, claim.attemptId]);
        await client.query("COMMIT");
        return inserted.rows.length ? claim : null;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
        throw error; // No provider call is allowed if the ledger is unavailable.
      } finally {
        client.release();
      }
    },
    async finish(claim, status, providerId) {
      const result = await db.query(`
        UPDATE daily_brief_recipient_deliveries
        SET status=$4,provider_id=$5,updated_at=NOW()
        WHERE recipient_key=$1 AND local_date=$2::date AND attempt_id=$3 AND status='pending'
      `, [claim.recipientKey, claim.localDate, claim.attemptId, status, providerId || null]);
      if (result.rowCount !== 1) throw new Error("Brief delivery claim was not finalized");
    },
  };
}

// Only explicit rejection responses make another attempt safe. A timeout,
// connection error, server error, or missing acknowledgement might mean the
// provider accepted the email: retain the claim instead of sending it twice.
const DEFINITE_REJECTIONS = new Set([
  "missing_required_field", "invalid_access", "invalid_parameter", "invalid_region",
  "rate_limit_exceeded", "missing_api_key", "invalid_api_Key", "invalid_from_address",
  "validation_error", "not_found", "method_not_allowed",
]);
type ProviderResponse = { data?: { id?: string } | null; error?: { name?: string; message?: string } | null };
export type BriefDeliveryResult = {
  status: DeliveryState | "skipped";
  providerId?: string;
  reason?: string;
};

export async function deliverBriefOnce(
  ledger: BriefDeliveryLedger,
  email: string,
  localDate: string,
  send: () => Promise<ProviderResponse>,
): Promise<BriefDeliveryResult> {
  const claim = await ledger.claim(email, localDate);
  if (!claim) return { status: "skipped", reason: "Recipient already sent, claimed, or awaiting delivery confirmation" };
  let result: BriefDeliveryResult;
  try {
    const response = await send();
    if (response.error) {
      const name = response.error.name || "unknown_provider_error";
      result = { status: DEFINITE_REJECTIONS.has(name) ? "retryable" : "uncertain", reason: name };
    } else if (response.data?.id) {
      result = { status: "sent", providerId: response.data.id };
    } else {
      result = { status: "uncertain", reason: "Provider did not return an email acknowledgement" };
    }
  } catch {
    result = { status: "uncertain", reason: "Transport failed; delivery may have been accepted" };
  }
  try {
    await ledger.finish(claim, result.status as DeliveryState, result.providerId);
  } catch {
    // The durable pending claim still blocks a repeat even if the status
    // update fails after the provider accepted the message.
    console.error("[daily-brief] Recipient delivery ledger finalization failed; claim retained");
  }
  return result;
}
