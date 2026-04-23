// ── Technical Analysis Service for CLVRQuantAI ────────────────────────────────
// All indicator calculations, pattern recognition, and scoring logic.
// Pure functions — no side effects, no external imports beyond config.

import { BACKTEST_WIN_RATES } from "../config/assets";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PricePoint { price: number; ts: number }
export interface Candle { c: number; h: number; l: number; o: number }

export interface ZScoreResult { zScore: number; label: string; pts: number }
export interface BollingerResult { breakout: boolean; pctFromBand: number; pts: number }
export interface PatternResult {
  patterns: string[];
  detected: {
    head_and_shoulders: boolean;
    bull_flag: boolean;
    bear_flag?: boolean;
    double_top?: boolean;
    double_bottom?: boolean;
  };
}
export interface BacktestResult { winRate: number; label: string; pts: number }

// ── RSI (Relative Strength Index) ────────────────────────────────────────────

export function calcRSI(history: PricePoint[], period = 14): number {
  if (!history || history.length < period + 1) return 50;
  const prices = history.slice(-(period + 1)).map(p => p.price);
  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ── ATR (Average True Range) ─────────────────────────────────────────────────
// Legacy implementation: average absolute tick-to-tick change. Kept for
// back-compat with the existing auto-scanner; new code should prefer
// `calcATR14()` (proper Wilder's smoothing on OHLC candles).
export function calcATR(history: PricePoint[]): number {
  if (!history || history.length < 10) return 0;
  const recent = history.slice(-60);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    intervals.push(Math.abs(recent[i].price - recent[i - 1].price));
  }
  if (intervals.length === 0) return 0;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

// ── ATR(14) — proper Wilder's smoothing on OHLC candles ─────────────────────
// True Range = max(high-low, |high-prevClose|, |low-prevClose|).
// Used by signal hardening to size minimum SL distance (1.5·ATR floor).
export function calcATR14(candles: Candle[], period = 14): number {
  if (!candles || candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)));
  }
  if (trs.length < period) return 0;
  // Seed with simple average of first `period` TRs, then Wilder smooth.
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ── Microstructure direction — counts HH/HL vs LH/LL on last N candles ──────
// Returns the bias of recent swing structure. Used to penalize signals that
// fight nascent trend microstructure on the entry timeframe.
export interface MicrostructureBias {
  microUp:   boolean;     // ≥4 of last 6 made HL+HH (uptrend microstructure)
  microDown: boolean;     // ≥4 of last 6 made LH+LL (downtrend microstructure)
  hhCount:   number;
  hlCount:   number;
  lhCount:   number;
  llCount:   number;
}
export function detectMicrostructure(candles: Candle[], lookback = 6): MicrostructureBias {
  const empty: MicrostructureBias = { microUp: false, microDown: false, hhCount: 0, hlCount: 0, lhCount: 0, llCount: 0 };
  if (!candles || candles.length < lookback + 1) return empty;
  const tail = candles.slice(-lookback - 1);  // need 1 prior for first comparison
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 1; i < tail.length; i++) {
    const c = tail[i], p = tail[i - 1];
    if (c.h > p.h) hh++;
    if (c.l > p.l) hl++;
    if (c.h < p.h) lh++;
    if (c.l < p.l) ll++;
  }
  // Spec: micro_up = count of HL+HH in last 6 candles >= 4. The naive
  // `hh+hl` double-counts a candle that is both HH and HL. We dedupe by
  // counting candles where EITHER condition holds, capped at lookback.
  let upCandles = 0, downCandles = 0;
  for (let i = 1; i < tail.length; i++) {
    const c = tail[i], p = tail[i - 1];
    if (c.h > p.h || c.l > p.l) upCandles++;
    if (c.h < p.h || c.l < p.l) downCandles++;
  }
  return {
    microUp:   upCandles   >= 4,
    microDown: downCandles >= 4,
    hhCount: hh, hlCount: hl, lhCount: lh, llCount: ll,
  };
}

// ── Momentum ─────────────────────────────────────────────────────────────────

export function calcMomentum(history: PricePoint[]): number {
  if (!history || history.length < 10) return 0;
  const recent = history.slice(-10);
  const oldest = recent[0].price;
  const newest = recent[recent.length - 1].price;
  return oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
}

// ── Z-Score of recent price move ─────────────────────────────────────────────

