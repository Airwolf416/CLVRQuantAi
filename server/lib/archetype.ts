// ─────────────────────────────────────────────────────────────────────────────
// Setup Archetype Classifier (Module 1 — Phase 0.5 win-rate effort)
//
// Tags every published signal with EXACTLY ONE of 6 archetypes. The archetype
// becomes the primary grouping key for stats (replacing token-only WR) and
// downstream modules (EQS vol_profile_score, RegimeDirection per-archetype R:R
// floor, TradeLifecycle time-to-outcome distributions).
//
// Classification is intentionally PURE and FAIL-OPEN: any error or missing
// input falls through to UNCLASSIFIED rather than blocking signal publication.
// ─────────────────────────────────────────────────────────────────────────────

export type ArchetypeName =
  | "BREAKOUT_RETEST"
  | "TREND_PULLBACK"
  | "RANGE_FADE"
  | "MEAN_REVERSION_EXHAUSTION"
  | "NEWS_MOMO"
  | "VWAP_RECLAIM"
  | "UNCLASSIFIED";

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // epoch ms
}

/**
 * Inputs the classifier expects. Every field except `candles1h` and `price` is
 * optional — missing data degrades gracefully (the archetype that needed it
 * simply doesn't match, and we fall through to the next priority).
 */
export interface ArchetypeContext {
  token: string;
  direction: "LONG" | "SHORT";
  price: number;
  candles1h: OHLCV[];                 // most recent first OR last — see normalizer

  // Optional richer inputs (degrade gracefully when missing)
  candles5m?: OHLCV[];
  vwapSession?: number;               // session VWAP price
  atrDaily?: number;                  // ATR(14) on daily bars in price units
  atr5m?: number;                     // ATR(14) on 5m bars in price units
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  oiZScore30d?: number;               // OI z-score over 30 days
  oiChange6hPct?: number;             // fallback when 30d z-score unavailable
  fundingRate?: number;               // current funding rate (decimal: 0.0001 = 0.01%)
  fundingTrend4h?: number;            // change in funding over last 4h
  recentNewsMinutesAgo?: number;      // minutes since most recent HIGH-impact news
  breakoutLevel?: number;             // most recent breakout level (high or low)
  breakoutWasUp?: boolean;            // direction of the breakout (true = upside)
  htfEma20?: number;                  // 1H EMA20 current value
  htfEma20PrevN?: number;             // 1H EMA20 N bars ago (for slope sign)
}

export interface ArchetypeResult {
  archetype: ArchetypeName;
  confidence: number;                 // 0..1, soft signal of fit quality
  reason: string;                     // human-readable rule that fired
  candidatesEvaluated: number;        // how many archetypes had enough data to test
}

// Priority order when multiple archetypes match. Higher priority first.
const PRIORITY: ArchetypeName[] = [
  "NEWS_MOMO",
  "MEAN_REVERSION_EXHAUSTION",
  "BREAKOUT_RETEST",
  "VWAP_RECLAIM",
  "TREND_PULLBACK",
  "RANGE_FADE",
];

// ── Helper utilities ────────────────────────────────────────────────────────

const isNum = (x: any): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Normalize a candle array to chronological order (oldest first). Detects the
 * existing ordering by comparing the first two timestamps. Returns a copy to
 * avoid mutating caller-owned arrays.
 */
function chronological(candles: OHLCV[]): OHLCV[] {
  if (!candles || candles.length < 2) return candles ? candles.slice() : [];
  return candles[0].timestamp <= candles[1].timestamp
    ? candles.slice()
    : candles.slice().reverse();
}

/**
 * Required minimum 1h bars to compute ATR(14) on a daily timeframe via
 * 24-bar aggregation. 14 daily bars × 24h/day = 336 bars.
 *
 * Do not reduce below 336: with fewer bars, daily-ATR aggregation collapses
 * to ATR(1) (i.e., yesterday's TR), which makes the MEAN_REVERSION_EXHAUSTION
 * gate ("|day move| > 2.5 × ATR_daily") compare against an unsmoothed value
 * and over-trigger. This constant centralizes the lookback the classifier
 * requires across /api/quant, /api/ai/analyze, and /api/kronos.
 */
export const ARCHETYPE_LOOKBACK_1H = 336;

