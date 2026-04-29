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