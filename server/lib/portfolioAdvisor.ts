import { pool } from "../db";
import { liveSignals } from "../state";
import { getXyzSignalSnapshot } from "../services/xyzSignalFeed";
import { getWeeklyDigestMailer } from "../resendClient";
import { sendPushBatch } from "../workers/notifications";
import { isBriefTimeZone } from "../../shared/briefTimeZones";
import {
  PORTFOLIO_ADVISOR_DISCLAIMER,
  aggregatePortfolioPnl, candidateRisk, classifyOpenOrder, combinedAccountValue,
  flattenPerpPositions, localDateTimeToUtc, localPortfolioClock, portfolioPnlPeriodBounds,
  portfolioPnlCacheFresh, suggestedPositionInstruction, validWalletAddress,
  type PortfolioPnlPeriod,
} from "./portfolioAdvisorCore";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const LOCK_ID = 548_219;
const SIGNAL_MAX_AGE_MS = 15 * 60_000;
const FILL_LOOKBACK_MS = 20 * 60_000;
const ADVISOR_APP_URL = process.env.APP_URL || "https://clvrquantai.com";
let nextInfoRequestAt = 0;

type Fetcher = typeof fetch;
type WalletPosition = ReturnType<typeof flattenPerpPositions>[number];

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function quoteDailyTable(date: string, prefix: "signals" | "signals-xyz") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_SIGNAL_DATE");
  return `"${prefix}-${date}"`;
}

export function nextPortfolioAdvisorAction(localMinute: number, hasMorningPlan: boolean, hasEveningPlan: boolean) {
  if (!Number.isInteger(localMinute) || localMinute < 0 || localMinute >= 1440) return null;
  if (localMinute >= 6 * 60 && localMinute < 6 * 60 + 30 && !hasMorningPlan) return "prepare_signals" as const;
  if (localMinute >= 6 * 60 + 30 && localMinute < 21 * 60 && !hasMorningPlan) return "morning" as const;
  if (localMinute >= 21 * 60 && hasMorningPlan && !hasEveningPlan) return "evening" as const;
  if (localMinute >= 6 * 60 + 30 && localMinute < 21 * 60 && hasMorningPlan &&
      (localMinute - (6 * 60 + 30)) % 15 === 0) return "intraday" as const;
  return null;
}

