import { rGet, rSet } from "../../services/redis";
import { ROTATION_CONFIG } from "../config";
import type {
  CoinGeckoGlobal, CoinGeckoMarket, CoinGeckoSourcePayload, RotationSourceResult, RotationSourceAdapter,
} from "../types";

type CacheRecord<T> = { data: T; asOf: string; storedAt: number };
type SourceDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const localCache = new Map<string, CacheRecord<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

const validMarketRows = (value: unknown): value is CoinGeckoMarket[] =>
  Array.isArray(value) && value.every((row: any) =>
    row && typeof row.id === "string" && typeof row.symbol === "string"
    && typeof row.name === "string"
    && (row.market_cap_rank == null || Number.isFinite(Number(row.market_cap_rank)))
    && (row.current_price == null || Number.isFinite(Number(row.current_price)))
    && (row.market_cap == null || Number.isFinite(Number(row.market_cap))));
const validNonEmptyMarketRows = (value: unknown): value is CoinGeckoMarket[] =>
  validMarketRows(value) && value.length > 0;

const validGlobal = (value: unknown): value is CoinGeckoGlobal => {
  const row = (value as any)?.data;
  return !!row && typeof row === "object" && !!row.total_market_cap
    && Number.isFinite(Number(row.total_market_cap.usd))
    && !!row.market_cap_percentage && Number.isFinite(Number(row.market_cap_percentage.btc));
};

