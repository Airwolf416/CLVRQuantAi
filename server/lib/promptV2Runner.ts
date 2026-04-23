// ============================================================================
// PROMPT_V2 RUNNER — runs v2 prompts alongside (or instead of) v1.
//
// Behaviour by PROMPT_V2_MODE:
//   off    — runV2Shadow / runV2Live are no-ops. v1 only.
//   shadow — runV2Shadow fires asynchronously beside v1, validates, and logs
//            the result via logShadowComparison. v1 still drives published
//            output. No user-visible change.
//   on     — runV2Live awaits Claude with the v2 prompt; if validation fails
//            after a single retry, returns null (caller falls back to v1).
//
// All call sites use the same one-line invocation pattern so the v1 hot path
// stays untouched and easily reverted.
// ============================================================================

import {
  PROMPT_V2_MODEL, PROMPT_V2_TEMPERATURE,
  TradePlanSchema, AnalystScanSchema,
  validateTradePlan, logShadowComparison, getPromptV2Mode,
  NO_TRADE_REASONS,
} from "../prompts/shared";
import { buildChartAIv2Prompt, type ChartAIPromptInput } from "../prompts/chartAI";
import { buildAnalystV2Prompt, type AnalystPromptInput } from "../prompts/aiAnalyst";
import { buildSignalGenV2Prompt, type SignalGenPromptInput } from "../prompts/signalGen";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

interface CallOpts {
  apiKey:      string;
  system:      string;
  user:        string;
  temperature: number;
  maxTokens?:  number;
}

async function callClaude(opts: CallOpts): Promise<string | null> {
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:       PROMPT_V2_MODEL,
        max_tokens:  opts.maxTokens ?? 1500,
        temperature: opts.temperature,
        system:      opts.system,
        messages:    [{ role: "user", content: opts.user }],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.warn(`[PROMPT_V2] anthropic ${r.status} ${errBody.slice(0, 200)}`);
      return null;
    }
    const j: any = await r.json();
    return j?.content?.[0]?.text || null;
  } catch (e: any) {
    console.warn(`[PROMPT_V2] call failed: ${e?.message || e}`);
    return null;
  }
}

// Pulls the first JSON object out of a Claude response. v2 system prompts ask
// for raw JSON, optionally followed by a `---SUMMARY---` block (Chart AI).
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Find matching closing brace via brace counting (handles nested arrays/objects)
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

// ── CHART AI ────────────────────────────────────────────────────────────────
export async function runChartAIv2(input: ChartAIPromptInput, apiKey: string, v1Summary?: string): Promise<{ plan: any; summary: string } | null> {
  const mode = getPromptV2Mode();
  if (mode === "off") return null;
  const { system, user } = buildChartAIv2Prompt(input);
  // First attempt
  let raw = await callClaude({ apiKey, system, user, temperature: PROMPT_V2_TEMPERATURE.chartAI, maxTokens: 2000 });
  let parsed = raw ? extractJsonObject(raw) : null;
  let validation = parsed ? validateTradePlan(parsed) : { ok: false, error: "no_response" };
  // One retry on validation fail
  if (!validation.ok) {
    raw = await callClaude({ apiKey, system: system + "\n\nIMPORTANT: Your previous output failed schema validation. Return STRICT JSON conforming to TRADE_PLAN_SCHEMA, no prose before the opening brace.", user, temperature: PROMPT_V2_TEMPERATURE.chartAI, maxTokens: 2000 });
    parsed = raw ? extractJsonObject(raw) : null;
    validation = parsed ? validateTradePlan(parsed) : { ok: false, error: "no_response_retry" };
  }
  // Extract summary block if present
  let summary = "";
  if (raw) {
    const sepIdx = raw.indexOf("---SUMMARY---");
    if (sepIdx >= 0) summary = raw.slice(sepIdx + "---SUMMARY---".length).trim();
  }
  if (mode === "shadow") {
    logShadowComparison({
      surface: "chartAI", asset: input.asset,
      v1Summary, v2Plan: parsed, v2Valid: validation.ok, v2Error: validation.error,
      noTradeReason: validation.ok && (parsed?.direction === "NO_TRADE") ? (parsed?.kill_switches_triggered?.[0] || "unknown") : undefined,
    });
    return null; // shadow mode: do not surface to caller
  }
  // mode === "on"
  return validation.ok ? { plan: validation.plan, summary } : null;
}

