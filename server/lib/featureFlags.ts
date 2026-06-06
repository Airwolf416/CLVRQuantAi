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

// ── Win-rate hardening gates (May 2026) ─────────────────────────────────────
// Two publisher-stage gates added in response to the 32-day track record
// analysis showing (a) counter-trend signals on majors with ~0% WR and
// (b) inverted conviction-vs-outcome correlation above 50.

/**
 * HardTrendFilter — suppress LONG signals in DOWN trends and SHORT signals in
 * UP trends UNLESS archetype = MEAN_REVERSION_EXHAUSTION. Default OFF so the
 * filter ships in shadow mode: candidates that WOULD be suppressed are logged
 * to suppressed_signals with reason="counter_trend_no_mean_rev_archetype"
 * while still publishing, giving the owner data to validate the
 * suppression rate before flipping it on.
 */
export function hardTrendFilterEnabled(): boolean {
  return envBool("HARD_TREND_FILTER_ENABLED", false);
}

/**
 * ConvictionCap — caps the user-facing displayed conviction at 49 when the
 * raw engine conviction is ≥50, and records a snapshot to
 * high_conviction_review for later feature-importance analysis. Defaults ON
 * because the historical evidence (WR 19.6% vs 37.6%, Pearson r=−0.043) is
 * overwhelming and this is high-priority risk reduction.
 */
export function convictionCapEnabled(): boolean {
  return envBool("CONVICTION_CAP_ENABLED", true);
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

// ── Empirical expectancy filters (June 2026) ────────────────────────────────
// Wired from the 1,260-signal backtest (see server/lib/empiricalFilters.ts and
// .agents/memory/signal-expectancy-diagnostics.md). All default ON because the
// owner explicitly approved deploying them; flip any to "0" in Secrets to
// disable that lever independently without a code change.

/** Hard-cap live-signal leverage at 2x (the 3x+ tail is where losses concentrate). */
export function empiricalLeverageCapEnabled(): boolean {
  return envBool("EMPIRICAL_LEVERAGE_CAP_ENABLED", true);
}

/** Drop signals whose RAW conviction is in the empirically-inverted >=50 tail. */
export function convictionTailSuppressEnabled(): boolean {
  return envBool("CONVICTION_TAIL_SUPPRESS_ENABLED", true);
}

/** Soft gate: off-list crypto coins still publish but their conviction is capped. */
export function tokenSoftGateEnabled(): boolean {
  return envBool("TOKEN_SOFT_GATE_ENABLED", true);
}

/** Add a caution to Chart AI calls whose confidence is above 50 (kept, not dropped). */
export function chartAiConfidenceWarningEnabled(): boolean {
  return envBool("CHART_AI_CONFIDENCE_WARNING_ENABLED", true);
}
