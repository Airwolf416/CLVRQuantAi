"""
Passive prediction tracker — logs a row to prediction_log on every signal
emission and updates it when the outcome resolves. Computes Brier score,
log loss, and reliability-diagram bins per (model_name, instrument_class).

Phase 1 invariant: this module ONLY observes. It never mutates scorer
output, prompts, or sizing.

Outcome semantics:
    pending → not yet resolved
    win     → TP hit before SL within hold window (or kill-clock expired green)
    loss    → SL hit, or kill-clock expired red

The Node-side outcome resolver maps its richer enum (TP1_HIT, TP2_HIT, …,
SL_HIT, EXPIRED_WIN, EXPIRED_LOSS) into win/loss/pending before POSTing
to /calibration/resolve, so this module always sees the simple form.
"""
import json
import logging
from typing import Optional, Tuple, List, Dict

import numpy as np

from ..db import pool


log = logging.getLogger("quant.pwin.tracker")


# ── Logging ────────────────────────────────────────────────────────────────

async def log_prediction(
    *,
    prediction_id: str,
    instrument: str,
    instrument_class: str,
    side: str,
    regime: Optional[str],
    timeframe: Optional[str],
    entry: float,
    tp: Optional[float],
    sl: Optional[float],
    hold_window_bars: Optional[int],
    atr_pct: Optional[float],
    asof_ts: int,
    direction_probability: Optional[float],
    direction_probability_calibrated: Optional[float],
    p_loss_meta_proxy: Optional[float],
    conviction: Optional[float],
    features_snapshot: Optional[dict],
) -> bool:
    """Insert a pending prediction row. Idempotent on prediction_id (ON CONFLICT
    DO NOTHING) so a retried Node-side hook can't double-log."""
    p = await pool()
    if p is None:
        return False
    try:
        async with p.acquire() as c:
            await c.execute(
                """
                insert into prediction_log (
                    prediction_id, instrument, instrument_class, side,
                    regime, timeframe, entry, tp, sl, hold_window_bars,
                    atr_pct, asof_ts,
                    direction_probability, direction_probability_calibrated,
                    p_loss_meta_proxy, conviction,
                    features_snapshot, outcome
                ) values (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9, $10,
                    $11, $12,
                    $13, $14,
                    $15, $16,
                    $17::jsonb, 'pending'
                )
                on conflict (prediction_id) do nothing
                """,
                prediction_id, instrument, instrument_class, side,
                regime, timeframe, entry, tp, sl, hold_window_bars,
                atr_pct, asof_ts,
                direction_probability, direction_probability_calibrated,
                p_loss_meta_proxy, conviction,
                json.dumps(features_snapshot or {}),
            )
        return True
    except Exception as e:
        log.warning("log_prediction failed for %s: %s", prediction_id, e)
        return False


async def resolve_prediction(
    *,
    prediction_id: str,
    outcome: str,                # 'win' | 'loss' | 'void'
    exit_price: Optional[float] = None,
    pnl_pct: Optional[float] = None,
) -> bool:
    """Update the row's outcome. Compare-and-set on outcome='pending' so a
    duplicate resolve POST can't overwrite a settled row."""
    if outcome not in ("win", "loss", "void"):
        log.warning("resolve_prediction rejected invalid outcome=%r for id=%s",
                    outcome, prediction_id)
        return False
    p = await pool()
    if p is None:
        return False
    try:
        async with p.acquire() as c:
            row = await c.fetchrow(
                """
                update prediction_log
                   set outcome = $2,
                       exit_price = $3,
                       pnl_pct = $4,
                       closed_at = now(),
                       updated_at = now()
                 where prediction_id = $1
                   and outcome = 'pending'
             returning prediction_id
                """,
                prediction_id, outcome, exit_price, pnl_pct,
            )
        return row is not None
    except Exception as e:
        log.warning("resolve_prediction failed for %s: %s", prediction_id, e)
        return False


# ── Fetch ─────────────────────────────────────────────────────────────────

