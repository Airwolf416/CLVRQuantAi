import {
  countXyzSignals,
  scoreXyzPerp,
  sortXyzSignals,
  type XyzDailyCandle,
  type XyzSignalRow,
} from "../lib/xyzSignalScoring";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const MARKET_REFRESH_MS = 15_000;
const CANDLE_REFRESH_MS = 15 * 60_000;
const CANDLE_LOOKBACK_MS = 90 * 24 * 60 * 60_000;
const FETCH_CONCURRENCY = 1;
// candleSnapshot carries an API weight of 20 plus a cost per 60 returned bars.
// This pacing stays below the documented per-IP aggregate even with two app replicas.
const REQUEST_SPACING_MS = 2_700;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

type Fetcher = typeof fetch;
type CandleCacheEntry = { candles: XyzDailyCandle[]; fetchedAt: number };

export type XyzSignalSnapshot = {
  rows: XyzSignalRow[];
  counts: ReturnType<typeof countXyzSignals>;
  universeSize: number;
  fetchedAt: number;
  candlesAsOf: number;
  stale: boolean;
};

type XyzFeedOptions = {
  fetch?: Fetcher;
  now?: () => number;
  marketRefreshMs?: number;
  candleRefreshMs?: number;
  concurrency?: number;
  requestSpacingMs?: number;
};

function asFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function dailyCandlesInRange(raw: any[], endTime: number, startTime: number): XyzDailyCandle[] {
  return raw
    .filter(candle => candle && Number.isFinite(Number(candle.t)))
    .map(candle => ({ t: Number(candle.t), c: candle.c }))
    .filter(candle => {
      const close = asFinite(candle.c);
      return candle.t >= startTime && candle.t <= endTime && close != null && close > 0;
    });
}

