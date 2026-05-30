// ── FMP IPO Service — CLVRQuantAI ──────────────────────────────────────────
// FMP is now used ONLY for the IPO calendar fallback (the morning brief + the
// Earnings tab's IPO section). ALL earnings data (calendar, per-symbol history,
// company profile) moved to Finnhub — see services/finnhubEarnings.ts.
//
// In-memory cache (5 min) keeps us under the 250 req/day free-tier quota.

const FMP_KEY = process.env.FMP_API_KEY || "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

type CacheEntry<T> = { ts: number; data: T };
const TTL_MS = 5 * 60 * 1000;

export function isFmpEarningsConfigured(): boolean {
  return !!FMP_KEY;
}

function fresh<T>(e: CacheEntry<T> | undefined, ttl: number = TTL_MS): T | null {
  if (!e) return null;
  if (Date.now() - e.ts > ttl) return null;
  return e.data;
}

// ── IPO Calendar (May 2026) ────────────────────────────────────────────────
// Wraps FMP's IPO calendar endpoint so the morning brief and the Earnings
// tab can flag incoming public listings (e.g. SPCX). Fail-open on any
// network/parse error — empty array degrades the IPO section to
// "no upcoming IPOs" rather than breaking the brief or the tab.

export type IpoRow = {
  symbol: string;
  company: string;
  date: string;          // YYYY-MM-DD
  exchange: string | null;
  priceRange: string | null;
  shares: number | null;
  marketCap: number | null;
};

const ipoCache = new Map<string, CacheEntry<IpoRow[]>>();

export async function getIpoCalendar(from: string, to: string): Promise<IpoRow[]> {
  if (!FMP_KEY) return [];
  const key = `${from}__${to}`;
  const cached = fresh(ipoCache.get(key));
  if (cached) return cached;
  // FMP exposes IPO calendar under /stable/ipo-calendar (preferred) with
  // fallback to /v3 path used by some plans.
  const tryUrls = [
    `${FMP_BASE}/ipos-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/ipo_calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${FMP_KEY}`,
  ];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const data: any[] = await r.json();
      if (!Array.isArray(data)) continue;
      const rows: IpoRow[] = data.map(d => ({
        symbol: String(d?.symbol || "").toUpperCase(),
        company: String(d?.company || d?.companyName || ""),
        date: String(d?.date || ""),
        exchange: d?.exchange ? String(d.exchange) : null,
        priceRange: d?.priceRange ? String(d.priceRange) : null,
        shares: d?.shares == null ? null : Number(d.shares),
        marketCap: d?.marketCap == null ? null : Number(d.marketCap),
      })).filter(r => r.symbol && r.date);
      rows.sort((a, b) => a.date.localeCompare(b.date));
      ipoCache.set(key, { ts: Date.now(), data: rows });
      return rows;
    } catch (e: any) {
      console.warn("[fmp-ipo] fetch failed:", e?.message || e);
    }
  }
  return [];
}
