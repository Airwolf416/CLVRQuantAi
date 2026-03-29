// ── Notification Worker — parallel batch processing ───────────────────────────
// Processes push notifications and email sends in concurrent chunks of 50
// using Promise.allSettled so a single failure never blocks the rest.

import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "../services/redis";
import { chunkArray } from "../services/ta";
import { pool } from "../db";
import webpush from "web-push";

const BATCH_SIZE = 50;

// ── Push notification job data shapes ─────────────────────────────────────────

export interface SignalPushJobData {
  type: "signal_push";
  title: string;
  body: string;
  tag: string;
  iconBase: string;
  subscriptions: Array<{ id: number; subscription: any }>;
}

export interface UserPushJobData {
  type: "user_push";
  userId: string;
  title: string;
  body: string;
  tag: string;
  iconBase: string;
}

// ── Queue name ────────────────────────────────────────────────────────────────

export const NOTIFICATIONS_QUEUE = "clvr-notifications";

// ── Broadcast strong signal push to all Pro/Elite subscribers ─────────────────
// Replaces the sequential for-loop in routes.ts with parallel Promise.allSettled batches.

export async function broadcastSignalPushParallel(sig: any): Promise<void> {
  const pushOrigin = process.env.APP_URL
    || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "https://clvrquantai.com");

  const dirLabel = sig.dir === "LONG" ? "📈 LONG" : "📉 SHORT";
  const title = `⚡ ${dirLabel}: ${sig.token} — Score ${sig.advancedScore}/100`;
  const entryFmt = sig.entry ? `$${typeof sig.entry === "number" ? sig.entry.toFixed(sig.entry > 100 ? 2 : 4) : sig.entry}` : "—";
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

    const r = getRedis();
    if (r) {
      // Queue through BullMQ for reliable delivery with Redis
      const queue = new Queue(NOTIFICATIONS_QUEUE, { connection: r });
      await queue.add("signal_push", {
        type: "signal_push",
        title,
        body,
        tag,
        iconBase: pushOrigin,
        subscriptions,
      } as SignalPushJobData, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
      await queue.close();
    } else {
      // Direct parallel send (no Redis — Replit dev)
      await sendPushBatch(subscriptions, title, body, tag, pushOrigin);
    }

    console.log(`[PUSH] Signal broadcast queued: ${sig.token} ${sig.dir} score=${sig.advancedScore} to ${subscriptions.length} subscriber(s)`);
  } catch (e: any) {
    console.error("[PUSH] broadcastSignalPushParallel error:", e.message);
  }
}

// ── Core: send to a list of subscriptions in parallel batches ─────────────────

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
    icon:  `${iconBase}/icons/icon-512.png`,
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
      chunk.map(row =>
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

  // Clean up expired subscriptions in one batch query
  if (expiredIds.length > 0) {
    try {
      await pool.query(
        `DELETE FROM push_subscriptions WHERE id = ANY($1::int[])`,
        [expiredIds]
      );
    } catch { /* non-fatal */ }
  }

  return { sent, failed, expired: expiredIds.length };
}

// ── BullMQ worker (only started when Redis is available) ──────────────────────

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
      const data = job.data;
      if (data.type === "signal_push") {
        const d = data as SignalPushJobData;
        const stats = await sendPushBatch(d.subscriptions, d.title, d.body, d.tag, d.iconBase);
        console.log(`[notifications] Signal push done — sent:${stats.sent} failed:${stats.failed} expired:${stats.expired}`);
      }
    },
    {
      connection: r,
      concurrency: 5,
    }
  );

  _worker.on("completed", (job) => console.log(`[notifications] Job ${job.id} completed`));
  _worker.on("failed",    (job, err) => console.error(`[notifications] Job ${job?.id} failed:`, err.message));
  console.log("[notifications] BullMQ notification worker started");
}

export async function stopNotificationWorker(): Promise<void> {
  if (_worker) { await _worker.close(); _worker = null; }
}
