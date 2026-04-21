import asyncio
import json
import logging
import random
import websockets
from .config import HL_WS_URL, DEFAULT_COINS
from .state import STATE
from .microstructure import OFITracker

log = logging.getLogger("hl_ws")
_ofi = {}


def _subs_for(coin: str):
    return [
        {"type": "l2Book", "coin": coin, "nSigFigs": None, "mantissa": None},
        {"type": "trades", "coin": coin},
        {"type": "activeAssetCtx", "coin": coin},
    ]


async def _subscribe_all(ws):
    for c in DEFAULT_COINS:
        for sub in _subs_for(c):
            await ws.send(json.dumps({"method": "subscribe", "subscription": sub}))


async def _handle(msg: dict):
    ch = msg.get("channel")
    data = msg.get("data")
    if ch == "l2Book" and isinstance(data, dict):
        coin = data.get("coin")
        if not coin:
            return
        STATE.books[coin] = data
        tracker = _ofi.setdefault(coin, OFITracker())
        tracker.on_book(data, STATE.ofi_events[coin])
        levels = data.get("levels") or [[], []]
        bids = levels[0] if len(levels) > 0 else []
        asks = levels[1] if len(levels) > 1 else []
        if bids and asks:
            best_bid = float(bids[0]["px"])
            best_ask = float(asks[0]["px"])
            STATE.mids[coin] = 0.5 * (best_bid + best_ask)
        STATE.last_update_ts = data.get("time", 0)
    elif ch == "trades" and isinstance(data, list):
        for t in data:
            coin = t.get("coin")
            if not coin:
                continue
            sz = float(t["sz"])
            px = float(t["px"])
            side = t["side"]
            ts = int(t["time"])
            STATE.trades[coin].append((ts, px, sz, side))
            signed = sz if side == "B" else -sz
            prev = STATE.cvd[coin][-1][1] if STATE.cvd[coin] else 0.0
            STATE.cvd[coin].append((ts, prev + signed))
            STATE.last_update_ts = ts
            # 1m bar aggregation
            bar_ts = (ts // 60000) * 60000
            cur = STATE._cur_bar.get(coin)
            if cur is None or cur["ts"] != bar_ts:
                if cur is not None:
                    STATE.bars[coin].append([cur["ts"], cur["o"], cur["h"], cur["l"], cur["c"], cur["v"]])
                cur = {"ts": bar_ts, "o": px, "h": px, "l": px, "c": px, "v": 0.0}
                STATE._cur_bar[coin] = cur
            cur["h"] = max(cur["h"], px)
            cur["l"] = min(cur["l"], px)
            cur["c"] = px
            cur["v"] += sz
    elif ch in ("activeAssetCtx", "activeSpotAssetCtx") and isinstance(data, dict):
        coin = data.get("coin") or (data.get("ctx", {}) or {}).get("coin")
        ctx = data.get("ctx", {})
        if coin:
            STATE.asset_ctx[coin] = ctx
    elif ch == "subscriptionResponse":
        log.info("subscribed: %s", data)
    elif ch == "error":
        log.error("ws error: %s", data)


async def ws_consumer(stop: asyncio.Event):
    backoff = 1.0
    while not stop.is_set():
        try:
            async with websockets.connect(
                HL_WS_URL, ping_interval=20, ping_timeout=20,
                close_timeout=5, max_queue=2048,
            ) as ws:
                log.info("HL WS connected")
                await _subscribe_all(ws)
                backoff = 1.0
                async for raw in ws:
                    try:
                        await _handle(json.loads(raw))
                    except Exception:
                        log.exception("handler error")
                    if stop.is_set():
                        await ws.close()
                        return
        except Exception as e:
            log.warning("WS dropped: %s; backoff %.1fs", e, backoff)
        delay = min(60.0, backoff) * (0.5 + random.random())
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
            return
        except asyncio.TimeoutError:
            pass
        backoff = min(60.0, backoff * 2)
