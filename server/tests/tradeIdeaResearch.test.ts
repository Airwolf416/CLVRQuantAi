import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hardenSignal, type SignalContext } from "../lib/signalHardening";
import { isResearchIdea, researchIdea, selectResearchIdeas, tradeIdeaConvictionMinimumPct } from "../lib/tradeIdeaEvaluation";

function evaluate(symbol: string, direction: "LONG" | "SHORT", rawScore: number, riskTone: string, overrides: Partial<SignalContext> = {}) {
  const minimum = tradeIdeaConvictionMinimumPct(riskTone, direction);
  const ctx: SignalContext = {
    symbol, direction, entry: 100, proposedStop: direction === "SHORT" ? 102 : 98,
    proposedTargets: direction === "SHORT" ? [96, 94] : [104, 106],
    rawConviction: rawScore / 100, atr1h: 1, pctChange24h: 0, funding8h: 0,
    oiUsd: 1e7, oiChange24hPct: 0, liquidationClusters: [],
    backtestN: 10, backtestWr: 0.6, backtestAvgR: 2,
    regime: "RISK_OFF", edgeSource: "estimated", ...overrides,
  };
  return { minimum, result: hardenSignal(ctx, { minPostHaircutConviction: minimum / 100 }) };
}

test("historical META/AMD/GOOGL SHORT fixture: unchanged haircut yields 32%, clears Risk-Off 30%", () => {
  for (const symbol of ["META", "AMD", "GOOGL"]) {
    const { minimum, result } = evaluate(symbol, "SHORT", 40, "Risk-Off");
    assert.equal(minimum, 30);
    assert.ok(Math.abs(result.finalConviction * 100 - 32) < 1e-10);
    assert.equal(result.accept, true);
    assert.equal(result.lowSampleFlag, true);
  }
});

test("Risk-Off SHORT at 20% stays visible as BELOW GATE research, never passing", () => {
  const { minimum, result } = evaluate("META", "SHORT", 25, "Risk-Off");
  assert.equal(result.accept, false);
  const record = researchIdea({ asset: "META", direction: "SHORT", entry: 100, sl: 102 },
    result.reasonsRejected, result.finalConviction, minimum);
  const display = selectResearchIdeas([record], 0, 6);
  assert.equal(display.length, 1);
  assert.equal(display[0].postHaircutConvictionPct, 20);
  assert.equal(display[0].gateStatus, "BELOW_GATE");
  assert.match(display[0].reasons.join(" "), /20% below 30%/);
  assert.equal(isResearchIdea(record), true);
  assert.equal("entry" in record, false);
  assert.equal("sl" in record, false);
});

test("Risk-Off LONG and all Risk-On/neutral/unavailable directions retain 50%", () => {
  assert.equal(tradeIdeaConvictionMinimumPct("Risk-Off", "LONG"), 50);
  for (const tone of ["Risk-On", "Neutral", "", "N/A", undefined]) {
    for (const direction of ["LONG", "SHORT"]) {
      assert.equal(tradeIdeaConvictionMinimumPct(tone, direction), 50);
    }
  }
  assert.equal(tradeIdeaConvictionMinimumPct("RISK_OFF", "SHORT"), 30);
  assert.equal(tradeIdeaConvictionMinimumPct("Risk Off", "SHORT"), 30);
});

test("threshold boundaries use full precision rather than rounded display", () => {
  assert.equal(evaluate("META", "SHORT", 37.5, "Risk-Off").result.accept, true);
  assert.equal(evaluate("META", "SHORT", 37.49, "Risk-Off").result.accept, false);
  assert.equal(evaluate("META", "LONG", 62.5, "Risk-Off").result.accept, true);
  assert.equal(evaluate("META", "SHORT", 62.5, "Risk-On").result.accept, true);
});

test("research fills available places, descending post-haircut score, without padding", () => {
  const scores = [20, 45, 32, undefined, 25, 10];
  const records = scores.map((score, i) => researchIdea({ asset: `ASSET${i}`, direction: "SHORT" },
    ["Rejected"], score === undefined ? undefined : score / 100, 50));
  const selected = selectResearchIdeas(records, 3, 6);
  assert.deepEqual(selected.map(r => r.postHaircutConvictionPct), [45, 32, 25]);
  assert.equal(selectResearchIdeas(records, 6, 6).length, 0);
  assert.equal(selectResearchIdeas([], 0, 6).length, 0);
  assert.equal(selectResearchIdeas(records.slice(0, 1), 0, 6).length, 1);
  assert.equal(records[3].postHaircutConvictionPct, null);
});

test("missing ATR and simultaneous chase/crowding still veto an otherwise aligned SHORT", () => {
  const missing = evaluate("META", "SHORT", 40, "Risk-Off", { atr1h: 0 });
  assert.equal(missing.result.accept, false);
  assert.match(missing.result.reasonsRejected.join(" "), /missing ATR/);
  const crowded = evaluate("META", "SHORT", 90, "Risk-Off", {
    pctChange24h: -0.07, funding8h: -0.02, oiChange24hPct: 0.2,
  });
  assert.equal(crowded.result.accept, false);
  assert.match(crowded.result.reasonsRejected.join(" "), /chase \+ crowded/);
});

test("research flags prevent accidental logging on server and browser; cards are separate", () => {
  assert.equal(isResearchIdea({ gateStatus: "BELOW_GATE" }), true);
  assert.equal(isResearchIdea({ researchOnly: true }), true);
  assert.equal(isResearchIdea({ conviction: 20 }), false);
  const server = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  assert.ok(server.includes("if (isResearchIdea(t)) continue;"));
  assert.ok(server.includes('const includeResearch = featureKey === "tradeIdeas"'));
  assert.ok(server.includes("tradeIdeaConvictionMinimumPct(alphaDesk?.riskTone, direction)"));
  assert.ok(server.includes("research = hardened.research"));
  const client = readFileSync(new URL("../../client/src/components/ai/TopTradeIdeas.jsx", import.meta.url), "utf8");
  assert.match(client, /parsed\.trades\.filter/);
  assert.match(client, /researchOnly/);
  assert.match(client, /below_gate/);
  assert.match(client, /BELOW GATE/);
  assert.match(client, /runTradeIdeas\(false\)/);
  assert.match(client, /runTradeIdeas\(true\)/);
});
