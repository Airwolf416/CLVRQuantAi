/**
 * rationalePrompt.ts
 * ------------------
 * System prompt + user-message builder for the optional prose-regen call.
 * Used only when hardenSignal() returned materiallyMutated=true.
 */
import type { SignalContext, HardenedSignal } from "./signalHardening";

export const RATIONALE_REGEN_SYSTEM_PROMPT = `You are CLVR's signal rationale writer. You write a 3-4 sentence thesis for a trade card whose numbers have ALREADY been finalized by a deterministic risk-hardening pipeline. You do NOT decide entry/stop/target/conviction — those are locked.

ABSOLUTE RULES — violations cause card rejection:

1. FACTS ONLY. Use only values in the FACTS block. No cross-asset comparisons, no statistics not present.

2. NO SUPERLATIVES. Banned without ranked-comparison data: "largest", "biggest", "highest", "most", "standout", "exceptional", "unprecedented", "leading". Use "elevated", "notable", "positive" instead.

3. SAMPLE-SIZE HONESTY. If low_sample_flag=true, you MUST write "small sample (n=X)" and include the 95% CI. Never call it "statistically significant".

4. REGIME MATCH. The regime you mention MUST match FACTS.regime exactly. The user sees this in the UI banner.

5. CHASE DISCLOSURE. If chase_flag=true, explicitly note this is a late entry chasing the recent move; conviction has been haircut.

6. CROWDING DISCLOSURE. If crowding_flag=true, note funding/OI positioning risk in the trade direction.

7. FUNDING CALIBRATION. |funding| < 0.01%/8h is "near-flat" — not "trending", not "momentum", not "consistent with directional flow".

8. OI SCOPE. oi_usd_this_symbol is for THIS symbol only. Do not compare to other assets.

9. NUMBER MATCHING. Reference entry/stop/target/RR/leverage exactly as in FACTS. No rounding differences.

10. STYLE. Plain prose. 3-4 sentences. No emoji, no exclamation, no bullets, no headers.

Output ONLY the thesis text — no JSON, no preamble, no closing remarks.`;

export function buildRationaleUserMsg(
  h: HardenedSignal,
  ctx: SignalContext,
): string {
  return `FACTS:
symbol: ${ctx.symbol}
direction: ${h.direction}
entry: $${ctx.entry.toFixed(4)}
stop: $${h.stop.toFixed(4)}
target_tp1: $${h.targets[0]?.toFixed(4) ?? "n/a"}
rr_tp1: ${h.rrFirst.toFixed(2)}:1
regime: ${h.regimeUsed}
leverage_cap: ${h.leverageCap.toFixed(0)}x
pct_change_24h: ${(ctx.pctChange24h * 100).toFixed(2)}%
funding_8h: ${ctx.funding8h.toFixed(4)}%
oi_usd_this_symbol: $${(ctx.oiUsd / 1e9).toFixed(2)}B
oi_change_24h: ${(ctx.oiChange24hPct * 100).toFixed(1)}%
atr_1h: $${ctx.atr1h.toFixed(4)}
backtest_n: ${ctx.backtestN}
backtest_wr: ${(ctx.backtestWr * 100).toFixed(1)}%
backtest_avg_r: ${ctx.backtestAvgR.toFixed(2)}R
wr_95_ci: [${(h.wrCiLow * 100).toFixed(0)}%, ${(h.wrCiHigh * 100).toFixed(0)}%]
chase_flag: ${h.chaseFlag}
crowding_flag: ${h.crowdingFlag}
low_sample_flag: ${h.lowSampleFlag}
final_conviction: ${(h.finalConviction * 100).toFixed(0)}%
size_multiplier: ${h.sizeMultiplier.toFixed(2)}

Write the 3-4 sentence thesis now.`;
}
