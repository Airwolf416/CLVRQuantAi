import math
import os
from .config import TARGET_ANN_VOL, KELLY_CLIP, MIN_SIGMA_ANN

# Absolute notional ceiling as a fraction of account equity. Permanent
# guardrail: even if an upstream sigma-unit bug ever returns, the suggested
# size can never exceed this fraction of equity. Tunable via env without a
# code change. 0.25 = at most 25% of equity notional per signal.
MAX_NOTIONAL_FRACTION = float(os.getenv("QUANT_MAX_NOTIONAL_FRACTION", "0.25"))


def vol_target_size(equity_usd: float, sigma_daily_dec: float,
                    expected_return_dec: float, conviction: float) -> dict:
    sigma_ann = sigma_daily_dec * math.sqrt(365.0)
    sigma_ann = max(sigma_ann, MIN_SIGMA_ANN)
    vol_scale = TARGET_ANN_VOL / sigma_ann
    kelly = expected_return_dec / (sigma_ann ** 2) if sigma_ann > 0 else 0.0
    kelly = max(-KELLY_CLIP, min(KELLY_CLIP, kelly))
    size_usd = equity_usd * vol_scale * kelly * max(0.0, min(1.0, conviction))

    # ── Hard notional cap (sign-preserving) ──────────────────────────────
    # |size_usd| <= equity * MAX_NOTIONAL_FRACTION. This is a safety net that
    # is independent of the sigma math: it bounds risk even under degenerate
    # inputs. copysign preserves long (+) / short (-) direction.
    cap = max(0.0, float(equity_usd)) * MAX_NOTIONAL_FRACTION
    notional_capped = abs(size_usd) > cap
    if notional_capped:
        size_usd = math.copysign(cap, size_usd)

    return {
        "sigma_ann": sigma_ann, "vol_scale": vol_scale,
        "kelly": kelly, "size_usd": size_usd,
        "notional_capped": notional_capped, "max_notional_usd": cap,
    }
