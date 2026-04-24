// ── Session VWAP + Opening Range Computation ────────────────────────────────
// Pulls 1-min OHLCV from the existing Yahoo data path, anchors to the asset
// class's session start, and returns:
//   - cumulative session VWAP + ±1σ bands
//   - opening-range high/low (ORH/ORL) over the first N minutes
//   - current price + relative position
//   - ORB status (pending / broken_up / broken_down / failed_breakout)
//
// In-memory cache, 30s TTL keyed by symbol.
// Returns null for any symbol that is not spot equity / spot FX / spot
// commodity — never partial payloads.

import { getYahooCandles, type YfCandle } from "../services/yahoo";
import {
  getExecutionAssetClass,
  getYahooTickerFor,
  getSessionAnchor,
  type ExecutionAssetClass,
} from "./executionOverlay";

export type ExecutionLevels = {
  symbol: string;
  asset_class: ExecutionAssetClass;
  anchor_ts: number;          // ms — session anchor used
  current_price: number;
  current_ts: number;         // ms — last bar close timestamp
  vwap: number;
  vwap_upper_1sd: number;
  vwap_lower_1sd: number;
  orh: number;
  orl: number;
  or_width_pct: number;       // (orh - orl) / orl * 100
  price_vs_vwap_pct: number;  // (price - vwap) / vwap * 100
  in_or_range: boolean;
  orb_status: "pending" | "broken_up" | "broken_down" | "failed_breakout";
  sample_count: number;       // bars in session
};

// ── In-memory cache ──────────────────────────────────────────────────────────
const TTL_MS = 30_000;
const cache = new Map<string, { exp: number; data: ExecutionLevels | null }>();

function cacheGet(sym: string): ExecutionLevels | null | undefined {
  const hit = cache.get(sym);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { cache.delete(sym); return undefined; }
  return hit.data;
}

function cacheSet(sym: string, data: ExecutionLevels | null): void {
  cache.set(sym, { exp: Date.now() + TTL_MS, data });
}

// ── Bars accessor (separate so the route can serve the same data set) ───────
// Returns the bars from session anchor to now. Uses Yahoo 1m endpoint.
export async function getSessionBars(symbol: string): Promise<YfCandle[]> {
  const cls = getExecutionAssetClass(symbol);
  if (!cls) return [];
  const yfTicker = getYahooTickerFor(symbol);
  if (!yfTicker) return [];
  const { anchorMs } = getSessionAnchor(cls);
  const bars = await getYahooCandles(yfTicker, "1m", 1);
  return bars.filter(b => b.t >= anchorMs);
}

