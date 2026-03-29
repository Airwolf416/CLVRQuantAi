// ── Stock / Equity Refresh Worker — CLVRQuantAI ───────────────────────────────
// Polls Finnhub REST + metals + forex every 120 s, populating cache["finnhub"].
// When Redis is available, scheduling is managed by BullMQ.
// When Redis is unavailable, a plain async loop is used as fallback.

import { EQUITY_SYMS, EQUITY_FH_MAP, EQUITY_BASE } from "../config/assets";
import { cache, recordPrice } from "../state";
import { fhQuoteSafe, fetchMetals, fetchEnergyCommodities, fetchForex, delay } from "../services/marketData";
import { createRepeatableWorker } from "./queue";

const STOCK_INTERVAL_MS = 120_000;
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

// ── Single tick: fetch all equities, VIX proxy, metals, forex ─────────────────

export async function runStockTick(): Promise<void> {
  const stocks: Record<string, any> = {};

  for (const sym of EQUITY_SYMS) {
    const fhSym = EQUITY_FH_MAP[sym] || sym;
    const q = await fhQuoteSafe(fhSym, FINNHUB_KEY);
    if (!q.live) q.price = EQUITY_BASE[sym] || q.price;
    stocks[sym] = q;
    await delay(1500); // stay under Finnhub's free-tier rate limit
  }

  // VIX proxy via UVXY ETF
  try {
    const vixQ = await fhQuoteSafe("UVXY", FINNHUB_KEY);
    if (vixQ.live && vixQ.price > 0) {
      const approxVIX = vixQ.price * 0.65 + 12;
      recordPrice("VIX", approxVIX);
    }
  } catch {}

  const [metals, energy, forex] = await Promise.all([
    fetchMetals(FINNHUB_KEY),
    fetchEnergyCommodities(),
    fetchForex(),
  ]);

  // Merge energy futures into metals dict so basket pricing reads them via metalsKey
  const allMetals = { ...metals, ...energy };

  cache["finnhub"] = { data: { stocks, metals: allMetals, forex }, ts: Date.now() };
  console.log("[stock-worker] finnhub cache refreshed");
}

// ── Start the worker ──────────────────────────────────────────────────────────

export function startStockRefreshWorker(): void {
  const bullWorker = createRepeatableWorker(
    "clvr-stock-refresh",
    STOCK_INTERVAL_MS,
    async () => {
      try { await runStockTick(); }
      catch (e: any) { console.error("[stock-worker] tick error:", e.message); }
    }
  );

  if (bullWorker) {
    console.log("[stock-worker] BullMQ repeatable job started (every 120 s)");
    return;
  }

  // Redis unavailable — fall back to async loop
  console.log("[stock-worker] No Redis — running stock refresh via setInterval fallback");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runStockTick(); }
    catch (e: any) { console.error("[stock-worker] tick error:", e.message); }
    finally { running = false; }
  };
  tick(); // fire immediately on start
  setInterval(tick, STOCK_INTERVAL_MS);
}
