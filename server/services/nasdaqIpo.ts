// ── Nasdaq IPO Calendar (unofficial, free, no key) ─────────────────────────
// FMP's /stable/ipos-calendar is 403 "Restricted Endpoint" on the free tier,
// so we source IPOs from Nasdaq's public calendar endpoint instead:
//   GET https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM   (monthly)
// Response: data.{priced, upcoming, filed, withdrawn}, each {headers, rows}.
//   • priced   — IPOs that have already priced this month (real price/date)
//   • upcoming — scheduled but not yet priced (forward-looking)
// We surface priced + upcoming so the tab shows real "recent & upcoming" data.
//
// Notes:
//   • Requires a browser-like User-Agent or the gateway returns HTML/403.
//   • Monthly endpoint — iterate over the months spanning [from, to].
//   • In-memory cache per-month (30min TTL) to avoid hammering on each request.
//   • Nasdaq tends to IP-block datacenter egress (Railway) → diag surfaced.

import type { IpoRow } from "./fmpEarnings";

const NASDAQ_IPO_BASE = "https://api.nasdaq.com/api/ipo/calendar";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MONTH_TTL_MS = 30 * 60 * 1000;

type MonthCacheEntry = { ts: number; data: IpoRow[] };
const monthCache = new Map<string, MonthCacheEntry>();

export type NasdaqIpoDiag = { ok: number; failed: number; lastError?: string; lastStatus?: number };
let lastDiag: NasdaqIpoDiag = { ok: 0, failed: 0 };
export function getNasdaqIpoDiag(): NasdaqIpoDiag { return { ...lastDiag }; }

function parseDollar(s: any): number | null {
  if (s == null) return null;
  const m = String(s).replace(/[$,\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
}

function parseShares(s: any): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Nasdaq dates come as "M/D/YYYY" → normalize to "YYYY-MM-DD". Returns "" if unparseable.
function normalizeDate(s: any): string {
  if (!s) return "";
  const str = String(s).trim();
  // already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function mapRow(d: any): IpoRow | null {
  const symbol = String(d?.proposedTickerSymbol || "").toUpperCase().trim();
  if (!symbol) return null;
  const date = normalizeDate(d?.pricedDate || d?.expectedPriceDate || d?.filedDate || d?.date);
  if (!date) return null;
  const price = d?.proposedSharePrice ? String(d.proposedSharePrice).trim() : null;
  return {
    symbol,
    company: String(d?.companyName || "").trim(),
    date,
    exchange: d?.proposedExchange ? String(d.proposedExchange).trim() : null,
    priceRange: price ? `$${price}` : null,
    shares: parseShares(d?.sharesOffered),
    marketCap: parseDollar(d?.dollarValueOfSharesOffered),
  };
}

async function fetchOneMonth(month: string, diag: NasdaqIpoDiag): Promise<IpoRow[]> {
  const cached = monthCache.get(month);
  if (cached && Date.now() - cached.ts < MONTH_TTL_MS) { diag.ok++; return cached.data; }
  try {
    const r = await fetch(`${NASDAQ_IPO_BASE}?date=${encodeURIComponent(month)}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.nasdaq.com/market-activity/ipos",
        Origin: "https://www.nasdaq.com",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) { diag.lastStatus = r.status; throw new Error(`nasdaq ${r.status}`); }
    const ct = r.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("json")) { diag.lastError = `non-json ct=${ct}`; diag.failed++; return []; }
    const j: any = await r.json();
    const data = j?.data || {};
    // priced = already-listed (real price/date); upcoming = scheduled forward.
    const priced: any[] = data?.priced?.rows || [];
    const upcoming: any[] = data?.upcoming?.upcomingTable?.rows || data?.upcoming?.rows || [];
    const out = [...upcoming, ...priced]
      .map(mapRow)
      .filter((x): x is IpoRow => x != null);
    monthCache.set(month, { ts: Date.now(), data: out });
    diag.ok++;
    return out;
  } catch (e: any) {
    diag.failed++;
    diag.lastError = e?.message || String(e);
    console.warn(`[nasdaq-ipo] month ${month} failed:`, e?.message || e);
    return [];
  }
}

// Months (YYYY-MM) spanning [from, to] inclusive, capped at 4 to bound fan-out.
function monthsSpanning(from: string, to: string): string[] {
  const out: string[] = [];
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return out;
  let y = f.getUTCFullYear();
  let m = f.getUTCMonth();
  const endY = t.getUTCFullYear();
  const endM = t.getUTCMonth();
  while ((y < endY || (y === endY && m <= endM)) && out.length < 4) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

export async function getNasdaqIpoCalendar(from: string, to: string): Promise<IpoRow[]> {
  const months = monthsSpanning(from, to);
  if (months.length === 0) return [];
  const diag: NasdaqIpoDiag = { ok: 0, failed: 0 };
  const results = await Promise.all(months.map(mo => fetchOneMonth(mo, diag)));
  lastDiag = diag;
  // Flatten, restrict to the requested window, dedupe by symbol (keep first),
  // and sort newest-first so upcoming/most-recent surface at the top.
  const seen = new Set<string>();
  const rows: IpoRow[] = [];
  for (const r of results.flat()) {
    if (r.date < from || r.date > to) continue;
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    rows.push(r);
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

export function isNasdaqIpoConfigured(): boolean {
  // No key required.
  return true;
}
