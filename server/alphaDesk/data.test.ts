import test from "node:test";
import assert from "node:assert/strict";
import { calculateChaikinMoneyFlow } from "./data";

test("FX futures CMF reports directional volume and supports inverted quote pairs", () => {
  const bars = [
    { t: 1, o: 100, h: 110, l: 90, c: 100, v: 100 },
    { t: 2, o: 100, h: 110, l: 90, c: 110, v: 100 },
  ];
  assert.equal(calculateChaikinMoneyFlow(bars).netSharePct, 100);
  assert.equal(calculateChaikinMoneyFlow(bars, 30, true).netSharePct, -100);
  assert.equal(calculateChaikinMoneyFlow(bars).observations, 1);
});

test("money-flow proxy is unavailable rather than fabricated when volume is absent", () => {
  const bars = [
    { t: 1, o: 100, h: 110, l: 90, c: 100, v: 0 },
    { t: 2, o: 100, h: 110, l: 90, c: 110, v: 0 },
  ];
  const result = calculateChaikinMoneyFlow(bars);
  assert.equal(result.netSharePct, null);
  assert.equal(result.observations, 0);
});
