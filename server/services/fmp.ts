// ── Financial Modeling Prep (FMP) Service — CLVRQuantAI ───────────────────────
// Replaces Finnhub for equities, forex, and commodities.
// Free/Starter tier: 250 req/day & 750 req/min — we batch aggressively.
//
// Endpoints used:
//   GET /api/v3/quote/{sym1,sym2,...}   → batched stock quotes (single call)
//   GET /api/v3/fx                       → all forex pairs in one call
//   GET /api/v3/quotes/commodity         → all commodity futures in one call
//
// Every function returns the same shape the rest of the app expects:
//   { price: number, chg: number, live: boolean }

import { EQUITY_BASE, FOREX_BASE, METALS_BASE } from "../config/assets";

// FMP migrated to /stable/* endpoints in Aug 2025; legacy /api/v3 returns 403.
// Free tier: only /stable/quote (single-symbol) works — all batch endpoints
// (batch-quote, batch-forex-quotes, batch-commodity-quotes, news, historical-chart)
// are restricted to paid plans. This service uses /stable/quote as a single-quote
// fallback only — Yahoo Finance is the primary data source.
const FMP_KEY = process.env.FMP_API_KEY || "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

export function isFmpConfigured(): boolean {
  return !!FMP_KEY;
}

type Quote = { price: number; chg: number; live: boolean };

const FALLBACK = (sym: string, table: Record<string, number>): Quote => ({
  price: table[sym] || 0,
  chg: 0,
  live: false,
});

// ── Single-symbol quote via /stable/quote (only free-tier endpoint) ──────────
export async function fmpQuoteSafe(symbol: string): Promise<Quote> {
  if (!FMP_KEY) return FALLBACK(symbol, EQUITY_BASE);
  try {
    const r = await fetch(
      `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) throw new Error(`FMP ${r.status}`);
    const data: any[] = await r.json();
    const row = Array.isArray(data) ? data[0] : null;
    const price = Number(row?.price);
    if (!price || price <= 0) throw new Error("no price");
    const chg = Number(row?.changePercentage ?? row?.changesPercentage ?? 0);
    return { price, chg: +chg.toFixed(2), live: true };
  } catch {
    return FALLBACK(symbol, EQUITY_BASE);
  }
}

// ── Sequential batch over /stable/quote (slow — use only for fallback) ───────
// NOTE: FMP free tier has 250 req/day. Calling this for 20 symbols every 30s
// would exhaust quota in ~6 minutes. Yahoo Finance is the primary path.
export async function fmpQuoteBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  if (!FMP_KEY || !symbols.length) {
    for (const s of symbols) out[s] = FALLBACK(s, EQUITY_BASE);
    return out;
  }
  const results = await Promise.all(symbols.map(s => fmpQuoteSafe(s)));
  symbols.forEach((s, i) => out[s] = results[i]);
  return out;
}

// ── All forex pairs — one call ────────────────────────────────────────────────
// NOTE: /stable/batch-forex-quotes is paid-only on FMP free tier. Yahoo handles
// forex in marketData.ts. This stub returns base-price fallbacks so callers
// retain the same shape; the Yahoo path is preferred upstream.
export async function fmpForex(): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  if (!FMP_KEY) {
    for (const s of Object.keys(FOREX_BASE)) out[s] = FALLBACK(s, FOREX_BASE);
    return out;
  }
  try {
    const r = await fetch(`${FMP_BASE}/batch-forex-quotes?apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`FMP fx ${r.status}`);
    const data: any[] = await r.json();
    // Map ticker like "EUR/USD" → "EURUSD"
    for (const row of data || []) {
      const t = String(row?.ticker || "").replace("/", "");
      const price = Number(row?.bid ?? row?.ask ?? row?.changes ? (row?.bid ?? row?.ask) : NaN);
      const ask = Number(row?.ask);
      const bid = Number(row?.bid);
      const mid = (ask && bid) ? (ask + bid) / 2 : (price || ask || bid);
      if (!t || !mid || mid <= 0) continue;
      if (!(t in FOREX_BASE)) continue;
      const base = FOREX_BASE[t];
      const chg = base ? +((mid - base) / base * 100).toFixed(2) : 0;
      out[t] = { price: +mid.toFixed(4), chg, live: true };
    }
  } catch (e: any) {
    console.warn("[fmp] forex failed:", e.message);
  }
  for (const s of Object.keys(FOREX_BASE)) {
    if (!out[s]) out[s] = FALLBACK(s, FOREX_BASE);
  }
  return out;
}

// ── All commodity futures — one call ──────────────────────────────────────────
// FMP returns symbols like GCUSD, SIUSD, CLUSD, BZUSD, NGUSD, HGUSD, PLUSD, PAUSD
const FMP_COMMODITY_MAP: Record<string, string> = {
  GCUSD: "XAU", SIUSD: "XAG", PLUSD: "PLATINUM", PAUSD: "PALLADIUM",
  HGUSD: "COPPER", CLUSD: "WTI", BZUSD: "BRENT", NGUSD: "NATGAS",
};

// NOTE: /stable/batch-commodity-quotes is paid-only on FMP free tier. Yahoo
// handles commodities in marketData.ts. This stub remains for plan-upgrade
// future-proofing.
export async function fmpCommodities(): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  if (!FMP_KEY) {
    for (const s of Object.keys(METALS_BASE)) out[s] = FALLBACK(s, METALS_BASE);
    return out;
  }
  try {
    const r = await fetch(`${FMP_BASE}/batch-commodity-quotes?apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`FMP commodities ${r.status}`);
    const data: any[] = await r.json();
    for (const row of data || []) {
      const fmpSym = String(row?.symbol || "");
      const appSym = FMP_COMMODITY_MAP[fmpSym];
      if (!appSym) continue;
      const price = Number(row?.price);
      if (!price || price <= 0) continue;
      const chg = Number(row?.changesPercentage ?? 0);
      out[appSym] = { price: +price.toFixed(3), chg: +chg.toFixed(2), live: true };
    }
  } catch (e: any) {
    console.warn("[fmp] commodities failed:", e.message);
  }
  for (const s of Object.keys(METALS_BASE)) {
    if (!out[s]) out[s] = FALLBACK(s, METALS_BASE);
  }
  return out;
}

// ── General market news (replaces Finnhub /news?category=general) ────────────
// NOTE: /stable/news/* is paid-only. The marketData layer prefers yahooNews().
export async function fmpStockNews(limit = 25): Promise<any[]> {
  if (!FMP_KEY) return [];
  try {
    const r = await fetch(
      `${FMP_BASE}/news/general-latest?limit=${limit}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error(`FMP news ${r.status}`);
    const data: any[] = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    console.warn("[fmp] news failed:", e.message);
    return [];
  }
}
