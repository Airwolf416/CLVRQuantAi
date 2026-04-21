import math
from .config import TARGET_ANN_VOL, KELLY_CLIP, MIN_SIGMA_ANN


def vol_target_size(equity_usd: float, sigma_daily_dec: float,
                    expected_return_dec: float, conviction: float) -> dict:
    sigma_ann = sigma_daily_dec * math.sqrt(365.0)
    sigma_ann = max(sigma_ann, MIN_SIGMA_ANN)
    vol_scale = TARGET_ANN_VOL / sigma_ann
    kelly = expected_return_dec / (sigma_ann ** 2) if sigma_ann > 0 else 0.0
    kelly = max(-KELLY_CLIP, min(KELLY_CLIP, kelly))
    size_usd = equity_usd * vol_scale * kelly * max(0.0, min(1.0, conviction))
    return {
        "sigma_ann": sigma_ann, "vol_scale": vol_scale,
        "kelly": kelly, "size_usd": size_usd,
    }
