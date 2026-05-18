// ─────────────────────────────────────────────────────────────────────────────
// Module 3 T03 — PostTradeAnalyzer delayed worker
//
// Every 60s, picks up to 100 rows from `post_trade_analysis` where
// primary_tag='PENDING_ANALYSIS' AND the underlying signal resolved more than
// 35 minutes ago (gives post-exit windows time to materialize for the
// stop_too_tight / stale_flat_premature rules), runs the analyzer, and
// UPDATEs the row with the diagnosis. Fail-open per row — a thrown error
// just leaves the row PENDING so the next tick retries.
//
// Single-flight guard mirrors outcomeResolver. Boot path gated by
// PTA_ANALYZER_ENABLED in server/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";
import { ptaAnalyzerEnabled } from "./featureFlags";
import { collectAnalysisInputs, diagnose, secondaryChecks, type AnalysisInputs } from "./postTradeAnalyzer";

const INTERVAL_MS = 60 * 1000;
const BATCH_LIMIT = 100;
const POST_EXIT_DELAY_MIN = 35;

let started = false;
let tickInFlight = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Idempotent enqueue. Called from outcomeResolver immediately after a
 * compare-and-set update wins the PENDING→resolved race. No-op when the
 * analyzer flag is off so flipping the flag mid-flight doesn't leak rows.
 */
export async function enqueuePostTradeAnalysis(signalId: number): Promise<void> {
  if (!ptaAnalyzerEnabled()) return;
  if (!Number.isFinite(signalId) || signalId <= 0) return;
  try {
    await db.execute(sql`
      INSERT INTO post_trade_analysis (signal_id, primary_tag)
      VALUES (${signalId}, 'PENDING_ANALYSIS')
      ON CONFLICT (signal_id) DO NOTHING
    `);
  } catch (err: any) {
    // Never block the resolver path on a logging table.
    console.warn("[ptaWorker] enqueue failed for signal", signalId, err?.message);
  }
}

interface SignalRow {
  id: number;
  token: string;
  direction: string;
  entry_price: string | null;
  tp1_price: string | null;
  tp2_price: string | null;
  tp3_price: string | null;
  stop_loss: string | null;
  outcome: string | null;
  pnl_pct: string | null;
  resolved_at: Date | null;
  created_at: Date | null;
  archetype: string | null;
  conviction: number | null;
  asset_class: string | null;
}

async function processOne(signalId: number): Promise<void> {
  // Load the signal row + any joined context we need. Defensive selects —
  // ai_signal_log column list has shifted over the modules so we keep this
  // SELECT minimal and let the analyzer tolerate nulls.
  const r: any = await db.execute(sql`
    SELECT s.id, s.token, s.direction, s.entry_price, s.tp1_price, s.tp2_price,
           s.tp3_price, s.stop_loss, s.outcome, s.pnl_pct, s.resolved_at,
           s.created_at, s.archetype, s.conviction, s.asset_class
    FROM ai_signal_log s
    WHERE s.id = ${signalId}
    LIMIT 1
  `);
  const rows = (r?.rows || r || []) as SignalRow[];
  const signal = rows[0];
  if (!signal) {
    // Signal vanished — mark UNCLASSIFIED so we don't keep re-trying.
    await db.execute(sql`
      UPDATE post_trade_analysis
      SET primary_tag='UNCLASSIFIED',
          analyzed_at=NOW(),
          explanation_text='Source signal not found at analysis time.',
          diagnostics=${JSON.stringify({ reason: "missing_signal" })}::jsonb
      WHERE signal_id=${signalId} AND primary_tag='PENDING_ANALYSIS'
    `);
    return;
  }

  let inputs: AnalysisInputs;
  try {
    inputs = await collectAnalysisInputs(signal as any);
  } catch (err: any) {
    console.warn("[ptaWorker] collectAnalysisInputs threw for signal", signalId, err?.message);
    // Leave PENDING for retry on transient feed errors.
    return;
  }

  const diag = diagnose(inputs);
  const secondary = secondaryChecks(inputs);
  const allSecondary = Array.from(new Set([...(diag.secondaryTags || []), ...secondary]));

  await db.execute(sql`
    UPDATE post_trade_analysis
    SET primary_tag=${diag.primaryTag},
        secondary_tags=${allSecondary as any},
        assigned_archetype=${inputs.assignedArchetype || null},
        actual_archetype=${diag.actualArchetype || inputs.reclassifiedArchetype || null},
        mfe_r=${Number.isFinite(diag.mfeR) ? diag.mfeR : null},
        mae_r=${Number.isFinite(diag.maeR) ? diag.maeR : null},
        diagnosis_confidence=${Number.isFinite(diag.confidence) ? diag.confidence : null},
        explanation_text=${diag.explanationText || null},
        diagnostics=${JSON.stringify(diag.diagnostics || {})}::jsonb,
        analyzed_at=NOW()
    WHERE signal_id=${signalId} AND primary_tag='PENDING_ANALYSIS'
  `);
}

