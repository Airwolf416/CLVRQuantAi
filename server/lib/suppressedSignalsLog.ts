// ── suppressed_signals writer ─────────────────────────────────────────────────
// Single point of writes to the `suppressed_signals` table (additive schema
// landed in server/initDb.ts under Module 2 T01). Used by the three publish
// endpoints (/api/quant, /api/ai/analyze, /api/kronos) to record EVERY signal
// that the classifier could not tag, regardless of whether
// ARCHETYPE_SUPPRESSION_ENABLED is currently on.
//
// Shadow mode (flag off): signal still publishes, suppressed_signals row
//                         written with reason "would_suppress_no_archetype".
// Hot mode    (flag on):  signal dropped, same suppressed_signals row written
//                         but reason "suppressed_no_archetype".
//
// Fail-open: any DB error is logged and swallowed — the publish flow never
// blocks on shadow-log infrastructure.

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { ClassificationDiagnostics } from "./microstructureSnapshot";

export type SuppressionReason =
  | "would_suppress_no_archetype"   // shadow mode: flag off, signal still published
  | "suppressed_no_archetype"       // hot mode: flag on, signal dropped
  | "would_suppress_low_wr"         // reserved for future per-archetype WR-based gates
  | "suppressed_low_wr"
  // HardTrendFilter (May 2026) — counter-trend signal without MEAN_REV archetype
  | "would_suppress_counter_trend_no_mean_rev_archetype"   // shadow mode
  | "suppressed_counter_trend_no_mean_rev_archetype";      // hot mode

export interface LogSuppressedSignalInput {
  ticker: string;
  intendedDirection: "LONG" | "SHORT";
  assetClass?: "crypto" | "equity" | "commodity" | "fx" | "spot" | string;
  sourceEndpoint: "quant" | "analyze" | "kronos";
  reason: SuppressionReason;
  rawSignalPayload?: unknown;
  classificationDiagnostics?: ClassificationDiagnostics | null;
}

export async function logSuppressedSignal(input: LogSuppressedSignalInput): Promise<void> {
  try {
    const payloadJson = input.rawSignalPayload != null
      ? JSON.stringify(input.rawSignalPayload)
      : null;
    const diagJson = input.classificationDiagnostics != null
      ? JSON.stringify(input.classificationDiagnostics)
      : null;
    await db.execute(sql`
      INSERT INTO suppressed_signals
        (ticker, intended_direction, asset_class, source_endpoint, suppression_reason,
         raw_signal_payload, classification_diagnostics)
      VALUES
        (${input.ticker.toUpperCase()}, ${input.intendedDirection},
         ${input.assetClass ?? null}, ${input.sourceEndpoint}, ${input.reason},
         ${payloadJson}::jsonb, ${diagJson}::jsonb)
    `);
  } catch (err: any) {
    console.warn(
      `[suppressedSignalsLog] write failed for ${input.ticker}/${input.intendedDirection} (non-fatal):`,
      err?.message ?? err,
    );
  }
}
