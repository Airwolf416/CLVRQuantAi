import test from "node:test";
import assert from "node:assert/strict";
import { parseTradeIdeasCandidates, parseEvaluatedTradeIdeas } from "../../shared/tradeIdeasResponse.js";
import { TRADE_IDEA_POLICY_REVISION } from "../../shared/tradeIdeaPolicy.js";
import { hardenSignal } from "../lib/signalHardening";
import { researchIdea, tradeIdeaConvictionMinimumPct } from "../lib/tradeIdeaEvaluation";

const rawCard = { asset: "META", direction: "SHORT", conviction: 25, entry: 100, sl: 102, tp1: 96 };
const rawJson = JSON.stringify({ trades: [rawCard] });

test("fenced/prose JSON is rejected at both boundaries, never displayed or logged", () => {
  for (const text of [`\`\`\`json\n${rawJson}\n\`\`\``, `Here are your ideas: ${rawJson}`, `${rawJson}\nDone`]) {
    assert.throws(() => parseTradeIdeasCandidates(text));
    const displayed: unknown[] = [], logged: unknown[] = [];
    try {
      const parsed = parseEvaluatedTradeIdeas(text);
      displayed.push(...parsed.trades);
      logged.push(...parsed.trades);
    } catch {}
    assert.equal(displayed.length, 0);
    assert.equal(logged.length, 0);
  }
});

test("malformed JSON, missing/non-array trades, and malformed candidate schema fail explicitly", () => {
  for (const text of ["{", "null", "[]", "{}", '{"trades":null}', '{"trades":{}}',
    '{"trades":[null]}', '{"trades":["META"]}', JSON.stringify({ trades: [{ ...rawCard, conviction: "20%" }] }),
    JSON.stringify({ trades: [{ ...rawCard, direction: "NEUTRAL" }] })]) {
    assert.throws(() => parseTradeIdeasCandidates(text));
    assert.throws(() => parseEvaluatedTradeIdeas(text));
  }
});

test("valid raw JSON reaches server evaluation but is unusable by the browser before evaluation", () => {
  assert.deepEqual(parseTradeIdeasCandidates(rawJson).trades, [rawCard]);
  assert.throws(() => parseEvaluatedTradeIdeas(rawJson), /server evaluation/);
});

function evaluateServerFixture(scores: number[]) {
  const candidates = parseTradeIdeasCandidates(JSON.stringify({
    trades: scores.map((conviction, i) => ({ ...rawCard, asset: ["META", "AMD", "GOOGL", "META"][i], conviction })),
  })).trades;
  const passing: any[] = [], below: any[] = [];
  for (const card of candidates) {
    const minimum = tradeIdeaConvictionMinimumPct("Risk-Off", card.direction);
    const result = hardenSignal({
      symbol: card.asset, direction: "SHORT", entry: 100, proposedStop: 102, proposedTargets: [96],
      rawConviction: card.conviction / 100, atr1h: 1, pctChange24h: 0, funding8h: 0,
      oiUsd: 0, oiChange24hPct: 0, liquidationClusters: [], backtestN: 10,
      backtestWr: 0.6, backtestAvgR: 2, regime: "RISK_OFF",
    }, { minPostHaircutConviction: minimum / 100 });
    if (result.accept) passing.push({ ...card, conviction: result.finalConviction * 100,
      hardener: { applied: true }, gateStatus: "PASSING", researchOnly: false });
    else below.push(researchIdea(card, result.reasonsRejected, result.finalConviction, minimum));
  }
  return {
    trades: passing, below_gate: below, evaluation_summary: {
      policy: TRADE_IDEA_POLICY_REVISION, evaluated: candidates.length,
      passing: passing.length, belowGate: below.length, displayed: passing.length + below.length,
    },
  };
}

test("valid JSON follows parsing, real hardening, then evaluated browser parsing", () => {
  const evaluated = evaluateServerFixture([40, 40, 40, 25]);
  const displayed = parseEvaluatedTradeIdeas(JSON.stringify(evaluated));
  assert.equal(displayed.trades.length, 3);
  assert.equal(displayed.below_gate.length, 1);
  assert.equal(displayed.evaluation_summary.evaluated, 4);
  assert.equal(displayed.below_gate[0].postHaircutConvictionPct, 20);
  assert.match(displayed.below_gate[0].reasons.join(" "), /20% below 30%/);
  const logged = displayed.trades.filter(card => card.gateStatus === "PASSING" && !card.researchOnly);
  assert.equal(logged.length, 3);
  assert.ok(logged.every(card => card.conviction > 30));
});

test("unmarked cards, stale policies and inconsistent counts cannot be displayed/logged", () => {
  const evaluated = evaluateServerFixture([40]);
  const unmarked = structuredClone(evaluated);
  delete unmarked.trades[0].gateStatus;
  assert.throws(() => parseEvaluatedTradeIdeas(JSON.stringify(unmarked)));
  assert.throws(() => parseEvaluatedTradeIdeas(JSON.stringify({
    ...evaluated, evaluation_summary: { ...evaluated.evaluation_summary, policy: "old" },
  })));
  assert.throws(() => parseEvaluatedTradeIdeas(JSON.stringify({
    ...evaluated, evaluation_summary: { ...evaluated.evaluation_summary, evaluated: 6 },
  })));
});

test("zero-candidate and all-below-gate runs are different valid evaluated envelopes", () => {
  assert.equal(parseEvaluatedTradeIdeas(JSON.stringify(evaluateServerFixture([]))).evaluation_summary.evaluated, 0);
  const rejected = parseEvaluatedTradeIdeas(JSON.stringify(evaluateServerFixture([25])));
  assert.equal(rejected.trades.length, 0);
  assert.equal(rejected.below_gate.length, 1);
  assert.equal(rejected.evaluation_summary.evaluated, 1);
});
