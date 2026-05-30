// ── Finnhub Earnings Service — CLVRQuantAI ─────────────────────────────────
// Single source of truth for ALL earnings data (calendar, per-symbol history,
// company profile). Replaces the former FMP earnings feed end-to-end. FMP
// remains ONLY for the separate IPO calendar feature (see fmpEarnings.ts).
//
// Free-tier Finnhub endpoints used:
//   GET /calendar/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD   — wide US coverage,
//        carries epsActual/epsEstimate + revenueActual/revenueEstimate.
//   GET /stock/earnings?symbol=SYM                          — quarterly EPS
//        surprises (EPS only — Finnhub free tier carries NO revenue history).
//   GET /stock/profile2?symbol=SYM                          — company name +
//        marketCapitalization (reported in millions USD).
//
// In-memory caches keep us well under the free-tier rate limit (60 req/min):
//   • calendar 5 min (forward-looking, changes intraday as actuals land)
//   • history  6 h  (past-quarter actuals are immutable)
//   • profile 24 h  (name/mktcap drift slowly)

const FINNHUB_KEY = process.env.FINNHUB_KEY || "";
const FINNHUB_BASE = "https://finnhub.io/api/v1";

export type EarningsRow = {
  symbol: string;
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  // Calendar-only metadata (absent on per-symbol history rows).
  hour?: string | null;
  quarter?: number | null;
  year?: number | null;
  lastUpdated?: string;
};

export type CompanyProfile = { companyName?: string; mktCap?: number };

type CacheEntry<T> = { ts: number; data: T };
const CALENDAR_TTL_MS = 5 * 60 * 1000;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const calendarCache = new Map<string, CacheEntry<EarningsRow[]>>();
const historyCache = new Map<string, CacheEntry<EarningsRow[]>>();
const profileCache = new Map<string, CacheEntry<CompanyProfile>>();

export function isFinnhubEarningsConfigured(): boolean {
  return !!FINNHUB_KEY;
}

function fresh<T>(e: CacheEntry<T> | undefined, ttl: number): T | null {
  if (!e) return null;
  if (Date.now() - e.ts > ttl) return null;
  return e.data;
}

const num = (v: any): number | null => (v == null || v === "" ? null : Number(v));

export async function getEarningsCalendar(from: string, to: string): Promise<EarningsRow[]> {
  if (!FINNHUB_KEY) return [];
  const key = `${from}__${to}`;
  const cached = fresh(calendarCache.get(key), CALENDAR_TTL_MS);
  if (cached) return cached;
  try {
    const url = `${FINNHUB_BASE}/calendar/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Finnhub calendar/earnings ${r.status}`);
    const data: any = await r.json();
    const list: any[] = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
    const rows: EarningsRow[] = list.map(d => ({
      symbol: String(d?.symbol || "").toUpperCase(),
      date: String(d?.date || ""),
      epsActual: num(d?.epsActual),
      epsEstimated: num(d?.epsEstimate),
      revenueActual: num(d?.revenueActual),
      revenueEstimated: num(d?.revenueEstimate),
      hour: d?.hour ? String(d.hour) : null,
      quarter: num(d?.quarter),
      year: num(d?.year),
    })).filter(r => r.symbol && r.date);
    calendarCache.set(key, { ts: Date.now(), data: rows });
    return rows;
  } catch (e: any) {
    console.warn("[finnhub-earnings] calendar failed:", e?.message || e);
    return [];
  }
}

// Per-symbol quarterly EPS surprises. Finnhub's free tier returns EPS only
// (no revenue) — revenue fields are always null here. Sorted newest-first to
// match the previous FMP history contract that downstream consumers rely on.
export async function getEarningsHistory(symbol: string, limit = 8): Promise<EarningsRow[]> {
  if (!FINNHUB_KEY || !symbol) return [];
  const sym = symbol.toUpperCase();
  const cached = fresh(historyCache.get(sym), HISTORY_TTL_MS);
  if (cached) return cached.slice(0, limit);
  try {
    const url = `${FINNHUB_BASE}/stock/earnings?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Finnhub stock/earnings ${r.status}`);
    const data: any[] = await r.json();
    const rows: EarningsRow[] = (Array.isArray(data) ? data : []).map(d => ({
      symbol: sym,
      date: String(d?.period || ""),
      epsActual: num(d?.actual),
      epsEstimated: num(d?.estimate),
      revenueActual: null,
      revenueEstimated: null,
    })).filter(r => r.date);
    rows.sort((a, b) => b.date.localeCompare(a.date));
    historyCache.set(sym, { ts: Date.now(), data: rows });
    return rows.slice(0, limit);
  } catch (e: any) {
    console.warn(`[finnhub-earnings] history(${sym}) failed:`, e?.message || e);
    return [];
  }
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  if (!FINNHUB_KEY || !symbol) return {};
  const sym = symbol.toUpperCase();
  const cached = fresh(profileCache.get(sym), PROFILE_TTL_MS);
  if (cached) return cached;
  try {
    const url = `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`Finnhub profile2 ${r.status}`);
    const d: any = await r.json();
    // marketCapitalization is reported in millions of USD.
    const mc = num(d?.marketCapitalization);
    const profile: CompanyProfile = {
      companyName: d?.name ? String(d.name) : undefined,
      mktCap: mc == null ? undefined : mc * 1e6,
    };
    profileCache.set(sym, { ts: Date.now(), data: profile });
    return profile;
  } catch (e: any) {
    console.warn(`[finnhub-earnings] profile(${sym}) failed:`, e?.message || e);
    return {};
  }
}
