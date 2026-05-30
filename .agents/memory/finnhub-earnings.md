---
name: Finnhub earnings flow
description: How the earnings flow sources data after the FMP rip-out, and Finnhub free-tier limits that shape the UI.
---

# Finnhub earnings flow

`server/services/finnhubEarnings.ts` is the single source of truth for ALL earnings
data (calendar, per-symbol history, company profile). FMP was fully ripped out of the
earnings flow; FMP survives ONLY for the separate IPO calendar feature.

**Rule:** any route or worker that needs earnings data must go through the
`finnhubEarnings` service, not fetch Finnhub directly. `GET /api/earnings`
(`server/routes/earnings.ts`) filters the service's cached calendar per-request by
watchlist — do NOT reintroduce a single global response cache there.
**Why:** a global response cache keyed only by time served the first caller's
watchlist-filtered payload to everyone (cross-watchlist bleed). The service already
caches the RAW calendar window for 5 min, so the route should filter, not re-cache.

**Finnhub free-tier limits:**
- `/stock/earnings` (per-symbol history) is EPS-only — NO revenue. So the Reaction
  tab dropped its REV columns and radar `revenue_growth_yoy` degrades to null.
- `/calendar/earnings` carries both EPS + revenue estimate/actual, plus hour/quarter/year.
- `/stock/profile2` marketCapitalization is in MILLIONS USD (×1e6 to normalize).
