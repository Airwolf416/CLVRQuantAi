export const PORTFOLIO_ADVISOR_DISCLAIMER = "Systematic technical reads, not financial advice or predictions.";
export const PORTFOLIO_MAX_LEVERAGE = 2;
export const PORTFOLIO_HARD_LEVERAGE_LIMIT = 5;
export const PORTFOLIO_MAX_RISK_FRACTION = 0.05;
export const PORTFOLIO_ALERT_COOLDOWN_MS = 4 * 60 * 60_000;
export const PORTFOLIO_PNL_CACHE_MS = 15 * 60_000;
export type PortfolioPnlPeriod = "daily" | "monthly" | "quarterly" | "yearly";

export function portfolioPnlCacheFresh(fetchedAt: Date | string | number, now: Date | number) {
  const stored = new Date(fetchedAt).getTime();
  const current = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(stored) && current >= stored && current - stored < PORTFOLIO_PNL_CACHE_MS;
}

function dateParts(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("INVALID_LOCAL_DATE");
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

function dateKeyFromParts(year: number, month: number, day = 1) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function localDateTimeToUtc(dateKey: string, timeZone: string) {
  const { year, month, day } = dateParts(dateKey);
  const target = dateKeyFromParts(year, month, day);
  const approx = Date.UTC(year, month - 1, day);
  let lower = approx - 36 * 60 * 60_000;
  let upper = approx + 36 * 60 * 60_000;
  const formatDate = (value: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(value)).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  if (formatDate(upper) < target) throw new Error("LOCAL_DATE_NOT_FOUND");
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (formatDate(middle) < target) lower = middle;
    else upper = middle;
  }
  if (formatDate(upper) !== target) throw new Error("LOCAL_DATE_NOT_FOUND");
  return upper;
}

export function portfolioPnlPeriodBounds(now: Date, timeZone: string, period: PortfolioPnlPeriod) {
  if (!["daily", "monthly", "quarterly", "yearly"].includes(period)) throw new Error("INVALID_PNL_PERIOD");
  const local = localPortfolioClock(now, timeZone);
  if (!local) throw new Error("INVALID_PORTFOLIO_TIME_ZONE");
  const { year, month, day } = dateParts(local.dateKey);
  let currentStartKey: string;
  let previousStartKey: string;
  let periodKey: string;
  if (period === "daily") {
    currentStartKey = dateKeyFromParts(year, month, day);
    previousStartKey = dateKeyFromParts(year, month, day - 1);
    periodKey = currentStartKey;
  } else if (period === "monthly") {
    currentStartKey = dateKeyFromParts(year, month, 1);
    previousStartKey = dateKeyFromParts(year, month - 1, 1);
    periodKey = `${year}-${String(month).padStart(2, "0")}`;
  } else if (period === "quarterly") {
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    currentStartKey = dateKeyFromParts(year, quarterMonth, 1);
    previousStartKey = dateKeyFromParts(year, quarterMonth - 3, 1);
    periodKey = `${year}-Q${Math.floor((quarterMonth - 1) / 3) + 1}`;
  } else {
    currentStartKey = dateKeyFromParts(year, 1, 1);
    previousStartKey = dateKeyFromParts(year - 1, 1, 1);
    periodKey = String(year);
  }
  const currentStart = localDateTimeToUtc(currentStartKey, timeZone);
  const previousStart = localDateTimeToUtc(previousStartKey, timeZone);
  return {
    period, periodKey, timeZone,
    currentStart, currentEnd: now.getTime(),
    previousStart, previousEnd: currentStart,
    currentStartDate: currentStartKey, previousStartDate: previousStartKey,
  };
}

function itemTime(item: any) {
  const time = finite(item?.time);
  if (time == null) return null;
  return time < 1e12 ? time * 1000 : time;
}

