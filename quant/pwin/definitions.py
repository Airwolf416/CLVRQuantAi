"""
Canonical P(win) definition shared by every model in the pwin package.

P(win) = P( price hits TP before SL within hold_window_bars
            | features available at signal time )

All models that contribute to fusion (in Phase 2) MUST output probability
under this same definition so that fusion is well-formed. In Phase 1 the
only producer is the existing scorer's `direction_probability` (which is
already approximately P(directional move) — close enough to seed the
tracker; calibration corrects systematic over/underconfidence).
"""
from dataclasses import dataclass
from typing import Literal
import numpy as np


@dataclass
class SignalContext:
    instrument: str
    side: Literal["long", "short"]
    entry: float
    tp: float
    sl: float
    hold_window_bars: int           # e.g. 96 for 4h chart × 24h
    timeframe: str                  # "5m", "15m", "1h", "4h"
    regime: str                     # from regime classifier (TREND_UP / etc.)
    instrument_class: str           # "crypto" | "fx" | "commodity" | "equity"
    atr_pct: float                  # ATR as % of price (volatility regime)
    asof_ts: int                    # unix ms, signal generation time


def rr_ratio(ctx: SignalContext) -> float:
    """Reward:risk based on entry/TP/SL geometry. Positive for both sides."""
    if ctx.side == "long":
        denom = ctx.entry - ctx.sl
        if denom <= 0:
            return float("nan")
        return (ctx.tp - ctx.entry) / denom
    denom = ctx.sl - ctx.entry
    if denom <= 0:
        return float("nan")
    return (ctx.entry - ctx.tp) / denom


def clip_p(p: float, eps: float = 1e-4) -> float:
    """Bound a probability away from 0 and 1 for log-loss safety."""
    return float(np.clip(p, eps, 1.0 - eps))
