import time
import math
import warnings
import numpy as np
import pandas as pd
from arch import arch_model
from .config import GARCH_MIN_OBS, GARCH_REFIT_SECS

_CACHE: dict = {}


def _fit(returns_pct: pd.Series):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        am = arch_model(returns_pct, mean="Constant", vol="GARCH",
                        p=1, o=1, q=1, dist="skewt", rescale=False)
        return am.fit(disp="off", show_warning=False)


def sigma_daily_decimal(symbol: str, daily_returns_decimal: pd.Series) -> float:
    if len(daily_returns_decimal) < GARCH_MIN_OBS:
        return float(daily_returns_decimal.std() or 0.02)
    entry = _CACHE.get(symbol)
    now = time.time()
    if entry is None or now - entry["ts"] > GARCH_REFIT_SECS:
        try:
            pct = daily_returns_decimal * 100.0
            res = _fit(pct)
            _CACHE[symbol] = {"res": res, "ts": now}
        except Exception:
            return float(daily_returns_decimal.std() or 0.02)
    res = _CACHE[symbol]["res"]
    fc = res.forecast(horizon=1, reindex=False)
    var_pct2 = float(fc.variance.values[-1, 0])
    sigma_pct = math.sqrt(max(var_pct2, 1e-12))
    return sigma_pct / 100.0
