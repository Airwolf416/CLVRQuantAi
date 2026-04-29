// ── Effective tier helpers ─────────────────────────────────────────────────
// In-memory `users.tier` can drift from what the user is actually entitled
// to in two cases:
//   1. Promo-code grants where `promo_expires_at` has passed but nobody
//      has hit `getEffectiveTier()` to lazily clear it.
//   2. Stripe subscriptions that have ended (canceled / unpaid / deleted)
//      but the webhook handler missed the event.
// Email senders (daily brief, weekly update, etc.) used to read `u.tier`
// directly and ship Elite/Pro content to people who had effectively been
// downgraded. The helpers below give every email path a consistent way to
// compute the *real* tier and to repair drift in batch.
import { pool } from "../db";

const OWNER_EMAIL = "mikeclaver@gmail.com";

/**
 * Returns a SQL `CASE` expression that resolves a user's effective tier
 * inline, suitable for use inside a SELECT or JOIN. Pass the SQL alias of
 * the users table (default `u`).
 *
 * Rules (mirrors getEffectiveTier in routes.ts):
 *  - Owner email is always elite.
 *  - No matching user row (subscriber-only) → free.
 *  - Promo grant exists, has expired, and no Stripe sub backing it → free.
 *  - Otherwise the stored tier wins.
 */
export function effectiveTierSql(alias: string = "u"): string {
  return `CASE
    WHEN LOWER(${alias}.email) = '${OWNER_EMAIL}' THEN 'elite'
    WHEN ${alias}.tier IS NULL THEN 'free'
    WHEN ${alias}.promo_expires_at IS NOT NULL
         AND ${alias}.promo_expires_at < NOW()
         AND ${alias}.stripe_subscription_id IS NULL THEN 'free'
    ELSE ${alias}.tier
  END`;
}

/**
 * One-shot SQL sweep that downgrades any user whose promo grant has
 * expired and who has no active Stripe subscription. Safe to run on a
 * timer or right before broadcast emails — no-op for users already free.
 * Returns the number of rows affected.
 */
export async function recomputeExpiredPromos(): Promise<number> {
  try {
    const r = await pool.query(`
      UPDATE users
         SET tier = 'free',
             promo_code = NULL,
             promo_expires_at = NULL
       WHERE promo_expires_at IS NOT NULL
         AND promo_expires_at < NOW()
         AND stripe_subscription_id IS NULL
         AND tier <> 'free'
    `);
    const n = (r as any).rowCount || 0;
    if (n > 0) console.log(`[effectiveTier] swept ${n} expired-promo user(s) → free`);
    return n;
  } catch (e: any) {
    console.error("[effectiveTier] sweep failed:", e?.message || e);
    return 0;
  }
}

/**
 * Apply a Stripe subscription event to the matching user row. Used by the
 * webhook handler in server/index.ts. Honors cancel-at-period-end: a
 * scheduled cancellation does NOT downgrade the user — Stripe will send
 * `customer.subscription.deleted` when the period actually ends and that
 * is the event that flips them to free.
 *
 * subscriptionStatus is the Stripe enum: active, trialing, past_due,
 * canceled, unpaid, incomplete, incomplete_expired, paused.
 */
export async function applyStripeSubscriptionStatus(
  subscriptionId: string,
  subscriptionStatus: string
): Promise<{ downgraded: boolean; userId?: string }> {
  if (!subscriptionId) return { downgraded: false };
  const okStatuses = new Set(["active", "trialing", "past_due"]);
  // past_due keeps access during Stripe's 3-attempt retry grace period;
  // when retries fail Stripe transitions to `unpaid` and we downgrade.
  if (okStatuses.has(subscriptionStatus)) return { downgraded: false };
  // Anything else (canceled, unpaid, incomplete_expired, paused) means the
  // subscription is no longer entitling the user to paid features.
  try {
    const r = await pool.query(
      `UPDATE users
          SET tier = 'free',
              stripe_subscription_id = NULL
        WHERE stripe_subscription_id = $1
        RETURNING id`,
      [subscriptionId]
    );
    const userId = (r as any).rows?.[0]?.id;
    if (userId) {
      console.log(`[effectiveTier] Stripe sub ${subscriptionId} status=${subscriptionStatus} → downgraded user ${userId} to free`);
      return { downgraded: true, userId };
    }
    return { downgraded: false };
  } catch (e: any) {
    console.error(`[effectiveTier] failed to apply sub status for ${subscriptionId}:`, e?.message || e);
    return { downgraded: false };
  }
}
