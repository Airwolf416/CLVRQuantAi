// ── CLVRQuantAI — Unified Server-Side Data Bus ────────────────────────────────
// Runs on a 30-second interval and maintains a single shared cache that all
// API routes can read from. Eliminates per-request duplicate fetching.
//
// Data sources:
//   • hlData        — HL perp prices/funding/OI  (updated every 5 s by HL worker)
//   • livePrices    — Equity/metals/forex prices  (updated by Finnhub WS worker)
//   • sharedMacroCache — Macro calendar events    (updated by /api/macro route)
//   • alternative.me   — Fear & Greed index       (fetched by bus every 30 s)
//
// Consumers read via getDataBus() or getDataBusStatus() — zero external calls.
// ──────────────────────────────────────────────────────────────────────────────

import { hlData, livePrices, priceHistory, sharedMacroCache } from "./state";
import { calcRSI, calcMomentum } from "./services/ta";
import { CRYPTO_SYMS, EQUITY_SYMS } from "./config/assets";

// ── Bus state shape ────────────────────────────────────────────────────────────

export interface BusPriceEntry {
  price: number;
  change24h: number;
  high24?: number;
  low24?: number;
}

export interface BusRegime {
  score: number;
  label: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  trend: "bullish" | "bearish" | "sideways";
}

export interface BusFearGreed {
  value: number;
  classification: string;
  signal: string | null;
}

export interface BusKillSwitch {
  active: boolean;
  reason: string | null;
  expiresAt: number | null;
  nearest_event?: { name: string; time: string; date: string; hours_away: number } | null;
}

interface DataBusState {
  prices: Record<string, BusPriceEntry>;
  funding: Record<string, number>;
  oi: Record<string, number>;
  regime: BusRegime;
  fearGreed: BusFearGreed;
  macroEvents: any[];
  macroNews: any[];
  killSwitch: BusKillSwitch;
  lastUpdated: number;
}

// ── Singleton bus object ───────────────────────────────────────────────────────

const bus: DataBusState = {
  prices: {},
  funding: {},
  oi: {},
  regime: { score: 50, label: "NEUTRAL", trend: "sideways" },
  fearGreed: { value: 50, classification: "Neutral", signal: null },
  macroEvents: [],
  macroNews: [],
  killSwitch: { active: false, reason: null, expiresAt: null, nearest_event: null },
  lastUpdated: 0,
};

// ── External setters (called by routes.ts when those caches update) ────────────

export function setDataBusMacroNews(items: any[]): void {
  bus.macroNews = items;
}

// ── Read accessors ─────────────────────────────────────────────────────────────

export function getDataBus(): Readonly<DataBusState> {
  return bus;
}

export function getDataBusStatus() {
  return {
    prices: bus.prices,
    funding: bus.funding,
    oi: bus.oi,
    regime: bus.regime,
    fearGreed: bus.fearGreed,
    killSwitch: bus.killSwitch,
    macroEvents: bus.macroEvents,
    lastUpdated: bus.lastUpdated,
    freshness: bus.lastUpdated > 0 ? Date.now() - bus.lastUpdated : null,
  };
}

// ── Fear & Greed fetcher ───────────────────────────────────────────────────────

async function fetchFearAndGreed(): Promise<BusFearGreed> {
  try {
    const r = await fetch("https://api.alternative.me/fng/", {
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "CLVRQuant/2.0" },
    });
    if (!r.ok) return bus.fearGreed; // keep last known value on error
    const d: any = await r.json();
    const value = parseInt(d?.data?.[0]?.value || "50", 10);
    const classification = d?.data?.[0]?.value_classification || "Neutral";
    const signal = value <= 25 ? "sentiment_extreme_fear" : value >= 75 ? "sentiment_extreme_greed" : null;
    return { value, classification, signal };
  } catch {
    return bus.fearGreed; // keep last known value on network error
  }
}

// ── Kill switch computation (mirrors checkMacroKillSwitch in routes.ts) ────────

function computeKillSwitch(macroData: any[]): BusKillSwitch {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const now = Date.now();
  for (const evt of macroData) {
    if (evt.impact !== "HIGH" && evt.impact !== "⬛") continue;
    try {
      const timeStr = (evt.timeET || evt.time || "").replace(/\s*ET\s*/i, "").trim();
      const dateStr = evt.date || "";
      if (!dateStr || !timeStr || timeStr === "All Day" || timeStr === "Tentative") continue;
      const evtDate = new Date(`${dateStr} ${timeStr} EST`);
      if (isNaN(evtDate.getTime())) continue;
      const diff = evtDate.getTime() - now;
      if (diff > -60 * 60 * 1000 && diff < FOUR_HOURS_MS) {
        const hoursAway = Math.max(0, diff / (60 * 60 * 1000));
        return {
          active: true,
          reason: `HIGH IMPACT: ${evt.name} in ${hoursAway.toFixed(1)}h`,
          expiresAt: evtDate.getTime() + 60 * 60 * 1000,
          nearest_event: {
            name: evt.name,
            time: evt.timeET || evt.time,
            date: evt.date,
            hours_away: parseFloat(hoursAway.toFixed(1)),
          },
        };
      }
    } catch { /* skip */ }
  }
  return { active: false, reason: null, expiresAt: null, nearest_event: null };
}

