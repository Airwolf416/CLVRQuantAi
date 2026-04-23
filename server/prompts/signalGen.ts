// ============================================================================
// SIGNAL GENERATION v2 — backend automated signals.
// Per-(token, direction) evaluation. Strictest hard-rule application of the
// three surfaces. Temperature 0.2 (deterministic).
// ============================================================================

import { HARD_RULES, TECHNICAL_FRAMEWORK, computeKellyFraction } from "./shared";

export interface SignalGenPromptInput {
  token: string;
  direction: "LONG" | "SHORT";
  perfContextForCombo: string;        // filtered: this exact (token, direction)
  liveData:        string;             // pre-formatted live block for this instrument
  kronosOutput:    string;
  quantScore?:     number;
  oiAdjustedScore?:number;
  killSwitches:    string[];
  // Calibration numbers used to compute kelly_fraction outside the model
  calibration: {
    winRate:     number;     // 0..1
    avgWinPct:   number;
    avgLossPct:  number;
    sampleSize:  number;
    suppressionStatus: "active" | "suppressed" | "insufficient_sample";
  };
  // ── Optional context for the signal-hardening pass ────────────────────────
  // When supplied, runSignalGenV2 runs the same mechanical gates the auto-
  // scanner uses. Skipped silently when omitted (no candles ⇒ no ATR gate).
  hardening?: {
    candles?:        Array<{ c: number; h: number; l: number; o: number }>;
    currentPrice?:   number;
    fundingRate?:    number;
    oiChange6hPct?:  number;
    volume24hUsd?:   number;
    holdHorizon?:    "scalp" | "swing";
  };
}

export function buildSignalGenV2Prompt(input: SignalGenPromptInput): {
  system: string;
  user:   string;
  precomputedKelly: number;            // for cross-check vs model output
} {
  const kelly = computeKellyFraction(
    input.calibration.winRate,
    input.calibration.avgWinPct,
    input.calibration.avgLossPct,
    input.calibration.sampleSize,
  );

  const killSwitchBlock = input.killSwitches.length
    ? `ACTIVE KILL SWITCHES: ${input.killSwitches.join(", ")}`
    : `ACTIVE KILL SWITCHES: none`;

  const system = [
    input.perfContextForCombo,
    "",
    HARD_RULES,
    "",
    TECHNICAL_FRAMEWORK,
    "",
    killSwitchBlock,
    "",
    `CALIBRATION FOR ${input.token} ${input.direction}:`,
    `  - Historical win rate (last 30d): ${(input.calibration.winRate*100).toFixed(1)}%`,
    `  - Sample size: ${input.calibration.sampleSize}`,
    `  - Suppression status: ${input.calibration.suppressionStatus}`,
    `  - Pre-computed kelly_fraction (server-side): ${kelly.toFixed(4)} (use this exact value in position_sizing.kelly_fraction)`,
    "",
    "RESPONSE FORMAT — return a single JSON object conforming to TRADE_PLAN_SCHEMA. If the hard rules force NO_TRADE, set direction = \"NO_TRADE\" and populate kill_switches_triggered with the reason codes.",
  ].join("\n");

  const user = [
    `LIVE DATA — ${input.token}:`,
    input.liveData,
    "",
    `KRONOS OUTPUT: ${input.kronosOutput || "n/a"}`,
    `QUANT SCORE: ${input.quantScore ?? "n/a"}`,
    `OI-ADJUSTED SCORE: ${input.oiAdjustedScore ?? "n/a"}`,
    "",
    `Evaluate whether to publish a ${input.direction} signal on ${input.token} right now. Apply hard rules strictly.`,
  ].join("\n");

  return { system, user, precomputedKelly: kelly };
}
