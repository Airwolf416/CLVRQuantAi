import { getUncachableResendClient } from "../resendClient";
import { getUncachableGoogleCalendarClient } from "../googleCalendar";
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
export async function sendBookingEmails(b: BookingEmailInput): Promise<{ adminOk: boolean; userOk: boolean }> {
  const when = formatWhen(b);
  let adminOk = false;
  let userOk = false;

  let resend: any, fromEmail: string;
  try {
    const c = await getUncachableResendClient();
    resend = c.client;
    fromEmail = c.fromEmail;
  } catch (e: any) {
    console.error(`[booking-email] Resend client unavailable (RESEND_API_KEY?): ${e?.message}`);
    return { adminOk, userOk };
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
      adminOk = true;
      console.log(`[booking-email] admin notified for booking ${b.bookingId} (id=${(resp as any)?.data?.id})`);
    }
  } catch (e: any) {
    console.error(`[booking-email] ADMIN send threw: ${e?.message}`);
  }

  // ── 2. User confirmation ──────────────────────────────────────────────
  if (!b.userEmail) {
    console.error(`[booking-email] no user email for booking ${b.bookingId} — skipping user confirmation`);
    return { adminOk, userOk };
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
      userOk = true;
      console.log(`[booking-email] user confirmed ${b.userEmail} for booking ${b.bookingId}`);
    }
  } catch (e: any) {
    console.error(`[booking-email] USER send threw: ${e?.message}`);
  }
  return { adminOk, userOk };
}

const ADMIN_CALENDAR = process.env.SUPPORT_CALENDAR_ID || "primary";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Builds the {start,end} the Google event needs from the booking's separate
// slot_date / slot_time / timezone fields. We pass naive wall-clock strings plus
// the timeZone so Google interprets them in that zone (DST-safe); end = +30 min.
function buildEventWindow(b: any): { startStr: string; endStr: string; tz: string } | null {
  const date = String(b.slot_date || "");
  const time = String(b.slot_time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const end = new Date(base.getTime() + 30 * 60000);
  const startStr = `${date}T${time}:00`;
  const endStr = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}T${pad2(end.getUTCHours())}:${pad2(end.getUTCMinutes())}:00`;
  return { startStr, endStr, tz: b.timezone || "America/Toronto" };
}

// Creates ONE 30-min Google Calendar event (with a Meet link) on the connected
// support@ calendar, inviting the user. Idempotent at the booking level: if the
// booking already has a calendar_event_id we reuse it. Fail-open: any error
// (connector not connected, API failure) returns nulls so emails still send.
async function createCalendarEvent(
  b: any,
  paid: boolean,
  priceDisplay: string,
): Promise<{ calendarEventId: string | null; meetLink: string | null }> {
  if (b.calendar_event_id) {
    return { calendarEventId: b.calendar_event_id, meetLink: b.meet_link || null };
  }
  const win = buildEventWindow(b);
  if (!win) {
    console.error(`[booking-cal] booking ${b.id} has invalid slot date/time — skipping event`);
    return { calendarEventId: null, meetLink: null };
  }
  try {
    const cal = await getUncachableGoogleCalendarClient();
    const attendees = [b.user_email ? { email: b.user_email } : null].filter(Boolean) as { email: string }[];
    const ev: any = await cal.events.insert({
      calendarId: ADMIN_CALENDAR,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: `CLVRQuant 1-on-1 — ${b.user_name || "Trader"}`,
        description:
          `30-min platform walkthrough (educational — how to use the tools, not financial advice).\n` +
          `Tier: ${b.tier || "—"} · ${paid ? "Paid " + priceDisplay : "Free (Elite)"}\nBooking ${b.id}`,
        start: { dateTime: win.startStr, timeZone: win.tz },
        end: { dateTime: win.endStr, timeZone: win.tz },
        attendees,
        conferenceData: {
          createRequest: {
            requestId: `clvr-${b.id}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      },
    });
    const meetLink: string | null =
      ev?.data?.hangoutLink ||
      ev?.data?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
      null;
    console.log(`[booking-cal] event ${ev?.data?.id} created for booking ${b.id}, meet=${meetLink || "none"}`);
    return { calendarEventId: ev?.data?.id || null, meetLink };
  } catch (e: any) {
    console.error(`[booking-cal] calendar create failed for ${b.id} (Google auth configured?): ${e?.message}`);
    return { calendarEventId: null, meetLink: null };
  }
}

