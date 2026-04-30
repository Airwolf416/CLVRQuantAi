import math
import pandas as pd
import numpy as np
from typing import Optional, List, Tuple
from .config import (W_MOMENTUM, W_MEANREV, W_CARRY, W_FLOW, W_VOLGATE,
                     W_SENTIMENT, WILSON_LB_THRESHOLD, OFI_Z_MIN_ABS)
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
    # Phase 2.1 hardening (post-review): NaN composite would silently bypass
    # the directional check (NaN < anything = False) and produce a None side
    # that would then default to "long" downstream. Coerce non-finite
    # composites to exactly 0.0 so side correctly resolves to None and
    # |composite_z|=0 forces dir_prob to 0.50 (fails every threshold bar).
    # Common cause: zero-variance input where each factor's z-score divides
    # by std=0.
    try:
        _c = float(composite)
        if not (_c == _c) or _c in (float("inf"), float("-inf")):
            composite = 0.0
        else:
            composite = _c
    except (TypeError, ValueError):
        composite = 0.0
    side = "long" if composite > 0 else "short" if composite < 0 else None

    gates_failed: List[str] = []
    # Phase 2.2 (post-architect-review): the legacy single-knob `z_threshold`
    # gate (|composite| < Z_THRESHOLD) is REMOVED. The Signal Engine v1 §2
    # Dual-Score gate in main.py — direction_probability + conviction with
    # per-asset-class thresholds — supersedes it with finer-grained, asset-
    # aware bounds. Keeping both ran false rejections in the |z|≈1.06–1.50
    # band where dual-score passes but the legacy 1.5 floor still blocked,
    # surfacing as `below_thresholds` on signals the new spec considers OK.
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
    #
    # Phase 2.1 hardening (post-review): NaN-safe + tied-zero defensive case.
    # If both factors are NaN or both are exactly zero, there is no dominant
    # contribution — fall back to "momentum" (the more common type) AND let
    # the side==None composite check below handle the no-trade case via
    # `passes`. We deliberately do NOT emit None for signal_type because
    # downstream consumers (regime_allows + ScoreResponse) treat None as
    # an unknown-type mismatch which would mask the real reason.
    def _safe_abs(x: float) -> float:
        try:
            v = float(x)
        except (TypeError, ValueError):
            return 0.0
        return abs(v) if (v == v and v not in (float("inf"), float("-inf"))) else 0.0
    mom_contrib = _safe_abs(W_MOMENTUM * mom)
    mr_contrib = _safe_abs(W_MEANREV * mr)
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


