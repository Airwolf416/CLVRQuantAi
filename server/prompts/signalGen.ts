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
    // "below_thresholds", the dual-score gate already fired. Phase 2.5
    // note: these values arrive POST-microstructure-adjustment.
    direction_probability?: number;
    conviction?:            number;
    // Phase 2.3 — Vol-Percentile-Adjusted R:R (Signal Engine v1 §3).
    // When supplied, AI emits these exact values into TradePlanSchema.
    // vol_percentile and .rr_multiplier (no recomputation). The
    // SCORER-AUTHORITATIVE block in shared.ts tells the model to defer.
    vol_percentile?: number;
    rr_multiplier?: number;
    // Phase 2.4 — Meta-label → Kelly Scaling (Signal Engine v1 §4).
    // p_loss_meta is the scorer's calibrated loss probability (today a
    // deterministic 1 - direction_probability proxy). kelly_fraction_applied
    // is computed SERVER-SIDE in routes.ts using kelly_base from
    // calibration: min(0.25, min(kelly_base, kelly_base *
    // (1 - p_loss_meta) * regime_mod * conviction)). AI emits both
    // verbatim into the schema's p_loss_meta and kelly_fraction_applied
    // fields. position_sizing.kelly_fraction stays the BASE.
    p_loss_meta?: number;
    kelly_fraction_applied?: number;
    // Phase 2.5 — Microstructure block (Signal Engine v1 §5). When
    // supplied, AI emits this exact object into TradePlanSchema.
    // microstructure (no recomputation). Crypto only — for non-crypto
    // the scorer returns {cvd_state: "n/a", obi: null, ivrv_spread: null}.
    // ivrv_spread is always null today (Deribit IV feed deferred).
    microstructure?: {
      cvd_state?:   "confirm" | "bullish_div" | "bearish_div" | "contradict" | "n/a";
      obi?:         number | null;
      ivrv_spread?: number | null;
    };
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
  // Phase 2.3/2.4/2.5: extend with vol_percentile + rr_multiplier (§3),
  // p_loss_meta + kelly_fraction_applied (§4), and a stringified
  // microstructure block (§5: cvd_state/obi/ivrv_spread). All four
  // additions follow the existing typeof-number guard so the line stays
  // omittable per-field (deterministic snapshot tests stay stable for
  // legacy callers that don't pass the prepass at all). Numeric
  // formatting is fixed at 4 decimals for stability across runs.
  const _micro = _pp?.microstructure;
  const _microStr = _micro
    ? `{cvd_state:${_micro.cvd_state ?? "n/a"}` +
      `,obi:${_micro.obi == null ? "null" : _micro.obi.toFixed(4)}` +
      `,ivrv_spread:${_micro.ivrv_spread == null ? "null" : _micro.ivrv_spread.toFixed(4)}}`
    : null;
  const prepassLine = _pp?.regime
    ? `SCORER PREPASS: regime=${_pp.regime}` +
      `, signal_type=${_pp.signal_type ?? "n/a"}` +
      (typeof _pp.direction_probability === "number"
        ? `, direction_probability=${_pp.direction_probability.toFixed(4)}`
        : "") +
      (typeof _pp.conviction === "number"
        ? `, conviction=${_pp.conviction.toFixed(4)}`
        : "") +
      (typeof _pp.vol_percentile === "number"
        ? `, vol_percentile=${_pp.vol_percentile.toFixed(4)}`
        : "") +
      (typeof _pp.rr_multiplier === "number"
        ? `, rr_multiplier=${_pp.rr_multiplier.toFixed(4)}`
        : "") +
      (typeof _pp.p_loss_meta === "number"
        ? `, p_loss_meta=${_pp.p_loss_meta.toFixed(4)}`
        : "") +
      (typeof _pp.kelly_fraction_applied === "number"
        ? `, kelly_fraction_applied=${_pp.kelly_fraction_applied.toFixed(4)}`
        : "") +
      (_microStr
        ? `, microstructure=${_microStr}`
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
