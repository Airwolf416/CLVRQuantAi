// ── HardTrendFilter ──────────────────────────────────────────────────────────
// Publisher-stage gate (May 2026) — suppresses counter-trend signals UNLESS
// the archetype is MEAN_REVERSION_EXHAUSTION. Pure compute: caller supplies
// daily + (optional) hourly candles, this module decides PASS / SUPPRESS and
// returns trend metadata for shadow logging.
//
// Runs AFTER archetype classification, BEFORE the conviction cap, in all
// three publish pipelines (scanner, /analyze, /kronos). Feature-flagged via
// `hardTrendFilterEnabled()`; in shadow mode the candidate still publishes
// but a row is written to suppressed_signals with the would_suppress reason
// so the operator can validate the suppression rate before flipping the flag.
//
// Trend definition (per spec):
//   daily   : sign(EMA20_today − EMA20_7d_ago) AND price vs EMA20
//   hourly  : sign(EMA20_now − EMA20_24h_ago)
//   STRONG  : daily + hourly agree (purely informational; decision uses daily)

import { calcEMA } from "../services/ta";

export type TrendState = "UP" | "DOWN" | "NEUTRAL";

export interface TrendCandle {
  close: number;
}

export interface HardTrendFilterInput {
  direction: "LONG" | "SHORT";
  archetype?: string | null;            // classifier output, may be undefined
  currentPrice: number;
  dailyCandles: TrendCandle[];          // chronological, oldest → newest
  hourlyCandles?: TrendCandle[];        // optional; powers the STRONG flag
}

export interface HardTrendFilterResult {
  decision: "PASS" | "SUPPRESS";
  reason:
    | "neutral_trend_passes"
    | "trend_aligned"
    | "mean_reversion_exception"
    | "counter_trend_no_mean_rev_archetype"
    | "insufficient_data";
  trend: TrendState;
  intradayTrend: TrendState;
  strong: boolean;                       // true when daily + hourly agree
  diagnostics: {
    daily_ema20_now: number | null;
    daily_ema20_7d_ago: number | null;
    daily_slope_sign: -1 | 0 | 1 | null;
    hourly_ema20_now: number | null;
    hourly_ema20_24h_ago: number | null;
    hourly_slope_sign: -1 | 0 | 1 | null;
    archetype: string | null;
  };
}

const EMA_PERIOD = 20;
const DAILY_LOOKBACK_BARS = 7;     // EMA20 7d ago
const HOURLY_LOOKBACK_BARS = 24;   // EMA20 24h ago

function emaSliceLast(prices: number[]): number | null {
  if (prices.length < EMA_PERIOD) return null;
  const v = calcEMA(prices, EMA_PERIOD);
  return Number.isFinite(v) ? v : null;
}

