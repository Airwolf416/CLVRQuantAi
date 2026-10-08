import assert from "node:assert/strict";
import test from "node:test";
import { computeCryptoRotation, computeSentiment, type RotationPriceSeries } from "./crypto";
import { computeMacroState, fredSeriesToObservations, type MacroSeries } from "./macro";

const DAY = 86_400_000;
const asOf = Date.parse("2026-10-08T00:15:00.000Z");

function priceSeries(id: string, symbol: string, rank: number, startPrice = 100): RotationPriceSeries {
  const points = Array.from({ length: 230 }, (_, i) => ({
    t: asOf - (229 - i) * DAY,
    price: startPrice * (1 + (229 - i) * 0.001),
  }));
  return { id, symbol, rank, marketCap: 1000, points };
}

function macroSeries(value: (day: number) => number, stale = false): MacroSeries {
  return {
    observations: Array.from({ length: 600 }, (_, i) => ({
      t: asOf - (599 - i) * DAY,
      value: value(599 - i),
    })),
    stale,
  };
}

test("crypto calculations exclude future prices and require 90-day history", () => {
  const btc = priceSeries("bitcoin", "BTC", 1);
  const alt = priceSeries("coin-a", "AAA", 2, 80);
  alt.points.push({ t: asOf + DAY, price: 100_000 });
  const short = { ...priceSeries("short", "SHORT", 3), points: priceSeries("short", "SHORT", 3).points.slice(-40) };
  const state = computeCryptoRotation({
    asOf: new Date(asOf).toISOString(),
    coins: [btc, alt, short],
    totalMarketCap: 100_000,
    stablecoins: [],
    priorDominance: null,
  });
  assert.equal(state.asi.eligible, 1);
  assert.equal(state.asi.excludedInsufficientHistory, 1);
  assert.equal(state.asi.day90.asi, 100);
  assert.equal(state.dominance.raw, 1);
});

test("crypto returns and ASI are null without complete BTC reference history", () => {
  const btc = priceSeries("bitcoin", "BTC", 1).points.slice(-10);
  const state = computeCryptoRotation({
    asOf: new Date(asOf).toISOString(),
    coins: [
      { ...priceSeries("bitcoin", "BTC", 1), points: btc },
      priceSeries("coin-a", "AAA", 2),
    ],
    totalMarketCap: null,
    stablecoins: [],
    priorDominance: null,
  });
  assert.equal(state.asi.composite, null);
  assert.equal(state.dominance.raw, null);
  assert.equal(state.status, "warming_up");
});

test("sentiment uses weighted empirical percentiles, inverts stable dominance, and reweights available factors", () => {
  const history = {
    fundingOiWeighted7d: Array.from({ length: 100 }, (_, i) => i),
    aggregateOiChange30d: Array.from({ length: 100 }, (_, i) => i),
    memeExcess30d: Array.from({ length: 100 }, (_, i) => i),
    fearGreed: Array.from({ length: 100 }, (_, i) => i),
    stableDominanceChange30d: Array.from({ length: 100 }, (_, i) => i),
    smallCapAsi: Array.from({ length: 100 }, (_, i) => i),
  };
  const state = computeSentiment(asOf, {
    fundingOiWeighted7d: 100,
    aggregateOiChange30d: null,
    memeExcess30d: 100,
    fearGreed: 100,
    stableDominanceChange30d: 0,
    smallCapAsi: 100,
  }, history);
  assert.equal(state.status, "warming_up");
  assert.equal(state.availableComponents, 5);
  assert.ok(state.score != null && state.score > 80);
  assert.equal(state.components.find(row => row.name === "stableDominanceChange30d")?.percentile, 100);
});

test("macro formula clips z-scores, applies bearish signs, excludes stale inputs, and reweights", () => {
  const rising = macroSeries(day => day + Math.sin(day) * 0.1);
  const falling = macroSeries(day => 1000 - day + Math.cos(day) * 0.1);
  const stable = macroSeries(() => 0);
  const state = computeMacroState({
    netLiquidity: rising,
    dxy: falling,
    treasury10y: { ...falling, stale: true },
    vix: falling,
    btcEtfFlows: rising,
    nasdaq: rising,
    wti: falling,
    fedPolicyProxy: falling,
    gold: rising,
  }, asOf);
  const net = state.factors.find(row => row.factor === "netLiquidity")!;
  const dxy = state.factors.find(row => row.factor === "dxy")!;
  const stale = state.factors.find(row => row.factor === "treasury10y")!;
  assert.equal(net.zscore, 3);
  assert.equal(dxy.zscore, 3);
  assert.equal(stale.contribution, null);
  assert.equal(state.activeFactorCount, 7);
  assert.equal(state.status, "partial");
  assert.equal(state.factors.find(row => row.factor === "gold")?.weight, 0);
  assert.equal(stable.observations.length, 600);
});

test("macro engine needs a full 252 rolling-change sample before scoring", () => {
  const short = macroSeries(day => day, false);
  short.observations = short.observations.slice(-260);
  const state = computeMacroState({
    netLiquidity: short, dxy: short, treasury10y: short, vix: short,
    btcEtfFlows: short, nasdaq: short, wti: short, fedPolicyProxy: short,
  }, asOf);
  assert.equal(state.score, null);
  assert.equal(state.label, "UNAVAILABLE");
  assert.equal(state.activeFactorCount, 0);
});

test("FRED null observations are forward-filled without inventing zeroes and future rows are ignored", () => {
  const values = fredSeriesToObservations([
    { date: "2026-10-06", value: 42 },
    { date: "2026-10-07", value: null },
    { date: "2026-10-09", value: 0 },
  ], asOf);
  assert.deepEqual(values.map(row => row.value), [42, 42]);
});
