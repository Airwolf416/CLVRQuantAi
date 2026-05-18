// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — PostTradeAnalyzer (Phase A)
//
// Pure functions for tagging closed signals with a primary diagnosis (+0-3
// secondary tags). NO database I/O in this file — the resolver hook +
// background worker (postTradeAnalyzerWorker.ts) own persistence so this
// module stays unit-testable.
//
// Phase A scope:
//  • Implements the 13-rule priority engine + 3 secondary checks from the
//    PostTradeAnalyzer spec (Parts 2–3).
//  • Tolerates missing inputs — rules whose required field is null/undefined
//    are SKIPPED, not failed. This matters because the live system today
//    does NOT emit `thesis_invalidated` or `stale_flat` exit_reasons (only
//    TP*_HIT / SL_HIT / EXPIRED_*), so those rules will simply never fire.
//    When those exit_reasons land later the engine picks them up automatically.
//  • Deterministic explanation templates — no AI call per signal (cheap,
//    reproducible, journal-safe).
// ─────────────────────────────────────────────────────────────────────────────

export type PrimaryTag =
  // wins
  | "clean_win" | "chop_win" | "runner_win" | "early_exit_left_money"
  // losses
  | "clean_stop" | "thesis_invalidated_correctly" | "regime_misclassified"
  | "archetype_mismatch" | "chased_entry" | "stop_too_tight" | "stop_too_wide"
  | "macro_blindside" | "liquidity_event" | "right_idea_wrong_timing"
  | "stale_flat_correct" | "stale_flat_premature"
  // pending / fallback
  | "PENDING_ANALYSIS";

export type SecondaryTag =
  | "low_sample_archetype" | "counter_trend_warning_ignored" | "macro_event_overlap";

export interface AnalyzerInputs {
  signalId: number;
  token: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  exitReason: string;          // TP1_HIT|TP2_HIT|TP3_HIT|SL_HIT|EXPIRED_WIN|EXPIRED_LOSS|thesis_invalidated|stale_flat|...
  exitPrice: number | null;
  realizedR: number | null;
  mfeR: number | null;
  maeR: number | null;
  minutesToExit: number | null;
  expectedHoldMin: number | null;
  postExitDriftR: number | null;        // signed drift in trade direction within 30 min post-exit, in R-multiples
  postExitReachedTp1Within30Min: boolean | null; // for stop_too_tight rule
  // archetype + classifier context
  assignedArchetype: string | null;
  reclassifiedArchetype: string | null; // run classifier on full post-hoc window
  continuationProb: number | null;
  archetypeSampleN: number | null;      // sample size at signal time
  // regime / market context
  dayMoveAtrMultiple: number | null;    // |close - open| / ATR_daily, signed in trade direction
  atrDaily: number | null;
  atr5m: number | null;
  entryExtensionAtrMultiple: number | null; // ATR_daily multiples from session open at entry, signed in trade direction
  htfTrendSign: -1 | 0 | 1 | null;      // 1H EMA20 slope sign at signal time
  // macro / liquidity
  macroEventInWindow: boolean | null;
  macroEventInFeedAtSignal: boolean | null;
  volSpikeMultiple: number | null;      // max bar volume / 20-bar avg around adverse move
}

export interface DiagnosisOutput {
  primaryTag: PrimaryTag;
  secondaryTags: SecondaryTag[];
  actualArchetype: string | null;
  mfeR: number | null;
  maeR: number | null;
  confidence: number;             // 0–1, heuristic
  explanationText: string;
  diagnostics: Record<string, any>;
}

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES = new Set(["SL_HIT", "EXPIRED_LOSS"]);

const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