export function createCoinGeckoSource(deps: SourceDeps = {}) {
  const request = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const random = deps.random || Math.random;

  async function requestJson(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        const headers: Record<string, string> = { "User-Agent": "CLVRQuantAI-RotationBrain/1.0" };
        // Optional CoinGecko Demo API key; never required or emitted in logs.
        if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
        const response = await request(url, { headers, signal: AbortSignal.timeout(ROTATION_CONFIG.source.timeoutMs) });
        if (response.ok) return response.json();
        if (![429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(`CoinGecko returned HTTP ${response.status}`);
        }
        if (attempt >= ROTATION_CONFIG.source.maxRetries) {
          throw new Error(`CoinGecko returned HTTP ${response.status}`);
        }
        const retryHeader = Number(response.headers.get("retry-after"));
        const retryMs = Number.isFinite(retryHeader) && retryHeader > 0
          ? Math.min(retryHeader * 1000, 10_000)
          : ROTATION_CONFIG.source.retryBaseMs * (2 ** attempt) * (0.75 + random() * 0.5);
        await sleep(retryMs);
      } catch (error) {
        if (error instanceof Error && /CoinGecko returned HTTP \d+/.test(error.message)) throw error;
        if (attempt >= ROTATION_CONFIG.source.maxRetries) throw new Error("CoinGecko request failed");
        const retryMs = ROTATION_CONFIG.source.retryBaseMs * (2 ** attempt) * (0.75 + random() * 0.5);
        await sleep(retryMs);
      }
    }
  }

  async function cached<T>(
    key: string,
    freshTtl: number,
    url: string,
    validate: (value: unknown) => value is T,
    timestamp: (value: T) => string,
  ): Promise<RotationSourceResult<T>> {
    const existing = (await rGet<CacheRecord<T>>(key)) || localCache.get(key) as CacheRecord<T> | undefined;
    if (existing && now() - existing.storedAt < freshTtl * 1000) {
      return { data: existing.data, asOf: existing.asOf, stale: false };
    }
    const active = inFlight.get(key);
    if (active) return await active as RotationSourceResult<T>;
    const work = (async (): Promise<RotationSourceResult<T>> => {
      try {
        const raw = await requestJson(url);
        const payload = validate(raw) ? raw : (() => { throw new Error("CoinGecko returned an invalid payload"); })();
        const record: CacheRecord<T> = {
          data: payload, asOf: timestamp(payload) || new Date(now()).toISOString(), storedAt: now(),
        };
        localCache.set(key, record);
        await rSet(key, record, ROTATION_CONFIG.source.staleCacheTtlSeconds);
        return { data: payload, asOf: record.asOf, stale: false };
      } catch (error) {
        if (existing) {
          return { data: existing.data, asOf: existing.asOf, stale: true, lastGoodAt: existing.asOf,
            error: error instanceof Error ? error.message : "CoinGecko request failed" };
        }
        throw error;
      }
    })();
    inFlight.set(key, work);
    try { return await work; }
    finally { inFlight.delete(key); }
  }

  function assertCurrentDate(date?: string): void {
    if (date && date !== new Date(now()).toISOString().slice(0, 10)) {
      throw new Error("CoinGecko live market endpoints cannot provide historical point-in-time data");
    }
  }

  const base = ROTATION_CONFIG.source.coinGeckoBaseUrl;
  const methods = {
    fetchMarkets(date?: string) {
      assertCurrentDate(date);
      const url = `${base}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${ROTATION_CONFIG.source.topUniverseSize}&page=1&sparkline=false`;
      return cached("rotation:source:coingecko:top100", ROTATION_CONFIG.source.freshTtlSeconds.markets,
        url, validNonEmptyMarketRows, rows => rows.reduce((best, row) =>
          row.last_updated && row.last_updated > best ? row.last_updated : best, ""));
    },
    fetchGlobal(date?: string) {
      assertCurrentDate(date);
      return cached("rotation:source:coingecko:global", ROTATION_CONFIG.source.freshTtlSeconds.global,
        `${base}/global`, validGlobal, value => value.data.updated_at
          ? new Date(value.data.updated_at * 1000).toISOString() : "");
    },
    fetchStablecoins(date?: string) {
      assertCurrentDate(date);
      return cached("rotation:source:coingecko:stablecoins", ROTATION_CONFIG.source.freshTtlSeconds.stablecoins,
        `${base}/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=${ROTATION_CONFIG.source.stablecoinPageSize}&page=1&sparkline=false`,
        validNonEmptyMarketRows, rows => rows.reduce((best, row) =>
          row.last_updated && row.last_updated > best ? row.last_updated : best, ""));
    },
    fetchMemes(date?: string) {
      assertCurrentDate(date);
      return cached("rotation:source:coingecko:memes", ROTATION_CONFIG.source.freshTtlSeconds.memes,
        `${base}/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=${ROTATION_CONFIG.source.memeBasketSize}&page=1&sparkline=false`,
        validNonEmptyMarketRows, rows => rows.reduce((best, row) =>
          row.last_updated && row.last_updated > best ? row.last_updated : best, ""));
    },
    async fetchHistory(coinId: string, asOfDate: string, days = ROTATION_CONFIG.windows.asiDays[2]) {
      if (!/^[a-z0-9-]+$/i.test(coinId) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
        || !Number.isInteger(days) || days < 1 || days > 730) {
        throw new Error("Invalid CoinGecko history request");
      }
      const end = Date.parse(`${asOfDate}T23:59:59.999Z`);
      if (!Number.isFinite(end) || end > now()) throw new Error("Historical query date must not be in the future");
      const from = end - days * 24 * 60 * 60 * 1000;
      const url = `${base}/coins/${encodeURIComponent(coinId)}/market_chart/range?vs_currency=usd&from=${Math.floor(from / 1000)}&to=${Math.floor(end / 1000)}`;
      const key = `rotation:source:coingecko:history:${coinId}:${asOfDate}:${days}`;
      const valid = (value: unknown): value is { prices: [number, number][] } =>
        !!value && Array.isArray((value as any).prices)
        && (value as any).prices.every((point: any) => Array.isArray(point) && point.length >= 2
          && Number.isFinite(point[0]) && point[0] >= from && point[0] <= end
          && Number.isFinite(point[1]) && point[1] > 0);
      return cached(key, ROTATION_CONFIG.source.freshTtlSeconds.history, url, valid, () => asOfDate);
    },
  };
  const adapter: RotationSourceAdapter<CoinGeckoSourcePayload> & typeof methods = {
    ...methods,
    async fetch(date?: string): Promise<RotationSourceResult<CoinGeckoSourcePayload>> {
    const capture = async <T>(fetcher: () => Promise<RotationSourceResult<T>>): Promise<RotationSourceResult<T>> => {
      try { return await fetcher(); }
      catch (error) {
        return {
          data: null, asOf: null, stale: true,
          error: error instanceof Error ? error.message : "CoinGecko request failed",
        };
      }
    };
    // Keep calls sequential so a public CoinGecko tier is not hit with a burst.
    const markets = await capture(() => methods.fetchMarkets(date));
    const global = await capture(() => methods.fetchGlobal(date));
    const stablecoins = await capture(() => methods.fetchStablecoins(date));
    const memes = await capture(() => methods.fetchMemes(date));
    const data = { markets, global, stablecoins, memes };
    const timestamps = Object.values(data).flatMap(result => result.asOf ? [result.asOf] : []);
    const errors = Object.entries(data).flatMap(([name, result]) => result.error ? [`${name}: ${result.error}`] : []);
    return {
      data,
      asOf: timestamps.sort().at(-1) || null,
      stale: Object.values(data).some(result => result.stale || result.data == null),
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
    },
  };
  return adapter;
}
