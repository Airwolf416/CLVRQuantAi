import { and, gte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog } from "@shared/schema";

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES = new Set(["SL_HIT", "EXPIRED_LOSS"]);
const MIN_COMBO_SAMPLE = 25; // per-(token,direction) gate from spec

let _cached: { ts: number; text: string } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

let _lastBuildError: { message: string; stack?: string; at: string } | null = null;
export function getLastPerformanceContextError() { return _lastBuildError; }

// Per-(token,direction,timeframe) breakdown returned alongside the prompt
// string so callers (signal generation, schema validators) can use the
// numbers directly without re-parsing text.
export interface PerComboStat {
  token: string;
  direction: string;          // 'LONG' | 'SHORT'
  tradeType: string;          // 'SCALP' | 'DAY_TRADE' | 'SWING' | 'POSITION' | 'UNKNOWN'
  wins: number;
  losses: number;
  total: number;
  winRate: number;            // 0..1
  avgWinPct: number;          // average %PnL of winning trades (0 if none)
  avgLossPct: number;         // average %|PnL| of losing trades (positive number)
  sampleSize: number;         // alias for total
  sufficient: boolean;        // total >= MIN_COMBO_SAMPLE
}

export interface PerformanceContextResult {
  text: string;
  combos: PerComboStat[];
  totalResolved: number;
  overallWinRate: number;     // 0..1
}