// ── Primary rule engine ─────────────────────────────────────────────────────
// Returns the FIRST matching rule per spec priority order. Each rule's guard
// short-circuits when its required input is null, so the engine always
// terminates and never throws.
function runPrimaryRules(i: AnalyzerInputs): { tag: PrimaryTag; confidence: number } {
  const r = i.realizedR;
  const isWin = i.exitReason ? WIN_OUTCOMES.has(i.exitReason) : (r != null && r > 0);
  const isLoss = i.exitReason ? LOSS_OUTCOMES.has(i.exitReason) : (r != null && r <= 0);

  // 1. thesis_invalidated_correctly — exit_reason='thesis_invalidated' AND realizedR > -0.6
  if (i.exitReason === "thesis_invalidated" && r != null && r > -0.6) {
    return { tag: "thesis_invalidated_correctly", confidence: 0.9 };
  }

  // 2. stop_too_tight — SL_HIT AND within 30 min post-exit price reaches original TP1
  if (i.exitReason === "SL_HIT" && i.postExitReachedTp1Within30Min === true) {
    return { tag: "stop_too_tight", confidence: 0.8 };
  }

  // 3. regime_misclassified — loss AND continuationProb>0.65 AND day's move reversed >1 ATR_daily against trade direction
  if (isLoss && i.continuationProb != null && i.continuationProb > 0.65
      && i.dayMoveAtrMultiple != null && i.dayMoveAtrMultiple < -1.0) {
    return { tag: "regime_misclassified", confidence: 0.75 };
  }

  // 4. archetype_mismatch — loss AND post-hoc reclassification differs
  if (isLoss && i.assignedArchetype && i.reclassifiedArchetype
      && i.assignedArchetype !== i.reclassifiedArchetype
      && i.reclassifiedArchetype !== "UNCLASSIFIED") {
    return { tag: "archetype_mismatch", confidence: 0.7 };
  }

  // 5. chased_entry — loss AND entry > 1.5 ATR_daily extended from session open in trade direction
  if (isLoss && i.entryExtensionAtrMultiple != null && i.entryExtensionAtrMultiple > 1.5) {
    return { tag: "chased_entry", confidence: 0.75 };
  }

  // 6. stale_flat_premature — exit_reason='stale_flat' AND price moved > 0.5R in trade direction within 15min post-exit
  if (i.exitReason === "stale_flat" && i.postExitDriftR != null && i.postExitDriftR > 0.5) {
    return { tag: "stale_flat_premature", confidence: 0.8 };
  }

  // 7. stale_flat_correct — exit_reason='stale_flat' AND no significant movement within 30min post-exit
  if (i.exitReason === "stale_flat" && i.postExitDriftR != null && Math.abs(i.postExitDriftR) <= 0.3) {
    return { tag: "stale_flat_correct", confidence: 0.85 };
  }

  // 8. macro_blindside — macro event in window AND not in feed at signal time
  if (i.macroEventInWindow === true && i.macroEventInFeedAtSignal === false) {
    return { tag: "macro_blindside", confidence: 0.85 };
  }

  // 9. liquidity_event — volume spike > 3x 20-bar avg around adverse move
  if (i.volSpikeMultiple != null && i.volSpikeMultiple > 3.0 && isLoss) {
    return { tag: "liquidity_event", confidence: 0.7 };
  }

  // 10. clean_win — realizedR >= 1.0 AND MFE/MAE >= 2
  if (isWin && r != null && r >= 1.0
      && i.mfeR != null && i.maeR != null && Math.abs(i.maeR) > 0
      && (i.mfeR / Math.abs(i.maeR)) >= 2.0) {
    return { tag: "clean_win", confidence: 0.9 };
  }

  // 11. chop_win — win AND MAE_R > 0.5 (took heat)
  if (isWin && r != null && r > 0 && i.maeR != null && Math.abs(i.maeR) > 0.5) {
    return { tag: "chop_win", confidence: 0.8 };
  }

  // 12. runner_win — realizedR >= 1.5
  if (isWin && r != null && r >= 1.5) {
    return { tag: "runner_win", confidence: 0.85 };
  }

  // 13. clean_stop — default for any remaining loss
  if (isLoss || (r != null && r <= 0)) {
    return { tag: "clean_stop", confidence: 0.6 };
  }

  // Fallback: TP1 hit cleanly, didn't qualify as clean/chop/runner above
  if (isWin) return { tag: "clean_win", confidence: 0.55 };

  return { tag: "PENDING_ANALYSIS", confidence: 0 };
}

// ── Secondary tags (non-exclusive) ──────────────────────────────────────────
export function secondaryChecks(i: AnalyzerInputs): SecondaryTag[] {
  return runSecondaryChecks(i);
}

function runSecondaryChecks(i: AnalyzerInputs): SecondaryTag[] {
  const out: SecondaryTag[] = [];
  if (i.archetypeSampleN != null && i.archetypeSampleN < 20) {
    out.push("low_sample_archetype");
  }
  // counter_trend_warning_ignored — HTF trend opposite signal direction
  // AND outcome aligned with HTF (loss for LONG when trend down, etc.)
  if (i.htfTrendSign != null && i.htfTrendSign !== 0) {
    const dirSign = i.direction === "LONG" ? 1 : -1;
    const counterTrend = i.htfTrendSign !== dirSign;
    const alignedWithHtf = i.realizedR != null && i.realizedR <= 0;
    if (counterTrend && alignedWithHtf) out.push("counter_trend_warning_ignored");
  }
  if (i.macroEventInWindow === true) out.push("macro_event_overlap");
  return out;
}

