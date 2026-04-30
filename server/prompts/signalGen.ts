// ============================================================================
// SIGNAL GENERATION v2 — backend automated signals.
// Per-(token, direction) evaluation. Strictest hard-rule application of the
// three surfaces. Temperature 0.2 (deterministic).
// ============================================================================

import { HARD_RULES, TECHNICAL_FRAMEWORK, SIGNAL_ENGINE_V1, computeKellyFraction } from "./shared";

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
  // ── Phase 2.1: scorer prepass for the Signal Engine v1 §1 regime gate ────
  // When supplied, the AI defers to these values instead of recomputing
  // regime/signal_type itself. Sourced from a quantScore() call before
  // runSignalGenV2 — see SIGNAL_ENGINE_V1 §1 "SCORER-AUTHORITATIVE" block.
  quantPrepass?: {
    regime?:           "TREND_UP" | "TREND_DOWN" | "RANGE" | "HIGH_VOL" | "CHOP";
    signal_type?:      "momentum" | "mean_reversion" | null;
    no_signal_reason?: string | null;
    // Phase 2.2 — Dual Score (Signal Engine v1 §2). When supplied, AI
    // emits these exact values into TradePlanSchema.direction_probability
    // and .conviction (no recomputation). When BOTH are present the AI
    // can also infer that the per-asset-class threshold gate has been
    // checked by the scorer — if scorer_no_signal_reason is
    // "below_thresholds", the dual-score gate already fired.
    direction_probability?: number;
    conviction?:            number;
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
    `  - Pre-computed kelly_fraction (server-side): ${kelly.toFixed(4)} (use this exact value in position_sizing.kelly_fraction; kelly_fraction_applied may be smaller after meta-shrinkage per §4)`,
    "",
    SIGNAL_ENGINE_V1,
    "",
    "RESPONSE FORMAT — return a single JSON object conforming to TRADE_PLAN_SCHEMA (extended with the Signal Engine v1 fields: signal_status, regime, direction_probability, conviction, p_loss_meta, vol_percentile, rr_multiplier, kelly_fraction_applied, microstructure, gates_passed, no_signal_reason). If ANY hard rule or HARD gate forces a stand-down: set direction = \"NO_TRADE\", set signal_status = \"NO_SIGNAL\", set no_signal_reason to the failed gate name, AND append the same name to kill_switches_triggered (so legacy consumers keyed on kill_switches_triggered still work). On a published trade, set signal_status = \"SIGNAL\" and leave no_signal_reason = null.",
  ].join("\n");

  // Phase 2.1: surface scorer-supplied regime/signal_type as a SCORER PREPASS
  // line so SIGNAL_ENGINE_V1 §1 can defer to it rather than recomputing.
  // Phase 2.2: extend with direction_probability + conviction (Dual Score).
  // Omitted entirely when no prepass is supplied — keeps legacy callers and
  // prompt-snapshot diffs identical when the feature isn't used. Numeric
  // formatting is fixed at 4 decimals so deterministic snapshot tests
  // remain stable across runs.
  const _pp = input.quantPrepass;
  const prepassLine = _pp?.regime
    ? `SCORER PREPASS: regime=${_pp.regime}` +
      `, signal_type=${_pp.signal_type ?? "n/a"}` +
      (typeof _pp.direction_probability === "number"
        ? `, direction_probability=${_pp.direction_probability.toFixed(4)}`
        : "") +
      (typeof _pp.conviction === "number"
        ? `, conviction=${_pp.conviction.toFixed(4)}`
        : "") +
      (_pp.no_signal_reason
        ? `, scorer_no_signal_reason=${_pp.no_signal_reason}`
        : "")
    : null;

  const user = [
    `LIVE DATA — ${input.token}:`,
    input.liveData,
    "",
    `KRONOS OUTPUT: ${input.kronosOutput || "n/a"}`,
    `QUANT SCORE: ${input.quantScore ?? "n/a"}`,
    `OI-ADJUSTED SCORE: ${input.oiAdjustedScore ?? "n/a"}`,
    ...(prepassLine ? ["", prepassLine] : []),
    "",
    `Evaluate whether to publish a ${input.direction} signal on ${input.token} right now. Apply hard rules strictly.`,
  ].join("\n");

  return { system, user, precomputedKelly: kelly };
}
