// ============================================================================
// statisticalBrain — empirical edge engine that turns 957 resolved signals
// into prescriptive guidance for entry, SL, TP, and hold timing.
//
// For every (token, direction) combo this module computes:
//   - Win rate over the last 60 days
//   - Realized R on average winner / loser (R = pnl_pct / sl_pct)
//   - Expected R per trade (EV)
//   - Median trade duration
//   - Typical SL distance the engine has been using
//
// From those numbers it derives STRICT LIMITS that hardening enforces:
//   - maxTpR              — TP1 cannot exceed historical winner reach
//   - minSlR              — SL must give the trade room (>= avg loser MAE proxy)
//   - maxKillClockHours   — kill clock cannot exceed empirical resolution time
//
// And it issues a verdict:
//   - SUPPRESS   — n>=15 and WR<25%  → bail out before calling Claude
//   - CAUTION    — n>=15 and WR 25-40%
//   - PREFERRED  — n>=20 and WR>=60%
//   - NORMAL     — otherwise (or insufficient sample)
//
// Cached for 5 minutes. Falls open on DB error (returns NORMAL verdict, no
// limits) so a bad query never blocks signal generation.
// ============================================================================

import { sql } from "drizzle-orm";
import { db } from "../db";

const WIN_OUTCOMES  = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES = new Set(["SL_HIT", "EXPIRED_LOSS"]);

const LOOKBACK_DAYS    = 60;
const MIN_SAMPLE_LIMIT = 15;   // need >=15 trades to enforce strict limits
const MIN_SAMPLE_SUPP  = 15;   // need >=15 trades to suppress on WR
const MIN_SAMPLE_PREF  = 20;   // need >=20 trades to mark PREFERRED
const SUPPRESS_WR      = 0.25;
const CAUTION_WR       = 0.40;
const PREFERRED_WR     = 0.60;

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { ts: number; rows: ComboStat[] } | null = null;

export type BrainVerdict = "SUPPRESS" | "CAUTION" | "NORMAL" | "PREFERRED";

export interface ComboStat {
  token: string;
  direction: "LONG" | "SHORT";
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number;             // 0..1
  avgWinPct: number;           // % move on winners (positive)
  avgLossPct: number;          // % move on losers (positive number — magnitude)
  avgSlPct: number;            // typical SL distance the engine used
  medianDurationMin: number;
  // Derived R-multiples (realized return divided by SL distance)
  avgWinR: number;             // typical winner reach in R (e.g. 1.5)
  p90WinR: number;             // 90th-percentile winner reach in R — strict TP cap
  avgLossR: number;            // typical loser depth in R (positive — e.g. 0.85)
  expectedR: number;           // EV per trade in R
}

export interface BrainLimits {
  maxTpR: number;              // strict — TP1 R must be <= this
  minSlR: number;              // strict — SL R must be >= this
  maxKillClockHours: number;   // strict — kill clock <= this
}

export interface BrainOutput {
  token: string;
  direction: "LONG" | "SHORT";
  verdict: BrainVerdict;
  hasData: boolean;            // true when sample >= MIN_SAMPLE_LIMIT
  stat: ComboStat | null;
  limits: BrainLimits | null;  // null when hasData=false (don't enforce)
  reason: string;              // human-readable summary
  promptText: string;          // ready-to-inject prompt block
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refresh(): Promise<ComboStat[]> {
  const cutoffDays = LOOKBACK_DAYS;
  const result: any = await db.execute(sql`
    SELECT
      token,
      direction,
      outcome,
      pnl_pct,
      ABS((stop_loss - entry_price) / NULLIF(entry_price, 0)) * 100 AS sl_pct,
      EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60                AS duration_min
    FROM ai_signal_log
    WHERE outcome IS NOT NULL
      AND outcome <> 'PENDING'
      AND entry_price > 0
      AND stop_loss   > 0
      AND created_at >= NOW() - (${cutoffDays}::int || ' days')::interval
  `);
  const rows: Array<{
    token: string;
    direction: string;
    outcome: string;
    pnl_pct: string | null;
    sl_pct: string | null;
    duration_min: string | null;
  }> = Array.isArray(result) ? result : (result?.rows || []);

  // Aggregate per (token, direction)
  type Acc = {
    token: string;
    direction: "LONG" | "SHORT";
    wins: number;
    losses: number;
    winPnls: number[];
    lossPnls: number[];   // stored positive
    winRs: number[];      // per-row winner R = pnl_pct / sl_pct (true distribution)
    slPcts: number[];
    durations: number[];
  };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const dir = (r.direction || "").toUpperCase();
    if (dir !== "LONG" && dir !== "SHORT") continue;
    const key = `${r.token}|${dir}`;
    let a = map.get(key);
    if (!a) {
      a = { token: r.token, direction: dir as "LONG" | "SHORT",
            wins: 0, losses: 0, winPnls: [], lossPnls: [], winRs: [], slPcts: [], durations: [] };
      map.set(key, a);
    }
    const pnl = r.pnl_pct != null ? parseFloat(r.pnl_pct) : NaN;
    const slP = r.sl_pct  != null ? parseFloat(r.sl_pct)  : NaN;
    const dur = r.duration_min != null ? parseFloat(r.duration_min) : NaN;
    if (Number.isFinite(slP) && slP > 0 && slP < 50) a.slPcts.push(slP);  // sanity guard
    if (Number.isFinite(dur) && dur > 0)             a.durations.push(dur);
    if (WIN_OUTCOMES.has(r.outcome)) {
      a.wins++;
      if (Number.isFinite(pnl)) {
        a.winPnls.push(pnl);
        // True per-row R for this winner = pnl% / sl% (when both available)
        if (Number.isFinite(slP) && slP > 0 && slP < 50) a.winRs.push(pnl / slP);
      }
    } else if (LOSS_OUTCOMES.has(r.outcome)) {
      a.losses++;
      if (Number.isFinite(pnl)) a.lossPnls.push(Math.abs(pnl));
    }
  }

