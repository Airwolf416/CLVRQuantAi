// ─── REGIME ALIGNMENT GATE ────────────────────────────────────────────────────
// Verifies the AI's recommended direction aligns with deterministic regime
// conditions. Seven hard checks (six universal + one funding-rate check for
// crypto perps). The gate scores the AI's output post-hoc and either:
//   100%      → ALIGNED      → publish full conviction & full leverage
//   ≥70%      → PARTIAL      → halve leverage, cap conviction at C
//   <70%      → MISALIGNED   → block (force NEUTRAL, conviction D)
// Macro kill-switch is an unconditional override that hard-blocks every trade.
//
// This is the LAST gate in the pipeline — it runs after Claude has decided a
// direction, after Bayesian scoring, after multi-TF confluence, and after the
// macro kill-switch check. Its only job is "does the deterministic state of
// the market actually support the AI's call?" Misaligned setups are the
// single biggest drag on win rate, so blocking them outright is correct.

export interface RegimeGateInput {
  assetClass: string;             // "crypto" | "equity" | "fx" | "commodity"
  funding: number | null;         // 8h funding %, only meaningful for crypto perps
}

export interface RegimeGateCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface RegimeGateResult {
  verdict: "ALIGNED" | "PARTIAL" | "MISALIGNED" | "BLOCK" | "PASS_THROUGH";
  action: "PUBLISH" | "DOWNGRADE" | "BLOCK";
  direction: "LONG" | "SHORT" | "NEUTRAL";
  score: number;                  // 0..100
  reason: string;
  checks: RegimeGateCheck[];
  adjustments: { leverageMultiplier: number; convictionCap: string };
}

