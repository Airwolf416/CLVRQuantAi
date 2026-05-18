// ── Feature Flags — Module 2 Setup Taxonomy ─────────────────────────────────
// Centralized boolean/enum env reads so the phased rollout is grep-able from
// one place. Each flag is read fresh on access (no caching) so an operator
// can toggle in Replit Secrets and restart without a code change.
//
// Defaults are deliberately CONSERVATIVE — every flag ships "off" until its
// upstream task (backfill, MV, etc.) is verified on dev DB. Flipping a flag
// must never require schema changes or code edits.
//
// Convention: boolean flags accept "1" | "true" | "yes" (case-insensitive)
// as true; everything else (including unset) is false.

function envBool(name: string, def = false): boolean {
  const v = String(process.env[name] ?? "").toLowerCase().trim();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envEnum<T extends string>(name: string, allowed: readonly T[], def: T): T {
  const v = String(process.env[name] ?? "").toLowerCase().trim();
  return (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

/**
 * Module 2 T05 — when true, /api/quant / /api/ai/analyze / /api/kronos drop
 * the signal entirely if the classifier returns UNCLASSIFIED. When false
 * (default), the signal still publishes BUT a shadow row is written to
 * `suppressed_signals` so the admin can quantify the suppression footprint
 * before turning the flag on.
 */
export function archetypeSuppressionEnabled(): boolean {
  return envBool("ARCHETYPE_SUPPRESSION_ENABLED", false);
}

/**
 * Module 2 T07 — when true, `getArchetypeStats` pools live + backfilled rows
 * via the UNION query. When false, only live rows count (Module 1 behavior).
 * Default false until the T06 backfill is validated on dev DB.
 */
export function useBackfilledStats(): boolean {
  return envBool("USE_BACKFILLED_STATS", false);
}

/**
 * Module 2 T10 — selects the stats repository implementation. "ts" uses the
 * in-process Drizzle query path (Module 1 behavior, 5-min cache). "mv" reads
 * from the `archetype_stats` materialized view created in T08.
 */
export function statsSource(): "ts" | "mv" {
  return envEnum<"ts" | "mv">("STATS_SOURCE", ["ts", "mv"], "ts");
}

/**
 * Module 2 T11 — when true, the SignalCard drops the old global brain WR row
 * and shows only the per-archetype stats. When false, both rows render for
 * side-by-side comparison.
 */
export function useArchetypeDisplay(): boolean {
  return envBool("USE_ARCHETYPE_DISPLAY", false);
}

// ── Module 3 — PostTradeAnalyzer (Phase A: shadow-mode tagging) ─────────────
// Phase A ships the tagger + journal UI + weekly report behind these four
// flags. The auto-adjust feedback loop and 90d bootstrap (Parts 4 + 8 of the
// spec) are Phase B and are intentionally NOT wired this session, so
// `ptaModelAdjustmentsEnabled` is read but no code branches on it yet.

/**
 * Phase A — gate the post-trade analyzer worker entirely. Default true so the
 * tagger starts collecting diagnoses immediately after deploy. Flipping off
 * stops the 60s worker tick and disables enqueueing from outcomeResolver.
 */
export function ptaAnalyzerEnabled(): boolean {
  return envBool("PTA_ANALYZER_ENABLED", true);
}

/**
 * Phase A — gate the user-facing Journal chips. Default false: the Journal
 * page renders a "coming soon" placeholder until we've spot-checked 30
 * tagged signals manually for accuracy (per session-plan cadence).
 */
export function ptaJournalDisplayEnabled(): boolean {
  return envBool("PTA_JOURNAL_DISPLAY_ENABLED", false);
}

/**
 * Phase A — gate the Sunday 22:00 ET weekly report scheduler + email send.
 * Default false: we want ≥2 weeks of analyzer output before the first
 * report ships to admins / Elite users.
 */
export function ptaWeeklyReportEnabled(): boolean {
  return envBool("PTA_WEEKLY_REPORT_ENABLED", false);
}

/**
 * Phase B — auto-adjust feedback loop. STAYS at default false this session.
 * Read here only so future Phase B wiring can grep one location.
 */
export function ptaModelAdjustmentsEnabled(): boolean {
  return envBool("PTA_MODEL_ADJUSTMENTS_ENABLED", false);
}
