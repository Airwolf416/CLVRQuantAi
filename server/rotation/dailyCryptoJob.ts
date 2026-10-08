import type { PoolClient } from "pg";
import { pool } from "../db";
import { createCoinGeckoSource } from "./sources/coingecko";
import { createFmpSource } from "./sources/fmp";
import { createFredSource } from "./sources/fred";
import { createEtfFlowSource } from "./sources/etfFlows";
import { createHyperliquidSource } from "./sources/hyperliquid";
import { createFearGreedSource } from "./sources/fearGreed";
import { createYahooMacroSource } from "./sources/yahooMacro";
import { buildMacroInputs } from "./sources/macroInputs";
import {
  getDailyRotationSnapshot,
  getLatestRotationSnapshot,
  getPriorDominance,
  getRecentDailyRotationStates,
  saveCryptoEngineData,
  saveDailyRotationSnapshot,
  updateDailyMacroState,
  classifyRotationUniverse,
} from "./repository";
import { computeCryptoRotation, type RotationPriceSeries, type SentimentComponentHistory } from "./engines/crypto";
import type { RotationAllSources, RotationSourceResult } from "./types";

const LOCK_NAME = "clvr-rotation-brain-daily-crypto-v2";
const MINUTE_MS = 60_000;
const COINGECKO_REQUEST_GAP_MS = 2_050;
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

function validNinetyDaySpan(points: { t: number; price: number }[], asOf: number): boolean {
  const valid = points.filter(point => point.t <= asOf && Number.isFinite(point.price) && point.price > 0);
  return valid.length >= 30
    && valid[0].t <= asOf - 88 * 86_400_000
    && valid.at(-1)!.t >= asOf - 2 * 86_400_000;
}

function marketSeries(row: any, points: { t: number; price: number }[]): RotationPriceSeries {
  return {
    id: row.id,
    symbol: row.symbol,
    rank: row.market_cap_rank == null ? null : Number(row.market_cap_rank),
    marketCap: row.market_cap == null ? null : Number(row.market_cap),
    points,
  };
}

function dailyMacroSourceFailure(error: unknown): RotationSourceResult<any> {
  return {
    data: null,
    asOf: null,
    stale: true,
    error: error instanceof Error ? error.message : "Yahoo macro source failed",
  };
}

async function fetchMacroInputs(asOf: string, sources: RotationAllSources) {
  let yahooMacro: RotationSourceResult<any>;
  try {
    yahooMacro = await createYahooMacroSource().fetch(asOf);
  } catch (error) {
    yahooMacro = dailyMacroSourceFailure(error);
  }
  return buildMacroInputs({ fred: sources.fred, etfFlows: sources.etfFlows, yahoo: yahooMacro });
}

