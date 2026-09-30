// ── Hyperliquid Refresh Worker — CLVRQuantAI ──────────────────────────────────
// Fetches HL perp data every 5 s and updates the shared in-process state.
// When Redis is available, scheduling is managed by BullMQ (repeatable job).
// When Redis is unavailable, a plain setInterval is used as fallback.

import { hlData, recordPrice } from "../state";
import { HL_PERP_SYMS, HL_TO_APP, HL_SCALE_FACTORS } from "../config/assets";
import { createRepeatableWorker } from "./queue";
import { observeHyperliquidMeta } from "../lib/assetUniverse";

const HL_INTERVAL_MS = 5_000;

// ── Single tick: fetch allMids + metaAndAssetCtxs, update hlData + priceHistory

type HlTickDeps = {
  fetch?: typeof fetch;
  observe?: typeof observeHyperliquidMeta;
  now?: () => number;
};

export function validateHlResponses(mids: unknown, meta: unknown): {
  mids: Record<string, unknown>; universe: any[]; contexts: any[];
} | null {
  if (!mids || typeof mids !== "object" || Array.isArray(mids)
      || Object.getPrototypeOf(mids) !== Object.prototype
      || Object.values(mids).some(value => !Number.isFinite(Number(value)))) return null;
  if (!Array.isArray(meta) || meta.length !== 2
      || !meta[0] || typeof meta[0] !== "object"
      || !Array.isArray(meta[0].universe) || !Array.isArray(meta[1])
      || meta[0].universe.length !== meta[1].length) return null;
  return { mids: mids as Record<string, unknown>, universe: meta[0].universe, contexts: meta[1] };
}

export async function runHlTick(onPricesUpdated: () => void, deps: HlTickDeps = {}): Promise<boolean> {
  const request = deps.fetch || fetch;
  try {
  const [r1, r2] = await Promise.all([
    request("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: AbortSignal.timeout(5000),
    }),
    request("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  if (!r1.ok || !r2.ok) return false;
  let midsRaw: unknown;
  let meta: unknown;
  try {
    [midsRaw, meta] = await Promise.all([r1.json(), r2.json()]);
  } catch {
    return false;
  }
  const validated = validateHlResponses(midsRaw, meta);
  if (!validated) return false;
  const { mids, universe, contexts: ctxs } = validated;
  // Discovery cadence is advanced only after both upstream payloads validate.
  (deps.observe || observeHyperliquidMeta)(meta);

  universe.forEach((asset: any, i: number) => {
    if (!HL_PERP_SYMS.includes(asset.name)) return;
    const appName   = HL_TO_APP[asset.name] || asset.name;
    const scale     = HL_SCALE_FACTORS[asset.name] ?? 1; // e.g. kPEPE = 0.001
    const markPx    = parseFloat(ctxs[i]?.markPx    || 0) * scale;
    const prevDayPx = parseFloat(ctxs[i]?.prevDayPx || 0) * scale;
    const dayChg    = prevDayPx > 0
      ? +((markPx - prevDayPx) / prevDayPx * 100).toFixed(2)
      : 0;

    hlData[appName] = {
      funding:   +(parseFloat(ctxs[i]?.funding     || 0) * 100).toFixed(4),
      oi:        parseFloat(ctxs[i]?.openInterest  || 0) * markPx,
      perpPrice: mids[asset.name] ? Number(mids[asset.name]) * scale : 0,
      volume:    parseFloat(ctxs[i]?.dayNtlVlm     || 0),
      dayChg,
      ts:        (deps.now || Date.now)(), // Module 2: per-asset freshness for microstructure staleness
    };
    if (markPx > 0) recordPrice(appName, markPx);
  });

  onPricesUpdated();
  return true;
  } catch (error: any) {
    console.error("[hl-worker] tick error:", error?.message || error);
    return false;
  }
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
