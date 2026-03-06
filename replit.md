# CLVRQuant v2 | Trade Smarter with AI

## Overview

CLVRQuant v2 is a luxury-styled, mobile-first market intelligence dashboard providing real-time data and AI-powered analysis for cryptocurrency, stocks, metals, and forex. It integrates data from various financial APIs and features an AI analyst powered by Anthropic Claude. Key capabilities include a market intelligence radar, macro-economic calendar, AI-driven daily brief, custom alerts, quant signals, and Phantom wallet integration with a Perps PnL calculator. The project's vision is to empower users with sophisticated, AI-enhanced market insights in a sleek, intuitive interface, targeting both individual traders and financial enthusiasts seeking a competitive edge.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Design System — CLVRQuant Navy/Gold Aesthetic

The application exclusively uses a dark mode theme (`bg:#050709`, `panel:#0c1220`, `border:#141e35`) with a consistent gold accent (`#c9a84c` primary). Typography includes Playfair Display (serif for headers), IBM Plex Mono (monospace for data), and Barlow (sans-serif for body). Design elements feature 2px border-radius, `letterSpacing 0.15em` on labels, subtle gold gradients, a grid overlay background, and serif italic for CTAs. UI components like panels and buttons adhere to this aesthetic, and font sizes are optimized for mobile readability.

### Authentication (client/src/WelcomePage.jsx)

The app is gated by a WelcomePage that shows before the main dashboard. Users can:
- **Create Account**: Name, email, password, optional daily brief opt-in, terms agreement. Sends welcome email via Resend.
- **Sign In**: Email + password authentication with bcrypt.
- **Continue as Guest**: Limited access without an account.

Auth uses express-session with SESSION_SECRET. Routes: POST `/api/auth/signup`, POST `/api/auth/signin`, GET `/api/auth/me`, POST `/api/auth/signout`. The WelcomePage checks `/api/auth/me` on mount for session persistence.

### Frontend (client/src/App.jsx)

The frontend is a React application split into `App` (auth gate) and `Dashboard` (main content) components with inline styles, optimized for a maximum width of 780px. It features a bottom navigation bar with ten tabs: Radar, Markets, Macro, Brief, Signals, Alerts, Wallet, AI, About, and Account.

-   **Radar**: A command center with active alerts, live news, macro event countdowns, volume spike detection, funding rate flip alerts, and a liquidation heatmap.
-   **Markets**: Displays real-time data for Crypto (spot/perp), Equities, Metals, and Forex.
-   **Macro**: Enhanced macro calendar with live ForexFactory data (60s refresh). Features expandable EventCards with actual/forecast/previous values, BEAT/MISS surprise indicators, market impact analysis (NFP, GDP, CPI, retail sales, wages), QuantBrain AI analysis per event, region filters (US/EU/UK/CA/JP/AU), impact filters (HIGH/MED/LOW), Today/Week toggle, Next Release banner, and Add to Calendar. Central bank schedule (MACRO_2026) provides fallback for FOMC/ECB/BOJ/BOC/BOE/RBA dates.
-   **Brief**: Presents an AI-generated daily market commentary with asset analysis and a subscription form.
-   **Signals**: Offers quantifiable trading signals with filtering options.
-   **Alerts**: Allows users to set custom price and funding alerts with browser notifications.
-   **Wallet**: Integrates with Phantom wallet for Solana operations, including a Perps PnL calculator.
-   **AI**: Provides Claude-powered market analysis and trade ideas, leveraging the QuantBrain engine for confluence scoring, Kelly Criterion, and regime detection. Includes a timeframe toggle (Today/Mid-Term/Long-Term) for tailored trade ideas.
-   **About**: Story behind CLVRQuant, why users need it daily, and a comprehensive glossary of technical terms (QuantBrain Score, Alpha Signals, Kelly Criterion, Funding Rate, Open Interest, etc.). Accessible to all users including guests.
-   **Account** (client/src/AccountPage.jsx): User account management with Subscription, Emails, Billing, and Legal tabs. Only visible to authenticated users (not guests).