function calendarDateKeys(startKey: string, endExclusiveKey: string) {
  const out: string[] = [];
  const start = dateParts(startKey);
  const end = dateParts(endExclusiveKey);
  let cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const until = Date.UTC(end.year, end.month - 1, end.day);
  while (cursor.getTime() < until) {
    out.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

export function aggregatePortfolioPnl(
  bounds: ReturnType<typeof portfolioPnlPeriodBounds>,
  fills: any[],
  funding: any[],
  unrealizedPnl: number | null,
) {
  const scopedFills = fills.flatMap(fill => {
    const time = itemTime(fill);
    const closedPnl = finite(fill.closedPnl);
    return time == null || closedPnl == null ||
      !((time >= bounds.previousStart && time < bounds.previousEnd) || (time >= bounds.currentStart && time <= bounds.currentEnd))
      ? [] : [{ ...fill, time, closedPnl }];
  });
  const scopedFunding = funding.flatMap(item => {
    const time = itemTime(item);
    const delta = finite(item?.delta?.usdc);
    return time == null || delta == null ||
      !((time >= bounds.previousStart && time < bounds.previousEnd) || (time >= bounds.currentStart && time <= bounds.currentEnd))
      ? [] : [{ ...item, time, delta }];
  });
  const currentFills = scopedFills.filter(fill => fill.time >= bounds.currentStart && fill.time <= bounds.currentEnd);
  const previousFills = scopedFills.filter(fill => fill.time >= bounds.previousStart && fill.time < bounds.previousEnd);
  const currentFunding = scopedFunding.filter(item => item.time >= bounds.currentStart && item.time <= bounds.currentEnd);
  const previousFunding = scopedFunding.filter(item => item.time >= bounds.previousStart && item.time < bounds.previousEnd);
  const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + row[key], 0);
  const tradeFills = currentFills.filter(fill => /close/i.test(String(fill.dir || "")) || fill.closedPnl !== 0);
  const fillView = (fill: any) => ({
    coin: String(fill.coin || "Unknown").toLowerCase().startsWith("xyz:")
      ? String(fill.coin)
      : fill._sourceDex === "xyz" ? `xyz:${String(fill.coin || "Unknown")}` : String(fill.coin || "Unknown"),
    side: String(fill.dir || "Unknown"),
    closePrice: finite(fill.px),
    size: finite(fill.sz),
    realizedPnl: fill.closedPnl,
    time: fill.time,
    id: fill.hash ?? fill.tid ?? null,
  });
  const dailyTotals = new Map<string, { realized: number; funding: number; fills: any[] }>();
  for (const fill of currentFills) {
    const date = localPortfolioClock(new Date(fill.time), bounds.timeZone)?.dateKey;
    if (!date) continue;
    const row = dailyTotals.get(date) || { realized: 0, funding: 0, fills: [] };
    row.realized += fill.closedPnl;
    if (/close/i.test(String(fill.dir || "")) || fill.closedPnl !== 0) row.fills.push(fillView(fill));
    dailyTotals.set(date, row);
  }
  for (const item of currentFunding) {
    const date = localPortfolioClock(new Date(item.time), bounds.timeZone)?.dateKey;
    if (!date) continue;
    const row = dailyTotals.get(date) || { realized: 0, funding: 0, fills: [] };
    row.funding += item.delta;
    dailyTotals.set(date, row);
  }
  const localNowDate = localPortfolioClock(new Date(bounds.currentEnd), bounds.timeZone)!.dateKey;
  const endParts = dateParts(localNowDate);
  const endExclusiveKey = dateKeyFromParts(endParts.year, endParts.month, endParts.day + 1);
  const dailyBreakdown = calendarDateKeys(bounds.currentStartDate, endExclusiveKey).map(date => {
    const row = dailyTotals.get(date) || { realized: 0, funding: 0, fills: [] };
    return { date, realized: row.realized, funding: row.funding, total: row.realized + row.funding, fills: row.fills };
  });
  const realized = sum(currentFills, "closedPnl");
  const fundingPnl = sum(currentFunding, "delta");
  const previousRealized = sum(previousFills, "closedPnl");
  const previousFundingPnl = sum(previousFunding, "delta");
  const tradePnls = tradeFills.map(fill => ({ ...fillView(fill), realizedPnl: fill.closedPnl }));
  const wins = tradePnls.filter(fill => fill.realizedPnl > 0).length;
  const losses = tradePnls.filter(fill => fill.realizedPnl < 0).length;
  const bestTrade = tradePnls.length ? tradePnls.reduce((best, fill) => fill.realizedPnl > best.realizedPnl ? fill : best) : null;
  const worstTrade = tradePnls.length ? tradePnls.reduce((worst, fill) => fill.realizedPnl < worst.realizedPnl ? fill : worst) : null;
  return {
    ...bounds,
    current: {
      realizedPnl: realized, fundingPnl, totalPnl: realized + fundingPnl,
      unrealizedPnl: Number.isFinite(unrealizedPnl) ? unrealizedPnl : null,
      tradesCount: tradePnls.length, wins, losses, bestTrade, worstTrade,
      fills: currentFills.filter(fill => /close/i.test(String(fill.dir || "")) || fill.closedPnl !== 0).map(fillView),
    },
    previous: {
      realizedPnl: previousRealized, fundingPnl: previousFundingPnl,
      totalPnl: previousRealized + previousFundingPnl,
    },
    dailyBreakdown,
    noTrades: tradePnls.length === 0,
  };
}

export function validWalletAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function localPortfolioClock(now: Date, timeZone: string) {
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  } catch { return null; }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!parts.year || !parts.month || !parts.day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

export function portfolioDuePhase(now: Date, timeZone: string, completedPhases: string[]) {
  const local = localPortfolioClock(now, timeZone);
  if (!local) return null;
  const localMinute = local.minuteOfDay;
  if (localMinute >= 6 * 60 + 30 && !completedPhases.includes("morning")) return { ...local, phase: "morning" as const };
  if (localMinute >= 21 * 60 && !completedPhases.includes("evening")) return { ...local, phase: "evening" as const };
  if (localMinute >= 6 * 60 + 30 && localMinute < 21 * 60 && (localMinute - (6 * 60 + 30)) % 15 === 0) {
    return { ...local, phase: "intraday" as const };
  }
  return null;
}

export type PerpAccount = {
  marginSummary?: { accountValue?: unknown };
  crossMarginSummary?: { accountValue?: unknown };
  assetPositions?: Array<{ position?: Record<string, any> }>;
};

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function readAccountValue(state: PerpAccount): number | null {
  return finite(state.marginSummary?.accountValue ?? state.crossMarginSummary?.accountValue);
}

export function readSpotFreeUsdc(state: { balances?: Array<{ coin?: string; total?: unknown; hold?: unknown }> }): number | null {
  if (!Array.isArray(state.balances)) return null;
  const usdc = state.balances.find(row => String(row.coin).toUpperCase() === "USDC");
  if (!usdc) return 0;
  const total = finite(usdc.total);
  const hold = finite(usdc.hold);
  if (total == null || hold == null) return null;
  if (hold > total) return null;
  return total - hold;
}

export function combinedAccountValue(main: PerpAccount, xyz: PerpAccount, spot: { balances?: any[] }) {
  const mainValue = readAccountValue(main);
  const xyzValue = readAccountValue(xyz);
  const spotValue = readSpotFreeUsdc(spot);
  if (mainValue == null || xyzValue == null || spotValue == null) return null;
  return {
    mainPerps: mainValue,
    xyzPerps: xyzValue,
    spotFreeUsdc: spotValue,
    total: mainValue + xyzValue + spotValue,
  };
}

export function flattenPerpPositions(state: PerpAccount, dex: "main" | "xyz", marks: Record<string, unknown>) {
  if (!Array.isArray(state.assetPositions)) return [];
  return state.assetPositions.flatMap(asset => {
    const p = asset?.position;
    const size = finite(p?.szi);
    if (!p || size == null || size === 0) return [];
    const coin = String(p.coin || "");
    const mark = finite(marks[coin] ?? marks[`xyz:${coin}`]);
    const leverage = finite(p.leverage?.value);
    const marginUsed = finite(p.marginUsed);
    const entry = finite(p.entryPx);
    const liquidation = finite(p.liquidationPx);
    const unrealized = finite(p.unrealizedPnl);
    return [{
      key: `${dex}:${coin}`,
      dex,
      coin,
      side: size > 0 ? "LONG" as const : "SHORT" as const,
      size: Math.abs(size),
      signedSize: size,
      entry,
      mark,
      unrealizedPnl: unrealized,
      marginUsed,
      leverage,
      liquidationPrice: liquidation,
      positionValue: finite(p.positionValue),
    }];
  });
}

export function classifyOpenOrder(order: Record<string, any>, position: { side: string; size: number; liquidationPrice: number | null }) {
  const trigger = finite(order.triggerPx);
  const limit = finite(order.limitPx);
  const size = Math.abs(finite(order.sz) ?? 0);
  const side = String(order.side || "").toUpperCase();
  const orderType = String(order.orderType || "").toLowerCase();
  const reduceOnly = order.reduceOnly === true;
  const isTrigger = order.triggerCondition != null || orderType.includes("stop") || orderType.includes("take");
  const isStop = isTrigger && (orderType.includes("stop") || /stop/i.test(String(order.triggerCondition || "")));
  const isTakeProfit = isTrigger && !isStop &&
    (orderType.includes("take") || /take profit/i.test(String(order.triggerCondition || "")));
  const isStopOrderSide = position.side === "SHORT" ? side === "B" : side === "A";
  const dead = isStop && reduceOnly && isStopOrderSide && trigger != null && limit != null &&
    ((position.side === "SHORT" && limit < trigger) || (position.side === "LONG" && limit > trigger));
  const wrongSideLiquidation = isStop && reduceOnly && isStopOrderSide && trigger != null &&
    position.liquidationPrice != null &&
    ((position.side === "SHORT" && (trigger >= position.liquidationPrice ||
      (position.liquidationPrice - trigger) / position.liquidationPrice < 0.005)) ||
     (position.side === "LONG" && (trigger <= position.liquidationPrice ||
      (trigger - position.liquidationPrice) / position.liquidationPrice < 0.005)));
  const effectiveTakeProfit = isTakeProfit && trigger != null && limit != null
    ? position.side === "LONG" ? Math.max(trigger, limit) : Math.min(trigger, limit)
    : null;
  return {
    oid: order.oid ?? null, side, size, trigger, limit, reduceOnly, orderType,
    isStop, isTakeProfit, dead, wrongSideLiquidation, effectiveTakeProfit,
    status: order.status || "UNVERIFIED",
    isSizedForFullPosition: size >= position.size * 0.99,
    oversized: size > position.size * 1.01,
  };
}

export function candidateRisk(entry: number, stop: number, accountValue: number, direction: "LONG" | "SHORT") {
  if (![entry, stop, accountValue].every(Number.isFinite) || entry <= 0 || accountValue <= 0) return null;
  const validGeometry = direction === "LONG" ? stop < entry : stop > entry;
  if (!validGeometry) return null;
  const riskBudget = accountValue * PORTFOLIO_MAX_RISK_FRACTION;
  const unitRisk = Math.abs(entry - stop);
  const size = riskBudget / unitRisk;
  const notional = size * entry;
  const maxNotional = accountValue * PORTFOLIO_MAX_LEVERAGE;
  const cappedNotional = Math.min(notional, maxNotional);
  return {
    leverage: Math.min(PORTFOLIO_MAX_LEVERAGE, PORTFOLIO_HARD_LEVERAGE_LIMIT),
    size: cappedNotional / entry,
    notionalUsd: cappedNotional,
    stopRiskUsd: cappedNotional / entry * unitRisk,
    riskPctAccount: (cappedNotional / entry * unitRisk / accountValue) * 100,
  };
}

export function suggestedPositionInstruction(input: {
  unrealizedPnl: number | null;
  marginUsed: number | null;
  stopOrders: Array<{ dead: boolean; wrongSideLiquidation: boolean; status?: string }>;
  riskPctOfAccount?: number | null;
  riskCanBeTightened?: boolean;
  side?: "LONG" | "SHORT";
  mark: number | null;
  stopTrigger: number | null;
}) {
  if (input.stopOrders.length === 0 ||
      input.stopOrders.some(order => order.dead || order.wrongSideLiquidation || (order.status && order.status !== "LIVE"))) return "MOVE STOP" as const;
  if (input.mark != null && input.stopTrigger != null &&
      (input.side === "LONG" ? input.mark <= input.stopTrigger :
       input.side === "SHORT" ? input.mark >= input.stopTrigger : false)) return "CLOSE ALL" as const;
  if (input.riskPctOfAccount != null && input.riskPctOfAccount > 5) {
    if (input.riskCanBeTightened) return "MOVE STOP" as const;
    return input.riskPctOfAccount <= 10 ? "CLOSE HALF" as const : "CLOSE ALL" as const;
  }
  if (input.marginUsed && input.marginUsed > 0 && input.unrealizedPnl != null &&
      input.unrealizedPnl / input.marginUsed >= 0.30) return "CLOSE HALF" as const;
  return "HOLD" as const;
}