export function calcZScore(history: PricePoint[]): ZScoreResult {
  if (!history || history.length < 20) return { zScore: 0, label: "Insufficient data", pts: 3 };
  const pts = history.slice(-30);
  const changes: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    changes.push(((pts[i].price - pts[i - 1].price) / pts[i - 1].price) * 100);
  }
  if (changes.length < 5) return { zScore: 0, label: "Insufficient data", pts: 3 };
  const mean = changes.reduce((s, v) => s + v, 0) / changes.length;
  const variance = changes.reduce((s, v) => s + (v - mean) ** 2, 0) / changes.length;
  const stddev = Math.sqrt(variance);
  const last = changes[changes.length - 1];
  const z = stddev > 0 ? (last - mean) / stddev : 0;
  const absZ = Math.abs(z);
  const label = absZ >= 3 ? "EXTREME (3σ+)" : absZ >= 2 ? "STRONG (2σ+)" : absZ >= 1.5 ? "NOTABLE (1.5σ)" : absZ >= 1 ? "MODERATE (1σ)" : "NORMAL";
  const scorePts = absZ >= 3 ? 20 : absZ >= 2 ? 15 : absZ >= 1.5 ? 10 : absZ >= 1 ? 6 : 3;
  return { zScore: +z.toFixed(2), label, pts: scorePts };
}

// ── Bollinger Band Breakout ───────────────────────────────────────────────────

export function calcBollingerBreakout(history: PricePoint[], dir: string): BollingerResult {
  if (!history || history.length < 20) return { breakout: false, pctFromBand: 0, pts: 2 };
  const prices = history.slice(-20).map(p => p.price);
  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const upper = mean + 2 * stddev;
  const lower = mean - 2 * stddev;
  const current = prices[prices.length - 1];
  const breakoutLong  = dir === "LONG"  && current > upper;
  const breakoutShort = dir === "SHORT" && current < lower;
  const breakout = breakoutLong || breakoutShort;
  const pctFromBand = breakoutLong
    ? +((current - upper) / upper * 100).toFixed(2)
    : breakoutShort ? +((lower - current) / lower * 100).toFixed(2) : 0;
  return { breakout, pctFromBand, pts: breakout ? (pctFromBand > 1 ? 12 : 8) : 2 };
}

// ── Build synthetic candles from price history ────────────────────────────────

export function buildSyntheticCandles(history: PricePoint[], count = 60): Candle[] {
  if (!history || history.length < 5) return [];
  const pts = history.slice(-count);
  return pts.map((pt, i) => {
    const p = pt.price;
    const v = p * 0.002;
    return { c: p, h: p + v, l: p - v, o: i > 0 ? pts[i - 1].price : p };
  });
}

// ── Pattern Detection ─────────────────────────────────────────────────────────

