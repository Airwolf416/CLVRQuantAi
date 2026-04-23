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
export const NO_TRADE_REASONS = [
  "suppression",        // calibration says suppressed
  "low_winrate",        // n>=25 AND wr<35%
  "low_rr",             // R:R below 1.8
  "killswitch",         // macro/asset kill switch active
  "funding_crowded",    // crowded funding + aligned direction
  "insufficient_data",  // missing live data block
] as const;

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
