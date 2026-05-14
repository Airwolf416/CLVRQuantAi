"""
Platt scaling + isotonic-regression fallback for recalibrating model
probabilities against observed win/loss outcomes.

Platt: P_calibrated(p) = sigmoid(a*p + b), with (a, b) fit by maximizing
binomial log-likelihood on the (p, y) calibration set. Cheap, parametric,
preserves monotonicity, robust at small N.

Isotonic: non-parametric monotone fit via the pool-adjacent-violators
algorithm. More flexible than Platt but needs more data; used as a
fallback when N is large enough to justify it (here: N >= 200).

Both are persisted to the calibrator_state table keyed by
(model_name, instrument_class). An in-process LRU cache avoids a DB
round-trip per signal.
"""
import json
import logging
import time
from dataclasses import dataclass
from typing import Optional, Dict, Tuple

import numpy as np
from scipy.optimize import minimize

from ..db import pool
from .tracker import (
    fetch_model_predictions,
    brier as _brier,
    log_loss as _log_loss,
)


log = logging.getLogger("quant.pwin.calibration")


# Threshold above which we prefer isotonic over Platt.
ISOTONIC_MIN_N = 200
# Minimum samples before fitting any calibrator at all (refuse to fit on
# noise — return identity until we have enough closed signals).
MIN_FIT_N = 30


# ── Calibrators ────────────────────────────────────────────────────────────

@dataclass
class IdentityCalibrator:
    method: str = "identity"

    def transform(self, p):
        return np.asarray(p, dtype=float)

    def to_params(self) -> dict:
        return {}

    @classmethod
    def from_params(cls, params: dict) -> "IdentityCalibrator":
        return cls()


@dataclass
class PlattCalibrator:
    a: float
    b: float
    method: str = "platt"

    def transform(self, p):
        p = np.asarray(p, dtype=float)
        # Numerically stable sigmoid: avoid overflow for large |z|.
        z = self.a * p + self.b
        # np.where avoids the warning that np.exp(large) emits.
        out = np.where(
            z >= 0,
            1.0 / (1.0 + np.exp(-z)),
            np.exp(z) / (1.0 + np.exp(z)),
        )
        return out

    def to_params(self) -> dict:
        return {"a": float(self.a), "b": float(self.b)}

    @classmethod
    def from_params(cls, params: dict) -> "PlattCalibrator":
        return cls(a=float(params["a"]), b=float(params["b"]))


@dataclass
class IsotonicCalibrator:
    """Pool-adjacent-violators isotonic regression. Stored as the (x, y)
    breakpoints of a non-decreasing step function; transform() does linear
    interpolation between consecutive points and clamps outside the range
    to the endpoint values."""
    x: np.ndarray   # sorted, ascending
    y: np.ndarray   # non-decreasing
    method: str = "isotonic"

    def transform(self, p):
        p = np.asarray(p, dtype=float)
        return np.interp(p, self.x, self.y)

    def to_params(self) -> dict:
        return {"x": self.x.tolist(), "y": self.y.tolist()}

    @classmethod
    def from_params(cls, params: dict) -> "IsotonicCalibrator":
        return cls(
            x=np.asarray(params["x"], dtype=float),
            y=np.asarray(params["y"], dtype=float),
        )


# ── Fitters ────────────────────────────────────────────────────────────────

def _fit_platt(p: np.ndarray, y: np.ndarray) -> PlattCalibrator:
    """Fit (a, b) by minimizing binomial NLL.
    Equivalent to a 1-feature logistic regression with `p` as the predictor.
    We initialize at (a=1, b=0) — the identity sigmoid in the limit of
    well-calibrated input — so the fit only moves if the data demands it.
    """
    eps = 1e-12

    def nll(theta):
        a, b = theta
        z = a * p + b
        # log(1 + exp(-|z|)) + max(-z, 0) is the stable form of -log(sigmoid(z))
        # for the y=1 term; symmetric for y=0.
        log1p_neg = np.where(
            z >= 0,
            np.log1p(np.exp(-z)),
            -z + np.log1p(np.exp(z)),
        )
        # -log(sigmoid(z)) = log1p_neg
        # -log(1 - sigmoid(z)) = log1p_neg + z
        loss = np.where(y > 0.5, log1p_neg, log1p_neg + z)
        return float(np.mean(loss) + eps)

    res = minimize(nll, x0=np.array([1.0, 0.0]), method="L-BFGS-B")
    a, b = float(res.x[0]), float(res.x[1])
    return PlattCalibrator(a=a, b=b)