async function postInfo(payload: unknown, fetcher: Fetcher = fetch, dex = "", spacingMs = 600) {
  const now = Date.now();
  const wait = Math.max(0, nextInfoRequestAt - now);
  nextInfoRequestAt = Math.max(now, nextInfoRequestAt) + spacingMs;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  const request = dex ? { ...(payload as any), dex } : payload;
  const response = await fetcher(INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HYPERLIQUID_HTTP_${response.status}`);
  return response.json();
}

export async function fetchWalletSnapshot(
  address: string,
  options: { fetch?: Fetcher; now?: Date; fillsSince?: number; requestSpacingMs?: number; includeFills?: boolean } = {},
) {
  if (!validWalletAddress(address)) throw new Error("INVALID_PUBLIC_WALLET_ADDRESS");
  const fetcher = options.fetch || fetch;
  const now = options.now || new Date();
  const call = (payload: unknown, dex?: string) => postInfo(payload, fetcher, dex || "", options.requestSpacingMs ?? 600);
  // Make requests in sequence: portfolio refreshes are per-user and the
  // public Info endpoint is shared with market data workers.
  const main = await call({ type: "clearinghouseState", user: address });
  const xyz = await call({ type: "clearinghouseState", user: address }, "xyz");
  const spot = await call({ type: "spotClearinghouseState", user: address });
  const mainOrders = await call({ type: "openOrders", user: address });
  const xyzOrders = await call({ type: "openOrders", user: address }, "xyz");
  const mainMids = await call({ type: "allMids" });
  const xyzMids = await call({ type: "allMids" }, "xyz");
  const since = options.fillsSince ?? now.getTime() - 24 * 60 * 60_000;
  const fills = options.includeFills === false ? [] :
    await call({ type: "userFillsByTime", user: address, startTime: since, endTime: now.getTime() });
  if (!Array.isArray(mainOrders) || !Array.isArray(xyzOrders) || !Array.isArray(fills) ||
      !mainMids || typeof mainMids !== "object" || !xyzMids || typeof xyzMids !== "object") {
    throw new Error("HYPERLIQUID_PORTFOLIO_RESPONSE_INVALID");
  }
  const marks = { ...mainMids, ...xyzMids };
  const positions: WalletPosition[] = [
    ...flattenPerpPositions(main, "main", marks),
    ...flattenPerpPositions(xyz, "xyz", marks),
  ];
  const account = combinedAccountValue(main, xyz, spot);
  const orders = [...mainOrders.map((o: any) => ({ ...o, _dex: "main" })),
    ...xyzOrders.map((o: any) => ({ ...o, _dex: "xyz" }))];
  const validatedOrders = [];
  for (const order of orders) {
    if (!Number.isFinite(Number(order.oid))) {
      validatedOrders.push({ ...order, validation: { status: "UNVERIFIED", error: "ORDER_ID_MISSING" } });
      continue;
    }
    try {
      const status = await call({ type: "orderStatus", user: address, oid: Number(order.oid) }, order._dex === "xyz" ? "xyz" : "");
      const statusValues = [status?.order?.status, status?.order?.order?.status, status?.status]
        .map((value: any) => String(value || "").toLowerCase());
      const statusText = statusValues.find((value: string) =>
        ["open", "filled", "canceled", "triggered", "rejected", "margincanceled"].includes(value)) || "unverified";
      const authoritativeOrder = status?.order?.order || status?.order;
      validatedOrders.push({
        ...order,
        ...(authoritativeOrder && typeof authoritativeOrder === "object" ? authoritativeOrder : {}),
        _dex: order._dex,
        validation: { status: statusText === "open" ? "LIVE" : statusText.toUpperCase(), raw: status },
      });
    } catch {
      validatedOrders.push({ ...order, validation: { status: "UNVERIFIED", error: "ORDER_STATUS_UNAVAILABLE" } });
    }
  }
  return {
    account, positions, orders: validatedOrders, fills,
    capturedAt: now.toISOString(),
  };
}

// userFunding is capped at 500 records by the public Info API. Use that
// conservative threshold for both history endpoints so a full 30-day chunk
// never silently accepts a truncated response.
const MAX_HL_HISTORY_ROWS = 500;
const MAX_HL_HISTORY_REQUESTS = 128;

function historyIdentity(item: any, kind: "fills" | "funding") {
  const rawCoin = String(item.coin || "");
  const coin = rawCoin.toLowerCase().startsWith("xyz:")
    ? rawCoin : item._sourceDex === "xyz" ? `xyz:${rawCoin}` : rawCoin;
  const hash = String(item.hash || "");
  const stableHash = hash && !/^0x0+$/i.test(hash) ? hash : "";
  if (kind === "fills") {
    return `${coin}|${String(stableHash || item.tid || [
      item.time, item.dir, item.px, item.sz, item.closedPnl,
    ].join(":"))}`;
  }
  return `${coin}|${String(stableHash || [
    item.time, item.delta?.coin, item.delta?.usdc, item.delta?.szi, item.delta?.fundingRate,
  ].join(":"))}`;
}

async function fetchHistoryRange(
  address: string,
  type: "userFillsByTime" | "userFunding",
  startTime: number,
  endTime: number,
  dex: "main" | "xyz",
  fetcher: Fetcher,
  spacingMs: number,
  budget: { calls: number },
): Promise<any[]> {
  budget.calls++;
  if (budget.calls > MAX_HL_HISTORY_REQUESTS) throw new Error("HYPERLIQUID_HISTORY_REQUEST_LIMIT");
  const payload = await postInfo({
    type, user: address, startTime, endTime,
  }, fetcher, dex === "xyz" ? "xyz" : "", spacingMs);
  if (!Array.isArray(payload)) throw new Error(`HYPERLIQUID_${type.toUpperCase()}_INVALID`);
  if (payload.length < MAX_HL_HISTORY_ROWS) return payload.map(item => ({ ...item, _sourceDex: dex }));
  const span = endTime - startTime;
  if (span <= 60 * 60_000) throw new Error("HYPERLIQUID_HISTORY_RANGE_STILL_CAPPED");
  const chunkMs = Math.min(30 * 24 * 60 * 60_000, Math.ceil(span / 2));
  const chunks: any[] = [];
  for (let cursor = startTime; cursor < endTime; cursor += chunkMs) {
    chunks.push(...await fetchHistoryRange(address, type, cursor, Math.min(endTime, cursor + chunkMs), dex, fetcher, spacingMs, budget));
  }
  return chunks;
}

export async function fetchPortfolioPnlSnapshot(
  address: string,
  bounds: ReturnType<typeof portfolioPnlPeriodBounds>,
  options: { fetch?: Fetcher; requestSpacingMs?: number } = {},
) {
  if (!validWalletAddress(address)) throw new Error("INVALID_PUBLIC_WALLET_ADDRESS");
  const fetcher = options.fetch || fetch;
  const spacingMs = options.requestSpacingMs ?? 600;
  const budget = { calls: 0 };
  const requests = await Promise.all([
    fetchHistoryRange(address, "userFillsByTime", bounds.previousStart, bounds.currentEnd, "main", fetcher, spacingMs, budget),
    fetchHistoryRange(address, "userFunding", bounds.previousStart, bounds.currentEnd, "main", fetcher, spacingMs, budget),
    postInfo({ type: "clearinghouseState", user: address }, fetcher, "", spacingMs),
    postInfo({ type: "clearinghouseState", user: address }, fetcher, "xyz", spacingMs),
  ]);
  const [allFills, allFunding, mainState, xyzState] = requests;
  if (!Array.isArray(mainState?.assetPositions) || !Array.isArray(xyzState?.assetPositions)) {
    throw new Error("HYPERLIQUID_POSITION_RESPONSE_INVALID");
  }
  const dedupe = (items: any[], kind: "fills" | "funding") => {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = historyIdentity(item, kind);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // The main user-history response already includes xyz fills with the
  // authoritative "xyz:" coin prefix. Asking the endpoint twice by DEX
  // returns the same user history and would double-count PnL.
  const fills = dedupe(allFills, "fills");
  const funding = dedupe(allFunding, "funding");
  const positions = [
    ...flattenPerpPositions(mainState, "main", {}),
    ...flattenPerpPositions(xyzState, "xyz", {}),
  ];
  const unrealizedAvailable = positions.every(position => position.unrealizedPnl != null);
  const unrealizedPnl = unrealizedAvailable
    ? positions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0)
    : null;
  return {
    fills, funding, unrealizedPnl,
    fillCount: fills.length, fundingCount: funding.length,
  };
}

export async function getPortfolioAdvisorPnl(
  userId: string,
  period: PortfolioPnlPeriod,
  forceRefresh = false,
  now = new Date(),
) {
  const user = await pool.query("SELECT portfolio_wallet_address,portfolio_time_zone FROM users WHERE id=$1", [userId]);
  const config = user.rows[0];
  if (!config) throw new Error("USER_NOT_FOUND");
  if (!validWalletAddress(config.portfolio_wallet_address) || !config.portfolio_time_zone) {
    return { requiresSetup: true, walletConnected: !!config.portfolio_wallet_address, timeZone: config.portfolio_time_zone || null };
  }
  const bounds = portfolioPnlPeriodBounds(now, config.portfolio_time_zone, period);
  const cached = await pool.query(`
    SELECT payload,fetched_at FROM portfolio_advisor_pnl_cache
    WHERE user_id=$1 AND time_zone=$2 AND period=$3 AND period_key=$4
  `, [userId, config.portfolio_time_zone, period, bounds.periodKey]);
  if (!forceRefresh && cached.rows[0] && portfolioPnlCacheFresh(cached.rows[0].fetched_at, now)) {
    return { ...cached.rows[0].payload, cacheHit: true };
  }
  const raw = await fetchPortfolioPnlSnapshot(config.portfolio_wallet_address, bounds);
  const fetchedAt = new Date();
  const payload = {
    ...aggregatePortfolioPnl(bounds, raw.fills, raw.funding, raw.unrealizedPnl),
    timeZone: config.portfolio_time_zone,
    fetchedAt: fetchedAt.toISOString(),
    cacheHit: false,
  };
  await pool.query(`
    INSERT INTO portfolio_advisor_pnl_cache(user_id,time_zone,period,period_key,payload,fetched_at)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)
    ON CONFLICT(user_id,time_zone,period,period_key) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=EXCLUDED.fetched_at
  `, [userId, config.portfolio_time_zone, period, bounds.periodKey, JSON.stringify(payload), fetchedAt]);
  await pool.query("DELETE FROM portfolio_advisor_pnl_cache WHERE fetched_at < NOW() - INTERVAL '60 days'").catch(() => {});
  return payload;
}

async function writeDailySignals(localDate: string) {
  const mainTable = quoteDailyTable(localDate, "signals");
  const xyzTable = quoteDailyTable(localDate, "signals-xyz");
  const now = new Date();
  const xyz = await getXyzSignalSnapshot();
  if (xyz.stale || now.getTime() - xyz.fetchedAt > SIGNAL_MAX_AGE_MS) throw new Error("XYZ_SIGNAL_SNAPSHOT_NOT_FRESH");
  const mainRows = await pool.query(`
    SELECT DISTINCT ON (token) token AS symbol, direction, entry, stop_loss AS "stopLoss",
      tp1 AS "takeProfit", conf, advanced_score AS "score", ts
    FROM signal_history
    WHERE ts > NOW() - INTERVAL '24 hours'
    ORDER BY token, ts DESC
  `);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS ${mainTable} (
      symbol TEXT PRIMARY KEY, direction TEXT NOT NULL, signal JSONB NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${xyzTable} (
      symbol TEXT PRIMARY KEY, direction TEXT NOT NULL, signal JSONB NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL
    )`);
    await client.query(`DELETE FROM ${mainTable}`);
    await client.query(`DELETE FROM ${xyzTable}`);
    for (const row of mainRows.rows) {
      const direction = String(row.direction || "").toUpperCase();
      if (!["LONG", "SHORT"].includes(direction)) continue;
      await client.query(`INSERT INTO ${mainTable}(symbol,direction,signal,captured_at) VALUES($1,$2,$3::jsonb,$4)`,
        [row.symbol, direction, JSON.stringify(row), now]);
    }
    for (const row of xyz.rows) {
      const direction = String(row.signal || "").toUpperCase();
      await client.query(`INSERT INTO ${xyzTable}(symbol,direction,signal,captured_at) VALUES($1,$2,$3::jsonb,$4)`,
        [String(row.coin || ""), direction, JSON.stringify(row), now]);
    }
    await client.query(`
    INSERT INTO portfolio_advisor_signal_runs(local_date,captured_at,xyz_fetched_at,main_count,xyz_count)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(local_date) DO UPDATE SET captured_at=EXCLUDED.captured_at,
      xyz_fetched_at=EXCLUDED.xyz_fetched_at,main_count=EXCLUDED.main_count,xyz_count=EXCLUDED.xyz_count
    `, [localDate, now, new Date(xyz.fetchedAt), mainRows.rows.length, xyz.rows.length]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { mainTable, xyzTable, xyz, mainCount: mainRows.rows.length };
}