export function computeRegimeGate(
  ind: any,
  confluence: any,
  bayesian: any,
  macroKillSwitch: any,
  aiSignal: string,                // "STRONG_LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG_SHORT"
  context: RegimeGateInput,
): RegimeGateResult {
  const sig = (aiSignal || "NEUTRAL").toUpperCase();
  const isLong  = sig === "LONG"  || sig === "STRONG_LONG";
  const isShort = sig === "SHORT" || sig === "STRONG_SHORT";
  const dir: "LONG" | "SHORT" | "NEUTRAL" = isLong ? "LONG" : isShort ? "SHORT" : "NEUTRAL";

  // Hard block: macro kill switch overrides every other check.
  // Some callers use { active, reason }; others use { safe, warning } —
  // accept either shape.
  const macroBlocked =
    macroKillSwitch?.active === true ||
    macroKillSwitch?.safe === false;
  if (macroBlocked) {
    const why = macroKillSwitch?.reason || macroKillSwitch?.warning || "HIGH-impact event within 4h";
    return {
      verdict: "BLOCK",
      action: "BLOCK",
      direction: dir,
      score: 0,
      reason: `Macro kill switch active: ${why}`,
      checks: [{ name: "Macro window", pass: false, detail: why }],
      adjustments: { leverageMultiplier: 0, convictionCap: "D" },
    };
  }

  // AI itself said NEUTRAL → nothing to gate; pass-through.
  if (dir === "NEUTRAL") {
    return {
      verdict: "PASS_THROUGH",
      action: "PUBLISH",
      direction: "NEUTRAL",
      score: 50,
      reason: "AI returned NEUTRAL — no trade to gate",
      checks: [],
      adjustments: { leverageMultiplier: 1, convictionCap: bayesian?.tier || "C" },
    };
  }

  const checks: RegimeGateCheck[] = [];

  // Each check is gated by data availability. Inputs that are entirely
  // missing are SKIPPED (not added to checks[]) rather than failed — the
  // upstream caller is the source of truth on whether that data exists,
  // and forcing every endpoint to compute the full quant suite would
  // either be impossible (vision endpoints) or wasteful. The score is
  // computed against the checks that actually ran.

  // 1. Trend alignment (ind.trend must agree with AI direction)
  if (ind && typeof ind.trend === "string" && ind.trend.length > 0) {
    const trend = ind.trend;
    const trendOk = isLong ? /UPTREND/i.test(trend) : /DOWNTREND/i.test(trend);
    checks.push({
      name: "Trend",
      pass: trendOk,
      detail: `${trend} ${trendOk ? "✓ aligns" : "✗ fights"} ${dir}`,
    });
  }

  // 2. Multi-TF confluence (4h + 1d agreement)
  if (confluence && typeof confluence.direction === "string") {
    const confDir = confluence.direction;
    const confOk = isLong
      ? confDir === "BULLISH" || confDir === "LEANING_BULL"
      : confDir === "BEARISH" || confDir === "LEANING_BEAR";
    checks.push({
      name: "Multi-TF confluence",
      pass: confOk,
      detail: `${confDir} (${confluence.strength || "n/a"})`,
    });
  }

  // 3. EMA stack (price > EMA20 > EMA50 > EMA200, or inverse for shorts)
  const haveStack =
    Number.isFinite(ind?.currentPrice) && Number.isFinite(ind?.ema20) &&
    Number.isFinite(ind?.ema50)        && Number.isFinite(ind?.ema200);
  if (haveStack) {
    const stackOk = isLong
      ? ind.currentPrice > ind.ema20 && ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200
      : ind.currentPrice < ind.ema20 && ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
    checks.push({
      name: "EMA stack",
      pass: stackOk,
      detail: stackOk ? "Stack confirms direction" : "Stack broken or mixed",
    });
  }

  // 4. Momentum agreement
  if (Number.isFinite(ind?.momentumScore)) {
    const mom = ind.momentumScore;
    const momOk = isLong ? mom >= 55 : mom <= 45;
    checks.push({
      name: "Momentum",
      pass: momOk,
      detail: `${mom}/100 ${momOk ? "✓" : "✗ neutral or opposing"}`,
    });
  }

  // 5. RSI not exhausted against the direction
  if (Number.isFinite(ind?.rsi)) {
    const rsi = ind.rsi;
    const rsiOk = isLong ? rsi < 75 : rsi > 25;
    checks.push({
      name: "RSI exhaustion",
      pass: rsiOk,
      detail: `RSI ${rsi} ${rsiOk ? "ok" : "exhausted — reversal risk"}`,
    });
  }

  // 6. Volatility regime sanity (ATR% in usable band)
  const atrPct = parseFloat(ind?.atrPct);
  if (Number.isFinite(atrPct) && atrPct > 0) {
    const volOk = atrPct >= 0.3 && atrPct <= 12;
    checks.push({
      name: "Volatility regime",
      pass: volOk,
      detail: `ATR ${atrPct.toFixed(2)}% ${volOk ? "tradeable" : atrPct < 0.3 ? "too quiet — SL hits in noise" : "too wild — slippage risk"}`,
    });
  }

  // 7. Funding rate (crypto perps only) — block if positioning is crowded
  // against the trade. Threshold: ±0.05% per 8h is the "extreme crowding"
  // zone where funding-driven squeezes typically originate.
  if (context.assetClass === "crypto" && typeof context.funding === "number" && Number.isFinite(context.funding)) {
    const f = context.funding;
    const FUNDING_EXTREME = 0.05;
    const fundOk = isLong ? f <= FUNDING_EXTREME : f >= -FUNDING_EXTREME;
    const sign = f >= 0 ? "+" : "";
    let detail: string;
    if (!fundOk) {
      detail = `${sign}${f.toFixed(4)}%/8h — ${isLong ? "longs crowded, squeeze risk" : "shorts crowded, squeeze risk"}`;
    } else if (Math.abs(f) < 0.01) {
      detail = `${sign}${f.toFixed(4)}%/8h — neutral`;
    } else {
      detail = `${sign}${f.toFixed(4)}%/8h — ${(isLong && f < 0) || (isShort && f > 0) ? "contrarian favorable ✓" : "ok"}`;
    }
    checks.push({ name: "Funding rate", pass: fundOk, detail });
  }

  const passCount = checks.filter(c => c.pass).length;
  const total = checks.length;
  // No checks ran (extreme degenerate case — e.g. caller passed only stub
  // data and we're not even on crypto so the funding check was skipped).
  // Pass through with a neutral score so we don't accidentally block.
  if (total === 0) {
    return {
      verdict: "PASS_THROUGH",
      action: "PUBLISH",
      direction: dir,
      score: 50,
      reason: "No regime data available — gate cannot evaluate",
      checks: [],
      adjustments: { leverageMultiplier: 1, convictionCap: bayesian?.tier || "C" },
    };
  }
  const score = Math.round((passCount / total) * 100);

  // Percentage-based thresholds so adding/removing checks does not break
  // the verdict logic (e.g. funding check is absent for non-crypto).
  let verdict: RegimeGateResult["verdict"];
  let action:  RegimeGateResult["action"];
  let leverageMultiplier: number;
  let convictionCap: string;

  if (score === 100) {
    verdict = "ALIGNED";
    action = "PUBLISH";
    leverageMultiplier = 1;
    convictionCap = bayesian?.tier || "B";
  } else if (score >= 70) {
    verdict = "PARTIAL";
    action = "DOWNGRADE";
    leverageMultiplier = 0.5;
    convictionCap = "C";
  } else {
    verdict = "MISALIGNED";
    action = "BLOCK";
    leverageMultiplier = 0;
    convictionCap = "D";
  }

  return {
    verdict,
    action,
    direction: dir,
    score,
    reason: `${passCount}/${total} regime checks passed`,
    checks,
    adjustments: { leverageMultiplier, convictionCap },
  };
}
