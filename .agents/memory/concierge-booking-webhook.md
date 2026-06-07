---
name: Concierge booking shares the subscription webhook
description: Why paid 1-on-1 bookings flow through the same Stripe handler as subscriptions, and the trap that causes mislabeled receipts.
---

# Concierge bookings ride the subscription `checkout.session.completed`

Paid concierge 1-on-1 bookings and Pro/Elite subscriptions both arrive at the
SAME Stripe webhook `checkout.session.completed` handler in `server/index.ts`.

**The trap:** the subscription branch picks a plan name purely from
`amount_total`. A $19/$49 booking would silently render as a "Pro Plan" receipt
with no admin notification.

**How to apply:** branch on `session.metadata.kind === 'concierge_session'`
FIRST and route to the booking path (`server/lib/bookingEmail.ts`), skipping the
amount-based subscription receipt. Booking metadata carries `kind`, `userId`,
`bookingId` (set in `routes.ts` `/api/concierge/book`).

**Idempotency:** Stripe retries deliver the same event more than once. Win a
single `PENDING→confirmed` transition (`UPDATE ... WHERE status != 'confirmed'
RETURNING id`) and only email when you won the row, or retries double-send.

**Also:** the FREE Elite booking path never hits Stripe, so its emails must be
fired from `routes.ts` directly — the webhook only covers paid bookings.