async function readDailySignals(localDate: string) {
  const status = await pool.query(`SELECT * FROM portfolio_advisor_signal_runs WHERE local_date=$1`, [localDate]);
  const run = status.rows[0];
  if (!run || Date.now() - new Date(run.captured_at).getTime() > SIGNAL_MAX_AGE_MS ||
      Date.now() - new Date(run.xyz_fetched_at).getTime() > SIGNAL_MAX_AGE_MS) {
    throw new Error("DAILY_SIGNALS_NOT_FRESH");
  }
  const mainTable = quoteDailyTable(localDate, "signals");
  const xyzTable = quoteDailyTable(localDate, "signals-xyz");
  const [main, xyz] = await Promise.all([
    pool.query(`SELECT symbol,direction,signal FROM ${mainTable}`),
    pool.query(`SELECT symbol,direction,signal FROM ${xyzTable}`),
  ]);
  return { main: main.rows, xyz: xyz.rows, mainTable: `signals-${localDate}`, xyzTable: `signals-xyz-${localDate}` };
}

function getOrdersForPosition(position: WalletPosition, orders: any[]) {
  return orders.filter(order => String(order.coin || "").toUpperCase() === position.coin.toUpperCase() &&
    (order._dex || "main") === position.dex);
}

function correctedStopLimit(position: WalletPosition, trigger: number | null) {
  if (trigger == null) return null;
  const limit = position.side === "SHORT" ? trigger * 1.025 : trigger * 0.975;
  return { trigger, limit: Number(limit.toPrecision(8)) };
}