def _fit_isotonic(p: np.ndarray, y: np.ndarray) -> IsotonicCalibrator:
    """Pool-adjacent-violators (PAV). Sort by p; iteratively merge any
    adjacent pair where y[i] > y[i+1] into a weighted pooled value until
    the sequence is non-decreasing. O(N) amortized via a stack.

    PRE-DEDUP: real probability data is often quantized (e.g. dual_score
    output in 0.0001 buckets), producing many ties. We collapse exact
    duplicates in p into a single weighted (sum_y, weight) point BEFORE
    PAV so the resulting breakpoints have strictly increasing x — this is
    a hard requirement for np.interp's monotonic-x contract in transform().
    Without this, interp behavior on duplicate xp is implementation-defined
    and was flagged as a correctness risk by code review."""
    order = np.argsort(p, kind="mergesort")
    xs_sorted = p[order].astype(float)
    ys_sorted = y[order].astype(float)

    # Collapse runs of equal x into one weighted point.
    uniq_x: list = []
    uniq_sum_y: list = []
    uniq_w: list = []
    i = 0
    n = len(xs_sorted)
    while i < n:
        j = i
        s_y = 0.0
        w = 0.0
        while j < n and xs_sorted[j] == xs_sorted[i]:
            s_y += float(ys_sorted[j])
            w += 1.0
            j += 1
        uniq_x.append(float(xs_sorted[i]))
        uniq_sum_y.append(s_y)
        uniq_w.append(w)
        i = j

    # Stack of (sum_y, sum_w, x). x is the unique right edge of the pool;
    # because input is now strictly increasing-x, max(x) collapses to the
    # last merged x — same correctness, simpler to reason about.
    stack: list = []
    for xi, s_y, w in zip(uniq_x, uniq_sum_y, uniq_w):
        cur_sum_y = s_y
        cur_sum_w = w
        cur_x = xi
        # Merge while previous pool's mean exceeds current's mean.
        while stack and (stack[-1][0] / stack[-1][1]) > (cur_sum_y / cur_sum_w):
            prev_sum_y, prev_sum_w, _prev_x = stack.pop()
            cur_sum_y += prev_sum_y
            cur_sum_w += prev_sum_w
            # Merged pool's x stays at the rightmost edge — current's x.
        stack.append((cur_sum_y, cur_sum_w, cur_x))

    # Materialize step function: one (x, y) point per pool. x is now
    # guaranteed strictly increasing (no duplicates) so np.interp is safe.
    pool_x = np.array([s[2] for s in stack], dtype=float)
    pool_y = np.array([s[0] / s[1] for s in stack], dtype=float)
    if pool_x[0] > 0.0:
        pool_x = np.concatenate(([0.0], pool_x))
        pool_y = np.concatenate(([pool_y[0]], pool_y))
    if pool_x[-1] < 1.0:
        pool_x = np.concatenate((pool_x, [1.0]))
        pool_y = np.concatenate((pool_y, [pool_y[-1]]))
    # Final defensive assertion: strictly increasing x is the np.interp
    # contract. Diff > 0 everywhere; if violated we have a bug worth seeing.
    if not np.all(np.diff(pool_x) > 0):
        raise RuntimeError("isotonic PAV produced non-strictly-increasing x; "
                           f"pool_x={pool_x.tolist()}")
    return IsotonicCalibrator(x=pool_x, y=pool_y)


# ── Persistence + cache ────────────────────────────────────────────────────

# (model_name, instrument_class) -> (loaded_at_ts, calibrator)
_CACHE: Dict[Tuple[str, str], Tuple[float, object]] = {}
_CACHE_TTL_S = 5 * 60   # reload from DB at most every 5 min


