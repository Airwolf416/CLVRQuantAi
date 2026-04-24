// ── Notification Worker — parallel batch processing ───────────────────────────
// All outbound notifications (push, email) flow through this module.
// When Redis is available, jobs are queued via BullMQ for durable delivery.
// When Redis is absent (dev / Replit), the work runs in-process directly.
//
// Batch strategy: chunks of 50, Promise.allSettled — one failure never
// blocks the rest of the batch.

import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "../services/redis";
import { chunkArray } from "../services/ta";
import { pool } from "../db";
import webpush from "web-push";

export const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 600; // stay under Resend's 2 req/s

// ── Job data type discriminants ───────────────────────────────────────────────

export interface SignalPushJobData {
  type: "signal_push";
  title: string;
  body: string;
  tag: string;
  iconBase: string;
  subscriptions: Array<{ id: number; subscription: any }>;
}

export interface DailyBriefJobData {
  type: "daily_brief";
}

export interface PromoEmailJobData {
  type: "promo_email";
}

export interface ServiceApologyJobData {
  type: "service_apology";
}

export interface ApologyBriefJobData {
  type: "apology_brief";
}

export type NotificationJobData =
  | SignalPushJobData
  | DailyBriefJobData
  | PromoEmailJobData
  | ServiceApologyJobData
  | ApologyBriefJobData;

// ── Queue name ────────────────────────────────────────────────────────────────

export const NOTIFICATIONS_QUEUE = "clvr-notifications";

// ── Internal helper: open a queue, add a job, then close ──────────────────────

async function addToQueue(jobName: string, data: NotificationJobData): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const queue = new Queue(NOTIFICATIONS_QUEUE, { connection: r });
  await queue.add(jobName, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  });
  await queue.close();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — signal broadcast
// ─────────────────────────────────────────────────────────────────────────────