// ── AI ANALYST ──────────────────────────────────────────────────────────────
export async function runAnalystV2(input: AnalystPromptInput, apiKey: string, v1Summary?: string): Promise<any | null> {
  const mode = getPromptV2Mode();
  if (mode === "off") return null;
  const { system, user } = buildAnalystV2Prompt(input);
  let raw = await callClaude({ apiKey, system, user, temperature: PROMPT_V2_TEMPERATURE.aiAnalyst, maxTokens: 4000 });
  let parsed = raw ? extractJsonObject(raw) : null;
  let validation = parsed ? AnalystScanSchema.safeParse(parsed) : { success: false } as any;
  if (!validation.success) {
    raw = await callClaude({ apiKey, system: system + "\n\nIMPORTANT: Your previous output failed schema validation. Return STRICT JSON only.", user, temperature: PROMPT_V2_TEMPERATURE.aiAnalyst, maxTokens: 4000 });
    parsed = raw ? extractJsonObject(raw) : null;
    validation = parsed ? AnalystScanSchema.safeParse(parsed) : { success: false } as any;
  }
  if (mode === "shadow") {
    logShadowComparison({
      surface: "aiAnalyst",
      v1Summary, v2Plan: parsed, v2Valid: validation.success,
      v2Error: validation.success ? undefined : "schema_invalid",
    });
    return null;
  }
  return validation.success ? validation.data : null;
}

// Renders a hardening rejection into a chat-friendly structured response so
// the AI Analyst surface can show "signal rejected + why" instead of a card.
function rejectionExplanation(reason: string, detail: string, ticker: string): string {
  switch (reason) {
    case "SL_TOO_TIGHT_VS_ATR":      return `Proposed stop is inside ${ticker}'s normal noise envelope (${detail}). A stop this tight will likely get hunted before the move plays out — widen to at least 1.5× ATR or wait for a cleaner setup.`;
    case "COUNTER_TREND_MICRO":      return `${ticker}'s last 6 candles show clear counter-direction microstructure (${detail}). The proposed entry fights the prevailing short-term trend — wait for a structural break before re-entering.`;
    case "SL_IN_LIQUIDITY_POCKET":   return `Proposed stop sits directly on a visible liquidation cluster (${detail}). This is a high-probability sweep zone — shifting the stop beyond it would break the R:R, so the setup is invalid.`;
    case "SHORTS_CROWDED":           return `Shorts are heavily crowded on ${ticker} (${detail}). Squeeze risk outweighs the technical setup — wait for funding to normalize.`;
    case "LONGS_CROWDED":            return `Longs are heavily crowded on ${ticker} (${detail}). Flush risk outweighs the technical setup — wait for funding to normalize.`;
    case "RR_TOO_LOW_AFTER_FRICTION":return `Reward-to-risk falls below 1.8 once slippage and funding cost are subtracted (${detail}). The edge isn't large enough to overcome real execution cost.`;
    default:                         return `Signal rejected by hardening pipeline: ${reason} — ${detail}`;
  }
}

