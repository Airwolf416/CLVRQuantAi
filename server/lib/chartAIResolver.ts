// ============================================================================
// Chart AI Resolver — outcome tracker for chartai_plans
// ============================================================================
// Polls open & active plans every 60s, fetches the latest price for each
// plan's ticker, and walks the state machine:
//
//   open                                    (just generated; no fill yet)
//     ├─ price enters [entry_low, entry_high]  → active  (record fill_price)
//     └─ now > created_at + time_horizon_min   → expired (never filled)
//
//   active                                  (filled; tracking exits + path)
//     ├─ price hits stop_loss                  → sl_hit
//     ├─ price hits take_profit_2              → tp2_hit
//     ├─ price hits take_profit_1              → tp1_hit
//     ├─ no 0.5R progress in hard_exit_timer   → hard_exit
//     └─ now > entry_filled_at + horizon       → time_stop
//
// Path stats (max favorable / max adverse excursion in R-multiples, time to
// first ±0.5R) are updated on every tick where status='active' and persisted
// alongside any state transition.
//
// Mirrors the pattern in `server/lib/outcomeResolver.ts` (60s polling, no tick
// subscription) — chart AI volume is low enough that a tighter loop isn't
// needed and polling is much simpler/safer than maintaining in-memory state.
// ============================================================================

import { pool } from "../db";
import { livePrices, hlData } from "../state";

const INTERVAL_MS = 60 * 1000;
let started = false;
let timer: NodeJS.Timeout | null = null;

// ─── Price source ──────────────────────────────────────────────────────────
// Mirrors outcomeResolver.getLivePrice but tries a few normalizations because
// chart-AI tickers come from free-text user input ("BTC", "BTCUSDT", "EUR/USD"
// etc.) rather than the controlled symbol set used by the signal generator.
function getLivePriceForTicker(rawTicker: string): number | null {
  if (!rawTicker) return null;
  const upper = rawTicker.toUpperCase().trim();

  // Build candidate keys in order of preference.
  const candidates = new Set<string>([upper]);
  // Strip common quote-currency suffixes for crypto perp lookup (BTCUSDT → BTC)
  for (const suffix of ["USDT", "USDC", "USD", "PERP", "/USDT", "/USD"]) {
    if (upper.endsWith(suffix) && upper.length > suffix.length) {
      candidates.add(upper.slice(0, upper.length - suffix.length).replace(/[/]+$/, ""));
    }
  }
  // Normalize FX pairs ("EUR/USD" → "EURUSD")
  if (upper.includes("/")) candidates.add(upper.replace(/[/]/g, ""));

  for (const key of candidates) {
    const hl = hlData?.[key];
    if (hl && Number.isFinite(hl.perpPrice) && hl.perpPrice > 0) return Number(hl.perpPrice);
    const lp = livePrices?.[key];
    if (lp && Number.isFinite(lp.price) && lp.price > 0) return Number(lp.price);
  }
  return null;
}

// ─── Math helpers ──────────────────────────────────────────────────────────
function currentR(direction: string, fillPrice: number, stopLoss: number, price: number): number {
  const risk = Math.abs(fillPrice - stopLoss);
  if (risk <= 0) return 0;
  const delta = direction === "long" ? price - fillPrice : fillPrice - price;
  return delta / risk;
}

function targetHit(direction: string, price: number, target: number): boolean {
  return direction === "long" ? price >= target : price <= target;
}

function stopHit(direction: string, price: number, stop: number): boolean {
  return direction === "long" ? price <= stop : price >= stop;
}

// ─── Row shape from the join query ─────────────────────────────────────────
interface OpenPlanRow {
  request_id: string;
  user_id: string;
  ticker: string;
  direction: string;                // 'long' | 'short'
  entry_low: string;                // numeric → string from pg
  entry_high: string;
  stop_loss: string;
  take_profit_1: string | null;
  take_profit_2: string | null;
  time_horizon_min: number | null;
  hard_exit_timer_min: number | null;
  plan_created_at: Date;
  status: string;                   // 'open' | 'active'
  fill_price: string | null;
  entry_filled_at: Date | null;
  mfe_r: string | null;
  mae_r: string | null;
  time_to_first_05r_min: number | null;
}

