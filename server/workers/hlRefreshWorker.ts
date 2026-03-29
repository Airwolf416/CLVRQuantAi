// ── Hyperliquid Refresh Worker — CLVRQuantAI ──────────────────────────────────
// Fetches HL perp data every 5 s and updates the shared in-process state.
// When Redis is available, scheduling is managed by BullMQ (repeatable job).
// When Redis is unavailable, a plain setInterval is used as fallback.

import { hlData, recordPrice } from "../state";
import { HL_PERP_SYMS, HL_TO_APP } from "../config/assets";
import { createRepeatableWorker } from "./queue";

const HL_INTERVAL_MS = 5_000;

// ── Single tick: fetch allMids + metaAndAssetCtxs, update hlData + priceHistory

export async function runHlTick(onPricesUpdated: () => void): Promise<void> {
  const [r1, r2] = await Promise.all([
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: AbortSignal.timeout(5000),
    }),
    fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  const mids: any = await r1.json();
  const meta: any = await r2.json();
  const universe = meta[0].universe;
  const ctxs = meta[1];

  universe.forEach((asset: any, i: number) => {
    if (!HL_PERP_SYMS.includes(asset.name)) return;
    const appName = HL_TO_APP[asset.name] || asset.name;
    const markPx    = parseFloat(ctxs[i]?.markPx    || 0);
    const prevDayPx = parseFloat(ctxs[i]?.prevDayPx || 0);
    const dayChg    = prevDayPx > 0
      ? +((markPx - prevDayPx) / prevDayPx * 100).toFixed(2)
      : 0;

    hlData[appName] = {
      funding:   +(parseFloat(ctxs[i]?.funding     || 0) * 100).toFixed(4),
      oi:        parseFloat(ctxs[i]?.openInterest  || 0) * markPx,
      perpPrice: mids[asset.name] ? parseFloat(mids[asset.name]) : 0,
      volume:    parseFloat(ctxs[i]?.dayNtlVlm     || 0),
      dayChg,
    };
    if (markPx > 0) recordPrice(appName, markPx);
  });

  onPricesUpdated();
}

// ── Start the worker: BullMQ repeatable job when Redis is available, else setInterval

export function startHlRefreshWorker(onPricesUpdated: () => void): void {
  const bullWorker = createRepeatableWorker(
    "clvr-hl-refresh",
    HL_INTERVAL_MS,
    async () => {
      try { await runHlTick(onPricesUpdated); }
      catch (e: any) { console.error("[hl-worker] tick error:", e.message); }
    }
  );

  if (bullWorker) {
    console.log("[hl-worker] BullMQ repeatable job started (every 5 s)");
    return;
  }

  // Redis unavailable — use a plain async loop as fallback
  console.log("[hl-worker] No Redis — running HL refresh via setInterval fallback");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runHlTick(onPricesUpdated); }
    catch (e: any) { console.error("[hl-worker] tick error:", e.message); }
    finally { running = false; }
  };
  tick(); // fire immediately
  setInterval(tick, HL_INTERVAL_MS);
}
