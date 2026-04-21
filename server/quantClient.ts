// Phase 2A: Node-side client for the Python quant microservice
// All HTTP calls hit 127.0.0.1 (NOT localhost — Node 17+ may resolve to ::1)
const QUANT_URL = process.env.QUANT_URL || "http://127.0.0.1:8081";

export interface QuantScoreRequest {
  symbol: string;
  timeframe?: string;
  ohlcv: number[][];
  daily_returns?: number[];
  equity_usd?: number;
  conviction?: number;
  wilson_lb?: number | null;
  stocktwits_score?: number | null;
  asset_class?: string;
  planned_rr?: number;
}

export interface QuantScoreResponse {
  passes: boolean;
  side: "long" | "short" | null;
  composite_z: number;
  regime: "trend" | "range" | "high_vol" | "chop";
  suggested_size_usd: number;
  sl_atr_mult: number;
  tp_atr_mult: number;
  sl_pct: number;
  sigma_ann: number;
  gates_failed: string[];
  factors: Record<string, number>;
  sl: number | null;
  tp: number | null;
  entry_ref: number;
  ts: number;
}

export interface QuantCostRequest {
  symbol: string;
  order_usd: number;
  adv_usd: number;
  sigma_daily_dec: number;
  expected_alpha_bps: number;
  asset_class?: string;
}

export interface QuantCostResponse {
  total_bps: number;
  half_spread_bps: number;
  fee_bps: number;
  impact_bps: number;
  ev_pass: boolean;
}

async function postJson<T>(path: string, body: any, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${QUANT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`quant ${path} ${r.status}: ${text.slice(0, 200)}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function quantScore(payload: QuantScoreRequest): Promise<QuantScoreResponse> {
  return postJson<QuantScoreResponse>("/quant/score", payload);
}

export async function quantCost(payload: QuantCostRequest): Promise<QuantCostResponse> {
  return postJson<QuantCostResponse>("/quant/cost", payload);
}

export async function quantHealth(): Promise<{ ok: boolean; ws_alive?: boolean; coins?: string[]; last_update_ts?: number; server_ts?: number }> {
  try {
    const r = await fetch(`${QUANT_URL}/quant/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false };
    return await r.json();
  } catch {
    return { ok: false };
  }
}

// ── Phase 2A signal generator ────────────────────────────────────────────────
// Deterministic Python scorer → cost/EV gate → Claude veto-only.
// Returns a result the existing scanner can act on. Gated by PHASE2A_ENABLED env.
import { db } from "./db";
import { aiSignalLog, adaptiveThresholds, type InsertAiSignalLog } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { CLAUDE_MODEL } from "./config";

export interface Phase2ACtx {
  symbol: string;
  timeframe: string;
  ohlcv: number[][];           // [[ts,o,h,l,c,v], ...] ascending
  dailyReturns?: number[];
  equityUsd: number;
  convictionHint: number;      // 0-1
  stocktwitsScore?: number | null;
  assetClass: string;
}

export type Phase2AResult =
  | { emitted: false; reason: string; score?: QuantScoreResponse; cost?: QuantCostResponse; veto?: any }
  | { emitted: true; signal: any; score: QuantScoreResponse; cost: QuantCostResponse; veto: any };

async function logAi(row: Partial<InsertAiSignalLog> & { source: string; token: string; direction: string; entryPrice: string }) {
  try {
    await db.insert(aiSignalLog).values({
      tp1Price: null, tp2Price: null, tp3Price: null, stopLoss: null,
      ...row,
    } as InsertAiSignalLog);
  } catch (e) {
    console.warn("[Phase2A] aiSignalLog insert failed:", (e as Error).message);
  }
}