function stopFromLiveLiquidation(position: WalletPosition, existingTrigger: number | null) {
  const { liquidationPrice: liquidation, mark, entry } = position;
  if (liquidation == null || mark == null || entry == null || liquidation <= 0) return null;
  // Keep a 1% buffer from liquidation. Refuse to suggest a level beyond the
  // live mark or farther from entry than an existing stop.
  const trigger = position.side === "SHORT" ? liquidation * 0.99 : liquidation * 1.01;
  const correctlyPlaced = position.side === "SHORT"
    ? trigger < liquidation && trigger > mark
    : trigger > liquidation && trigger < mark;
  if (!correctlyPlaced) return null;
  if (existingTrigger != null && Math.abs(trigger - entry) > Math.abs(existingTrigger - entry)) return null;
  return Number(trigger.toPrecision(8));
}

function stopWithinRiskBudget(position: WalletPosition, accountValue: number | null, existingTrigger: number | null) {
  const { entry, size, liquidationPrice, mark } = position;
  if (accountValue == null || accountValue <= 0 || entry == null || size <= 0 ||
      liquidationPrice == null || liquidationPrice <= 0 || mark == null) return null;
  const maxLossPerUnit = accountValue * 0.05 / size;
  const riskBound = position.side === "LONG" ? entry - maxLossPerUnit : entry + maxLossPerUnit;
  const liquidationBound = position.side === "LONG" ? liquidationPrice * 1.01 : liquidationPrice * 0.99;
  const trigger = position.side === "LONG"
    ? Math.max(riskBound, liquidationBound)
    : Math.min(riskBound, liquidationBound);
  const safeOfMarkAndEntry = position.side === "LONG"
    ? trigger < entry && trigger < mark && trigger > liquidationPrice
    : trigger > entry && trigger > mark && trigger < liquidationPrice;
  if (!safeOfMarkAndEntry) return null;
  if (existingTrigger != null &&
      (position.side === "LONG" ? trigger < existingTrigger : trigger > existingTrigger)) return null;
  return Number(trigger.toPrecision(8));
}

function makeCandidateRows(signals: any[], accountValue: number | null, heldPositions: WalletPosition[] = []) {
  if (accountValue == null || accountValue <= 0) return [];
  const result: any[] = [];
  const sorted = [...signals].sort((a, b) => Number(b.signal?.score ?? b.signal?.conf ?? 0) - Number(a.signal?.score ?? a.signal?.conf ?? 0));
  for (const row of sorted) {
    if (result.length >= 2) break;
    const signal = row.signal || {};
    const direction = String(row.direction || "").toUpperCase();
    if (direction !== "LONG" && direction !== "SHORT") continue;
    if (heldPositions.some(position => position.coin.toUpperCase().replace(/^XYZ:/, "") === String(row.symbol).toUpperCase().replace(/^XYZ:/, ""))) continue;
    const entry = finite(signal.entry ?? signal.entry_price);
    const stop = finite(signal.stopLoss ?? signal.stop_loss ?? signal.stop);
    const target = finite(signal.takeProfit ?? signal.tp1 ?? signal.tp1Price);
    if (entry == null || stop == null || target == null) continue;
    const sizing = candidateRisk(entry, stop, accountValue, direction);
    if (!sizing || sizing.riskPctAccount > 5.000001 || sizing.leverage > 5) continue;
    result.push({
      symbol: row.symbol, direction, entry, stop, target,
      leverage: sizing.leverage, size: sizing.size, notionalUsd: sizing.notionalUsd,
      stopRiskUsd: sizing.stopRiskUsd, riskPctAccount: sizing.riskPctAccount,
      source: row.source || "main",
    });
  }
  return result;
}

function liveOrderDetail(order: any, position: WalletPosition) {
  const c = order.validation || {};
  const fact = classifyOpenOrder(order, {
    side: position.side,
    size: position.size,
    liquidationPrice: position.liquidationPrice,
  });
  return {
    ...fact,
    status: c.status || "UNVERIFIED",
    dex: order._dex,
  };
}

