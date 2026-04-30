// Phase 2A: Node-side client for the Python quant microservice
// All HTTP calls hit 127.0.0.1 (NOT localhost — Node 17+ may resolve to ::1)
const QUANT_URL = process.env.QUANT_URL || "http://127.0.0.1:8081";

// Normalize free-form asset class strings → the canonical set the Python
// scorer expects. Prevents passing a raw symbol (e.g. "SPY") as a class,
// which would mis-route the external-bar fetch to Binance.
const _CRYPTO_SET = new Set([
  "BTC", "ETH", "SOL", "WIF", "DOGE", "AVAX", "LINK", "ARB", "kPEPE", "PEPE",
  "XRP", "BNB", "ADA", "DOT", "POL", "UNI", "AAVE", "NEAR", "SUI", "APT", "OP",
  "TIA", "SEI", "JUP", "ONDO", "RENDER", "INJ", "FET", "TAO", "PENDLE", "HBAR",
  "TRUMP", "HYPE",
]);
export function normalizeAssetClass(raw: string | undefined, symbol: string): string {
  const s = (raw || "").toUpperCase();
  if (s === "STOCK" || s === "EQUITY" || s === "ETF" || s === "INDEX") return "STOCK";
  if (s === "METAL" || s === "COMMODITY") return "METAL";
  if (s === "FOREX" || s === "FX") return "FOREX";
  if (s === "BTC" || s === "ETH") return s;
  if (s === "CRYPTO" || s === "MID_CAP_DEFAULT" || s === "MID_CAP") return "MID_CAP_DEFAULT";
  // Heuristic from symbol when class isn't given
  if (_CRYPTO_SET.has(symbol)) {
    return symbol === "BTC" || symbol === "ETH" ? symbol : "MID_CAP_DEFAULT";
  }
  // 6-letter alpha pair like EURUSD → forex
  if (/^[A-Z]{6}$/.test(symbol)) return "FOREX";
  // Default to STOCK for anything else (SPY, AAPL, etc.) — never mis-route to Binance
  return "STOCK";
}

export interface QuantScoreRequest {
  symbol: string;
  timeframe?: string;
  ohlcv?: number[][];   // optional — Python falls back to internal HL bars or external provider
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
  // Signal Engine v1 §1 regime states (Phase 2.1 — uppercase, 5-state with
  // directional trend split). Was previously lowercase 4-state; downstream
  // consumers only stringify this for logs so the change is non-breaking.
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "HIGH_VOL" | "CHOP";
  // Signal Engine v1 §2 (Phase 2.2) — Dual Score.
  // Both bounded [0.50, 0.85] (dir_prob) / [0.40, 0.95] (conviction).
  // When either falls below the per-asset-class threshold (see
  // quant/scorer.py DUAL_SCORE_THRESHOLDS), no_signal_reason is set to
  // "below_thresholds" — the same canonical reason the legacy z_threshold
  // gate produces. AI defers to these via the SCORER PREPASS line.
  direction_probability?: number;
  conviction?: number;
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
  // Signal Engine v1 (Phase 2.1) additions — both optional for backward compat
  // with any consumer that pre-dates this rollout.
  signal_type?: "momentum" | "mean_reversion" | null;
  no_signal_reason?: string | null;
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
  ohlcv?: number[][];          // [[ts,o,h,l,c,v], ...] ascending; optional — Python will fetch real bars
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

// Direction-aware Wilson lower bound (95%) computed from aiSignalLog over last 30d
async function wilsonLbForDirection(token: string, direction: "LONG" | "SHORT"): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.execute(sql`
      SELECT outcome, COUNT(*)::int AS n FROM ai_signal_log
      WHERE token=${token} AND direction=${direction}
        AND created_at >= ${cutoff}
        AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','SL_HIT','EXPIRED_WIN','EXPIRED_LOSS')
      GROUP BY outcome
    `);
    let wins = 0, total = 0;
    for (const r of (rows as any).rows ?? rows) {
      const n = Number(r.n);
      total += n;
      if (String(r.outcome).startsWith("TP") || r.outcome === "EXPIRED_WIN") wins += n;
    }
    if (total < 10) return null;
    const p = wins / total;
    const z = 1.96;
    const denom = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
    return (center - margin) / denom;
  } catch {
    return null;
  }
}

// In-memory cooldown to prevent write amplification when detectMoves repeatedly
// re-evaluates the same symbol every 5s and Phase 2A keeps blocking.
// Key: `${symbol}:${reasonHead}`, Value: epoch ms. Cooldown window = 90s.
const _phase2aBlockCooldown = new Map<string, number>();
const PHASE2A_BLOCK_COOLDOWN_MS = 90_000;

function _cooldownActive(symbol: string, reasonHead: string): boolean {
  const key = `${symbol}:${reasonHead}`;
  const last = _phase2aBlockCooldown.get(key);
  if (last && Date.now() - last < PHASE2A_BLOCK_COOLDOWN_MS) return true;
  return false;
}
function _markCooldown(symbol: string, reasonHead: string) {
  _phase2aBlockCooldown.set(`${symbol}:${reasonHead}`, Date.now());
  // bound the map
  if (_phase2aBlockCooldown.size > 1000) {
    const cutoff = Date.now() - PHASE2A_BLOCK_COOLDOWN_MS;
    for (const [k, v] of _phase2aBlockCooldown) if (v < cutoff) _phase2aBlockCooldown.delete(k);
  }
}

export async function generateSignalPhase2A(ctx: Phase2ACtx): Promise<Phase2AResult> {
  // 1) Wilson LB (combined long+short for this symbol — direction-faithful, not biased)
  // Scorer doesn't know side yet, so we use combined history rather than max(long,short).
  let wilsonLb: number | null = null;
  try {
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows: any = await db.execute(sql`
      SELECT outcome, COUNT(*)::int AS n FROM ai_signal_log
      WHERE token=${ctx.symbol} AND created_at >= ${cutoff}
        AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','SL_HIT','EXPIRED_WIN','EXPIRED_LOSS')
      GROUP BY outcome
    `);
    let wins = 0, total = 0;
    for (const r of rows.rows ?? rows) {
      const n = Number(r.n);
      total += n;
      if (String(r.outcome).startsWith("TP") || r.outcome === "EXPIRED_WIN") wins += n;
    }
    if (total >= 10) {
      const p = wins / total;
      const z = 1.96;
      const denom = 1 + (z * z) / total;
      const center = p + (z * z) / (2 * total);
      const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
      wilsonLb = (center - margin) / denom;
    }
    if (wilsonLb == null) {
      const at = await db.select().from(adaptiveThresholds)
        .where(eq(adaptiveThresholds.token, ctx.symbol))
        .orderBy(desc(adaptiveThresholds.updatedAt))
        .limit(1);
      if (at[0]?.winRate30d != null) wilsonLb = Number(at[0].winRate30d) / 100;
    }
  } catch { /* fall through with null */ }

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
    if (!_cooldownActive(ctx.symbol, "scorer")) {
      _markCooldown(ctx.symbol, "scorer");
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
    }
    return { emitted: false, reason: `scorer_blocked:${score.gates_failed.join(",")}`, score };
  }

  // 3) Cost / EV gate
  const advRows = ctx.ohlcv ?? [];
  const adv = advRows.slice(-1440).reduce((a, r) => a + (r[5] || 0) * (r[4] || 0), 0);
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
    if (!_cooldownActive(ctx.symbol, "cost")) {
      _markCooldown(ctx.symbol, "cost");
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
    }
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