/** Average True Range over the last `period` bars (price units, simple mean). */
function atr(bars: OHLCV[], period = 14): number | null {
  if (!bars || bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) return null;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

/**
 * Wilder-smoothed ATR. Industry-standard ATR that TradingView, brokerage
 * platforms, and every retail trader expects. Uses simple-mean seed over
 * first `period` TRs, then recursive smoothing:
 *   ATR_t = (ATR_{t-1} * (period-1) + TR_t) / period
 * Requires bars.length >= period + 1.
 */
function wilderATR(bars: OHLCV[], period = 14): number | null {
  if (!bars || bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

/** EMA over the last `period` bars on closes. Returns null if insufficient data. */
function ema(bars: OHLCV[], period: number): number | null {
  if (!bars || bars.length < period) return null;
  const k = 2 / (period + 1);
  let val = bars.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
  for (let i = period; i < bars.length; i++) val = bars[i].close * k + val * (1 - k);
  return val;
}

// ── Individual archetype rules ──────────────────────────────────────────────
// Each returns { matched, confidence, reason } OR null if not enough data.

type MatchOut = { matched: boolean; confidence: number; reason: string };

function checkNewsMomo(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.recentNewsMinutesAgo)) return null;
  const matched = ctx.recentNewsMinutesAgo <= 30;
  return {
    matched,
    confidence: matched ? 1 - ctx.recentNewsMinutesAgo / 30 : 0,
    reason: matched
      ? `HIGH-impact news ${ctx.recentNewsMinutesAgo.toFixed(0)}m ago`
      : `no recent news (last ${ctx.recentNewsMinutesAgo.toFixed(0)}m)`,
  };
}

function checkMeanReversionExhaustion(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.dayOpen) || !isNum(ctx.atrDaily) || ctx.atrDaily <= 0) return null;
  const moveAtr = (ctx.price - ctx.dayOpen) / ctx.atrDaily;
  const absMove = Math.abs(moveAtr);
  if (absMove <= 2.5) {
    return { matched: false, confidence: 0, reason: `day move ${moveAtr.toFixed(2)} ATR (need >2.5)` };
  }
  // Spec: |move| > 2.5 ATR AND (OI z>2 OR funding flat-to-negative at extension)
  const oiHot = isNum(ctx.oiZScore30d)
    ? ctx.oiZScore30d > 2
    : isNum(ctx.oiChange6hPct) && ctx.oiChange6hPct > 5; // weak fallback
  const fundingPermissive = !isNum(ctx.fundingRate)
    ? true // missing data shouldn't block the rule
    : moveAtr > 0
      ? ctx.fundingRate <= 0.0001 // up extension + flat/neg funding = exhaustion
      : ctx.fundingRate >= -0.0001;
  const matched = oiHot || fundingPermissive;
  return {
    matched,
    confidence: matched ? Math.min(1, (absMove - 2.5) / 1.5) : 0,
    reason: matched
      ? `move=${moveAtr.toFixed(2)}ATR, oiHot=${oiHot}, fundingPermissive=${fundingPermissive}`
      : `move>${moveAtr.toFixed(2)}ATR but OI cool & funding aligned (continuation likely)`,
  };
}

function checkBreakoutRetest(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.breakoutLevel) || !isNum(ctx.atrDaily) || ctx.atrDaily <= 0) {
    return null;
  }
  const dist = Math.abs(ctx.price - ctx.breakoutLevel);
  const within = dist <= 0.5 * ctx.atrDaily;
  if (!within) {
    return { matched: false, confidence: 0, reason: `${(dist / ctx.atrDaily).toFixed(2)}ATR from breakout (need ≤0.5)` };
  }
  // Direction must line up with the breakout's polarity:
  //   upside breakout + LONG retest from above, OR downside breakout + SHORT retest from below
  const directionAligned =
    (ctx.breakoutWasUp === true && ctx.direction === "LONG" && ctx.price >= ctx.breakoutLevel) ||
    (ctx.breakoutWasUp === false && ctx.direction === "SHORT" && ctx.price <= ctx.breakoutLevel);
  return {
    matched: directionAligned,
    confidence: directionAligned ? 1 - dist / (0.5 * ctx.atrDaily) : 0,
    reason: directionAligned
      ? `within ${(dist / ctx.atrDaily).toFixed(2)}ATR of ${ctx.breakoutWasUp ? "upside" : "downside"} breakout, retesting from correct side`
      : `near breakout but direction or side mismatched`,
  };
}

