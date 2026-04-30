import pandas as pd
import numpy as np
from typing import Optional, List, Tuple
from .config import (W_MOMENTUM, W_MEANREV, W_CARRY, W_FLOW, W_VOLGATE,
                     W_SENTIMENT, Z_THRESHOLD, WILSON_LB_THRESHOLD, OFI_Z_MIN_ABS)
from .indicators import rsi, bollinger_z
from .microstructure import parse_levels, obi, wobi, cvd_z, ofi_z
from .state import STATE


def _z(x, mu, sd):
    return (x - mu) / sd if sd and sd > 0 else 0.0


def _momentum_z(close: pd.Series) -> float:
    if len(close) < 30:
        return 0.0
    ema_fast = close.ewm(span=12, adjust=False).mean().iloc[-1]
    ema_slow = close.ewm(span=26, adjust=False).mean().iloc[-1]
    ema_ratio = (ema_fast / ema_slow - 1.0)
    n = len(close)
    ret7 = close.iloc[-1] / close.iloc[-min(n - 1, 168)] - 1.0 if n >= 2 else 0.0
    mom_12_1 = close.iloc[-21] / close.iloc[-min(n - 1, 252)] - 1.0 if n >= 252 else 0.0
    rets = close.pct_change().dropna()
    sd = float(rets.std() or 0.0)
    if sd <= 0:
        return 0.0
    return float(_z(ema_ratio, 0, sd) + _z(ret7, 0, sd * 7 ** 0.5) + _z(mom_12_1, 0, sd * 21 ** 0.5)) / 3.0


def _meanrev_z(close: pd.Series) -> float:
    if len(close) < 20:
        return 0.0
    r = float(rsi(close, 14).iloc[-1] or 50.0)
    bz = float(bollinger_z(close, 20).iloc[-1] or 0.0)
    rsi_dev = (50.0 - r) / 20.0
    return (rsi_dev - bz) / 2.0


def _carry_z(ctx: dict) -> float:
    try:
        f = float(ctx.get("funding", "0")) * 8 * 365
    except Exception:
        f = 0.0
    return -f / 0.5


def _flow_z(coin: str, side_hint: str) -> Tuple[float, float]:
    book = STATE.books.get(coin)
    if not book:
        return 0.0, 0.0
    try:
        bids, asks = parse_levels(book, 10)
    except Exception:
        return 0.0, 0.0
    _wobi = wobi(bids, asks)
    _cvdz = cvd_z(STATE.cvd[coin])
    _, _ofiz = ofi_z(STATE.ofi_events[coin])
    flow = 0.4 * _wobi + 0.3 * _cvdz + 0.3 * _ofiz
    return float(flow), float(_ofiz)


def _volgate_z(close: pd.Series) -> float:
    lr = close.pct_change().dropna()
    if len(lr) < 40:
        return 0.0
    rv20 = float(lr.rolling(20).std().iloc[-1] or 0.0)
    rv100 = float(lr.rolling(100).std().iloc[-1] or 0.0) if len(lr) >= 100 else float(lr.std() or 0.0)
    if rv100 <= 0:
        return 0.0
    ratio = rv20 / rv100
    if ratio > 1.8:
        return -1.0
    if ratio < 0.5:
        return -0.5
    return 0.5


def _sentiment_z(stocktwits_score: Optional[float]) -> float:
    if stocktwits_score is None:
        return 0.0
    return max(-2.0, min(2.0, stocktwits_score))


def compute_composite(coin: str, df: pd.DataFrame, ctx: dict,
                      wilson_lb: Optional[float],
                      stocktwits_score: Optional[float]) -> dict:
    close = df["close"]
    mom = _momentum_z(close)
    mr = _meanrev_z(close)
    carry = _carry_z(ctx)
    flow, ofi_z_val = _flow_z(coin, "long")
    vol = _volgate_z(close)
    sent = _sentiment_z(stocktwits_score)

    composite = (W_MOMENTUM * mom + W_MEANREV * mr + W_CARRY * carry
                 + W_FLOW * flow + W_VOLGATE * vol + W_SENTIMENT * sent)
    side = "long" if composite > 0 else "short" if composite < 0 else None

    gates_failed: List[str] = []
    if abs(composite) < Z_THRESHOLD:
        gates_failed.append("z_threshold")
    if wilson_lb is not None and wilson_lb < WILSON_LB_THRESHOLD:
        gates_failed.append("wilson_lb")
    if abs(ofi_z_val) > OFI_Z_MIN_ABS and side is not None:
        want_sign = 1 if side == "long" else -1
        if (ofi_z_val > 0 and want_sign < 0) or (ofi_z_val < 0 and want_sign > 0):
            gates_failed.append("ofi_sign")
    # Signal-type classification (Signal Engine v1 §1 — feeds regime_allows).
    # The composite blends momentum and mean-reversion factors; whichever
    # weighted contribution dominates determines whether this is a momentum
    # play or a mean-reversion play. The scorer's regime gate then checks
    # if that type is allowed in the current regime.
    mom_contrib = abs(W_MOMENTUM * mom)
    mr_contrib = abs(W_MEANREV * mr)
    signal_type = "momentum" if mom_contrib >= mr_contrib else "mean_reversion"

    return {
        "composite_z": float(composite),
        "side": side,
        "signal_type": signal_type,
        "factors": {"momentum": mom, "meanrev": mr, "carry": carry,
                    "flow": flow, "volgate": vol, "sentiment": sent,
                    "ofi_z": ofi_z_val},
        "gates_failed": gates_failed,
    }