// ── Explanation templates ───────────────────────────────────────────────────
const TEMPLATES: Record<PrimaryTag, (i: AnalyzerInputs) => string> = {
  clean_win:                   (i) => `Clean win — TP hit with MFE/MAE ≥ 2 (realized ${fmtR(i.realizedR)}R).`,
  chop_win:                    (i) => `Profitable but took heat — MAE_R ${fmtR(i.maeR)} before reaching target.`,
  runner_win:                  (i) => `Runner win — captured ${fmtR(i.realizedR)}R beyond initial target.`,
  early_exit_left_money:       (i) => `Closed early; price continued ${fmtR(i.postExitDriftR)}R further in trade direction post-exit.`,
  clean_stop:                  (i) => `Stop hit, thesis was reasonable — no obvious misread (realized ${fmtR(i.realizedR)}R).`,
  thesis_invalidated_correctly:(i) => `Invalidation fired before SL, preserving capital (realized ${fmtR(i.realizedR)}R, would have been worse).`,
  regime_misclassified:        (i) => `Model expected continuation (p=${fmtP(i.continuationProb)}) but price mean-reverted ${fmtR(Math.abs(i.dayMoveAtrMultiple || 0))} ATR_daily against direction.`,
  archetype_mismatch:          (i) => `Tagged ${i.assignedArchetype || "UNKNOWN"} but post-hoc price action behaved like ${i.reclassifiedArchetype || "UNKNOWN"}.`,
  chased_entry:                (i) => `Entry was ${fmtR(i.entryExtensionAtrMultiple)} ATR_daily extended at signal time — EQS module flagged a chase setup.`,
  stop_too_tight:              (i) => `SL hit then price recovered to TP1 within 30 min — would have won with wider stop.`,
  stop_too_wide:               (i) => `Realized ${fmtR(i.realizedR)}R loss; tighter stop would have preserved capital and the setup re-triggered cleanly later.`,
  macro_blindside:             () => `High-impact macro event fired during hold window that was NOT flagged by Macro Clear at signal time.`,
  liquidity_event:             (i) => `Abnormal volume spike (${fmtR(i.volSpikeMultiple)}× 20-bar avg) drove the loss — likely liquidation or news flow.`,
  right_idea_wrong_timing:     () => `Trade direction matched the eventual move by session end but the signal was too early or too late.`,
  stale_flat_correct:          () => `Flat-exited at threshold and price went nowhere — correct kill, efficiency win.`,
  stale_flat_premature:        (i) => `Flat-exited but price moved ${fmtR(i.postExitDriftR)}R in trade direction within 15 min after exit.`,
  PENDING_ANALYSIS:            () => `Awaiting 35-minute post-exit window before diagnosis.`,
};

function fmtR(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toFixed(2);
}
function fmtP(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return (v * 100).toFixed(0) + "%";
}

/**
 * Pure entrypoint: given a fully-assembled inputs bundle, return the
 * deterministic diagnosis. Caller is responsible for persistence.
 */
export function diagnose(i: AnalyzerInputs): DiagnosisOutput {
  const inputs = normalizeInputs(i);
  const primary = runPrimaryRules(inputs);
  const secondary = runSecondaryChecks(inputs);
  const explainFn = TEMPLATES[primary.tag] || (() => "");
  return {
    primaryTag: primary.tag,
    secondaryTags: secondary,
    actualArchetype: inputs.reclassifiedArchetype,
    mfeR: inputs.mfeR,
    maeR: inputs.maeR,
    confidence: primary.confidence,
    explanationText: explainFn(inputs),
    diagnostics: {
      ruleVersion: 1,
      hadPostExitWindow: inputs.postExitDriftR != null,
      hadReclassification: inputs.reclassifiedArchetype != null,
      hadContinuationProb: inputs.continuationProb != null,
      hadMacroFeed: inputs.macroEventInFeedAtSignal != null,
    },
  };
}

function normalizeInputs(i: AnalyzerInputs): AnalyzerInputs {
  return {
    ...i,
    entry: num(i.entry) ?? 0,
    sl: num(i.sl),
    tp1: num(i.tp1), tp2: num(i.tp2), tp3: num(i.tp3),
    exitPrice: num(i.exitPrice),
    realizedR: num(i.realizedR),
    mfeR: num(i.mfeR), maeR: num(i.maeR),
    minutesToExit: num(i.minutesToExit),
    expectedHoldMin: num(i.expectedHoldMin),
    postExitDriftR: num(i.postExitDriftR),
    continuationProb: num(i.continuationProb),
    archetypeSampleN: num(i.archetypeSampleN),
    dayMoveAtrMultiple: num(i.dayMoveAtrMultiple),
    atrDaily: num(i.atrDaily), atr5m: num(i.atr5m),
    entryExtensionAtrMultiple: num(i.entryExtensionAtrMultiple),
    volSpikeMultiple: num(i.volSpikeMultiple),
  };
}

