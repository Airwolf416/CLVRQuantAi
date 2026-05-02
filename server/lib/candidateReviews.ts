// File-backed review store for the admin Signal Candidates queue.
//
// Tracks approve / reject / expire decisions per signal id without
// touching the Postgres schema (Option A from the candidates spec).
// Persists to data/candidate-reviews.json so decisions survive restarts.
// Records older than 48h are pruned on every save (the candidates queue
// itself only shows entries < 2h old; the extra 46h is just an audit
// tail for the history counters).
//
// Concurrency model: in-process Map + debounced disk flush. Single-node
// app, so no need for cross-process locking.

import * as fs from "fs";
import * as path from "path";

export type ReviewStatus = "approved" | "rejected" | "expired";

export interface ReviewRecord {
  status: ReviewStatus;
  at: number;               // epoch ms when decision was made
  reason?: string;          // reject only — admin-supplied note (≤280 chars)
  telegramOk?: boolean;     // approve only — autoposter notify result
  telegramStatus?: number;  // approve only — downstream HTTP status
  signalToken?: string;     // audit copy in case the live buffer rolls out
  signalDir?: string;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "candidate-reviews.json");
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000;

const reviews = new Map<string, ReviewRecord>();
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, "utf8");
      const parsed = JSON.parse(raw) as Record<string, ReviewRecord>;
      const cutoff = Date.now() - PRUNE_AFTER_MS;
      for (const [id, rec] of Object.entries(parsed)) {
        if (rec && typeof rec.at === "number" && rec.at >= cutoff) {
          reviews.set(id, rec);
        }
      }
      console.log(`[candidate-reviews] loaded ${reviews.size} review records from disk`);
    }
  } catch (e: any) {
    console.warn(`[candidate-reviews] load failed (starting empty): ${e?.message || e}`);
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const cutoff = Date.now() - PRUNE_AFTER_MS;
      const out: Record<string, ReviewRecord> = {};
      for (const [id, rec] of reviews.entries()) {
        if (rec.at >= cutoff) out[id] = rec;
        else reviews.delete(id);
      }
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2), "utf8");
      fs.renameSync(tmp, FILE);
    } catch (e: any) {
      console.warn(`[candidate-reviews] save failed: ${e?.message || e}`);
    }
  }, 250);
}

export function getReview(id: string): ReviewRecord | undefined {
  ensureLoaded();
  return reviews.get(id);
}

export function setReview(id: string, rec: ReviewRecord): void {
  ensureLoaded();
  reviews.set(id, rec);
  scheduleSave();
}

export function getAllReviews(): Map<string, ReviewRecord> {
  ensureLoaded();
  return new Map(reviews);
}

export function getReviewCounts(): { approved: number; rejected: number; expired: number } {
  ensureLoaded();
  let approved = 0, rejected = 0, expired = 0;
  for (const r of reviews.values()) {
    if (r.status === "approved") approved++;
    else if (r.status === "rejected") rejected++;
    else if (r.status === "expired") expired++;
  }
  return { approved, rejected, expired };
}