export function buildPositionRows(positions: WalletPosition[], orders: any[], accountValue: number | null = null) {
  return positions.map(position => {
    const group = getOrdersForPosition(position, orders).map(order => liveOrderDetail(order, position));
    const stops = group.filter(o => o.isStop);
    const targets = group.filter(o => o.isTakeProfit);
    const stop = stops[0] || null;
    const target = targets[0] || null;
    const stopRiskUsd = stop?.trigger != null && position.entry != null
      ? Math.abs(position.entry - stop.trigger) * position.size : null;
    const riskPctOfAccount = stopRiskUsd != null && accountValue != null && accountValue > 0
      ? stopRiskUsd / accountValue * 100 : null;
    const riskLimitedTrigger = riskPctOfAccount != null && riskPctOfAccount > 5
      ? stopWithinRiskBudget(position, accountValue, stop?.trigger ?? null) : null;
    const instruction = suggestedPositionInstruction({
      unrealizedPnl: position.unrealizedPnl,
      marginUsed: position.marginUsed,
      stopOrders: stops,
      riskPctOfAccount,
      riskCanBeTightened: riskLimitedTrigger != null,
      side: position.side,
      mark: position.mark,
      stopTrigger: stop?.trigger ?? null,
    });
    const replacementTrigger = riskLimitedTrigger ?? (stop?.dead
      ? stop.trigger
      : (!stop || stop.wrongSideLiquidation ? stopFromLiveLiquidation(position, stop?.trigger ?? null) : null));
    const suggestedCorrection = replacementTrigger == null ? null : correctedStopLimit(position, replacementTrigger);
    return {
      ...position,
      instruction,
      stopRiskUsd,
      riskPctOfAccount,
      orders: group,
      stopStatus: !stop ? "NOT FOUND" : stop.status !== "LIVE" ? stop.status : stop.dead || stop.wrongSideLiquidation ? "DEAD" : "LIVE",
      stop: stop ? {
        trigger: stop.trigger, limit: stop.limit, status: stop.status, dead: stop.dead,
        wrongSideLiquidation: stop.wrongSideLiquidation, correction: suggestedCorrection,
        leverage: position.leverage,
      } : suggestedCorrection ? { trigger: null, limit: null, status: "REPLACEMENT SUGGESTION", dead: true,
        wrongSideLiquidation: !stop, correction: suggestedCorrection, leverage: position.leverage } : null,
      target: target ? {
        trigger: target.trigger, limit: target.limit, effectiveFill: target.effectiveTakeProfit,
        status: target.status, size: target.size, needsResize: target.size > position.size * 1.01,
        correctSize: position.size,
      } : null,
      orderStatusUnverified: group.some(o => o.status === "UNVERIFIED"),
    };
  });
}

async function currentLocalDayStart(timeZone: string, now: Date) {
  const local = localPortfolioClock(now, timeZone);
  if (!local) throw new Error("INVALID_PORTFOLIO_TIME_ZONE");
  return localDateTimeToUtc(local.dateKey, timeZone);
}

function dayFills(fills: any[], start: number) {
  return fills.filter(fill => Number(fill.time || 0) >= start);
}

export async function buildPortfolioPlan(
  user: { id: string; portfolio_wallet_address: string; portfolio_time_zone: string },
  phase: "morning" | "evening",
  now = new Date(),
) {
  const local = localPortfolioClock(now, user.portfolio_time_zone);
  if (!local) throw new Error("INVALID_PORTFOLIO_TIME_ZONE");
  const signals = await readDailySignals(local.dateKey);
  const since = await currentLocalDayStart(user.portfolio_time_zone, now);
  const wallet = await fetchWalletSnapshot(user.portfolio_wallet_address, { now, fillsSince: since });
  const positions = buildPositionRows(wallet.positions, wallet.orders, wallet.account?.total ?? null);
  const signalRows = [
    ...signals.main.map((row: any) => ({ ...row, source: "main" })),
    ...signals.xyz.map((row: any) => ({ ...row, source: "xyz" })),
  ];
  const candidates = makeCandidateRows(signalRows, wallet.account?.total ?? null, positions);
  const morning = phase === "evening"
    ? await pool.query(`SELECT content FROM portfolio_advisor_plans WHERE user_id=$1 AND local_date=$2 AND phase='morning'`, [user.id, local.dateKey])
    : null;
  const morningPlan = morning?.rows[0]?.content || null;
  const realizedFills = dayFills(wallet.fills, since);
  const realizedPnlToday = realizedFills.reduce((sum, fill) => sum + (finite(fill.closedPnl) || 0), 0);
  const accountDelta = phase === "evening" && morningPlan?.account?.total != null && wallet.account?.total != null
    ? wallet.account.total - Number(morningPlan.account.total) : null;
  return {
    phase, localDate: local.dateKey, generatedAt: now.toISOString(),
    signalTables: { main: signals.mainTable, xyz: signals.xyzTable, counts: { main: signals.main.length, xyz: signals.xyz.length } },
    account: wallet.account,
    positions,
    candidates,
    candidateNote: candidates.length ? null :
      "No new candidate was available with a complete source-provided entry, stop and target plus verified combined account value. Direction-only xyz signals are not given invented price levels.",
    fills: realizedFills.map(fill => ({
      coin: fill.coin, direction: fill.dir, price: finite(fill.px), size: finite(fill.sz),
      realizedPnl: finite(fill.closedPnl), time: fill.time,
    })),
    daySummary: phase === "evening" ? {
      realizedPnlToday,
      accountValueChangeSinceMorning: accountDelta,
      closed: realizedFills.filter(fill => /close/i.test(String(fill.dir || ""))).map(fill => ({
        coin: fill.coin, direction: fill.dir, price: finite(fill.px), realizedPnl: finite(fill.closedPnl),
      })),
    } : null,
    disclaimer: PORTFOLIO_ADVISOR_DISCLAIMER,
  };
}

async function savePlan(userId: string, plan: any, signalTable: string) {
  const result = await pool.query(`
    INSERT INTO portfolio_advisor_plans(user_id,local_date,phase,signal_table,account_value,content)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT(user_id,local_date,phase) DO NOTHING
    RETURNING id
  `, [userId, plan.localDate, plan.phase, signalTable, plan.account?.total ?? null, JSON.stringify(plan)]);
  return result.rows[0]?.id || null;
}

async function createSignalTablesForDate(dateKey: string) {
  const existing = await pool.query("SELECT * FROM portfolio_advisor_signal_runs WHERE local_date=$1", [dateKey]);
  if (existing.rows[0] && Date.now() - new Date(existing.rows[0].captured_at).getTime() <= SIGNAL_MAX_AGE_MS) {
    return { mainTable: `signals-${dateKey}`, xyzTable: `signals-xyz-${dateKey}` };
  }
  return writeDailySignals(dateKey);
}