# Signal Engine v1 §2 — Dual Score (direction_probability + conviction).
# Both bounded [0, 1]; the per-asset-class threshold table lives in main.py
# and emits the canonical `below_thresholds` no_signal_reason when either
# bound fails. Keeping the math here (alongside compute_composite) so the
# scorer stays the single source of truth for everything that feeds the
# SCORER PREPASS line — main.py only does threshold lookup + dispatch.
def compute_dual_score(comp: dict, gates_failed_so_far: List[str],
                       regime_allowed: bool, df_len: int) -> dict:
    """Deterministic dual-score derived from compute_composite output.

    direction_probability = P(price reaches TP1 before SL within trade
    horizon). Bounded logistic over the DIRECTIONAL sub-composite — per
    spec §2 "driven PURELY by directional features (momentum, structure,
    OI delta, CVD, order book imbalance)". Carry and volgate are
    excluded: carry is a positional cost, volgate is a regime modifier.
    Mean_reversion IS directional (predicts an opposing move) and stays
    in. Sentiment is a directional sentiment signal and stays in.

    Multiplier 0.30 / divisor 3.0 chosen so the formula has meaningful
    range up to its 0.85 ceiling: |z|=0 → 0.50; |z|=1 → ~0.595; |z|=2
    → ~0.679; |z|=5 → ~0.779; asymptote ~0.80. The 0.85 ceiling is a
    forward-looking cap for future stronger directional features (IV-RV,
    multi-timeframe momentum stack) without changing the bounds today.

    conviction = model certainty about the signal as a whole. Sums four
    standardized inputs:
      - alignment      : how concentrated the FULL composite is in one
                         direction (1.0 = all factors agree, 0.0 =
                         perfect cancellation). Captures "feature
                         alignment" + "absence of conflicting signals".
      - regime_fit     : 1.0 if regime_allows() returned True for this
                         (regime, side, signal_type), else 0.0.
      - no_conflicts   : 1.0 if no gates have already failed (regime,
                         wilson, ofi, rr, noise). Else 0.5.
      - data_freshness : len(df) / 200, capped at 1.0. Most production
                         calls are >= 200 bars so this is effectively a
                         baseline; the divisor is the soak-in floor.

    NOTE: The IV-RV term that the spec lists under conviction inputs is
    deferred to Phase 2.5 (microstructure wiring) when the Deribit IV
    feed lands. Until then conviction is regime+alignment-anchored.
    """
    factors = comp.get("factors") or {}

    # ─── directional sub-composite (spec §2: directional features ONLY) ──
    f_mom  = float(factors.get("momentum",  0.0) or 0.0)
    f_mr   = float(factors.get("meanrev",   0.0) or 0.0)
    f_flow = float(factors.get("flow",      0.0) or 0.0)
    f_sent = float(factors.get("sentiment", 0.0) or 0.0)
    directional_z = (W_MOMENTUM  * f_mom
                     + W_MEANREV   * f_mr
                     + W_FLOW      * f_flow
                     + W_SENTIMENT * f_sent)
    # NaN-safe (matches the same defensive coercion in compute_composite).
    if not (directional_z == directional_z) \
            or directional_z in (float("inf"), float("-inf")):
        directional_z = 0.0

    abs_dz = abs(directional_z)
    dir_prob = 0.50 + 0.30 * math.tanh(abs_dz / 3.0)
    dir_prob = max(0.50, min(0.85, dir_prob))

    # ─── conviction inputs (use FULL composite for alignment) ────────────
    composite = float(comp.get("composite_z") or 0.0)
    contribs = [
        W_MOMENTUM  * f_mom,
        W_MEANREV   * f_mr,
        W_CARRY     * float(factors.get("carry",   0.0) or 0.0),
        W_FLOW      * f_flow,
        W_VOLGATE   * float(factors.get("volgate", 0.0) or 0.0),
        W_SENTIMENT * f_sent,
    ]
    total_abs = sum(abs(c) for c in contribs)
    alignment = (abs(composite) / total_abs) if total_abs > 0 else 0.0
    alignment = max(0.0, min(1.0, alignment))

    regime_fit = 1.0 if regime_allowed else 0.0

    # Phase 2.2 (post-architect-review): with z_threshold removed from
    # compute_composite, gates_failed_so_far now contains only genuine
    # non-threshold failures (regime / wilson / ofi / rr / noise). No
    # exclusion list needed — every entry is a real conflict.
    no_conflicts = 1.0 if len(gates_failed_so_far) == 0 else 0.5

    data_freshness = min(1.0, max(0.0, float(df_len) / 200.0))

    conviction = (0.40
                  + 0.25 * alignment
                  + 0.15 * regime_fit
                  + 0.10 * no_conflicts
                  + 0.10 * data_freshness)
    conviction = max(0.40, min(0.95, conviction))

    return {
        "direction_probability": float(dir_prob),
        "conviction": float(conviction),
        "alignment": float(alignment),
        "directional_z": float(directional_z),
    }


# Signal Engine v1 §2 — per-asset-class dual-score thresholds.
# BOTH bounds must clear or main.py emits NO_SIGNAL: below_thresholds.
# Alts get a higher bar because of fee/slippage drag (per spec).
DUAL_SCORE_THRESHOLDS: dict = {
    "BTC":             (0.58, 0.60),
    "ETH":             (0.58, 0.60),
    "MID_CAP_DEFAULT": (0.62, 0.68),
    "FOREX":           (0.55, 0.55),
    "METAL":           (0.57, 0.60),
    "STOCK":           (0.56, 0.58),
}


def dual_score_thresholds_for(asset_class: str) -> Tuple[float, float]:
    """Return (dir_prob_min, conviction_min) for asset_class. Defaults
    to BTC/ETH bar (0.58, 0.60) if the class is unknown — safer than
    waving signals through on an unrecognized routing key."""
    return DUAL_SCORE_THRESHOLDS.get(asset_class, (0.58, 0.60))


