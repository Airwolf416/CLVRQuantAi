import numpy as np
import pandas as pd


def wilder_rma(x: pd.Series, period: int) -> pd.Series:
    x = x.astype(float)
    y = x.copy()
    y.iloc[:period - 1] = np.nan
    if len(x) >= period:
        y.iloc[period - 1] = x.iloc[:period].mean()
    return y.ewm(alpha=1.0 / period, adjust=False).mean()


def adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    pc = c.shift(1)
    ph = h.shift(1)
    pl = l.shift(1)
    tr = pd.concat([(h - l).abs(), (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    up = h - ph
    dn = pl - l
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    pdm = pd.Series(pdm, index=df.index)
    ndm = pd.Series(ndm, index=df.index)
    trs = wilder_rma(tr, period)
    pdi = 100 * wilder_rma(pdm, period) / trs.replace(0, np.nan)
    ndi = 100 * wilder_rma(ndm, period) / trs.replace(0, np.nan)
    dx = 100 * (pdi - ndi).abs() / (pdi + ndi).replace(0, np.nan)
    return wilder_rma(dx, period)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    h, l, c = df["high"], df["low"], df["close"]
    pc = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return wilder_rma(tr, period)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0)
    dn = (-d).clip(lower=0)
    ru = wilder_rma(up, period)
    rd = wilder_rma(dn, period)
    rs = ru / rd.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def bollinger_z(close: pd.Series, period: int = 20) -> pd.Series:
    mu = close.rolling(period).mean()
    sd = close.rolling(period).std(ddof=0)
    return (close - mu) / sd.replace(0, np.nan)


def hurst_rs(ts) -> float:
    ts = np.asarray(ts, dtype=float)
    N = len(ts)
    if N < 40:
        return 0.5
    sizes = np.unique(np.logspace(np.log10(8), np.log10(N // 2), 16).astype(int))
    rs = []
    for n in sizes:
        k = N // n
        if k < 1:
            continue
        vals = []
        for i in range(k):
            ch = ts[i * n:(i + 1) * n]
            y = ch - ch.mean()
            z = np.cumsum(y)
            r = z.max() - z.min()
            s = ch.std(ddof=1)
            if s > 0:
                vals.append(r / s)
        if vals:
            rs.append((n, float(np.mean(vals))))
    if len(rs) < 4:
        return 0.5
    ns, vs = zip(*rs)
    H, _ = np.polyfit(np.log(ns), np.log(vs), 1)
    return float(H)


def wick_stats(df: pd.DataFrame, n: int = 50) -> dict:
    bt = df[["open", "close"]].max(axis=1)
    bb = df[["open", "close"]].min(axis=1)
    uw = df["high"] - bt
    lw = bb - df["low"]
    return {
        "avg_upper_wick": float(uw.rolling(n).mean().iloc[-1]) if len(df) >= n else float(uw.mean()),
        "avg_lower_wick": float(lw.rolling(n).mean().iloc[-1]) if len(df) >= n else float(lw.mean()),
        "p90_upper_wick": float(uw.rolling(n).quantile(0.90).iloc[-1]) if len(df) >= n else float(uw.quantile(0.90)),
        "p90_lower_wick": float(lw.rolling(n).quantile(0.90).iloc[-1]) if len(df) >= n else float(lw.quantile(0.90)),
        "avg_total_wick": float((uw + lw).rolling(n).mean().iloc[-1]) if len(df) >= n else float((uw + lw).mean()),
    }


def ema(close: pd.Series, span: int) -> pd.Series:
    """Exponential moving average. Used by the v1 regime classifier for
    EMA20/EMA50/EMA200 trend-direction alignment."""
    return close.ewm(span=span, adjust=False).mean()


def bb_width(close: pd.Series, period: int = 20, k: float = 2.0) -> pd.Series:
    """Bollinger Band width as a fraction of the mid-band (price-normalized
    so it can be percentile-ranked across coins/assets without scale bias)."""
    mu = close.rolling(period).mean()
    sd = close.rolling(period).std(ddof=0)
    upper = mu + k * sd
    lower = mu - k * sd
    return (upper - lower) / mu.replace(0, np.nan)


def percentile_rank(series, lookback: int = 90) -> float:
    """Returns the percentile rank (0..1) of the most recent value within
    the trailing `lookback` window. Returns 0.5 when the window is too short
    to be meaningful (so ambiguous bars default to neutral, not extreme)."""
    s = pd.Series(series).dropna()
    if len(s) < max(10, lookback // 4):
        return 0.5
    window = s.tail(lookback)
    last = float(window.iloc[-1])
    n = int(len(window))
    rank = float((window <= last).sum())
    return max(0.0, min(1.0, rank / n))


def update_ofi_from_book(*args, **kwargs):
    pass
