import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyEmissionPolicy } from "./emissionPolicy";
import { costFromFinalGeometry, evaluateExpectancy } from "./expectancyGate";
import { selectExposureCapped } from "./exposureSelector";

test("canonical policy retains repaired-valid geometry and identifies unrepairable geometry", () => {
  const repaired = applyEmissionPolicy({ source: "test", direction: "LONG", entry: 100, stopLoss: 105, tp1: 90 });
  assert.equal(repaired.candidate.stopLoss, 95);
  assert.equal(repaired.candidate.tp1, 110);
  const invalid = applyEmissionPolicy({ source: "test", direction: "LONG", entry: 10, stopLoss: 25, tp1: 30 });
  assert.equal(invalid.decision.state, "INVALID_GEOMETRY");
});

test("expectancy policy requires separate approval before on can suppress", () => {
  const previous = process.env.EXPECTANCY_GATE_MODE;
  const candidate = {
    source: "mode_test",
    direction: "LONG" as const,
    entry: 100,
    stopLoss: 95,
    tp1: 110,
    venueProfile: "phantom" as const,
    volume24hUsd: 600_000_000,
    fundingRatePct: 0,
    expectedHoldHours: 8,
  };
  try {
    process.env.EXPECTANCY_GATE_MODE = "off";
    assert.equal(applyEmissionPolicy(candidate, 0).decision.suppress, false);
    process.env.EXPECTANCY_GATE_MODE = "shadow";
    assert.equal(applyEmissionPolicy(candidate, 0).decision.suppress, false);
    process.env.EXPECTANCY_GATE_MODE = "on";
    const enforced = applyEmissionPolicy(candidate, 0);
    assert.equal(enforced.decision.state, "NEGATIVE_EXPECTANCY");
    assert.equal(enforced.decision.suppress, false);
    process.env.EXPECTANCY_ENFORCEMENT_APPROVED = "1";
    assert.equal(applyEmissionPolicy(candidate, 0).decision.suppress, true);
  } finally {
    if (previous == null) delete process.env.EXPECTANCY_GATE_MODE;
    else process.env.EXPECTANCY_GATE_MODE = previous;
    delete process.env.EXPECTANCY_ENFORCEMENT_APPROVED;
  }
});

test("cost model uses final geometry and charges only the funding payer", () => {
  const cost = costFromFinalGeometry({ direction: "LONG", entry: 100, stopLoss: 95, tp1: 110 },
    { venueProfile: "phantom", volume24hUsd: 600_000_000, fundingRatePct: -.01, expectedHoldHours: 8 });
  assert.ok(cost);
  assert.equal(cost!.fundingPct, 0);
  assert.equal(cost!.feePct, .19);
  assert.equal(evaluateExpectancy({ direction: "LONG", entry: 100, stopLoss: 95, tp1: 110 }, null, cost).state, "CALIBRATION_INSUFFICIENT");
});

test("exposure selector only demotes a third same-direction correlated candidate", () => {
  const result = selectExposureCapped(["A", "B", "C"].map(symbol => ({
    symbol, direction: "LONG" as const, assetClass: "crypto", correlationToBtc: .9, payload: symbol,
  })));
  assert.deepEqual(result.selected.map(x => x.symbol), ["A", "B"]);
  assert.equal(result.demoted[0].exposureNote, "same_direction_btc_correlation_cap");
});

test("server emission contracts keep policy snapshots out of response DTOs", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  const brief = readFileSync("server/dailyBrief.ts", "utf8");
  assert.ok(routes.includes('source: "quant_scanner"') && routes.includes("applyEmissionPolicy"));
  assert.ok(routes.includes('source: "trade_ideas"') && routes.includes('source: "kronos"'));
  assert.ok(brief.includes('source: "morning_brief"'));
  assert.ok(!routes.includes("res.json({ ...parsed, signalPolicySnapshot"));
});

test("every emission caller consumes suppress before persistence or serialization", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  const brief = readFileSync("server/dailyBrief.ts", "utf8");
  const section = (start: string, end: string) => {
    const from = routes.indexOf(start);
    const to = routes.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing source section ${start}`);
    return routes.slice(from, to);
  };

  const autoScanner = section('source: "auto_scanner"', "liveSignals.unshift(signal)");
  assert.match(autoScanner, /policy\.decision\.suppress/);
  assert.match(autoScanner, /if \(suppressEmission\) continue/);

  const quant = section('source: "quant_scanner"', "// ── pwin Phase 1");
  assert.match(quant, /if \(policy\.decision\.suppress\)/);
  assert.match(quant, /EXPECTANCY_POLICY_REJECTED/);
  assert.doesNotMatch(quant.slice(quant.indexOf("return res.json")), /decision\.snapshot|netEV|pWin/);

  const tradeLog = section('app.post("/api/ai/log-trades"', "res.json({ logged })");
  assert.match(tradeLog, /if \(policy\.decision\.suppress\) continue/);

  const tradeIdeas = section("// ── Trade Ideas hardener", "// Only cache valid");
  assert.match(tradeIdeas, /if \(policy\.decision\.suppress\)/);
  assert.match(tradeIdeas, /\.filter\(\(c: any\) => c != null\)/);
  assert.match(tradeIdeas, /runTally\.EXPECTANCY_POLICY_REJECTED/);

  const kronos = section('source: "kronos"', "// ── Headline reconciliation");
  assert.match(kronos, /if \(policy\.decision\.suppress\)/);
  assert.match(kronos, /direction: "NO_TRADE"/);

  const morning = brief.slice(brief.indexOf('source: "morning_brief"'));
  assert.match(morning, /return !policy\.decision\.suppress/);
  assert.match(morning, /additionalTrades\.filter\(guardBriefTrade\)/);
});

test("basket has no independent server trade-card emitter", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  assert.equal(/app\.(?:post|get)\(\s*[\"']\/api\/basket\/[^\\n]*trade/i.test(routes), false);
});