Key components include `AlertBanner` for notifications, `Countdown` for macro events, and `LiqHeatmap` for liquidation clusters (using real OI data from Hyperliquid + leverage distribution). News intelligence is sourced from CryptoCompare and Twitter/X, and feeds into the AI system. Both AI and Brief tabs include live macro event context in their prompts.

### Backend (server/routes.ts)

The backend provides API routes for all data and AI interactions. It acts as a proxy for external APIs, caching responses to manage rate limits and improve performance.

-   **Data Routes**: `/api/crypto` (Binance, Hyperliquid), `/api/perps` (Hyperliquid), `/api/finnhub` (stocks, metals, forex), `/api/signals`, `/api/macro` (FairEconomy calendar), `/api/polymarket`.
-   **AI Routes**: `/api/ai/analyze` (Anthropic Claude proxy).
-   **Subscription Routes**: `/api/subscribe`.
Background loops are used for refreshing Hyperliquid, Finnhub, and news data at regular intervals. Signal detection identifies significant price movements.

### Monetization System (Stripe + Access Codes)

CLVRQuant implements a tiered monetization model:
-   **Free Tier**: Basic features like prices, macro calendar, news, and limited alerts.
-   **Pro Tier**: Access to AI analysis, QuantBrain trade ideas, morning briefs, unlimited alerts, signals, liquidation heatmap, and volume/funding monitors.

Stripe is integrated for subscription management, handling product definitions, checkout sessions, webhooks, and customer portals. An access code system, including an owner code and VIP codes, provides alternative Pro access. A `ProGate` component in the frontend manages feature access based on the user's tier.

## External Dependencies

### APIs

-   **Binance**: Crypto spot prices.
-   **Hyperliquid**: Crypto perpetual prices, funding rates, open interest, and volume.
-   **CryptoCompare**: Crypto news feed.
-   **Finnhub**: Stock quotes and ETF proxies for energy commodities — USO (WTI), BNO (Brent), UNG (NatGas). SQ maps to XYZ (Block Inc) via EQUITY_FH_MAP. Requires `FINNHUB_KEY`.
-   **gold-api.com**: Precious metals (XAU, XAG, XPT) and base metals (HG/Copper) spot prices.
-   **ExchangeRate API**: Forex pairs.
-   **FairEconomy**: Macroeconomic calendar.
-   **Polymarket**: Prediction market odds.
-   **Solana RPC**: For Phantom wallet balance and token data.
-   **Anthropic Claude**: AI analysis and daily brief generation (requires `ANTHROPIC_API_KEY`).
-   **Twitter API45 (via RapidAPI)**: For Twitter/X influencer feeds (requires `RAPIDAPI_KEY`).
-   **CryptoPanic**: Hot news (optional, requires `CRYPTOPANIC_API_KEY`).

### NPM Packages

-   **@solana/web3.js**: Solana SDK for wallet transactions.

### Environment Variables

-   `FINNHUB_KEY`
-   `ANTHROPIC_API_KEY`
-   `RAPIDAPI_KEY`
-   `CRYPTOPANIC_API_KEY` (optional)
-   `SESSION_SECRET` (required for auth sessions)
-   `OWNER_CODE`

### Email System (Resend)

-   **Integration**: Resend via Replit connector for email sending.
-   **Subscribers**: Stored in `subscribers` DB table. Users can opt-in during signup.
-   **Daily Brief Scheduler**: Generates and sends AI briefs at 6AM ET daily to active subscribers.
-   **Brief Format**: Price table (crypto/forex/metals/equities), per-instrument AI commentary (BTC, EUR/USD, USD/CAD, USD/JPY, Gold & Silver), watch items, risk level, direct app link, PWA install instructions.
-   **Data Source**: Pulls from local server cached APIs (`/api/crypto`, `/api/finnhub`) to avoid external API blocks.
-   **Sender**: Uses `onboarding@resend.dev` fallback when configured sender is Gmail (unverifiable domain).

### Monetization System (Stripe)

-   **Integration**: Stripe via Replit connector for subscription management.
-   **Products**: CLVRQuant Pro with monthly and yearly pricing.
-   **Database**: `stripe.*` schema for syncing Stripe data, `public.users` for user tier and subscription IDs, `public.access_codes` for managing access codes.