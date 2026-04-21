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

### Wiring status
- ✅ Python service boots, Hyperliquid WS connected for BTC/ETH/SOL/PENDLE/HYPE
- ✅ Scorer math verified (synthetic random walk correctly blocked by `z_threshold` + `regime_chop` gates)
- ✅ DB logging verified (`quant_scores` row #1 written)
- ✅ Frontend status card live in QuantBrain tab
- ⏸ NOT auto-wired into `detectMoves` scanner. Existing 5/5 check pipeline (anti-chase, no-momentum gate, macro risk, session, MAX_SIGNALS caps) still owns emission. Call `generateSignalPhase2A` manually via `/api/quant/test-flow` or wire it into `detectMoves` behind `PHASE2A_ENABLED=1` env when ready. Spec section 16(B).
- ⏸ Railway production needs Python in build (Procfile / railway.json TBD). `startQuantService` swallows spawn errors so Express keeps working if Python unavailable.

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
