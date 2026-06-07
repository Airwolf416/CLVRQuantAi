---
name: Quant sigma units & notional cap
description: The minute-vs-day sigma unit trap in quant sizing and the hard notional guardrail that backstops it.
---

# Quant sizing: sigma units must be DAILY before annualization

`quant/sizing.py::vol_target_size` annualizes with `sqrt(365)` — it expects a
**daily** sigma. When `/quant/score` has no `daily_returns`, it falls back to
inferring sigma from intraday OHLCV.

**The bug (do not reintroduce):** feeding the raw std of 1-minute returns
straight in as `sigma_daily_dec` understates `sigma_ann` by ~`sqrt(1440)` ≈ 38x,
which inflates `vol_scale` and Kelly and pushes `suggested_size_usd` to ~2x
account equity.

**Why:** a per-minute sigma multiplied by a per-day (`sqrt(365)`) factor is a
dimensional mismatch.

**How to apply:** any intraday→sigma fallback must scale per-bar std to a true
daily sigma first — `sigma_daily = std_per_bar * sqrt(bars_per_day)`, with
`bars_per_day` derived from the ACTUAL median index delta (not assumed 1m). See
`quant/main.py::_infer_daily_sigma` (clamped to `[1e-4, 0.40]`).

**Backstop:** `MAX_NOTIONAL_FRACTION` (env `QUANT_MAX_NOTIONAL_FRACTION`,
default 0.25) hard-caps `|size_usd| <= equity*fraction` via `math.copysign`
independent of the sigma math — a permanent guardrail even if a units bug
returns.
