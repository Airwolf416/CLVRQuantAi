// ── Yahoo Finance Service — CLVRQuantAI ──────────────────────────────────────
// Free, public, no key. Used as the primary source for equities, forex, and
// commodities. The /v8/finance/chart endpoint reliably returns regularMarketPrice
// + chartPreviousClose for any ticker — equity, futures (=F), forex (=X).
//
// We parallelise with Promise.all and add a 5s per-call timeout to keep the
// tick budget tight (~20 equities + 14 fx + 7 commodities ≈ 4 s wall-clock).

import { EQUITY_BASE, FOREX_BASE, METALS_BASE } from "../config/assets";

type Quote = { price: number; chg: number; live: boolean };

const UA = { "User-Agent": "Mozilla/5.0 (compatible; CLVRBot/2.0)" };
const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

// CLVR symbol → Yahoo ticker map (futures, forex pairs)
const YF_FOREX: Record<string, string> = {
  EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X", USDCHF: "USDCHF=X",
  AUDUSD: "AUDUSD=X", USDCAD: "USDCAD=X", NZDUSD: "NZDUSD=X", EURGBP: "EURGBP=X",
  EURJPY: "EURJPY=X", GBPJPY: "GBPJPY=X", USDMXN: "USDMXN=X", USDZAR: "USDZAR=X",
  USDTRY: "USDTRY=X", USDSGD: "USDSGD=X",
};

const YF_COMMODITY: Record<string, string> = {
  XAU: "GC=F", XAG: "SI=F", PLATINUM: "PL=F", PALLADIUM: "PA=F",
  COPPER: "HG=F", WTI: "CL=F", BRENT: "BZ=F", NATGAS: "NG=F",
};

// Single Yahoo fetch — returns {price, chg, live} or live=false on failure.
async function yfFetchOne(yfSym: string, base?: number): Promise<Quote> {
  try {
    const r = await fetch(
      `${CHART}/${encodeURIComponent(yfSym)}?interval=1d&range=2d`,
      { headers: UA, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const j: any = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice || meta.regularMarketPrice <= 0) {
      throw new Error("no price");
    }
    const price = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? price);
    const chg = prev > 0 ? +((price - prev) / prev * 100).toFixed(2) : 0;
    return { price: +price.toFixed(4), chg, live: true };
  } catch {
    return { price: base ?? 0, chg: 0, live: false };
  }
}

// ── Batched equity quote — Promise.all over /v8/chart ────────────────────────
export async function yahooQuoteBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const q = await yfFetchOne(sym, EQUITY_BASE[sym]);
      return [sym, q] as const;
    })
  );
  for (const [sym, q] of results) out[sym] = q;
  return out;
}

// ── All forex pairs in our basket ────────────────────────────────────────────
export async function yahooForex(): Promise<Record<string, Quote>> {
  const syms = Object.keys(FOREX_BASE);
  const out: Record<string, Quote> = {};
  const results = await Promise.all(
    syms.map(async (sym) => {
      const yf = YF_FOREX[sym] || `${sym}=X`;
      const q = await yfFetchOne(yf, FOREX_BASE[sym]);
      return [sym, q] as const;
    })
  );
  for (const [sym, q] of results) out[sym] = q;
  return out;
}

// ── All commodity futures in our basket ──────────────────────────────────────
export async function yahooCommodities(): Promise<Record<string, Quote>> {
  const syms = Object.keys(YF_COMMODITY).filter(s => s in METALS_BASE);
  const out: Record<string, Quote> = {};
  const results = await Promise.all(
    syms.map(async (sym) => {
      const q = await yfFetchOne(YF_COMMODITY[sym], METALS_BASE[sym]);
      return [sym, q] as const;
    })
  );
  for (const [sym, q] of results) out[sym] = q;
  return out;
}

// ── Intraday OHLCV candles for non-crypto assets ─────────────────────────────
// Uses /v8/finance/chart with interval+range pulled from indicators[quote][0].
// Symbol passes through unchanged so callers can use the Yahoo ticker directly
// (e.g. "EURUSD=X", "GC=F", "SPY"). Returns an array of {t,o,h,l,c,v}, the
// shape `computeQuantIndicators()` expects.
export type YfCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function getYahooCandles(
  symbol: string,
  interval: "5m" | "15m" | "30m" | "1h" | "1d" = "1h",
  lookbackDays: number = 5
): Promise<YfCandle[]> {
  // Yahoo accepts: 1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo
  const yfInterval = interval === "1h" ? "60m" : interval;
  // Range needs to match interval granularity (1m≤7d, 5m/15m/30m/60m≤60d, 1d≤max)
  const range =
    interval === "1d" ? `${Math.max(lookbackDays, 30)}d`
    : `${Math.min(lookbackDays, 60)}d`;
  try {
    const r = await fetch(
      `${CHART}/${encodeURIComponent(symbol)}?interval=${yfInterval}&range=${range}`,
      { headers: UA, signal: AbortSignal.timeout(7000) }
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0];
    if (!ts.length || !q) return [];
    const out: YfCandle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ t: ts[i] * 1000, o: +o, h: +h, l: +l, c: +c, v: +(v ?? 0) });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Market session check (US Eastern) ─────────────────────────────────────────
// Returns true if the asset class is currently in its trading session.
// Crypto is always open. We use Intl with the America/New_York timezone so the
// check is correct regardless of server tz or DST.
export function isMarketOpen(assetClass: "forex" | "equity" | "commodity" | "crypto"): boolean {
  if (assetClass === "crypto") return true;

  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wkStr = parts.find(p => p.type === "weekday")?.value || "";
  const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dayMap[wkStr] ?? 1;
  const minutesET = hour * 60 + minute;

  if (assetClass === "forex") {
    // Open: Sun 17:00 ET → Fri 17:00 ET
    if (dow === 6) return false;                          // Saturday
    if (dow === 0 && minutesET < 17 * 60) return false;   // Sun before 5pm
    if (dow === 5 && minutesET >= 17 * 60) return false;  // Fri after 5pm
    return true;
  }
  if (assetClass === "equity") {
    // Open: Mon–Fri 09:30 → 16:00 ET
    if (dow === 0 || dow === 6) return false;
    return minutesET >= 9 * 60 + 30 && minutesET < 16 * 60;
  }
  if (assetClass === "commodity") {
    // Open: Sun 18:00 ET → Fri 17:00 ET (ignoring 1h daily maintenance break)
    if (dow === 6) return false;                          // Saturday
    if (dow === 0 && minutesET < 18 * 60) return false;   // Sun before 6pm
    if (dow === 5 && minutesET >= 17 * 60) return false;  // Fri after 5pm
    return true;
  }
  return true;
}

// ── General market news from Yahoo RSS (no key required) ─────────────────────
// Used as a free fallback for the news feed; returns FMP-style shape.
export async function yahooNews(limit = 25): Promise<any[]> {
  try {
    const r = await fetch(
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,^DJI&region=US&lang=en-US",
      { headers: UA, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return [];
    const xml = await r.text();
    const items: any[] = [];
    const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && items.length < limit) {
      items.push({
        title: m[1].trim(),
        url: m[2].trim(),
        site: "Yahoo Finance",
        publishedDate: new Date(m[3]).toISOString(),
      });
    }
    return items;
  } catch {
    return [];
  }
}