  const out: ComboStat[] = [];
  for (const a of map.values()) {
    const total = a.wins + a.losses;
    if (total === 0) continue;
    const avgWinPct  = a.winPnls.length  > 0 ? a.winPnls.reduce((s, x) => s + x, 0)  / a.winPnls.length  : 0;
    const avgLossPct = a.lossPnls.length > 0 ? a.lossPnls.reduce((s, x) => s + x, 0) / a.lossPnls.length : 0;
    const avgSlPct   = a.slPcts.length   > 0 ? a.slPcts.reduce((s, x) => s + x, 0)   / a.slPcts.length   : 0;
    const medDur     = median(a.durations);
    const avgWinR    = avgSlPct > 0 ? avgWinPct  / avgSlPct : 0;
    const avgLossR   = avgSlPct > 0 ? avgLossPct / avgSlPct : 0;
    // p90 of per-row winner R distribution — true historical reach cap
    const p90WinR    = percentile(a.winRs, 0.90);
    const winRate    = a.wins / total;
    const expectedR  = winRate * avgWinR - (1 - winRate) * avgLossR;
    out.push({
      token: a.token,
      direction: a.direction,
      sampleSize: total,
      wins: a.wins,
      losses: a.losses,
      winRate,
      avgWinPct,
      avgLossPct,
      avgSlPct,
      medianDurationMin: medDur,
      avgWinR,
      avgLossR,
      p90WinR,
      expectedR,
    });
  }
  return out;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[idx];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function getRows(): Promise<ComboStat[]> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.rows;
  try {
    const rows = await refresh();
    _cache = { ts: now, rows };
    return rows;
  } catch (err: any) {
    console.warn("[statisticalBrain] refresh failed (using last cache):", err.message);
    return _cache?.rows || [];
  }
}

// Public API ─────────────────────────────────────────────────────────────────

