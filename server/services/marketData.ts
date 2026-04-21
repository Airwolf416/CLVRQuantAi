// ── Market Data Service — CLVRQuantAI ─────────────────────────────────────────
// Pure data-fetching functions shared by background workers and route handlers.
//
// MIGRATED: Finnhub → FMP (Financial Modeling Prep) for equities/forex/commodities.
// Crypto stays on Binance public REST (frontend now also opens Binance WS direct).

import {
  CRYPTO_SYMS, CRYPTO_BASE, EQUITY_BASE, EQUITY_SYMS,
  FOREX_BASE, METALS_BASE, BINANCE_SYMS, BINANCE_MAP,
} from "../config/assets";
import { hlData, metalsRef, recordPrice } from "../state";
import { fmpQuoteBatch, fmpQuoteSafe as _fmpQuoteSafe, fmpForex, fmpCommodities } from "./fmp";
import { yahooQuoteBatch, yahooForex, yahooCommodities } from "./yahoo";

export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Single-symbol quote — Yahoo primary, FMP fallback ────────────────────────
// Old Finnhub signature kept; the legacy apiKey arg is ignored.
export async function fhQuoteSafe(
  symbol: string,
  _legacyApiKey?: string,
): Promise<{ price: number; chg: number; live: boolean }> {
  const yf = await yahooQuoteBatch([symbol]);
  if (yf[symbol]?.live) return yf[symbol];
  return _fmpQuoteSafe(symbol);
}

// New name (preferred going forward).
export const quoteSafe = fhQuoteSafe;
export { fmpQuoteBatch };

// ── Forex rates (Yahoo primary → ExchangeRate-API fallback) ──────────────────
export async function fetchForex(): Promise<Record<string, any>> {
  const fx = await yahooForex();
  // Fall back to ExchangeRate-API for any pair Yahoo returned as not-live.
  const missing = Object.entries(fx).filter(([_, q]) => !q.live).map(([s]) => s);
  if (missing.length === 0) return fx;
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
    const cross: Record<string, { base: string; quote: string }> = {
      EURGBP: { base: "EUR", quote: "GBP" }, EURJPY: { base: "EUR", quote: "JPY" },
      GBPJPY: { base: "GBP", quote: "JPY" },
    };
    for (const sym of missing) {
      if (pairs[sym]) {
        const cfg = pairs[sym]; const rate = rates[cfg.to];
        if (rate) {
          const price = cfg.invert ? +(1 / rate).toFixed(4) : +rate.toFixed(4);
          const base = FOREX_BASE[sym];
          fx[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
        }
      } else if (cross[sym]) {
        const cfg = cross[sym]; const baseRate = rates[cfg.base]; const quoteRate = rates[cfg.quote];
        if (baseRate && quoteRate) {
          const price = +(quoteRate / baseRate).toFixed(4);
          const base = FOREX_BASE[sym];
          fx[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
        }
      }
    }
  } catch {/* keep FMP fallbacks */}
  return fx;
}

// ── Precious metals (gold-api.com SPOT primary → Yahoo futures fallback) ─────
// IMPORTANT: For XAU/XAG/PLATINUM/PALLADIUM we want true SPOT prices ($/oz)
// to match Bloomberg "Gold Spot" tabs. Yahoo's GC=F/SI=F/PL=F/PA=F are CME
// front-month FUTURES which trade $5–30 above spot due to contango. gold-api
// returns the LBMA spot fix in real time. Copper has no free spot feed →
// HG=F future is the standard quote. Energies stay futures (see fetchEnergyCommodities).
export async function fetchMetals(_legacyKey = ""): Promise<Record<string, any>> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const SPOT_MAP: Record<string, string> = {
    XAU: "XAU", XAG: "XAG", PLATINUM: "XPT", PALLADIUM: "XPD",
  };
  const out: Record<string, any> = {};

  // 1) gold-api.com SPOT (primary) — parallel
  const spotResults = await Promise.all(
    Object.entries(SPOT_MAP).map(async ([appSym, goldSym]) => {
      try {
        const r = await fetch(`https://api.gold-api.com/price/${goldSym}`,
          { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return [appSym, null] as const;
        const d: any = await r.json();
        if (!d?.price || d.price <= 0) return [appSym, null] as const;
        const now = Date.now();
        if (!metalsRef[appSym] || now - metalsRef[appSym].ts > DAY_MS) {
          metalsRef[appSym] = { price: d.price, ts: now };
        }
        const ref = metalsRef[appSym].price;
        return [appSym, {
          price: +d.price.toFixed(4),
          chg: ref ? +((d.price - ref) / ref * 100).toFixed(2) : 0,
          live: true,
        }] as const;
      } catch { return [appSym, null] as const; }
    })
  );
  for (const [sym, q] of spotResults) if (q) out[sym] = q;

  // 2) Yahoo futures fallback for any spot miss + COPPER (no free spot)
  const yf = await yahooCommodities();
  for (const sym of Object.keys(yf)) {
    if (!out[sym] || !out[sym].live) out[sym] = yf[sym];
  }
  // Ensure base price for any still-missing symbol
  for (const sym of Object.keys(SPOT_MAP)) {
    if (!out[sym]) out[sym] = { price: METALS_BASE[sym] || 0, chg: 0, live: false };
  }
  return out;
}

// ── Energy commodities (now handled by fmpCommodities; kept for compat) ──────
// Returns ONLY the energy subset so callers can ...spread merge into metals.
export async function fetchEnergyCommodities(_legacyKey = ""): Promise<Record<string, any>> {
  const all = await yahooCommodities();
  const energy: Record<string, any> = {};
  for (const k of ["WTI", "BRENT", "NATGAS"] as const) {
    energy[k] = all[k] || { price: METALS_BASE[k] || 0, chg: 0, live: false };
  }

  // Yahoo fallback for any energy contract FMP missed
  const YF_MAP: Record<string, string> = { WTI: "CL=F", BRENT: "BZ=F", NATGAS: "NG=F" };
  for (const [appSym, yfSym] of Object.entries(YF_MAP)) {
    if (energy[appSym]?.live) continue;
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=1d&range=2d`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; CLVRBot/1.0)" }, signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) continue;
      const json: any = await r.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice || meta.regularMarketPrice <= 0) continue;
      const price = meta.regularMarketPrice as number;
      const prevClose = (meta.chartPreviousClose || meta.previousClose || price) as number;
      const chg = prevClose > 0 ? +((price - prevClose) / prevClose * 100).toFixed(2) : 0;
      energy[appSym] = { price: +price.toFixed(3), chg, live: true };
    } catch {/* ignore */}
  }
  return energy;
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