async function resolveOnce(): Promise<void> {
  const { rows } = await pool.query<OpenPlanRow>(`
    SELECT
      p.request_id, p.user_id, p.ticker, p.direction,
      p.entry_low, p.entry_high, p.stop_loss,
      p.take_profit_1, p.take_profit_2,
      p.time_horizon_min, p.hard_exit_timer_min,
      p.created_at AS plan_created_at,
      o.status, o.fill_price, o.entry_filled_at,
      o.max_favorable_excursion_r AS mfe_r,
      o.max_adverse_excursion_r   AS mae_r,
      o.time_to_first_05r_min
    FROM chartai_plans p
    JOIN chartai_outcomes o ON o.request_id = p.request_id
    WHERE o.status IN ('open', 'active')
      AND p.refusal_code IS NULL
      AND p.direction IN ('long', 'short')
      AND p.entry_low IS NOT NULL
      AND p.entry_high IS NOT NULL
      AND p.stop_loss  IS NOT NULL
    LIMIT 500
  `);
  if (!rows.length) return;

  const now = new Date();
  let resolvedCount = 0;

  for (const row of rows) {
    const dir = row.direction;
    const entryLow = parseFloat(row.entry_low);
    const entryHigh = parseFloat(row.entry_high);
    const stopLoss = parseFloat(row.stop_loss);
    const tp1 = row.take_profit_1 != null ? parseFloat(row.take_profit_1) : null;
    const tp2 = row.take_profit_2 != null ? parseFloat(row.take_profit_2) : null;
    const horizonMin = row.time_horizon_min ?? null;
    const hardExitMin = row.hard_exit_timer_min ?? null;

    // ── Time-based expiry for plans that never filled ─────────────────────
    if (row.status === "open") {
      if (horizonMin != null) {
        const expiresAt = new Date(row.plan_created_at.getTime() + horizonMin * 60_000);
        if (now >= expiresAt) {
          await finalize(row.request_id, "expired", null, null, null,
            Math.floor((now.getTime() - row.plan_created_at.getTime()) / 60_000));
          resolvedCount++;
          continue;
        }
      }
    }

    const price = getLivePriceForTicker(row.ticker);
    if (price == null) continue;            // no fresh price → wait for next tick

    // ── Fill detection ────────────────────────────────────────────────────
    if (row.status === "open") {
      if (price >= entryLow && price <= entryHigh) {
        // Conditional update: only flip to 'active' if still 'open'. Guards
        // against double-fills under concurrent ticks or multi-instance.
        const upd = await pool.query(
          `UPDATE chartai_outcomes
              SET status='active', fill_price=$1, entry_filled_at=$2,
                  resolution_source='auto_tracker', updated_at=NOW()
            WHERE request_id=$3 AND status='open'`,
          [price, now, row.request_id],
        );
        if (upd.rowCount === 0) continue;    // another worker beat us → next
        row.status = "active";
        row.fill_price = String(price);
        row.entry_filled_at = now;
      } else {
        continue;                            // open, no fill yet, no expiry → next plan
      }
    }

    // ── Active state: path stats + exit checks ────────────────────────────
    const fillPrice = row.fill_price != null ? parseFloat(row.fill_price) : null;
    const filledAt = row.entry_filled_at;
    if (fillPrice == null || filledAt == null) continue;  // shouldn't happen, defensive

    const r = currentR(dir, fillPrice, stopLoss, price);
    const prevMfe = row.mfe_r != null ? parseFloat(row.mfe_r) : 0;
    const prevMae = row.mae_r != null ? parseFloat(row.mae_r) : 0;
    const newMfe = r > prevMfe ? r : prevMfe;
    const newMae = r < prevMae ? r : prevMae;

    // Time-to-first-+0.5R is FAVORABLE-only. Counting adverse 0.5R moves here
    // would silently disable the hard-exit gate ("no 0.5R progress"), since
    // any drawdown would be mistaken for momentum.
    let newTimeTo05r = row.time_to_first_05r_min;
    if (newTimeTo05r == null && r >= 0.5) {
      newTimeTo05r = Math.floor((now.getTime() - filledAt.getTime()) / 60_000);
    }

    // Exit priority: SL > TP2 > TP1 > time-based
    let resolvedStatus: string | null = null;
    let exitPrice: number | null = null;
    if (stopHit(dir, price, stopLoss)) {
      resolvedStatus = "sl_hit";
      exitPrice = price;
    } else if (tp2 != null && targetHit(dir, price, tp2)) {
      resolvedStatus = "tp2_hit";
      exitPrice = price;
    } else if (tp1 != null && targetHit(dir, price, tp1)) {
      resolvedStatus = "tp1_hit";       // v1: TP1 closes the whole position
      exitPrice = price;
    } else {
      // Time-based exits (only checked if no price-based exit fired)
      const elapsedMin = (now.getTime() - filledAt.getTime()) / 60_000;
      if (hardExitMin != null && elapsedMin >= hardExitMin && newTimeTo05r == null) {
        resolvedStatus = "hard_exit";
        exitPrice = price;
      } else if (horizonMin != null && elapsedMin >= horizonMin) {
        resolvedStatus = "time_stop";
        exitPrice = price;
      }
    }

    if (resolvedStatus) {
      const delta = dir === "long" ? exitPrice! - fillPrice : fillPrice - exitPrice!;
      const realizedR = Math.abs(fillPrice - stopLoss) > 0 ? delta / Math.abs(fillPrice - stopLoss) : 0;
      const realizedPct = fillPrice !== 0 ? (delta / fillPrice) * 100 : 0;
      const durationMin = Math.floor((now.getTime() - filledAt.getTime()) / 60_000);
      await finalize(
        row.request_id, resolvedStatus, exitPrice, realizedR, realizedPct, durationMin,
        newMfe, newMae, newTimeTo05r,
      );
      resolvedCount++;
    } else {
      // No resolution this tick — just persist updated path stats if changed.
      const changed =
        newMfe !== prevMfe || newMae !== prevMae || newTimeTo05r !== row.time_to_first_05r_min;
      if (changed) {
        await pool.query(
          `UPDATE chartai_outcomes
              SET max_favorable_excursion_r=$1,
                  max_adverse_excursion_r=$2,
                  time_to_first_05r_min=$3,
                  updated_at=NOW()
            WHERE request_id=$4`,
          [newMfe, newMae, newTimeTo05r, row.request_id],
        );
      }
    }
  }

  if (resolvedCount > 0) {
    console.log(`[chartAIResolver] resolved ${resolvedCount}/${rows.length} pending chart-AI plans`);
  }
}

