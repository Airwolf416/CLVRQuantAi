export type PricePoint = { price: number; ts: number };

export type BarrierObservation =
  | { kind: "PENDING"; points: PricePoint[] }
  | { kind: "WIN"; points: PricePoint[]; terminal: PricePoint }
  | { kind: "LOSS"; points: PricePoint[]; terminal: PricePoint }
  | { kind: "CENSORED"; reason: string; points: PricePoint[] };

/**
 * Resolves only what the retained, sampled mark path can establish. A sampled
 * point is not a candle: when the input cannot prove barrier ordering, it is
 * deliberately excluded rather than inferred from PnL or a later target.
 */
export function observeBarrierOrder(args: {
  history: unknown;
  filledAt: Date | null;
  cursorAt: Date | null;
  direction: string;
  tp1: number | null;
  stopLoss: number | null;
}): BarrierObservation {
  const { history, filledAt, cursorAt, direction, tp1, stopLoss } = args;
  if (!filledAt || !Number.isFinite(filledAt.getTime())) {
    return { kind: "CENSORED", reason: "ENTRY_FILL_TIME_MISSING", points: [] };
  }
  if (!Number.isFinite(tp1) || !Number.isFinite(stopLoss)) {
    return { kind: "CENSORED", reason: "BARRIER_GEOMETRY_MISSING", points: [] };
  }
  if (!Array.isArray(history) || history.length === 0) {
    return { kind: "CENSORED", reason: "PRICE_HISTORY_MISSING", points: [] };
  }

  const raw = history as unknown[];
  const points: PricePoint[] = [];
  let previousTs = -Infinity;
  for (const point of raw) {
    if (!point || typeof point !== "object") {
      return { kind: "CENSORED", reason: "PRICE_HISTORY_AMBIGUOUS", points: [] };
    }
    const { price, ts } = point as Partial<PricePoint>;
    if (!Number.isFinite(price) || !Number.isFinite(ts) || (price as number) <= 0) {
      return { kind: "CENSORED", reason: "PRICE_HISTORY_AMBIGUOUS", points: [] };
    }
    // Equal timestamps cannot establish a sampled sequence either.
    if ((ts as number) <= previousTs) {
      return { kind: "CENSORED", reason: "PRICE_HISTORY_OUT_OF_ORDER", points: [] };
    }
    previousTs = ts as number;
    points.push({ price: price as number, ts: ts as number });
  }

  const requiredStart = Math.max(filledAt.getTime(), cursorAt?.getTime() ?? -Infinity);
  // The rolling state retains fifteen minutes. If its first item is newer than
  // a durable cursor/fill, a restart or retention rollover made the path lost.
  if (points[0].ts > requiredStart) {
    return { kind: "CENSORED", reason: "OBSERVATION_CURSOR_PREDATES_RETENTION", points: [] };
  }

  const newPoints = points.filter(point => point.ts > requiredStart);
  if (!newPoints.length) return { kind: "PENDING", points: [] };
  // The state collector is a one-minute sampled feed. A skipped interval means
  // either barrier could have been reached inside the unobserved period, so a
  // later snapshot must not manufacture an ordering label.
  let priorTs = requiredStart;
  for (const point of newPoints) {
    if (point.ts - priorTs > 2 * 60 * 1000) {
      return { kind: "CENSORED", reason: "PRICE_HISTORY_GAP", points: newPoints };
    }
    priorTs = point.ts;
  }

  const isLong = direction === "LONG";
  for (const point of newPoints) {
    const tpHit = isLong ? point.price >= (tp1 as number) : point.price <= (tp1 as number);
    const slHit = isLong ? point.price <= (stopLoss as number) : point.price >= (stopLoss as number);
    // Mark snapshots are not a complete tick stream or interval high/low.
    // A crossing proves neither first-touch order nor that the other barrier
    // was not touched between samples; it must never yield a calibration label.
    if (tpHit || slHit) return { kind: "CENSORED", reason: "SAMPLED_MARK_CROSSING_UNPROVABLE", points: newPoints };
  }
  return { kind: "PENDING", points: newPoints };
}

export interface AuthoritativeInterval {
  startTs: number;
  endTs: number;
  high: number;
  low: number;
  /** True only when provider guarantees the complete interval range. */
  authoritative: boolean;
  gap?: boolean;
}

/** Labels only a complete authoritative OHLC interval with exactly one barrier. */
export function observeAuthoritativeInterval(args: {
  interval: AuthoritativeInterval | null; direction: string; tp1: number | null; stopLoss: number | null;
}): BarrierObservation {
  const i = args.interval;
  if (!i || i.gap || !i.authoritative || !Number.isFinite(i.high) || !Number.isFinite(i.low) || i.endTs <= i.startTs)
    return { kind: "CENSORED", reason: i?.gap ? "AUTHORITATIVE_INTERVAL_GAP" : "AUTHORITATIVE_INTERVAL_MISSING", points: [] };
  if (!Number.isFinite(args.tp1) || !Number.isFinite(args.stopLoss))
    return { kind: "CENSORED", reason: "BARRIER_GEOMETRY_MISSING", points: [] };
  const long = args.direction === "LONG";
  const tp = long ? i.high >= args.tp1! : i.low <= args.tp1!;
  const sl = long ? i.low <= args.stopLoss! : i.high >= args.stopLoss!;
  const points = [{ price: i.low, ts: i.startTs }, { price: i.high, ts: i.endTs }];
  if (tp && sl) return { kind: "CENSORED", reason: "AUTHORITATIVE_INTERVAL_BOTH_BARRIERS", points };
  if (tp) return { kind: "WIN", terminal: points[1], points };
  if (sl) return { kind: "LOSS", terminal: points[0], points };
  return { kind: "PENDING", points };
}