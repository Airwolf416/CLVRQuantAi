---
name: Binance server-side geo-block in dev
description: Why server-side Binance REST/CCXT features only activate in Railway prod, not the Replit dev env
---

# Binance is geo-blocked server-side in the Replit dev environment

Direct server-side calls to Binance from the Replit dev container are geo-blocked:
- `https://api.binance.com/...` REST → HTTP **451** (Unavailable For Legal Reasons)
- CCXT (binance/binanceusdm/bybit) in the Python quant service → **403** CloudFront "block access from your country"

The Railway **production** environment is NOT geo-blocked — these calls succeed there.

**Why this matters:** Any server-side feature that pulls from Binance only
activates in prod. In dev it silently degrades (per-call try/catch swallows the
451), so you cannot verify it by watching dev logs — absence of data in dev is
expected, not a bug.

**How to apply:**
- The real-1m-volume poller (`pollVolumes` → `volHistory` in `server/routes.ts`)
  fills nothing in dev; the scanner's `hasRealVol` stays false and it falls back
  to the tick-density proxy ("Activity Nx avg (tick est.)"). In prod `volHistory`
  populates and labels read "Volume Nx 1m avg". Don't "fix" the empty dev case.
- The browser-direct Binance **WS** ticker stream is unaffected — that runs in the
  user's browser, not the server, so the geo-block doesn't apply.
- To test Binance-dependent server logic, rely on prod logs / behavior, not dev.
