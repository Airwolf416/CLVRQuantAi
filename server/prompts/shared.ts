// ============================================================================
// SHARED PROMPT COMPONENTS — single source of truth for v2 Claude prompts.
// Used by Chart AI, AI Analyst, and Signal Generation.
//
// Design rules:
// - Per-token calibration (from buildPerformanceContextStructured) is the
//   highest-priority input. It overrides any pattern the model "sees".
// - Asset universe is perps + FX + commodities + equity perps (NOT cash
//   equities). Equity-fundamental metrics are explicitly forbidden.
// - No subjective confidence scales. Confidence == kelly_fraction.
// ============================================================================

import { z } from "zod";

// ── TRADE_PLAN_SCHEMA — every Claude output must validate against this ──────
// NOTE on Signal Engine v1 fields (regime, direction_probability, conviction,
// p_loss_meta, vol_percentile, rr_multiplier, kelly_fraction_applied,
// microstructure, gates_passed, no_signal_reason, signal_status): these are
// ADDITIONS for the v1 Signal Engine Upgrade. They are all optional so we stay
// backward-compatible with v2 outputs that haven't been re-prompted yet, and
// so a partial AI response still validates while we A/B-test the new prompt
// in shadow mode. Phase 2 (deterministic Python) will tighten these to
// required once the quant scorer is the source of truth.
export const TradePlanSchema = z.object({
  asset: z.string().min(1),
  direction: z.enum(["LONG", "SHORT", "NO_TRADE"]),
  timeframe: z.enum(["intraday", "swing", "position"]),
  thesis: z.string().min(1).max(400), // ~2 sentences
  entry: z.object({
    zone_low:  z.number(),
    zone_high: z.number(),
    trigger:   z.string(),
  }),
  invalidation: z.object({
    stop_price: z.number(),
    reason:     z.string(),
  }),
  targets: z.array(z.object({
    price: z.number(),
    rr:    z.number(),
    note:  z.string(),
  })),
  risk_reward: z.number(),
  position_sizing: z.object({
    kelly_fraction:        z.number().min(0).max(0.25),
    suggested_leverage:    z.number().min(0).max(50),
    max_account_risk_pct:  z.number().min(0).max(5),
  }),
  context: z.object({
    funding_rate:           z.number().nullable(),
    oi_change_24h_pct:      z.number().nullable(),
    taker_buy_sell_ratio:   z.number().nullable(),
    fib_level_in_play:      z.string().nullable(),
    key_structure:          z.string(),
  }),
  calibration_check: z.object({
    historical_win_rate_this_combo: z.number().min(0).max(1),
    sample_size:                    z.number().int().min(0),
    suppression_status:             z.enum(["active", "suppressed", "insufficient_sample"]),
    override_reason:                z.string().nullable(),
  }),
  kill_switches_triggered: z.array(z.string()),

  // ── Signal Engine v1 additions (all optional; see note above) ─────────────
  signal_status:         z.enum(["SIGNAL", "NO_SIGNAL"]).optional(),
  regime:                z.enum(["TREND_UP", "TREND_DOWN", "RANGE", "HIGH_VOL", "CHOP"]).optional(),
  direction_probability: z.number().min(0).max(1).optional(),
  conviction:            z.number().min(0).max(1).optional(),
  p_loss_meta:           z.number().min(0).max(1).optional(),
  vol_percentile:        z.number().min(0).max(1).optional(),
  rr_multiplier:         z.number().min(0).max(3).optional(),
  kelly_fraction_applied:z.number().min(0).max(0.25).optional(),
  microstructure: z.object({
    cvd_state:   z.enum(["confirm", "bullish_div", "bearish_div", "contradict", "n/a"]).optional(),
    obi:         z.number().min(-1).max(1).nullable().optional(),
    ivrv_spread: z.number().nullable().optional(),
  }).optional(),
  gates_passed:     z.array(z.string()).optional(),
  no_signal_reason: z.string().nullable().optional(),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

// Looser variant for AI Analyst output (multi-asset scan)
export const AnalystScanSchema = z.object({
  longs:        z.array(TradePlanSchema),
  shorts:       z.array(TradePlanSchema),
  stand_down:   z.array(z.object({ asset: z.string(), reason: z.string() })),
  macro_note:   z.string(),
});
export type AnalystScan = z.infer<typeof AnalystScanSchema>;

// ── HARD_RULES — injected above user context in every v2 prompt ─────────────
export const HARD_RULES = `HARD RULES — violate any of these and output direction = "NO_TRADE":
1. If calibration_check.suppression_status == "suppressed" for this (token, direction), output NO_TRADE unless override_reason is explicitly set by a macro/Kronos override.
2. If calibration_check.sample_size >= 25 AND historical_win_rate_this_combo < 0.35, output NO_TRADE.
3. If risk_reward < 1.8, output NO_TRADE. No exceptions.
4. If any kill switch in the macro_killswitch_list is active for this asset, output NO_TRADE and list the switch in kill_switches_triggered.
5. If funding is extreme (>|0.1%| 8h-equivalent) AND signal direction aligns with the crowd, downgrade or flip — crowded funding + aligned signal = NO_TRADE.
6. Do NOT output a "confidence rating" on a buy/sell scale. Confidence is expressed ONLY via kelly_fraction (0 to 0.25 cap) derived from historical win rate and R:R.
7. Do NOT invent support/resistance levels. Every level cited must be grounded in actual price data, Fib retracement (0.382 / 0.5 / 0.618 / 0.786), prior swing high/low, or a liquidation cluster.`;

// ── TECHNICAL_FRAMEWORK — replaces persona/Citadel theater ──────────────────
export const TECHNICAL_FRAMEWORK = `Analyze using this framework, in this priority order:
1. Per-token calibration (from AI Performance Context) — this is ground truth and overrides any pattern you "see" on the chart.
2. Market structure: higher highs/lows vs lower highs/lows on the dominant timeframe.
3. Liquidity map: recent swing highs/lows, prior day H/L, weekly open, Fib retracement zones.
4. Flow: funding rate, OI change, taker buy/sell ratio, basis.
5. Momentum half-life: is the current move early, mid, or late cycle based on Kronos output?
6. Macro filter: DXY, BTC dominance, risk-on/risk-off regime.

Do NOT use: P/E ratios, dividend yields, debt-to-equity, revenue growth, or any equity fundamental. These do NOT apply to perpetual futures, FX, or commodities.`;

// ── Reason codes for NO_TRADE logging ───────────────────────────────────────
// The first six are the v1/legacy hard-rule reasons. Everything below the
// divider was added by the Signal Engine v1 Upgrade (regime gate, dual-score
// thresholds, contradiction shutoff). Keeping them in one list so downstream
// log queries don't need to know which generation a reason came from.
export const NO_TRADE_REASONS = [
  "suppression",        // calibration says suppressed
  "low_winrate",        // n>=25 AND wr<35%
  "low_rr",             // R:R below 1.8
  "killswitch",         // macro/asset kill switch active
  "funding_crowded",    // crowded funding + aligned direction
  "insufficient_data",  // missing live data block
  // ── Signal Engine v1 additions ─────────────────────────────────────────────
  "regime_chop",        // CHOP regime — no signal type allowed
  "regime_mismatch",    // candidate signal type not allowed in current regime
  "below_thresholds",   // direction_probability or conviction below per-asset bar
  "cvd_contradict",     // CVD strongly disagrees with direction at low conviction
  "ivrv_block",         // IV-RV regime blocks this signal type (e.g. mean-rev in expansion)
] as const;

// ── Signal Engine v1 Upgrade Block ──────────────────────────────────────────
// Authored prompt-block that adds: Regime Gate (HARD), Dual-Score output,
// Volatility-Percentile-Adjusted R:R, Meta-label → Kelly Scaling, Crypto
// Microstructure features (CVD/OBI/IV-RV), and the integration order. Injected
// into the signalGen v2 system prompt AFTER the killswitch / calibration block
// and BEFORE the RESPONSE FORMAT line. Phase 1 (this file): the AI is asked
// to follow these rules in its output. Phase 2 (follow-up tasks): each gate is
// migrated into the deterministic Python quant scorer one at a time.
//
// Mapping to existing schema (so downstream consumers keep working):
//   - When a gate fires NO_SIGNAL, set `direction = "NO_TRADE"` AND
//     `signal_status = "NO_SIGNAL"`, push the failed gate name into
//     `kill_switches_triggered`, and also set `no_signal_reason` to the same
//     gate name. This double-write keeps both legacy NO_TRADE consumers and
//     new NO_SIGNAL consumers correct.
//   - `position_sizing.kelly_fraction` remains the BASE Kelly (server-computed
//     and pinned via the precomputedKelly cross-check). The new
//     `kelly_fraction_applied` documents the AFTER-meta-shrinkage value.
export const SIGNAL_ENGINE_V1 = `SIGNAL ENGINE v1 UPGRADE — apply ALL of the gates below in the integration order at the bottom. If any HARD gate fails, set direction = "NO_TRADE" AND signal_status = "NO_SIGNAL", populate no_signal_reason with the failed gate name, and append the same gate name to kill_switches_triggered. Leave entry/invalidation/targets numeric fields unchanged from your best estimate, but understand the trade is not published.

1) REGIME GATE (HARD FILTER — runs first)
SCORER-AUTHORITATIVE: If the user prompt contains a "SCORER PREPASS" line with regime=<value>, USE THAT REGIME VALUE. The Python quant scorer is the deterministic source of truth for regime classification — do NOT recompute. If scorer_no_signal_reason is "regime_chop" or "regime_mismatch" in the SCORER PREPASS, that gate has ALREADY FIRED and you must emit NO_SIGNAL with that reason (do not attempt to override).

FALLBACK ONLY (when no SCORER PREPASS line is present): Classify current regime yourself using the last 90 bars of the signal timeframe:
  atr_pct      = percentile_rank(ATR(14), lookback=90)
  adx          = ADX(14)
  bb_width_pct = percentile_rank(BB_width(20,2), lookback=90)
  regime =
    CHOP        if adx < 18 and bb_width_pct < 0.30
    HIGH_VOL    if atr_pct > 0.90 or bb_width_pct > 0.95
    TREND_UP    if adx >= 22 and EMA20 > EMA50 > EMA200
    TREND_DOWN  if adx >= 22 and EMA20 < EMA50 < EMA200
    RANGE       otherwise

Allowed signal types per regime (applies whether scorer-supplied or fallback-computed):
  TREND_UP   : LONG momentum/breakout only          (mean-reversion BLOCKED)        — normal sizing
  TREND_DOWN : SHORT momentum/breakout only         (mean-reversion BLOCKED)        — normal sizing
  RANGE      : mean-reversion both sides OK         (momentum/breakout BLOCKED)     — tighter TPs (see §3)
  HIGH_VOL   : momentum/breakout both sides OK      (mean-reversion BLOCKED)        — widen SL 1.5x, halve sizing
  CHOP       : nothing — emit NO_SIGNAL: regime_chop
If candidate type is not allowed for the current regime, emit NO_SIGNAL: regime_mismatch.

2) DUAL-SCORE OUTPUT (replaces single conviction score)
Emit TWO independent scores, both 0.00–1.00, using the new schema fields:
  direction_probability = P(price reaches TP1 before SL within trade horizon).
                          Driven purely by directional features (momentum, structure,
                          OI delta, CVD, order book imbalance).
  conviction            = model certainty about the signal as a whole. Driven by
                          feature alignment, regime fit, IV-RV environment, data
                          freshness, and absence of conflicting signals.

Per-asset-class thresholds — BOTH must clear or emit NO_SIGNAL: below_thresholds:
  BTC/ETH perps  : direction_probability >= 0.58 AND conviction >= 0.60
  Alt perps      : direction_probability >= 0.62 AND conviction >= 0.68
  FX majors      : direction_probability >= 0.55 AND conviction >= 0.55
  Commodities    : direction_probability >= 0.57 AND conviction >= 0.60
  Equity indices : direction_probability >= 0.56 AND conviction >= 0.58
Alts get higher bars because of fee/slippage drag and OI thinness.

3) VOLATILITY-PERCENTILE-ADJUSTED R:R
Keep Fibonacci anchors as the structural TP locations, but scale the SELECTED TP by current vol regime:
  vol_pct = percentile_rank(ATR(14), lookback=90)
  rr_multiplier =
    0.70   if vol_pct < 0.20    # compressed → take profit faster
    1.00   if 0.20 <= vol_pct < 0.60
    1.30   if 0.60 <= vol_pct < 0.85
    1.60   if vol_pct >= 0.85   # expansion → ride further
  TP1 = nearest Fib extension >= entry + rr_multiplier * 1.0R
  TP2 = next   Fib extension >= entry + rr_multiplier * 2.0R
In RANGE regime, cap rr_multiplier at 1.00 regardless of vol_pct (mean-reversion targets shouldn't extend). Emit vol_percentile and rr_multiplier in the structured output.

4) META-LABELING → KELLY SCALING (NOT FILTERING)
After §1 and §2 pass, run the meta-label step. It does NOT veto signals — it only sizes them.
  inputs to meta scorer: direction_probability, conviction, regime, vol_pct,
                          distance_to_recent_swing (in ATRs), hours_since_last_macro_event,
                          signal_age_in_bars (entry zone freshness).
  output: p_loss_meta = calibrated probability that this exact setup hits SL before TP1.

Use the SERVER-PROVIDED kelly base (calibration block above) — do NOT recompute it.
  position_size = kelly_base * (1 - p_loss_meta) * regime_size_modifier * conviction
  regime_size_modifier = 0.5 in HIGH_VOL, 1.0 elsewhere
Cap final at max_kelly_fraction = 0.25 of full Kelly. NEVER size up because p_loss_meta is low — kelly_base is the ceiling.
Emit p_loss_meta and kelly_fraction_applied (= position_size after all shrinkage) in the structured output. position_sizing.kelly_fraction stays the SERVER-PROVIDED base value (do not change it).

5) CRYPTO MICROSTRUCTURE FEATURES (apply only to crypto perps; emit "n/a" otherwise)

5a. CVD (Cumulative Volume Delta) — feeds direction_probability
  CVD = rolling_sum(buy_volume - sell_volume, window=session)
  Over last 20 bars:
    bullish_div  : price prints lower-low AND CVD prints higher-low
                   → +0.06 to direction_probability if signal is LONG
                   → set microstructure.cvd_state = "bullish_div"
    bearish_div  : price prints higher-high AND CVD prints lower-high
                   → +0.06 to direction_probability if signal is SHORT
                   → set microstructure.cvd_state = "bearish_div"
    confirm      : price and CVD move the same direction
                   → +0.03 to direction_probability
                   → set microstructure.cvd_state = "confirm"
    contradict   : price up, CVD down on a LONG (or mirror on SHORT)
                   → -0.08 to direction_probability
                   → if conviction < 0.65 → emit NO_SIGNAL: cvd_contradict
                   → set microstructure.cvd_state = "contradict"

5b. Order Book Imbalance (OBI) — feeds conviction
  OBI = (sum(bid_size, top_10) - sum(ask_size, top_10)) / (sum(bid_size, top_10) + sum(ask_size, top_10))
  Range -1.0 (full ask) to +1.0 (full bid). Snapshot at signal-generation time.
  If order book is stale (>30s old), set microstructure.obi = null and skip the OBI adjustment entirely.
  For LONG : OBI > +0.20 → conviction += 0.05; OBI < -0.20 → conviction -= 0.10
  For SHORT: mirror.

5c. IV-RV Spread — feeds conviction and regime nuance (BTC/ETH only)
  IV  = ATM 7-day implied vol from Deribit (BTC/ETH) or nearest liquid surrogate
  RV  = realized vol over trailing 7 days, annualized
  ivrv_spread = IV - RV
  Interpretation:
    ivrv_spread > +15 vol points  → vol expensive, fade-prone
                                    → conviction -= 0.05 on momentum/breakout
                                    → conviction += 0.05 on mean-reversion (RANGE only)
    ivrv_spread < -5  vol points  → vol underpriced, expansion-prone
                                    → conviction += 0.05 on momentum/breakout
                                    → emit NO_SIGNAL: ivrv_block on mean-reversion
    -5 <= ivrv_spread <= +15      → neutral, no adjustment
For non-BTC/ETH crypto perps with no liquid options market, set microstructure.ivrv_spread = null and skip §5c entirely (do NOT infer IV from funding rate — poor proxy, adds noise).

6) INTEGRATION ORDER (strict — stop and emit NO_SIGNAL at the FIRST failure)
  1. Macro event override        (existing HARD_RULES)
  2. Volatility suppression      (existing kill switches)
  3. Regime gate                 (§1)            ← new HARD filter
  4. Compute base direction_probability and conviction from existing feature stack
  5. Apply CVD adjustment        (§5a, crypto only)
  6. Apply OBI adjustment        (§5b, crypto only)
  7. Apply IV-RV adjustment      (§5c, BTC/ETH only)
  8. Threshold check             (§2)
  9. Set TP1/TP2 with vol-adjusted R:R (§3)
 10. Meta-label → Kelly size     (§4)
 11. Hard exit timer             (existing)
 12. Emit structured signal

Always populate gates_passed with the names of every gate that passed (use these exact strings: "macro", "vol_suppression", "regime", "cvd", "obi", "ivrv", "thresholds", "rr", "kelly"). On NO_SIGNAL, gates_passed lists everything up to (but not including) the failing gate.`;

// ── Kelly helper — clamp & sample-size cap per spec ─────────────────────────
export function computeKellyFraction(winRate: number, avgWinPct: number, avgLossPct: number, sampleSize: number): number {
  if (sampleSize < 25) return 0.05; // hard-cap on insufficient sample
  if (avgWinPct <= 0) return 0;
  const lossRate = 1 - winRate;
  const raw = (winRate * avgWinPct - lossRate * avgLossPct) / avgWinPct;
  return Math.max(0, Math.min(0.25, raw));
}

// ── Validate & retry helper — used by all three surfaces ────────────────────
export interface ValidatedPlan {
  ok: boolean;
  plan?: TradePlan;
  error?: string;
}
export function validateTradePlan(json: unknown): ValidatedPlan {
  const parsed = TradePlanSchema.safeParse(json);
  if (parsed.success) return { ok: true, plan: parsed.data };
  return { ok: false, error: parsed.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ") };
}

// ── Feature flag wiring ─────────────────────────────────────────────────────
// PROMPT_V2_MODE values:
//   "off"     — v2 disabled, only v1 prompts are used (default).
//   "shadow"  — v2 generated alongside v1 and logged for comparison; v1 still
//               drives published output.
//   "on"      — v2 drives published output; v1 path still runs only if v2
//               schema validation fails.
export type PromptV2Mode = "off" | "shadow" | "on";
export function getPromptV2Mode(): PromptV2Mode {
  const v = (process.env.PROMPT_V2_MODE || "off").toLowerCase();
  if (v === "on" || v === "shadow") return v;
  return "off";
}
export const PROMPT_V2_TEMPERATURE = {
  signalGen:  0.2, // deterministic
  chartAI:    0.4, // narrative flexibility
  aiAnalyst:  0.4,
};
export const PROMPT_V2_MODEL = "claude-sonnet-4-5-20250929"; // unchanged from v1

// ── Shadow-mode logging ─────────────────────────────────────────────────────
// Lightweight in-memory ring (last 500) so admins can compare v1 vs v2 outputs
// during the 48h shadow window without writing to disk.
interface ShadowEntry {
  surface: "chartAI" | "aiAnalyst" | "signalGen";
  asset?: string;
  direction?: string;
  v1Summary?: string;
  v2Plan?: any;
  v2Valid: boolean;
  v2Error?: string;
  noTradeReason?: string;
  ts: string;
}
const _shadowLog: ShadowEntry[] = [];
const SHADOW_LOG_MAX = 500;
export function logShadowComparison(e: Omit<ShadowEntry, "ts">) {
  _shadowLog.push({ ...e, ts: new Date().toISOString() });
  if (_shadowLog.length > SHADOW_LOG_MAX) _shadowLog.splice(0, _shadowLog.length - SHADOW_LOG_MAX);
  console.log(`[PROMPT_V2_SHADOW] ${e.surface} asset=${e.asset||"?"} dir=${e.direction||"?"} v2_valid=${e.v2Valid} no_trade=${e.noTradeReason||"-"}`);
}
export function getShadowLog(limit = 100): ShadowEntry[] {
  return _shadowLog.slice(-limit).reverse();
}