async function collect(date: string): Promise<void> {
  const existing = await getDailyRotationSnapshot(date);
  if (existing?.market_state?.crypto?.engineVersion === "phase2-v1"
    && existing?.market_state?.macro?.engineVersion === "phase3-v1") {
    console.log(`[rotation] Daily crypto/macro engines already ran for ${date}`);
    return;
  }

  const source = createCoinGeckoSource();
  const latest = await getLatestRotationSnapshot();
  const previous = latest?.market_state ?? null;
  // Sequential public-source calls keep CoinGecko request bursts low.
  const markets = await fetchOrRetain(previous, "markets", () => source.fetchMarkets(date));
  const global = await fetchOrRetain(previous, "global", () => source.fetchGlobal(date));
  const stablecoins = await fetchOrRetain(previous, "stablecoins", () => source.fetchStablecoins(date));
  const memes = await fetchOrRetain(previous, "memes", () => source.fetchMemes(date));
  const fredEndDate = new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const [fmp, fred, etfFlows, fundingOi, fearGreed] = await Promise.all([
    fetchOrRetain(previous, "fmp", () => createFmpSource().fetch(date)),
    fetchOrRetain(previous, "fred", () => createFredSource().fetch(fredEndDate)),
    fetchOrRetain(previous, "etfFlows", () => createEtfFlowSource().fetch(date)),
    fetchOrRetain(previous, "fundingOi", () => createHyperliquidSource().fetch(date)),
    fetchOrRetain(previous, "fearGreed", () => createFearGreedSource().fetch(date)),
  ]);
  const sources: RotationAllSources = { markets, global, stablecoins, memes, fmp, fred, etfFlows, fundingOi, fearGreed };
  // Take the point-in-time cutoff after live reads and before historical requests.
  const snapshotAsOf = new Date().toISOString();
  const macroInputs = await fetchMacroInputs(snapshotAsOf, sources);

  const marketRows = (markets.data ?? []).filter(coin => coin.market_cap_rank == null || Number(coin.market_cap_rank) <= 100);
  const stableIds = stablecoins.data == null ? null : new Set(stablecoins.data.map(coin => coin.id));
  const baseUniverse = classifyRotationUniverse(marketRows, stableIds);
  const historyById = new Map<string, { points: { t: number; price: number }[]; failed: boolean }>();
  const seriesById = new Map<string, RotationPriceSeries>();
  const historyFailures: string[] = [];
  const btcOrEth = (row: any) => ["btc", "eth"].includes(String(row.symbol).toLowerCase())
    || ["bitcoin", "ethereum"].includes(String(row.id).toLowerCase());
  const memeIds = (memes.data ?? []).slice(0, 20).map(coin => coin.id);
  const candidates = new Map<string, any>();
  for (const row of marketRows) {
    const baseEntry = baseUniverse.find(entry => entry.coin.id === row.id);
    if (baseEntry?.included || btcOrEth(row)) candidates.set(row.id, row);
  }
  for (const row of memes.data ?? []) {
    if (candidates.has(row.id)) continue;
    if (memeIds.includes(row.id)) candidates.set(row.id, row);
  }

  const asOfMs = Date.parse(snapshotAsOf);
  let requestCount = 0;
  for (const row of candidates.values()) {
    try {
      const days = btcOrEth(row) ? 220 : 95;
      const result = await source.fetchHistory(row.id, snapshotAsOf, days);
      const points = (result.data?.prices ?? [])
        .filter(([t, price]) => t <= asOfMs && Number.isFinite(price) && price > 0)
        .map(([t, price]) => ({ t, price }));
      historyById.set(row.id, { points, failed: false });
      if (baseUniverse.some(entry => entry.coin.id === row.id)) {
        const entry = baseUniverse.find(item => item.coin.id === row.id)!;
        const isBitcoin = btcOrEth(row) && (String(row.symbol).toLowerCase() === "btc" || row.id === "bitcoin");
        if (entry.included && !isBitcoin && !validNinetyDaySpan(points, asOfMs)) {
          entry.included = false;
          entry.exclusionReason = "INSUFFICIENT_90D_HISTORY";
          entry.historyPending = false;
        }
      }
      if (baseUniverse.some(entry => entry.coin.id === row.id && entry.included) || memeIds.includes(row.id) || btcOrEth(row)) {
        seriesById.set(row.id, marketSeries(row, points));
      }
    } catch (error) {
      historyById.set(row.id, { points: [], failed: true });
      historyFailures.push(row.id);
      const entry = baseUniverse.find(item => item.coin.id === row.id);
      if (entry?.included) entry.historyPending = true;
      console.warn(`[rotation] CoinGecko history unavailable for ${row.symbol}: ${error instanceof Error ? error.message : "request failed"}`);
    }
    requestCount++;
    if (requestCount < candidates.size) await new Promise(resolve => setTimeout(resolve, COINGECKO_REQUEST_GAP_MS));
  }
  for (const entry of baseUniverse) {
    if (!entry.historyPending) entry.historyPending = false;
    if (!entry.included && !entry.exclusionReason) entry.exclusionReason = "EXCLUDED_BY_UNIVERSE_RULE";
  }

  const snapshotId = await saveDailyRotationSnapshot({
    snapshotDate: date,
    asOf: snapshotAsOf,
    sources,
    universe: baseUniverse,
  });
  const recent = await getRecentDailyRotationStates(date, 365);
  const historical = [...recent].reverse();
  const previousMarketStates = recent.map(row => row.market_state ?? {});
  const priorDominance = await getPriorDominance(date);
  const btcMarket = marketRows.find(row => String(row.symbol).toLowerCase() === "btc" || row.id === "bitcoin");
  const totalMarketCap = global.data?.data?.total_market_cap?.usd ?? null;
  const stableRows = stablecoins.data ?? [];
  const fundingCurrent = !fundingOi.stale && fundingOi.data?.length
    ? (() => {
        const oi = fundingOi.data!.reduce((sum, row) => sum + Math.max(0, row.openInterestUsd), 0);
        const weighted = oi > 0
          ? fundingOi.data!.reduce((sum, row) => sum + row.fundingRatePct * Math.max(0, row.openInterestUsd), 0) / oi
          : null;
        return { timestamp: fundingOi.asOf ?? snapshotAsOf, fundingOiWeighted: weighted, aggregateOi: oi > 0 ? oi : null };
      })()
    : null;
  const fundingOiHistory = [
    ...previousMarketStates.flatMap(state => state.crypto?.sources?.fundingOi?.stale !== true
      && state.crypto?.fundingOiCurrent ? [state.crypto.fundingOiCurrent] : []),
    ...(fundingCurrent ? [fundingCurrent] : []),
  ];
  const sentimentKeys: (keyof SentimentComponentHistory)[] = [
    "fundingOiWeighted7d", "aggregateOiChange30d", "memeExcess30d",
    "fearGreed", "stableDominanceChange30d", "smallCapAsi",
  ];
  const sentimentHistory: SentimentComponentHistory = Object.fromEntries(sentimentKeys.map(key => [
    key,
    historical.flatMap(row => {
      if (row.market_state?.crypto?.sources?.coinGecko?.stale === true) return [];
      if (key === "fearGreed" && row.market_state?.crypto?.sources?.fearGreed?.stale === true) return [];
      const value = row.market_state?.crypto?.currentSentiment?.[key];
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    }),
  ])) as SentimentComponentHistory;
  const fearGreedHistory = [
    ...historical.flatMap(row => {
      if (row.market_state?.crypto?.sources?.fearGreed?.stale === true) return [];
      const value = row.market_state?.crypto?.currentSentiment?.fearGreed;
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    }),
  ];
  const previousAsiLabels = previousMarketStates.slice(0, 2).map(state => state.crypto?.asi?.candidateLabel ?? null);
  const previousConfirmedAsiLabel = previousMarketStates[0]?.crypto?.asi?.confirmedLabel ?? null;
  const cryptoCalculation = computeCryptoRotation({
    asOf: snapshotAsOf,
    coins: [...seriesById.values()].filter(row => {
      const entry = baseUniverse.find(item => item.coin.id === row.id);
      return row.symbol.toLowerCase() === "btc" || entry?.included === true;
    }),
    totalMarketCap,
    stablecoins: stableRows.map(row => ({ id: row.id, symbol: row.symbol, marketCap: row.market_cap })),
    priorDominance,
    previousAsiLabels,
    previousConfirmedAsiLabel,
    equitySeries: macroInputs.equitySeries,
    memeIds,
    memeSeries: memeIds.flatMap(id => seriesById.has(id) ? [seriesById.get(id)!] : []),
    sentimentHistory,
    fundingOiHistory,
    fearGreedHistory,
    currentFearGreed: !fearGreed.stale && fearGreed.data?.value != null
      && Date.parse(fearGreed.asOf ?? "") <= asOfMs ? fearGreed.data.value : null,
  });
  // Meme-category coins outside the top 100 are included in the risk ladder
  // and excess-return basket, without admitting them into ASI membership.
  const cryptoState: Record<string, any> = {
    ...cryptoCalculation,
    status: historyFailures.length || markets.stale || global.stale || stablecoins.stale
      ? (cryptoCalculation.asi.composite != null ? "partial" : "warming_up")
      : cryptoCalculation.asi.composite != null ? "ready" : "warming_up",
    engineVersion: "phase2-v1",
    historyFailures: historyFailures.length,
    historyFailureCoinIds: historyFailures,
    marketUniverseCount: marketRows.length,
    memeHistoryCount: memeIds.filter(id => historyById.get(id)?.failed === false).length,
    sources: {
      coinGecko: { stale: markets.stale || global.stale || stablecoins.stale, asOf: markets.asOf },
      fundingOi: { stale: fundingOi.stale, asOf: fundingOi.asOf, error: fundingOi.error ?? null },
      fearGreed: { stale: fearGreed.stale, asOf: fearGreed.asOf, error: fearGreed.error ?? null },
    },
  };
  await saveCryptoEngineData({
    snapshotId,
    snapshotDate: date,
    universe: baseUniverse,
    returns: cryptoCalculation.returns,
    cryptoState,
    btcMcap: btcMarket?.market_cap == null ? null : Number(btcMarket.market_cap),
    totalMcap: totalMarketCap == null ? null : Number(totalMarketCap),
    stableMcap: stableRows.reduce((sum, coin) => sum + Math.max(0, Number(coin.market_cap ?? 0)), 0),
    usdtUsdcMcap: stableRows.filter(coin => ["usdt", "usdc"].includes(coin.symbol.toLowerCase())
      || ["tether", "usd-coin"].includes(coin.id))
      .reduce((sum, coin) => sum + Math.max(0, Number(coin.market_cap ?? 0)), 0),
    btcDominance: cryptoCalculation.dominance.raw,
    dominanceExStables: cryptoCalculation.dominance.exStables,
  });

  const macroState: Record<string, any> = {
    ...macroInputs.state(snapshotAsOf),
    engineVersion: "phase3-v1",
    sourceStatus: macroInputs.sourceStatus,
    adaptiveWeighting: { enabled: false, reason: "disabled_by_default" },
  };
  await updateDailyMacroState(snapshotId, macroState);
  const excluded = baseUniverse.filter(entry => !entry.included);
  const exclusionsByReason = excluded.reduce<Record<string, number>>((counts, entry) => {
    const reason = entry.exclusionReason ?? "UNKNOWN";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`[rotation] Phase 2/3 daily snapshot ${date} stored (#${snapshotId}); ` +
    `${cryptoCalculation.asi.eligible} ASI eligible, exclusions ${JSON.stringify(exclusionsByReason)}, ` +
    `${historyFailures.length} history requests pending; macro ${macroState.status} ` +
    `(${macroState.activeFactorCount}/8 factors).`);
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
    console.error("[rotation] Daily crypto/macro collection failed:", error instanceof Error ? error.message : error);
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
  console.log("[rotation] Daily phase 2/3 collector scheduled for 00:15 UTC (startup catch-up enabled)");
}