export async function claimPortfolioAdvisorAlert(db: Pick<typeof pool, "query">, userId: string, positionKey: string, alertType: string, eventKey: string, payload: any) {
  const result = await db.query(`
    INSERT INTO portfolio_advisor_alerts(user_id,position_key,alert_type,event_key,payload)
    SELECT $1,$2,$3,$4,$5::jsonb
    WHERE NOT EXISTS(
      SELECT 1 FROM portfolio_advisor_alerts
      WHERE user_id=$1 AND position_key=$2 AND alert_type=$3 AND created_at > NOW() - INTERVAL '4 hours'
    )
    ON CONFLICT(event_key) DO NOTHING RETURNING id
  `, [userId, positionKey, alertType, eventKey, JSON.stringify(payload)]);
  return !!result.rows[0];
}

async function registerAlert(userId: string, positionKey: string, alertType: string, eventKey: string, payload: any) {
  return claimPortfolioAdvisorAlert(pool, userId, positionKey, alertType, eventKey, payload);
}

async function deliverAlert(userId: string, alertId: number, payload: any) {
  const alert = await pool.query("SELECT push_status,email_status,email_payload,email_first_attempt_at FROM portfolio_advisor_alerts WHERE id=$1", [alertId]);
  if (!alert.rows[0] || alert.rows[0].email_status !== "pending") return;
  const [subs, user] = await Promise.all([
    alert.rows[0].push_status === "pending" ? pool.query("SELECT id,subscription FROM push_subscriptions WHERE user_id=$1", [userId]) : Promise.resolve({ rows: [] }),
    pool.query("SELECT email FROM users WHERE id=$1", [userId]),
  ]);
  if (alert.rows[0].push_status === "pending" && subs.rows.length) {
    try {
      const stats = await sendPushBatch(subs.rows, "Portfolio Advisor alert", `${payload.symbol}: ${payload.message}`, `portfolio-${alertId}`, ADVISOR_APP_URL);
      await pool.query("UPDATE portfolio_advisor_alerts SET push_status=$2 WHERE id=$1", [alertId, stats.failed ? "partial" : "sent"]);
    } catch { await pool.query("UPDATE portfolio_advisor_alerts SET push_status='failed' WHERE id=$1", [alertId]); }
  } else if (alert.rows[0].push_status === "pending") {
    await pool.query("UPDATE portfolio_advisor_alerts SET push_status='no_subscription' WHERE id=$1", [alertId]);
  }
  const email = user.rows[0]?.email;
  if (!email) return;
  try {
    const row = alert.rows[0];
    if (!row || row.email_status === "sent") return;
    if (row.email_first_attempt_at && Date.now() - new Date(row.email_first_attempt_at).getTime() >= 23 * 60 * 60_000) {
      await pool.query("UPDATE portfolio_advisor_alerts SET email_status='uncertain' WHERE id=$1", [alertId]);
      return;
    }
    const detail = `${payload.symbol}: ${payload.message}`;
    const emailPayload = row.email_payload ? JSON.parse(row.email_payload) : {
      from: "CLVRQuant <hello@clvrquantai.com>", to: email,
      subject: `Portfolio Advisor — ${payload.symbol}`,
      text: `${detail}\n\n${PORTFOLIO_ADVISOR_DISCLAIMER}\n\n${ADVISOR_APP_URL}`,
      html: `<p>${escapeHtml(detail)}</p><p>${escapeHtml(PORTFOLIO_ADVISOR_DISCLAIMER)}</p><a href="${ADVISOR_APP_URL}">Open CLVRQuant</a>`,
    };
    await pool.query(`
      UPDATE portfolio_advisor_alerts SET
        email_payload=COALESCE(email_payload,$2),
        email_first_attempt_at=COALESCE(email_first_attempt_at,NOW())
      WHERE id=$1
    `, [alertId, JSON.stringify(emailPayload)]);
    const mailer = await getWeeklyDigestMailer();
    const response = await mailer.send(emailPayload, { idempotencyKey: `portfolio-alert/${alertId}` });
    if (response?.error) {
      await pool.query("UPDATE portfolio_advisor_alerts SET email_status='failed' WHERE id=$1", [alertId]);
      return;
    }
    if (!response?.data?.id) throw new Error("EMAIL_ACCEPTANCE_UNCONFIRMED");
    await pool.query("UPDATE portfolio_advisor_alerts SET email_status='sent' WHERE id=$1", [alertId]);
  } catch {
    // Retain the frozen payload/key; retry safely while provider idempotency
    // remains valid. The 23-hour guard above holds uncertain older requests.
  }
}

async function retryPendingAlertDeliveries() {
  const pending = await pool.query(`
    SELECT id,user_id,payload FROM portfolio_advisor_alerts
    WHERE email_status='pending' ORDER BY created_at ASC LIMIT 20
  `);
  for (const alert of pending.rows) {
    await deliverAlert(alert.user_id, alert.id, alert.payload);
    await new Promise(resolve => setTimeout(resolve, 600));
  }
}