function sign(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

// Daily trend: slope-of-EMA20 AND price-vs-EMA20 (per spec).
function classifyTrend(emaNow: number | null, emaPast: number | null, price: number): { trend: TrendState; slopeSign: -1 | 0 | 1 | null } {
  if (emaNow == null || emaPast == null || !Number.isFinite(price)) {
    return { trend: "NEUTRAL", slopeSign: null };
  }
  const slope = sign(emaNow - emaPast);
  if (slope > 0 && price > emaNow) return { trend: "UP", slopeSign: slope };
  if (slope < 0 && price < emaNow) return { trend: "DOWN", slopeSign: slope };
  return { trend: "NEUTRAL", slopeSign: slope };
}

// Hourly trend: slope-of-EMA20 ONLY (per spec — no price gate).
function classifyTrendSlopeOnly(emaNow: number | null, emaPast: number | null): { trend: TrendState; slopeSign: -1 | 0 | 1 | null } {
  if (emaNow == null || emaPast == null) {
    return { trend: "NEUTRAL", slopeSign: null };
  }
  const slope = sign(emaNow - emaPast);
  if (slope > 0) return { trend: "UP", slopeSign: slope };
  if (slope < 0) return { trend: "DOWN", slopeSign: slope };
  return { trend: "NEUTRAL", slopeSign: slope };
}

export function evaluateHardTrendFilter(input: HardTrendFilterInput): HardTrendFilterResult {
  const archetype = input.archetype ?? null;
  const isMeanRev = archetype === "MEAN_REVERSION_EXHAUSTION";

  const dailyCloses = (input.dailyCandles || []).map(c => Number(c.close)).filter(Number.isFinite);
  const hourlyCloses = (input.hourlyCandles || []).map(c => Number(c.close)).filter(Number.isFinite);

  // Need ≥ EMA period + lookback bars to compute the slope honestly.
  const dailyMinBars = EMA_PERIOD + DAILY_LOOKBACK_BARS;
  if (dailyCloses.length < dailyMinBars) {
    return {
      decision: "PASS",
      reason: "insufficient_data",
      trend: "NEUTRAL",
      intradayTrend: "NEUTRAL",
      strong: false,
      diagnostics: {
        daily_ema20_now: null,
        daily_ema20_7d_ago: null,
        daily_slope_sign: null,
        hourly_ema20_now: null,
        hourly_ema20_24h_ago: null,
        hourly_slope_sign: null,
        archetype,
      },
    };
  }

  const dailyEmaNow = emaSliceLast(dailyCloses);
  const dailyEmaPast = emaSliceLast(dailyCloses.slice(0, dailyCloses.length - DAILY_LOOKBACK_BARS));
  const { trend, slopeSign: dailySlopeSign } = classifyTrend(dailyEmaNow, dailyEmaPast, input.currentPrice);

  // Hourly trend is best-effort — feed runs anyway.
  let intradayTrend: TrendState = "NEUTRAL";
  let hourlyEmaNow: number | null = null;
  let hourlyEmaPast: number | null = null;
  let hourlySlopeSign: -1 | 0 | 1 | null = null;
  const hourlyMinBars = EMA_PERIOD + HOURLY_LOOKBACK_BARS;
  if (hourlyCloses.length >= hourlyMinBars) {
    hourlyEmaNow = emaSliceLast(hourlyCloses);
    hourlyEmaPast = emaSliceLast(hourlyCloses.slice(0, hourlyCloses.length - HOURLY_LOOKBACK_BARS));
    const h = classifyTrendSlopeOnly(hourlyEmaNow, hourlyEmaPast);
    intradayTrend = h.trend;
    hourlySlopeSign = h.slopeSign;
  }

  const strong = trend !== "NEUTRAL" && trend === intradayTrend;

  // Decision matrix per spec.
  let decision: "PASS" | "SUPPRESS" = "PASS";
  let reason: HardTrendFilterResult["reason"] = "neutral_trend_passes";

  if (trend === "NEUTRAL") {
    decision = "PASS";
    reason = "neutral_trend_passes";
  } else if (
    (trend === "UP" && input.direction === "SHORT") ||
    (trend === "DOWN" && input.direction === "LONG")
  ) {
    if (isMeanRev) {
      decision = "PASS";
      reason = "mean_reversion_exception";
    } else {
      decision = "SUPPRESS";
      reason = "counter_trend_no_mean_rev_archetype";
    }
  } else {
    decision = "PASS";
    reason = "trend_aligned";
  }

  return {
    decision,
    reason,
    trend,
    intradayTrend,
    strong,
    diagnostics: {
      daily_ema20_now: dailyEmaNow,
      daily_ema20_7d_ago: dailyEmaPast,
      daily_slope_sign: dailySlopeSign,
      hourly_ema20_now: hourlyEmaNow,
      hourly_ema20_24h_ago: hourlyEmaPast,
      hourly_slope_sign: hourlySlopeSign,
      archetype,
    },
  };
}

// Convenience helper: fetch the minimum candle history needed from Binance
// for crypto symbols (used by the auto-scanner which doesn't already have
// daily/hourly candles in scope). Fail-open: returns empty arrays on any
// network/parse error so the filter degrades to insufficient_data → PASS.
//
// Throttled with a 10-min per-symbol cache so the scanner's once-per-minute
// ticker loop doesn't hammer Binance — daily/hourly trend on majors moves
// glacially relative to that cadence.
const _trendCandleCache = new Map<string, { ts: number; daily: TrendCandle[]; hourly: TrendCandle[] }>();
const TREND_CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchBinanceTrendCandles(symbol: string): Promise<{
  dailyCandles: TrendCandle[];
  hourlyCandles: TrendCandle[];
}> {
  const key = symbol.toUpperCase();
  const cached = _trendCandleCache.get(key);
  if (cached && Date.now() - cached.ts < TREND_CACHE_TTL_MS) {
    return { dailyCandles: cached.daily, hourlyCandles: cached.hourly };
  }
  const pair = `${symbol.toUpperCase()}USDT`;
  const dailyLimit = EMA_PERIOD + DAILY_LOOKBACK_BARS + 2;       // ≈ 29 bars
  const hourlyLimit = EMA_PERIOD + HOURLY_LOOKBACK_BARS + 2;     // ≈ 46 bars
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const [dRes, hRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=${dailyLimit}`, { signal: ctrl.signal }),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=${hourlyLimit}`, { signal: ctrl.signal }),
    ]);
    const dRows = dRes.ok ? await dRes.json() : [];
    const hRows = hRes.ok ? await hRes.json() : [];
    const toCandles = (rows: any[]): TrendCandle[] =>
      Array.isArray(rows)
        ? rows.map(r => ({ close: Number(r[4]) })).filter(c => Number.isFinite(c.close))
        : [];
    const daily = toCandles(dRows);
    const hourly = toCandles(hRows);
    if (daily.length > 0 || hourly.length > 0) {
      _trendCandleCache.set(key, { ts: Date.now(), daily, hourly });
    }
    return { dailyCandles: daily, hourlyCandles: hourly };
  } catch {
    return { dailyCandles: [], hourlyCandles: [] };
  } finally {
    clearTimeout(t);
  }
}
