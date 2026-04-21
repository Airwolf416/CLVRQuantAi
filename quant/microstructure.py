import math
from collections import deque
from statistics import fmean, pstdev


def parse_levels(book: dict, N: int = 10):
    bids = book["levels"][0][:N]
    asks = book["levels"][1][:N]
    bids = [(float(l["px"]), float(l["sz"])) for l in bids]
    asks = [(float(l["px"]), float(l["sz"])) for l in asks]
    return bids, asks


def obi(bids, asks):
    bv = sum(s for _, s in bids)
    av = sum(s for _, s in asks)
    return (bv - av) / (bv + av) if (bv + av) > 0 else 0.0


def wobi(bids, asks, kappa: float = 10.0):
    if not bids or not asks:
        return 0.0
    mid = 0.5 * (bids[0][0] + asks[0][0])
    num = den = 0.0
    for px, sz in bids:
        w = math.exp(-kappa * (mid - px) / mid)
        num += w * sz
        den += w * sz
    for px, sz in asks:
        w = math.exp(-kappa * (px - mid) / mid)
        num -= w * sz
        den += w * sz
    return num / den if den > 0 else 0.0


def cvd_z(cvd_series: deque, lookback: int = 3600_000):
    if not cvd_series:
        return 0.0
    now = cvd_series[-1][0]
    vals = [c for (ts, c) in cvd_series if now - ts <= lookback]
    if len(vals) < 30:
        return 0.0
    mu = fmean(vals)
    sd = pstdev(vals)
    return (cvd_series[-1][1] - mu) / sd if sd > 0 else 0.0


class OFITracker:
    def __init__(self):
        self.pbp = self.pbs = self.pap = self.pas = None

    def on_book(self, book: dict, out_deque: deque):
        bids = book["levels"][0]
        asks = book["levels"][1]
        if not bids or not asks:
            return
        bp, bs = float(bids[0]["px"]), float(bids[0]["sz"])
        ap, as_ = float(asks[0]["px"]), float(asks[0]["sz"])
        if self.pbp is None:
            self.pbp, self.pbs, self.pap, self.pas = bp, bs, ap, as_
            return
        if bp > self.pbp:
            eB = bs
        elif bp == self.pbp:
            eB = bs - self.pbs
        else:
            eB = -self.pbs
        if ap < self.pap:
            eA = as_
        elif ap == self.pap:
            eA = as_ - self.pas
        else:
            eA = -self.pas
        e_n = eB - eA
        ts = book.get("time", 0)
        out_deque.append((ts, e_n))
        self.pbp, self.pbs, self.pap, self.pas = bp, bs, ap, as_


def ofi_z(ofi_events: deque, window_ms: int = 60_000):
    if not ofi_events:
        return 0.0, 0.0
    now = ofi_events[-1][0]
    vals = [e for (ts, e) in ofi_events if now - ts <= window_ms]
    if len(vals) < 10:
        return 0.0, 0.0
    s = sum(vals)
    mu = fmean(vals)
    sd = pstdev(vals)
    z = (vals[-1] - mu) / sd if sd > 0 else 0.0
    return s, z