async function monitorIntraday(user: any, dateKey: string, now: Date) {
  const sinceResult = await pool.query("SELECT last_fill_time FROM portfolio_advisor_fill_cursors WHERE user_id=$1", [user.id]);
  const fillsSince = Math.max(Number(sinceResult.rows[0]?.last_fill_time || 0), now.getTime() - FILL_LOOKBACK_MS);
  const wallet = await fetchWalletSnapshot(user.portfolio_wallet_address, { now, fillsSince });
  const live = new Map(wallet.positions.map(position => [position.key, position]));
  const localSignals = await readDailySignals(dateKey);
  const directions = new Map([...localSignals.main, ...localSignals.xyz].map((row: any) => [String(row.symbol).toUpperCase().replace(/^XYZ:/, ""), String(row.direction).toUpperCase()]));

  const closingFills = wallet.fills.filter((fill: any) =>
    /close/i.test(String(fill.dir || "")) && finite(fill.closedPnl) != null);
  const fillsByCoin = new Map<string, any[]>();
  for (const fill of closingFills) {
    const coin = String(fill.coin || "");
    const sameCoinStillOpen = wallet.positions.some(position =>
      position.coin.toUpperCase().replace(/^XYZ:/, "") === coin.toUpperCase().replace(/^XYZ:/, ""));
    if (sameCoinStillOpen) continue;
    fillsByCoin.set(coin, [...(fillsByCoin.get(coin) || []), fill]);
  }
  for (const [coin, fills] of fillsByCoin) {
    const latest = fills.reduce((a, b) => Number(a.time) > Number(b.time) ? a : b);
    const realizedPnl = fills.reduce((sum, fill) => sum + (finite(fill.closedPnl) || 0), 0);
    const totalSize = fills.reduce((sum, fill) => sum + (finite(fill.sz) || 0), 0);
    const notional = fills.reduce((sum, fill) => sum + (finite(fill.px) || 0) * (finite(fill.sz) || 0), 0);
    const averagePrice = totalSize > 0 ? notional / totalSize : finite(latest.px);
    const positionKey = `${coin.toLowerCase().startsWith("xyz:") ? "xyz" : "main"}:${coin.replace(/^xyz:/i, "")}`;
    const fillsKey = fills.map(fill => fill.hash || fill.tid || fill.time).sort().join("-");
    await registerAlert(user.id, positionKey, "position_closed", `${user.id}:${positionKey}:${fillsKey}`, {
      symbol: coin, message: `Position close confirmed at ${averagePrice}; realized PnL ${realizedPnl}.`,
      price: averagePrice, realizedPnl, time: latest.time,
    });
  }

  for (const position of wallet.positions) {
    const orders = getOrdersForPosition(position, wallet.orders).map(order => liveOrderDetail(order, position));
    const stopOrders = orders.filter(order => order.isStop);
    const stop = stopOrders[0];
    const pnlPct = position.marginUsed && position.marginUsed > 0 && position.unrealizedPnl != null
      ? position.unrealizedPnl / position.marginUsed * 100 : null;
    const prior = await pool.query("SELECT * FROM portfolio_advisor_position_samples WHERE user_id=$1 AND position_key=$2", [user.id, position.key]);
    const previous = prior.rows[0];
    if (pnlPct != null && previous?.pnl_pct_margin != null) {
      for (const threshold of [30, 50]) {
        if (Number(previous.pnl_pct_margin) < threshold && pnlPct >= threshold) {
          await registerAlert(user.id, position.key, `pnl_${threshold}`, `${user.id}:${position.key}:pnl_${threshold}:${Math.floor(now.getTime()/900_000)}`, {
            symbol: position.coin, message: `Unrealized PnL crossed +${threshold}% of used margin; review your pre-set risk plan.`,
            thresholdPctMargin: threshold, pnlPctMargin: pnlPct,
          });
        }
      }
    }
    if (stop?.trigger && position.mark && Math.abs(position.mark-stop.trigger)/stop.trigger <= 0.02) {
      await registerAlert(user.id, position.key, "stop_approach", `${user.id}:${position.key}:stop_approach:${Math.floor(now.getTime()/900_000)}`, {
        symbol: position.coin, message: `Mark is within 2% of the verified stop trigger (${stop.trigger}).`,
        mark: position.mark, trigger: stop.trigger,
      });
    }
    if (stopOrders.some(order => order.dead || order.wrongSideLiquidation)) {
      await registerAlert(user.id, position.key, "order_invalid", `${user.id}:${position.key}:order_invalid:${Math.floor(now.getTime()/900_000)}`, {
        symbol: position.coin, message: "A stop order is misconfigured, on the wrong side of liquidation, or could not be verified.",
      });
    }
    const signalDirection = directions.get(position.coin.toUpperCase().replace(/^XYZ:/, "")) || null;
    if (previous?.signal_direction && signalDirection && previous.signal_direction !== signalDirection) {
      await registerAlert(user.id, position.key, "signal_flip", `${user.id}:${position.key}:signal_flip:${Math.floor(now.getTime()/900_000)}`, {
        symbol: position.coin, message: `The daily signal changed from ${previous.signal_direction} to ${signalDirection}.`,
        previousDirection: previous.signal_direction, signalDirection,
      });
    }
    await pool.query(`
      INSERT INTO portfolio_advisor_position_samples(user_id,position_key,local_date,mark_price,pnl_pct_margin,signal_direction,position_size,sampled_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(user_id,position_key) DO UPDATE SET local_date=EXCLUDED.local_date,mark_price=EXCLUDED.mark_price,
       pnl_pct_margin=EXCLUDED.pnl_pct_margin,signal_direction=EXCLUDED.signal_direction,
       position_size=EXCLUDED.position_size,sampled_at=EXCLUDED.sampled_at
    `, [user.id, position.key, dateKey, position.mark, pnlPct, signalDirection, position.size, now]);
  }
  const latestFill = Math.max(0, ...wallet.fills.map((fill: any) => Number(fill.time || 0)));
  if (latestFill) {
    await pool.query(`INSERT INTO portfolio_advisor_fill_cursors(user_id,last_fill_time) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET last_fill_time=GREATEST(portfolio_advisor_fill_cursors.last_fill_time,EXCLUDED.last_fill_time)`, [user.id, latestFill]);
  }
}

