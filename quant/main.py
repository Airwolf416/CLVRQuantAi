import asyncio
import math
import time
import logging
from collections import deque
import pandas as pd
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from .models import ScoreRequest, ScoreResponse, CostRequest, CostResponse
from .state import STATE
from .hl_ws import ws_consumer
from .regime import classify_regime, regime_allows
from .scorer import (
    compute_composite, compute_dual_score, dual_score_thresholds_for,
    compute_vol_adjusted_rr, compute_p_loss_meta_proxy, compute_microstructure,
)
from .garch import sigma_daily_decimal
from .sizing import vol_target_size
from .costs import total_cost_bps, ev_pass
from .sl_placement import build_sl_tp
from .db import log_quant_score
from .external_bars import fetch_external_bars, provider_for, health_probe
from .config import DEFAULT_COINS

log = logging.getLogger("quant")
logging.basicConfig(level=logging.INFO)


# Number of historical 1m bars to prefill on startup. Comfortably above the
# 120-bar readiness threshold in /quant/readiness so the scanner is READY
# immediately instead of waiting ~2h for the HL websocket to accumulate enough
# bars after every restart/redeploy.
_BACKFILL_BARS = 200


async def _backfill_bars_for(coin: str) -> bool:
    """Seed STATE.bars[coin] from the external provider. We pass
    asset_class="CRYPTO" — not the coin symbol — so the call routes
    through provider_for() into the CCXT chain (binance → binanceusdm →
    bybit) and, on geo-restricted environments where CCXT fails, falls
    back to Yahoo with the proper "{COIN}-USD" crypto ticker rather than
    a bare symbol (which would hit unrelated equities listings).
    Safe to run concurrently with the HL WS consumer: we only seed when
    the in-memory deque is still effectively empty, and we drop any
    bar whose minute-open timestamp is the *current* wall-clock minute,
    so the WS consumer's first complete bar lands cleanly without a
    duplicate timestamp.

    NOTE: kPEPE is intentionally skipped. HL trades it as kPEPE = PEPE×1000,
    so the WS feed delivers prices in HL coordinates (~$0.011), while the
    external providers (Binance PEPE/USDT, Yahoo PEPE-USD) return PEPE
    coordinates (~$0.0000115). Mixing the two scales in the same deque
    would corrupt every indicator. Let kPEPE accumulate via WS only."""
    if coin == "kPEPE":
        return False
    try:
        rows = await fetch_external_bars(coin, "CRYPTO", "1m", _BACKFILL_BARS)
        if not rows or len(rows) < 60:
            return False
        # Strip any bar whose 1m-open timestamp matches the current minute
        # (that's the in-progress candle). Yahoo/CCXT always return
        # minute-aligned timestamps so a modulo check is useless here.
        cur_min_ms = (int(time.time() * 1000) // 60000) * 60000
        while rows and int(rows[-1][0]) >= cur_min_ms:
            rows = rows[:-1]
        if len(rows) < 60:
            return False
        existing = STATE.bars.get(coin)
        if existing is not None and len(existing) >= 60:
            return False  # WS got there first — don't clobber live data
        STATE.bars[coin] = deque(rows, maxlen=2000)
        return True
    except Exception as e:
        log.warning("quant: backfill %s failed: %s", coin, e)
        return False


async def _run_backfill():
    """Background task: fetch ~200 bars per coin in small concurrent batches
    and seed STATE.bars so /quant/readiness flips to READY within ~30s of
    startup instead of after the ~2h soak the HL WS feed alone would need.
    Uses a small concurrency window because firing all 32 calls at once
    trips Binance's burst limits and most calls return empty."""
    BATCH_SIZE = 4  # Binance is happy with ~5 req/s for fetch_ohlcv
    BATCH_GAP_S = 0.6
    seeded = 0
    coins = list(DEFAULT_COINS)
    for i in range(0, len(coins), BATCH_SIZE):
        batch = coins[i : i + BATCH_SIZE]
        results = await asyncio.gather(
            *[_backfill_bars_for(c) for c in batch],
            return_exceptions=True,
        )
        seeded += sum(1 for r in results if r is True)
        if i + BATCH_SIZE < len(coins):
            await asyncio.sleep(BATCH_GAP_S)
    log.info(
        "quant: bar backfill complete — %d/%d coins seeded with up to %d 1m bars",
        seeded, len(coins), _BACKFILL_BARS,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    task = asyncio.create_task(ws_consumer(stop), name="hl-ws")
    app.state.stop = stop
    app.state.task = task
    # ── Boot-time health log: which CCXT exchanges are reachable. This
    # MUST run before the backfill task is started — health_probe calls
    # ex.load_markets() on each exchange, and if backfill threads try to
    # call fetch_ohlcv on the same instance concurrently they'll race
    # each other into a half-loaded state and most fetches return empty.
    try:
        probe = await asyncio.to_thread(health_probe)
        log.info("┌─ quant: live data sources ─────────────────────────")
        log.info("│ Hyperliquid WS         : starting (HL info API)")
        for name, status in probe.items():
            log.info("│ ccxt.%-16s: %s", name, status)
        log.info("│ Yahoo Finance fallback : enabled (no key)")
        log.info("└────────────────────────────────────────────────────")
    except Exception as e:
        log.warning("quant: ccxt health probe failed: %s", e)
    # ── Warm-start: fire bar backfill in background so readiness doesn't
    # block the scanner for ~2h after every restart. Non-blocking — the
    # service is already up and the backfill resolves in ~30s.
    backfill_task = asyncio.create_task(_run_backfill(), name="bar-backfill")
    app.state.backfill_task = backfill_task
    log.info("quant service started")
    try:
        yield
    finally:
        stop.set()
        try:
            await asyncio.wait_for(task, timeout=5)
        except Exception:
            task.cancel()
        # Best-effort cancel of the backfill task if shutdown beats it.
        if not backfill_task.done():
            backfill_task.cancel()


app = FastAPI(lifespan=lifespan)


def _df_from_ohlcv(ohlcv):
    df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
    df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


@app.get("/quant/health")
async def health():
    """Bulletproof health endpoint for Railway/k8s probes.
    No DB calls, no network calls — just confirms the FastAPI process is up.
    Always returns HTTP 200 with {status: "ok"}. For richer state use /quant/ready."""
    return {"status": "ok"}


@app.get("/quant/ready")
async def ready():
    """Strict readiness: requires WS task alive. Use for orchestration, not basic liveness."""
    t = getattr(app.state, "task", None)
    ws_alive = t is not None and not t.done()
    body = {
        "ok": ws_alive,
        "ws_alive": ws_alive,
        "coins": list(STATE.mids.keys()),
        "last_update_ts": STATE.last_update_ts,
        "server_ts": int(time.time() * 1000),
    }
    if not ws_alive:
        raise HTTPException(503, detail=body)
    return body


@app.get("/quant/bars/{coin}")
async def bars(coin: str, limit: int = 300):
    rows = list(STATE.bars.get(coin, []))[-limit:]
    cur = STATE._cur_bar.get(coin)
    if cur is not None:
        rows = rows + [[cur["ts"], cur["o"], cur["h"], cur["l"], cur["c"], cur["v"]]]
    return {"coin": coin, "bars": rows, "n": len(rows)}


@app.get("/quant/external_bars/{symbol}")
async def external_bars(symbol: str, asset_class: str = "BTC", interval: str = "1m", limit: int = 300):
    rows = await fetch_external_bars(symbol, asset_class, interval, limit)
    return {"symbol": symbol, "provider": provider_for(asset_class), "interval": interval, "bars": rows, "n": len(rows)}


@app.get("/quant/readiness")
async def readiness():
    """Soak-time guard: report whether internal HL bar history is deep enough
    to safely flip PHASE2A_ENABLED=1 in production. The recommendation is
    advisory only — Express still owns the gate.

    Thresholds:
      - per-coin: >=120 bars (~2 hours of 1m bars)
      - coverage: >=80% of DEFAULT_COINS meet the per-coin threshold
    """
    per_coin = {}
    ready_count = 0
    PER_COIN_MIN = 120
    for coin in DEFAULT_COINS:
        n = len(STATE.bars.get(coin, []))
        per_coin[coin] = n
        if n >= PER_COIN_MIN:
            ready_count += 1
    coverage = ready_count / max(len(DEFAULT_COINS), 1)
    is_ready = coverage >= 0.8
    return {
        "ready": is_ready,
        "recommendation": "READY" if is_ready else "SOAK",
        "coverage_pct": round(coverage * 100, 1),
        "coins_ready": ready_count,
        "coins_total": len(DEFAULT_COINS),
        "per_coin_threshold_bars": PER_COIN_MIN,
        "per_coin_bars": per_coin,
        "ws_alive": (getattr(app.state, "task", None) is not None and not app.state.task.done()),
        "ts": int(time.time() * 1000),
    }


@app.post("/quant/score", response_model=ScoreResponse)
async def score(req: ScoreRequest):
    ohlcv = req.ohlcv
    if not ohlcv or len(ohlcv) < 60:
        # 1) Internal HL bars (best quality — real trades)
        internal = list(STATE.bars.get(req.symbol, []))
        cur = STATE._cur_bar.get(req.symbol)
        if cur is not None:
            internal = internal + [[cur["ts"], cur["o"], cur["h"], cur["l"], cur["c"], cur["v"]]]
        if len(internal) >= 60:
            ohlcv = internal
        else:
            # 2) External provider fallback (Binance for crypto, Yahoo for stocks/metals/fx)
            external = await fetch_external_bars(req.symbol, req.asset_class, "1m", 300)
            if len(external) >= 60:
                ohlcv = external
            else:
                raise HTTPException(
                    400,
                    f"need >=60 bars (caller={len(req.ohlcv or [])}, internal={len(internal)}, external={len(external)})",
                )
    df = _df_from_ohlcv(ohlcv)
    entry_ref = float(df["close"].iloc[-1])

    regime = classify_regime(df)

    ctx = STATE.asset_ctx.get(req.symbol, {})
    comp = compute_composite(req.symbol, df, ctx, req.wilson_lb, req.stocktwits_score)

    gates_failed = list(comp["gates_failed"])

    # Signal Engine v1 §1: regime gate. classify_regime now returns one of
    # TREND_UP / TREND_DOWN / RANGE / HIGH_VOL / CHOP (uppercase). regime_allows
    # checks the candidate signal_type vs the current regime's allowed-types
    # matrix and emits regime_chop / regime_mismatch when blocked.
    signal_type = comp.get("signal_type", "momentum")
    allowed, regime_reason = regime_allows(regime, comp["side"], signal_type)
    if not allowed and regime_reason and regime_reason not in gates_failed:
        gates_failed.append(regime_reason)

    # Signal Engine v1 §2: Dual Score (direction_probability + conviction).
    # Computed AFTER regime gate so regime_fit is populated, but BEFORE the
    # R:R / noise gates so those don't double-count (alignment already
    # captures conflict). Threshold lookup is per-asset-class — alts get a
    # higher bar (per spec §2 footnote re: fee/slippage drag). Replaces
    # the legacy `z_threshold` single-knob gate (removed from compute_composite)
    # with finer, asset-aware bounds. `below_thresholds` is now produced by
    # ONE source only — no double-mapping ambiguity in gates_failed.
    dual = compute_dual_score(comp, gates_failed, allowed, len(df))
    direction_probability = dual["direction_probability"]
    conviction_score = dual["conviction"]

    # Signal Engine v1 §5 (Phase 2.5): Microstructure adjustments — applied
    # AFTER the base dual score and BEFORE the per-asset-class threshold
    # check, so the threshold gate sees the microstructure-adjusted
    # direction_probability + conviction (matching spec integration order).
    # Crypto only — non-crypto returns the null block and contributes
    # nothing. Bounds match compute_dual_score: dir_prob ∈ [0.50, 0.85];
    # conviction ∈ [0.40, 0.95]. Any gate names returned (e.g.
    # cvd_contradict) are pushed BEFORE the threshold check so the
    # _REASON_PRIORITY ordering still picks the most specific reason.
    micro = compute_microstructure(req.symbol, comp["side"], df,
                                   conviction_score, req.asset_class)
    direction_probability = max(0.50, min(0.85, direction_probability + float(micro["dir_prob_delta"])))
    conviction_score      = max(0.40, min(0.95, conviction_score      + float(micro["conv_delta"])))
    for _g in micro.get("extra_gates", []) or []:
        if _g not in gates_failed:
            gates_failed.append(_g)

    dp_min, cv_min = dual_score_thresholds_for(req.asset_class)
    if (direction_probability < dp_min or conviction_score < cv_min) \
            and "below_thresholds" not in gates_failed:
        gates_failed.append("below_thresholds")

    dr = pd.Series(req.daily_returns or [], dtype=float)
    req.ohlcv = ohlcv  # so downstream code uses fallback path
    sigma_d = sigma_daily_decimal(req.symbol, dr) if len(dr) > 0 else float(df["close"].pct_change().std() or 0.02)

    side = comp["side"] or "long"
    sltp = build_sl_tp(req.symbol, side, entry_ref, df, planned_rr=req.planned_rr)
    if not sltp["viable"]:
        gates_failed.append("rr_not_viable")
    p90_wick = sltp["p90_wick"]
    if p90_wick > 0 and (sltp["sl_pct"] * entry_ref) < 1.5 * p90_wick:
        gates_failed.append("noise_band")

    exp_ret = float(comp["composite_z"]) * sigma_d
    sz = vol_target_size(req.equity_usd, sigma_d, exp_ret, req.conviction)

    passes = len(gates_failed) == 0 and comp["side"] is not None

    # Map the first failing gate to the canonical NO_SIGNAL reason code
    # (matches server/prompts/shared.ts NO_TRADE_REASONS). Priority order
    # mirrors the Signal Engine v1 integration order: regime first, then
    # below_thresholds, then liquidity / wilson / micro, then R:R sanity.
    # Phase 2.2 (post-architect-review): the legacy `z_threshold` gate is
    # gone — compute_composite no longer emits it; the per-asset-class
    # dual-score gate above is the sole source of `below_thresholds`.
    _REASON_PRIORITY = [
        "regime_chop", "regime_mismatch", "below_thresholds",
        "wilson_lb", "cvd_contradict", "ivrv_block", "ofi_sign",
        "rr_not_viable", "noise_band",
    ]
    no_signal_reason = None
    for r in _REASON_PRIORITY:
        if r in gates_failed:
            no_signal_reason = r
            break
    if no_signal_reason is None and gates_failed:
        no_signal_reason = gates_failed[0]

    await log_quant_score({
        "symbol": req.symbol, "composite_z": comp["composite_z"],
        "side": comp["side"], "regime": regime, "passes": passes,
        "gates_failed": gates_failed, "factors": comp["factors"],
    })

    # Phase 2.1 fix: NaN/Inf in any numeric field would crash JSON encoding
    # at the FastAPI response layer ("Out of range float values are not JSON
    # compliant"). Degenerate input (all-flat synthetic bars, zero-vol price
    # series) historically reached the response with NaN sigma / sl / size
    # and produced HTTP 500. Sanitize once at the boundary so the client
    # always sees a well-formed envelope (degenerate trades show as 0/0/0
    # and naturally fail downstream gates rather than returning 500).
    def _f(x, default=0.0):
        try:
            v = float(x)
        except (TypeError, ValueError):
            return default
        return v if math.isfinite(v) else default

    safe_factors = {k: _f(v, 0.0) for k, v in comp["factors"].items()}

    # Signal Engine v1 §3 / §4 — vol-adjusted R:R + meta-label proxy.
    # Computed at the response boundary (no gate dependency, pure emit).
    vol_percentile, rr_multiplier = compute_vol_adjusted_rr(df, regime)
    p_loss_meta = compute_p_loss_meta_proxy(direction_probability)

    # Microstructure block matches the TradePlan microstructure schema:
    # {cvd_state, obi, ivrv_spread}. Extra fields used internally by the
    # scorer (dir_prob_delta, conv_delta, extra_gates) are NOT emitted —
    # the deltas are already folded into direction_probability/conviction
    # above and the gates into gates_failed.
    micro_out = {
        "cvd_state":   micro["cvd_state"],
        "obi":         (None if micro["obi"]         is None else _f(micro["obi"])),
        "ivrv_spread": (None if micro["ivrv_spread"] is None else _f(micro["ivrv_spread"])),
    }

    return ScoreResponse(
        passes=passes, side=comp["side"], composite_z=_f(comp["composite_z"]),
        regime=regime, suggested_size_usd=_f(sz["size_usd"]),
        sl_atr_mult=_f(sltp["sl_atr_mult"]), tp_atr_mult=_f(sltp["tp_atr_mult"]),
        sl_pct=_f(sltp["sl_pct"]), sigma_ann=_f(sz["sigma_ann"]),
        gates_failed=gates_failed, factors=safe_factors,
        sl=_f(sltp["sl"]), tp=_f(sltp["target"]),
        entry_ref=_f(entry_ref), ts=int(time.time() * 1000),
        signal_type=signal_type,
        no_signal_reason=no_signal_reason,
        direction_probability=_f(direction_probability),
        conviction=_f(conviction_score),
        vol_percentile=_f(vol_percentile),
        rr_multiplier=_f(rr_multiplier),
        p_loss_meta=_f(p_loss_meta),
        microstructure=micro_out,
    )


@app.post("/quant/cost", response_model=CostResponse)
async def cost(req: CostRequest):
    c = total_cost_bps(req.symbol, req.order_usd, req.adv_usd,
                       req.sigma_daily_dec, req.asset_class)
    return CostResponse(**c, ev_pass=ev_pass(req.expected_alpha_bps, c["total_bps"]))
