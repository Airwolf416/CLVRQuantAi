---
name: FMP/Nasdaq earnings data-tier limits
description: Why earnings tabs (Reported/IPO/Radar) show up empty and what each data source can actually return on the free tier
---

# Earnings data-source limits (FMP free tier + Nasdaq)

When earnings tabs render empty (Reported / IPO / AI Radar / Reaction), the cause is
almost always a data-source limit, NOT a missing key or a Railway-only bug. Verified
by hitting FMP directly with the live key:

- `/stable/earnings-calendar` works but returns **forecasts only — `epsActual` is
  always null**. Nasdaq's calendar (`api.nasdaq.com/api/calendar/earnings`) likewise
  gives only EPS forecast.
- **Actuals only exist on the per-symbol** `/stable/earnings?symbol=X` endpoint
  (free-tier accessible). Past-quarter actuals are immutable → safe to cache for hours.
- `/stable/ipos-calendar` → **403 "Restricted Endpoint"** on free tier. The free
  replacement is **Nasdaq's public IPO calendar** (no key):
  `https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM` (monthly) → `data.priced.rows`
  (already-listed, real price) + `data.upcoming` (scheduled) + `data.filed`. Same
  browser-UA/Referer trick as the Nasdaq earnings endpoint. Show priced+upcoming over a
  recent+forward window (e.g. today-14..today+30) so the tab is never empty.
- `/api/v3/*` legacy endpoints are dead ("Legacy Endpoint ... no longer supported").

**Rule:** any UI that keys on `epsActual` (the "Reported" earnings tab) must enrich the
calendar feed with per-symbol history — the calendar alone will never satisfy it.

**Why:** spent multiple turns wrongly attributing empty Reported earnings to a missing
Railway `FMP_API_KEY`; the real cause was the calendar feed never carrying actuals, so
it was empty in dev too.

**AI Radar (earnings_cache) "always empty" trap:** the daily scan that populates the
cache must look ahead **as far as the radar displays** (30d), and must use the **merged
FMP+Nasdaq** calendar — not FMP-only. A short 5-day scan window or FMP-only universe
matches ~0 watchlist names on most days, so nothing gets cached. Features still need
FMP per-symbol history, so a Nasdaq-only scan produces no verdicts (keep the FMP-key
gate on the scheduler).

**How to apply:** enrich past-dated, actual-less rows via per-symbol history, restricted
to the client's displayed universe (client passes `?symbols=`), ±1-day tolerant date
match (BMO/AMC/timezone drift), bounded fan-out, long history cache for quota safety.
Nasdaq also tends to IP-block datacenter egress (Railway) → 403/HTML; `getNasdaqDiag()`
surfaces that.