def _from_row(row) -> object:
    method = row["method"]
    params = row["params"]
    if isinstance(params, str):
        params = json.loads(params)
    if method == "platt":
        return PlattCalibrator.from_params(params)
    if method == "isotonic":
        return IsotonicCalibrator.from_params(params)
    return IdentityCalibrator()


async def get_calibrator(model_name: str, instrument_class: str) -> object:
    """Returns the latest fitted calibrator for (model_name, instrument_class),
    or an IdentityCalibrator if none exists yet."""
    key = (model_name, instrument_class)
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_S:
        return cached[1]

    p = await pool()
    if p is None:
        cal = IdentityCalibrator()
        _CACHE[key] = (now, cal)
        return cal

    async with p.acquire() as c:
        row = await c.fetchrow(
            """
            select method, params
              from calibrator_state
             where model_name = $1 and instrument_class = $2
            """,
            model_name, instrument_class,
        )
    cal = _from_row(row) if row else IdentityCalibrator()
    _CACHE[key] = (now, cal)
    return cal


def invalidate_calibrator_cache(
    model_name: Optional[str] = None,
    instrument_class: Optional[str] = None,
) -> None:
    if model_name is None and instrument_class is None:
        _CACHE.clear()
        return
    for k in list(_CACHE):
        if model_name and k[0] != model_name:
            continue
        if instrument_class and k[1] != instrument_class:
            continue
        _CACHE.pop(k, None)


async def fit_calibrator(
    model_name: str,
    instrument_class: str,
    method: str = "auto",
    window_days: Optional[int] = None,
) -> dict:
    """Fetch closed predictions, fit a calibrator, persist + cache it.

    Returns a dict with the fit summary (n, brier_before/after, log_loss
    before/after, method, params). On insufficient data, returns
    {ok: False, reason: 'insufficient_data', n: <count>} and does NOT
    persist anything (so the previous calibrator stays in effect).
    """
    p, y = await fetch_model_predictions(model_name, instrument_class, window_days)
    n = int(len(p))
    if n < MIN_FIT_N:
        return {
            "ok": False,
            "reason": "insufficient_data",
            "n": n,
            "min_required": MIN_FIT_N,
            "model_name": model_name,
            "instrument_class": instrument_class,
        }

    if method == "auto":
        method = "isotonic" if n >= ISOTONIC_MIN_N else "platt"
    if method == "platt":
        cal = _fit_platt(p, y)
    elif method == "isotonic":
        cal = _fit_isotonic(p, y)
    else:
        raise ValueError(f"unknown method={method!r} (want 'platt' | 'isotonic' | 'auto')")

    brier_before = _brier(p, y)
    log_loss_before = _log_loss(p, y)
    p_cal = cal.transform(p)
    brier_after = _brier(p_cal, y)
    log_loss_after = _log_loss(p_cal, y)

    pool_ = await pool()
    if pool_ is not None:
        async with pool_.acquire() as c:
            await c.execute(
                """
                insert into calibrator_state (
                    model_name, instrument_class, method, params, n_samples,
                    brier_before, brier_after, log_loss_before, log_loss_after,
                    fitted_at
                ) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, now())
                on conflict (model_name, instrument_class) do update set
                    method            = excluded.method,
                    params            = excluded.params,
                    n_samples         = excluded.n_samples,
                    brier_before      = excluded.brier_before,
                    brier_after       = excluded.brier_after,
                    log_loss_before   = excluded.log_loss_before,
                    log_loss_after    = excluded.log_loss_after,
                    fitted_at         = excluded.fitted_at
                """,
                model_name, instrument_class, cal.method,
                json.dumps(cal.to_params()), n,
                float(brier_before), float(brier_after),
                float(log_loss_before), float(log_loss_after),
            )

    invalidate_calibrator_cache(model_name, instrument_class)

    return {
        "ok": True,
        "model_name": model_name,
        "instrument_class": instrument_class,
        "method": cal.method,
        "params": cal.to_params(),
        "n": n,
        "brier_before": float(brier_before),
        "brier_after": float(brier_after),
        "log_loss_before": float(log_loss_before),
        "log_loss_after": float(log_loss_after),
        "improvement_brier": float(brier_before - brier_after),
        "improvement_log_loss": float(log_loss_before - log_loss_after),
    }
