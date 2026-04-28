# CLVRQuantAI

## Overview
CLVRQuantAI is a luxury, mobile-first market intelligence dashboard designed for real-time analysis of crypto, equities, commodities, and forex markets. It leverages an advanced AI (Anthropic Claude) for market insights, offers a macro calendar, personalized alerts, and a morning brief. The project aims to provide users with a sophisticated tool for informed trading decisions, with a focus on delivering high-quality, real-time data and AI-driven signals. A key business objective is to transition from AI-originated signals to a deterministic quant scorer, with AI serving a veto-only role, enhancing reliability and precision.

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
The application uses an Express (TypeScript) backend with a React (JSX) frontend, served via Vite, all on a single port. Data persistence is handled by PostgreSQL through Drizzle ORM. A critical architectural component is a Python FastAPI quant microservice that performs deterministic quantitative scoring. The UI/UX features a navy and gold theme, utilizing Playfair Display and IBM Plex Mono fonts for a luxurious feel.

**Key Features and Implementations:**
- **Quant Microservice:** A Python FastAPI service (`quant/`) is integrated for generating deterministic quantitative scores, replacing direct AI signal generation. It includes modules for scoring, stop-loss placement, sizing, costs, regime detection, GARCH modeling, microstructure analysis, and various indicators.
- **Node-Python Bridge:** `server/quantClient.ts` facilitates communication between the Node.js backend and the Python quant microservice.
- **Real-time Data Aggregation:** The system aggregates real-time 1-minute OHLCV bars from Hyperliquid and other public providers (Binance, Yahoo Finance) for a comprehensive range of assets.
- **Signal Generation & Hardening:** Signals are generated via the quant service, subject to cost/EV gates and an AI veto. A "soak-safety guard" ensures system readiness before deploying new features. Signal hardening rules, including `MIN_RR_AFTER_FRICTION` and adaptive thresholds, are in place to optimize signal throughput and reduce noise.
- **Email & Update Management:** Admin tools for email diagnostics and an `UpdateLogManager` allow owners to curate and AI-generate weekly project updates.
- **Improvement-Log Mirror (dev → prod):** The agent's `logImprovement()` helper writes to local `update_log_entries`, then asynchronously POSTs the same entry to `POST /api/internal/improvement-log/mirror` on prod via HMAC-SHA256-signed HTTP (`server/lib/prodDbMirror.ts`). Prod (Railway) verifies signature with timing-safe compare, dedupes within 7 days, and inserts into its own DB. Sender requires `IMPROVEMENT_MIRROR_URL` + `IMPROVEMENT_MIRROR_SECRET`; receiver requires only the secret. Self-call guard (Railway/Replit deploy host envs) prevents prod from mirroring to itself. Best-effort: failures never break the local insert. The `update_log_entries` table is created on every Railway boot via `initDb.ts`.
- **Market Data Sources:** Migration from Finnhub to a more robust and cost-effective mix of Yahoo Finance (for equities/forex/commodities), FMP (fallback), and direct Binance/Hyperliquid WebSockets for crypto.
- **AI Trade Ideas Refinement:** `buildMarketSnapshot` now filters market data by `marketTypeFilter` (PERP/SPOT/BOTH) and `signalFilter` (pump/dump/signal), ensuring the AI receives relevant and accurate data, preventing hallucination and misuse of stale prices.
- **Session Overlays:** Introduction of per-session VWAP (with ±1σ bands) and Opening Range (ORH/ORL) overlays for spot equities, FX, and commodities, displayed on a live Recharts chart and integrated into the AI Analyst chat context.
- **Daily Brief Reliability:** Enhanced daily brief sending mechanism with improved error handling, explicit slot release on failure, and an admin retry endpoint to prevent missed sends.
- **UI/UX Improvements:** The "Generate Today's Brief" button now provides immediate, inline status feedback and renders the brief directly on the Brief tab, improving user experience.

## External Dependencies
- **Anthropic Claude:** `claude-sonnet-4-6` for AI-driven insights and vetoing quant signals.
- **PostgreSQL:** Primary database for application data.
- **Drizzle ORM:** Used for interacting with PostgreSQL from the Node.js backend.
- **Python FastAPI:** Powers the quantitative microservice.
- **Hyperliquid WebSocket:** Provides real-time price feeds for crypto perps.
- **Stripe:** For subscription management.
- **Resend:** For sending emails (e.g., verification, daily briefs). Requires `RESEND_API_KEY`.
- **GitHub:** Integrated for various development workflows.
- **CryptoPanic:** For news aggregation.
- **Yahoo Finance API:** Public API used for equities, ETFs, metals, forex, and indices.
- **FMP API (Financial Modeling Prep):** Used as a fallback for market data, specifically the `/stable/quote` endpoint.
- **Binance WebSocket:** Browser-direct connection for crypto spot ticker updates.
- **CCXT:** Python library for cryptocurrency exchange integration (e.g., Binance, Bybit) within the quant service for external bars.
- **ExchangeRate-API:** Forex fallback.
- **gold-api.com:** Metals fallback.