export async function buildPerformanceContextStructured(): Promise<PerformanceContextResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Use raw SQL for the aggregation — faster than pulling 4000 rows into Node
  // and resilient to ORM-mapping changes. Uses idx_perf_combo (created in
  // initDb) on (token, direction, created_at).
  const rowsRes: any = await db.execute(sql`
    SELECT
      token,
      direction,
      COALESCE(trade_type, 'UNKNOWN') AS trade_type,
      outcome,
      pnl_pct
    FROM ai_signal_log
    WHERE outcome IS NOT NULL
      AND outcome <> 'PENDING'
      AND created_at >= ${thirtyDaysAgo}
  `);

  const rows: Array<{ token: string; direction: string; trade_type: string; outcome: string; pnl_pct: string | null }> =
    Array.isArray(rowsRes) ? rowsRes : (rowsRes?.rows || []);

  const combos = new Map<string, PerComboStat & { _winPnls: number[]; _lossPnls: number[] }>();
  let overallWins = 0;

  for (const r of rows) {
    const key = `${r.token}|${r.direction}|${r.trade_type}`;
    let c = combos.get(key);
    if (!c) {
      c = { token: r.token, direction: r.direction, tradeType: r.trade_type,
            wins: 0, losses: 0, total: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
            sampleSize: 0, sufficient: false, _winPnls: [], _lossPnls: [] } as any;
      combos.set(key, c!);
    }
    const cc = c!;
    cc.total++;
    const pnl = r.pnl_pct != null ? parseFloat(r.pnl_pct) : NaN;
    if (WIN_OUTCOMES.has(r.outcome)) {
      cc.wins++; overallWins++;
      if (Number.isFinite(pnl)) cc._winPnls.push(pnl);
    } else if (LOSS_OUTCOMES.has(r.outcome)) {
      cc.losses++;
      if (Number.isFinite(pnl)) cc._lossPnls.push(Math.abs(pnl));
    }
  }

  const finalized: PerComboStat[] = [];
  for (const c of combos.values()) {
    c.winRate    = c.total > 0 ? c.wins / c.total : 0;
    c.avgWinPct  = c._winPnls.length  ? c._winPnls.reduce((a,b)=>a+b,0)  / c._winPnls.length  : 0;
    c.avgLossPct = c._lossPnls.length ? c._lossPnls.reduce((a,b)=>a+b,0) / c._lossPnls.length : 0;
    c.sampleSize = c.total;
    c.sufficient = c.total >= MIN_COMBO_SAMPLE;
    delete (c as any)._winPnls;
    delete (c as any)._lossPnls;
    finalized.push(c);
  }

  const totalResolved = rows.length;
  const overallWinRate = totalResolved > 0 ? overallWins / totalResolved : 0;

  // ── Build the human-readable string used inside Claude prompts ──
  // Per-combo "INSUFFICIENT SAMPLE" only fires for THAT combo, never the
  // entire block.
  let text = `HISTORICAL PERFORMANCE CONTEXT (last 30 days, ${totalResolved} resolved signals):\n`;
  text += `Overall win rate: ${(overallWinRate*100).toFixed(0)}% (${overallWins}W / ${totalResolved-overallWins}L)\n\n`;

  if (totalResolved < 5) {
    text += `INSUFFICIENT GLOBAL SAMPLE — use standard parameters until more signals resolve.\n`;
  } else {
    // Group combos by (token, direction) for the per-combo table — combine
    // trade-types into one line to keep the prompt compact.
    const byTokenDir = new Map<string, { token:string; direction:string; wins:number; total:number; winPnls:number[]; lossPnls:number[]; types:Set<string> }>();
    for (const c of finalized) {
      const k = `${c.token}|${c.direction}`;
      let agg = byTokenDir.get(k);
      if (!agg) {
        agg = { token:c.token, direction:c.direction, wins:0, total:0, winPnls:[], lossPnls:[], types:new Set() };
        byTokenDir.set(k, agg);
      }
      agg.wins  += c.wins;
      agg.total += c.total;
      if (c.avgWinPct  > 0) agg.winPnls.push(c.avgWinPct);
      if (c.avgLossPct > 0) agg.lossPnls.push(c.avgLossPct);
      agg.types.add(c.tradeType);
    }

    text += `BY (TOKEN, DIRECTION) — sample size ≥${MIN_COMBO_SAMPLE} required for full weight:\n`;
    const sorted = Array.from(byTokenDir.values()).sort((a,b)=> b.total - a.total);
    for (const a of sorted) {
      const wr = a.total > 0 ? Math.round((a.wins/a.total)*100) : 0;
      const note = a.total < MIN_COMBO_SAMPLE
        ? ` — INSUFFICIENT SAMPLE for ${a.token} ${a.direction} (n=${a.total}<${MIN_COMBO_SAMPLE}); use standard parameters for THIS combo only`
        : wr < 35
          ? ` — SUPPRESS THIS COMBO (n=${a.total}, wr<35%)`
          : wr >= 60
            ? ` — strong edge (n=${a.total})`
            : ` — neutral (n=${a.total})`;
      text += `  ${a.token} ${a.direction}: ${wr}% win rate${note}\n`;
    }
    text += `\nINSTRUCTIONS: Use this performance data to gate new signals. For any (token, direction) combo above with sample size ≥${MIN_COMBO_SAMPLE} AND win rate <35%, output NO_TRADE. For combos with insufficient sample, fall back to standard parameters and cap kelly_fraction at 0.05.\n`;
  }

  return { text, combos: finalized, totalResolved, overallWinRate };
}

export async function buildPerformanceContext(): Promise<string> {
  if (_cached && Date.now() - _cached.ts < CACHE_TTL_MS) return _cached.text;
  try {
    const result = await buildPerformanceContextStructured();
    _cached = { ts: Date.now(), text: result.text };
    _lastBuildError = null;
    return result.text;
  } catch (err: any) {
    // LOUD structured logging — surface in production logs
    _lastBuildError = {
      message: String(err?.message || err),
      stack: err?.stack,
      at: new Date().toISOString(),
    };
    console.error("[PerformanceContext] BUILD FAILED:", {
      message: _lastBuildError.message,
      stack: _lastBuildError.stack,
      hint: "Likely causes: missing/renamed column on ai_signal_log, DB connection not ready, or query timeout. Check that ai_signal_log has columns: token, direction, trade_type, outcome, pnl_pct, created_at.",
    });
    // Graceful fallback — do NOT crash the prompt build, but make the failure
    // legible to the model so it knows to use conservative defaults.
    return `HISTORICAL PERFORMANCE: TEMPORARILY UNAVAILABLE (build error logged at ${_lastBuildError.at}). Use conservative parameters: cap kelly_fraction at 0.05 and require risk_reward >= 2.0.`;
  }
}

export function invalidatePerformanceContextCache(): void {
  _cached = null;
}
