import asyncpg
import json
import logging
from .config import DATABASE_URL


log = logging.getLogger("quant.db")

_pool = None


async def pool():
    global _pool
    if _pool is None and DATABASE_URL:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    return _pool


async def log_quant_score(row: dict):
    p = await pool()
    if p is None:
        return
    try:
        async with p.acquire() as c:
            await c.execute("""
                insert into quant_scores
                (symbol, composite_z, side, regime, passes, gates_failed, factors, ts)
                values ($1,$2,$3,$4,$5,$6,$7, now())
            """, row["symbol"], row["composite_z"], row["side"], row["regime"],
                 row["passes"], row["gates_failed"], json.dumps(row["factors"]))
    except Exception:
        pass


async def log_microstructure(row: dict):
    p = await pool()
    if p is None:
        return
    try:
        async with p.acquire() as c:
            await c.execute("""
                insert into microstructure_snapshots
                (symbol, mid, obi, wobi, cvd, cvd_z, ofi_1m, ofi_z, funding, oi, ts)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
            """, row["symbol"], row["mid"], row["obi"], row["wobi"],
                 row["cvd"], row["cvd_z"], row["ofi_1m"], row["ofi_z"],
                 row["funding"], row["oi"])
    except Exception:
        pass


# ── pwin Phase 1 — passive calibration tracker tables ────────────────────
# Idempotent CREATE IF NOT EXISTS. Called from the FastAPI lifespan so the
# tables are guaranteed to exist before any /calibration/* endpoint serves
# its first request.
#
# We intentionally do NOT use a separate migration tool (Alembic etc.) —
# matches the existing quant/ convention of raw asyncpg, and parallels the
# Node side's server/initDb.ts CREATE TABLE IF NOT EXISTS pattern that
# already manages access-code redemption tables.

_PWIN_BOOTSTRAP_SQL = """
create table if not exists prediction_log (
    id                                bigserial primary key,
    prediction_id                     text        not null unique,
    instrument                        text        not null,
    instrument_class                  text        not null,
    side                              text        not null,
    regime                            text,
    timeframe                         text,
    entry                             numeric     not null,
    tp                                numeric,
    sl                                numeric,
    hold_window_bars                  integer,
    atr_pct                           numeric,
    asof_ts                           bigint      not null,
    direction_probability             numeric,
    direction_probability_calibrated  numeric,
    p_loss_meta_proxy                 numeric,
    conviction                        numeric,
    features_snapshot                 jsonb,
    outcome                           text        not null default 'pending',
    closed_at                         timestamptz,
    exit_price                        numeric,
    pnl_pct                           numeric,
    created_at                        timestamptz not null default now(),
    updated_at                        timestamptz not null default now()
);

-- Per-spec indexes. The first one supports dashboard "show me only closed
-- signals in the last N days" queries (the common case). The second one
-- supports the regime_prior.py rolling base-rate query in Phase 2.
create index if not exists ix_predlog_closed_outcome
    on prediction_log (closed_at, outcome)
    where outcome in ('win', 'loss');

create index if not exists ix_predlog_regime_class_side
    on prediction_log (regime, instrument_class, side, closed_at);

create table if not exists calibrator_state (
    id                bigserial primary key,
    model_name        text        not null,
    instrument_class  text        not null,
    method            text        not null,
    params            jsonb       not null,
    n_samples         integer     not null,
    brier_before      numeric,
    brier_after       numeric,
    log_loss_before   numeric,
    log_loss_after    numeric,
    fitted_at         timestamptz not null default now(),
    unique (model_name, instrument_class)
);
"""


async def bootstrap_pwin_tables() -> None:
    """Create prediction_log + calibrator_state tables and indexes if absent.
    Safe to call multiple times. Logs and swallows DB unavailability so the
    quant service can still boot when DATABASE_URL is unset (degraded mode)."""
    p = await pool()
    if p is None:
        log.warning("pwin bootstrap skipped — DATABASE_URL unset; "
                    "calibration tracker disabled until DB is configured")
        return
    try:
        async with p.acquire() as c:
            await c.execute(_PWIN_BOOTSTRAP_SQL)
        log.info("pwin: prediction_log + calibrator_state tables ready")
    except Exception as e:
        log.warning("pwin bootstrap failed (calibration tracker degraded): %s", e)