// ── Core compute ─────────────────────────────────────────────────────────────
function computeFromBars(
  symbol: string,
  cls: ExecutionAssetClass,
  bars: YfCandle[],
  anchorMs: number,
  orMinutes: number
): ExecutionLevels | null {
  if (bars.length < 2) return null;

  // Effective anchor: spec anchor OR the first available bar — whichever is
  // later. Handles low-liquidity sessions (FX 22:00 UTC, where Yahoo often
  // skips the first hour of bars) by sliding the OR window to where actual
  // bars start. For liquid sessions (US equities at 13:30 UTC) the spec
  // anchor and bars[0].t coincide, so this is a no-op.
  const effectiveAnchorMs = Math.max(anchorMs, bars[0].t);
  const orEndMs = effectiveAnchorMs + orMinutes * 60_000;

  // Cumulative VWAP using typical price (h+l+c)/3, weighted by volume.
  // Skip rows with v=0 for the volume sum (Yahoo 1m sometimes emits flat
  // bars with no trades — including them double-counts the previous close).
  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;            // for variance (weighted second moment)
  let orh = -Infinity;
  let orl = Infinity;

  for (const b of bars) {
    const tp = (b.h + b.l + b.c) / 3;

    if (b.t >= effectiveAnchorMs && b.t < orEndMs) {
      if (b.h > orh) orh = b.h;
      if (b.l < orl) orl = b.l;
    }

    if (b.v > 0) {
      cumPV  += tp * b.v;
      cumPV2 += tp * tp * b.v;
      cumV   += b.v;
    }
  }

  // FX has v=0 from Yahoo (no exchange-level volume) — fall back to
  // equal-weighted typical price so VWAP still makes sense.
  if (cumV <= 0) {
    let sum = 0, sum2 = 0, n = 0;
    for (const b of bars) {
      const tp = (b.h + b.l + b.c) / 3;
      sum += tp; sum2 += tp * tp; n += 1;
    }
    if (n === 0) return null;
    cumPV = sum; cumPV2 = sum2; cumV = n;
  }

  const vwap = cumPV / cumV;
  const variance = Math.max(0, cumPV2 / cumV - vwap * vwap);
  const sd = Math.sqrt(variance);

  // If the OR window hasn't filled any bars yet (very first minute of
  // session), we cannot publish a level set — bail.
  if (!isFinite(orh) || !isFinite(orl)) return null;

  const last = bars[bars.length - 1];
  const price = last.c;

  // ORB classification — only meaningful once OR window has closed.
  let orb_status: ExecutionLevels["orb_status"] = "pending";
  if (last.t >= orEndMs) {
    // Look at all bars after the OR window.
    const post = bars.filter(b => b.t >= orEndMs);
    const everAbove = post.some(b => b.h > orh);
    const everBelow = post.some(b => b.l < orl);
    if (everAbove && price < orh && price > orl) orb_status = "failed_breakout";
    else if (everAbove && !everBelow) orb_status = "broken_up";
    else if (everBelow && !everAbove) orb_status = "broken_down";
    else if (everAbove && everBelow) orb_status = "failed_breakout";
    else orb_status = "pending";
  }

  return {
    symbol: symbol.toUpperCase(),
    asset_class: cls,
    anchor_ts: anchorMs,
    current_price: +price.toFixed(6),
    current_ts: last.t,
    vwap: +vwap.toFixed(6),
    vwap_upper_1sd: +(vwap + sd).toFixed(6),
    vwap_lower_1sd: +(vwap - sd).toFixed(6),
    orh: +orh.toFixed(6),
    orl: +orl.toFixed(6),
    or_width_pct: +((orh - orl) / orl * 100).toFixed(3),
    price_vs_vwap_pct: +((price - vwap) / vwap * 100).toFixed(3),
    in_or_range: price >= orl && price <= orh,
    orb_status,
    sample_count: bars.length,
  };
}

// ── Public entrypoint ────────────────────────────────────────────────────────
export async function computeExecutionLevels(symbol: string): Promise<ExecutionLevels | null> {
  const cls = getExecutionAssetClass(symbol);
  if (!cls) return null;

  const cached = cacheGet(symbol.toUpperCase());
  if (cached !== undefined) return cached;

  const yfTicker = getYahooTickerFor(symbol);
  if (!yfTicker) { cacheSet(symbol.toUpperCase(), null); return null; }

  const { anchorMs, orMinutes } = getSessionAnchor(cls);
  const bars = (await getYahooCandles(yfTicker, "1m", 1))
    .filter(b => b.t >= anchorMs);

  const result = computeFromBars(symbol, cls, bars, anchorMs, orMinutes);
  cacheSet(symbol.toUpperCase(), result);
  return result;
}

// ── Format helper for AI prompt context blocks ──────────────────────────────
export function formatExecutionContextBlock(lvl: ExecutionLevels): string {
  const dec = lvl.current_price < 10 ? 4 : 2;
  const fmt = (n: number) => n.toFixed(dec);
  const rangePos = lvl.in_or_range
    ? "inside"
    : lvl.current_price > lvl.orh ? "above" : "below";
  const ts = new Date(lvl.current_ts).toISOString().slice(11, 16) + " UTC";
  return [
    `EXECUTION CONTEXT (${lvl.symbol}, ${ts}):`,
    `- Session VWAP: $${fmt(lvl.vwap)} (price ${lvl.price_vs_vwap_pct >= 0 ? "+" : ""}${lvl.price_vs_vwap_pct}% away)`,
    `- VWAP bands: $${fmt(lvl.vwap_lower_1sd)} / $${fmt(lvl.vwap_upper_1sd)}`,
    `- Opening Range: $${fmt(lvl.orl)} — $${fmt(lvl.orh)} (width ${lvl.or_width_pct}%)`,
    `- Current price: $${fmt(lvl.current_price)} (${rangePos} opening range)`,
    `- ORB status: ${lvl.orb_status}`,
  ].join("\n");
}
