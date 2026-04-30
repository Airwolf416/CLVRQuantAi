"""Real OHLCV candle adapter for assets outside the Hyperliquid WS stream.

Providers (no API key required):
- CCXT — Binance spot, Binance USDM perps, Bybit (multi-exchange fallback for crypto)
- Yahoo public chart — equities, metals, forex

Returns rows in the same format as STATE.bars: [ts_ms, o, h, l, c, v]

Module-level TTL cache (60s) keyed by (provider, ticker, interval, limit).
"""
from __future__ import annotations
import time
import asyncio
import logging
from typing import List, Optional, Tuple
import httpx
import ccxt

log = logging.getLogger("quant.external_bars")

_CACHE: dict[Tuple[str, str, str, int], Tuple[float, list]] = {}
_CACHE_TTL_S = 60.0
_INFLIGHT: dict[Tuple[str, str, str, int], asyncio.Future] = {}


# ── Symbol mapping ──────────────────────────────────────────────────────────
# CLVR canonical symbol → CCXT unified symbol "BASE/USDT"
_CCXT_OVERRIDE = {
    "kPEPE": "PEPE/USDT",  # HL uses kPEPE (×1000), exchanges quote as PEPE
    "PEPE":  "PEPE/USDT",
    "TRUMP": "TRUMP/USDT",
    "HYPE":  "HYPE/USDT",
}

# Yahoo's crypto USD pair tickers don't always follow the simple "{COIN}-USD"
# pattern — newer/colliding tokens get a numeric coin-id suffix (e.g. SUI is
# listed as "SUI20947-USD" because "SUI-USD" pre-existed for an older asset).
# Used by the CCXT-failure → Yahoo fallback path in fetch_external_bars().
_YAHOO_CRYPTO_USD_OVERRIDE = {
    "APT":   "APT21794-USD",
    "SUI":   "SUI20947-USD",
    "POL":   "POL28321-USD",
    "TAO":   "TAO22974-USD",
    "UNI":   "UNI7083-USD",
    "PEPE":  "PEPE24478-USD",
    "JUP":   "JUP29210-USD",
    "HYPE":  "HYPE32196-USD",
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


def map_to_ccxt(symbol: str) -> str:
    if symbol in _CCXT_OVERRIDE:
        return _CCXT_OVERRIDE[symbol]
    return f"{symbol.upper()}/USDT"


def map_to_yahoo(symbol: str) -> str:
    s = symbol.upper()
    if s in _YAHOO_MAP:
        return _YAHOO_MAP[s]
    if len(s) == 6 and s.isalpha():
        return f"{s}=X"
    return s


# ── Cache helpers ───────────────────────────────────────────────────────────
def _cache_get(key) -> Optional[list]:
    v = _CACHE.get(key)
    if v and (time.time() - v[0] < _CACHE_TTL_S):
        return v[1]
    return None


def _cache_put(key, rows: list):
    _CACHE[key] = (time.time(), rows)
    if len(_CACHE) > 500:
        cutoff = time.time() - _CACHE_TTL_S
        for k, (ts, _) in list(_CACHE.items()):
            if ts < cutoff:
                _CACHE.pop(k, None)


# ── CCXT exchange singletons (lazy, thread-safe enough for our use) ─────────
_CCXT_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "1d": "1d"}

_ccxt_clients: dict[str, ccxt.Exchange] = {}


def _get_ccxt(name: str) -> ccxt.Exchange:
    """Return a cached CCXT exchange instance with rate-limiting enabled.
    Order of preference for crypto: binance (spot) → binanceusdm (perps) → bybit.
    """
    if name in _ccxt_clients:
        return _ccxt_clients[name]
    cls = getattr(ccxt, name)
    inst = cls({"enableRateLimit": True, "timeout": 8000})
    _ccxt_clients[name] = inst
    log.info("ccxt: initialised %s (rateLimit=%sms)", name, inst.rateLimit)
    return inst


# Crypto provider chain — try in order, return first success.
_CRYPTO_PROVIDERS = ("binance", "binanceusdm", "bybit")


