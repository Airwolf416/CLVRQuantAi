# CLVRQuantAI

Luxury mobile-first market intel dashboard. Navy/gold theme, Playfair Display + IBM Plex Mono. Real-time crypto/equities/commodities/forex with CLVR AI (Anthropic Claude `claude-sonnet-4-6`), macro calendar, alerts, morning brief, PWA.

## Stack

- Express (TypeScript) + Vite (React JSX) — single port 5000
- PostgreSQL via Drizzle ORM (no raw `pg` on Node side)
- Python FastAPI quant microservice on 127.0.0.1:8081 (Phase 2A)
- Hyperliquid WS price feed (Python side)
- Stripe (subscriptions), Resend (email — needs `RESEND_API_KEY`), GitHub integrations installed

## Phase 2A — Quant Microservice (active)

Goal: replace Claude-as-originator with a deterministic quant scorer; Claude becomes veto-only.

### Layout
- `quant/` — Python microservice (FastAPI + uvicorn). Files: `main.py`, `scorer.py`, `sl_placement.py`, `sizing.py`, `costs.py`, `regime.py`, `garch.py`, `microstructure.py`, `indicators.py`, `hl_ws.py`, `state.py`, `db.py`, `models.py`, `config.py`, `requirements.txt`
- `server/quantClient.ts` — Node→Python bridge (`quantScore`, `quantCost`, `quantHealth`) + `generateSignalPhase2A` (scorer → cost/EV gate → Claude veto via raw fetch → log to `aiSignalLog`)
- `server/index.ts` — `startQuantService()` spawns uvicorn child (`spawnChild` from `child_process`) before DB init
- `server/routes.ts` — endpoints:
  - `GET /api/quant/health` → proxies to Python `/quant/health`
  - `GET /api/quant/recent` → last 20 rows from `quant_scores`
  - `POST /api/quant/test-flow` `{symbol}` → runs full Phase 2A pipeline on demand using Express priceHistory
- `client/src/components/QuantStatusCard.jsx` — frontend status widget rendered in `QuantBrain.jsx`
- DB tables: `quant_scores`, `microstructure_snapshots` (created via `executeSql` since `db:push` had interactive prompt)