async function finalize(
  requestId: string,
  status: string,
  exitPrice: number | null,
  realizedR: number | null,
  realizedPct: number | null,
  durationMin: number | null,
  mfeR?: number,
  maeR?: number,
  timeTo05r?: number | null,
): Promise<void> {
  // Conditional: only resolve rows that are still 'open' or 'active'. This
  // prevents two concurrent ticks (or two server instances) from each writing
  // a different terminal status and clobbering the path stats / exit price.
  // resolved_at is set ONCE; subsequent calls become no-ops.
  await pool.query(
    `UPDATE chartai_outcomes
        SET status=$1,
            exit_price=$2,
            realized_r=$3,
            realized_pct=$4,
            duration_minutes=$5,
            resolved_at=NOW(),
            resolution_source='auto_tracker',
            max_favorable_excursion_r = COALESCE($6, max_favorable_excursion_r),
            max_adverse_excursion_r   = COALESCE($7, max_adverse_excursion_r),
            time_to_first_05r_min     = COALESCE($8, time_to_first_05r_min),
            updated_at=NOW()
      WHERE request_id=$9
        AND status IN ('open', 'active')`,
    [status, exitPrice, realizedR, realizedPct, durationMin, mfeR ?? null, maeR ?? null, timeTo05r ?? null, requestId],
  );
}

export function startChartAIResolver(): void {
  if (started) return;
  started = true;
  // Initial run after 30s to let price feeds warm up (matches outcomeResolver).
  setTimeout(() => {
    resolveOnce().catch((e) => console.error("[chartAIResolver] tick failed:", e));
    timer = setInterval(() => {
      resolveOnce().catch((e) => console.error("[chartAIResolver] tick failed:", e));
    }, INTERVAL_MS);
  }, 30_000);
  console.log("[chartAIResolver] started (60s interval)");
}

export function stopChartAIResolver(): void {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}