def _ccxt_fetch_sync(provider: str, unified: str, iv: str, limit: int) -> list:
    """Synchronous CCXT fetch_ohlcv. Run via asyncio.to_thread()."""
    ex = _get_ccxt(provider)
    raw = ex.fetch_ohlcv(unified, timeframe=iv, limit=min(limit, 1000))
    # CCXT format: [timestamp_ms, open, high, low, close, volume]
    return [[int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])]
            for k in raw]


async def _fetch_ccxt(symbol: str, interval: str, limit: int) -> list:
    """Fetch from preferred crypto exchanges in order until one succeeds."""
    iv = _CCXT_INTERVAL.get(interval, "1m")
    unified = map_to_ccxt(symbol)
    last_err: Optional[Exception] = None
    for provider in _CRYPTO_PROVIDERS:
        try:
            rows = await asyncio.to_thread(_ccxt_fetch_sync, provider, unified, iv, limit)
            if rows:
                return rows
        except Exception as e:
            last_err = e
            log.debug("ccxt %s/%s failed: %s", provider, unified, e)
            continue
    if last_err:
        log.warning("ccxt all providers failed for %s: %s", unified, last_err)
    return []


# ── Yahoo public chart (kept as fallback for crypto, primary for equities) ──
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
_CRYPTO_CLASSES = {
    "BTC", "ETH", "CRYPTO", "MID_CAP_DEFAULT", "MID_CAP", "PERP", "ALTCOIN",
}
_YAHOO_CLASSES = {
    "STOCK", "EQUITY", "ETF", "INDEX", "METAL", "COMMODITY", "FOREX", "FX",
}


def provider_for(asset_class: Optional[str]) -> str:
    ac = (asset_class or "").upper()
    if ac in _CRYPTO_CLASSES:
        return "ccxt"
    if ac in _YAHOO_CLASSES:
        return "yahoo"
    return "yahoo"


async def fetch_external_bars(
    symbol: str,
    asset_class: Optional[str] = None,
    interval: str = "1m",
    limit: int = 300,
) -> list:
    """Returns OHLCV rows; empty list on hard failure."""
    provider = provider_for(asset_class)
    ticker = map_to_ccxt(symbol) if provider == "ccxt" else map_to_yahoo(symbol)
    key = (provider, ticker, interval, limit)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    fut = _INFLIGHT.get(key)
    if fut is not None:
        return await fut
    fut = asyncio.get_event_loop().create_future()
    _INFLIGHT[key] = fut
    rows: list = []
    try:
        try:
            if provider == "ccxt":
                rows = await _fetch_ccxt(symbol, interval, limit)
                # Yahoo last-resort fallback for crypto if every CCXT venue failed.
                # kPEPE / kSHIB / kBONK are HL ×1000 wrappers — strip 'k' for Yahoo.
                if not rows:
                    base = symbol[1:] if (len(symbol) > 1 and symbol[0] == "k" and symbol[1].isupper()) else symbol
                    base_u = base.upper()
                    # Honour the per-coin numeric-suffix override (Yahoo lists
                    # newer tokens as e.g. "SUI20947-USD" because plain "SUI-USD"
                    # already exists for an older asset).
                    yt = _YAHOO_CRYPTO_USD_OVERRIDE.get(base_u, f"{base_u}-USD")
                    rows = await _fetch_yahoo(yt, interval, limit)
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
        if not fut.done():
            fut.set_exception(e)
        raise
    finally:
        _INFLIGHT.pop(key, None)


# ── Startup health probe ────────────────────────────────────────────────────
def health_probe() -> dict:
    """Synchronously verify each CCXT exchange is reachable. Used at boot."""
    out: dict = {}
    for name in _CRYPTO_PROVIDERS:
        try:
            ex = _get_ccxt(name)
            ex.load_markets()
            out[name] = f"ok ({len(ex.markets)} markets)"
        except Exception as e:
            out[name] = f"FAIL: {type(e).__name__}: {str(e)[:80]}"
    return out