// ── Input assembly from a DB signal row ─────────────────────────────────────
// Best-effort: fills only what we can derive cheaply from the row itself.
// Anything that would require fetching candles/macro feeds is left null so
// rules dependent on those fields skip silently (analyzer is designed for
// this). The 35-min worker delay gives post-exit windows time to materialize
// but Phase A intentionally does NOT fetch them — we'll wire postExitDriftR
// + reclassification in Phase B alongside the auto-adjust loop.
export type AnalysisInputs = AnalyzerInputs;

export interface SignalLikeRow {
  id: number;
  token: string;
  direction: string;
  entry_price: string | number | null;
  tp1_price: string | number | null;
  tp2_price: string | number | null;
  tp3_price: string | number | null;
  stop_loss: string | number | null;
  outcome: string | null;
  pnl_pct: string | number | null;
  resolved_at: Date | string | null;
  created_at: Date | string | null;
  archetype: string | null;
  conviction?: number | null;
  asset_class?: string | null;
}

export async function collectAnalysisInputs(row: SignalLikeRow): Promise<AnalysisInputs> {
  const entry = num(row.entry_price) ?? 0;
  const sl = num(row.stop_loss);
  const tp1 = num(row.tp1_price);
  const tp2 = num(row.tp2_price);
  const tp3 = num(row.tp3_price);
  const direction = (String(row.direction || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT";
  const exitReason = String(row.outcome || "");
  // Exit price: cheapest reliable estimate — TP/SL level for hit outcomes,
  // null for EXPIRED_* (we don't reverse-engineer from pnl_pct here).
  let exitPrice: number | null = null;
  if (exitReason === "TP1_HIT") exitPrice = tp1;
  else if (exitReason === "TP2_HIT") exitPrice = tp2;
  else if (exitReason === "TP3_HIT") exitPrice = tp3;
  else if (exitReason === "SL_HIT") exitPrice = sl;
  // Realized R: signed (exit-entry)/(entry-sl), clamp safe.
  let realizedR: number | null = null;
  if (exitPrice != null && sl != null && entry > 0) {
    const risk = Math.abs(entry - sl);
    if (risk > 0) {
      const signed = direction === "LONG" ? (exitPrice - entry) : (entry - exitPrice);
      realizedR = signed / risk;
    }
  }
  // Minutes to exit from created_at → resolved_at if both available.
  let minutesToExit: number | null = null;
  if (row.created_at && row.resolved_at) {
    const c = new Date(row.created_at as any).getTime();
    const r = new Date(row.resolved_at as any).getTime();
    if (Number.isFinite(c) && Number.isFinite(r) && r >= c) minutesToExit = Math.round((r - c) / 60000);
  }
  return {
    signalId: row.id,
    token: String(row.token || ""),
    direction,
    entry,
    sl, tp1, tp2, tp3,
    exitReason,
    exitPrice,
    realizedR,
    mfeR: null,
    maeR: null,
    minutesToExit,
    expectedHoldMin: null,
    postExitDriftR: null,
    postExitReachedTp1Within30Min: null,
    assignedArchetype: row.archetype || null,
    reclassifiedArchetype: null,
    continuationProb: null,
    archetypeSampleN: null,
    dayMoveAtrMultiple: null,
    atrDaily: null,
    atr5m: null,
    entryExtensionAtrMultiple: null,
    htfTrendSign: null,
    macroEventInWindow: null,
    macroEventInFeedAtSignal: null,
    volSpikeMultiple: null,
  };
}

// Color category for journal UI per spec Part 5.
export function chipColor(tag: PrimaryTag): "green" | "yellow" | "red" | "grey" {
  switch (tag) {
    case "clean_win": case "runner_win":
    case "thesis_invalidated_correctly": case "stale_flat_correct":
      return "green";
    case "chop_win": case "stop_too_tight":
    case "early_exit_left_money": case "right_idea_wrong_timing":
      return "yellow";
    case "regime_misclassified": case "archetype_mismatch":
    case "chased_entry": case "stop_too_wide": case "stale_flat_premature":
      return "red";
    case "clean_stop": case "macro_blindside": case "liquidity_event":
    case "PENDING_ANALYSIS":
    default:
      return "grey";
  }
}
