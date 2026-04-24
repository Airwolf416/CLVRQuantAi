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

## Admin: Email Diagnostics + Update Log (Apr 2026)

Owner-only tooling in Account → Admin tab:
- **EmailDiagnosticsPanel** — lookup user by email, force-resend verification (returns raw Resend response: id or error), or manually mark verified as escape hatch when delivery is blocked. Endpoints: `GET /api/admin/email-diag`, `POST /api/admin/resend-verification-by-email`, `POST /api/admin/mark-verified` (routes.ts ~7440-7560). Built so prod email failures can be diagnosed without Railway logs.
- **UpdateLogManager** — accumulator for "what shipped this week" entries. Owner logs improvements throughout the week (headline + optional detail/emoji). When `/api/admin/weekly-update/ai-generate` is called, the AI synthesizes from these curated entries (preferred) or git commits (fallback — Railway often strips `.git`). Entries are stamped with `included_in_update_id` once shipped so the buffer auto-clears. Table `update_log_entries` (created via executeSql, not db:push). Endpoints: `GET/POST /api/admin/update-log`, `DELETE /api/admin/update-log/:id` (routes.ts ~5034-5104). Generator logic in `server/weeklyUpdate.ts` (`getPendingUpdateLogEntries`, `markLogEntriesShipped`, updated `generateWeeklyUpdateWithAI`).

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

### Email verification — "Link Invalid" fix (Apr 2026)
Root cause: `storage.markEmailVerified` nulled `emailVerificationToken` on first hit. Any second GET (Gmail/Outlook safe-link previewer, double-tap, refresh, or coming back later) returned 404 → red "Link Invalid" page right after the user actually got verified.

Current behavior:
- `markEmailVerified` no longer clears the token; it rotates naturally on the next `setEmailVerificationToken` (resend or new signup). Repeat clicks of the same valid link succeed and return `{ ok: true, alreadyVerified: true, email, name }`.
- `/api/auth/verify-email` returns `{ error, code: "already_used" }` on token-not-found. The frontend treats this as a positive "already verified, sign in to continue" state with no PII echoed back, instead of the alarming red error. Trade-off: a typo'd random URL also shows a friendly success — recovery is one failed sign-in attempt followed by requesting a new link. Architect-acknowledged.
- Server logs each verify attempt with the 8-char token prefix and outcome (`OK alreadyVerified=…` / `no user — likely already-used or replaced` / threw) for traceability on Railway.

Future hardening (not done): add `emailVerificationTokenIssuedAt` and a TTL (e.g., 24 h after verify) to bound the replay window; tighten 404 semantics so genuinely unknown tokens don't all map to `already_used`.

### Improvement Log auto-logging convention (Apr 2026)
Helper: `server/lib/improvementLog.ts` exports `logImprovement({ headline, detail?, emoji?, addedBy? })`.

**Convention going forward:** after shipping any user-visible change (bugfix, new feature, UX improvement, copy change worth surfacing), the agent calls `logImprovement(...)` from somewhere on the request path or via a one-off script. Entries flow into the same `update_log_entries` table the Saturday weekly digest reads from, so the digest is always populated with real material instead of falling back to git commits (which Railway strips).

Behavior:
- `addedBy` defaults to `"agent"` so agent-authored entries are distinguishable from manual ones added through the Account page panel (those carry the admin email).
- Built-in dedupe: same `headline` within the last 7 days is silently skipped. Safe to call on retry / across workflow restarts.
- Never throws — failures log to console and return cleanly. Logging an improvement must never be able to break a feature.

Manual entries via the Account page UpdateLogManager continue to work alongside this.

### Signal throughput recovery — relax R:R floor + cap adaptive lockout (Apr 2026)
Symptom: 24h signal output collapsed from ~125/day baseline to 15/24h. Worker not dead — gates strangling.

Diagnosis from rejection telemetry (10 min window): 23,332 ADAPTIVE_SUPPRESSED + 3,372 RR_TOO_LOW_AFTER_FRICTION. 42 of 53 combos suppressed, 19 pinned at threshold=100 (full lockout — no probe path). Friction-rejected R:R values clustered at 1.60–1.72 against a 1.80 floor.

