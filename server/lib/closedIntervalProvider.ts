import type { AuthoritativeInterval } from "./barrierObservation";
import { APP_TO_HL, CRYPTO_SYMS, HL_SCALE_FACTORS, NON_CRYPTO_ASSETS } from "../config/assets";
import { getYahooCandles, type YfCandle } from "../services/yahoo";

export const CLOSED_INTERVAL_VERSION = "authoritative_ohlc_1m_v1";
export const CLOSED_INTERVAL_MS = 60_000;

export type ClosedInterval = AuthoritativeInterval & {
  open: number;
  close: number;
  source: "hyperliquid_candleSnapshot" | "yahoo_chart";
  version: typeof CLOSED_INTERVAL_VERSION;
};

export type ClosedIntervalResult =
  | { kind: "AVAILABLE"; source: ClosedInterval["source"]; version: typeof CLOSED_INTERVAL_VERSION; intervals: ClosedInterval[] }
  | { kind: "UNAVAILABLE"; reason: string };

export type ClosedIntervalRequest = { symbol: string; startTs: number };

type ProviderDeps = {
  fetchFn?: typeof fetch;
  yahooCandles?: typeof getYahooCandles;
  nowMs?: number;
  concurrency?: number;
  timeoutMs?: number;
};

const cryptoSymbols = new Set(CRYPTO_SYMS.map(s => s.toUpperCase()));
const yahooTickerByDisplay = new Map<string, string>();
for (const group of Object.values(NON_CRYPTO_ASSETS)) {
  for (const asset of group) yahooTickerByDisplay.set(asset.display.toUpperCase(), asset.symbol);
}

function finitePositive(...values: number[]): boolean {
  return values.every(value => Number.isFinite(value) && value > 0);
}

function validateIntervals(intervals: ClosedInterval[], requestedStart: number, nowMs: number): ClosedIntervalResult {
  const source = intervals[0]?.source;
  if (!intervals.length) {
    if (requestedStart + CLOSED_INTERVAL_MS > nowMs) {
      return { kind: "AVAILABLE", source: "hyperliquid_candleSnapshot", version: CLOSED_INTERVAL_VERSION, intervals: [] };
    }
    return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_MISSING" };
  }
  if (intervals[0].startTs !== requestedStart) {
    return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_GAP" };
  }
  let previousEnd: number | null = null;
  for (const interval of intervals) {
    if (!finitePositive(interval.open, interval.high, interval.low, interval.close) ||
        interval.low > interval.high ||
        interval.startTs < requestedStart ||
        interval.endTs > nowMs ||
        interval.endTs - interval.startTs !== CLOSED_INTERVAL_MS ||
        (previousEnd != null && interval.startTs !== previousEnd)) {
      return {
        kind: "UNAVAILABLE",
        reason: previousEnd != null && interval.startTs !== previousEnd
          ? "AUTHORITATIVE_INTERVAL_GAP"
          : "AUTHORITATIVE_INTERVAL_INVALID",
      };
    }
    previousEnd = interval.endTs;
  }
  return {
    kind: "AVAILABLE",
    source: source!,
    version: CLOSED_INTERVAL_VERSION,
    intervals,
  };
}

function normalizeHl(raw: unknown, requestedStart: number, nowMs: number, rawSymbol: string): ClosedIntervalResult {
  if (!Array.isArray(raw)) return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_PROVIDER_ERROR" };
  const scale = HL_SCALE_FACTORS[rawSymbol] ?? 1;
  const intervals: ClosedInterval[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_INVALID" };
    const c = item as Record<string, unknown>;
    const startTs = Number(c.t);
    const rawEnd = Number(c.T);
    // Hyperliquid currently reports T as the inclusive final millisecond.
    // Accept an exclusive boundary too, but normalize both to [start,end).
    const endTs = rawEnd === startTs + CLOSED_INTERVAL_MS - 1 ? rawEnd + 1 : rawEnd;
    const open = Number(c.o) * scale, high = Number(c.h) * scale;
    const low = Number(c.l) * scale, close = Number(c.c) * scale;
    if (![startTs, rawEnd, endTs, open, high, low, close].every(Number.isFinite)) {
      return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_INVALID" };
    }
    // The in-progress candle may be returned by the API; it is never evidence.
    if (endTs > nowMs) continue;
    if (startTs < requestedStart) continue;
    intervals.push({
      startTs, endTs, open, high, low, close,
      authoritative: true,
      source: "hyperliquid_candleSnapshot",
      version: CLOSED_INTERVAL_VERSION,
    });
  }
  return validateIntervals(intervals, requestedStart, nowMs);
}

