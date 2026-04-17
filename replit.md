# CLVRQuant v2 | Trade Smarter with AI

## Overview

CLVRQuant v2 is a luxury-styled, mobile-first market intelligence dashboard providing real-time data and AI-powered analysis for cryptocurrency, stocks, metals, and forex. It integrates data from various financial APIs and features an AI analyst powered by Anthropic Claude. Key capabilities include a market intelligence radar, macro-economic calendar, AI-driven daily brief, custom alerts, quant signals, and Phantom wallet integration with a Perps PnL calculator. The project's vision is to empower users with sophisticated, AI-enhanced market insights in a sleek, intuitive interface, targeting both individual traders and financial enthusiasts seeking a competitive edge.

## User Preferences

Preferred communication style: Simple, everyday language.
**NO WATCHLIST**: The user explicitly does not want a Watchlist feature in the app. Do not add it back under any circumstances.

## System Architecture

### Design System — CLVRQuant Navy/Gold Aesthetic

The application exclusively uses a dark mode theme (`bg:#050709`, `panel:#0c1220`, `border:#141e35`) with a consistent gold accent (`#c9a84c` primary). Typography includes Playfair Display (serif for headers), IBM Plex Mono (monospace for data), and Barlow (sans-serif for body). Design elements feature 2px border-radius, `letterSpacing 0.15em` on labels, subtle gold gradients, a grid overlay background, and serif italic for CTAs. UI components like panels and buttons adhere to this aesthetic, and font sizes are optimized for mobile readability.

### Frontend

The frontend is a React application optimized for a maximum width of 780px, featuring a bottom navigation bar with tabs: Radar, Markets, Macro, Brief, Signals, Track Record, Insider, Alerts, Wallet, AI, Journal, About, Help, and Account.

-   **Radar**: Command center with Market Regime panel, CLVR Crash Detector, Global Liquidity Index, active alerts, live news, macro event countdowns, volume spike detection, funding rate flip alerts, and a liquidation heatmap.
-   **Markets**: Full Market Intelligence dashboard with sub-views for PRICES, SPREADS, CORRELATIONS, and NEWS. Displays CLVR Market Mode Score and regime data.
-   **Macro**: Enhanced macro calendar with live ForexFactory data, event cards with AI analysis, region/impact filters, and central bank schedules.
-   **Brief**: AI-generated daily market commentary with asset analysis.
-   **Signals**: QuantBrain-scored trading signals with multi-factor quality gates, confidence scores, and session-aware thresholds. Free users see a 30-minute delayed feed with a banner; Pro/Elite get real-time data. Locked signal details show an upgrade overlay.
-   **Track Record (RECORD tab)**: Live performance analytics — win rate, total signals, avg PnL, weekly win/loss bar chart, and signal history feed (history locked for free users). Pro/Elite see per-asset and per-direction breakdowns.
-   **Alerts**: Custom price and funding alerts with browser notifications.
-   **Wallet**: Integrates with Phantom wallet for Solana operations and Hyperliquid for account data, positions, orders, and AI-powered trade signals.
-   **AI**: Rebuilt 3-section vertical layout: Trade Ideas (top), Quant Scanner (middle), Ask AI chat (bottom). Simple/Pro detail toggle controls card verbosity. Macro Pre-Flight bar shows live macro status (CLEAR/CAUTION/BLOCKED) before every trade generation. Kronos tags on elite-tier high-conviction signals. Trade idea cards show entry/TP/SL, conviction bar, R:R, and copy-to-clipboard. Free=2 trades (rest blurred), Pro=4 trades + scanner + chat (30/day), Elite=6 trades + Kronos + unlimited chat. Components in `client/src/components/ai/`. Shared market snapshot utility in `client/src/utils/marketDataSnapshot.js`. Backend endpoint `GET /api/macro/preflight` provides 5-min cached macro status.
-   **Basket**: MyBasket moved to its own tab (🧺 BASKET in nav), gated behind Elite tier.
-   **About**: Project story and glossary of terms.
-   **Account**: User account management for subscription, referrals, emails, billing, and legal information.

**MarketDataStore**: A singleton data store polling Hyperliquid and Finnhub for real-time prices, computing market scores, spread anomalies, and correlations.

