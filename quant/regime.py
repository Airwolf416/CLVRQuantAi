from typing import Optional, Tuple
import math
import numpy as np
import pandas as pd
from .indicators import adx, atr, bb_width, ema, percentile_rank


def _finite(x: float, default: float) -> float:
    """Coerce NaN/Inf to a neutral default. Python's `float(np.nan or 0.0)`
    keeps NaN (NaN is truthy), so we need an explicit isfinite check before
    feeding indicator outputs into regime threshold comparisons. Fail-closed
    means a degenerate bar window classifies as CHOP rather than silently
    leaking through as RANGE."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


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

    # Phase 2.1 fix (post-review): degeneracy guard. If the close series has
    # too few finite values, the downstream indicators all return mostly NaN
    # and percentile_rank() falls back to a neutral 0.5 — which conveniently
    # fails every threshold and silently lands on RANGE. That's wrong: a
    # degenerate bar window should fail-closed to CHOP so the regime gate
    # blocks the trade rather than green-lighting it under "RANGE allows
    # mean_reversion".
    if close.dropna().shape[0] < 30:
        return "CHOP"

    atr_series = atr(df, 14)
    # bb_width can emit Inf when the rolling mean approaches zero; strip
    # non-finite values before percentile-ranking so a bogus blow-up bar
    # doesn't fool the classifier into HIGH_VOL.
    bbw_series = bb_width(close, 20, 2.0).replace([np.inf, -np.inf], np.nan)

    # Same degeneracy reasoning at the indicator level — if either indicator
    # is mostly NaN (e.g. all-flat input where rolling std = 0 → BBW = 0/0
    # → NaN), classify CHOP rather than letting the neutral default win.
    if atr_series.dropna().shape[0] < 10 or bbw_series.dropna().shape[0] < 10:
        return "CHOP"

    # Constant-series guard: if BBW is effectively constant in the trailing
    # window (e.g. all-flat synthetic bars where rolling std = 0 produces
    # BBW = 0 everywhere), percentile_rank() returns 1.0 by the (window <=
    # last) definition — which spoofs HIGH_VOL even though there is literally
    # no volatility. Detect zero-variance windows explicitly and classify
    # CHOP. Same check on ATR for symmetry.
    bbw_tail = bbw_series.dropna().tail(90)
    atr_tail = atr_series.dropna().tail(90)
    if len(bbw_tail) and (bbw_tail.max() - bbw_tail.min()) < 1e-12:
        return "CHOP"
    if len(atr_tail) and (atr_tail.max() - atr_tail.min()) < 1e-12:
        return "CHOP"

    # percentile_rank returns 0.5 when its input is too short or all-NaN
    # (neutral default), so this is already safe — but guard against any
    # future change by funneling through _finite as well.
    atr_pct = _finite(percentile_rank(atr_series, lookback=90), 0.5)
    bbw_pct = _finite(percentile_rank(bbw_series, lookback=90), 0.5)
    # Phase 2.1 fix: `float(np.nan or 0.0)` returns NaN in Python (NaN is
    # truthy). When ADX has < period+1 samples or the dataframe is all-NaN,
    # iloc[-1] is NaN and every threshold comparison silently fails False,
    # which used to drop the bar through to the RANGE default. Coerce to 0.0
    # so a missing ADX classifies as CHOP, not RANGE.
    adx_val = _finite(adx(df, 14).iloc[-1], 0.0)

    # 1. CHOP — low ADX AND compressed bands → no edge, stand down.
    if adx_val < 18 and bbw_pct < 0.30:
        return "CHOP"

    # 2. HIGH_VOL — extreme expansion in either ATR or BB-width percentile.
    if atr_pct > 0.90 or bbw_pct > 0.95:
        return "HIGH_VOL"

    # 3. TREND_UP / TREND_DOWN — strong ADX + full EMA alignment.
    if adx_val >= 22 and len(close) >= 200:
        e20 = _finite(ema(close, 20).iloc[-1], 0.0)
        e50 = _finite(ema(close, 50).iloc[-1], 0.0)
        e200 = _finite(ema(close, 200).iloc[-1], 0.0)
        # If any EMA is non-finite (defaulted to 0) the alignment check
        # cannot pass meaningfully, so we'll fall through to RANGE.
        if e20 > 0 and e50 > 0 and e200 > 0:
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
def regime_allows(regime: str, side: Optional[str], signal_type: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Returns (allowed, reason_if_not). Reason codes: regime_chop, regime_mismatch.

    Tightening (Phase 2.1, post-review): unknown / None signal_type fails the
    gate as a mismatch (except CHOP which blocks unconditionally). For trend
    regimes a None side also fails — there is no actual trade direction in
    that case, so allowing through would be a silent bug. The composite-
    side check in main.py already enforces this redundantly via `passes`,
    but this function is the canonical authority and should be self-consistent.
    """
    if regime == "CHOP":
        return False, "regime_chop"

    # Unknown signal_type → mismatch (cannot evaluate the matrix).
    if signal_type not in ("momentum", "mean_reversion"):
        return False, "regime_mismatch"

    if regime == "TREND_UP":
        if signal_type != "momentum":
            return False, "regime_mismatch"
        if side != "long":
            return False, "regime_mismatch"
        return True, None

    if regime == "TREND_DOWN":
        if signal_type != "momentum":
            return False, "regime_mismatch"
        if side != "short":
            return False, "regime_mismatch"
        return True, None

    if regime == "RANGE":
        if signal_type != "mean_reversion":
            return False, "regime_mismatch"
        return True, None

    if regime == "HIGH_VOL":
        if signal_type != "momentum":
            return False, "regime_mismatch"
        return True, None

    # Unknown regime defaults to allow (defensive — should never hit).
    return True, None
