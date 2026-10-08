import { getYahooCandles } from "../../services/yahoo";
import type { RotationSourceResult } from "../types";

export type YahooMacroSymbol =
  | "DX-Y.NYB" | "^TNX" | "^VIX" | "^NDX" | "CL=F" | "GC=F"
  | "SPY" | "QQQ" | "TLT" | "BIL";
export type YahooMacroPayload = {
  series: Record<string, { symbol: string; observations: { t: number; value: number }[]; stale: boolean; error?: string }>;
};

const SYMBOLS: YahooMacroSymbol[] = [
  "DX-Y.NYB", "^TNX", "^VIX", "^NDX", "CL=F", "GC=F", "SPY", "QQQ", "TLT", "BIL",
];
const TTL_MS = 15 * 60_000;
let cached: { at: number; result: RotationSourceResult<YahooMacroPayload> } | null = null;

export function createYahooMacroSource(deps: {
  fetchCandles?: typeof getYahooCandles;
  now?: () => number;
} = {}) {
  const fetchCandles = deps.fetchCandles ?? getYahooCandles;
  const now = deps.now ?? Date.now;
  return {
    async fetch(asOf = new Date(now()).toISOString()): Promise<RotationSourceResult<YahooMacroPayload>> {
      if (cached && now() - cached.at < TTL_MS) return cached.result;
      const cutoff = Date.parse(asOf);
      if (!Number.isFinite(cutoff) || cutoff > now() + 60_000) {
        throw new Error("Yahoo macro as-of timestamp is invalid or in the future");
      }
      const entries = await Promise.all(SYMBOLS.map(async symbol => {
        try {
          // 600 calendar days provide at least 252 historical rolling 20-day changes.
          const candles = await fetchCandles(symbol, "1d", 600);
          const observations = candles
            .filter(candle => candle.t <= cutoff && Number.isFinite(candle.c) && candle.c > 0)
            .map(candle => ({ t: candle.t, value: candle.c }));
          return [symbol, {
            symbol,
            observations,
            stale: observations.length === 0,
            ...(observations.length ? {} : { error: "Yahoo returned no historical candles" }),
          }] as const;
        } catch {
          return [symbol, { symbol, observations: [], stale: true, error: "Yahoo historical request failed" }] as const;
        }
      }));
      const series = Object.fromEntries(entries);
      const available = Object.values(series).flatMap(row => row.observations.map(point => point.t));
      const result: RotationSourceResult<YahooMacroPayload> = available.length
        ? {
            data: { series },
            asOf: new Date(Math.max(...available)).toISOString(),
            stale: Object.values(series).some(row => row.stale),
            ...(Object.values(series).some(row => row.stale)
              ? { error: "One or more Yahoo macro or ladder series are unavailable" } : {}),
          }
        : { data: null, asOf: null, stale: true, error: "Yahoo returned no macro or ladder history" };
      cached = { at: now(), result };
      return result;
    },
  };
}
