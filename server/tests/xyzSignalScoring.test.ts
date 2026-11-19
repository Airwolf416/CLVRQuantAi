import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRsi14,
  countXyzSignals,
  scoreXyzPerp,
  sortXyzSignals,
  type XyzDailyCandle,
  type XyzSignalRow,
} from "../lib/xyzSignalScoring";
import { createXyzSignalFeed } from "../services/xyzSignalFeed";

function candlesFromCloses(closes: number[], now = Date.UTC(2026, 10, 19, 12)): XyzDailyCandle[] {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const today = todayUtc.getTime();
  return closes.map((close, index) => ({ t: today - (closes.length - index) * 86_400_000, c: close }));
}

function feedResponse(payload: unknown, ok = true): Response {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}

test("insufficient history remains neutral and keeps supported indicators", () => {
  const row = scoreXyzPerp({
    coin: "xyz:ANT",
    markPrice: 105,
    fundingRate: 0.0001,
    openInterest: 100,
    candles: candlesFromCloses(Array.from({ length: 25 }, (_, i) => 100 + i)),
  });
  assert.equal(row.coin, "ANT");
  assert.equal(row.signal, "NEUTRAL");
  assert.equal(row.historyLabel, "insufficient history");
  assert.equal(row.candleCount, 25);
  assert.equal(row.rsi14, 100);
  assert.equal(row.return7d, (124 - 117) / 117 * 100);
  assert.equal(row.longScore, null);
  assert.equal(row.conviction, null);
});

test("no daily closes means NO_DATA, never a directional signal", () => {
  const row = scoreXyzPerp({
    coin: "xyz:SHEIN",
    markPrice: 33.5,
    fundingRate: -0.01,
    openInterest: 0,
    candles: [],
  });
  assert.equal(row.signal, "NO_DATA");
  assert.equal(row.historyLabel, null);
  assert.equal(row.candleCount, 0);
  assert.equal(row.markPrice, 33.5);
});

test("strong rising and falling histories score directionally with RSI conviction cap", () => {
  const rising = scoreXyzPerp({
    coin: "xyz:NVDA",
    markPrice: 180,
    fundingRate: 0,
    openInterest: 500,
    candles: candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + i)),
  });
  assert.equal(rising.signal, "LONG");
  assert.equal(rising.conviction, "WEAK", "RSI above 75 caps the directional conviction");
  assert.equal(rising.longScore, 5);
  assert.equal(rising.shortScore, 0);

  const falling = scoreXyzPerp({
    coin: "xyz:SP500",
    markPrice: 100,
    fundingRate: 0,
    openInterest: 10,
    candles: candlesFromCloses(Array.from({ length: 60 }, (_, i) => 200 - i)),
  });
  assert.equal(falling.signal, "SHORT");
  assert.equal(falling.conviction, "WEAK", "RSI below 25 caps the directional conviction");
  assert.equal(falling.shortScore, 5);
  assert.equal(falling.longScore, 0);
});

test("contrarian funding thresholds adjust opposite sides and clamp scores", () => {
  const history = candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + i));
  const crowdedLong = scoreXyzPerp({
    coin: "TSLA",
    markPrice: 160,
    fundingRate: 0.0005001,
    openInterest: 1,
    candles: history,
  });
  assert.equal(crowdedLong.longScore, 4);
  assert.equal(crowdedLong.shortScore, 1);
  assert.equal(crowdedLong.signal, "LONG");

  const crowdedShort = scoreXyzPerp({
    coin: "TSLA",
    markPrice: 160,
    fundingRate: -0.0005001,
    openInterest: 1,
    candles: history,
  });
  assert.equal(crowdedShort.longScore, 6);
  assert.equal(crowdedShort.shortScore, 0);
  assert.equal(crowdedShort.signal, "LONG");
});

test("exact funding boundary makes no adjustment and flat prices stay neutral", () => {
  const candles = candlesFromCloses(Array.from({ length: 60 }, () => 100));
  const positive = scoreXyzPerp({ coin: "EUR", markPrice: 1.08, fundingRate: 0.0005, openInterest: 1, candles });
  const negative = scoreXyzPerp({ coin: "EUR", markPrice: 1.08, fundingRate: -0.0005, openInterest: 1, candles });
  assert.equal(positive.signal, "NEUTRAL");
  assert.equal(negative.signal, "NEUTRAL");
  assert.equal(positive.longScore, 0);
  assert.equal(positive.shortScore, 0);
  assert.equal(calculateRsi14(Array(20).fill(100)), 50);
});

test("weekly and monthly returns use closes seven and thirty sessions back", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100);
  closes[closes.length - 8] = 100;
  closes[closes.length - 31] = 100;
  closes[closes.length - 1] = 110;
  const row = scoreXyzPerp({
    coin: "GOLD",
    markPrice: 110,
    fundingRate: 0,
    openInterest: 1,
    candles: candlesFromCloses(closes),
  });
  assert.equal(row.return7d, 10);
  assert.equal(row.return30d, 10);
});

