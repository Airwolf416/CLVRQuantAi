// ============================================================================
// Coinglass liquidation-heatmap client.
//
// Returns normalized cluster objects for use by the signal-hardening
// liquidity gate. Behaviour:
//   • If COINGLASS_API_KEY is unset → returns [] silently (gate becomes no-op,
//     hardening logs a soft COINGLASS_UNAVAILABLE note once per asset/hour).
//   • If the API call fails → returns [] and logs a soft note (fail-open).
//   • Successful responses are cached per-asset for 60s to stay inside rate
//     limits even when the auto-scanner ticks aggressively.
//
// Threshold for "significant cluster" is applied here so the gate stays simple:
//   notional_usd ≥ max($500k, 0.5% of 24h volume).
// ============================================================================

import { logRejection } from "../lib/rejectionLog";

export interface LiquidityCluster {
  price:        number;
  notionalUsd:  number;
  side:         "LONG" | "SHORT";   // which side gets liquidated at this price
  distancePct:  number;             // signed % from currentPrice (negative = below)
}

const CACHE_TTL_MS   = 60 * 1000;
const SOFT_LOG_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; clusters: LiquidityCluster[] }>();
const lastSoftLog = new Map<string, number>();

function softLog(token: string, detail: string): void {
  const now = Date.now();
  const last = lastSoftLog.get(token) || 0;
  if (now - last < SOFT_LOG_TTL_MS) return;
  lastSoftLog.set(token, now);
  // Soft-log via rejection log so the admin dashboard sees Coinglass health
  // (this is NOT a signal rejection; "OTHER" reason with detail prefix).
  logRejection({ source: "auto_scanner", token, direction: null, reason: "OTHER", detail: `COINGLASS_UNAVAILABLE: ${detail}` });
}

// 24h volume lookup helper — best-effort; passing 0 falls back to the $500k floor.
function clusterNotionalThreshold(volume24hUsd: number): number {
  return Math.max(500_000, volume24hUsd * 0.005);
}

interface RawHeatmapPoint { price: number; long_qty?: number; short_qty?: number }

// Normalises a Coinglass v3 liquidation-map response into our cluster format.
// The API exposes per-price aggregated long/short liquidation notional; we
// keep only the clusters that exceed the per-asset threshold and tag each
// with the side that gets liquidated there.
function normalizeHeatmap(points: RawHeatmapPoint[], currentPrice: number, threshold: number): LiquidityCluster[] {
  const out: LiquidityCluster[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    const longN  = Number(p.long_qty  || 0) * p.price;
    const shortN = Number(p.short_qty || 0) * p.price;
    if (longN >= threshold) out.push({ price: p.price, notionalUsd: longN,  side: "LONG",  distancePct: ((p.price - currentPrice) / currentPrice) * 100 });
    if (shortN >= threshold) out.push({ price: p.price, notionalUsd: shortN, side: "SHORT", distancePct: ((p.price - currentPrice) / currentPrice) * 100 });
  }
  return out;
}

export async function getLiquidityClusters(token: string, currentPrice: number, volume24hUsd = 0): Promise<LiquidityCluster[]> {
  const apiKey = process.env.COINGLASS_API_KEY;
  if (!apiKey) {
    softLog(token, "no API key configured");
    return [];
  }
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && (now - hit.ts) < CACHE_TTL_MS) return hit.clusters;

  // Coinglass v3 liquidation heatmap (futures, all exchanges, 12h window).
  // If the endpoint shape changes, the fail-open path keeps signals flowing.
  const url = `https://open-api-v3.coinglass.com/api/futures/liquidation/heatmap?symbol=${encodeURIComponent(token)}&interval=12h`;
  try {
    const r = await fetch(url, { headers: { "CG-API-KEY": apiKey, "accept": "application/json" } });
    if (!r.ok) {
      softLog(token, `http ${r.status}`);
      cache.set(token, { ts: now, clusters: [] });
      return [];
    }
    const j: any = await r.json();
    // Defensive: response shape varies by endpoint version; tolerate both
    // {data: {liq: [{price, long_qty, short_qty}, ...]}} and {data: [...]}.
    const points: RawHeatmapPoint[] = Array.isArray(j?.data) ? j.data
      : Array.isArray(j?.data?.liq) ? j.data.liq
      : Array.isArray(j?.data?.list) ? j.data.list
      : [];
    if (points.length === 0) {
      softLog(token, "empty heatmap payload");
      cache.set(token, { ts: now, clusters: [] });
      return [];
    }
    const threshold = clusterNotionalThreshold(volume24hUsd);
    const clusters = normalizeHeatmap(points, currentPrice, threshold);
    cache.set(token, { ts: now, clusters });
    return clusters;
  } catch (e: any) {
    softLog(token, e?.message || "network error");
    cache.set(token, { ts: now, clusters: [] });
    return [];
  }
}