export function createXyzSignalFeed(options: XyzFeedOptions = {}) {
  const fetcher = options.fetch || fetch;
  const now = options.now || Date.now;
  const marketRefreshMs = options.marketRefreshMs ?? MARKET_REFRESH_MS;
  const candleRefreshMs = options.candleRefreshMs ?? CANDLE_REFRESH_MS;
  const concurrency = options.concurrency ?? FETCH_CONCURRENCY;
  const requestSpacingMs = options.requestSpacingMs ?? REQUEST_SPACING_MS;
  const candleCache = new Map<string, CandleCacheEntry>();
  let lastSnapshot: XyzSignalSnapshot | null = null;
  let lastMarketFetchAt = 0;
  let inFlight: Promise<XyzSignalSnapshot> | null = null;
  let nextRequestAt = 0;
  let candlesCompleted = 0;
  let candlesTotal = 0;
  let lastError = "";
  let retryAt = 0;

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const postInfo = async (payload: unknown): Promise<any> => {
    const waitMs = Math.max(0, nextRequestAt - now());
    if (waitMs > 0) await sleep(waitMs);
    nextRequestAt = now() + requestSpacingMs;
    const response = await fetcher(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 429) {
        retryAt = now() + RATE_LIMIT_COOLDOWN_MS;
        throw new Error("HYPERLIQUID_HTTP_429");
      }
      throw new Error(`HYPERLIQUID_HTTP_${response.status}`);
    }
    return response.json();
  };

  const readCandleHistory = async (
    coin: string,
    startTime: number,
    endTime: number,
  ): Promise<{ candles: XyzDailyCandle[]; fetchedAt: number; stale: boolean }> => {
    const cached = candleCache.get(coin);
    const at = now();
    if (cached && at - cached.fetchedAt < candleRefreshMs) {
      return { ...cached, stale: false };
    }
    try {
      const payload = await postInfo({
        type: "candleSnapshot",
        req: { coin, interval: "1d", startTime, endTime },
      });
      if (!Array.isArray(payload)) throw new Error("HYPERLIQUID_CANDLES_MALFORMED");
      const candles = dailyCandlesInRange(payload, endTime, startTime);
      const entry = { candles, fetchedAt: at };
      candleCache.set(coin, entry);
      return { ...entry, stale: false };
    } catch (error) {
      if (cached) {
        console.warn(`[xyz-signal-feed] using cached candles for ${coin} after refresh failure`);
        return { ...cached, stale: true };
      }
      throw error;
    }
  };

  const fetchSnapshot = async (): Promise<XyzSignalSnapshot> => {
    const fetchedAt = now();
    const startTime = fetchedAt - CANDLE_LOOKBACK_MS;
    const payload = await postInfo({ type: "metaAndAssetCtxs", dex: "xyz" });
    if (!Array.isArray(payload) || payload.length !== 2
      || !Array.isArray(payload[0]?.universe) || !Array.isArray(payload[1])
      || payload[0].universe.length !== payload[1].length
      || payload[0].universe.length === 0) {
      throw new Error("HYPERLIQUID_XYZ_UNIVERSE_MALFORMED");
    }

    const assets = payload[0].universe.map((asset: any, index: number) => {
      if (!asset || typeof asset.name !== "string" || !asset.name.trim()) {
        throw new Error("HYPERLIQUID_XYZ_ASSET_MALFORMED");
      }
      const rawName = asset.name.trim();
      const coin = /^xyz:/i.test(rawName) ? rawName : `xyz:${rawName}`;
      return { coin, context: payload[1][index] || {} };
    });
    const uniqueCoins = new Set(assets.map((asset: any) => asset.coin.toUpperCase()));
    if (uniqueCoins.size !== assets.length) throw new Error("HYPERLIQUID_XYZ_DUPLICATE_ASSET");

    candlesCompleted = 0;
    candlesTotal = assets.length;
    const candleResults = await mapLimit(
      assets,
      concurrency,
      async (asset: any) => {
        const history = await readCandleHistory(asset.coin, startTime, fetchedAt);
        candlesCompleted += 1;
        return { coin: asset.coin, ...history };
      },
    );
    const candleByCoin = new Map(candleResults.map(result => [result.coin, result]));
    const rows = assets.map(({ coin, context }: any) => {
      const history = candleByCoin.get(coin)!;
      return scoreXyzPerp({
        coin,
        markPrice: asFinite(context.markPx),
        fundingRate: asFinite(context.funding),
        openInterest: asFinite(context.openInterest),
        candles: history.candles,
      });
    });
    const candlesAsOf = Math.min(...candleResults.map(result => result.fetchedAt));
    return {
      rows: sortXyzSignals(rows),
      counts: countXyzSignals(rows),
      universeSize: assets.length,
      fetchedAt,
      candlesAsOf,
      stale: candleResults.some(result => result.stale),
    };
  };

  const startRefresh = (): Promise<XyzSignalSnapshot> | null => {
    if (inFlight) return inFlight;
    candlesCompleted = 0;
    candlesTotal = 0;
    inFlight = (async () => {
      try {
        const snapshot = await fetchSnapshot();
        lastSnapshot = snapshot;
        lastMarketFetchAt = snapshot.fetchedAt;
        lastError = "";
        retryAt = 0;
        return snapshot;
      } catch (error: any) {
        lastError = error?.message || "XYZ_MARKET_DATA_UNAVAILABLE";
        if (lastError.includes("429")) retryAt = Math.max(retryAt, now() + RATE_LIMIT_COOLDOWN_MS);
        else retryAt = now() + marketRefreshMs;
        if (lastSnapshot) {
          console.warn("[xyz-signal-feed] refresh failed; returning last complete snapshot");
          lastMarketFetchAt = now();
          return { ...lastSnapshot, stale: true };
        }
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const getSnapshot = async (): Promise<XyzSignalSnapshot> => {
    const at = now();
    if (lastSnapshot && at - lastMarketFetchAt < marketRefreshMs) return lastSnapshot;
    const refresh = startRefresh();
    if (!refresh) throw new Error("XYZ_SIGNAL_REFRESH_UNAVAILABLE");
    return refresh;
  };

  const getState = () => {
    const at = now();
    const isFresh = lastSnapshot && at - lastMarketFetchAt < marketRefreshMs;
    if (isFresh) return { status: "ready" as const, ...lastSnapshot, refreshing: false };
    if (!inFlight && at >= retryAt) {
      void startRefresh()?.catch(() => {});
    }
    if (lastSnapshot) {
      return {
        status: "ready" as const,
        ...lastSnapshot,
        stale: !isFresh || lastSnapshot.stale,
        refreshing: Boolean(inFlight),
      };
    }
    if (inFlight) {
      return { status: "loading" as const, candlesCompleted, candlesTotal };
    }
    return {
      status: "error" as const,
      error: "Live xyz market data could not be loaded. Retry shortly.",
      code: "XYZ_MARKET_DATA_UNAVAILABLE",
      retryAfter: Math.max(0, retryAt - at),
      detail: lastError,
    };
  };

  return { getSnapshot, getState };
}

const xyzFeed = createXyzSignalFeed();
export const getXyzSignalSnapshot = xyzFeed.getSnapshot;
export const getXyzSignalFeedState = xyzFeed.getState;
