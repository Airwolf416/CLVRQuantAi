import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePortfolioPnl, candidateRisk, classifyOpenOrder, combinedAccountValue,
  localDateTimeToUtc, localPortfolioClock, portfolioDuePhase, portfolioPnlPeriodBounds,
  portfolioPnlCacheFresh, readSpotFreeUsdc, validWalletAddress,
} from "./portfolioAdvisorCore";
import { buildPositionRows, fetchPortfolioPnlSnapshot, fetchWalletSnapshot, nextPortfolioAdvisorAction } from "./portfolioAdvisor";

const SOL_WALLET = "0x3ae239c86EeD4f75B5213E8b01A8f1ad52088363";

test("timezone scheduling uses the selected IANA zone, including DST", () => {
  assert.equal(validWalletAddress(SOL_WALLET), true);
  assert.equal(validWalletAddress("private-key-or-seed"), false);
  const summer = new Date("2026-06-12T10:30:00.000Z");
  const winter = new Date("2026-12-12T11:30:00.000Z");
  assert.deepEqual(localPortfolioClock(summer, "America/Toronto")?.dateKey, "2026-06-12");
  assert.deepEqual(localPortfolioClock(winter, "America/Toronto")?.dateKey, "2026-12-12");
  assert.equal(portfolioDuePhase(new Date("2026-11-20T11:30:00.000Z"), "America/Toronto", [])?.phase, "morning");
  assert.equal(portfolioDuePhase(new Date("2026-11-20T11:29:00.000Z"), "America/Toronto", []), null);
  assert.equal(localPortfolioClock(new Date("2026-03-08T11:30:00.000Z"), "America/Toronto")?.hour, 7);
});

test("per-user local schedule prepares signals before morning, checks each 15 minutes, and stops at 9 PM", () => {
  assert.equal(nextPortfolioAdvisorAction(6 * 60 + 10, false, false), "prepare_signals");
  assert.equal(nextPortfolioAdvisorAction(6 * 60 + 30, false, false), "morning");
  assert.equal(nextPortfolioAdvisorAction(6 * 60 + 45, true, false), "intraday");
  assert.equal(nextPortfolioAdvisorAction(6 * 60 + 46, true, false), null);
  assert.equal(nextPortfolioAdvisorAction(21 * 60, true, false), "evening");
  assert.equal(nextPortfolioAdvisorAction(21 * 60, false, false), null);
  assert.equal(nextPortfolioAdvisorAction(21 * 60 + 15, true, true), null);
});

test("combined value requires both perp accounts and free spot USDC", () => {
  assert.deepEqual(combinedAccountValue(
    { marginSummary: { accountValue: "1000" } },
    { marginSummary: { accountValue: "200" } },
    { balances: [{ coin: "USDC", total: "50", hold: "10" }] },
  ), { mainPerps: 1000, xyzPerps: 200, spotFreeUsdc: 40, total: 1240 });
  assert.equal(combinedAccountValue({}, { marginSummary: { accountValue: 200 } }, { balances: [] }), null);
  assert.equal(readSpotFreeUsdc({ balances: [{ coin: "USDC", total: 10, hold: 12 }] }), null);
});

test("hard-coded candidate risk cap never exceeds five percent of account equity", () => {
  const long = candidateRisk(100, 95, 10_000, "LONG")!;
  const short = candidateRisk(100, 105, 10_000, "SHORT")!;
  assert.equal(long.leverage, 2);
  assert.ok(long.riskPctAccount <= 5);
  assert.ok(short.riskPctAccount <= 5);
  assert.equal(candidateRisk(100, 105, 10_000, "LONG"), null);
});

test("live order checks flag both dead stops and identify an oversized partial-close target", () => {
  const sol = classifyOpenOrder({
    side: "B", reduceOnly: true, orderType: "Stop Limit", triggerPx: "80", limitPx: "72",
    triggerCondition: "Price above 80", sz: "2",
  }, { side: "SHORT", size: 2, liquidationPrice: 100 });
  assert.equal(sol.dead, true);
  assert.equal(sol.wrongSideLiquidation, false);

  const mega = classifyOpenOrder({
    side: "A", reduceOnly: true, orderType: "Stop Limit", triggerPx: "0.047", limitPx: "0.0517",
    triggerCondition: "Price below 0.047", sz: "108",
  }, { side: "LONG", size: 108, liquidationPrice: 0.04 });
  assert.equal(mega.dead, true);

  const ena = classifyOpenOrder({
    side: "A", reduceOnly: true, orderType: "Take Profit Limit", triggerPx: "0.062", limitPx: "0.0682",
    triggerCondition: "Price above 0.062", sz: "429",
  }, { side: "LONG", size: 108, liquidationPrice: 0.03 });
  assert.equal(ena.isTakeProfit, true);
  assert.equal(ena.effectiveTakeProfit, 0.0682);
  assert.equal(ena.oversized, true);
});

