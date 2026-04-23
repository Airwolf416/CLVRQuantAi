// ============================================================================
// AI ANALYST v2 — market overview / multi-asset scan.
// Output: top 3 LONGs + top 3 SHORTs that pass ALL hard rules (or fewer if
// none qualify — never pad). Plus a "STAND DOWN" list and a 2-sentence macro
// note.
// ============================================================================

import { HARD_RULES, TECHNICAL_FRAMEWORK } from "./shared";

export interface AnalystPromptInput {
  fullPerfContext:  string;        // entire combo table
  instrumentsLive:  string;        // pre-formatted block for all 80+ instruments
  killSwitches:     string[];
  userQuery:        string;
}

export function buildAnalystV2Prompt(input: AnalystPromptInput): { system: string; user: string } {
  const killSwitchBlock = input.killSwitches.length
    ? `ACTIVE KILL SWITCHES: ${input.killSwitches.join(", ")}`
    : `ACTIVE KILL SWITCHES: none`;

  const system = [
    input.fullPerfContext,
    "",
    HARD_RULES,
    "",
    TECHNICAL_FRAMEWORK,
    "",
    killSwitchBlock,
    "",
    "RESPONSE FORMAT — return a single JSON object that conforms to ANALYST_SCAN_SCHEMA:",
    `{`,
    `  "longs":  [TradePlan, ... up to 3],   // only candidates that PASS ALL hard rules; fewer is fine`,
    `  "shorts": [TradePlan, ... up to 3],`,
    `  "stand_down": [{ "asset": string, "reason": string }, ...],`,
    `  "macro_note": string  // 2 sentences max — DXY, BTC dominance, risk regime`,
    `}`,
    "",
    "NEVER fabricate trades to fill a quota. If only one LONG passes hard rules, return one. If none pass, return [].",
  ].join("\n");

  const user = [
    "INSTRUMENTS — live data:",
    input.instrumentsLive,
    "",
    "USER QUERY:",
    input.userQuery,
  ].join("\n");

  return { system, user };
}
