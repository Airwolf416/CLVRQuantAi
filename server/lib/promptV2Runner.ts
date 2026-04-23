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

// ── SIGNAL GEN ──────────────────────────────────────────────────────────────
export async function runSignalGenV2(input: SignalGenPromptInput, apiKey: string, v1Summary?: string): Promise<{ plan: any; precomputedKelly: number } | null> {
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
  return validation.ok ? { plan: validation.plan, precomputedKelly } : null;
}
