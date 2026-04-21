"""Real OHLCV candle adapter for assets outside the Hyperliquid WS stream.

Providers (no API key required):
- Binance public REST  (`/api/v3/klines`) for any crypto
- Yahoo public chart   (`query1.finance.yahoo.com/v8/finance/chart/...`)
  for equities, metals, forex

Returns rows in the same format as STATE.bars: [ts_ms, o, h, l, c, v]

Module-level TTL cache (60s) keyed by (provider, ticker, interval, limit).
"""
from __future__ import annotations
import time
import asyncio
import logging
from typing import List, Optional, Tuple
import httpx

log = logging.getLogger("quant.external_bars")

_CACHE: dict[Tuple[str, str, str, int], Tuple[float, list]] = {}
_CACHE_TTL_S = 60.0
_INFLIGHT: dict[Tuple[str, str, str, int], asyncio.Future] = {}


# ── Symbol mapping ──────────────────────────────────────────────────────────
# CLVR canonical symbol → external provider ticker
_BINANCE_OVERRIDE = {
    "kPEPE": "PEPEUSDT",  # HL uses kPEPE (×1000), Binance uses PEPEUSDT
    "PEPE": "PEPEUSDT",
    "TRUMP": "TRUMPUSDT",
    "HYPE": "HYPEUSDT",
}

# Yahoo Finance ticker map. Equities/ETFs are usually as-is.
_YAHOO_MAP = {
    # Metals
    "GOLD": "GC=F",
    "XAU": "GC=F",
    "XAUUSD": "GC=F",
    "SILVER": "SI=F",
    "XAG": "SI=F",
    "XAGUSD": "SI=F",
    "OIL": "CL=F",
    "WTI": "CL=F",
    "BRENT": "BZ=F",
    "COPPER": "HG=F",
    # Forex (Yahoo wants =X suffix)
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "USDCAD=X",
    "USDCHF": "USDCHF=X",
    "NZDUSD": "NZDUSD=X",
    "DXY": "DX-Y.NYB",
}


def map_to_binance(symbol: str) -> str:
    if symbol in _BINANCE_OVERRIDE:
        return _BINANCE_OVERRIDE[symbol]
    return f"{symbol.upper()}USDT"


def map_to_yahoo(symbol: str) -> str:
    s = symbol.upper()
    if s in _YAHOO_MAP:
        return _YAHOO_MAP[s]
    # Forex pattern e.g. "EURGBP" → "EURGBP=X"
    if len(s) == 6 and s.isalpha():
        return f"{s}=X"
    return s  # equities/ETFs as-is


# ── Cache helpers ───────────────────────────────────────────────────────────
def _cache_get(key) -> Optional[list]:
    v = _CACHE.get(key)
    if v and (time.time() - v[0] < _CACHE_TTL_S):
        return v[1]
    return None


def _cache_put(key, rows: list):
    _CACHE[key] = (time.time(), rows)
    if len(_CACHE) > 500:
        # purge expired
        cutoff = time.time() - _CACHE_TTL_S
        for k, (ts, _) in list(_CACHE.items()):
            if ts < cutoff:
                _CACHE.pop(k, None)


# ── Binance ─────────────────────────────────────────────────────────────────
_BINANCE_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "1d": "1d"}


async def _fetch_binance(ticker: str, interval: str, limit: int) -> list:
    iv = _BINANCE_INTERVAL.get(interval, "1m")
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": ticker, "interval": iv, "limit": min(limit, 1000)}
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    # Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
    return [
        [int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])]
        for k in data
    ]


# ── Yahoo public chart ──────────────────────────────────────────────────────
_YAHOO_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m", "1d": "1d"}
_YAHOO_RANGE_FOR = {"1m": "5d", "5m": "1mo", "15m": "1mo", "1h": "3mo", "1d": "2y"}


async def _fetch_yahoo(ticker: str, interval: str, limit: int) -> list:
    iv = _YAHOO_INTERVAL.get(interval, "1m")
    rng = _YAHOO_RANGE_FOR.get(interval, "5d")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {"interval": iv, "range": rng, "includePrePost": "false"}
    headers = {"User-Agent": "Mozilla/5.0 (CLVRQuantAI)"}
    async with httpx.AsyncClient(timeout=8.0, headers=headers) as c:
        r = await c.get(url, params=params)
        r.raise_for_status()
        j = r.json()
    chart = (j.get("chart") or {}).get("result") or []
    if not chart:
        return []
    res = chart[0]
    ts_list = res.get("timestamp") or []
    quote = (res.get("indicators") or {}).get("quote") or [{}]
    q = quote[0]
    o, h, l, c, v = (q.get("open") or [], q.get("high") or [], q.get("low") or [],
                    q.get("close") or [], q.get("volume") or [])
    rows = []
    for i, t in enumerate(ts_list):
        try:
            ci = c[i]
            if ci is None:
                continue
            rows.append([
                int(t) * 1000,
                float(o[i] if o[i] is not None else ci),
                float(h[i] if h[i] is not None else ci),
                float(l[i] if l[i] is not None else ci),
                float(ci),
                float(v[i] if (v and v[i] is not None) else 0.0),
            ])
        except (IndexError, TypeError, ValueError):
            continue
    return rows[-limit:]


# ── Public API ──────────────────────────────────────────────────────────────
# Crypto-class names we'll honor as "binance" provider. Anything else
# (incl. unknown/empty) routes to Yahoo to avoid silently treating SPY
# as a crypto pair.
_CRYPTO_CLASSES = {
    "BTC", "ETH", "CRYPTO", "MID_CAP_DEFAULT", "MID_CAP", "PERP", "ALTCOIN",
}
_YAHOO_CLASSES = {
    "STOCK", "EQUITY", "ETF", "INDEX", "METAL", "COMMODITY", "FOREX", "FX",
}


def provider_for(asset_class: Optional[str]) -> str:
    ac = (asset_class or "").upper()
    if ac in _CRYPTO_CLASSES:
        return "binance"
    if ac in _YAHOO_CLASSES:
        return "yahoo"
    # Conservative default: unknown class → Yahoo (won't mis-fetch SPY as BTCUSDT)
    return "yahoo"


async def fetch_external_bars(
    symbol: str,
    asset_class: Optional[str] = None,
    interval: str = "1m",
    limit: int = 300,
) -> list:
    """Returns OHLCV rows; empty list on hard failure."""
    provider = provider_for(asset_class)
    ticker = map_to_binance(symbol) if provider == "binance" else map_to_yahoo(symbol)
    key = (provider, ticker, interval, limit)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    # collapse in-flight duplicates
    fut = _INFLIGHT.get(key)
    if fut is not None:
        return await fut
    fut = asyncio.get_event_loop().create_future()
    _INFLIGHT[key] = fut
    rows: list = []
    try:
        try:
            if provider == "binance":
                rows = await _fetch_binance(ticker, interval, limit)
            else:
                rows = await _fetch_yahoo(ticker, interval, limit)
        except Exception as e:
            log.warning("external_bars %s/%s failed: %s", provider, ticker, e)
            rows = []
        if rows:
            _cache_put(key, rows)
        if not fut.done():
            fut.set_result(rows)
        return rows
    except BaseException as e:
        # cancellation / KeyboardInterrupt — make sure waiters don't hang forever
        if not fut.done():
            fut.set_exception(e)
        raise
    finally:
        _INFLIGHT.pop(key, None)