function normalizeYahoo(raw: YfCandle[], requestedStart: number, nowMs: number): ClosedIntervalResult {
  const intervals: ClosedInterval[] = [];
  for (const c of raw) {
    const startTs = Number(c.t), endTs = startTs + CLOSED_INTERVAL_MS;
    if (![startTs, c.o, c.h, c.l, c.c].every(Number.isFinite)) {
      return { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_INVALID" };
    }
    if (endTs > nowMs || startTs < requestedStart) continue;
    intervals.push({
      startTs, endTs, open: c.o, high: c.h, low: c.l, close: c.c,
      authoritative: true,
      source: "yahoo_chart",
      version: CLOSED_INTERVAL_VERSION,
    });
  }
  const validated = validateIntervals(intervals, requestedStart, nowMs);
  if (validated.kind === "AVAILABLE") validated.source = "yahoo_chart";
  return validated;
}

async function mapBounded<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * Fetches at most once per canonical app symbol. Callers should pass the
 * earliest required boundary for that symbol, so all rows in a resolver tick
 * share one bulk range response.
 */
export async function getClosedIntervals(
  requests: ClosedIntervalRequest[],
  deps: ProviderDeps = {},
): Promise<Map<string, ClosedIntervalResult>> {
  const results = new Map<string, ClosedIntervalResult>();
  if (!requests.length) return results;

  const grouped = new Map<string, number>();
  for (const request of requests) {
    const symbol = request.symbol.toUpperCase();
    const start = Math.ceil(request.startTs / CLOSED_INTERVAL_MS) * CLOSED_INTERVAL_MS;
    grouped.set(symbol, Math.min(grouped.get(symbol) ?? Infinity, start));
  }
  const nowMs = deps.nowMs ?? Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const yahooCandles = deps.yahooCandles ?? getYahooCandles;
  await mapBounded([...grouped], Math.max(1, deps.concurrency ?? 4), async ([symbol, startTs]) => {
    try {
      if (cryptoSymbols.has(symbol)) {
        const rawSymbol = APP_TO_HL[symbol] ?? symbol;
        const response = await fetchFn("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: { coin: rawSymbol, interval: "1m", startTime: startTs, endTime: nowMs },
          }),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 7_000),
        });
        if (!response.ok) throw new Error(`Hyperliquid ${response.status}`);
        results.set(symbol, normalizeHl(await response.json(), startTs, nowMs, rawSymbol));
        return;
      }
      const yahooTicker = yahooTickerByDisplay.get(symbol);
      if (!yahooTicker) {
        results.set(symbol, { kind: "UNAVAILABLE", reason: "CANONICAL_YAHOO_MAPPING_MISSING" });
        return;
      }
      // getYahooCandles is the existing, centrally maintained Yahoo client.
      // Seven days is its documented maximum for one-minute data.
      const lookbackDays = Math.max(1, Math.min(7, Math.ceil((nowMs - startTs) / 86_400_000)));
      results.set(symbol, normalizeYahoo(await yahooCandles(yahooTicker, "1m", lookbackDays), startTs, nowMs));
    } catch {
      results.set(symbol, { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_PROVIDER_ERROR" });
    }
  });
  return results;
}