Two-knob fix:
1. **`server/lib/signalHardening.ts`**: `MIN_RR_AFTER_FRICTION` 1.80 → 1.65. Engine TP/SL math + slippage/funding costs naturally produce R:R in the 1.6x band — the 1.80 floor was structurally unreachable.
2. **`server/lib/adaptiveThresholds.ts`**: per-combo adjustment cap +25 → +20, so threshold maxes at 95 (never 100). A combo at 100 has no path back — even a perfect signal can't beat a never-attainable score. 95 leaves room for occasional probe trades.
3. **`server/lib/adaptiveThresholds.ts`**: added `probeStaleSuppressedCombos()`, wired into `recalcAllThresholds()` cycle. Any suppressed combo that has fired **zero signals (any status) in the last 7d** gets reset to threshold=90, suppressed=false, adjustment=15. Operational rule: a permanently silent combo is information-starved, not necessarily bad — let it through occasionally to refresh the win-rate sample.

DB cleanup applied at fix time: 21 rows capped 100→95; first probe-stale run released 15 fully-locked combos.

**Open question:** post-fix R:R rejection histogram shows 35 of 55 rejects clustered at *exactly* 1.64 — the engine's natural output is 0.01 below the new floor. May need to drop to 1.55 to truly free the bulk, or widen TP at engine level.

**Decision (Apr 2026):** holding floor at 1.65 for ~1 week. Rejection logging upgraded to 4-decimal precision (`signalHardening.ts` line ~198) so calibration uses real values, not rounded bins. After ~7d of data, bucket realized outcomes (from `ai_signal_log`) by true unrounded post-friction R:R and choose the lowest R:R where net-of-cost expectancy stays positive. Avoid a blind drop to 1.55 — prefer per-token / per-regime / per-hold-horizon relaxation if expectancy supports it.

**What "WORKER STALE (Nm)" on the Account page actually means:** the AccountPage `workerHealthy` indicator shows minutes since the last DB-saved signal. It is a *throughput* signal, not a process-liveness signal. A high number can mean the worker is dead OR every signal it produced was rejected by gates. Always check `signal_rejections` before assuming the worker is dead.

### Daily brief reliability — release stuck slots + force-retry endpoint (Apr 2026)
**Symptom:** intermittent missed daily brief sends — three failures in three weeks (Apr 2, Apr 16, Apr 24), each appearing in `daily_briefs_log` as a row with `recipient_count=0`.

