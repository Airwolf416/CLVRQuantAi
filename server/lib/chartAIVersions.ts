// ============================================================================
// Chart AI versioning constants
// ============================================================================
// Stamped on every row in chartai_plans so future changes to the prompt
// schema or the underlying risk/sizing math don't pollute the historical
// dataset. When you iterate either contract, bump the matching version here
// and old rows remain queryable by their original version tag.
//
// schemaVersion = the JSON contract the AI returns
//   v1 = original (single entry price, take_profits[] array, confidence)
//   v2 = adds entry_zone {low, high}, time_horizon_minutes,
//        hard_exit_timer_minutes, rr_tp1, rr_tp2  ← CURRENT
//
// frameworkVersion = the resolver math + risk/sizing assumptions
//   v1 = symmetric R = |fill - stop|, TP1 closes whole position, no scaling,
//        no funding/borrow cost adjustment, hard_exit on no-progress  ← CURRENT
//
// Bumping rules:
//   - Schema bump: any breaking change to the AI response shape (renamed
//     fields, removed fields, changed semantics).
//   - Framework bump: any change to how realized_r / mfe_r / mae_r are
//     computed, exit ordering, fill detection, or position sizing.
// ============================================================================

export const CHARTAI_SCHEMA_VERSION = "v2";
export const CHARTAI_FRAMEWORK_VERSION = "v1";
