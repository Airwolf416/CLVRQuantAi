// ── Shared In-Process State — CLVRQuantAI ─────────────────────────────────────
// All mutable data that background workers write and Express routes read.
// Because BullMQ workers with inline processors run in the same Node.js process,
// these plain objects are visible to every importer — no Redis serialisation
// needed for local/single-process operation.

import type { Response } from "express";

// ── Hyperliquid perp market data ──────────────────────────────────────────────
export const hlData: Record<string, {
  funding: number;
  oi: number;
  perpPrice: number;
  volume: number;
  dayChg: number;
}> = {};

// ── Rolling 15-min price history (all symbols) ────────────────────────────────
export const priceHistory: Record<string, { price: number; ts: number }[]> = {};

// ── Live equities / metals / forex prices (from Finnhub WS + REST fallback) ──
export const livePrices: Record<string, {
  price: number;
  chg: number;
  ts: number;
  type: string;
}> = {};

// ── Generic API response cache ────────────────────────────────────────────────
export const cache: Record<string, { data: any; ts: number }> = {};

// ── Metals daily-open reference (for % change calculation) ───────────────────
export const metalsRef: Record<string, { price: number; ts: number }> = {};

// ── SSE client registry ───────────────────────────────────────────────────────
export const sseClients: Set<Response> = new Set();

// ── Server-side price cache for alert checking ───────────────────────────────
export const serverPriceCache: Record<string, {
  price: number;
  chg: number;
  updatedAt: number;
}> = {};

export const alertLastFiredMs: Map<number, number> = new Map();

// ── Live trading signals (last 50) ───────────────────────────────────────────
export const liveSignals: any[] = [];
export let signalIdCounter = 10000;
export function nextSignalId(): number { return ++signalIdCounter; }

// ── Per-token news sentiment ──────────────────────────────────────────────────
export const tokenSentimentCache: Record<string, {
  score: number;
  label: string;
  bullish: number;
  bearish: number;
  ts: number;
}> = {};

// ── Cooldown tracking: last time a signal fired per symbol ───────────────────
export const lastSignalTime: Record<string, number> = {};

// ── Per-asset hourly signal log: timestamps (ms) per symbol for rate-cap ──────
export const perAssetSignalLog: Record<string, number[]> = {};

// ── Recent whale-size moves ───────────────────────────────────────────────────
export const whaleAlerts: { sym: string; ts: number; type: string; amount: string }[] = [];

// ── Macro event cache (populated by the macro-calendar route on each fetch) ──
// Use a single const object and mutate in-place so all importers always see the
// same reference (avoids stale-binding issues with CommonJS re-exports).
export const sharedMacroCache: { events: any[]; ts: number } = { events: [], ts: 0 };
export function updateSharedMacroCache(events: any[]): void {
  sharedMacroCache.events = events;
  sharedMacroCache.ts = Date.now();
}

// ── Helper: record a price tick into the 15-min rolling window ───────────────
export function recordPrice(sym: string, price: number): void {
  if (!price || price <= 0) return;
  const now = Date.now();
  if (!priceHistory[sym]) priceHistory[sym] = [];
  priceHistory[sym].push({ price, ts: now });
  priceHistory[sym] = priceHistory[sym].filter(p => now - p.ts < 15 * 60 * 1000);
}

// ── Helper: broadcast a message to all active SSE clients ────────────────────
export function broadcastSSE(data: Record<string, any>): void {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}