**Root cause:** `sendDailyBriefEmails()` uses a "claim slot then send" pattern. `claimBriefSlot(dateKey)` does an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING` to lock the day. The slot is meant to be UPDATEd to the real `recipient_count` after the loop finishes. Two failure modes left the row at 0 with no retry path:
- Resend client init throws → outer catch logged the error and returned. Slot stayed at 0.
- All individual `client.emails.send()` calls failed → `sentCount=0`, row UPDATEd to 0. Slot stayed at 0.
- (Discovered during architect review:) any uncaught exception in pre-send work — `fetchMarketData()`, brief generation, subscriber query, tier-trade pipeline — would also throw past every existing catch and leave the row at 0.

Other failure modes (no subscribers, critical integrity failure) already DELETEd the row to release it. These three paths were missing the same release.

**Fixes:**
1. **`server/dailyBrief.ts`**:
   - Send-loop catch now DELETEs the row instead of swallowing the error.
   - End-of-loop check: if `sentCount === 0`, DELETE instead of UPDATE-to-zero.
   - Extracted body to `sendDailyBriefBody()`, wrapped in a top-level try/catch in `sendDailyBriefEmails()` — any pre-send throw releases the slot.
2. **`server/routes.ts`**: new `POST /api/admin/retry-daily-brief` (owner-only, owner email check). Atomic CTE pattern — single query reads current state and conditionally DELETEs the row only if `recipient_count=0` AND `sent_at < NOW() - 15 minutes`. Refuses with 409 in two cases:
   - Already sent (`recipient_count > 0`) — prevents accidental double-broadcast.
   - In-progress (row at 0 inside the 15-min lease) — prevents racing a live send. The 15-min lease comfortably covers worst-case AI generation + sequential 250ms-spaced sends to current subscriber base.

**The fundamental rule going forward:** the claim row is a lock. Every code path between claim and successful UPDATE must release the lock on failure. Otherwise one bad day blocks every retry.

**Operational caveat:** if subscriber count grows enough that a real send takes >15 min, the lease window needs to grow too (or move to a heartbeat pattern). Monitor send duration before scaling recipients.

### Daily brief — render-stage attribution + template parse fix (Apr 24, 2026)
**Symptom:** owner pressed the "Resend morning brief" button, route returned "started", row was atomically created and then DELETEd within ~1 minute, no email arrived. Promotional email sent fine. The all-caught error path was hiding which stage was actually failing.

**Root causes (two separate bugs, in order of discovery):**
1. **Silent fire-and-forget route.** `POST /api/admin/retry-daily-brief` and `enqueueDailyBrief()` were void-returning. The send loop's `try/catch` logged generically and the route had already responded "started", so the UI couldn't tell render failures apart from send failures apart from success.
2. **Orphan `{{/if}}` in `server/templates/daily_brief.hbs`.** A previous edit removed the opening `{{#if}}` that wrapped the trade-idea disclaimer block but left the closing `{{/if}}` on line 134, breaking Handlebars parse for **every** subscriber. Because rendering happened before the Resend call, every send "failed" without ever touching Resend — and the slot-release path did its job, deleting the row.

**Fixes:**
1. **`server/dailyBrief.ts`** — added `BriefSendResult` type. `sendDailyBriefBody`, `sendDailyBriefEmails`, and `enqueueDailyBrief` now return `{ran, sent, total, reason?, errors[]}`. Per-email loop tracks `stage: "render" | "send"` so failures are attributed to the actual failing call. Errors include the recipient and stage so we can never again be blind to which step is failing.
2. **`server/routes.ts`** — `POST /api/admin/retry-daily-brief` now `Promise.race`s the brief against a 90-second deadline and returns the structured result to the UI (sent count, total, first error, stage). The button finally tells the truth.
3. **`server/templates/daily_brief.hbs`** — restored the missing `{{#if ideaCount}}` wrap around the disclaimer so the existing `{{/if}}` balances. Free tier (`ideaCount=0`) hides the disclaimer (correct — they get no ideas to disclaim). Pro/Elite show it. Verified by isolated Handlebars compile against both tier shapes.

**Lesson:** "fire-and-forget with caught errors" is the same anti-pattern as "claim slot then never release" — both turn real bugs into silent ones. Always return structured result objects from background work the user can trigger, and always attribute errors to the stage that produced them. A loud failure is a feature.

**End-to-end verification (Apr 24, 2026 11:29 UTC):** after the template fix landed, the catch-up scheduler ran on workflow restart, generated the brief via Anthropic, and successfully delivered to all 7 active subscribers via Resend (`daily_briefs_log.recipient_count = 7`, `sent_at = 11:29:25`). Same DB / same subscriber list / same Resend credentials as production — production needs the deploy to pick up the template fix before its next 6 AM ET schedule.

**Architect review follow-ups (Apr 24, 2026):** addressed two of three architect findings — (1) `errors[]` summaries now include the recipient (`stage:email:errName:msg`) so partial failures identify *which* subscribers failed, and (2) the 90s route timeout now returns `ok:false` + `status:"timeout"` so the UI shows the honest "outcome unknown" state instead of falsely implying success while the send continues in background. The third finding — true cancellable execution / heartbeat lease for sends exceeding the 90s deadline — is deferred until subscriber count makes it material (current 7 subs send well under the deadline).

### AI Trade Ideas — PERP/SPOT data segregation + pump-dump signal filter (Apr 24, 2026)
**Symptom:** user selected PERP in AI tab → CLVR AI → Trade Ideas, AI returned an AMD entry priced at Yahoo spot (~$145) and labeled it PERP.

**Root cause (corrected — initial reading was wrong):** AMD DOES have a real Hyperliquid perp on the `xyz` synthetic-equity dex. `fetchAllHL()` in `client/src/store/MarketDataStore.jsx` pulls from three dexes — main (crypto), `xyz` (equity synthetics: AMD, TSLA, NVDA…), `flx` (commodity synthetics: GOLD, OIL…) — and merges them all into `storePerps`. So `storePerps["AMD"]` was actually populated with the real HL perp price (~$340.50, +12.71% 24h at fix time). The bug was that `buildMarketSnapshot` injected ALL three sections regardless of `marketTypeFilter` — A (HL perp), B (HL spot), C (Yahoo/CoinGecko/FMP spot). For AMD the model saw `$340.50 PERP` in Section A AND `$145 spot` in Section C. The AI picked the cheaper Section C price and labeled it PERP. The HL synthetic equity perps trade 24/7 on Hyperliquid and naturally decouple from cash spot during off-hours — the gap is real, not a bug. Same class of leak existed in reverse for SPOT mode (could fabricate funding/OI talking points from Section A). Separately, the full asset universe was always injected — including dozens of neutral / non-moving assets — so the AI often anchored on stale prices instead of actual movers.

**Fix:**
1. **`client/src/utils/marketDataSnapshot.js`** — `buildMarketSnapshot` now accepts:
   - `marketTypeFilter: "PERP" | "SPOT" | "BOTH"` (default `BOTH`). PERP emits ONLY Section A. SPOT emits ONLY Sections B + C. BOTH tags every row with its section so the AI can mix safely.
   - `signalFilter: boolean` (default `true`). Drops assets within per-class neutral bands: crypto ±3.0% (24h), equity ±1.5%, commodity ±1.5%, FX ±0.5%. Tokens with active QuantBrain signals are always retained. Each kept row tagged `[PUMP]` / `[DUMP]` / `[SIGNAL]`.
   - Header now explicitly states the regime ("PERP-ONLY", thresholds, "do not invent prices for missing assets"). Empty sections render as `"(no pump/dump signals)"` so the AI knows it's intentional, not a fetch failure.
2. **`client/src/components/ai/TopTradeIdeas.jsx`** + **`AIChat.jsx`** — both call sites pass `marketTypeFilter` + `signalFilter:true`. `marketTypeRule` rewritten with explicit forbidden-actions language: *"If an asset is NOT listed in Section A, you CANNOT recommend it. There is no Hyperliquid perp for it."* Same shape for SPOT.
3. **`TopTradeIdeas.jsx` prompt** — softened `"Return EXACTLY ${tradeCount} trades"` to `"Return UP TO ${tradeCount} trades"` with explicit fallback: *"return fewer trades or `trades:[]` with a one-line reason rather than invent setups for assets not in the snapshot."* This closes the architect-flagged hallucination vector when `signalFilter` narrows the universe near-empty.
4. **`AIChat.jsx`** — added `outOfUniverseRule`: if the user asks about an asset not in the snapshot (e.g., asks about AAPL while filter is PERP-only or AAPL has no movement), the model is told to refuse plainly and explain the filter state, rather than fabricate a price.

**The fundamental rule going forward:** the prompt and the data must agree. If the snapshot says "no PERP for AMD", the prompt must forbid recommending AMD as PERP. If the snapshot deliberately omits neutral assets, the prompt must let the model return fewer trades. Otherwise the LLM treats the gap as a hint to invent.

**Verification:** TS clean (`npx tsc --noEmit` exit 0). App boots HTTP 200. Architect review PASS for the segregation flow ("materially closes the reported AMD spot leakage path"); flagged the EXACTLY-N contradiction which was fixed in the same session. Only 2 callers of `buildMarketSnapshot` exist in repo — both updated. Logged as improvement #41.

**Follow-up #41-c — stale equity/metal/forex seeds were leaking into AI snapshot (Apr 24, 2026):** user pointed out the AI was returning AMD at $145 when the real Yahoo/FMP price was $305.33. Investigation: `client/src/App.jsx` lines 103–105 define hardcoded `EQUITY_BASE` / `METALS_BASE` / `FOREX_BASE` constants (AMD:145, EURUSD:1.0842, etc — all months stale) used as initial state for the price stores so UI tiles render immediately on page load. Until `/api/finnhub` (FMP) returns, those seeds carry `live: false`. The old `buildMarketSnapshot` Section C emitted every row regardless of `live` flag with only an "est" suffix that the AI ignored — so the AI was being shown `AMD:$145.00 (0.00%) est` and used it as gospel. Verified live: FMP returns `{price: 305.33, chg: 7.33, live: true}` for AMD right now, so the data path works fine; the snapshot just wasn't filtering. **Fix:** added a hard guard in `marketDataSnapshot.js` `tagged()` — for `equity`/`commodity`/`forex` rows, drop the row entirely unless `d.live === true`. Crypto exempted (CoinGecko returns no `live` flag and is always actually live). UI seeds left intact for instant tile render, but the AI now sees only verified live prices. Logged as correction follow-up to #41.

### Session VWAP + Opening Range overlays — spot only (Apr 24, 2026)
Added per-session VWAP (with ±1σ bands) and Opening Range (ORH/ORL) overlays to two surfaces — Chart AI tab gets a new live 1-minute Recharts chart with the levels drawn directly on price; AI Analyst chat auto-attaches an `EXECUTION CONTEXT` block to the system prompt whenever the user mentions an eligible spot ticker. **Strict gating: spot equities, spot FX, and spot commodities only — every crypto and every Hyperliquid perp is hard-excluded.** Build is purely additive — no edits to Signals/Kronos/Kelly/OI/Fib pipelines.

**Anchors:** equity 13:30 UTC + 15-min OR; FX 22:00 UTC + 60-min OR; commodity (COMEX) 13:30 UTC + 30-min OR. Anchors walk back to the most recent past session, so pre-RTH calls render yesterdays levels rather than null. For sparse FX bars (Yahoo skips no-trade minutes around the Sydney open) an "effective anchor" slides forward to the first available bar so the OR window isn't empty.

**Files:**
- `server/lib/executionOverlay.ts` (NEW) — `isExecutionOverlayEligible`, `getExecutionAssetClass`, `getYahooTickerFor`, `getEligibleSymbols`, `getSessionAnchor`. Hard-excludes `CRYPTO_SYMS`, `HL_PERP_SYMS`, and any symbol with `USDT`, `-USD`, or `PERP` in it.
- `server/lib/executionLevels.ts` (NEW) — `computeExecutionLevels(symbol)` returns `{vwap, vwap_upper_1sd, vwap_lower_1sd, orh, orl, or_width_pct, price_vs_vwap_pct, in_or_range, orb_status, current_price, anchor_ts, sample_count}`. Cumulative VWAP weighted by Yahoo 1m volume; FX/commodity (v=0) fall back to equal-weight typical price. In-memory Map cache, 30s TTL, keyed by symbol.
- `server/services/yahoo.ts` — `getYahooCandles` interval signature extended with `"1m"` (range capped at 7d to match Yahoo limits). Existing call sites untouched.
- `server/routes.ts` — three new routes near the Chart AI block:
  - `GET /api/execution_levels/eligible` (no auth, returns `{equity[], fx[], commodity[]}` for the UI selector)
  - `GET /api/execution_levels/:symbol` (session auth → 404 `{reason:"asset_class_not_eligible"}` for ineligible, 503 if no data, 200 with levels otherwise)
  - `GET /api/execution_levels/:symbol/bars` (session auth, normalized post-anchor 1m bars for the Recharts chart)
  - Also: `/api/chart-ai/analyze` injects the same `EXECUTION CONTEXT` block + a conditional "reference VWAP/OR levels in reasoning" rule into the Claude vision prompt when `req.body.asset` is eligible.
- `client/src/components/chartai/LiveOverlayChart.jsx` (NEW) — Recharts ComposedChart, gold VWAP line (#D4AF37 1.5px), dashed ±1σ bands, ORH dashed green (#00FF88), ORL dashed red (#FF4444), 8% ReferenceArea fill between ORH/ORL, symbol selector grouped by asset class (crypto excluded from the dropdown source), bottom legend `VWAP • ORH • ORL` + ORB status badge, 30s polling refresh.
- `client/src/tabs/ChartAITab.jsx` — mounts `LiveOverlayChart` between top bar and image dropzone, passes `asset || "AAPL"`.
- `client/src/components/ai/AIChat.jsx` — `sendMessage` now resolves the eligible-symbol map (module-cached single fetch), regex-extracts ticker mentions, intersects against the eligible set (no wasted requests on `AND`/`VS` etc.), fetches `/api/execution_levels` for up to 3 hits, and appends an `EXECUTION CONTEXT (SYMBOL, HH:MM UTC):` block plus a one-line `EXECUTION CONTEXT RULE` to the system prompt. When no eligible symbols are mentioned, the rule explicitly tells the model NOT to invent VWAP/OR commentary.

**Crypto/perp gating, verified at multiple layers:** symbol set lookup (CRYPTO_SYMS, HL_PERP_SYMS), suffix/substring blocks (USDT, -USD, PERP), backend route 404 before compute, AIChat client-side intersection against the eligible map, and the LiveOverlayChart selector is sourced exclusively from `/api/execution_levels/eligible`. End-to-end smoke: BTC/SOL/BTCUSDT/HYPE all return null at the compute layer; AAPL/AMD/EURUSD/GBPUSD/XAU/WTI all return valid level objects (391–866 bars, sane VWAP/OR/ORB).

**Architect review:** PASS with two correctness fixes applied — (1) `LiveOverlayChart` now syncs internal `sym` state when the parent `symbol` prop changes, and (2) AIChat ticker extraction is gated client-side by the eligible map so noise tokens don't hit the API. Logged as improvement entry in `update_log_entries`.


### Generate Today's Brief — UX fix (Apr 24, 2026)
**Symptom:** user reported the "Generate Today's Brief" button under the Brief tab "doesn't work."

**Root cause:** the click handler was `()=>{generateBrief();setTab("radar");}` — fire-and-forget the async generator AND immediately switch tabs. The user landed on the Radar tab with no visible loading state. If `/api/ai/analyze` failed (Anthropic 503 maintenance, 429 rate limit, 401/403 auth, malformed JSON, network), the only feedback was a single generic toast `"Brief is taking longer than usual — please tap Generate again in a moment."` which (a) auto-dismisses, (b) doesn't communicate WHY it failed, and (c) the user has to navigate back to the Brief tab to retry. Compounding: stale `briefData` from a previous session stayed mounted on Radar so the user couldn't even tell whether the new attempt had succeeded or shown them yesterday's output. No console error was logged, so prod debugging was blind.

**Fix:** in `client/src/App.jsx`:
1. **Stop hijacking the tab on click.** The button no longer calls `setTab("radar")`. The user stays on Brief and watches the status panel right under the button.
2. **Visible inline status panel** below the button with three states — `Generating brief — this can take 30–60s...` (neutral), `BRIEF FAILED` (red, with the actual reason), `READY` (green, with a `VIEW ON RADAR →` button so the user chooses when to navigate).
3. **Error categorization in `generateBrief`.** Auth (401), Pro tier (403), rate limit (429), maintenance (503/`__MAINTENANCE__`), parse failure, empty content, and network are each mapped to a specific human-readable message. Hard failures (auth/tier/rate/maintenance) skip the retry loop instead of burning all 3 attempts on a 401.
4. **`console.error` log** with the error kind + message so prod failures are debuggable from browser dev tools.
5. **`setBriefError("")` on every click** so the prior error clears when retrying.

Logged as improvement entry. Verified TS clean compile + no JSX render errors (HTTP 200 on `/`).


### Brief tab — output renders inline (Apr 24, 2026 — follow-up)
**Symptom:** user reported via screenshot that even with the new READY status banner, the brief output still didn't appear on the Brief tab — they had to tap "VIEW ON RADAR →" and switch tabs to actually read today's analysis. Their expectation: tap Generate, read the brief in place.

**Fix:** in `client/src/App.jsx`, copied the entire `{briefData && <>...</>}` render block (lines ~4615-4741: header card, Live Prices, Analysis & Outlook, Impactful News, What to Watch, Key Risk, Trade Ideas, Support footer) into the Brief tab section (`{tab==="brief" && isPro && <>...</>}`) right below the Generate button's status panel. Also removed the now-misleading `VIEW ON RADAR →` button and the `Results render on the RADAR tab.` footnote — replaced with `READY · Today's brief is below — scroll to read.`. The Radar tab still renders the same brief block (additive, no regression for users who navigate there from Radar).