function checkVwapReclaim(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.vwapSession)) return null;
  const candles = ctx.candles5m && ctx.candles5m.length >= 3
    ? chronological(ctx.candles5m).slice(-3)
    : chronological(ctx.candles1h).slice(-3);
  if (candles.length < 3) return null;
  // Crossed VWAP in last 3 bars in trade direction, with volume confirmation
  // (latest bar volume >= median of prior 2).
  const crossedUp = candles.some((c, i) => i > 0 && candles[i - 1].close < ctx.vwapSession! && c.close >= ctx.vwapSession!);
  const crossedDown = candles.some((c, i) => i > 0 && candles[i - 1].close > ctx.vwapSession! && c.close <= ctx.vwapSession!);
  const directionalCross = ctx.direction === "LONG" ? crossedUp : crossedDown;
  if (!directionalCross) {
    return { matched: false, confidence: 0, reason: `no ${ctx.direction === "LONG" ? "upside" : "downside"} VWAP cross in last 3 bars` };
  }
  const lastVol = candles[candles.length - 1].volume;
  const priorMedian = ((candles[0].volume + candles[1].volume) / 2) || 1;
  const volOk = lastVol >= priorMedian; // simple > median rule
  return {
    matched: volOk,
    confidence: volOk ? Math.min(1, lastVol / Math.max(priorMedian, 1) / 2) : 0,
    reason: volOk
      ? `${ctx.direction === "LONG" ? "upside" : "downside"} VWAP cross with volume`
      : `VWAP cross without volume confirmation`,
  };
}

function checkTrendPullback(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.htfEma20) || !isNum(ctx.htfEma20PrevN)) return null;
  const slope = ctx.htfEma20 - ctx.htfEma20PrevN;
  const trendUp = slope > 0;
  const trendDown = slope < 0;
  const directionAligned =
    (ctx.direction === "LONG" && trendUp) || (ctx.direction === "SHORT" && trendDown);
  if (!directionAligned) {
    return { matched: false, confidence: 0, reason: `HTF EMA20 slope ${slope.toFixed(4)} doesn't align with ${ctx.direction}` };
  }
  // Price pulling back TOWARD the EMA: for LONG, price recently above EMA and
  // now close to it; symmetric for SHORT. Tolerance: within 0.6 ATR_daily.
  const distance = Math.abs(ctx.price - ctx.htfEma20);
  const tolerance = isNum(ctx.atrDaily) && ctx.atrDaily > 0 ? 0.6 * ctx.atrDaily : ctx.price * 0.015;
  const pulledBack = distance <= tolerance;
  return {
    matched: pulledBack,
    confidence: pulledBack ? 1 - distance / tolerance : 0,
    reason: pulledBack
      ? `${ctx.direction} aligned with HTF trend, pulled back within ${(distance / tolerance).toFixed(2)}×tolerance of EMA20`
      : `${ctx.direction} aligned with HTF trend but ${(distance / tolerance).toFixed(2)}×tolerance from EMA20`,
  };
}

function checkRangeFade(ctx: ArchetypeContext): MatchOut | null {
  if (!isNum(ctx.dayHigh) || !isNum(ctx.dayLow) || ctx.dayHigh <= ctx.dayLow) return null;
  const range = ctx.dayHigh - ctx.dayLow;
  const positionInRange = (ctx.price - ctx.dayLow) / range; // 0 = at low, 1 = at high
  // Upper/lower 10% qualifies; fade direction must be back into the range.
  const atUpperEdge = positionInRange >= 0.9;
  const atLowerEdge = positionInRange <= 0.1;
  if (!atUpperEdge && !atLowerEdge) {
    return { matched: false, confidence: 0, reason: `price at ${(positionInRange * 100).toFixed(0)}% of day range (need ≤10% or ≥90%)` };
  }
  const directionAligned =
    (atUpperEdge && ctx.direction === "SHORT") ||
    (atLowerEdge && ctx.direction === "LONG");
  // No-breakout proxy: today's range close to N-day median (we don't have N-day
  // here, so accept if no breakout level is set OR price is INSIDE the level).
  const noBreakout = !isNum(ctx.breakoutLevel) ||
    (atUpperEdge ? ctx.price < ctx.breakoutLevel : ctx.price > ctx.breakoutLevel);
  const matched = directionAligned && noBreakout;
  return {
    matched,
    confidence: matched ? Math.max(0, atUpperEdge ? positionInRange - 0.9 : 0.1 - positionInRange) * 10 : 0,
    reason: matched
      ? `fading ${atUpperEdge ? "upper" : "lower"} ${((atUpperEdge ? positionInRange : 1 - positionInRange) * 100).toFixed(0)}% of day range`
      : `range position OK but direction or breakout overlap mismatched`,
  };
}

