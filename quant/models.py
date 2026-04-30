from pydantic import BaseModel
from typing import Optional, List, Any, Dict


class ScoreRequest(BaseModel):
    symbol: str
    timeframe: str = "1m"
    ohlcv: Optional[List[List[float]]] = None
    daily_returns: Optional[List[float]] = None
    equity_usd: float = 10_000.0
    conviction: float = 0.6
    wilson_lb: Optional[float] = None
    stocktwits_score: Optional[float] = None
    asset_class: str = "MID_CAP_DEFAULT"
    planned_rr: float = 2.0


class ScoreResponse(BaseModel):
    passes: bool
    side: Optional[str]
    composite_z: float
    regime: str
    suggested_size_usd: float
    sl_atr_mult: float
    tp_atr_mult: float
    sl_pct: float
    sigma_ann: float
    gates_failed: List[str]
    factors: Dict[str, Any]
    sl: Optional[float]
    tp: Optional[float]
    entry_ref: float
    ts: int
    # Signal Engine v1 (Phase 2.1) additions — backward-compatible (Optional).
    # signal_type      : "momentum" | "mean_reversion" — feeds the regime gate.
    # no_signal_reason : canonical first-failing gate name (matches
    #                    NO_TRADE_REASONS in server/prompts/shared.ts).
    signal_type: Optional[str] = None
    no_signal_reason: Optional[str] = None
    # Signal Engine v1 §2 (Phase 2.2) additions — Dual Score.
    # direction_probability : P(price reaches TP1 before SL within trade
    #                         horizon). 0.50 = no edge, asymptote ~0.85.
    # conviction            : model certainty about the signal as a whole.
    #                         Floor 0.40, ceiling 0.95. Drives Kelly later.
    # When both are below the per-asset-class threshold table in
    # quant/scorer.py DUAL_SCORE_THRESHOLDS, no_signal_reason is set to
    # "below_thresholds" (same name the legacy z_threshold gate uses).
    direction_probability: Optional[float] = None
    conviction: Optional[float] = None
    # Signal Engine v1 §3 (Phase 2.3) — Vol-Percentile-Adjusted R:R.
    # vol_percentile : percentile rank of ATR(14)/close over last 90 bars,
    #                  bounded [0.0, 1.0].
    # rr_multiplier  : R:R scaling factor selected from spec §3 buckets;
    #                  capped at 1.00 in RANGE regime per spec.
    # Both are deterministic — emit-only here; the AI defers via the
    # SCORER PREPASS line and uses these to pick TP locations on Fib.
    vol_percentile: Optional[float] = None
    rr_multiplier: Optional[float] = None
    # Signal Engine v1 §4 (Phase 2.4) — Meta-label → Kelly Scaling.
    # p_loss_meta : calibrated probability that this exact setup hits SL
    #               before TP1. Until a trained meta-classifier lands,
    #               this is a deterministic proxy: 1 - direction_probability
    #               (so a dir_prob of 0.62 → p_loss_meta = 0.38). Documented
    #               on the response so the proxy is auditable, and so a
    #               future trained model can drop in by changing this one
    #               field's source. The kelly_fraction_applied math runs
    #               server-side in routes.ts (it's the only place that
    #               knows the per-(token, direction) kelly_base from
    #               calibration).
    p_loss_meta: Optional[float] = None
    # Signal Engine v1 §5 (Phase 2.5) — Crypto microstructure features.
    # Populated only for crypto perps where STATE has live HL data. For
    # non-crypto (FOREX / METAL / STOCK) every field is null and AI emits
    # microstructure = {cvd_state: "n/a", obi: null, ivrv_spread: null}.
    #   cvd_state    : "confirm" / "bullish_div" / "bearish_div" /
    #                  "contradict" / "n/a"
    #   obi          : top-10-level order book imbalance ∈ [-1, +1]; null
    #                  when the book is stale (>30s) per spec §5b.
    #   ivrv_spread  : Deferred — Deribit IV feed not yet wired. Always
    #                  null today; the field exists so the prompt can
    #                  carry "n/a" without schema breakage when the feed
    #                  lands. (See spec §5c.)
    microstructure: Optional[Dict[str, Any]] = None


class CostRequest(BaseModel):
    symbol: str
    order_usd: float
    adv_usd: float
    sigma_daily_dec: float
    expected_alpha_bps: float
    asset_class: str = "MID_CAP_DEFAULT"


class CostResponse(BaseModel):
    total_bps: float
    half_spread_bps: float
    fee_bps: float
    impact_bps: float
    ev_pass: bool