export async function broadcastSignalPushParallel(sig: any): Promise<void> {
  const pushOrigin =
    process.env.APP_URL ||
    (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
      : "https://clvrquantai.com");

  const dirLabel = sig.dir === "LONG" ? "📈 LONG" : "📉 SHORT";
  const title = `⚡ ${dirLabel}: ${sig.token} — Score ${sig.advancedScore}/100`;
  const entryFmt = sig.entry
    ? `$${typeof sig.entry === "number" ? sig.entry.toFixed(sig.entry > 100 ? 2 : 4) : sig.entry}`
    : "—";
  const body = `${sig.pctMove > 0 ? "+" : ""}${sig.pctMove}% · Entry ${entryFmt} · TP $${sig.tp1 || "—"} · SL $${sig.stopLoss || "—"}`;
  const tag = `signal-${sig.token}-${sig.dir}`.replace(/[^a-zA-Z0-9\-_.~%]/g, "-").slice(0, 32);

  try {
    const rows = await pool.query(
      `SELECT ps.id, ps.subscription FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE u.tier IN ('pro','elite') OR u.email = $1`,
      ["mikeclaver@gmail.com"]
    );
    const subscriptions: Array<{ id: number; subscription: any }> = rows.rows;
    if (subscriptions.length === 0) return;

    const jobData: SignalPushJobData = {
      type: "signal_push",
      title,
      body,
      tag,
      iconBase: pushOrigin,
      subscriptions,
    };

    const queued = await addToQueue("signal_push", jobData);
    if (!queued) {
      await sendPushBatch(subscriptions, title, body, tag, pushOrigin);
    }
    console.log(
      `[PUSH] Signal broadcast ${queued ? "queued" : "sent"}: ${sig.token} ${sig.dir} score=${sig.advancedScore} to ${subscriptions.length} subscriber(s)`
    );
  } catch (e: any) {
    console.error("[PUSH] broadcastSignalPushParallel error:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — Kronos Ensemble Flip broadcast (Elite only)
// ─────────────────────────────────────────────────────────────────────────────

export async function broadcastKronosFlipPush(
  asset: string,
  timeframe: string,
  oldSignal: string,
  newSignal: string,
  confidence: number
): Promise<void> {
  const pushOrigin =
    process.env.APP_URL ||
    (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
      : "https://clvrquantai.com");

  const title = `⏱ Kronos Flip — ${asset} ${timeframe}`;
  const body = `${oldSignal} → ${newSignal} (${confidence}% confidence)`;
  const tag = `kronos-flip-${asset}-${timeframe}`.replace(/[^a-zA-Z0-9\-_.~%]/g, "-").slice(0, 32);

  try {
    const rows = await pool.query(
      `SELECT ps.id, ps.subscription FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE u.tier = 'elite' OR u.email = $1`,
      ["mikeclaver@gmail.com"]
    );
    const subscriptions: Array<{ id: number; subscription: any }> = rows.rows;
    if (subscriptions.length === 0) return;

    const queued = await addToQueue("signal_push", {
      type: "signal_push",
      title,
      body,
      tag,
      iconBase: pushOrigin,
      subscriptions,
    } as SignalPushJobData);

    if (!queued) {
      await sendPushBatch(subscriptions, title, body, tag, pushOrigin);
    }
    console.log(`[PUSH] Kronos flip broadcast ${queued ? "queued" : "sent"}: ${asset} ${timeframe} ${oldSignal} → ${newSignal}`);
  } catch (e: any) {
    console.error("[PUSH] broadcastKronosFlipPush error:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — core batch sender
// ─────────────────────────────────────────────────────────────────────────────

export async function sendPushBatch(
  subscriptions: Array<{ id: number; subscription: any }>,
  title: string,
  body: string,
  tag: string,
  iconBase: string
): Promise<{ sent: number; failed: number; expired: number }> {
  const payload = JSON.stringify({
    title,
    body,
    tag,
    icon: `${iconBase}/icons/icon-512.png`,
    badge: `${iconBase}/icons/icon-192.png`,
    url: "/",
    timestamp: Date.now(),
  });

  const chunks = chunkArray(subscriptions, BATCH_SIZE);
  const expiredIds: number[] = [];
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map((row) =>
        webpush.sendNotification(row.subscription, payload, {
          urgency: "high",
          TTL: 3600,
          topic: tag.replace(/[^a-zA-Z0-9\-_.~%]/g, "-").slice(0, 32),
        })
      )
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        sent++;
      } else {
        const err = result.reason as any;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredIds.push(chunk[i].id);
        } else {
          failed++;
        }
      }
    }
  }

  if (expiredIds.length > 0) {
    try {
      await pool.query(`DELETE FROM push_subscriptions WHERE id = ANY($1::int[])`, [expiredIds]);
    } catch { /* non-fatal */ }
  }

  return { sent, failed, expired: expiredIds.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL — dispatch helpers
// Each enqueue* function:
//   • adds a BullMQ job when Redis is available, OR
//   • runs the underlying function directly (dev / no-Redis fallback)
// ─────────────────────────────────────────────────────────────────────────────

// Returns the structured BriefSendResult when the send runs in-process
// (no Redis, the production code path on Railway). Returns null when the
// job was handed off to BullMQ (Redis dev path) — caller should fall back
// to log-only feedback in that case.
export async function enqueueDailyBrief(): Promise<import("../dailyBrief").BriefSendResult | null> {
  const queued = await addToQueue("daily_brief", { type: "daily_brief" });
  if (!queued) {
    const { sendDailyBriefEmails } = await import("../dailyBrief");
    return await sendDailyBriefEmails();
  }
  console.log("[notifications] Daily brief job queued via BullMQ");
  return null;
}

export async function enqueuePromoEmail(): Promise<{ sent: number; skipped: number }> {
  const queued = await addToQueue("promo_email", { type: "promo_email" });
  if (!queued) {
    const { sendPromoEmail } = await import("../dailyBrief");
    return sendPromoEmail();
  }
  console.log("[notifications] Promo email job queued via BullMQ");
  return { sent: 0, skipped: 0 };
}

export async function enqueueServiceApology(): Promise<{ sent: number; skipped: number }> {
  const queued = await addToQueue("service_apology", { type: "service_apology" });
  if (!queued) {
    const { sendServiceApologyEmail } = await import("../dailyBrief");
    return sendServiceApologyEmail();
  }
  console.log("[notifications] Service apology job queued via BullMQ");
  return { sent: 0, skipped: 0 };
}

export async function enqueueApologyBrief(): Promise<void> {
  const queued = await addToQueue("apology_brief", { type: "apology_brief" });
  if (!queued) {
    const { sendApologyBriefEmails } = await import("../dailyBrief");
    await sendApologyBriefEmails();
  } else {
    console.log("[notifications] Apology brief job queued via BullMQ");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ worker (only started when Redis is available)
// ─────────────────────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startNotificationWorker(): void {
  const r = getRedis();
  if (!r) {
    console.log("[notifications] No Redis — push notifications run in-process (direct mode)");
    return;
  }

  _worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job: Job) => {
      const data = job.data as NotificationJobData;

      switch (data.type) {
        case "signal_push": {
          const d = data as SignalPushJobData;
          const stats = await sendPushBatch(d.subscriptions, d.title, d.body, d.tag, d.iconBase);
          console.log(
            `[notifications] Signal push done — sent:${stats.sent} failed:${stats.failed} expired:${stats.expired}`
          );
          break;
        }

        case "daily_brief": {
          const { sendDailyBriefEmails } = await import("../dailyBrief");
          await sendDailyBriefEmails();
          break;
        }

        case "promo_email": {
          const { sendPromoEmail } = await import("../dailyBrief");
          const result = await sendPromoEmail();
          console.log(`[notifications] Promo email done — sent:${result.sent} skipped:${result.skipped}`);
          break;
        }

        case "service_apology": {
          const { sendServiceApologyEmail } = await import("../dailyBrief");
          const result = await sendServiceApologyEmail();
          console.log(`[notifications] Service apology done — sent:${result.sent} skipped:${result.skipped}`);
          break;
        }

        case "apology_brief": {
          const { sendApologyBriefEmails } = await import("../dailyBrief");
          await sendApologyBriefEmails();
          break;
        }

        default:
          console.warn(`[notifications] Unknown job type: ${(data as any).type}`);
      }
    },
    {
      connection: r,
      concurrency: 5,
    }
  );

  _worker.on("completed", (job) =>
    console.log(`[notifications] Job ${job.id} (${job.name}) completed`)
  );
  _worker.on("failed", (job, err) =>
    console.error(`[notifications] Job ${job?.id} (${job?.name}) failed:`, err.message)
  );
  console.log("[notifications] BullMQ notification worker started");
}

export async function stopNotificationWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
