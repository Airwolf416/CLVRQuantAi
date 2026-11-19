import { TRADE_IDEA_POLICY_REVISION } from "./tradeIdeaPolicy.js";

/** Strict JSON only: surrounding prose/fences must never skip evaluation. */
export function parseTradeIdeasCandidates(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.trades)) {
    throw new Error("Trade Ideas response must contain a trades array");
  }
  for (const card of parsed.trades) {
    if (!card || typeof card !== "object" || Array.isArray(card)
      || typeof card.asset !== "string" || !card.asset.trim()
      || !["LONG", "SHORT"].includes(card.direction)
      || typeof card.conviction !== "number" || !Number.isFinite(card.conviction)
      || card.conviction < 0 || card.conviction > 100) {
      throw new Error("Trade Ideas response contains an invalid candidate");
    }
  }
  return parsed;
}

/** Browser boundary: only a server-evaluated envelope may be shown or logged. */
export function parseEvaluatedTradeIdeas(text) {
  const parsed = parseTradeIdeasCandidates(text);
  const summary = parsed.evaluation_summary;
  const research = parsed.below_gate;
  if (!summary || summary.policy !== TRADE_IDEA_POLICY_REVISION
    || !Array.isArray(research)
    || !Number.isInteger(summary.evaluated) || summary.evaluated < 0
    || summary.passing !== parsed.trades.length || summary.belowGate !== research.length
    || summary.displayed !== parsed.trades.length + research.length
    || summary.evaluated !== summary.displayed
    || parsed.trades.some(card => card.gateStatus !== "PASSING" || card.researchOnly !== false || card.hardener?.applied !== true)
    || research.some(card => card?.gateStatus !== "BELOW_GATE" || card.researchOnly !== true
      || !Array.isArray(card.reasons) || !card.reasons.length)) {
    throw new Error("Trade Ideas response has not completed server evaluation");
  }
  return parsed;
}
