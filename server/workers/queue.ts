// ── BullMQ Queue Registry — CLVRQuantAI ───────────────────────────────────────
// Creates repeatable background job queues when Redis is available.
// Falls back gracefully to direct function calls (setInterval / while loops).

import { Queue, Worker, type Job, type RepeatableJob } from "bullmq";
import { getRedis } from "../services/redis";

export const QUEUE_NAMES = {
  HL_REFRESH:    "clvr-hl-refresh",
  STOCK_REFRESH: "clvr-stock-refresh",
  SENTIMENT:     "clvr-sentiment",
  BASKET:        "clvr-basket",
  NOTIFICATIONS: "clvr-notifications",
} as const;

// ── Active workers registry ───────────────────────────────────────────────────

const _workers: Worker[] = [];

// ── Factory: create a repeatable queue + worker ───────────────────────────────
// Returns null when Redis is unavailable.

export function createRepeatableWorker(
  queueName: string,
  intervalMs: number,
  processor: (job: Job) => Promise<void>
): { queue: Queue; worker: Worker } | null {
  const r = getRedis();
  if (!r) return null;

  const queue  = new Queue(queueName, { connection: r });
  const worker = new Worker(queueName, processor, { connection: r, concurrency: 1 });

  worker.on("failed", (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, err.message);
  });

  // Schedule a repeating job
  queue.add(
    "tick",
    {},
    {
      repeat: { every: intervalMs },
      jobId:  `${queueName}-repeat`,
    }
  ).catch(err => console.error(`[${queueName}] Failed to schedule repeating job:`, err.message));

  _workers.push(worker);
  console.log(`[${queueName}] BullMQ repeatable worker started (every ${intervalMs}ms)`);
  return { queue, worker };
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeAllWorkers(): Promise<void> {
  await Promise.allSettled(_workers.map(w => w.close()));
  console.log("[queue] All BullMQ workers closed");
}
