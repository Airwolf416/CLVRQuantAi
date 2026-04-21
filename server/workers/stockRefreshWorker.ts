// ── Stock / Equity Refresh Worker — CLVRQuantAI ───────────────────────────────
// Polls Yahoo Finance every 30 s (parallel /v8/chart calls) for equities,
// forex, and commodities. FMP /stable/quote is a per-symbol fallback for
// any Yahoo miss (free tier — single-quote endpoint only). Replaces the
// prior Finnhub per-symbol REST loop and FH WebSocket entirely.
//
// Output: cache["finnhub"] (key kept for backward compat with existing readers).
// New callers should prefer cache["marketdata"] which we also write.

import { EQUITY_SYMS, EQUITY_BASE, FOREX_BASE, METALS_BASE } from "../config/assets";
import { cache, livePrices, recordPrice, broadcastSSE } from "../state";
import { fmpQuoteSafe, isFmpConfigured } from "../services/fmp";
import { yahooQuoteBatch } from "../services/yahoo";
import { fetchMetals, fetchEnergyCommodities, fetchForex } from "../services/marketData";
import { createRepeatableWorker } from "./queue";
import { getIO } from "../socketServer";

const STOCK_INTERVAL_MS = 30_000;

// ── Single tick: fetch all equities + metals + forex via Yahoo in parallel ───

export async function runStockTick(): Promise<void> {
  const [stocksRaw, fxRaw, metalsRaw, energyRaw] = await Promise.all([
    yahooQuoteBatch(EQUITY_SYMS),
    fetchForex(),                 // yahoo primary + ExchangeRate-API fallback
    fetchMetals(),                // yahoo primary + gold-api fallback
    fetchEnergyCommodities(),     // yahoo primary
  ]);

  // Normalise stocks: ensure base price for any Yahoo miss; FMP fallback
  // (single-quote /stable/quote is the only free-tier endpoint that works)
  // is invoked sparingly — only for symbols Yahoo failed on.
  const stocks: Record<string, any> = {};
  const fmpFallbackSyms: string[] = [];
  for (const sym of EQUITY_SYMS) {
    const q = stocksRaw[sym];
    if (q && q.live) stocks[sym] = q;
    else fmpFallbackSyms.push(sym);
  }
  if (fmpFallbackSyms.length && isFmpConfigured()) {
    // Limit FMP fallback to 5 symbols per tick to preserve daily quota (250/day)
    const slice = fmpFallbackSyms.slice(0, 5);
    const fmpResults = await Promise.all(slice.map(s => fmpQuoteSafe(s)));
    slice.forEach((s, i) => { if (fmpResults[i].live) stocks[s] = fmpResults[i]; });
  }
  for (const sym of EQUITY_SYMS) {
    if (!stocks[sym]) {
      stocks[sym] = { price: EQUITY_BASE[sym] || 0, chg: 0, live: false };
    }
  }

  // VIX proxy via UVXY ETF (Yahoo)
  try {
    const vixMap = await yahooQuoteBatch(["UVXY"]);
    const vixQ = vixMap["UVXY"];
    if (vixQ?.live && vixQ.price > 0) {
      const approxVIX = vixQ.price * 0.65 + 12;
      recordPrice("VIX", approxVIX);
    }
  } catch {}

  const allMetals = { ...metalsRaw, ...energyRaw };

  // Update livePrices so any consumer reading from there (alerts, basket, SSE)
  // sees fresh data even though we no longer run a Finnhub WebSocket.
  const broadcast: Record<string, any> = {};
  const now = Date.now();
  for (const [sym, q] of Object.entries(stocks) as [string, any][]) {
    if (q.live && q.price > 0) {
      livePrices[sym] = { price: q.price, chg: q.chg, ts: now, type: "equity" };
      broadcast[sym] = { price: q.price, chg: q.chg, type: "equity" };
    }
  }
  for (const [sym, q] of Object.entries(allMetals) as [string, any][]) {
    if (q.live && q.price > 0) {
      livePrices[sym] = { price: q.price, chg: q.chg, ts: now, type: "metal" };
      broadcast[sym] = { price: q.price, chg: q.chg, type: "metal" };
    }
  }
  for (const [sym, q] of Object.entries(fxRaw) as [string, any][]) {
    if (q.live && q.price > 0) {
      livePrices[sym] = { price: q.price, chg: q.chg, ts: now, type: "forex" };
      broadcast[sym] = { price: q.price, chg: q.chg, type: "forex" };
    }
  }
  if (Object.keys(broadcast).length) {
    try { broadcastSSE(broadcast); } catch {}
    try { getIO()?.emit("market_update", broadcast); } catch {}
  }

  const payload = { stocks, metals: allMetals, forex: fxRaw };
  // Keep legacy key name for backward compat with all existing readers.
  cache["finnhub"] = { data: payload, ts: now };
  // New canonical key.
  cache["marketdata"] = { data: payload, ts: now };

  const liveCount = Object.values(stocks).filter((q: any) => q.live).length;
  const fxLive = Object.values(fxRaw).filter((q: any) => q.live).length;
  const cmLive = Object.values(allMetals).filter((q: any) => q.live).length;
  console.log(`[stock-worker] yahoo refresh: ${liveCount}/${EQUITY_SYMS.length} equities, ${fxLive}/${Object.keys(fxRaw).length} fx, ${cmLive}/${Object.keys(allMetals).length} commodities`);
}

// ── Start the worker ──────────────────────────────────────────────────────────

export function startStockRefreshWorker(): void {
  console.log(`[stock-worker] sources: yahoo=primary, fmp=${isFmpConfigured() ? "fallback (single-quote, max 5/tick)" : "off"}, exchangerate-api=fx-fallback, gold-api=metals-fallback`);

  const bullWorker = createRepeatableWorker(
    "clvr-stock-refresh",
    STOCK_INTERVAL_MS,
    async () => {
      try { await runStockTick(); }
      catch (e: any) { console.error("[stock-worker] tick error:", e.message); }
    }
  );

  if (bullWorker) {
    console.log("[stock-worker] BullMQ repeatable job started (every 30 s)");
    return;
  }

  console.log("[stock-worker] No Redis — running refresh via setInterval fallback (30 s)");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runStockTick(); }
    catch (e: any) { console.error("[stock-worker] tick error:", e.message); }
    finally { running = false; }
  };
  tick();
  setInterval(tick, STOCK_INTERVAL_MS);
}
