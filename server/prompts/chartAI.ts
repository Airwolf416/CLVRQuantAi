// ============================================================================
// CHART AI v2 — per-asset deep-dive on user request.
// Prompt structure:
//   [AI Performance Context for this token — both directions]
//   [HARD_RULES]
//   [TECHNICAL_FRAMEWORK]
//   [Live data block: price, 24h range, funding, OI, taker ratio, Fib, Kronos, S/R]
//   [User question or "Analyze {TICKER}"]
//
// Output: TRADE_PLAN_SCHEMA JSON, followed by a 3-bullet plain-English summary
// for the UI ("Why this trade", "What kills it", "What to watch").
// ============================================================================

import { HARD_RULES, TECHNICAL_FRAMEWORK } from "./shared";

export interface ChartAIPromptInput {
  asset: string;
  perfContextForAsset: string;       // filtered context: this token's both directions
  liveData: {
    price: number;
    range24hLow:  number;
    range24hHigh: number;
    fundingRate?: number | null;
    oiChange24hPct?: number | null;
    takerBuySellRatio?: number | null;
    nearestFibLevels?: string[];
    kronosOutput?: string;
    keyStructure?: string;
  };
  killSwitches: string[];
  userQuestion?: string;
}

export function buildChartAIv2Prompt(input: ChartAIPromptInput): { system: string; user: string } {
  const live = input.liveData;
  const liveBlock = [
    `LIVE DATA — ${input.asset}`,
    `  Price: ${live.price}`,
    `  24h range: ${live.range24hLow} – ${live.range24hHigh}`,
    `  Funding rate (8h): ${live.fundingRate ?? "n/a"}`,
    `  OI change 24h: ${live.oiChange24hPct != null ? live.oiChange24hPct + "%" : "n/a"}`,
    `  Taker buy/sell: ${live.takerBuySellRatio ?? "n/a"}`,
    `  Fib levels in play: ${live.nearestFibLevels?.length ? live.nearestFibLevels.join(", ") : "n/a"}`,
    `  Kronos output: ${live.kronosOutput ?? "n/a"}`,
    `  Key structure: ${live.keyStructure ?? "n/a"}`,
  ].join("\n");

  const killSwitchBlock = input.killSwitches.length
    ? `ACTIVE KILL SWITCHES (block trade if relevant): ${input.killSwitches.join(", ")}`
    : `ACTIVE KILL SWITCHES: none`;

  const system = [
    input.perfContextForAsset,
    "",
    HARD_RULES,
    "",
    TECHNICAL_FRAMEWORK,
    "",
    killSwitchBlock,
    "",
    "RESPONSE FORMAT — return a single JSON object that conforms to TRADE_PLAN_SCHEMA. After the JSON, include a separator line `---SUMMARY---` and 3 bullets for the UI:",
    "- Why this trade",
    "- What kills it",
    "- What to watch",
  ].join("\n");

  const user = [
    liveBlock,
    "",
    input.userQuestion?.trim() || `Analyze ${input.asset} and produce a trade plan.`,
  ].join("\n");

  return { system, user };
}
