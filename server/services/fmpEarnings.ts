// ── FMP Earnings Service — CLVRQuantAI ─────────────────────────────────────
// Wraps two FMP /stable endpoints that ARE free-tier accessible:
//   GET /stable/earnings-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /stable/earnings?symbol=SYM
//
// In-memory cache (5 min) prevents thrashing the 250 req/day quota.

const FMP_KEY = process.env.FMP_API_KEY || "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

export type EarningsRow = {
  symbol: string;
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  lastUpdated?: string;
};

type CacheEntry<T> = { ts: number; data: T };
const TTL_MS = 5 * 60 * 1000;
const calendarCache = new Map<string, CacheEntry<EarningsRow[]>>();
const historyCache = new Map<string, CacheEntry<EarningsRow[]>>();

export function isFmpEarningsConfigured(): boolean {
  return !!FMP_KEY;
}

function fresh<T>(e: CacheEntry<T> | undefined): T | null {
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) return null;
  return e.data;
}

export async function getEarningsCalendar(from: string, to: string): Promise<EarningsRow[]> {
  if (!FMP_KEY) return [];
  const key = `${from}__${to}`;
  const cached = fresh(calendarCache.get(key));
  if (cached) return cached;
  try {
    const url = `${FMP_BASE}/earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${FMP_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`FMP earnings-calendar ${r.status}`);
    const data: any[] = await r.json();
    const rows: EarningsRow[] = (Array.isArray(data) ? data : []).map(d => ({
      symbol: String(d?.symbol || "").toUpperCase(),
      date: String(d?.date || ""),
      epsActual: d?.epsActual == null ? null : Number(d.epsActual),
      epsEstimated: d?.epsEstimated == null ? null : Number(d.epsEstimated),
      revenueActual: d?.revenueActual == null ? null : Number(d.revenueActual),
      revenueEstimated: d?.revenueEstimated == null ? null : Number(d.revenueEstimated),
      lastUpdated: d?.lastUpdated || undefined,
    })).filter(r => r.symbol && r.date);
    calendarCache.set(key, { ts: Date.now(), data: rows });
    return rows;
  } catch (e: any) {
    console.warn("[fmp-earnings] calendar failed:", e?.message || e);
    return [];
  }
}

export async function getEarningsHistory(symbol: string, limit = 8): Promise<EarningsRow[]> {
  if (!FMP_KEY || !symbol) return [];
  const sym = symbol.toUpperCase();
  const cached = fresh(historyCache.get(sym));
  if (cached) return cached.slice(0, limit);
  try {
    const url = `${FMP_BASE}/earnings?symbol=${encodeURIComponent(sym)}&apikey=${FMP_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`FMP earnings ${r.status}`);
    const data: any[] = await r.json();
    const rows: EarningsRow[] = (Array.isArray(data) ? data : []).map(d => ({
      symbol: String(d?.symbol || sym).toUpperCase(),
      date: String(d?.date || ""),
      epsActual: d?.epsActual == null ? null : Number(d.epsActual),
      epsEstimated: d?.epsEstimated == null ? null : Number(d.epsEstimated),
      revenueActual: d?.revenueActual == null ? null : Number(d.revenueActual),
      revenueEstimated: d?.revenueEstimated == null ? null : Number(d.revenueEstimated),
      lastUpdated: d?.lastUpdated || undefined,
    })).filter(r => r.date);
    // sort newest first
    rows.sort((a, b) => b.date.localeCompare(a.date));
    historyCache.set(sym, { ts: Date.now(), data: rows });
    return rows.slice(0, limit);
  } catch (e: any) {
    console.warn(`[fmp-earnings] history(${sym}) failed:`, e?.message || e);
    return [];
  }
}