test("signal sorting prioritizes LONG, SHORT, NEUTRAL, then NO_DATA and OI", () => {
  const mk = (coin: string, signal: XyzSignalRow["signal"], oi: number): XyzSignalRow => ({
    coin, markPrice: 1, fundingRate: 0, openInterest: oi, signal, conviction: null,
    historyLabel: null, candleCount: 60, rsi14: 50, return7d: 0, return30d: 0,
    longScore: 0, shortScore: 0,
  });
  const sorted = sortXyzSignals([
    mk("NEUTRAL1", "NEUTRAL", 99), mk("SHORT1", "SHORT", 1),
    mk("LONG_LOW", "LONG", 2), mk("LONG_HIGH", "LONG", 5), mk("NONE", "NO_DATA", 500),
  ]);
  assert.deepEqual(sorted.map(row => row.coin), ["LONG_HIGH", "LONG_LOW", "SHORT1", "NEUTRAL1", "NONE"]);
  assert.deepEqual(countXyzSignals(sorted), { LONG: 2, SHORT: 1, NEUTRAL: 1, NO_DATA: 1 });
});

test("feed requests the xyz universe and prefixed daily candles, returning one counted row per asset", async () => {
  const now = Date.UTC(2026, 10, 19, 12);
  let clock = now;
  const calls: any[] = [];
  const assets = [
    { name: "xyz:ANT" },
    { name: "xyz:NVDA" },
    { name: "xyz:DELISTED" },
  ];
  const candleCloses: Record<string, number[]> = {
    "xyz:ANT": Array.from({ length: 25 }, (_, i) => 100 + i),
    "xyz:NVDA": Array.from({ length: 60 }, (_, i) => 200 - i),
    "xyz:DELISTED": [],
  };
  const fakeFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    if (body.type === "metaAndAssetCtxs") {
      return feedResponse([
        { universe: assets },
        assets.map((_, index) => ({
          markPx: String(100 + index),
          funding: "0.0001",
          openInterest: String(index + 1),
        })),
      ]);
    }
    const closes = candleCloses[body.req.coin] || [];
    return feedResponse(candlesFromCloses(closes, now));
  };
  const feed = createXyzSignalFeed({
    fetch: fakeFetch,
    now: () => clock,
    marketRefreshMs: 15_000,
    candleRefreshMs: 60_000,
    concurrency: 2,
    requestSpacingMs: 0,
  });
  const getSnapshot = feed.getSnapshot;

  const first = await getSnapshot();
  assert.equal(calls[0].type, "metaAndAssetCtxs");
  assert.deepEqual(calls[0], { type: "metaAndAssetCtxs", dex: "xyz" });
  const candleCalls = calls.filter(call => call.type === "candleSnapshot");
  assert.deepEqual(candleCalls.map(call => call.req.coin).sort(), ["xyz:ANT", "xyz:DELISTED", "xyz:NVDA"]);
  for (const call of candleCalls) {
    assert.equal(call.req.interval, "1d");
    assert.equal(call.req.startTime, now - 90 * 86_400_000);
    assert.equal(call.req.endTime, now);
  }
  assert.equal(first.universeSize, 3);
  assert.equal(first.rows.length, 3);
  assert.equal(first.rows.find(row => row.coin === "ANT")?.historyLabel, "insufficient history");
  assert.equal(first.rows.find(row => row.coin === "NVDA")?.signal, "SHORT");
  assert.equal(first.rows.find(row => row.coin === "DELISTED")?.signal, "NO_DATA");
  assert.equal(Object.values(first.counts).reduce((sum, value) => sum + value, 0), 3);

  clock += 16_000;
  await getSnapshot();
  assert.equal(calls.filter(call => call.type === "candleSnapshot").length, 3, "daily candles stay cached between mark refreshes");
  assert.equal(calls.filter(call => call.type === "metaAndAssetCtxs").length, 2, "the live universe and marks refresh every 15 seconds");
});

test("failed first fetch rejects rather than classifying failed candles as NO_DATA", async () => {
  const now = Date.UTC(2026, 10, 19, 12);
  const fakeFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.type === "metaAndAssetCtxs") {
      return feedResponse([{ universe: [{ name: "xyz:ANT" }] }, [{ markPx: "105", funding: "0", openInterest: "10" }]]);
    }
    return feedResponse({ error: "upstream unavailable" });
  };
  const getSnapshot = createXyzSignalFeed({ fetch: fakeFetch, now: () => now, requestSpacingMs: 0 }).getSnapshot;
  await assert.rejects(getSnapshot(), /HYPERLIQUID_CANDLES_MALFORMED/);
});

test("first-load endpoint state returns immediately with progress instead of waiting for all candles", async () => {
  const now = Date.UTC(2026, 10, 19, 12);
  let releaseCandle: (() => void) | null = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.type === "metaAndAssetCtxs") {
      return feedResponse([{ universe: [{ name: "xyz:ANT" }] }, [{ markPx: "105", funding: "0", openInterest: "10" }]]);
    }
    return new Promise<Response>(resolve => {
      releaseCandle = () => resolve(feedResponse([]));
    });
  };
  const feed = createXyzSignalFeed({ fetch: fakeFetch, now: () => now, requestSpacingMs: 0 });
  const state = feed.getState();
  assert.equal(state.status, "loading");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof releaseCandle, "function");
  releaseCandle!();
  const completed = await feed.getSnapshot();
  assert.equal(completed.rows[0].signal, "NO_DATA");
  assert.equal(completed.rows.length, completed.universeSize);
});
