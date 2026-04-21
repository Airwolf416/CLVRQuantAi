import math
from .config import (FEE_BPS_TAKER, EV_COST_MULTIPLE,
                     ASSET_HALF_SPREAD_BPS, ASSET_Y_IMPACT)


def _lookup(mapping: dict, sym: str, default_key: str):
    return mapping.get(sym, mapping[default_key])


def total_cost_bps(symbol: str, order_usd: float, adv_usd: float,
                   sigma_daily_dec: float, asset_class: str = "MID_CAP_DEFAULT") -> dict:
    half_spread = _lookup(ASSET_HALF_SPREAD_BPS, symbol, asset_class)
    fee = FEE_BPS_TAKER
    Y = _lookup(ASSET_Y_IMPACT, symbol, asset_class)
    impact_bps = 0.0
    if adv_usd > 0 and order_usd > 0:
        impact_bps = Y * sigma_daily_dec * math.sqrt(order_usd / adv_usd) * 10_000.0
    total = half_spread + fee + impact_bps
    return {"half_spread_bps": half_spread, "fee_bps": fee,
            "impact_bps": impact_bps, "total_bps": total}


def ev_pass(expected_alpha_bps: float, total_bps: float) -> bool:
    return expected_alpha_bps >= EV_COST_MULTIPLE * total_bps