// ── Regime computation (mirrors calcMarketRegime in routes.ts) ─────────────────

function computeRegime(): BusRegime {
  const btcHistory = priceHistory["BTC"];
  const btcMom = calcMomentum(btcHistory);
  const btcRsi = calcRSI(btcHistory, 14);
  const btcFunding = hlData["BTC"]?.funding || 0;

  let cryptoScore = 50;
  if (btcMom > 2) cryptoScore += 20; else if (btcMom > 0.5) cryptoScore += 10;
  else if (btcMom < -2) cryptoScore -= 20; else if (btcMom < -0.5) cryptoScore -= 10;
  if (btcRsi > 60) cryptoScore += 10; else if (btcRsi < 40) cryptoScore -= 10;
  if (btcFunding > 0.01) cryptoScore -= 5; else if (btcFunding < -0.01) cryptoScore += 5;
  cryptoScore = Math.max(0, Math.min(100, cryptoScore));

  const nasdaqMom = calcMomentum(priceHistory["NVDA"] || priceHistory["QQQ"]);
  const vixPrice = priceHistory["VIX"]?.[priceHistory["VIX"]?.length - 1]?.price || 0;
  let equityScore = 50;
  if (nasdaqMom > 1) equityScore += 15; else if (nasdaqMom > 0) equityScore += 5;
  else if (nasdaqMom < -1) equityScore -= 15; else if (nasdaqMom < 0) equityScore -= 5;
  if (vixPrice > 30) equityScore -= 25; else if (vixPrice > 25) equityScore -= 15;
  else if (vixPrice > 20) equityScore -= 5; else if (vixPrice < 15) equityScore += 10;
  equityScore = Math.max(0, Math.min(100, equityScore));

  const goldMom = calcMomentum(priceHistory["XAU"]);
  let metalsScore = 50;
  if (goldMom > 1) metalsScore -= 10; else if (goldMom < -1) metalsScore += 10;
  metalsScore = Math.max(0, Math.min(100, metalsScore));

  const eurMom = calcMomentum(priceHistory["EURUSD"]);
  const jpyMom = calcMomentum(priceHistory["USDJPY"]);
  const usdStrength = (-eurMom + jpyMom) / 2;
  let forexScore = 50;
  if (usdStrength > 0.5) forexScore -= 10; else if (usdStrength < -0.5) forexScore += 10;
  forexScore = Math.max(0, Math.min(100, forexScore));

  const score = Math.round(
    cryptoScore * 0.35 + equityScore * 0.35 + metalsScore * 0.15 + forexScore * 0.15,
  );
  const label = score >= 60 ? "RISK_ON" : score <= 40 ? "RISK_OFF" : "NEUTRAL";
  const trend = score >= 60 ? "bullish" : score <= 40 ? "bearish" : "sideways";

  return { score, label, trend };
}

// ── Main tick function ─────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  try {
    // 1. Pull crypto prices/funding/OI from hlData (kept fresh by HL worker every 5s)
    for (const sym of CRYPTO_SYMS) {
      const d = hlData[sym];
      if (d && d.perpPrice > 0) {
        bus.prices[sym] = { price: d.perpPrice, change24h: d.dayChg };
        bus.funding[sym] = d.funding;
        bus.oi[sym] = d.oi;
      }
    }

    // 2. Pull equity / metals / forex prices from livePrices (kept fresh by Finnhub WS)
    for (const [sym, d] of Object.entries(livePrices)) {
      if (d && d.price > 0) {
        // Don't overwrite crypto prices already set above
        if (!bus.prices[sym]) {
          bus.prices[sym] = { price: d.price, change24h: d.chg };
        }
      }
    }

    // 3. Compute market regime from live price history
    bus.regime = computeRegime();

    // 4. Sync macro events from shared cache (populated by /api/macro route)
    if (sharedMacroCache.events?.length > 0) {
      bus.macroEvents = sharedMacroCache.events;
    }

    // 5. Compute kill switch from current macro events
    bus.killSwitch = computeKillSwitch(bus.macroEvents);

    // 6. Fetch fear & greed index (external API — only on tick, not per request)
    bus.fearGreed = await fetchFearAndGreed();

    bus.lastUpdated = Date.now();
  } catch (e: any) {
    console.error("[databus] tick error:", e.message);
  }
}

// ── Start the bus ──────────────────────────────────────────────────────────────

let _started = false;

export function startDataBus(): void {
  if (_started) return;
  _started = true;

  // Initial tick fires immediately (async — don't await)
  tick().catch(e => console.error("[databus] initial tick error:", e.message));

  // Subsequent ticks every 30 seconds
  setInterval(() => {
    tick().catch(e => console.error("[databus] tick error:", e.message));
  }, 30_000);

  console.log("[databus] started — 30s refresh interval");
}
