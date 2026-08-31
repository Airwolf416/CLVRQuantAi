import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED_INTERVAL_VERSION,
  getClosedIntervals,
  type ClosedIntervalResult,
} from "./closedIntervalProvider";
import { evaluateClosedIntervals } from "./outcomeResolver";

const minute = 60_000;
const now = 4 * minute;

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

test("provider groups duplicate crypto rows into one bulk symbol request", async () => {
  const calls: any[] = [];
  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return response([
      { t: minute, T: 2 * minute - 1, o: "100", h: "111", l: "99", c: "105" },
      { t: 2 * minute, T: 3 * minute - 1, o: "105", h: "106", l: "95", c: "100" },
    ]);
  };
  const result = await getClosedIntervals([
    { symbol: "BTC", startTs: minute },
    { symbol: "btc", startTs: 2 * minute },
  ], { fetchFn: fetchFn as typeof fetch, nowMs: now });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    type: "candleSnapshot",
    req: { coin: "BTC", interval: "1m", startTime: minute, endTime: now },
  });
  assert.equal(result.get("BTC")?.kind, "AVAILABLE");
});

test("provider performs no network work for an empty resolver batch", async () => {
  let calls = 0;
  const result = await getClosedIntervals([], {
    fetchFn: (async () => { calls++; return response([]); }) as typeof fetch,
  });
  assert.equal(calls, 0);
  assert.equal(result.size, 0);
});

test("provider rejects open, malformed, and discontinuous candles", async () => {
  const cases = [
    [{ t: minute, T: 5 * minute - 1, o: "100", h: "101", l: "99", c: "100" }],
    [{ t: minute, T: 2 * minute - 1, o: "100", h: "bad", l: "99", c: "100" }],
    [
      { t: minute, T: 2 * minute - 1, o: "100", h: "101", l: "99", c: "100" },
      { t: 3 * minute, T: 4 * minute - 1, o: "100", h: "101", l: "99", c: "100" },
    ],
  ];
  for (const candles of cases) {
    const result = await getClosedIntervals([{ symbol: "BTC", startTs: minute }], {
      fetchFn: (async () => response(candles)) as typeof fetch,
      nowMs: now,
    });
    assert.equal(result.get("BTC")?.kind, "UNAVAILABLE");
  }
});

test("Yahoo is used only for a canonical configured display mapping", async () => {
  const tickers: string[] = [];
  const result = await getClosedIntervals([
    { symbol: "GOLD", startTs: minute },
    { symbol: "UNCONFIGURED", startTs: minute },
  ], {
    nowMs: 3 * minute,
    fetchFn: (async () => { throw new Error("unexpected"); }) as typeof fetch,
    yahooCandles: async ticker => {
      tickers.push(ticker);
      return [{ t: minute, o: 100, h: 101, l: 99, c: 100, v: 1 }];
    },
  });
  assert.deepEqual(tickers, ["GC=F"]);
  assert.equal(result.get("GOLD")?.kind, "AVAILABLE");
  assert.deepEqual(result.get("UNCONFIGURED"), { kind: "UNAVAILABLE", reason: "CANONICAL_YAHOO_MAPPING_MISSING" });
});

function available(low: number, high: number): ClosedIntervalResult {
  return {
    kind: "AVAILABLE",
    source: "hyperliquid_candleSnapshot",
    version: CLOSED_INTERVAL_VERSION,
    intervals: [{
      startTs: minute,
      endTs: 2 * minute,
      open: 100,
      close: 100,
      low,
      high,
      authoritative: true,
      source: "hyperliquid_candleSnapshot",
      version: CLOSED_INTERVAL_VERSION,
    }],
  };
}

test("resolver labels only TP-only or SL-only closed intervals", () => {
  const common = { boundaryTs: minute, nowMs: now, direction: "LONG", tp1: 110, stopLoss: 90 };
  assert.equal(evaluateClosedIntervals({ ...common, result: available(99, 111) }).observation.kind, "WIN");
  assert.equal(evaluateClosedIntervals({ ...common, result: available(89, 105) }).observation.kind, "LOSS");
  const both = evaluateClosedIntervals({ ...common, result: available(89, 111) }).observation;
  assert.equal(both.kind, "CENSORED");
  assert.equal(both.kind === "CENSORED" && both.reason, "AUTHORITATIVE_INTERVAL_BOTH_BARRIERS");
});

test("resolver censors provider errors and missing or gapped evidence", () => {
  const common = { boundaryTs: minute, nowMs: now, direction: "LONG", tp1: 110, stopLoss: 90 };
  for (const result of [
    { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_PROVIDER_ERROR" },
    { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_MISSING" },
    { kind: "UNAVAILABLE", reason: "AUTHORITATIVE_INTERVAL_GAP" },
  ] as ClosedIntervalResult[]) {
    assert.equal(evaluateClosedIntervals({ ...common, result }).observation.kind, "CENSORED");
  }
});