test("public account reader requests read-only data and verifies every open order", async () => {
  const requests: any[] = [];
  const pos = (coin: string, size: string, liq: string) => ({
    position: { coin, szi: size, entryPx: "10", unrealizedPnl: "2", marginUsed: "5", leverage: { value: 2 }, liquidationPx: liq, positionValue: "20" },
  });
  const orders = [
    { coin: "SOL", side: "B", reduceOnly: true, orderType: "Stop Limit", triggerCondition: "Price above 80", triggerPx: "80", limitPx: "72", sz: "2", oid: 1 },
    { coin: "MEGA", side: "A", reduceOnly: true, orderType: "Stop Limit", triggerCondition: "Price below 0.047", triggerPx: "0.047", limitPx: "0.0517", sz: "108", oid: 2 },
    { coin: "ENA", side: "A", reduceOnly: true, orderType: "Take Profit Limit", triggerCondition: "Price above 0.062", triggerPx: "0.062", limitPx: "0.0682", sz: "429", oid: 3 },
  ];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    let body: any;
    if (request.type === "clearinghouseState" && !request.dex) body = {
      marginSummary: { accountValue: "1000" },
      assetPositions: [pos("SOL", "-2", "100"), pos("MEGA", "108", "0.04"), pos("ENA", "108", "0.03")],
    };
    else if (request.type === "clearinghouseState" && request.dex === "xyz") body = { marginSummary: { accountValue: "200" }, assetPositions: [] };
    else if (request.type === "spotClearinghouseState") body = { balances: [{ coin: "USDC", total: "40", hold: "10" }] };
    else if (request.type === "openOrders") body = request.dex === "xyz" ? [] : orders;
    else if (request.type === "allMids") body = {};
    else if (request.type === "userFillsByTime") body = [];
    else if (request.type === "orderStatus") body = { status: "order", order: { status: "open" } };
    else throw new Error("Unexpected Info request");
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const snapshot = await fetchWalletSnapshot(SOL_WALLET, { fetch: fetcher, now: new Date("2026-11-20T12:00:00Z"), requestSpacingMs: 0 });
  const rows = buildPositionRows(snapshot.positions, snapshot.orders);
  assert.equal(snapshot.account?.total, 1230);
  assert.equal(rows.find(p => p.coin === "SOL")?.stopStatus, "DEAD");
  assert.equal(rows.find(p => p.coin === "MEGA")?.stopStatus, "DEAD");
  assert.equal(rows.find(p => p.coin === "ENA")?.target?.size, 429);
  assert.equal(rows.find(p => p.coin === "ENA")?.target?.correctSize, 108);
  assert.equal(requests.length, 11);
  assert.equal(requests.filter(r => r.type === "orderStatus").length, 3);
  assert.ok(requests.every(r => !("privateKey" in r) && !("signature" in r)));
});

test("PnL calendar boundaries use local midnights across DST and calendar periods", () => {
  const daily = portfolioPnlPeriodBounds(new Date("2026-03-09T12:00:00Z"), "America/Toronto", "daily");
  assert.equal(new Date(daily.currentStart).toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(new Date(daily.previousStart).toISOString(), "2026-03-08T05:00:00.000Z");
  const monthly = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "monthly");
  assert.equal(new Date(monthly.currentStart).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(new Date(monthly.previousStart).toISOString(), "2026-10-01T04:00:00.000Z");
  const quarterly = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "quarterly");
  assert.equal(new Date(quarterly.currentStart).toISOString(), "2026-10-01T04:00:00.000Z");
  assert.equal(new Date(quarterly.previousStart).toISOString(), "2026-07-01T04:00:00.000Z");
  const yearly = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "yearly");
  assert.equal(new Date(yearly.currentStart).toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(new Date(yearly.previousStart).toISOString(), "2025-01-01T05:00:00.000Z");
  assert.equal(new Date(localDateTimeToUtc("2026-11-01", "America/Toronto")).toISOString(), "2026-11-01T04:00:00.000Z");
});

test("PnL cache is reusable for 15 minutes and refreshes after expiry", () => {
  const now = Date.parse("2026-11-20T14:00:00Z");
  assert.equal(portfolioPnlCacheFresh(now - 14 * 60_000, now), true);
  assert.equal(portfolioPnlCacheFresh(now - 15 * 60_000, now), false);
  assert.equal(portfolioPnlCacheFresh(now + 1, now), false);
});