async function tickOnce(): Promise<void> {
  if (!ptaAnalyzerEnabled()) return;
  // Pick rows whose underlying signal resolved >35min ago — gives time for
  // the post-exit windows that stop_too_tight / stale_flat rules require.
  let pendingRows: Array<{ signal_id: number }> = [];
  try {
    const r: any = await db.execute(sql`
      SELECT pta.signal_id
      FROM post_trade_analysis pta
      JOIN ai_signal_log s ON s.id = pta.signal_id
      WHERE pta.primary_tag = 'PENDING_ANALYSIS'
        AND s.resolved_at IS NOT NULL
        AND s.resolved_at < (NOW() - (${POST_EXIT_DELAY_MIN} || ' minutes')::interval)
      ORDER BY pta.analyzed_at ASC NULLS FIRST
      LIMIT ${BATCH_LIMIT}
    `);
    pendingRows = (r?.rows || r || []) as Array<{ signal_id: number }>;
  } catch (err: any) {
    console.warn("[ptaWorker] pending-select failed:", err?.message);
    return;
  }
  if (!pendingRows.length) return;

  let ok = 0;
  let fail = 0;
  for (const row of pendingRows) {
    try {
      await processOne(Number(row.signal_id));
      ok++;
    } catch (err: any) {
      fail++;
      console.warn("[ptaWorker] processOne failed for signal", row.signal_id, err?.message);
    }
  }
  if (ok || fail) {
    console.log(`[ptaWorker] processed ${ok}/${pendingRows.length} pending diagnoses (failed=${fail})`);
  }
}

export function startPostTradeAnalyzerWorker(): void {
  if (started) return;
  if (!ptaAnalyzerEnabled()) {
    console.log("[ptaWorker] PTA_ANALYZER_ENABLED=false — worker disabled");
    return;
  }
  started = true;
  console.log("[ptaWorker] starting (interval=60s, batch=100, delay=35min)");
  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await tickOnce();
    } catch (err: any) {
      console.error("[ptaWorker] tick failed:", err?.message);
    } finally {
      tickInFlight = false;
    }
  };
  // First run after 90s so the resolver has had a chance to enqueue and the
  // server's other startup work has settled.
  setTimeout(() => { tick(); }, 90_000);
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

/** For tests / admin endpoints. */
export async function runWorkerOnceForAdmin(): Promise<{ pending: number; ok: number; fail: number }> {
  let pending = 0; let ok = 0; let fail = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT pta.signal_id FROM post_trade_analysis pta
      JOIN ai_signal_log s ON s.id = pta.signal_id
      WHERE pta.primary_tag = 'PENDING_ANALYSIS'
        AND s.resolved_at IS NOT NULL
      LIMIT ${BATCH_LIMIT}
    `);
    const rows = (r?.rows || r || []) as Array<{ signal_id: number }>;
    pending = rows.length;
    for (const row of rows) {
      try { await processOne(Number(row.signal_id)); ok++; }
      catch { fail++; }
    }
  } catch (err: any) {
    console.warn("[ptaWorker] admin one-shot failed:", err?.message);
  }
  return { pending, ok, fail };
}
