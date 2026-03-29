// ── Market Data Service — CLVRQuantAI ─────────────────────────────────────────
// Pure data-fetching functions shared by background workers and route handlers.

import {
  CRYPTO_SYMS, CRYPTO_BASE, EQUITY_BASE, EQUITY_FH_MAP,
  FOREX_BASE, METALS_BASE, BINANCE_SYMS, BINANCE_MAP, HL_TO_APP,
} from "../config/assets";
import { hlData, metalsRef, recordPrice } from "../state";

export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Finnhub single-quote (safe — falls back to EQUITY_BASE on any error) ──────

export async function fhQuoteSafe(
  symbol: string,
  finnhubKey: string
): Promise<{ price: number; chg: number; live: boolean }> {
  if (!finnhubKey) return { price: EQUITY_BASE[symbol] || 0, chg: 0, live: false };
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.status === 429 || r.status === 503) throw new Error(`rate limited ${r.status}`);
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const d: any = await r.json();
    if (!d || !d.c || d.c === 0) throw new Error("zero price");
    return {
      price: d.c,
      chg: d.dp ?? (d.pc ? ((d.c - d.pc) / d.pc * 100) : 0),
      live: true,
    };
  } catch {
    return { price: EQUITY_BASE[symbol] || 0, chg: 0, live: false };
  }
}

// ── Forex rates (ExchangeRate-API) ────────────────────────────────────────────