// ── Main classifier ─────────────────────────────────────────────────────────

const RULES: Array<{ name: ArchetypeName; check: (ctx: ArchetypeContext) => MatchOut | null }> = [
  { name: "NEWS_MOMO", check: checkNewsMomo },
  { name: "MEAN_REVERSION_EXHAUSTION", check: checkMeanReversionExhaustion },
  { name: "BREAKOUT_RETEST", check: checkBreakoutRetest },
  { name: "VWAP_RECLAIM", check: checkVwapReclaim },
  { name: "TREND_PULLBACK", check: checkTrendPullback },
  { name: "RANGE_FADE", check: checkRangeFade },
];

export function classifyArchetype(ctx: ArchetypeContext): ArchetypeResult {
  try {
    let evaluated = 0;
    const matches: Array<{ name: ArchetypeName; conf: number; reason: string }> = [];
    for (const r of RULES) {
      const out = r.check(ctx);
      if (out == null) continue;
      evaluated++;
      if (out.matched) matches.push({ name: r.name, conf: out.confidence, reason: out.reason });
    }
    if (matches.length === 0) {
      return { archetype: "UNCLASSIFIED", confidence: 0, reason: `${evaluated} rules evaluated, none matched`, candidatesEvaluated: evaluated };
    }
    // Pick by priority order, breaking ties by confidence
    matches.sort((a, b) => {
      const pa = PRIORITY.indexOf(a.name);
      const pb = PRIORITY.indexOf(b.name);
      if (pa !== pb) return pa - pb;
      return b.conf - a.conf;
    });
    const winner = matches[0];
    return { archetype: winner.name, confidence: winner.conf, reason: winner.reason, candidatesEvaluated: evaluated };
  } catch (e: any) {
    // Fail-open: never block signal publication on a classifier error
    return { archetype: "UNCLASSIFIED", confidence: 0, reason: `classifier error: ${e?.message || e}`, candidatesEvaluated: 0 };
  }
}

/**
 * MEAN_REVERSION_EXHAUSTION direction-flip helper. Returns the FADE direction
 * relative to the day's trend, or null if the archetype doesn't apply or the
 * day's trend can't be determined.
 *
 * The scanner calls this AFTER `classifyArchetype()` and BEFORE the brain /
 * edge-policy check — the brain still has final say (it can SUPPRESS the
 * flipped signal if the flipped (token, direction) combo is historically weak).
 */
export function shouldFlipForMeanReversion(
  archetype: ArchetypeName,
  dayOpen: number | undefined,
  price: number | undefined,
): "LONG" | "SHORT" | null {
  if (archetype !== "MEAN_REVERSION_EXHAUSTION") return null;
  if (!isNum(dayOpen) || !isNum(price)) return null;
  if (price === dayOpen) return null;
  // Day's trend up → fade direction is SHORT, and vice versa.
  return price > dayOpen ? "SHORT" : "LONG";
}

// ── Convenience builder for /api/quant call site ────────────────────────────
// Derives the most common inputs from what the scanner already has in scope.
// Anything we can't derive cheaply stays undefined and the corresponding rule
// degrades gracefully.

export interface ArchetypeContextBuilderInput {
  token: string;
  direction: "LONG" | "SHORT";
  price: number;
  candles1h: OHLCV[];
  candles5m?: OHLCV[];
  fundingRate?: number;
  oiChange6hPct?: number;
  // newsContext from the existing scanner snapshot (shape from server/lib/newsGate.ts).
  // We look for the most recent HIGH severity item.
  newsContext?: { topHeadlines?: Array<{ severity?: string; ageMinutes?: number; publishedAt?: number }> };
  // Optional pre-computed VWAP if you have it; otherwise omitted.
  vwapSession?: number;
}

