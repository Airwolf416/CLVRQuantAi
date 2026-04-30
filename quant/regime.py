from typing import Optional, Tuple
import pandas as pd
from .indicators import adx, atr, bb_width, ema, percentile_rank


# ── Signal Engine v1 §1: REGIME GATE (HARD FILTER, runs first) ───────────────
# Phase 2.1: this replaces the prior Hurst/ADX/RV scaffold. The classifier now
# matches the prompt-side spec exactly so the deterministic scorer is the
# authoritative source for regime — the AI prompt defers to whatever this
# function returns when a SCORER PREPASS is supplied.
#
# Five states (uppercase, spec names):
#   TREND_UP    — strong directional advance (ADX>=22, EMA20>EMA50>EMA200)
#   TREND_DOWN  — strong directional decline (ADX>=22, EMA20<EMA50<EMA200)
#   RANGE       — bounded, no strong trend (default bucket)
#   HIGH_VOL    — extreme range expansion (atr_pct>0.90 or bbw_pct>0.95)
#   CHOP        — low-energy noise (ADX<18 and bbw_pct<0.30)
def classify_regime(df: pd.DataFrame) -> str:
    """Spec v1 5-state regime classifier.

    Inputs: bar dataframe with columns open/high/low/close (ascending time).
    Method: percentile_rank of ATR(14) and BB_width(20,2) over the trailing
            90 bars + ADX(14) + EMA20/50/200 alignment.
    """
    if len(df) < 60:
        return "CHOP"

    close = df["close"]
    atr_series = atr(df, 14)
    bbw_series = bb_width(close, 20, 2.0)

    atr_pct = percentile_rank(atr_series, lookback=90)
    bbw_pct = percentile_rank(bbw_series, lookback=90)
    adx_val = float(adx(df, 14).iloc[-1] or 0.0)

    # 1. CHOP — low ADX AND compressed bands → no edge, stand down.
    if adx_val < 18 and bbw_pct < 0.30:
        return "CHOP"

    # 2. HIGH_VOL — extreme expansion in either ATR or BB-width percentile.
    if atr_pct > 0.90 or bbw_pct > 0.95:
        return "HIGH_VOL"

    # 3. TREND_UP / TREND_DOWN — strong ADX + full EMA alignment.
    if adx_val >= 22 and len(close) >= 200:
        e20 = float(ema(close, 20).iloc[-1])
        e50 = float(ema(close, 50).iloc[-1])
        e200 = float(ema(close, 200).iloc[-1])
        if e20 > e50 > e200:
            return "TREND_UP"
        if e20 < e50 < e200:
            return "TREND_DOWN"

    # 4. Default bucket — bounded but not chopping.
    return "RANGE"


# ── Allowed signal types per regime (spec §1 matrix) ─────────────────────────
# signal_type ∈ {"momentum", "mean_reversion"}.
# side        ∈ {"long", "short", None}.
# Returns (allowed, reason_code_if_blocked). reason_code is the canonical
# NO_SIGNAL reason name from server/prompts/shared.ts NO_TRADE_REASONS.
def regime_allows(regime: str, side: Optional[str], signal_type: str) -> Tuple[bool, Optional[str]]:
    """Returns (allowed, reason_if_not). Reason codes: regime_chop, regime_mismatch."""
    if regime == "CHOP":
        return False, "regime_chop"

    if regime == "TREND_UP":
        if signal_type == "mean_reversion":
            return False, "regime_mismatch"
        if side is not None and side != "long":
            return False, "regime_mismatch"
        return True, None

    if regime == "TREND_DOWN":
        if signal_type == "mean_reversion":
            return False, "regime_mismatch"
        if side is not None and side != "short":
            return False, "regime_mismatch"
        return True, None

    if regime == "RANGE":
        if signal_type == "momentum":
            return False, "regime_mismatch"
        return True, None

    if regime == "HIGH_VOL":
        if signal_type == "mean_reversion":
            return False, "regime_mismatch"
        return True, None

    # Unknown regime defaults to allow (defensive — should never hit).
    return True, None
