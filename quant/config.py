import os

HL_WS_URL = "wss://api.hyperliquid.xyz/ws"
HL_REST = "https://api.hyperliquid.xyz/info"

DATABASE_URL = os.getenv("DATABASE_URL")

DEFAULT_COINS = os.getenv("QUANT_COINS", "BTC,ETH,SOL,PENDLE,HYPE").split(",")

W_MOMENTUM   = 0.30
W_MEANREV    = 0.15
W_CARRY      = 0.15
W_FLOW       = 0.25
W_VOLGATE    = 0.10
W_SENTIMENT  = 0.05

Z_THRESHOLD          = 1.5
WILSON_LB_THRESHOLD  = 0.50
OFI_Z_MIN_ABS        = 0.5
NOISE_WICK_MULT      = 1.5

TARGET_ANN_VOL       = 0.15
KELLY_CLIP           = 0.25
MIN_SIGMA_ANN        = 0.02

FEE_BPS_TAKER        = 4.5
EV_COST_MULTIPLE     = 2.0
ASSET_HALF_SPREAD_BPS = {
    "BTC": 1.0, "ETH": 1.0,
    "SOL": 2.0, "HYPE": 3.0,
    "PENDLE": 5.0, "MID_CAP_DEFAULT": 5.0,
    "SMALL_CAP_DEFAULT": 10.0,
}
ASSET_Y_IMPACT = {
    "BTC": 0.3, "ETH": 0.3, "SOL": 0.6,
    "HYPE": 0.8, "PENDLE": 1.0,
    "MID_CAP_DEFAULT": 1.0, "SMALL_CAP_DEFAULT": 1.5,
}

MIN_SL_PCT_BTCETH  = 0.008
MIN_SL_PCT_MIDCAP  = 0.020
MIN_RR             = 1.5

GARCH_MIN_OBS      = 500
GARCH_REFIT_SECS   = 7*24*3600
