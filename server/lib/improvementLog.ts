// Internal helper for recording user-visible improvements as they ship.
// Call this from anywhere on the server side after making a change you want
// to surface in the Saturday weekly digest. The Improvement Log on the
// Account page reads from the same `update_log_entries` table.
//
// Behavior:
//   - addedBy defaults to "agent" so backfills/manual adds remain
//     distinguishable from agent-authored entries.
//   - Dedupes against the same headline within the last 7 days, so calling
//     this twice (e.g. on retry, or across a workflow restart) is safe.
//   - Never throws — failures are logged but never break the calling code
//     path. Logging an improvement must not be able to break a feature.

import { db } from "../db";
import { updateLogEntries } from "@shared/schema";
import { and, eq, gt } from "drizzle-orm";

export interface LogImprovementInput {
  headline: string;          // short title, e.g. "Faster signal refresh on mobile"
  detail?: string;           // optional 1–3 sentence user-facing explanation
  emoji?: string;            // optional single emoji for the digest
  addedBy?: string;          // "agent" | admin email | system component name
}

export async function logImprovement(input: LogImprovementInput): Promise<void> {
  const headline = (input.headline || "").trim();
  if (!headline) return;
  const addedBy = (input.addedBy || "agent").trim();
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existing = await db
      .select({ id: updateLogEntries.id })
      .from(updateLogEntries)
      .where(
        and(
          eq(updateLogEntries.headline, headline),
          gt(updateLogEntries.createdAt, sevenDaysAgo),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return; // dedupe — same headline already logged this week
    }
    await db.insert(updateLogEntries).values({
      headline,
      detail: input.detail?.trim() || null,
      emoji: input.emoji?.trim() || null,
      addedBy,
    });
    console.log(`[improvement-log] +${input.emoji || "•"} ${headline}`);
  } catch (e: any) {
    // Never bubble up — logging an improvement is best-effort.
    console.error(`[improvement-log] failed to log "${headline}":`, e?.message || e);
  }
}
