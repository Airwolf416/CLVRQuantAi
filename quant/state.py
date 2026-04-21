from collections import deque, defaultdict
from typing import Dict, Deque, Tuple


class MarketState:
    def __init__(self, window: int = 4000):
        self.mids: Dict[str, float] = {}
        self.books: Dict[str, dict] = {}
        self.trades: Dict[str, Deque[Tuple[int, float, float, str]]] = defaultdict(lambda: deque(maxlen=window))
        self.cvd: Dict[str, Deque[Tuple[int, float]]] = defaultdict(lambda: deque(maxlen=window))
        self.ofi_events: Dict[str, Deque[Tuple[int, float]]] = defaultdict(lambda: deque(maxlen=window))
        self.ofi_prev: Dict[str, Tuple[float, float, float, float]] = {}
        self.asset_ctx: Dict[str, dict] = {}
        self.last_update_ts: float = 0.0
        # 1m OHLCV bars per coin: deque of [bar_ts_ms, o, h, l, c, v]
        self.bars: Dict[str, Deque[list]] = defaultdict(lambda: deque(maxlen=2000))
        # in-progress bar per coin: dict {ts, o, h, l, c, v}
        self._cur_bar: Dict[str, dict] = {}

    def snapshot(self, coin: str) -> dict:
        return {
            "coin": coin,
            "mid": self.mids.get(coin),
            "cvd_last": self.cvd[coin][-1][1] if self.cvd[coin] else 0.0,
            "n_trades": len(self.trades[coin]),
            "has_book": coin in self.books,
            "ctx": self.asset_ctx.get(coin, {}),
            "ts": self.last_update_ts,
        }


STATE = MarketState()