export function buildArchetypeContext(input: ArchetypeContextBuilderInput): ArchetypeContext {
  const c1h = chronological(input.candles1h || []);
  const last = c1h[c1h.length - 1];
  // Day boundaries — approximate using the most recent 24 hourly bars (rolling
  // 24h window; close enough for archetype classification).
  const last24 = c1h.slice(-24);
  const dayOpen = last24[0]?.open;
  const dayHigh = last24.length ? Math.max(...last24.map(b => b.high)) : undefined;
  const dayLow = last24.length ? Math.min(...last24.map(b => b.low)) : undefined;
  // True daily ATR(14) via 24h aggregation. Requires ARCHETYPE_LOOKBACK_1H
  // (336) 1h bars = 14 full daily bars + 1 prior-close for true-range seeding.
  // Uses Wilder smoothing (industry standard, matches TradingView and every
  // retail charting platform) once 15+ daily bars are available; falls back
  // to simple-mean ATR for shorter histories.
  //
  // Module 2 fix: previously this gated on c1h.length >= 48 (= 2 daily bars),
  // which silently collapsed ATR(14) to ATR(1) and over-triggered the
  // MEAN_REVERSION_EXHAUSTION gate. Gating on ARCHETYPE_LOOKBACK_1H ensures
  // ATR-dependent archetypes (MEAN_REV, BREAKOUT_RETEST) only evaluate
  // when daily ATR is mathematically meaningful; non-ATR archetypes
  // (NEWS_MOMO, VWAP_RECLAIM) remain reachable with shorter histories.
  let atrDaily: number | undefined;
  if (c1h.length >= ARCHETYPE_LOOKBACK_1H) {
    const daily: OHLCV[] = [];
    for (let i = 0; i + 24 <= c1h.length; i += 24) {
      const chunk = c1h.slice(i, i + 24);
      daily.push({
        open: chunk[0].open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((s, b) => s + (b.volume || 0), 0),
        timestamp: chunk[chunk.length - 1].timestamp,
      });
    }
    if (daily.length >= 15) {
      // Wilder ATR(14) — needs 14 TRs (= 15 bars).
      atrDaily = wilderATR(daily, 14) || undefined;
    } else if (daily.length >= 2) {
      // Degraded path: simple-mean ATR over what we have, capped at 14.
      const period = Math.min(14, daily.length - 1);
      atrDaily = atr(daily, period) || undefined;
    }
  }
  const atr5m = input.candles5m ? atr(chronological(input.candles5m), 14) || undefined : undefined;
  // 1H EMA20 + slope
  const htfEma20 = ema(c1h, 20) || undefined;
  const htfEma20PrevN = c1h.length >= 25 ? ema(c1h.slice(0, -5), 20) || undefined : undefined;
  // Breakout level: highest high / lowest low of last 20 closed bars (excluding current)
  const closed = c1h.slice(0, -1).slice(-20);
  let breakoutLevel: number | undefined;
  let breakoutWasUp: boolean | undefined;
  if (closed.length >= 20 && last) {
    const recentHigh = Math.max(...closed.map(b => b.high));
    const recentLow = Math.min(...closed.map(b => b.low));
    if (last.close >= recentHigh) {
      breakoutLevel = recentHigh;
      breakoutWasUp = true;
    } else if (last.close <= recentLow) {
      breakoutLevel = recentLow;
      breakoutWasUp = false;
    }
  }
  // News age — pull the most recent HIGH severity headline if present
  let recentNewsMinutesAgo: number | undefined;
  if (input.newsContext?.topHeadlines?.length) {
    const highs = input.newsContext.topHeadlines.filter(h => (h.severity || "").toLowerCase() === "high");
    const ages = highs.map(h => {
      if (isNum(h.ageMinutes)) return h.ageMinutes;
      if (isNum(h.publishedAt)) return (Date.now() - h.publishedAt) / 60000;
      return null as number | null;
    }).filter((x): x is number => x != null && Number.isFinite(x));
    if (ages.length) recentNewsMinutesAgo = Math.min(...ages);
  }
  return {
    token: input.token,
    direction: input.direction,
    price: input.price,
    candles1h: c1h,
    candles5m: input.candles5m ? chronological(input.candles5m) : undefined,
    vwapSession: input.vwapSession,
    atrDaily,
    atr5m,
    dayOpen,
    dayHigh,
    dayLow,
    oiChange6hPct: input.oiChange6hPct,
    fundingRate: input.fundingRate,
    recentNewsMinutesAgo,
    breakoutLevel,
    breakoutWasUp,
    htfEma20,
    htfEma20PrevN,
  };
}
