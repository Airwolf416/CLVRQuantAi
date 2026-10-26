export type DailyBar = { t: number; h: number; l: number; c: number };
export type Direction = "LONG" | "SHORT" | null;

const valid = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function wilderAtrValues(bars: DailyBar[], period = 14): number[] {
  const ranges: number[] = [];
  for (let index = 1; index < bars.length; index++) {
    const current = bars[index];
    const previous = bars[index - 1];
    if (![current.h, current.l, current.c, previous.c].every(valid)) continue;
    ranges.push(Math.max(current.h - current.l, Math.abs(current.h - previous.c), Math.abs(current.l - previous.c)));
  }
  if (ranges.length < period) return [];
  let atr = average(ranges.slice(0, period))!;
  const values = [atr];
  for (const range of ranges.slice(period)) {
    atr = (atr * (period - 1) + range) / period;
    values.push(atr);
  }
  return values;
}

export function calculateAlphaAsset(
  symbol: string,
  inputBars: DailyBar[],
  direction: Direction = null,
  options: {
    stopMult?: number;
    targetMultiples?: number[];
    livePrice?: number | null;
    entryZone?: number | null;
    regimeConflict?: boolean;
    atr50Average?: number | null;
  } = {},
) {
  const bars = inputBars.filter(bar => valid(bar.h) && valid(bar.l) && valid(bar.c)).sort((a, b) => a.t - b.t);
  const closes = bars.map(bar => bar.c);
  const price = valid(options.livePrice) ? options.livePrice : null;
  const previousClose = closes.at(-2) ?? null;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
  const atrValues = wilderAtrValues(bars);
  const atr = atrValues.at(-1) ?? null;
  const atr50Average = average(atrValues.slice(-50));
  const supportBars = bars.slice(-30);
  const support = supportBars.length ? Math.min(...supportBars.map(bar => bar.l)) : null;
  const resistance = supportBars.length ? Math.max(...supportBars.map(bar => bar.h)) : null;
  const ma = (period: number) => closes.length >= period ? average(closes.slice(-period)) : null;
  const ma20 = ma(20), ma50 = ma(50), ma200 = ma(200);
  const stopMult = options.stopMult ?? 1;
  const targetMultiples = options.targetMultiples ?? [1.5, 2.5, 4];
  let stop: number | null = null, risk: number | null = null;
  if (price && atr && direction === "LONG" && support) {
    stop = support - atr * stopMult;
    risk = price - stop;
  } else if (price && atr && direction === "SHORT" && resistance) {
    stop = resistance + atr * stopMult;
    risk = stop - price;
  }
  const targets = risk && price && direction
    ? targetMultiples.map(mult => price + (direction === "LONG" ? 1 : -1) * risk! * mult)
    : [];
  const structuralReward = price && direction
    ? direction === "LONG" && resistance && resistance > price
      ? resistance - price
      : direction === "SHORT" && support && support < price
        ? price - support
        : null
    : null;
  const trendPrice = closes.at(-1) ?? null;
  const trend = trendPrice && ma50 && ma200
    ? trendPrice > ma50 && ma50 > ma200 ? "Bullish"
      : trendPrice < ma50 && ma50 < ma200 ? "Bearish" : "Mixed"
    : "N/A";
  const annualizedVol = (days: number) => {
    const sample = returns.slice(-days);
    const deviation = standardDeviation(sample);
    return deviation == null ? null : deviation * Math.sqrt(252);
  };
  const aligned = direction === "LONG" ? trend === "Bullish" : direction === "SHORT" ? trend === "Bearish" : false;
  const nearEntry = price != null && atr != null && valid(options.entryZone)
    && Math.abs(price - options.entryZone) <= 0.5 * atr;
  const status = !price ? "WAIT PRICE"
    : !atr || (atr50Average != null && atr > atr50Average * 2) ? "WAIT ATR"
      : !support || !resistance ? "WAIT SUPPORT"
        : !direction ? "WAIT SIGNAL"
          : aligned && nearEntry && !options.regimeConflict ? "READY" : "WAIT PRICE";
  return {
    symbol, price, previousClose,
    dayChange: price != null && previousClose ? price - previousClose : null,
    dayChangePct: price != null && previousClose ? (price / previousClose - 1) * 100 : null,
    atr14: atr, ma20, ma50, ma200, trend,
    realizedVol30: annualizedVol(30), realizedVol90: annualizedVol(90),
    support, resistance, supportBars: supportBars.length, supportLimited: supportBars.length < 30,
    direction, stop, risk, targets,
    rrTargets: targets.map(target => risk ? Math.abs(target - price!) / risk : null),
    rrStructural: structuralReward != null && risk ? structuralReward / risk : null,
    status,
    updatedAt: bars.at(-1)?.t ?? null,
    disclaimer: "Levels are informational, not financial advice.",
  };
}
