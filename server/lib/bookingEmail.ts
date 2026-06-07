import { getUncachableResendClient } from "../resendClient";
import { db } from "../db";
import { sql } from "drizzle-orm";

// Booking email input. The concierge_bookings record stores slot_date
// (YYYY-MM-DD), slot_time (HH:MM) and timezone separately, so callers pass
// those rather than a single ISO timestamp.
export type BookingEmailInput = {
  bookingId: string;
  userName: string;
  userEmail: string;
  tier: string; // "elite" | "pro" | "free"/guest
  paid: boolean; // true if a Stripe payment was required
  priceDisplay: string; // e.g. "Free (Elite)" or "$49.00"
  slotDate?: string; // YYYY-MM-DD
  slotTime?: string; // HH:MM
  timezone?: string; // default America/Toronto
  meetLink?: string | null; // Google Meet URL if created
};

const ADMIN = "support@clvrquantai.com";

function formatWhen(b: BookingEmailInput): string {
  const tz = b.timezone || "America/Toronto";
  if (b.slotDate && b.slotTime) {
    try {
      const d = new Date(`${b.slotDate}T00:00:00`);
      const datePart = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${datePart} at ${b.slotTime} (${tz})`;
    } catch {
      return `${b.slotDate} ${b.slotTime} (${tz})`;
    }
  }
  return "(time to be confirmed)";
}

// Sends BOTH the admin notification (→ support@) and the user confirmation.
// Inspects Resend's { data, error } return — Resend does NOT throw on a
// rejected send, so failures must be read off the payload — and logs loudly.
// Never throws: each send is independently guarded so one failure can't block
// the other or the booking flow that called it.
export async function sendBookingEmails(b: BookingEmailInput): Promise<void> {
  const when = formatWhen(b);

  let resend: any, fromEmail: string;
  try {
    const c = await getUncachableResendClient();
    resend = c.client;
    fromEmail = c.fromEmail;
  } catch (e: any) {
    console.error(`[booking-email] Resend client unavailable (RESEND_API_KEY?): ${e?.message}`);
    return;
  }

  const meetRow = b.meetLink
    ? `<p style="font-size:13px;color:#6b7fa8;line-height:1.8">Google Meet: <a href="${b.meetLink}" style="color:#c9a84c">${b.meetLink}</a></p>`
    : "";

  // ── 1. Admin notification → support@ ──────────────────────────────────
  try {
    const resp = await resend.emails.send({
      from: fromEmail,
      to: ADMIN,
      replyTo: b.userEmail || ADMIN,
      subject: `New 1-on-1 booking — ${b.userName} (${b.tier.toUpperCase()})`,
      text: `New booking ${b.bookingId}\nName: ${b.userName}\nEmail: ${b.userEmail}\nTier: ${b.tier}\nPaid: ${b.paid ? "yes" : "no"} (${b.priceDisplay})\nWhen: ${when}\nMeet: ${b.meetLink || "(pending)"}`,
      html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
        <div style="text-align:center;margin-bottom:20px"><div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#e8c96d">CLVRQuant</div></div>
        <div style="border-top:1px solid #141e35;padding-top:18px">
          <p style="font-size:15px;color:#f0f4ff">New 1-on-1 booking</p>
          <p style="font-size:13px;color:#6b7fa8;line-height:1.9">
            <strong style="color:#f0f4ff">Name:</strong> ${b.userName}<br>
            <strong style="color:#f0f4ff">Email:</strong> ${b.userEmail}<br>
            <strong style="color:#f0f4ff">Tier:</strong> ${b.tier}<br>
            <strong style="color:#f0f4ff">Paid:</strong> ${b.paid ? "Yes" : "No"} — ${b.priceDisplay}<br>
            <strong style="color:#f0f4ff">When:</strong> ${when}
          </p>${meetRow}
          <p style="font-size:11px;color:#4a5d80">Booking ID: ${b.bookingId}</p>
        </div></div>`,
    });
    if ((resp as any)?.error) {
      console.error(`[booking-email] ADMIN send rejected:`, JSON.stringify((resp as any).error));
    } else {
      console.log(`[booking-email] admin notified for booking ${b.bookingId} (id=${(resp as any)?.data?.id})`);
    }
  } catch (e: any) {
    console.error(`[booking-email] ADMIN send threw: ${e?.message}`);
  }

  // ── 2. User confirmation ──────────────────────────────────────────────
  if (!b.userEmail) {
    console.error(`[booking-email] no user email for booking ${b.bookingId} — skipping user confirmation`);
    return;
  }
  try {
    const resp = await resend.emails.send({
      from: fromEmail,
      to: b.userEmail,
      replyTo: ADMIN,
      subject: `Your CLVRQuant 1-on-1 is booked — ${when}`,
      text: `Hi ${b.userName},\n\nYour 1-on-1 platform walkthrough is confirmed for ${when}.\n${b.meetLink ? `Join: ${b.meetLink}\n` : ""}\nThis session is educational only — a live walkthrough of the platform, not financial advice.\n\nQuestions? support@clvrquantai.com\n\n© 2026 CLVRQuant`,
      html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
        <div style="text-align:center;margin-bottom:20px"><div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d">CLVRQuant</div></div>
        <div style="border-top:1px solid #141e35;padding-top:20px">
          <p style="font-size:14px;color:#f0f4ff">Hi ${b.userName},</p>
          <p style="font-size:13px;color:#6b7fa8;line-height:1.8">Your 1-on-1 platform walkthrough is <strong style="color:#e8c96d">confirmed</strong> for <strong style="color:#f0f4ff">${when}</strong>.</p>
          ${meetRow}
          <p style="font-size:12px;color:#6b7fa8;line-height:1.8">This session is educational only — a live walkthrough of the platform's tools, not financial advice.</p>
          <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">Questions? <a href="mailto:support@clvrquantai.com" style="color:#4a5d80;text-decoration:none">support@clvrquantai.com</a></p>
        </div></div>`,
    });
    if ((resp as any)?.error) {
      console.error(`[booking-email] USER send rejected (${b.userEmail}):`, JSON.stringify((resp as any).error));
    } else {
      console.log(`[booking-email] user confirmed ${b.userEmail} for booking ${b.bookingId}`);
    }
  } catch (e: any) {
    console.error(`[booking-email] USER send threw: ${e?.message}`);
  }
}

// Called from the Stripe webhook on checkout.session.completed when
// session.metadata.kind === "concierge_session". Loads the booking, wins a
// single PENDING→confirmed transition (idempotent against Stripe retries),
// then sends both booking emails. Never throws.
export async function handlePaidConciergeBooking(session: any): Promise<void> {
  const bookingId = session?.metadata?.bookingId;
  if (!bookingId) {
    console.error("[booking-email] concierge_session webhook missing bookingId metadata");
    return;
  }

  let booking: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT b.id, b.slot_date, b.slot_time, b.timezone, b.tier, b.price_usd, b.status,
             u.email AS user_email, u.name AS user_name
      FROM concierge_bookings b
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ${bookingId}
      LIMIT 1`);
    const rows = Array.isArray(r) ? r : (r?.rows || []);
    booking = rows?.[0] || null;
  } catch (e: any) {
    console.error(`[booking-email] failed to load booking ${bookingId}: ${e?.message}`);
  }
  if (!booking) {
    console.error(`[booking-email] booking ${bookingId} not found — skipping`);
    return;
  }

  // Idempotent claim: only the first webhook delivery wins the transition and
  // therefore sends the emails. Stripe retries (duplicate deliveries) no-op.
  let won = false;
  try {
    const u: any = await db.execute(sql`
      UPDATE concierge_bookings SET status = 'confirmed'
      WHERE id = ${bookingId} AND status != 'confirmed'
      RETURNING id`);
    const urows = Array.isArray(u) ? u : (u?.rows || []);
    won = urows.length > 0;
  } catch (e: any) {
    console.error(`[booking-email] failed to confirm booking ${bookingId}: ${e?.message}`);
    won = true; // fail-open: still send once rather than drop the confirmation
  }
  if (!won) {
    console.log(`[booking-email] booking ${bookingId} already confirmed — skipping duplicate emails`);
    return;
  }

  const amountCents = session.amount_total || 0;
  const priceDisplay = amountCents
    ? `$${(amountCents / 100).toFixed(2)}`
    : (booking.price_usd ? `$${booking.price_usd}` : "Paid");

  await sendBookingEmails({
    bookingId: String(bookingId),
    userName: session.customer_details?.name || booking.user_name || "Trader",
    userEmail: booking.user_email || session.customer_details?.email || "",
    tier: booking.tier || "—",
    paid: true,
    priceDisplay,
    slotDate: booking.slot_date,
    slotTime: booking.slot_time,
    timezone: booking.timezone || "America/Toronto",
    meetLink: null,
  });
}