export async function getBrainFor(
  token: string,
  direction: "LONG" | "SHORT",
): Promise<BrainOutput> {
  const rows = await getRows();
  const stat = rows.find(r => r.token === token && r.direction === direction) || null;

  if (!stat || stat.sampleSize < MIN_SAMPLE_LIMIT) {
    return {
      token, direction,
      verdict: "NORMAL",
      hasData: false,
      stat,
      limits: null,
      reason: stat
        ? `Sample too small (n=${stat.sampleSize}, need ${MIN_SAMPLE_LIMIT}+) — no strict limits enforced.`
        : `No historical data for ${token} ${direction} in the last ${LOOKBACK_DAYS} days.`,
      promptText: stat
        ? `STATISTICAL EDGE BRAIN — ${token} ${direction}\n  Sample: ${stat.sampleSize} trades (insufficient for strict guidance, advisory only)\n  Win rate: ${(stat.winRate*100).toFixed(1)}% | Avg winner: +${stat.avgWinPct.toFixed(2)}% | Avg loser: -${stat.avgLossPct.toFixed(2)}%`
        : `STATISTICAL EDGE BRAIN — ${token} ${direction}\n  No prior resolved trades for this combo. AI judgement only.`,
    };
  }

  // Enough sample. Compute verdict.
  let verdict: BrainVerdict = "NORMAL";
  if (stat.sampleSize >= MIN_SAMPLE_SUPP && stat.winRate < SUPPRESS_WR) verdict = "SUPPRESS";
  else if (stat.sampleSize >= MIN_SAMPLE_LIMIT && stat.winRate < CAUTION_WR) verdict = "CAUTION";
  else if (stat.sampleSize >= MIN_SAMPLE_PREF && stat.winRate >= PREFERRED_WR) verdict = "PREFERRED";

  // Derive STRICT LIMITS from empirical reality (per spec):
  // - maxTpR             = p90 of winner R distribution (cap TPs at the 90th-pct
  //                        historical reach — beyond this is wishful thinking).
  //                        Falls back to avgWinR*1.2 if winRs distribution empty.
  // - minSlR             = 0.80 × avgLossR (SL must allow at least 80% of avg
  //                        loser depth or it gets noised out by normal MAE).
  // - maxKillClockHours  = ceil(medianDurationMin/60 × 1.5)
  //                        (anything longer than 1.5× median is hope, not edge).
  const tpFromP90 = stat.p90WinR > 0 ? stat.p90WinR : stat.avgWinR * 1.20;
  const limits: BrainLimits = {
    maxTpR: Math.max(1.2, +tpFromP90.toFixed(2)),
    minSlR: Math.max(0.8, +(stat.avgLossR * 0.80).toFixed(2)),
    maxKillClockHours: Math.max(2, Math.ceil((stat.medianDurationMin / 60) * 1.5)),
  };

  // Build the prompt block
  const evSign = stat.expectedR >= 0 ? "+" : "";
  const lines: string[] = [];
  lines.push(`STATISTICAL EDGE BRAIN — ${token} ${direction}  [${verdict}]`);
  lines.push(`  Sample: ${stat.sampleSize} resolved trades (last ${LOOKBACK_DAYS}d) — ${stat.wins}W / ${stat.losses}L`);
  lines.push(`  Win rate: ${(stat.winRate*100).toFixed(1)}%  |  EV: ${evSign}${stat.expectedR.toFixed(2)}R per trade`);
  lines.push(`  Avg winner reach: ${stat.avgWinR.toFixed(2)}R (+${stat.avgWinPct.toFixed(2)}%)  |  Avg loser depth: ${stat.avgLossR.toFixed(2)}R (-${stat.avgLossPct.toFixed(2)}%)`);
  lines.push(`  Median resolution time: ${formatDuration(stat.medianDurationMin)}`);
  lines.push(``);
  lines.push(`  STRICT LIMITS — hardening will VETO if violated:`);
  lines.push(`    • TP1 R must be ≤ ${limits.maxTpR.toFixed(2)} (historical winners cap at ~${stat.avgWinR.toFixed(2)}R)`);
  lines.push(`    • SL R must be ≥ ${limits.minSlR.toFixed(2)} (avg loser depth ${stat.avgLossR.toFixed(2)}R — tighter SL gets noised out)`);
  lines.push(`    • Kill clock must be ≤ ${limits.maxKillClockHours}h (median resolution ${formatDuration(stat.medianDurationMin)})`);

  if (verdict === "SUPPRESS") {
    lines.push(``);
    lines.push(`  ⛔ SUPPRESS: WR ${(stat.winRate*100).toFixed(1)}% over ${stat.sampleSize} trades is below the ${(SUPPRESS_WR*100).toFixed(0)}% floor.`);
    lines.push(`     This direction has no demonstrated edge. Return NEUTRAL.`);
  } else if (verdict === "CAUTION") {
    lines.push(``);
    lines.push(`  ⚠️  CAUTION: WR ${(stat.winRate*100).toFixed(1)}% is below 40%. Only emit if confluence is unusually strong.`);
  } else if (verdict === "PREFERRED") {
    lines.push(``);
    lines.push(`  ✅ PREFERRED: ${(stat.winRate*100).toFixed(1)}% WR over ${stat.sampleSize} trades — historically strong combo.`);
  }

  return {
    token, direction,
    verdict,
    hasData: true,
    stat,
    limits,
    reason: `${verdict} — ${(stat.winRate*100).toFixed(1)}% WR over ${stat.sampleSize} trades, EV ${evSign}${stat.expectedR.toFixed(2)}R`,
    promptText: lines.join("\n"),
  };
}

function formatDuration(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "n/a";
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h/24).toFixed(1)}d`;
}

// Admin/debug surface — used by /api/admin/brain/summary if we ever expose it
export async function getBrainSummary(): Promise<{ rows: ComboStat[]; lookbackDays: number }> {
  const rows = await getRows();
  return { rows: [...rows].sort((a, b) => b.sampleSize - a.sampleSize), lookbackDays: LOOKBACK_DAYS };
}

export function invalidateBrainCache(): void { _cache = null; }
