# CLVRQuantAI

## Overview
CLVRQuantAI is a luxury, mobile-first market intelligence dashboard for real-time analysis across crypto, equities, commodities, and forex. It provides AI-driven market insights, a macro calendar, personalized alerts, and a morning brief to support informed trading decisions. The project aims to transition from AI-originated signals to a deterministic quant scorer, with AI serving a veto-only role, enhancing signal reliability and precision.

## User Preferences
- I prefer simple language.
- I like functional programming.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.
- Do not make changes to `package.json`, `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`.
- Do not use raw `pg` on Node – Drizzle only.
- `CLAUDE_MODEL` stays `claude-sonnet-4-6`.
- Use `packager_install_tool` for any package install (Python or Node).

## System Architecture
The application features an Express (TypeScript) backend and a React (JSX) frontend, served via Vite on a single port. Data is persisted in PostgreSQL using Drizzle ORM. A Python FastAPI quant microservice handles deterministic quantitative scoring. The UI/UX employs a navy and gold theme with Playfair Display and IBM Plex Mono fonts.

**Key Architectural Components & Features:**
- **Quant Microservice:** A Python FastAPI service (`quant/`) generates deterministic quantitative scores, including modules for scoring, risk management (stop-loss, sizing), regime detection, GARCH modeling, and microstructure analysis.
- **Node-Python Bridge:** `server/quantClient.ts` facilitates communication between the Node.js backend and the Python quant microservice.
- **Real-time Data Aggregation:** Aggregates 1-minute OHLCV bars from sources like Hyperliquid, Binance, and Yahoo Finance.
- **Signal Generation & Hardening:** Signals originate from the quant service, are subject to cost/EV gates, and an AI veto. Signal hardening rules (e.g., `MIN_RR_AFTER_FRICTION`) optimize throughput and reduce noise.
- **Statistical Brain:** An empirical edge engine (`server/lib/statisticalBrain.ts`) analyzes historical trade data to compute win rates, expected returns, and resolution times per (token, direction) combo. It derives strict limits for Take Profits, Stop Losses, and Kill Clocks, issuing verdicts like SUPPRESS, CAUTION, NORMAL, or PREFERRED. This brain context is integrated into the AI's prompts and can veto signals.
- **Chart Vision:** `server/lib/chartRenderer.ts` generates SVG candlestick charts with technical overlays (EMAs, S/R, entry zones), converts them to PNG, and sends them as multimodal input to Claude for visual analysis validation.
- **Enhanced AI Analysis (`/api/ai/analyze`):** Integrates the Statistical Brain, Chart Vision, and intraday Execution Levels (VWAP, ORH, ORL) into the AI's context for a comprehensive analysis of user-specified tickers.
- **Daily Brief Integration:** The Statistical Brain context is used to bias trade idea selection in the daily email brief and Telegram posts, favoring empirically winning setups and avoiding suppressed ones.
- **Trade Idea Asset Class Selector:** UI allows filtering trade ideas by asset class (All, Crypto, Equities, Commodities, Forex), dynamically adjusting market types (PERP/SPOT) and filtering signals accordingly.
- **Telegram Autoposter:** A unified helper (`server/lib/buildEnrichedReasoning.ts`) creates consistent, branded captions for live signals and daily brief trade ideas, posted via a dedicated webhook. Includes admin tools for testing posts.
- **Email & Update Management:** Admin tools for email diagnostics and an `UpdateLogManager` for curating and AI-generating weekly project updates. Promo expiry reminders are managed with idempotency to prevent duplicate sends.
- **Improvement Log Mirroring:** Agent's `logImprovement()` mirrors entries to a production database for centralized tracking via HMAC-SHA256 signed HTTP.
- **Session Overlays:** Per-session VWAP (with ±1σ bands) and Opening Range (ORH/ORL) overlays are displayed on live charts for spot equities, FX, and commodities, and provided to the AI Analyst.
- **Signal Engine v1 Upgrade (Phase 1 — prompt-only, behind `PROMPT_V2_MODE`):** The v1 Signal Engine spec (Regime Gate as HARD filter, Dual-Score output `direction_probability` + `conviction` with per-asset-class thresholds, Volatility-Percentile-Adjusted R:R, Meta-label → Kelly scaling, and crypto microstructure features CVD / OBI / IV-RV) is encoded as a single `SIGNAL_ENGINE_V1` constant in `server/prompts/shared.ts` and injected into the v2 signal-generation system prompt at `server/prompts/signalGen.ts` between the killswitch / calibration block and the `RESPONSE FORMAT` line. `TradePlanSchema` is extended with optional fields `signal_status`, `regime`, `direction_probability`, `conviction`, `p_loss_meta`, `vol_percentile`, `rr_multiplier`, `kelly_fraction_applied`, `microstructure { cvd_state, obi, ivrv_spread }`, `gates_passed`, and `no_signal_reason` (all optional for backward compatibility — legacy v2 outputs that pre-date the upgrade still validate). New gate reason codes (`regime_chop`, `regime_mismatch`, `below_thresholds`, `cvd_contradict`, `ivrv_block`) are appended to `NO_TRADE_REASONS`. The prompt instructs Claude to double-write NO_SIGNAL outcomes as `direction = "NO_TRADE"` with the gate name pushed into both `kill_switches_triggered` (legacy consumers) and `no_signal_reason` (new consumers). The server-pinned `kelly_fraction` remains the BASE Kelly; `kelly_fraction_applied` documents the after-meta-shrinkage value. **Phase 2 (deferred to follow-up tasks):** migrate each HARD gate from prompt into the deterministic Python quant scorer one at a time (Regime Gate → Dual Score → Vol-Adjusted R:R → Kelly meta → microstructure wiring), updating the v2 prompt to defer to the scorer as each gate moves over. **Data-feed gaps to procure for Phase 2 microstructure:** Deribit ATM 7-day IV feed for BTC/ETH (IV-RV), per-signal top-10 order book snapshots with 30s staleness flag (OBI), and trade-tagged buy/sell volume over the last 20 bars (CVD divergence). No `shared/schema.ts` (Drizzle) changes, no DB schema changes, no `db:push` run in Phase 1.
- **Access Code Redemption (Race-Safe, Per-User Ledger):** `/api/verify-code` is hardened against the live spam-redemption exploit on shared codes (e.g. `CLVR-VIP-GROUP2026`). Each access code now carries a `redemption_type`:
  - `single_use_global` — single-use codes that lock to the first redeemer (default for individual VIPs, trial codes, admin Pro codes).
  - `single_use_per_user` — group/shared codes (CLVR-VIP-GROUP2026) that any verified user may redeem **exactly once each**.
  Enforcement combines (a) an email-verified gate, (b) a 5-attempt-per-hour per-user audit-backed rate limit, (c) a transactional `SELECT … FOR UPDATE` on the access-code row plus `INSERT … ON CONFLICT DO NOTHING` against the `code_redemptions` ledger (UNIQUE(code, user_id)), (d) a tier-no-downgrade rule, and (e) a no-shorten expiry rule that never reduces a user's existing access window — `promo_code` / `promo_expires_at` are only refreshed when the new code STRICTLY EXTENDS the user's current access (a NULL/permanent expiry always wins over any finite date). Every attempt — success, duplicate, expired, exhausted, rate-limited, error — writes a row to `redemption_attempts` for forensics. A one-time grandfather backfill seeds prior `users.promo_code` claims into the ledger so legitimate holders are never charged twice. Both new tables and the `redemption_type` column were added via additive raw SQL `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` in `server/initDb.ts` (no Drizzle schema changes, no `db:push` run).
  - **Documented exception to the "Drizzle only" preference:** the redemption transaction in `server/routes.ts` uses raw `pg` (`pool.connect()` → `BEGIN` / `SELECT FOR UPDATE` / `INSERT ON CONFLICT` / `COMMIT`) because Drizzle's high-level API does not cleanly express row-locked inserts with conflict-aware short-circuiting in a single transaction. The handler always releases the client in `finally` and writes a `claim_error` audit row on any catch.

## External Dependencies
- **Anthropic Claude:** For AI-driven insights and signal vetoing.
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** For PostgreSQL interaction.
- **Python FastAPI:** Powers the quantitative microservice.
- **Hyperliquid WebSocket:** Real-time crypto perp price feeds.
- **Stripe:** Subscription management.
- **Resend:** Email sending service.
- **GitHub:** Development workflows.
- **CryptoPanic:** News aggregation.
- **Yahoo Finance API:** Market data for equities, ETFs, metals, forex, and indices.
- **FMP API (Financial Modeling Prep):** Fallback market data.
- **Binance WebSocket:** Browser-direct crypto spot ticker updates.
- **CCXT:** Python library for cryptocurrency exchange integration within the quant service.
- **ExchangeRate-API:** Forex fallback.
- **gold-api.com:** Metals fallback.