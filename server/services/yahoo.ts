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
