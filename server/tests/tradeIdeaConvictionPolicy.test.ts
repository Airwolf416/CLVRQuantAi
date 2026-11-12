import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isConvictionTailToxic,
  postHaircutConvictionFloorPct,
  empiricalLeverageCeiling,
  applyTokenSoftGate,
} from "../lib/empiricalFilters";
import { hardenSignal, type SignalContext } from "../lib/signalHardening";
import { releaseIdentity } from "../lib/releaseIdentity";

test("release identity accepts only a full baked commit and never claims an unknown build", () => {
  assert.equal(releaseIdentity("a".repeat(40)).revision, "a".repeat(40));
  assert.equal(releaseIdentity("not-a-commit").revision, "unknown");
  assert.equal(releaseIdentity("").revision, "unknown");
  assert.equal(releaseIdentity("A".repeat(40)).revision, "a".repeat(40));
  assert.equal(releaseIdentity("").tradeIdeaPolicy, "crypto-compatible-floor-v1");
});

function context(direction: "LONG" | "SHORT", score: number, overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    symbol: "BTC", direction, entry: 100, proposedStop: direction === "LONG" ? 98 : 102,
    proposedTargets: direction === "LONG" ? [104, 106] : [96, 94],
    rawConviction: score / 100, atr1h: 1, pctChange24h: 0,
    funding8h: 0, oiUsd: 10000000, oiChange24hPct: 0,
    liquidationClusters: [], backtestN: 100, backtestWr: 0.6, backtestAvgR: 2,
    regime: "MACRO_CLEAR", edgeSource: "OI-verified", ...overrides,
  };
}

function evaluate(score: number, direction: "LONG" | "SHORT", overrides: Partial<SignalContext> = {}) {
  if (isConvictionTailToxic(score, "NORMAL", true)) return null;
  return hardenSignal(context(direction, score, overrides), {
    minPostHaircutConviction: postHaircutConvictionFloorPct(true, "NORMAL", true) / 100,
  });
}

test("regression: the old ceiling plus floor rejected every ordinary crypto score", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    const oldSurvivors = Array.from({ length: 101 }, (_, score) => score)
      .filter(score => !isConvictionTailToxic(score, "NORMAL", true))
      .filter(score => hardenSignal(context(direction, score)).accept);
    assert.deepEqual(oldSurvivors, []);
  }
});

test("both LONG and SHORT have a viable empirical cohort without admitting the toxic tail", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    for (let score = 0; score <= 100; score++) {
      const result = evaluate(score, direction);
      assert.equal(result?.accept ?? false, score >= 30 && score < 50, `${direction} score ${score}`);
    }
  }
});

test("the screenshot's 32 passes conviction but 22 still fails, after real low-sample haircuts", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    const good = evaluate(40, direction, { backtestN: 10 })!;
    assert.ok(Math.abs(good.finalConviction - 0.32) < 1e-10);
    assert.equal(good.accept, true);
    assert.equal(good.lowSampleFlag, true);
    const weak = evaluate(27.5, direction, { backtestN: 10 })!;
    assert.ok(Math.abs(weak.finalConviction - 0.22) < 1e-10);
    assert.equal(weak.accept, false);
    assert.match(weak.reasonsRejected.join(";"), /22% below 30%/);
  }
});

test("a low-sample deduction still rejects a score just below the adjusted minimum", () => {
  assert.equal(evaluate(37, "LONG", { backtestN: 10 })!.accept, false);
  assert.equal(evaluate(38, "LONG", { backtestN: 10 })!.accept, true);
});

test("missing ATR and simultaneous chase/crowding still veto both directions", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    const missing = evaluate(45, direction, { atr1h: 0 })!;
    assert.equal(missing.accept, false);
    assert.match(missing.reasonsRejected.join(";"), /missing ATR/);
    const crowded = evaluate(49, direction, {
      pctChange24h: direction === "LONG" ? 0.06 : -0.06,
      funding8h: direction === "LONG" ? 0.02 : -0.02,
      oiChange24hPct: 0.2,
    })!;
    assert.equal(crowded.accept, false);
    assert.match(crowded.reasonsRejected.join(";"), /chase \+ crowded/);
  }
});

test("other asset classes, PREFERRED and disabled-tail mode keep the original 50 floor", () => {
  for (const verdict of ["NORMAL", "CAUTION", "PREFERRED"]) {
    assert.equal(postHaircutConvictionFloorPct(false, verdict, true), 50);
    assert.equal(postHaircutConvictionFloorPct(true, verdict, false), 50);
  }
  assert.equal(postHaircutConvictionFloorPct(true, "PREFERRED", true), 50);
  assert.equal(isConvictionTailToxic(75, "PREFERRED", true), false);
  assert.equal(hardenSignal(context("LONG", 75), {
    minPostHaircutConviction: postHaircutConvictionFloorPct(true, "PREFERRED", true) / 100,
  }).accept, true);
  assert.equal(hardenSignal(context("LONG", 49)).accept, false);
});

test("malformed or out-of-range scores cannot bypass conviction comparisons", () => {
  for (const score of [NaN, Infinity, -0.1, 1.1]) {
    const result = hardenSignal(context("LONG", 40, { rawConviction: score }), {
      minPostHaircutConviction: 0.3,
    });
    assert.equal(result.accept, false);
    assert.match(result.reasonsRejected.join(";"), /invalid conviction/);
  }
});

test("leverage cap, off-list cap and directional stop/target protections remain intact", () => {
  assert.equal(empiricalLeverageCeiling(true), 2);
  assert.equal(applyTokenSoftGate("UNLISTED", true, 75, true).conviction, 40);
  for (const direction of ["LONG", "SHORT"] as const) {
    const result = evaluate(45, direction)!;
    assert.ok(result.rrFirst >= 1.8);
    if (direction === "LONG") {
      assert.ok(result.stop < result.entry);
      assert.ok(result.targets.every(tp => tp > result.entry));
    } else {
      assert.ok(result.stop > result.entry);
      assert.ok(result.targets.every(tp => tp < result.entry));
    }
  }
});

test("Trade Ideas and Kronos both wire the compatible conviction floor into hardening", () => {
  const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  assert.ok(source.includes('cls === "crypto", edge.brainVerdict, convictionTailSuppressEnabled()'));
  assert.ok(source.includes("hardenSignal(ctx, { minPostHaircutConviction: convictionFloorPct / 100 })"));
  assert.ok(source.includes("true, edgeK.brainVerdict, convictionTailSuppressEnabled()"));
  assert.ok(source.includes("hardenSignal(ctxK, { minPostHaircutConviction: convictionFloorPctK / 100 })"));
});
