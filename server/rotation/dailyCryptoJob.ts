import type { PoolClient } from "pg";
import { pool } from "../db";
import { createCoinGeckoSource } from "./sources/coingecko";
import { createFmpSource } from "./sources/fmp";
import { createFredSource } from "./sources/fred";
import { createEtfFlowSource } from "./sources/etfFlows";
import { createHyperliquidSource } from "./sources/hyperliquid";
import { createFearGreedSource } from "./sources/fearGreed";
import { getLatestRotationSnapshot, rotationSnapshotExists, saveDailyRotationSnapshot, classifyRotationUniverse } from "./repository";
import type { RotationAllSources, RotationSourceResult } from "./types";

const LOCK_NAME = "clvr-rotation-brain-daily-crypto-v1";
const MINUTE_MS = 60_000;
let scheduler: ReturnType<typeof setInterval> | null = null;
let localRun = false;

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function oldSource<T>(previous: any, name: keyof RotationAllSources, error: unknown): RotationSourceResult<T> {
  const old = previous?.sources?.[name];
  if (old?.data != null && typeof old.asOf === "string") {
    return {
      data: old.data as T,
      asOf: old.asOf,
      stale: true,
      lastGoodAt: old.asOf,
      error: error instanceof Error ? error.message : "Source request failed",
    };
  }
  return {
    data: null,
    asOf: null,
    stale: true,
    error: error instanceof Error ? error.message : "Source request failed",
  };
}

async function fetchOrRetain<T>(
  previous: any,
  name: keyof RotationAllSources,
  fetcher: () => Promise<RotationSourceResult<T>>,
): Promise<RotationSourceResult<T>> {
  try {
    const result = await fetcher();
    if (result.data == null || !result.asOf) throw new Error(result.error || "Source returned no validated data");
    return result;
  } catch (error) {
    const retained = oldSource<T>(previous, name, error);
    console.warn(`[rotation] ${name} unavailable; ${retained.data == null ? "no prior snapshot" : `using stale data from ${retained.asOf}`}: ${retained.error}`);
    return retained;
  }
}

async function collect(date: string): Promise<void> {
  if (await rotationSnapshotExists(date)) {
    console.log(`[rotation] Daily crypto snapshot already exists for ${date}`);
    return;
  }
  const source = createCoinGeckoSource();
  const previous = await getLatestRotationSnapshot();
  // Sequential requests reduce CoinGecko burst pressure on the public tier.
  const markets = await fetchOrRetain(previous, "markets", () => source.fetchMarkets(date));
  const global = await fetchOrRetain(previous, "global", () => source.fetchGlobal(date));
  const stablecoins = await fetchOrRetain(previous, "stablecoins", () => source.fetchStablecoins(date));
  const memes = await fetchOrRetain(previous, "memes", () => source.fetchMemes(date));
  const [fmp, fred, etfFlows, fundingOi, fearGreed] = await Promise.all([
    fetchOrRetain(previous, "fmp", () => createFmpSource().fetch(date)),
    fetchOrRetain(previous, "fred", () => createFredSource().fetch(date)),
    fetchOrRetain(previous, "etfFlows", () => createEtfFlowSource().fetch(date)),
    fetchOrRetain(previous, "fundingOi", () => createHyperliquidSource().fetch(date)),
    fetchOrRetain(previous, "fearGreed", () => createFearGreedSource().fetch(date)),
  ]);
  const sources: RotationAllSources = { markets, global, stablecoins, memes, fmp, fred, etfFlows, fundingOi, fearGreed };

  const marketRows = markets.data ?? [];
  const stableIds = stablecoins.data == null ? null : new Set(stablecoins.data.map(coin => coin.id));
  const universe = classifyRotationUniverse(marketRows, stableIds);
  const asOfValues = Object.values(sources).flatMap(result => result.asOf ? [result.asOf] : []);
  const asOf = asOfValues.length ? asOfValues.sort().at(-1)! : new Date().toISOString();

  // Record component errors and stale status instead of treating missing source
  // values as zero. A completely cold failure remains an explicitly stale snapshot.
  const snapshotId = await saveDailyRotationSnapshot({ snapshotDate: date, asOf, sources, universe });
  const excluded = universe.filter(entry => !entry.included);
  console.log(`[rotation] Daily snapshot ${date} stored (#${snapshotId}); ` +
    `${universe.length} ranked coins, ${universe.length - excluded.length} eligible pending history check, ` +
    `${excluded.length} excluded (${excluded.map(row => `${row.coin.symbol}:${row.exclusionReason}`).join(", ") || "none"}); ` +
    `stale sources: ${Object.entries(sources).filter(([, result]) => result.stale).map(([name]) => name).join(", ") || "none"}`);
}

export async function runDailyCryptoCollection(now = new Date()): Promise<boolean> {
  if (localRun) return false;
  localRun = true;
  let client: PoolClient | null = null;
  let locked = false;
  try {
    client = await pool.connect();
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [LOCK_NAME],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return false;
    await collect(utcDate(now));
    return true;
  } catch (error) {
    console.error("[rotation] Daily crypto collection failed:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    if (client && locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_NAME]).catch(() => {});
    }
    client?.release();
    localRun = false;
  }
}

function utcCollectionWindow(now: Date): boolean {
  return now.getUTCHours() > 0 || (now.getUTCHours() === 0 && now.getUTCMinutes() >= 15);
}

export function startDailyCryptoCollectionScheduler(): void {
  if (scheduler) return;
  let lastRunDate = "";
  const tick = async () => {
    const now = new Date();
    const date = utcDate(now);
    if (!utcCollectionWindow(now) || date === lastRunDate) return;
    if (await runDailyCryptoCollection(now)) lastRunDate = date;
  };
  scheduler = setInterval(() => { void tick(); }, MINUTE_MS);
  scheduler.unref?.();
  void tick();
  console.log("[rotation] Daily crypto collector scheduled for 00:15 UTC (startup catch-up enabled)");
}
