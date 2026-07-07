---
name: Quant scanner volume + no-momentum gates
description: Why the /api/quant scanner silently returned NEUTRAL for everything, and the durable rules that keep it healthy.
---

# Quant scanner volume + no-momentum gates

The "scanner gives no signal for everything" failure had two compounding causes,
both non-obvious from reading the code.

## Rule 1 — volumeRatio MUST use the last CLOSED bar, never the forming bar
The most recent OHLCV bar returned by EVERY feed (Hyperliquid, Binance, Yahoo) is
the **forming** bar for the current period, whose volume is 0/partial until the
period closes. Computing `volumeRatio` from it (`volumes[n-1]`) yields ≈0 on
virtually every scan.
**Why it matters:** a 0 volume ratio silently (a) makes a volume surge
undetectable — any `volSurge = (vr||1) >= 2` can never fire, which disables the
anti-chase breakout exception — and (b) auto-satisfies the "low volume" half of
the no-momentum gate, collapsing it to range-only.
**How to apply:** drop the forming bar (`volumes.slice(0, n-1)`), average the last
≤20 CLOSED bars, and use the last CLOSED bar as the numerator.

## Rule 2 — missing volume is NULL ("unknown"), not 0 ("low")
Yahoo Finance reports `volume = 0` on EVERY bar for FX and commodities (not just
the forming one). So `avgVol` is genuinely 0 for those classes.
**Why it matters:** treating that as "low volume" wrongly triggers volume-based
suppression on entire asset classes.
**How to apply:** when `avgVol <= 0`, set `volumeRatio = null`. Gates must treat
null as "fall back to range-only" — never as a surge and never as low volume.

## Rule 3 — the no-momentum range floor is PER ASSET CLASS
A flat 1.5% daily-range floor is crypto-calibrated. A big S&P name averages
~0.5%/day and FX far less, so one 1.5% bar silences calm markets.
**Why it matters:** this was the dominant reason equities/FX showed no signal.
**How to apply:** `{crypto:1.5, equity:0.8, commodity:0.8, fx:0.3}` (user-approved
Jul 2026). Normalize plural/alias class strings (equities/commodities/forex) to
the singular map keys or the lookup silently falls back to the crypto default.

## Rule 4 — a NEUTRAL is a NO-TRADE; normalize its shape at ONE chokepoint
Non-directional gates used to leave the LLM's long-shaped entry/SL/TP and a
leftover win probability attached, so a NEUTRAL looked like a high-confidence
trade with a phantom direction (this fed the "SHORT card with long levels" bug).
**How to apply:** at a single chokepoint (above persistence), for any
non-directional-and-not-SUPPRESSED result null entry/SL/TP1-3/rr, set
`win_probability=0`, `conviction_tier="D"`. Keep it separate from the SUPPRESSED
contract (SUPPRESSED nulls rr only). Also stamp a `neutral_source` on every
NEUTRAL path so you can attribute WHICH gate fired in prod.

## Dev caveat
In Replit dev you cannot observe a finite volumeRatio: crypto is geo-degraded,
the equity market is usually closed (SUPPRESSED before indicators run), and
Yahoo FX/commodity volume is always 0. Verify the finite-volume path in prod
during US market hours (Hyperliquid crypto + equities).