# Map a model_name to (column_name, y_inversion_flag).
# y_inversion=True means the column is P(loss), so the binary target is
# (outcome == 'loss') instead of (outcome == 'win'). Lets us track Brier
# for p_loss_meta_proxy on its own scale.
_MODEL_COLUMN: Dict[str, Tuple[str, bool]] = {
    "direction_probability":           ("direction_probability",            False),
    "direction_probability_calibrated":("direction_probability_calibrated", False),
    "p_loss_meta_proxy":               ("p_loss_meta_proxy",                True),
}


def model_columns() -> List[str]:
    return list(_MODEL_COLUMN.keys())


async def fetch_model_predictions(
    model_name: str,
    instrument_class: Optional[str] = None,
    window_days: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """Returns (p, y) numpy float arrays for closed signals.

    - p comes from the column mapped by model_name; rows where it is NULL
      are excluded.
    - y is 1 for the 'positive' class (win for P(win) models, loss for
      P(loss) models) and 0 otherwise.
    - instrument_class filters by class when provided.
    - window_days limits to closed_at >= now() - N days when provided.
    """
    if model_name not in _MODEL_COLUMN:
        raise ValueError(f"unknown model_name={model_name!r}; "
                         f"valid: {list(_MODEL_COLUMN)}")
    col, invert = _MODEL_COLUMN[model_name]

    p = await pool()
    if p is None:
        return np.array([], dtype=float), np.array([], dtype=float)

    where = [f"{col} is not null", "outcome in ('win', 'loss')"]
    args: list = []
    if instrument_class:
        args.append(instrument_class)
        where.append(f"instrument_class = ${len(args)}")
    if window_days is not None and window_days > 0:
        args.append(window_days)
        where.append(f"closed_at >= now() - (${len(args)}::int || ' days')::interval")

    sql = (
        f"select {col} as p, outcome from prediction_log "
        f"where {' and '.join(where)}"
    )
    async with p.acquire() as c:
        rows = await c.fetch(sql, *args)

    if not rows:
        return np.array([], dtype=float), np.array([], dtype=float)

    p_arr = np.asarray([float(r["p"]) for r in rows], dtype=float)
    target_outcome = "loss" if invert else "win"
    y_arr = np.asarray([1.0 if r["outcome"] == target_outcome else 0.0
                        for r in rows], dtype=float)
    return p_arr, y_arr


# ── Metrics ───────────────────────────────────────────────────────────────

def brier(p: np.ndarray, y: np.ndarray) -> float:
    """Mean squared error between probability and binary outcome.
    Lower is better; perfect calibration + perfect discrimination = 0.
    A constant predictor of base-rate gives brier = base_rate*(1-base_rate)."""
    if len(p) == 0:
        return float("nan")
    return float(np.mean((p - y) ** 2))


def log_loss(p: np.ndarray, y: np.ndarray, eps: float = 1e-12) -> float:
    """Binary cross-entropy. Lower is better; penalizes confident wrong calls."""
    if len(p) == 0:
        return float("nan")
    pc = np.clip(p, eps, 1.0 - eps)
    return float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)))


def reliability_bins(
    p: np.ndarray,
    y: np.ndarray,
    n_bins: int = 10,
) -> List[Dict[str, float]]:
    """Equal-width binning of [0,1] for a reliability diagram.
    Returns one entry per non-empty bin: {bin_lo, bin_hi, p_avg, y_avg, count}.
    Perfect calibration → p_avg ≈ y_avg in every bin."""
    if len(p) == 0:
        return []
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    out: List[Dict[str, float]] = []
    for i in range(n_bins):
        lo, hi = float(edges[i]), float(edges[i + 1])
        # Right-open everywhere, but include 1.0 in the final bin.
        if i == n_bins - 1:
            mask = (p >= lo) & (p <= hi)
        else:
            mask = (p >= lo) & (p < hi)
        cnt = int(mask.sum())
        if cnt == 0:
            continue
        out.append({
            "bin_lo": lo,
            "bin_hi": hi,
            "p_avg": float(p[mask].mean()),
            "y_avg": float(y[mask].mean()),
            "count": cnt,
        })
    return out