# ─────────────────────────────────────────────────────────────────────────────
# Signal Engine v1 §3 (Phase 2.3) — Vol-Percentile-Adjusted R:R.
# Replaces the prompt-side spec block ("vol_pct = percentile_rank(ATR(14), 90);
# rr_multiplier = bucket-select") with a deterministic implementation.
# Bucket boundaries are spec-literal:
#   vol_pct <  0.20 → 0.70  (compressed vol — tighter targets)
#   vol_pct <  0.60 → 1.00  (normal — baseline)
#   vol_pct <  0.85 → 1.30  (expanded — modest stretch)
#   vol_pct ≥  0.85 → 1.60  (high vol — full stretch)
# RANGE-regime override: cap at 1.00 (mean-reversion TPs shouldn't extend).
# Inputs:
#   df     : full OHLCV frame (uses high/low/close for ATR(14)).
#   regime : current regime string from classify_regime().
# Returns (vol_percentile, rr_multiplier). Both clamped; safe under degenerate
# input — returns the (0.50, 1.00) baseline when not enough bars or NaN ATR.
# ─────────────────────────────────────────────────────────────────────────────
def compute_vol_adjusted_rr(df: pd.DataFrame, regime: str) -> Tuple[float, float]:
    if len(df) < 90:
        return 0.50, 1.00
    high  = df["high"].astype(float)
    low   = df["low"].astype(float)
    close = df["close"].astype(float)
    prev_close = close.shift(1)
    # True Range = max(H-L, |H-prevC|, |L-prevC|). Pandas idiom for ATR.
    tr = pd.concat(
        [(high - low).abs(),
         (high - prev_close).abs(),
         (low  - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr14 = tr.rolling(14).mean()
    # Use ATR-as-fraction-of-price (atr/close) instead of raw ATR. Naive
    # raw-ATR percentile rank breaks when price drifts materially across
    # the 90-bar window — e.g. BTC 60k → 70k would inflate ATR even with
    # the SAME relative volatility. Dividing by close normalizes that out.
    atr_pct = (atr14 / close).dropna()
    if len(atr_pct) < 30:
        return 0.50, 1.00
    cur = float(atr_pct.iloc[-1])
    if not (cur == cur) or cur in (float("inf"), float("-inf")):
        return 0.50, 1.00
    window = atr_pct.iloc[-90:] if len(atr_pct) >= 90 else atr_pct
    rank = float((window <= cur).sum()) / float(len(window))
    rank = max(0.0, min(1.0, rank))
    if rank < 0.20:
        mult = 0.70
    elif rank < 0.60:
        mult = 1.00
    elif rank < 0.85:
        mult = 1.30
    else:
        mult = 1.60
    if regime == "RANGE":
        mult = min(mult, 1.00)
    return rank, mult


# ─────────────────────────────────────────────────────────────────────────────
# Signal Engine v1 §4 (Phase 2.4) — Meta-label → p_loss_meta proxy.
# Spec defines p_loss_meta as the calibrated probability that this exact
# setup hits SL before TP1, sourced from a trained meta-classifier (typically
# gradient-boosted on labelled (entry, SL, TP1) triples). That model is
# not yet wired. Until then we use the cleanest available proxy:
#     p_loss_meta := 1 - direction_probability
# Rationale: direction_probability already encodes "P(price reaches TP1
# before SL within horizon)", so its complement is the natural placeholder
# for the meta-classifier output. Documented on the ScoreResponse so the
# proxy is auditable and a future trained model is a one-line swap here.
# kelly_fraction_applied is computed server-side in routes.ts (the only
# place that knows kelly_base from per-(token, direction) calibration).
# ─────────────────────────────────────────────────────────────────────────────
def compute_p_loss_meta_proxy(direction_probability: float) -> float:
    return max(0.0, min(1.0, 1.0 - float(direction_probability)))


# ─────────────────────────────────────────────────────────────────────────────
# Signal Engine v1 §5 (Phase 2.5) — Crypto microstructure features.
# Splits into:
#   §5a CVD divergence / confirm / contradict — adjusts direction_probability
#       and (when contradicting at low conviction) emits cvd_contradict gate.
#   §5b Order Book Imbalance (top-10 levels) — adjusts conviction. Treated
#       as null when the per-coin trade/book stream is stale (>30s).
#   §5c IV-RV spread — DEFERRED: Deribit IV feed not yet wired. Always
#       emits ivrv_spread = None today; field exists so the prompt can
#       carry "n/a" without schema breakage when the feed lands.
#
# For non-crypto symbols (FOREX / METAL / STOCK) the entire block is null.
# This matches the spec intent — equities/FX/metals have neither HL CVD
# nor a useful Deribit-style options vol surface from this scorer.
#
# CVD divergence detection — pragmatic approximation:
#   - cvd_slope is the cvd_z (signed deviation from rolling mean), used as
#     a directional proxy for accumulation/distribution.
#   - price_ret  is the 20-bar return.
#   - "weak" thresholds: |cvd_slope|<0.5 OR |price_ret|<0.5% → "n/a"
#     (not enough signal in either to call divergence vs noise).
#   - Per-side state matrix (LONG):
#       cvd>0 + price≥0 → confirm     (+0.03 to dir_prob)
#       cvd>0 + price<0 → bullish_div (+0.06)
#       cvd<0 + price>0 → contradict  (-0.08; cvd_contradict gate if conv<0.65)
#       cvd<0 + price≤0 → n/a         (both bearish — no useful info for LONG)
#     SHORT mirrors.
# ─────────────────────────────────────────────────────────────────────────────
def compute_microstructure(coin: str, side: Optional[str], df: pd.DataFrame,
                           base_conviction: float, asset_class: str) -> dict:
    null_block = {
        "cvd_state": "n/a", "dir_prob_delta": 0.0,
        "obi": None, "conv_delta": 0.0,
        "ivrv_spread": None, "extra_gates": [],
    }
    if asset_class in ("FOREX", "METAL", "STOCK"):
        return null_block
    if side is None:
        return null_block

    # ── 5a CVD divergence / confirm / contradict ─────────────────────────
    cvd_dq = STATE.cvd.get(coin)
    cvd_slope = 0.0
    if cvd_dq and len(cvd_dq) >= 30:
        try:
            cvd_slope = float(cvd_z(cvd_dq))
        except Exception:
            cvd_slope = 0.0
    if len(df) >= 21:
        try:
            price_ret = float(df["close"].iloc[-1] / df["close"].iloc[-21] - 1.0)
        except Exception:
            price_ret = 0.0
    else:
        price_ret = 0.0
    if not (price_ret == price_ret) or price_ret in (float("inf"), float("-inf")):
        price_ret = 0.0
    weak_cvd = abs(cvd_slope) < 0.5
    weak_pr  = abs(price_ret) < 0.005  # 0.5% over 20 bars

    cvd_state = "n/a"
    dir_prob_delta = 0.0
    extra_gates: List[str] = []
    if not (weak_cvd or weak_pr):
        if side == "long":
            if cvd_slope > 0 and price_ret >= 0:
                cvd_state, dir_prob_delta = "confirm", +0.03
            elif cvd_slope > 0 and price_ret < 0:
                cvd_state, dir_prob_delta = "bullish_div", +0.06
            elif cvd_slope < 0 and price_ret > 0:
                cvd_state, dir_prob_delta = "contradict", -0.08
                if base_conviction < 0.65:
                    extra_gates.append("cvd_contradict")
            # cvd<0 + price≤0 stays "n/a" (both bearish — not informative for LONG)
        else:  # side == "short"
            if cvd_slope < 0 and price_ret <= 0:
                cvd_state, dir_prob_delta = "confirm", +0.03
            elif cvd_slope < 0 and price_ret > 0:
                cvd_state, dir_prob_delta = "bearish_div", +0.06
            elif cvd_slope > 0 and price_ret < 0:
                cvd_state, dir_prob_delta = "contradict", -0.08
                if base_conviction < 0.65:
                    extra_gates.append("cvd_contradict")

    # ── 5b OBI — staleness-aware (>30s → null) ───────────────────────────
    # Per-coin freshness: latest CVD entry's timestamp (CVD updates with
    # every trade, so its tip mirrors live data flow for THAT coin).
    # `STATE.last_update_ts` is GLOBAL (last WS message across ALL coins)
    # — we use it as a "now" reference, never to decide per-coin freshness.
    obi_val: Optional[float] = None
    conv_delta = 0.0
    book = STATE.books.get(coin)
    fresh = False
    if cvd_dq and len(cvd_dq) > 0:
        last_ts_ms = float(cvd_dq[-1][0])
        now_ms = STATE.last_update_ts * 1000.0 if STATE.last_update_ts else last_ts_ms
        fresh = (now_ms - last_ts_ms) <= 30_000.0
    if book and fresh:
        try:
            bids, asks = parse_levels(book, 10)
            o = float(obi(bids, asks))
            if o == o and o not in (float("inf"), float("-inf")):
                obi_val = max(-1.0, min(1.0, o))
        except Exception:
            obi_val = None
    if obi_val is not None:
        # Spec §5b: ±0.20 thresholds. Direction-aligned OBI helps,
        # opposed OBI hurts (asymmetric: +0.05 / -0.10 — bigger penalty
        # for fighting the book than reward for going with it).
        if side == "long":
            if obi_val >= 0.20:
                conv_delta = +0.05
            elif obi_val <= -0.20:
                conv_delta = -0.10
        else:  # short
            if obi_val <= -0.20:
                conv_delta = +0.05
            elif obi_val >= 0.20:
                conv_delta = -0.10

    return {
        "cvd_state":      cvd_state,
        "dir_prob_delta": dir_prob_delta,
        "obi":            obi_val,
        "conv_delta":     conv_delta,
        "ivrv_spread":    None,            # §5c deferred — Deribit feed pending
        "extra_gates":    extra_gates,
    }
