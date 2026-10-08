import { ROTATION_CONFIG } from "../config";
import type { RotationMacroQuote, RotationMacroQuotes, RotationSourceResult } from "../types";
import { cachedRotationSource, fetchJson } from "./cache";

const FMP_BASE = "https://financialmodelingprep.com/stable/quote";

function validQuotes(value: unknown): value is RotationMacroQuotes {
  return !!value && Array.isArray((value as any).quotes)
    && Array.isArray((value as any).unavailableSymbols)
    && (value as any).quotes.every((quote: any) =>
      quote && typeof quote.symbol === "string" && Number.isFinite(quote.price)
      && typeof quote.asOf === "string");
}

function validQuoteRow(row: any): row is {
  price: number; changePercentage?: number; changesPercentage?: number; timestamp?: number;
} {
  return !!row && Number.isFinite(Number(row.price)) && Number(row.price) > 0;
}

export function createFmpSource() {
  return {
    async fetch(date?: string): Promise<RotationSourceResult<RotationMacroQuotes>> {
      const today = new Date().toISOString().slice(0, 10);
      if (date && date !== today) throw new Error("FMP live quotes cannot provide historical point-in-time data");
      const key = process.env.FMP_API_KEY;
      if (!key) {
        return { data: null, asOf: null, stale: true, error: "FMP_API_KEY is not configured" };
      }
      const result = await cachedRotationSource({
        key: "rotation:source:fmp:macro-quotes",
        ttlSeconds: ROTATION_CONFIG.source.freshTtlSeconds.fmp,
        load: async () => {
          const quotes: RotationMacroQuote[] = [];
          const unavailableSymbols: string[] = [];
          // FMP's currently available quote endpoint is single-symbol; keep the
          // daily call volume bounded and avoid its paid-only batch endpoints.
          for (const symbol of ROTATION_CONFIG.source.fmpMacroSymbols) {
            try {
              const url = `${FMP_BASE}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
              const payload = await fetchJson(url, "FMP");
              const row = Array.isArray(payload) ? payload[0] : null;
              if (!validQuoteRow(row)) {
                unavailableSymbols.push(symbol);
                continue;
              }
              const timestamp = Number(row.timestamp);
              quotes.push({
                symbol,
                price: Number(row.price),
                changePercent: Number.isFinite(Number(row.changePercentage ?? row.changesPercentage))
                  ? Number(row.changePercentage ?? row.changesPercentage) : null,
                asOf: Number.isFinite(timestamp) && timestamp > 0
                  ? new Date(timestamp * 1000).toISOString()
                  : new Date().toISOString(),
              });
            } catch {
              unavailableSymbols.push(symbol);
            }
          }
          if (!quotes.length) throw new Error("FMP returned no valid macro quotes");
          return { quotes, unavailableSymbols } satisfies RotationMacroQuotes;
        },
        validate: validQuotes,
        timestamp: payload => payload.quotes.map(quote => quote.asOf).sort().at(-1) || null,
      });
      const missing = result.data?.unavailableSymbols.length || 0;
      return missing
        ? { ...result, stale: true, error: `${missing} configured FMP quotes are unavailable` }
        : result;
    },
  };
}
