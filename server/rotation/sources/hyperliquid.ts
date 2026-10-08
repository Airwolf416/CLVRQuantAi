import { hlData } from "../../state";
import { ROTATION_CONFIG } from "../config";
import type { RotationPerpMarket, RotationSourceResult } from "../types";

export function createHyperliquidSource(deps: { now?: () => number } = {}) {
  const now = deps.now || Date.now;
  return {
    async fetch(date?: string): Promise<RotationSourceResult<RotationPerpMarket[]>> {
      const today = new Date(now()).toISOString().slice(0, 10);
      if (date && date !== today) {
        throw new Error("Hyperliquid live market data cannot provide historical point-in-time data");
      }
      const maxAgeMs = 30 * 60 * 1000;
      const rows = ROTATION_CONFIG.source.perpSymbols.flatMap(symbol => {
        const item = hlData[symbol];
        if (!item || !item.ts || now() - item.ts > maxAgeMs
          || !Number.isFinite(item.funding) || !Number.isFinite(item.oi)
          || !Number.isFinite(item.perpPrice) || item.perpPrice <= 0) return [];
        return [{
          symbol,
          fundingRatePct: item.funding,
          openInterestUsd: item.oi,
          price: item.perpPrice,
          asOf: new Date(item.ts).toISOString(),
        }];
      });
      if (!rows.length) {
        return { data: null, asOf: null, stale: true, error: "No fresh Hyperliquid funding/OI data is available" };
      }
      const latest = rows.map(row => row.asOf).sort().at(-1)!;
      const missing = ROTATION_CONFIG.source.perpSymbols.length - rows.length;
      return {
        data: rows,
        asOf: latest,
        stale: missing > 0,
        ...(missing > 0 ? { error: `${missing} configured perp markets are missing or stale` } : {}),
      };
    },
  };
}