**i18n / Language Toggle**: Supports English and French, storing preference in `localStorage` and dynamically updating UI text.

### Backend

The backend provides API routes for all data and AI interactions, acting as a proxy with caching for external APIs.

-   **Data Routes**: For crypto (Binance, Hyperliquid), perps, Finnhub (stocks, metals, forex), signals, whales, macro (ForexFactory), Polymarket, and regime data.
-   **AI Routes**: Proxies Anthropic Claude for analysis.
-   **Subscription Routes**: Manages user subscriptions.
-   **Regime Engine**: Calculates market regime, crash probability, and liquidity index based on various financial indicators.
-   **Referral System**: Manages referral code generation and reward granting.
-   **Promo Expiry Reminder**: Daily email reminders for promo expirations.

### Monetization System

CLVRQuant uses a tiered monetization model (Free and Pro) with Stripe for subscription management (products, checkout, webhooks, customer portal). An access code system provides alternative Pro access.

## External Dependencies

### APIs

-   **Binance**: Crypto spot prices.
-   **Hyperliquid**: Crypto perpetual prices, funding rates, open interest, and volume.
-   **CryptoCompare**: Crypto news feed.
-   **Finnhub**: Stock quotes and ETF proxies.
-   **gold-api.com**: Precious and base metal spot prices.
-   **ExchangeRate API**: Forex pairs.
-   **ForexFactory website**: Macroeconomic calendar data (parsed HTML).
-   **Polymarket**: Prediction market odds.
-   **Solana RPC**: For Phantom wallet data.
-   **Anthropic Claude**: AI analysis and daily brief generation.
-   **Twitter API45 (via RapidAPI)**: For Twitter/X influencer feeds.
-   **CryptoPanic**: Hot news (optional).

### Modular Server Architecture

-   **`server/config/assets.ts`**: Centralized configuration for all financial symbols and constants.
-   **`server/services/ta.ts`**: Technical analysis functions.
-   **`server/services/marketData.ts`**: Data-fetching functions from various external sources.
-   **`server/workers/hlRefreshWorker.ts`**: Hyperliquid data refresh.
-   **`server/workers/stockRefreshWorker.ts`**: Finnhub, metals, energy futures, and forex data refresh.
-   **`server/workers/notifications.ts`**: Handles various notification job types.
-   **`server/state.ts`**: Manages shared in-process server-side state.

### NPM Packages

-   **@solana/web3.js**: Solana SDK for wallet transactions.

### Environment Variables

-   `FINNHUB_KEY`, `ANTHROPIC_API_KEY`, `RAPIDAPI_KEY`, `CRYPTOPANIC_API_KEY` (optional), `SESSION_SECRET`, `OWNER_CODE`.

### Trade Journal (Elite, Apr 2026)

-   `tradeJournal` table in `shared/schema.ts`. CRUD via `/api/journal` (GET/POST/PATCH/DELETE), all gated by `requireElite`.
-   Screenshot/link import: `POST /api/journal/extract` accepts `imageBase64`+`mediaType` (allowlist: png/jpeg/webp/gif) OR an `http(s)` URL. Calls Claude vision with `CLAUDE_MODEL`, returns parsed `{asset,direction,entry,stop,tp1,tp2,size,notes}`. Route uses a scoped 12mb express.json parser + `aiIpLimiter`. Images NOT persisted.
-   Frontend: `TradeJournalTab` in `client/src/App.jsx`. Import dialog pre-fills the new-trade form. `shareTradeCard()` builds a navy/gold PNG via canvas → Web Share API with download fallback.

### Squawk Box (Elite, Apr 2026)

-   `SquawkBox` in `client/src/App.jsx` auto-announces new signals via SpeechSynthesis. Pulsing green dot indicator (`squawkPulse` keyframe in `client/src/index.css`) shown when LIVE. `emitSquawk(message, "normal"|"urgent")` exported helper lets any component trigger announcements (urgent = higher pitch/rate, cancels queue).

### Email System (Resend)

-   Integrated via Replit connector for sending welcome emails, daily briefs, and promo expiry reminders. Subscribers are managed in a DB table.

### Monetization System (Stripe)

-   Integrated via Replit connector for subscription management. Uses `stripe.*` schema in the database for syncing Stripe data and `public.users` for user tier and subscription IDs.