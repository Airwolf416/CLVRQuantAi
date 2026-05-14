"""
P(win) calibration package — Phase 1 (passive tracker + Platt scaling).

Phase 1 scope (this commit):
  - definitions.py    : canonical SignalContext + helpers
  - tracker.py        : Brier, log_loss, reliability_bins, log/resolve/fetch
  - calibration.py    : Platt + isotonic fallback, get/fit_calibrator
  - weekly_recalibration.py : manual trigger (no cron in Phase 1)

Phase 1 explicitly does NOT modify:
  - direction_probability or p_loss_meta_proxy logic in quant/scorer.py
  - Kelly sizing in server/routes.ts
  - The Claude validator prompt in server/prompts/

Graduation criteria to Phase 2 (full fusion stack):
  - >= 100 closed signals per instrument_class logged
  - Reliability diagram visible for at least 2 weeks
  - Platt scaler shows stable, monotonic mapping
  - Brier baseline established for direction_probability
"""
