---
name: Booking confirmation email at-most-once claim
description: Why finalizeBooking stamps then conditionally releases emails_sent_at, and how the paid path must always re-finalize.
---

# Booking confirmation email — claim-and-release idempotency

`finalizeBooking()` (server/lib/bookingEmail.ts) guards against duplicate confirmation
emails with a conditional claim: `UPDATE concierge_bookings SET emails_sent_at=NOW()
WHERE id=? AND emails_sent_at IS NULL RETURNING id` — only the row that wins the claim
sends. After sending, it RELEASES the claim (`SET emails_sent_at=NULL`) **only** when the
user confirmation email actually failed (`userOk === false` and a user email exists).
Admin-email failure does NOT release. Calendar is fail-open and never releases the claim.

`handlePaidConciergeBooking()` must NOT early-return when the booking is already
`confirmed`; it always falls through to `finalizeBooking()`. finalize is itself
idempotent via the claim, so a Stripe webhook re-delivery is a no-op on prior success
but re-sends if the first attempt's user email failed.

**Why:** stamping `emails_sent_at` *before* side effects (the original design) permanently
dropped the user's confirmation email on any transient Resend failure — the row looked
"already sent" forever and no retry could fire. Releasing on failure closes that gap
without a heavy retry state machine.

**How to apply:** any at-most-once side effect keyed on a "done" timestamp must release
that timestamp when the *critical* side effect fails, and the upstream caller (webhook
handler) must re-invoke the idempotent finalizer rather than short-circuiting on status.
Duplicate calendar events are avoided because `createCalendarEvent()` reuses a persisted
`calendar_event_id`/`meet_link`.