### Wiring status (full sweep complete)
- ✅ Python service boots, Hyperliquid WS connected for **all 32 perps** (BTC, ETH, SOL, WIF, DOGE, AVAX, LINK, ARB, kPEPE, XRP, BNB, ADA, DOT, POL, UNI, AAVE, NEAR, SUI, APT, OP, TIA, SEI, JUP, ONDO, RENDER, INJ, FET, TAO, PENDLE, HBAR, TRUMP, HYPE)
- ✅ Real 1m OHLCV bar aggregation from HL trades (`STATE.bars` deque of 2000 per coin)
- ✅ `/quant/score` falls back to internal bars when caller passes none (`GET /quant/bars/{coin}` exposes them)
- ✅ Direction-aware Wilson lower bound from `ai_signal_log` (long/short separately, 30d, min n=10) with adaptive_thresholds fallback
- ✅ Phase 2A **auto-wired into `detectMoves`** at `server/routes.ts ~983` — opt-in via `PHASE2A_ENABLED=1`, fail-open if quant down (won't block existing flow)
- ✅ Railway production config: `nixpacks.toml` (installs Node 20 + Python 3.11 + `quant/requirements.txt` into `/opt/venv`), `Procfile`, `railway.json` with health check on `/api/quant/health`
- ✅ Frontend `QuantStatusCard` shows ONLINE/OFFLINE, PASSED/BLOCKED/VETOED counters from `/api/quant/recent`, last 5 scores
- ✅ Architect review fixes applied: `child.on("error")`, `aiIpLimiter` + `PHASE2A_TEST_TOKEN` on test-flow, snake_case in UI

### How to flip Phase 2A live
- Dev: `PHASE2A_ENABLED=1 npm run dev` (or set in Replit Secrets)
- Prod (Railway): set `PHASE2A_ENABLED=1` env var. Health check on `/api/quant/health` gates deploy.

### Real candle adapter (closes the equities/metals/forex gap)
- `quant/external_bars.py` — real OHLCV from public providers, no API key needed
  - **Binance** public REST `/api/v3/klines` for any crypto not in HL coverage
  - **Yahoo** public chart `query1.finance.yahoo.com/v8/finance/chart/{ticker}` for equities, ETFs, metals (GC=F, SI=F, CL=F), forex (EURUSD=X, etc.), indices (DX-Y.NYB)
  - 60-second TTL cache, in-flight request collapsing, defensive symbol mapping
- New endpoints:
  - `GET /quant/external_bars/{symbol}?asset_class=...&interval=1m&limit=300`
  - `/quant/score` now falls back: caller-supplied → internal HL bars → external provider, before raising 400
- `server/quantClient.ts` no longer ships fake single-tick OHLC; Express side just passes the symbol+asset_class and lets Python pull real candles
- Verified live: SPY (Yahoo), GOLD/GC=F, EURUSD=X all return real 1m candles

### Soak-safety guard (closes the "don't flip live too early" gap)
- `GET /quant/readiness` (Python) and `GET /api/quant/readiness` (Express proxy)
- Reports: `coverage_pct` (% of 32 coins with ≥120 bars), `closed_signals_30d`, `wilson_lb_armed`, and combined `recommendation: READY|SOAK`
- `QuantStatusCard` shows a SOAK/READY badge plus bar-coverage % and closed-signal count — visual gate so you only flip `PHASE2A_ENABLED=1` after the badge turns READY
- Health endpoint already returns HTTP 503 when WS isn't alive, so Railway healthcheck can't deploy a broken quant container

### Known limitations
- Wilson LB returns `null` until ≥10 closed signals per token exist — scorer handles `null` gracefully
- Binance public REST may be geo-blocked from some Replit/Railway regions; this only matters for non-HL crypto symbols since the 32 HL perps already have internal WS bars. Yahoo (equities/metals/fx) works from US-region Replit/Railway.

### Recent guardrails added (pre-Phase 2A)
- `server/config/assets.ts`: `SESSION_THRESHOLDS.minMove` raised to 2.0% (POST_NY 2.5%) — fewer noise signals
- `server/routes.ts ~3660`: no-momentum gate forces NEUTRAL when `range24Pct<1.5 AND volumeRatio<1.2`
- `server/routes.ts ~3675`: anti-chase rule already in place

## Forbidden

- Don't edit `package.json`, `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`
- Don't use raw `pg` on Node — Drizzle only
- `CLAUDE_MODEL` stays `claude-sonnet-4-6`
- Use `packager_install_tool` for any package install (Python or Node)

## Secrets in use
ANTHROPIC_API_KEY, CRYPTOPANIC_API_KEY, FMP_API_KEY (free-tier — single-quote endpoint only), RAPIDAPI_KEY, SESSION_SECRET. Missing: RESEND_API_KEY.

## Apr 2026 — Finnhub → FMP/Yahoo migration (full sweep complete)

### Why
Finnhub WS hit hard 429 limits and the REST tier rate-capped equity refreshes at ~1.5 s/symbol. Replaced with: Yahoo Finance (primary, no key, parallel /v8/chart) + FMP /stable/quote (single-quote fallback only — free tier rejects every batch endpoint with 402) + browser-direct Binance WS for crypto.

### Live data sources (post-migration)
- **Crypto perps**: Hyperliquid WS (Python) — 32 coins, unchanged
- **Crypto spot**: Browser-direct Binance WS (`wss://stream.binance.com:9443/stream`) for sub-second ticker updates on 29 majors — added in `client/src/store/MarketDataStore.jsx::startBinanceStream`
- **Equities/Forex/Commodities**: Yahoo Finance public `/v8/finance/chart` (parallel Promise.all per symbol, ~3 s wall-clock for 41 tickers per tick) — `server/services/yahoo.ts`
- **FMP fallback**: only `/stable/quote?symbol=X` works on free tier; `stockRefreshWorker` calls it for ≤5 Yahoo-miss symbols per 30 s tick to preserve 250 req/day quota — `server/services/fmp.ts`
- **CCXT (Python)**: `quant/external_bars.py` rewired to ccxt 4.5.50 with chain `binance → binanceusdm → bybit`. Geo-blocked (451) from Replit dev — Yahoo last-resort fallback always wins. Will work from Railway US-region.
- **News**: CryptoPanic (unchanged) + Yahoo RSS (`server/services/yahoo.ts::yahooNews`); FMP /stable/news/* is paid-only.
- **Forex fallback chain**: Yahoo → ExchangeRate-API; **Metals fallback**: Yahoo → gold-api.com.

### Files touched
- New: `server/services/fmp.ts`, `server/services/yahoo.ts`, `quant/requirements.txt` (ccxt 4.5.50)
- Rewritten: `server/services/marketData.ts` (`fhQuoteSafe` now wraps Yahoo + FMP fallback, signature preserved), `server/workers/stockRefreshWorker.ts` (Yahoo primary), `quant/external_bars.py` (ccxt + Yahoo)
- Edited: `server/routes.ts` — `startFinnhubWebSocket()` no-op'd, `setTimeout(startFinnhubWebSocket,5000)` removed, news fetcher uses `fmpStockNews`, `fetchFinnhubCandlesQuant` rewired to FMP /stable/historical-chart (paid endpoint — returns null for free-tier users, Yahoo path takes over)
- Edited: `server/index.ts` boot banner shows new sources; `quant/main.py` lifespan logs CCXT health probe
- Edited: `client/src/App.jsx` — `runTradeIdeas` got 90 s `AbortController` to fix Safari "Load failed" on long Claude calls; FAQ + footer + benefits-strip labels updated to "FMP / Binance / Hyperliquid"
- Edited: `client/src/store/MarketDataStore.jsx` — `startBinanceStream` opens browser-direct Binance WS; spot source label changed Finnhub→FMP
- Edited: `client/src/components/MyBasket.jsx` — basket SPOT toggle label now "SPOT · FMP / BINANCE"

### Backward compat preserved
- `cache["finnhub"]` key kept (every reader still works) plus new `cache["marketdata"]` alias
- `/api/finnhub` route still serves data (just with FMP/Yahoo content under the hood)
- `fhQuoteSafe(sym, apiKey)` Finnhub signature kept — second arg ignored
- `client/src/App.jsx::fetchFinnhub()` function name kept

### Known limitations
- FMP free-tier batch endpoints all return 402; if you upgrade FMP to Starter ($14/mo), uncomment the batch path in `fmp.ts::fmpQuoteBatch` and `marketData.ts` will pick it up automatically. The current path is robust and free.
- CCXT exchanges all return 451/403 from Replit dev IPs (binance/binanceusdm/bybit are US-blocked). On Railway production servers (US-East/EU) at least one CCXT venue should succeed; Yahoo fallback always works.
