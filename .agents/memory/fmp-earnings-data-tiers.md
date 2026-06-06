---
name: IPO calendar data sources (Nasdaq primary, FMP fallback)
description: Where the IPO calendar feature gets its data and the free-tier limits that shape it. NOTE earnings is now Finnhub-only — see finnhub-earnings.md.
---

# IPO calendar data sources

Earnings is now Finnhub-only (see `finnhub-earnings.md`). FMP survives ONLY for the
separate **IPO calendar** feature. This file covers just the IPO sources.

- **Primary: Nasdaq public IPO calendar (no key)** —
  `https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM` (monthly) →
  `data.priced.rows` (already-listed, real price) + `data.upcoming` (scheduled) +
  `data.filed`. Needs the browser-UA/Referer trick. Show priced+upcoming over a
  recent+forward window (e.g. today-14..today+30) so the tab is never empty.
- **Fallback: FMP** — `/stable/ipos-calendar` returns **403 "Restricted Endpoint"**
  on the free tier, so FMP is only a best-effort fallback when Nasdaq is blocked/empty
  (`getIpoCalendar` in `server/services/fmpEarnings.ts`).

**Why:** Nasdaq tends to IP-block datacenter egress (Railway) → 403/HTML, so the FMP
fallback exists despite FMP's own free-tier IPO restriction. `getNasdaqDiag()` surfaces
Nasdaq block status.

**How to apply:** IPO route tries Nasdaq first, falls to FMP only on empty/blocked.
Logos still load from the FMP image-stock CDN (`financialmodeling...image-stock/SYM.png`)
— that CDN is keyless and unrelated to the restricted IPO data endpoint.
