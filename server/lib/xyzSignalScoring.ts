export type XyzSignalStatus = "LONG" | "SHORT" | "NEUTRAL" | "NO_DATA";
export type XyzConviction = "STRONG" | "MODERATE" | "WEAK" | null;

export type XyzDailyCandle = {
  t: number;
  c: number | string;
};

export type XyzSignalInput = {
  coin: string;
  markPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  candles: XyzDailyCandle[];
};

export type XyzSignalRow = {
  coin: string;
  markPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  signal: XyzSignalStatus;
  conviction: XyzConviction;
  historyLabel: string | null;
  candleCount: number;
  rsi14: number | null;
  return7d: number | null;
  return30d: number | null;
  longScore: number | null;
  shortScore: number | null;
};

export type XyzSignalCounts = Record<XyzSignalStatus, number>;

const clampScore = (value: number) => Math.max(0, Math.min(6, value));
const finitePositive = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Wilder RSI, initialized with the first 14 daily close-to-close changes. */
export function calculateRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= 14; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / 14;
  let avgLoss = loss / 14;
  for (let i = 15; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * 13 + Math.max(change, 0)) / 14;
    avgLoss = (avgLoss * 13 + Math.max(-change, 0)) / 14;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function dailyCloses(candles: XyzDailyCandle[]): number[] {
  return candles
    .filter(candle => Number.isFinite(candle?.t))
    .map(candle => ({ t: Number(candle.t), close: finitePositive(candle.c) }))
    .filter((candle): candle is { t: number; close: number } => candle.close != null)
    .sort((a, b) => a.t - b.t)
    .filter((candle, index, sorted) => index === 0 || candle.t !== sorted[index - 1].t)
    .map(candle => candle.close);
}

function percentReturn(closes: number[], periods: number): number | null {
  if (closes.length <= periods) return null;
  const reference = closes[closes.length - periods - 1];
  const latest = closes[closes.length - 1];
  return reference > 0 ? ((latest - reference) / reference) * 100 : null;
}

export function scoreXyzPerp(input: XyzSignalInput): XyzSignalRow {
  const coin = String(input.coin || "").replace(/^xyz:/i, "").trim().toUpperCase();
  const markPrice = finitePositive(input.markPrice);
  const fundingRate = Number.isFinite(input.fundingRate) ? Number(input.fundingRate) : null;
  const openInterest = Number.isFinite(input.openInterest) ? Number(input.openInterest) : null;
  const closes = dailyCloses(input.candles || []);
  const base: XyzSignalRow = {
    coin,
    markPrice,
    fundingRate,
    openInterest,
    signal: "NO_DATA",
    conviction: null,
    historyLabel: null,
    candleCount: closes.length,
    rsi14: calculateRsi14(closes),
    return7d: percentReturn(closes, 7),
    return30d: percentReturn(closes, 30),
    longScore: null,
    shortScore: null,
  };

  if (closes.length === 0) return base;
  if (closes.length < 51) {
    return { ...base, signal: "NEUTRAL", historyLabel: "insufficient history" };
  }

  const latest = closes[closes.length - 1];
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const rsi = base.rsi14;
  const return7d = base.return7d;
  const return30d = base.return30d;
  let longScore = 0;
  let shortScore = 0;

  if (latest > sma20) longScore += 1;
  if (latest > sma50) longScore += 1;
  if (latest < sma20) shortScore += 1;
  if (latest < sma50) shortScore += 1;

  if (rsi != null && rsi > 55) longScore += 1;
  if (rsi != null && rsi < 45) shortScore += 1;
  if (return7d != null && return7d > 3) longScore += 1;
  if (return7d != null && return7d < -3) shortScore += 1;
  if (return30d != null && return30d > 5) longScore += 1;
  if (return30d != null && return30d < -5) shortScore += 1;

  // Hyperliquid returns funding as a decimal rate; 0.0005 = 0.05% / 8h.
  if (fundingRate != null && fundingRate > 0.0005) {
    shortScore += 1;
    longScore -= 1;
  } else if (fundingRate != null && fundingRate < -0.0005) {
    longScore += 1;
    shortScore -= 1;
  }

  longScore = clampScore(longScore);
  shortScore = clampScore(shortScore);
  const gap = Math.abs(longScore - shortScore);
  let signal: XyzSignalStatus = "NEUTRAL";
  if (longScore >= 4 && longScore - shortScore >= 2) signal = "LONG";
  else if (shortScore >= 4 && shortScore - longScore >= 2) signal = "SHORT";

  let conviction: XyzConviction = null;
  if (signal !== "NEUTRAL") {
    conviction = gap >= 4 ? "STRONG" : gap === 3 ? "MODERATE" : "WEAK";
    if ((signal === "LONG" && rsi != null && rsi > 75)
      || (signal === "SHORT" && rsi != null && rsi < 25)) {
      conviction = "WEAK";
    }
  }

  return { ...base, signal, conviction, longScore, shortScore };
}

export function sortXyzSignals(rows: XyzSignalRow[]): XyzSignalRow[] {
  const rank: Record<XyzSignalStatus, number> = {
    LONG: 0,
    SHORT: 1,
    NEUTRAL: 2,
    NO_DATA: 3,
  };
  return [...rows].sort((a, b) =>
    rank[a.signal] - rank[b.signal]
    || (b.openInterest ?? -Infinity) - (a.openInterest ?? -Infinity)
    || a.coin.localeCompare(b.coin),
  );
}

export function countXyzSignals(rows: XyzSignalRow[]): XyzSignalCounts {
  return rows.reduce<XyzSignalCounts>((counts, row) => {
    counts[row.signal] += 1;
    return counts;
  }, { LONG: 0, SHORT: 0, NEUTRAL: 0, NO_DATA: 0 });
}