async function processUser(user: any, now: Date) {
  if (!validWalletAddress(user.portfolio_wallet_address) || !user.portfolio_time_zone) return;
  const clock = localPortfolioClock(now, user.portfolio_time_zone);
  if (!clock) return;
  const planRows = await pool.query("SELECT phase FROM portfolio_advisor_plans WHERE user_id=$1 AND local_date=$2", [user.id, clock.dateKey]);
  const phases = planRows.rows.map((row: any) => row.phase);
  const action = nextPortfolioAdvisorAction(clock.minuteOfDay, phases.includes("morning"), phases.includes("evening"));
  // Capture both existing signal feeds during the 6:00–6:29 local window so
  // the morning plan consumes a completed daily snapshot at/after 6:30.
  if (action === "prepare_signals") {
    await createSignalTablesForDate(clock.dateKey);
    return;
  }
  if (action === "morning") {
    const signalTables = await createSignalTablesForDate(clock.dateKey);
    const plan = await buildPortfolioPlan(user, "morning", now);
    await savePlan(user.id, plan, signalTables.mainTable);
    return;
  }
  if (action === "evening") {
    const plan = await buildPortfolioPlan(user, "evening", now);
    await savePlan(user.id, plan, plan.signalTables.main);
    return;
  }
  if (action === "intraday") await monitorIntraday(user, clock.dateKey, now);
}

let schedulerStarted = false;
export function startPortfolioAdvisorScheduler() {
  if (schedulerStarted || process.env.NODE_ENV !== "production") return;
  schedulerStarted = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) { running = false; return; }
    let locked = false;
    try {
      const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID]);
      locked = !!result.rows[0]?.locked;
      if (!locked) return;
      const now = new Date();
      const users = await client.query(`
        SELECT id,portfolio_wallet_address,portfolio_time_zone,tier,email
        FROM users
        WHERE portfolio_wallet_address IS NOT NULL AND portfolio_time_zone IS NOT NULL
          AND (tier='elite' OR LOWER(COALESCE(email,''))=$1)
      `, ["mikeclaver@gmail.com"]);
      for (const user of users.rows) {
        try { await processUser(user, now); }
        catch (error: any) {
          console.error("[portfolio-advisor] user tick failed:", error?.message || "unknown");
        }
      }
      await retryPendingAlertDeliveries();
    } catch (error: any) {
      console.error("[portfolio-advisor] scheduler tick failed:", error?.message || "unknown");
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
      client.release();
      running = false;
    }
  };
  void tick();
  setInterval(tick, 60_000);
  console.log("[portfolio-advisor] production scheduler started; per-user timezone required");
}

export async function getPortfolioAdvisorState(userId: string) {
  const user = await pool.query("SELECT portfolio_wallet_address,portfolio_time_zone FROM users WHERE id=$1", [userId]);
  if (!user.rows[0]) throw new Error("USER_NOT_FOUND");
  const config = user.rows[0];
  if (!validWalletAddress(config.portfolio_wallet_address) || !config.portfolio_time_zone) {
    return { walletConnected: !!config.portfolio_wallet_address, timeZone: config.portfolio_time_zone || null, requiresSetup: true, positions: [], plans: [], alerts: [] };
  }
  const now = new Date();
  const clock = localPortfolioClock(now, config.portfolio_time_zone);
  if (!clock) throw new Error("INVALID_PORTFOLIO_TIME_ZONE");
  const [plans, alerts] = await Promise.all([
    pool.query("SELECT id,local_date,phase,content,created_at FROM portfolio_advisor_plans WHERE user_id=$1 ORDER BY local_date DESC,phase DESC LIMIT 30", [userId]),
    pool.query("SELECT id,position_key,alert_type,payload,created_at FROM portfolio_advisor_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [userId]),
  ]);
  let live: any = { positions: [], account: null, asOf: null, error: null };
  try {
    const snapshot = await fetchWalletSnapshot(config.portfolio_wallet_address, { includeFills: false });
    live = { positions: buildPositionRows(snapshot.positions, snapshot.orders, snapshot.account?.total ?? null), account: snapshot.account, asOf: snapshot.capturedAt, error: null };
  } catch (error: any) {
    live.error = error?.message || "HYPERLIQUID_PORTFOLIO_UNAVAILABLE";
  }
  return {
    walletConnected: true, walletAddress: config.portfolio_wallet_address,
    timeZone: config.portfolio_time_zone, requiresSetup: false, localDate: clock.dateKey,
    live, plans: plans.rows, alerts: alerts.rows,
  };
}

export async function updatePortfolioAdvisorSettings(userId: string, walletAddress: unknown, timeZone: unknown) {
  const address = walletAddress === null || walletAddress === "" ? null :
    typeof walletAddress === "string" && validWalletAddress(walletAddress) ? walletAddress.trim() : undefined;
  if (address === undefined) throw new Error("Enter a valid public 0x wallet address or clear the field.");
  const zone = timeZone === null || timeZone === "" ? null : typeof timeZone === "string" ? timeZone : undefined;
  if (zone === undefined || (zone !== null && !isTimeZone(zone))) throw new Error("Choose a supported time zone in Settings.");
  const result = await pool.query(`
    UPDATE users SET portfolio_wallet_address=$1,portfolio_time_zone=$2 WHERE id=$3
    RETURNING portfolio_wallet_address,portfolio_time_zone
  `, [address, zone, userId]);
  if (!result.rows[0]) throw new Error("USER_NOT_FOUND");
  return { walletConnected: !!result.rows[0].portfolio_wallet_address, timeZone: result.rows[0].portfolio_time_zone };
}

function isTimeZone(value: string) {
  return isBriefTimeZone(value);
}
