import asyncio
import time
import logging
import pandas as pd
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from .models import ScoreRequest, ScoreResponse, CostRequest, CostResponse
from .state import STATE
from .hl_ws import ws_consumer
from .regime import classify_regime
from .scorer import compute_composite
from .garch import sigma_daily_decimal
from .sizing import vol_target_size
from .costs import total_cost_bps, ev_pass
from .sl_placement import build_sl_tp
from .db import log_quant_score

log = logging.getLogger("quant")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    task = asyncio.create_task(ws_consumer(stop), name="hl-ws")
    app.state.stop = stop
    app.state.task = task
    log.info("quant service started")
    try:
        yield
    finally:
        stop.set()
        try:
            await asyncio.wait_for(task, timeout=5)
        except Exception:
            task.cancel()


app = FastAPI(lifespan=lifespan)


def _df_from_ohlcv(ohlcv):
    df = pd.DataFrame(ohlcv, columns=["ts", "open", "high", "low", "close", "volume"])
    df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df


@app.get("/quant/health")
async def health():
    t = getattr(app.state, "task", None)
    return {"ok": True,
            "ws_alive": (t is not None and not t.done()),
            "coins": list(STATE.mids.keys()),
            "last_update_ts": STATE.last_update_ts,
            "server_ts": int(time.time() * 1000)}


@app.post("/quant/score", response_model=ScoreResponse)
async def score(req: ScoreRequest):
    if len(req.ohlcv) < 60:
        raise HTTPException(400, "need >=60 bars")
    df = _df_from_ohlcv(req.ohlcv)
    entry_ref = float(df["close"].iloc[-1])

    regime = classify_regime(df)

    ctx = STATE.asset_ctx.get(req.symbol, {})
    comp = compute_composite(req.symbol, df, ctx, req.wilson_lb, req.stocktwits_score)

    gates_failed = list(comp["gates_failed"])
    if regime == "chop":
        gates_failed.append("regime_chop")

    dr = pd.Series(req.daily_returns or [], dtype=float)
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

    await log_quant_score({
        "symbol": req.symbol, "composite_z": comp["composite_z"],
        "side": comp["side"], "regime": regime, "passes": passes,
        "gates_failed": gates_failed, "factors": comp["factors"],
    })

    return ScoreResponse(
        passes=passes, side=comp["side"], composite_z=comp["composite_z"],
        regime=regime, suggested_size_usd=sz["size_usd"],
        sl_atr_mult=sltp["sl_atr_mult"], tp_atr_mult=sltp["tp_atr_mult"],
        sl_pct=sltp["sl_pct"], sigma_ann=sz["sigma_ann"],
        gates_failed=gates_failed, factors=comp["factors"],
        sl=sltp["sl"], tp=sltp["target"],
        entry_ref=entry_ref, ts=int(time.time() * 1000),
    )


@app.post("/quant/cost", response_model=CostResponse)
async def cost(req: CostRequest):
    c = total_cost_bps(req.symbol, req.order_usd, req.adv_usd,
                       req.sigma_daily_dec, req.asset_class)
    return CostResponse(**c, ev_pass=ev_pass(req.expected_alpha_bps, c["total_bps"]))