export async function fetchForex(): Promise<Record<string, any>> {
  const forex: Record<string, any> = {};
  try {
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD",
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`ExchangeRate ${r.status}`);
    const data: any = await r.json();
    const rates = data.rates || {};

    const pairs: Record<string, { to: string; invert: boolean }> = {
      EURUSD: { to: "EUR", invert: true }, GBPUSD: { to: "GBP", invert: true },
      USDJPY: { to: "JPY", invert: false }, USDCHF: { to: "CHF", invert: false },
      AUDUSD: { to: "AUD", invert: true }, USDCAD: { to: "CAD", invert: false },
      NZDUSD: { to: "NZD", invert: true }, USDMXN: { to: "MXN", invert: false },
      USDZAR: { to: "ZAR", invert: false }, USDTRY: { to: "TRY", invert: false },
      USDSGD: { to: "SGD", invert: false },
    };
    const crossPairs: Record<string, { base: string; quote: string }> = {
      EURGBP: { base: "EUR", quote: "GBP" },
      EURJPY: { base: "EUR", quote: "JPY" },
      GBPJPY: { base: "GBP", quote: "JPY" },
    };

    for (const [sym, cfg] of Object.entries(pairs)) {
      const rate = rates[cfg.to];
      if (rate) {
        const price = cfg.invert ? +(1 / rate).toFixed(4) : +rate.toFixed(4);
        const base = FOREX_BASE[sym];
        forex[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
      } else {
        forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
      }
    }
    for (const [sym, cfg] of Object.entries(crossPairs)) {
      const baseRate = rates[cfg.base];
      const quoteRate = rates[cfg.quote];
      if (baseRate && quoteRate) {
        const price = +(quoteRate / baseRate).toFixed(4);
        const base = FOREX_BASE[sym];
        forex[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
      } else {
        forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
      }
    }
  } catch {
    for (const sym of Object.keys(FOREX_BASE)) {
      forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
    }
  }
  return forex;
}

// ── Precious metals + copper (gold-api.com + Finnhub ETF fallback) ────────────

export async function fetchMetals(finnhubKey = ""): Promise<Record<string, any>> {
  const metals: Record<string, any> = {};
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (const sym of ["XAU", "XAG", "XPT", "HG"] as const) {
    const appSym = sym === "XPT" ? "PLATINUM" : sym === "HG" ? "COPPER" : sym;
    try {
      const r = await fetch(`https://api.gold-api.com/price/${sym}`,
        { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d: any = await r.json();
        if (d?.price && d.price > 0) {
          const now = Date.now();
          if (!metalsRef[appSym] || now - metalsRef[appSym].ts > DAY_MS) {
            metalsRef[appSym] = { price: d.price, ts: now };
          }
          const ref = metalsRef[appSym].price;
          metals[appSym] = { price: d.price, chg: ref ? +((d.price - ref) / ref * 100).toFixed(2) : 0, live: true };
          continue;
        }
      }
    } catch { /* fall through to ETF proxy */ }

    const ETF_MAP: Record<string, { etfSym: string; factor: number }> = {
      XAU: { etfSym: "GLD", factor: 10.0 }, XAG: { etfSym: "SLV", factor: 10.0 },
      XPT: { etfSym: "PPLT", factor: 1.0 }, HG: { etfSym: "CPER", factor: 20.0 },
    };
    const cfg = ETF_MAP[sym];
    if (cfg && finnhubKey) {
      try {
        const q = await fhQuoteSafe(cfg.etfSym, finnhubKey);
        if (q.live && q.price > 0) {
          const price = +(q.price * cfg.factor).toFixed(2);
          const ref = metalsRef[appSym]?.price || METALS_BASE[appSym] || price;
          metals[appSym] = { price, chg: +((price - ref) / ref * 100).toFixed(2), live: true };
          continue;
        }
      } catch { /* ignore */ }
    }
    metals[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
  }
  return metals;
}

// ── Energy commodities via Finnhub OANDA CFD symbols (real-time, no delay) ────
// OANDA:WTICO_USD = WTI crude, OANDA:XBR_USD = Brent crude, OANDA:NATGAS_USD = Natural Gas
// WebSocket feed in routes.ts keeps livePrices current; this REST call is
// used for the periodic cache refresh and initial seed on worker startup.

const ENERGY_FH_SYMS: Record<string, { fhSym: string; appSym: string }> = {
  WTI:    { fhSym: "OANDA:WTICO_USD",  appSym: "WTI"    },
  BRENT:  { fhSym: "OANDA:XBR_USD",    appSym: "BRENT"  },
  NATGAS: { fhSym: "OANDA:NATGAS_USD", appSym: "NATGAS" },
};

export async function fetchEnergyCommodities(finnhubKey = ""): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 3600; // last hour of 1-minute candles

  await Promise.all(
    Object.entries(ENERGY_FH_SYMS).map(async ([key, { fhSym, appSym }]) => {
      if (!finnhubKey) {
        results[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
        return;
      }
      try {
        const url = `https://finnhub.io/api/v1/forex/candle?symbol=${fhSym}&resolution=1&from=${from}&to=${now}&token=${finnhubKey}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`Finnhub ${r.status}`);
        const json: any = await r.json();
        if (json.s !== "ok" || !Array.isArray(json.c) || !json.c.length) throw new Error("no data");
        const closes: number[] = json.c;
        const price = closes[closes.length - 1];
        if (!price || price <= 0) throw new Error("no price");
        // Use prior candle close for % change; fall back to METALS_BASE reference
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : 0;
        const base = prevClose > 0 ? prevClose : METALS_BASE[appSym] || price;
        const chg  = +((price - base) / base * 100).toFixed(2);
        results[appSym] = { price: +price.toFixed(3), chg, live: true };
      } catch (e: any) {
        console.warn(`[energy] ${key} Finnhub fetch failed:`, e.message);
        results[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
      }
    })
  );
  return results;
}

// ── Binance 24-hr ticker (crypto prices + HL perp overlay) ───────────────────
// NOTE: does NOT call detectMoves — callers are responsible for triggering detection.

export async function fetchBinancePrices(): Promise<Record<string, any>> {
  const symbols = encodeURIComponent(JSON.stringify(BINANCE_SYMS));
  const r = await fetch(
    `https://api.binance.us/api/v3/ticker/24hr?symbols=${symbols}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`Binance ${r.status}`);

  const data: any[] = await r.json();
  const reverseMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(BINANCE_MAP)) reverseMap[v] = k;

  const result: Record<string, any> = {};
  for (const t of data) {
    const sym = reverseMap[t.symbol];
    if (sym) {
      const price = parseFloat(t.lastPrice);
      if (price > 0) {
        recordPrice(sym, price);
        result[sym] = {
          price,
          chg: parseFloat(t.priceChangePercent),
          funding: hlData[sym]?.funding || 0,
          oi: hlData[sym]?.oi || 0,
          perpPrice: hlData[sym]?.perpPrice || 0,
          volume: hlData[sym]?.volume || 0,
          live: true,
        };
      }
    }
  }

  // Fill missing symbols from Hyperliquid mids
  const missingSym = CRYPTO_SYMS.filter(s => !result[s]);
  if (missingSym.length > 0) {
    try {
      const hlr = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        signal: AbortSignal.timeout(5000),
      });
      const mids: any = await hlr.json();
      for (const sym of missingSym) {
        if (mids[sym]) {
          const price = parseFloat(mids[sym]);
          recordPrice(sym, price);
          result[sym] = {
            price,
            chg: hlData[sym]?.dayChg ?? (CRYPTO_BASE[sym] ? +((price - CRYPTO_BASE[sym]) / CRYPTO_BASE[sym] * 100).toFixed(2) : 0),
            funding: hlData[sym]?.funding || 0,
            oi: hlData[sym]?.oi || 0,
            perpPrice: price,
            volume: hlData[sym]?.volume || 0,
            live: true,
          };
        }
      }
    } catch {}
  }

  return result;
}