export async function generateSignalPhase2A(ctx: Phase2ACtx): Promise<Phase2AResult> {
  // 1) Wilson LB proxy from existing adaptive_thresholds (winRate30d / 100)
  let wilsonLb: number | null = null;
  try {
    const rows = await db.select().from(adaptiveThresholds)
      .where(eq(adaptiveThresholds.token, ctx.symbol))
      .orderBy(desc(adaptiveThresholds.updatedAt))
      .limit(1);
    if (rows[0]?.winRate30d != null) {
      wilsonLb = Number(rows[0].winRate30d) / 100;
    }
  } catch { /* table may not have rows yet */ }

  // 2) Python scorer
  let score: QuantScoreResponse;
  try {
    score = await quantScore({
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      ohlcv: ctx.ohlcv,
      daily_returns: ctx.dailyReturns ?? [],
      equity_usd: ctx.equityUsd,
      conviction: ctx.convictionHint,
      wilson_lb: wilsonLb,
      stocktwits_score: ctx.stocktwitsScore ?? null,
      asset_class: ctx.assetClass,
      planned_rr: 2.0,
    });
  } catch (e) {
    return { emitted: false, reason: `quant_unreachable:${(e as Error).message}` };
  }

  if (!score.passes) {
    await logAi({
      source: "phase2a_scorer",
      token: ctx.symbol,
      direction: (score.side || "long").toUpperCase(),
      entryPrice: String(score.entry_ref),
      thesis: `Quant pre-filter blocked: ${score.gates_failed.join(", ")}`,
      invalidation: `regime=${score.regime}, composite_z=${score.composite_z.toFixed(2)}`,
      scores: score as any,
      conviction: 0,
      outcome: "EXPIRED_LOSS",
    });
    return { emitted: false, reason: `scorer_blocked:${score.gates_failed.join(",")}`, score };
  }

  // 3) Cost / EV gate
  const adv = ctx.ohlcv.slice(-1440).reduce((a, r) => a + (r[5] || 0) * (r[4] || 0), 0);
  const expectedAlphaBps = Math.abs(score.composite_z) * score.sigma_ann * 10_000 / Math.sqrt(365);
  let cost: QuantCostResponse;
  try {
    cost = await quantCost({
      symbol: ctx.symbol,
      order_usd: Math.max(score.suggested_size_usd, 1),
      adv_usd: Math.max(adv, 1),
      sigma_daily_dec: score.sigma_ann / Math.sqrt(365),
      expected_alpha_bps: expectedAlphaBps,
      asset_class: ctx.assetClass,
    });
  } catch (e) {
    return { emitted: false, reason: `cost_unreachable:${(e as Error).message}`, score };
  }

  if (!cost.ev_pass) {
    await logAi({
      source: "phase2a_cost",
      token: ctx.symbol,
      direction: (score.side || "long").toUpperCase(),
      entryPrice: String(score.entry_ref),
      thesis: `EV fail: alpha ${expectedAlphaBps.toFixed(1)}bps vs cost ${cost.total_bps.toFixed(1)}bps`,
      invalidation: `Need alpha >= 2x cost (${(2 * cost.total_bps).toFixed(1)}bps)`,
      scores: { score, cost } as any,
      conviction: 0,
      outcome: "EXPIRED_LOSS",
    });
    return { emitted: false, reason: "ev_blocked", score, cost };
  }

  // 4) Claude VETO-ONLY (raw fetch to match codebase pattern)
  const vetoPrompt =
    `You are a risk officer. The quant model produced a ${score.side?.toUpperCase()} signal on ${ctx.symbol} ` +
    `with composite z-score ${score.composite_z.toFixed(2)}, regime "${score.regime}", ` +
    `entry ~${score.entry_ref}, SL ${score.sl}, TP ${score.tp}. ` +
    `Veto ONLY if explicit news/macro right now invalidates this thesis. ` +
    `Return STRICT JSON: {"veto": boolean, "reason": string}. No prose outside JSON.`;
  let veto: { veto: boolean; reason: string } = { veto: false, reason: "" };
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 200,
          messages: [{ role: "user", content: vetoPrompt }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j: any = await r.json();
        const text = j?.content?.[0]?.text ?? "";
        const m = text.match(/\{[\s\S]*\}/);
        if (m) veto = JSON.parse(m[0]);
      }
    }
  } catch {
    // parse/network failure → do NOT veto, quant decision stands
  }

  if (veto.veto) {
    await logAi({
      source: "phase2a_veto",
      token: ctx.symbol,
      direction: (score.side || "long").toUpperCase(),
      entryPrice: String(score.entry_ref),
      thesis: `Claude veto: ${veto.reason}`,
      invalidation: `Quant said go but Claude saw a news/macro reason to abstain`,
      scores: { score, cost, veto } as any,
      conviction: 0,
      outcome: "EXPIRED_LOSS",
    });
    return { emitted: false, reason: `claude_veto:${veto.reason}`, score, cost, veto };
  }

  // 5) Emit
  const signal = {
    symbol: ctx.symbol,
    side: score.side,
    entry: score.entry_ref,
    sl: score.sl,
    tp: score.tp,
    sizeUsd: score.suggested_size_usd,
    compositeZ: score.composite_z,
    regime: score.regime,
    slAtrMult: score.sl_atr_mult,
    tpAtrMult: score.tp_atr_mult,
    factors: score.factors,
  };
  await logAi({
    source: "phase2a",
    token: ctx.symbol,
    direction: (score.side || "long").toUpperCase(),
    tradeType: ctx.timeframe.toUpperCase(),
    entryPrice: String(score.entry_ref),
    tp1Price: score.tp != null ? String(score.tp) : null,
    stopLoss: score.sl != null ? String(score.sl) : null,
    thesis: `Phase2A emit: composite_z=${score.composite_z.toFixed(2)}, regime=${score.regime}`,
    invalidation: `SL at ${score.sl} (${(score.sl_pct * 100).toFixed(2)}%)`,
    scores: { signal, score, cost, veto } as any,
    conviction: Math.min(100, Math.round(Math.abs(score.composite_z) * 33)),
    outcome: "PENDING",
  });
  return { emitted: true, signal, score, cost, veto };
}