test("PnL aggregates realized fills, xyz-prefixed fills, funding, unrealized separately, and daily bars", () => {
  const bounds = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "monthly");
  const result = aggregatePortfolioPnl(bounds, [
    { coin: "xyz:ANT", dir: "Close Short", px: "1.2", sz: "20", closedPnl: "4.18", time: Date.parse("2026-11-19T15:00:00Z"), tid: "a" },
    { coin: "SOL", dir: "Close Long", px: "100", sz: "1", closedPnl: "0.83", time: Date.parse("2026-11-20T13:00:00Z"), tid: "b" },
    { coin: "ENA", dir: "Close Short", px: "0.2", sz: "10", closedPnl: "1.26", time: Date.parse("2026-11-20T13:30:00Z"), tid: "c" },
    { coin: "BTC", dir: "Open Long", px: "90000", sz: "0.01", closedPnl: "0", time: Date.parse("2026-11-20T12:00:00Z"), tid: "d" },
    { coin: "BTC", dir: "Close Long", px: "90000", sz: "0.01", closedPnl: "-3", time: Date.parse("2026-10-12T12:00:00Z"), tid: "e" },
  ], [
    { time: Date.parse("2026-11-19T12:00:00Z"), delta: { usdc: "0.5" } },
    { time: Date.parse("2026-11-20T12:00:00Z"), delta: { usdc: "2" } },
    { time: Date.parse("2026-10-20T12:00:00Z"), delta: { usdc: "1" } },
  ], 7.5);
  assert.equal(result.current.realizedPnl, 6.27);
  assert.equal(result.current.fundingPnl, 2.5);
  assert.equal(result.current.totalPnl, 8.77);
  assert.equal(result.current.unrealizedPnl, 7.5);
  assert.equal(result.current.tradesCount, 3);
  assert.equal(result.current.wins, 3);
  assert.equal(result.current.losses, 0);
  assert.equal(result.previous.totalPnl, -2);
  assert.equal(result.dailyBreakdown.find(row => row.date === "2026-11-19")?.realized, 4.18);
  assert.equal(result.dailyBreakdown.find(row => row.date === "2026-11-19")?.fills[0]?.coin, "xyz:ANT");
  const empty = aggregatePortfolioPnl(bounds, [], [], 0);
  assert.equal(empty.current.realizedPnl, 0);
  assert.equal(empty.current.totalPnl, 0);
  assert.equal(empty.noTrades, true);
  const fundingOnly = aggregatePortfolioPnl(bounds, [], [
    { time: Date.parse("2026-11-20T12:00:00Z"), delta: { usdc: "0.25" } },
  ], 0);
  assert.equal(fundingOnly.current.realizedPnl, 0);
  assert.equal(fundingOnly.current.fundingPnl, 0.25);
  assert.equal(fundingOnly.current.totalPnl, 0.25);
  assert.equal(fundingOnly.noTrades, true);
});

test("PnL snapshot queries main and xyz fills/funding plus live unrealized positions", async () => {
  const requests: any[] = [];
  const bounds = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "daily");
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    let body: any = [];
    if (request.type === "userFillsByTime") {
      body = [
        { coin: "SOL", dir: "Close Long", px: "100", sz: "1", closedPnl: "0.83", time: Date.parse("2026-11-20T13:00:00Z"), tid: "main-b" },
        { coin: "xyz:ANT", dir: "Close Short", px: "1.2", sz: "20", closedPnl: "4.18", time: Date.parse("2026-11-19T15:00:00Z"), tid: "xyz-a" },
      ];
    } else if (request.type === "userFunding") {
      body = [{ time: Date.parse("2026-11-20T12:00:00Z"), delta: { usdc: "1.5" } }];
    } else if (request.type === "clearinghouseState") {
      body = request.dex === "xyz"
        ? { assetPositions: [{ position: { coin: "ANT", szi: "-1", entryPx: "1", unrealizedPnl: "2", marginUsed: "1" } }] }
        : { assetPositions: [{ position: { coin: "SOL", szi: "1", entryPx: "99", unrealizedPnl: "3", marginUsed: "2" } }] };
    } else throw new Error("Unexpected PnL Info request");
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const snapshot = await fetchPortfolioPnlSnapshot(SOL_WALLET, bounds, { fetch: fetcher, requestSpacingMs: 0 });
  const aggregate = aggregatePortfolioPnl(bounds, snapshot.fills, snapshot.funding, snapshot.unrealizedPnl);
  assert.equal(snapshot.unrealizedPnl, 5);
  assert.equal(aggregate.current.realizedPnl, 0.83);
  assert.equal(aggregate.previous.realizedPnl, 4.18);
  assert.equal(aggregate.current.fundingPnl, 1.5);
  assert.equal(snapshot.fills.find(fill => fill.tid === "xyz-a")?.coin, "xyz:ANT");
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => !("privateKey" in request) && !("signature" in request)));
});

test("history endpoints at their 500-row cap are split into complete smaller ranges", async () => {
  const requests: any[] = [];
  const bounds = portfolioPnlPeriodBounds(new Date("2026-11-20T14:00:00Z"), "America/Toronto", "quarterly");
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    let body: any = [];
    if (request.type === "userFunding") {
      const span = request.endTime - request.startTime;
      body = span > 30 * 24 * 60 * 60_000
        ? Array.from({ length: 500 }, (_, i) => ({ time: request.startTime + i, delta: { coin: "SIM", usdc: "1" } }))
        : [{ time: request.startTime + 1, delta: { coin: "SIM", usdc: "1" } }];
    } else if (request.type === "clearinghouseState") body = { assetPositions: [] };
    else if (request.type !== "userFillsByTime") throw new Error("Unexpected history request");
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const snapshot = await fetchPortfolioPnlSnapshot(SOL_WALLET, bounds, { fetch: fetcher, requestSpacingMs: 0 });
  assert.ok(requests.filter(request => request.type === "userFunding").length > 1);
  assert.equal(snapshot.funding.length, requests.filter(request => request.type === "userFunding").length - 1);
});
