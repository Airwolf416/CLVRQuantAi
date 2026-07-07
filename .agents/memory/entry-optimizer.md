---
name: Entry optimizer (better-entry limit)
description: How the "better entry" pullback limit is surfaced without touching scored/persisted levels, plus the long-only fib bug it exposed.
---

# Entry optimizer — additive better-entry limit

`server/lib/entryOptimizer.ts` (`computePullbackEntry`) proposes a PREFERRED LIMIT
pullback entry near structure (highest support below for LONG / lowest resistance
above for SHORT, within a per-asset-class fill budget `min(1×ATR, MAX_PULL_PCT%×price)`,
SL floored at 1.5×ATR, directional R:R that MUST beat the market entry's R:R or it
returns `null`). It is wired into `/api/quant` and shows up as `parsed.alt_entry`
(rendered by `SignalCard` as "★ Better Entry — Limit"). Flag `entryOptimizerMode()`
= off | shadow | on (default on); shadow attaches `alt_entry_shadow` only.

**Rule: the better entry is ADDITIVE and DISPLAY-ONLY. It is attached AFTER the
`logSignal` persist and never mutates `parsed.entry/stopLoss/tp*`.** The tracked
MARKET entry stays the one that is persisted and scored.

**Why:** the user chose "show BOTH — a limit price AND a market fallback, decide per
trade." Keeping MARKET as the persisted/scored entry means win-rate stats, the
outcome resolver, geometryGuard, and hardening are all untouched — the whole class
of "limit never filled but counted as a trade" stat corruption is avoided, and there
is no fill-tracking to build. Only surface it when the card has a finite positive
market R:R, so "better" always has a baseline.

**How to apply:** if a future change wants the optimized entry to actually change
what fires or is scored (e.g. rescue signals rejected for `RR_TOO_LOW_AFTER_FRICTION`),
that is a DIFFERENT, higher-risk feature — it must move above the persist and re-run
geometryGuard/hardening on the new levels. Do not quietly repoint persistence at
`alt_entry`.

## Long-only fib bug (fixed same task)

The `/api/quant` fib pullback levels were LONG-only: `fibConserv/fibAggr =
spikeHigh − range×{0.382,0.500}` (a dip from the high). SHORT signals were therefore
handed long-shaped "pullback" levels, guaranteeing a chase. Fix = add the mirror
`spikeLow + range×{0.382,0.500}` (a bounce toward the high) and present BOTH
direction sets in prompt SECTION 2, with a direction-aware VOID rule.

**Why:** a pullback for a SHORT is a bounce UP, not a dip DOWN — the sign flips.
**How to apply:** any retracement/entry level derived from a 24h spike range must be
computed per-direction (from the low for shorts, from the high for longs); never
reuse a single long-side formula for both.