// Single idempotent finalize — called by BOTH the free Elite path and the paid
// Stripe webhook. Wins an at-most-once finalize claim via emails_sent_at, then
// creates the calendar event and sends both emails. Never throws.
export async function finalizeBooking(
  bookingId: string,
  opts: { paid: boolean; priceDisplay: string; fallbackName?: string; fallbackEmail?: string },
): Promise<void> {
  let booking: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT b.id, b.slot_date, b.slot_time, b.timezone, b.tier, b.price_usd, b.status,
             b.calendar_event_id, b.meet_link, b.emails_sent_at,
             u.email AS user_email, u.name AS user_name
      FROM concierge_bookings b
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ${bookingId}
      LIMIT 1`);
    const rows = Array.isArray(r) ? r : (r?.rows || []);
    booking = rows?.[0] || null;
  } catch (e: any) {
    console.error(`[booking] finalize: failed to load ${bookingId}: ${e?.message}`);
    return;
  }
  if (!booking) {
    console.error(`[booking] finalize: ${bookingId} not found — skipping`);
    return;
  }

  // At-most-once finalize claim. Only the call that flips emails_sent_at from
  // NULL proceeds; concurrent calls / Stripe retries no-op. Claiming BEFORE the
  // calendar+email work guarantees we never double-create or double-send.
  let won = false;
  try {
    const u: any = await db.execute(sql`
      UPDATE concierge_bookings SET emails_sent_at = NOW()
      WHERE id = ${bookingId} AND emails_sent_at IS NULL
      RETURNING id`);
    const urows = Array.isArray(u) ? u : (u?.rows || []);
    won = urows.length > 0;
  } catch (e: any) {
    console.error(`[booking] finalize: claim failed for ${bookingId}: ${e?.message}`);
    return; // do NOT fall open here — a failed claim could mean we'd double-send
  }
  if (!won) {
    console.log(`[booking] finalize: ${bookingId} already finalized — skipping`);
    return;
  }

  const userName = booking.user_name || opts.fallbackName || "Trader";
  const userEmail = booking.user_email || opts.fallbackEmail || "";

  // Calendar event (fail-open). Persist its id + meet link for reference.
  const { calendarEventId, meetLink } = await createCalendarEvent(
    { ...booking, user_name: userName, user_email: userEmail },
    opts.paid,
    opts.priceDisplay,
  );
  if (calendarEventId || meetLink) {
    try {
      await db.execute(sql`
        UPDATE concierge_bookings
        SET calendar_event_id = ${calendarEventId}, meet_link = ${meetLink}
        WHERE id = ${bookingId}`);
    } catch (e: any) {
      console.error(`[booking] finalize: failed to store calendar info for ${bookingId}: ${e?.message}`);
    }
  }

  const { userOk } = await sendBookingEmails({
    bookingId: String(bookingId),
    userName,
    userEmail,
    tier: booking.tier || "—",
    paid: opts.paid,
    priceDisplay: opts.priceDisplay,
    slotDate: booking.slot_date,
    slotTime: booking.slot_time,
    timezone: booking.timezone || "America/Toronto",
    meetLink,
  });

  // The user confirmation is the core deliverable. If it failed to send, release
  // the finalize claim so a later retry (e.g. a Stripe webhook re-delivery) can
  // re-send it. Calendar is fail-open and intentionally does NOT gate this. We
  // only release on a genuine email failure, so a successful run stays at-most-once.
  if (!userOk && userEmail) {
    try {
      await db.execute(sql`
        UPDATE concierge_bookings SET emails_sent_at = NULL
        WHERE id = ${bookingId}`);
      console.error(`[booking] finalize: user email failed for ${bookingId} — released claim for retry`);
    } catch (e: any) {
      console.error(`[booking] finalize: failed to release claim for ${bookingId}: ${e?.message}`);
    }
  }
}

// Called from the Stripe webhook on checkout.session.completed when
// session.metadata.kind === "concierge_session". Wins a single PENDING→confirmed
// transition (idempotent against Stripe retries), then runs the shared finalize
// (calendar event + emails). Never throws.
export async function handlePaidConciergeBooking(session: any): Promise<void> {
  const bookingId = session?.metadata?.bookingId;
  if (!bookingId) {
    console.error("[booking-email] concierge_session webhook missing bookingId metadata");
    return;
  }

  // Idempotent confirm: only the first delivery flips PENDING→confirmed, but we
  // ALWAYS fall through to finalize. finalize is itself at-most-once via its
  // emails_sent_at claim, so a Stripe re-delivery is a no-op when the first run
  // succeeded — yet still gets a chance to re-send if the first run's email failed.
  try {
    await db.execute(sql`
      UPDATE concierge_bookings SET status = 'confirmed'
      WHERE id = ${bookingId} AND status != 'confirmed'`);
  } catch (e: any) {
    console.error(`[booking-email] failed to confirm booking ${bookingId}: ${e?.message}`);
  }

  const amountCents = session.amount_total || 0;
  const priceDisplay = amountCents ? `$${(amountCents / 100).toFixed(2)}` : "Paid";

  await finalizeBooking(String(bookingId), {
    paid: true,
    priceDisplay,
    fallbackName: session.customer_details?.name,
    fallbackEmail: session.customer_details?.email,
  });
}
