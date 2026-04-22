import { and, gte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog } from "@shared/schema";

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const CHECK_INTERVAL_MS = 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MIN_SAMPLE = 20;
const HALT_THRESHOLD = 0.30;
const RESUME_THRESHOLD = 0.45;

export type CircuitState = {
  active: boolean;
  level: 0 | 1 | 2;
  reason: string | null;
  trippedAt: string | null;
  autoResumeEligibleAt: string | null;
  manualOverride: boolean;
  lastCheckAt: string | null;
  rolling: { window: "1h"; n: number; wins: number; winRate: number | null };
};

const state: CircuitState = {
  active: false,
  level: 0,
  reason: null,
  trippedAt: null,
  autoResumeEligibleAt: null,
  manualOverride: false,
  lastCheckAt: null,
  rolling: { window: "1h", n: 0, wins: 0, winRate: null },
};

let started = false;

export function getCircuitState(): CircuitState {
  return { ...state, rolling: { ...state.rolling } };
}

export function isHalted(): boolean {
  return state.active && state.level >= 2;
}

export function manualHalt(reason: string): CircuitState {
  state.active = true;
  state.level = 2;
  state.reason = `MANUAL: ${reason}`;
  state.trippedAt = new Date().toISOString();
  state.autoResumeEligibleAt = null;
  state.manualOverride = true;
  console.log(`[CircuitBreaker] 🛑 MANUAL HALT — ${reason}`);
  return getCircuitState();
}

export function manualResume(by: string): CircuitState {
  state.active = false;
  state.level = 0;
  state.reason = null;
  state.trippedAt = null;
  state.autoResumeEligibleAt = null;
  state.manualOverride = false;
  console.log(`[CircuitBreaker] ✅ MANUAL RESUME by ${by}`);
  return getCircuitState();
}

async function computeRollingWinRate(): Promise<{ n: number; wins: number; winRate: number | null }> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db.select({ outcome: aiSignalLog.outcome })
    .from(aiSignalLog)
    .where(and(ne(aiSignalLog.outcome, "PENDING"), gte(aiSignalLog.createdAt, since)));
  const n = rows.length;
  let wins = 0;
  for (const r of rows) if (WIN_OUTCOMES.has(r.outcome || "")) wins++;
  return { n, wins, winRate: n > 0 ? wins / n : null };
}

export async function checkCircuitBreaker(): Promise<CircuitState> {
  try {
    // Snapshot manualOverride BEFORE the awaited DB call so we don't race with
    // a manualHalt/manualResume that lands while computeRollingWinRate is in flight.
    const wasManualBefore = state.manualOverride;
    const { n, wins, winRate } = await computeRollingWinRate();

    // Always update telemetry — these are observational, never mutate breaker state.
    state.lastCheckAt = new Date().toISOString();
    state.rolling = { window: "1h", n, wins, winRate };

    // If a manual halt/resume happened during the await, defer to it — don't
    // overwrite human intent with stale auto-logic.
    if (wasManualBefore || state.manualOverride) return getCircuitState();

    if (state.active) {
      // Eligible to auto-resume if we now have enough sample AND WR >= RESUME_THRESHOLD
      if (n >= MIN_SAMPLE && winRate !== null && winRate >= RESUME_THRESHOLD) {
        console.log(`[CircuitBreaker] ✅ AUTO-RESUME — 1h WR=${(winRate * 100).toFixed(1)}% over ${n} signals (≥${RESUME_THRESHOLD * 100}%)`);
        state.active = false;
        state.level = 0;
        state.reason = null;
        state.trippedAt = null;
        state.autoResumeEligibleAt = null;
      }
      return getCircuitState();
    }

    // Not active — should we trip?
    if (n >= MIN_SAMPLE && winRate !== null && winRate < HALT_THRESHOLD) {
      state.active = true;
      state.level = 2;
      state.reason = `1h win rate ${(winRate * 100).toFixed(1)}% < ${HALT_THRESHOLD * 100}% over ${n} signals`;
      state.trippedAt = new Date().toISOString();
      state.autoResumeEligibleAt = null;
      console.log(`[CircuitBreaker] 🛑 AUTO-HALT — ${state.reason}`);
    }
  } catch (e: any) {
    console.error("[CircuitBreaker] check failed:", e?.message || e);
  }
  return getCircuitState();
}

// ── Macro risk-off (BTC flush) ────────────────────────────────────────────────
// Distinct from the win-rate circuit breaker above. Returns {halted:true} when
// BTC has dumped ≥3% in the last 4h — a strong leading indicator that ANY long
// (crypto or risk-on equity) is fighting the macro tape. We block LONG signals
// only; SHORTs are still permitted.
//
// Cached for 60s — this is checked on every signal generation and BTC candles
// move slowly enough that re-fetching every call is wasteful.
type MacroRiskState = { halted: boolean; reason?: string; pctChange?: number };
let _macroCache: { ts: number; state: MacroRiskState } | null = null;
const MACRO_CACHE_MS = 60 * 1000;
const MACRO_FLUSH_THRESHOLD = -3.0;

export async function isMacroRiskOff(): Promise<MacroRiskState> {
  if (_macroCache && Date.now() - _macroCache.ts < MACRO_CACHE_MS) {
    return _macroCache.state;
  }
  let state: MacroRiskState = { halted: false };
  try {
    // Fetch BTC 1h candles for the last ~5h. Try Binance first (no auth, deep
    // history); fall back to Hyperliquid via the live state cache if available.
    const r = await fetch(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=6",
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const arr: any[] = await r.json();
      if (Array.isArray(arr) && arr.length >= 2) {
        const priceNow = parseFloat(arr[arr.length - 1][4]);     // last close
        const price4hAgo = parseFloat(arr[Math.max(0, arr.length - 5)][4]);
        if (Number.isFinite(priceNow) && Number.isFinite(price4hAgo) && price4hAgo > 0) {
          const pctChange = ((priceNow - price4hAgo) / price4hAgo) * 100;
          if (pctChange <= MACRO_FLUSH_THRESHOLD) {
            state = {
              halted: true,
              reason: `Macro risk-off: BTC ${pctChange.toFixed(2)}% in 4h`,
              pctChange,
            };
          } else {
            state = { halted: false, pctChange };
          }
        }
      }
    }
  } catch (e: any) {
    // On fetch failure, fail-open (don't halt trading because we couldn't read BTC)
    console.warn("[MacroRiskOff] BTC fetch failed:", e?.message || e);
  }
  _macroCache = { ts: Date.now(), state };
  return state;
}

export function startCircuitBreaker(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    checkCircuitBreaker().catch(() => {});
    setInterval(() => { checkCircuitBreaker().catch(() => {}); }, CHECK_INTERVAL_MS);
  }, 90 * 1000);
  console.log("[CircuitBreaker] Started — global halt at 1h WR<30% (n≥20), auto-resume ≥45%");
}
