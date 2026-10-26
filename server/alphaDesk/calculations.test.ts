import test from "node:test";
import assert from "node:assert/strict";
import { calculateAlphaAsset, type DailyBar } from "./calculations";

function risingBars(count = 240): DailyBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i;
    return { t: i * 86_400_000, h: close + 2, l: close - 2, c: close };
  });
}

test("Alpha Desk computes trend, Wilder ATR, structural levels and directional targets", () => {
  const bars = risingBars();
  const result = calculateAlphaAsset("TEST", bars, "LONG", {
    livePrice: 340,
    entryZone: 340,
    atr50Average: 4,
  });
  assert.equal(result.trend, "Bullish");
  assert.ok(result.atr14 != null && result.atr14 > 0);
  assert.ok(result.stop != null && result.stop < result.price!);
  assert.equal(result.targets.length, 3);
  assert.notEqual(result.rrStructural, null);
  assert.equal(result.status, "READY");
});

test("invalid OHLC values never create zero support or fabricated prices", () => {
  const result = calculateAlphaAsset("EMPTY", [
    { t: 1, h: 0, l: 0, c: 0 },
    { t: 2, h: Number.NaN, l: 1, c: 1 },
  ], null, { livePrice: null });
  assert.equal(result.price, null);
  assert.equal(result.support, null);
  assert.equal(result.resistance, null);
  assert.equal(result.status, "WAIT PRICE");
});

test("structural reward is separate from target-multiple reward/risk", () => {
  const result = calculateAlphaAsset("TEST", risingBars(), "LONG", {
    livePrice: 340,
    entryZone: 340,
  });
  assert.notEqual(result.rrStructural, result.rrTargets[0]);
});
