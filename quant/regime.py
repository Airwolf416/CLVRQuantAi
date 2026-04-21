import pandas as pd
from .indicators import adx, hurst_rs


def classify_regime(df: pd.DataFrame) -> str:
    if len(df) < 60:
        return "chop"
    a = float(adx(df, 14).iloc[-1] or 0.0)
    h = hurst_rs(df["close"].tail(150).values)
    lr = df["close"].pct_change().dropna()
    rv = float(lr.rolling(20).std().iloc[-1] or 0.0)
    rv20 = float(lr.rolling(20).std().rolling(20).mean().iloc[-1] or 0.0)
    if a > 25 and h > 0.55:
        return "trend"
    if a < 20 and h < 0.45:
        return "range"
    if rv20 > 0 and rv > 1.5 * rv20:
        return "high_vol"
    return "chop"
