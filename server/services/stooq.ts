// ── Stooq.com market data — free CSV feed (no API key, ~real-time intraday) ──
// Used as PRIMARY source for FX + energy commodities. Solves Yahoo Finance
// data quality issues observed in prod:
//   • Yahoo FX (EURUSD=X, USDMXN=X) regularMarketTime is often 24h+ stale even
//     though `live:true` is reported.
//   • Yahoo BZ=F (Brent) suffers contract-roll glitches where the front-month
//     change rolls but `chartPreviousClose` stays on the old contract, producing
//     bogus −10% to −15% one-day "moves" and a price that lags actual ICE Brent
//     by $5–10. Stooq's CB.F continuous-contract is clean.
//
// One batched HTTPS call covers all 14 FX pairs + all 3 energy contracts; the
// CSV format is `Symbol,Date,Time,Open,High,Low,Close`. A 30 s in-memory cache
// + in-flight promise dedup keep the load on Stooq minimal even when both
// fetchForex() and fetchEnergyCommodities() fire concurrently.

export type Quote = { price: number; chg: number; live: boolean };

const STOOQ_FX: Record<string, string> = {
  EURUSD: "eurusd", GBPUSD: "gbpusd", USDJPY: "usdjpy", USDCHF: "usdchf",
  AUDUSD: "audusd", USDCAD: "usdcad", NZDUSD: "nzdusd", EURGBP: "eurgbp",
  EURJPY: "eurjpy", GBPJPY: "gbpjpy", USDMXN: "usdmxn", USDZAR: "usdzar",
  USDTRY: "usdtry", USDSGD: "usdsgd",
};

const STOOQ_ENERGY: Record<string, string> = {
  WTI: "cl.f", BRENT: "cb.f", NATGAS: "ng.f",
};

type Row = {
  symbol: string;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const CACHE_TTL_MS = 30_000;
let cache: { ts: number; data: { forex: Record<string, Quote>; energy: Record<string, Quote> } } | null = null;
let inFlight: Promise<{ forex: Record<string, Quote>; energy: Record<string, Quote> }> | null = null;

async function batchFetchRows(stooqSymbols: string[]): Promise<Record<string, Row>> {
  if (stooqSymbols.length === 0) return {};
  try {
    const url = `https://stooq.com/q/l/?s=${stooqSymbols.join("+")}&f=sd2t2ohlc&h&e=csv`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CLVRBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return {};
    const text = await r.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return {};
    const out: Record<string, Row> = {};
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      if (c.length < 7) continue;
      const sym = (c[0] || "").toUpperCase().trim();
      if (!sym || sym === "N/D") continue;
      const open = Number(c[3]);
      const high = Number(c[4]);
      const low = Number(c[5]);
      const close = Number(c[6]);
      if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
      if (open <= 0 || close <= 0) continue;
      out[sym] = { symbol: sym, date: c[1], time: c[2], open, high, low, close };
    }
    return out;
  } catch (e: any) {
    console.warn("[stooq] batch fetch failed:", e?.message || e);
    return {};
  }
}

// Stooq publishes quote timestamps in UTC. Parse "YYYY-MM-DD" + "HH:MM:SS"
// into a UNIX-ms epoch so callers can apply asset-class freshness gates.
function rowTimestampMs(row: Row): number | null {
  if (!row.date || !row.time) return null;
  const ms = Date.parse(`${row.date}T${row.time}Z`);
  return Number.isFinite(ms) ? ms : null;
}

// Asset-class max-age — anything older is rejected as stale and the caller
// falls back to Yahoo / ER-API. Keep generous enough to absorb normal weekend
// halts (FX 23/5, futures ~23/5) without flapping during the trading week.
//   FX     → 8 h  (covers weekend gap from Fri 22:00 UTC close to Sun 22:00)
//   Energy → 24 h (covers ICE/CME overnight gaps + weekend halt)
function rowToQuote(row: Row, dp: number, maxAgeMs: number): Quote {
  const ts = rowTimestampMs(row);
  const fresh = ts != null && Date.now() - ts <= maxAgeMs;
  // chg = intraday move (close vs session open). For FX and energy, overnight
  // gaps are small, so this is a close approximation of the "% chg today" that
  // Bloomberg's Net Chg displays. Avoids relying on Yahoo's stale/glitched
  // prevClose values which are the source of the very bug we're fixing.
  const chg = row.open > 0 ? +(((row.close - row.open) / row.open) * 100).toFixed(2) : 0;
  return { price: +row.close.toFixed(dp), chg, live: fresh };
}

const FX_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const ENERGY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function fetchAllUncached(): Promise<{ forex: Record<string, Quote>; energy: Record<string, Quote> }> {
  const allSyms = [...Object.values(STOOQ_FX), ...Object.values(STOOQ_ENERGY)];
  const rows = await batchFetchRows(allSyms);

  const forex: Record<string, Quote> = {};
  for (const [appSym, stooqSym] of Object.entries(STOOQ_FX)) {
    const r = rows[stooqSym.toUpperCase()];
    if (r) forex[appSym] = rowToQuote(r, 5, FX_MAX_AGE_MS);
  }

  const energy: Record<string, Quote> = {};
  for (const [appSym, stooqSym] of Object.entries(STOOQ_ENERGY)) {
    const r = rows[stooqSym.toUpperCase()];
    if (r) energy[appSym] = rowToQuote(r, 3, ENERGY_MAX_AGE_MS);
  }

  return { forex, energy };
}

export async function stooqAll(): Promise<{ forex: Record<string, Quote>; energy: Record<string, Quote> }> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = fetchAllUncached()
    .then((d) => {
      cache = { ts: Date.now(), data: d };
      inFlight = null;
      return d;
    })
    .catch((e) => {
      inFlight = null;
      throw e;
    });
  return inFlight;
}

export async function stooqForex(): Promise<Record<string, Quote>> {
  try {
    const { forex } = await stooqAll();
    return forex;
  } catch { return {}; }
}

export async function stooqEnergy(): Promise<Record<string, Quote>> {
  try {
    const { energy } = await stooqAll();
    return energy;
  } catch { return {}; }
}
