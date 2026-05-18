// ── ConvictionCap ───────────────────────────────────────────────────────────
// Publisher-stage cap (May 2026) — when raw engine conviction ≥ 50, the
// user-facing card displays 49 instead and a flag is raised. The full
// feature snapshot is recorded to `high_conviction_review` for later
// feature-importance analysis (the inverted-confidence bug).
//
// Defaults ON because the 32-day historical record shows raw≥50 had 19.6%
// WR vs 37.6% in the 30-49 bucket and Pearson r=−0.043 with outcome. Until
// the inversion is diagnosed and the offending features are reversed, we
// cannot trust high-conviction labels and must prevent users from
// oversizing into them.
//
// Pure helper module — caller handles wiring (and skipping when the flag is
// off). Fail-open on every DB write.

import { sql } from "drizzle-orm";
import { db } from "../db";

export interface ConvictionCapInput {
  rawConviction: number;                       // 0–100
  sourceEndpoint: "auto_scanner" | "analyze" | "kronos";
  token: string;
  direction: "LONG" | "SHORT";
  archetype?: string | null;
  signalId?: string | null;                    // app-side signal id (scanner uses one)
  aiSignalLogId?: number | null;               // ai_signal_log.id when known
  featureSnapshot?: Record<string, unknown> | null;
}

export interface ConvictionCapResult {
  rawConviction: number;
  displayedConviction: number;
  capped: boolean;
  reviewFlag: boolean;
}

export const CAP_THRESHOLD = 50;
export const CAP_DISPLAY_VALUE = 49;

export function applyConvictionCap(rawConviction: number): ConvictionCapResult {
  const raw = Math.max(0, Math.min(100, Number(rawConviction) || 0));
  if (raw >= CAP_THRESHOLD) {
    return {
      rawConviction: raw,
      displayedConviction: CAP_DISPLAY_VALUE,
      capped: true,
      reviewFlag: true,
    };
  }
  return {
    rawConviction: raw,
    displayedConviction: raw,
    capped: false,
    reviewFlag: false,
  };
}

export async function recordHighConvictionReview(input: ConvictionCapInput, result: ConvictionCapResult): Promise<void> {
  if (!result.capped) return;
  try {
    const snapshotJson = input.featureSnapshot != null
      ? JSON.stringify(input.featureSnapshot)
      : null;
    await db.execute(sql`
      INSERT INTO high_conviction_review
        (source_endpoint, token, direction, raw_conviction, displayed_conviction,
         archetype, signal_id, ai_signal_log_id, feature_snapshot)
      VALUES
        (${input.sourceEndpoint}, ${input.token.toUpperCase()}, ${input.direction},
         ${result.rawConviction}, ${result.displayedConviction},
         ${input.archetype ?? null}, ${input.signalId ?? null},
         ${input.aiSignalLogId ?? null}, ${snapshotJson}::jsonb)
    `);
  } catch (err: any) {
    console.warn(
      `[convictionCap] write failed for ${input.token}/${input.direction} (non-fatal):`,
      err?.message ?? err,
    );
  }
}
