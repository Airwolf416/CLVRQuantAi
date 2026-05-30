// ── Nasdaq Earnings Calendar (unofficial, free, no key) ────────────────────
// Nasdaq exposes a per-day earnings endpoint used by their public calendar UI:
//   GET https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
// Coverage is broad (hundreds of US-listed names/day) — used here to augment
// the FMP free-tier feed which is limited to a handful of US large-caps.
//
// Notes:
//   • Requires a browser-like User-Agent or the gateway returns HTML/403.
//   • Per-day endpoint — iterate over the requested range, dedupe by symbol+date.
//   • In-memory cache per-day (1h TTL) to avoid hammering on every request.

import type { EarningsRow } from "./finnhubEarnings";

const NASDAQ_BASE = "https://api.nasdaq.com/api/calendar/earnings";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DAY_TTL_MS = 60 * 60 * 1000;

type DayCacheEntry = { ts: number; data: EarningsRow[] };
const dayCache = new Map<string, DayCacheEntry>();

function parseDollar(s: any): number | null {
  if (s == null) return null;
  const m = String(s).replace(/[$,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
}

// Surfaced via the route so /api/earnings/calendar can report blocked status
// to the client (and we can spot Railway-IP blocking in production).
export type NasdaqDiag = { ok: number; failed: number; lastError?: string; lastStatus?: number };
let lastDiag: NasdaqDiag = { ok: 0, failed: 0 };
export function getNasdaqDiag(): NasdaqDiag { return { ...lastDiag }; }

async function fetchOneDay(date: string, diag: NasdaqDiag): Promise<EarningsRow[]> {
  const cached = dayCache.get(date);
  if (cached && Date.now() - cached.ts < DAY_TTL_MS) { diag.ok++; return cached.data; }
  try {
    const url = `${NASDAQ_BASE}?date=${encodeURIComponent(date)}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.nasdaq.com/market-activity/earnings",
        Origin: "https://www.nasdaq.com",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) { diag.lastStatus = r.status; throw new Error(`nasdaq ${r.status}`); }
    // Some block-pages return 200 with HTML — detect by content-type and fall through.
    const ct = r.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("json")) { diag.lastError = `non-json ct=${ct}`; diag.failed++; return []; }
    const j: any = await r.json();
    const rows: any[] = (j?.data?.rows || []) as any[];
    const out: EarningsRow[] = rows
      .map(d => ({
        symbol: String(d?.symbol || "").toUpperCase(),
        date,
        epsActual: null,
        epsEstimated: parseDollar(d?.epsForecast),
        revenueActual: null,
        revenueEstimated: null,
        lastUpdated: undefined,
      }))
      .filter(r => r.symbol);
    dayCache.set(date, { ts: Date.now(), data: out });
    diag.ok++;
    return out;
  } catch (e: any) {
    diag.failed++;
    diag.lastError = e?.message || String(e);
    console.warn(`[nasdaq-earnings] day ${date} failed:`, e?.message || e);
    return [];
  }
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return out;
  // safety cap — never request more than 31 days in one call
  const days = Math.min(31, Math.floor((t.getTime() - f.getTime()) / 86400000) + 1);
  for (let i = 0; i < days; i++) {
    const d = new Date(f.getTime() + i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function getNasdaqEarningsCalendar(from: string, to: string): Promise<EarningsRow[]> {
  const days = eachDay(from, to);
  if (days.length === 0) return [];
  // Parallel with per-day 5s timeout — total wall time bounded at ~5s regardless
  // of range size. Polite enough: cache absorbs repeated calls, and the actual
  // burst is small (≤31 requests per range).
  const diag: NasdaqDiag = { ok: 0, failed: 0 };
  const results = await Promise.all(days.map(d => fetchOneDay(d, diag)));
  lastDiag = diag;
  return results.flat();
}

export function isNasdaqEarningsConfigured(): boolean {
  // No key required.
  return true;
}
