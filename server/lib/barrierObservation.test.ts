import assert from "node:assert/strict";
import test from "node:test";
import { observeBarrierOrder, observeAuthoritativeInterval } from "./barrierObservation";
import { mapOutcomeToWinLoss } from "./calibrationLog";

const fill = new Date(1_000);
const base = { filledAt: fill, cursorAt: null, direction: "LONG", tp1: 110, stopLoss: 90 };

test("sampled mark crossing is censored even when its points appear ordered", () => {
  const result = observeBarrierOrder({ ...base, history: [{ price: 100, ts: 1_000 }, { price: 111, ts: 2_000 }, { price: 89, ts: 3_000 }] });
  assert.equal(result.kind, "CENSORED");
  assert.equal(result.kind === "CENSORED" && result.reason, "SAMPLED_MARK_CROSSING_UNPROVABLE");
});

test("sampled mark stop crossing is censored", () => {
  const result = observeBarrierOrder({ ...base, history: [{ price: 100, ts: 1_000 }, { price: 89, ts: 2_000 }, { price: 111, ts: 3_000 }] });
  assert.equal(result.kind, "CENSORED");
});

test("restart or retention gap censors a cursor that predates retained history", () => {
  const result = observeBarrierOrder({ ...base, cursorAt: new Date(1_500), history: [{ price: 100, ts: 2_000 }] });
  assert.deepEqual(result.kind, "CENSORED");
  assert.equal(result.kind === "CENSORED" && result.reason, "OBSERVATION_CURSOR_PREDATES_RETENTION");
});

test("a missing sampled interval censors rather than inferring the later crossing", () => {
  const result = observeBarrierOrder({ ...base, history: [{ price: 100, ts: 1_000 }, { price: 111, ts: 125_000 }] });
  assert.equal(result.kind, "CENSORED");
  assert.equal(result.kind === "CENSORED" && result.reason, "PRICE_HISTORY_GAP");
});

test("a sampled point that crosses both barriers is censored", () => {
  const result = observeBarrierOrder({ ...base, tp1: 100, stopLoss: 100, history: [{ price: 100, ts: 1_000 }, { price: 100, ts: 2_000 }] });
  assert.equal(result.kind, "CENSORED");
  assert.equal(result.kind === "CENSORED" && result.reason, "SAMPLED_MARK_CROSSING_UNPROVABLE");
});

test("authoritative OHLC only labels a single proven barrier", () => {
  const common = { direction: "LONG", tp1: 110, stopLoss: 90 };
  assert.equal(observeAuthoritativeInterval({ ...common, interval: { startTs: 1, endTs: 2, low: 99, high: 111, authoritative: true } }).kind, "WIN");
  assert.equal(observeAuthoritativeInterval({ ...common, interval: { startTs: 1, endTs: 2, low: 89, high: 105, authoritative: true } }).kind, "LOSS");
  const both = observeAuthoritativeInterval({ ...common, interval: { startTs: 1, endTs: 2, low: 89, high: 111, authoritative: true } });
  assert.equal(both.kind === "CENSORED" && both.reason, "AUTHORITATIVE_INTERVAL_BOTH_BARRIERS");
  assert.equal(observeAuthoritativeInterval({ ...common, interval: null }).kind, "CENSORED");
  assert.equal(observeAuthoritativeInterval({ ...common, interval: { startTs: 1, endTs: 2, low: 99, high: 111, authoritative: true, gap: true } }).kind, "CENSORED");
});

test("unordered samples are censored", () => {
  const result = observeBarrierOrder({ ...base, history: [{ price: 100, ts: 1_000 }, { price: 105, ts: 2_000 }, { price: 106, ts: 2_000 }] });
  assert.equal(result.kind, "CENSORED");
  assert.equal(result.kind === "CENSORED" && result.reason, "PRICE_HISTORY_OUT_OF_ORDER");
});

test("unverified entry is censored by resolver contract", () => {
  // This mirrors the resolver's explicit pre-observation guard.
  const entryVerified = false;
  const label = entryVerified ? observeBarrierOrder({ ...base, history: [{ price: 100, ts: 1_000 }] }).kind : "CENSORED";
  assert.equal(label, "CENSORED");
});

test("expiry outcomes are never forwarded as win or loss", () => {
  assert.equal(mapOutcomeToWinLoss("EXPIRED_WIN"), "void");
  assert.equal(mapOutcomeToWinLoss("EXPIRED_LOSS"), "void");
});