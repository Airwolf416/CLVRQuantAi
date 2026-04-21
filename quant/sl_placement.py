import pandas as pd
from .indicators import atr, wick_stats
from .config import (NOISE_WICK_MULT, MIN_SL_PCT_BTCETH,
                     MIN_SL_PCT_MIDCAP, MIN_RR, FEE_BPS_TAKER)


def _min_sl_pct(symbol: str) -> float:
    if symbol in ("BTC", "ETH"):
        return MIN_SL_PCT_BTCETH
    return MIN_SL_PCT_MIDCAP


def build_sl_tp(symbol: str, side: str, entry: float, df: pd.DataFrame,
                planned_rr: float = 2.0) -> dict:
    a = float(atr(df, 14).iloc[-1] or 0.0)
    w = wick_stats(df, n=50)
    p90_wick = w["p90_lower_wick"] if side == "long" else w["p90_upper_wick"]
    if p90_wick != p90_wick:
        p90_wick = 0.0
    buf = max(1.5 * a, NOISE_WICK_MULT * p90_wick)
    floor_buf = _min_sl_pct(symbol) * entry
    buf = max(buf, floor_buf)
    sl = entry - buf if side == "long" else entry + buf
    sl_pct = abs(entry - sl) / entry if entry > 0 else 0.0
    f = FEE_BPS_TAKER / 10_000
    rr_min = ((1 - 0.55) + 2 * f / max(sl_pct, 1e-6)) / 0.55
    viable = planned_rr >= max(MIN_RR, 1.25 * rr_min)
    target = entry + planned_rr * (entry - sl) if side == "long" else entry - planned_rr * (sl - entry)
    return {
        "sl": sl, "target": target, "sl_pct": sl_pct,
        "atr": a, "p90_wick": p90_wick,
        "sl_atr_mult": (buf / a) if a > 0 else 0.0,
        "tp_atr_mult": (abs(target - entry) / a) if a > 0 else 0.0,
        "rr_planned": planned_rr, "rr_breakeven": rr_min,
        "viable": viable,
    }
