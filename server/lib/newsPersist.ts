// ── News persistence (fire-and-forget) + nightly cleanup ─────────────────────
// Live signal gating uses the in-memory cache in lib/newsContext. This module
// is purely for the historical record in `news_items`, used later for outcome
// ↔ news-conflict correlation analysis. Never blocks signal generation.

import { db } from "../db";
import { newsItems } from "../../shared/schema";
import { sql } from "drizzle-orm";
import { getCachedNewsItems, getRecentCriticalHeadlines, type CachedNewsItem } from "./newsContext";

let lastPersistAt = 0;
const PERSIST_THROTTLE_MS = 60_000;  // never write more than once a minute

export function persistRecentNews(): void {
  const now = Date.now();
  if (now - lastPersistAt < PERSIST_THROTTLE_MS) return;
  lastPersistAt = now;

  const items: CachedNewsItem[] = getCachedNewsItems();
  if (items.length === 0) return;

  const rows = items.map((it) => ({
    externalId: it.externalId,
    title: it.title.slice(0, 1000),
    source: it.source?.slice(0, 200) || null,
    tickers: it.tickers || null,
    sentiment: it.sentiment,
    severity: it.severity,
    url: it.url || null,
    createdAt: new Date(it.createdAt),
  }));

  // Fire-and-forget — never await, never throw upstream
  db.insert(newsItems).values(rows).onConflictDoNothing({ target: newsItems.externalId })
    .then(() => {/* silent */})
    .catch((e) => console.log(`[news-persist] insert failed (non-fatal): ${e?.message || e}`));
}

export async function cleanupOldNewsItems(): Promise<number> {
  try {
    const r = await db.execute(sql`DELETE FROM news_items WHERE created_at < NOW() - INTERVAL '90 days'`);
    const n = (r as any).rowCount ?? 0;
    console.log(`[news-cleanup] purged ${n} rows older than 90d`);
    return n;
  } catch (e: any) {
    console.log(`[news-cleanup] failed: ${e?.message || e}`);
    return 0;
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let persistTimer: ReturnType<typeof setInterval> | null = null;
export function startNewsCleanupScheduler(): void {
  if (cleanupTimer) return;
  cleanupOldNewsItems(); // run once at boot
  cleanupTimer = setInterval(cleanupOldNewsItems, 24 * 60 * 60 * 1000);  // every 24h
  // Warm cache + persist every 5 min — touches getRecentCriticalHeadlines to
  // trigger refreshCacheIfStale, then writes the deduped batch to news_items.
  const warmAndPersist = async () => {
    try { await getRecentCriticalHeadlines(1, 1); } catch {}
    persistRecentNews();
  };
  warmAndPersist();
  persistTimer = setInterval(warmAndPersist, 5 * 60 * 1000);
  console.log("[news-cleanup] scheduler started — 24h cleanup, 5m persist, 90d retention");
}