// ── SIGNAL GEN ──────────────────────────────────────────────────────────────
export async function runSignalGenV2(input: SignalGenPromptInput, apiKey: string, v1Summary?: string): Promise<{ plan: any; precomputedKelly: number } | { rejection: { status: "rejected"; reason_code: string; explanation: string; detail: string } } | null> {
  const mode = getPromptV2Mode();
  if (mode === "off") return null;
  const { system, user, precomputedKelly } = buildSignalGenV2Prompt(input);
  let raw = await callClaude({ apiKey, system, user, temperature: PROMPT_V2_TEMPERATURE.signalGen, maxTokens: 1500 });
  let parsed = raw ? extractJsonObject(raw) : null;
  let validation = parsed ? validateTradePlan(parsed) : { ok: false, error: "no_response" };
  if (!validation.ok) {
    raw = await callClaude({ apiKey, system: system + "\n\nIMPORTANT: Return STRICT JSON only.", user, temperature: PROMPT_V2_TEMPERATURE.signalGen, maxTokens: 1500 });
    parsed = raw ? extractJsonObject(raw) : null;
    validation = parsed ? validateTradePlan(parsed) : { ok: false, error: "no_response_retry" };
  }

  // Audit NO_TRADE reasons for later analysis
  let noTradeReason: string | undefined;
  if (validation.ok && validation.plan?.direction === "NO_TRADE") {
    const kss = validation.plan.kill_switches_triggered || [];
    noTradeReason = (kss.find(r => (NO_TRADE_REASONS as readonly string[]).includes(r)) as string | undefined) || kss[0] || "unknown";
    console.log(`[PROMPT_V2_NO_TRADE] ${input.token} ${input.direction} reason=${noTradeReason}`);
  }

  if (mode === "shadow") {
    logShadowComparison({
      surface: "signalGen", asset: input.token, direction: input.direction,
      v1Summary, v2Plan: parsed, v2Valid: validation.ok, v2Error: validation.error,
      noTradeReason,
    });
    return null;
  }
  if (!validation.ok) return null;

  // ── Hardening pass (live mode only) ──────────────────────────────────────
  // Mechanical gates run after schema validation. Requires hardening context
  // (candles + currentPrice) to be useful — caller supplies it via
  // input.hardening. Without context, gates are skipped silently and the
  // plan is returned unchanged (back-compat with current call sites).
  const plan: any = validation.plan;
  const h = input.hardening;
  if (h?.candles?.length && Number.isFinite(h.currentPrice) && plan?.direction !== "NO_TRADE") {
    try {
      const { applySignalHardening } = await import("./signalHardening");
      const { getLiquidityClusters } = await import("../services/coinglass");
      const cur = Number(h.currentPrice);
      const clusters = await getLiquidityClusters(input.token, cur, h.volume24hUsd ?? 0);
      const tp1 = Number(plan?.targets?.[0]?.price ?? plan?.tp1?.price ?? 0);
      const tp2 = Number(plan?.targets?.[1]?.price ?? plan?.tp2?.price ?? tp1);
      const sl  = Number(plan?.invalidation?.stop_price ?? plan?.stopLoss?.price ?? 0);
      const entry = Number(plan?.entry?.zone?.[0] ?? plan?.entry?.price ?? cur);
      const conv = Number(plan?.confidence ?? plan?.conviction ?? 60);
      if (Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp1) && entry > 0 && sl > 0 && tp1 > 0) {
        const hard = applySignalHardening({
          token: input.token, direction: input.direction,
          entry, stopLoss: sl, tp1, tp2: tp2 || tp1, conviction: conv,
          candles: h.candles, fundingRate: h.fundingRate, oiChange6hPct: h.oiChange6hPct,
          holdHorizon: h.holdHorizon || "scalp",
          liquidityClusters: clusters,
          source: "ai_signal",
        });
        if (hard.action === "REJECT") {
          return { rejection: { status: "rejected", reason_code: hard.reason, explanation: rejectionExplanation(hard.reason, hard.detail, input.token), detail: hard.detail } };
        }
        // Apply adjustments back onto the plan so the caller sees hardened levels.
        if (plan.invalidation) plan.invalidation.stop_price = hard.signal.stopLoss;
        if (plan.stopLoss) plan.stopLoss.price = hard.signal.stopLoss;
        plan.confidence = hard.signal.conviction;
        plan.hardening = { action: hard.action, sizeMultiplier: hard.signal.sizeMultiplier, rrAfterFriction: hard.signal.rrAfterFriction, adjustments: hard.adjustments };
      }
    } catch (e: any) {
      console.warn(`[PROMPT_V2 hardening] ${input.token} fail-open:`, e?.message || e);
    }
  }
  return { plan, precomputedKelly };
}
