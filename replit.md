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

### Known limitations / honest gaps
- Equities, metals, forex use Express's `priceHistory` (single-price ticks expanded into fake OHLC bars when piped to scorer). Real candle quality only exists for the 32 HL perps.
- ATR/regime/GARCH math has only been observed on synthetic data + early WS samples; needs a multi-hour soak before `PHASE2A_ENABLED=1` is recommended in prod.
- Wilson LB returns `null` until ≥10 closed signals per (token, direction) exist — scorer is configured to handle null gracefully.

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
ANTHROPIC_API_KEY, CRYPTOPANIC_API_KEY, RAPIDAPI_KEY, SESSION_SECRET. Missing: RESEND_API_KEY.
