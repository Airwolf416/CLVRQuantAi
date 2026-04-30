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