export function detectPatterns(candles: Candle[]): PatternResult {
  const prices = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const n      = prices.length;

  function localMaxima(arr: number[], order: number): number[] {
    const idx: number[] = [];
    for (let i = order; i < arr.length - order; i++) {
      let isMax = true;
      for (let j = i - order; j <= i + order; j++) {
        if (j !== i && arr[j] >= arr[i]) { isMax = false; break; }
      }
      if (isMax) idx.push(i);
    }
    return idx;
  }

  function localMinima(arr: number[], order: number): number[] {
    const idx: number[] = [];
    for (let i = order; i < arr.length - order; i++) {
      let isMin = true;
      for (let j = i - order; j <= i + order; j++) {
        if (j !== i && arr[j] <= arr[i]) { isMin = false; break; }
      }
      if (isMin) idx.push(i);
    }
    return idx;
  }

  const H_ORDER = 3;
  const H_TOL   = 0.07;
  const peaks = localMaxima(highs, H_ORDER);

  let headAndShoulders = false;
  if (peaks.length >= 3) {
    for (let k = peaks.length - 1; k >= 2; k--) {
      const [i1, i2, i3] = [peaks[k - 2], peaks[k - 1], peaks[k]];
      const p1 = highs[i1], p2 = highs[i2], p3 = highs[i3];
      const headHighest  = p2 > p1 && p2 > p3;
      const headProtrude = (p2 - Math.max(p1, p3)) / p2 >= 0.008;
      const shoulderSym  = Math.abs(p1 - p3) / Math.max(p1, p3) <= H_TOL;
      const spacingOk    = (i2 - i1) >= 2 && (i3 - i2) >= 2;
      if (headHighest && headProtrude && shoulderSym && spacingOk) { headAndShoulders = true; break; }
    }
  }

  let bullFlag = false;
  if (n >= 20) {
    const lookback = prices.slice(-30);
    const lbN = lookback.length;
    let peakIdx = 0;
    for (let i = 1; i < lbN; i++) { if (lookback[i] > lookback[peakIdx]) peakIdx = i; }
    if (peakIdx >= 5 && peakIdx <= lbN - 3) {
      const beforeSlice   = lookback.slice(Math.max(0, peakIdx - 10), peakIdx + 1);
      const flagpoleStart = Math.min(...beforeSlice);
      const peakPx        = lookback[peakIdx];
      const flagpoleGrowth = (peakPx - flagpoleStart) / flagpoleStart;
      const currentPx = lookback[lbN - 1];
      const pullback  = (peakPx - currentPx) / peakPx;
      if (flagpoleGrowth >= 0.03 && pullback >= 0.005 && pullback <= 0.18 && currentPx > flagpoleStart) bullFlag = true;
    }
  }

  let bearFlag = false;
  if (n >= 20) {
    const lookback = prices.slice(-30);
    const lbN = lookback.length;
    let troughIdx = 0;
    for (let i = 1; i < lbN; i++) { if (lookback[i] < lookback[troughIdx]) troughIdx = i; }
    if (troughIdx >= 5 && troughIdx <= lbN - 3) {
      const beforeSlice   = lookback.slice(Math.max(0, troughIdx - 10), troughIdx + 1);
      const flagpoleStart = Math.max(...beforeSlice);
      const troughPx      = lookback[troughIdx];
      const flagpoleDrop  = (flagpoleStart - troughPx) / flagpoleStart;
      const currentPx     = lookback[lbN - 1];
      const bounce        = (currentPx - troughPx) / troughPx;
      if (flagpoleDrop >= 0.03 && bounce >= 0.005 && bounce <= 0.18 && currentPx < flagpoleStart) bearFlag = true;
    }
  }

  let doubleTop = false;
  if (peaks.length >= 2) {
    const [i1, i2] = peaks.slice(-2);
    const p1 = highs[i1], p2 = highs[i2];
    const symVal = Math.abs(p1 - p2) / Math.max(p1, p2);
    const valleyLows = lows.slice(i1, i2 + 1);
    const valley = Math.min(...valleyLows);
    const dip = (Math.max(p1, p2) - valley) / Math.max(p1, p2);
    if (symVal <= 0.04 && dip >= 0.02 && (i2 - i1) >= 4) doubleTop = true;
  }

  let doubleBottom = false;
  const troughs = localMinima(lows, H_ORDER);
  if (troughs.length >= 2) {
    const [j1, j2] = troughs.slice(-2);
    const t1 = lows[j1], t2 = lows[j2];
    const symVal = Math.abs(t1 - t2) / Math.min(t1, t2);
    const peakHighs = highs.slice(j1, j2 + 1);
    const peak = Math.max(...peakHighs);
    const rise = (peak - Math.min(t1, t2)) / Math.min(t1, t2);
    if (symVal <= 0.04 && rise >= 0.02 && (j2 - j1) >= 4) doubleBottom = true;
  }

  const patternList: string[] = [];
  if (headAndShoulders) patternList.push("pattern_head_shoulders");
  if (bullFlag)         patternList.push("pattern_bull_flag");
  if (bearFlag)         patternList.push("pattern_bear_flag");
  if (doubleTop)        patternList.push("pattern_double_top");
  if (doubleBottom)     patternList.push("pattern_double_bottom");

  return {
    patterns: patternList,
    detected: { head_and_shoulders: headAndShoulders, bull_flag: bullFlag, bear_flag: bearFlag, double_top: doubleTop, double_bottom: doubleBottom },
  };
}

// ── Backtest Win Rate Lookup ──────────────────────────────────────────────────

export function getBacktestWinRate(dir: string, patterns: string[], session: string): BacktestResult {
  let winRate = 0;
  for (const p of patterns) {
    const k = `${dir}_${p}_${session}`;
    if (BACKTEST_WIN_RATES[k]) { winRate = BACKTEST_WIN_RATES[k]; break; }
  }
  if (!winRate) winRate = BACKTEST_WIN_RATES[`${dir}_DEFAULT_${session}`] || (dir === "LONG" ? 0.54 : 0.53);
  const label = `${Math.round(winRate * 100)}% hist. win rate`;
  const pts = winRate >= 0.65 ? 10 : winRate >= 0.60 ? 7 : winRate >= 0.55 ? 5 : 2;
  return { winRate: +winRate.toFixed(2), label, pts };
}

// ── EMA (Exponential Moving Average) ─────────────────────────────────────────

export function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── Batch parallel notification helper ───────────────────────────────────────

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
