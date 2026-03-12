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
- **Create Account**: Name, email, password, optional daily brief opt-in, terms agreement, optional referral code field. Sends welcome email via Resend. Auto-generates CLVR-REF-XXXXXX referral code.
- **Sign In**: Email + password authentication with bcrypt. "Forgot Password?" link opens email form.
- **Forgot Password**: Sends temporary password + reset link via Resend email. Token expires in 1 hour.
- **Reset Password**: Via URL token (?reset=TOKEN) — allows setting new password.
- **Continue as Guest**: Limited access without an account.

Auth uses express-session with SESSION_SECRET. Routes: POST `/api/auth/signup`, POST `/api/auth/signin`, GET `/api/auth/me`, POST `/api/auth/signout`, POST `/api/auth/forgot-password`, POST `/api/auth/reset-password`. The WelcomePage checks `/api/auth/me` on mount for session persistence and URL for reset tokens.

### Frontend (client/src/App.jsx)

The frontend is a React application split into `App` (auth gate) and `Dashboard` (main content) components with inline styles, optimized for a maximum width of 780px. It features a bottom navigation bar with ten tabs: Radar, Markets, Macro, Brief, Signals, Alerts, Wallet, AI, About, and Account.

-   **Radar**: A command center with Market Regime panel (RISK_ON/NEUTRAL/RISK_OFF with score bar + component breakdown), CLVR Crash Detector (probability gauge + status badge), Global Liquidity Index (score + expansion/contraction mode), active alerts, live news, macro event countdowns, volume spike detection, funding rate flip alerts, and a liquidation heatmap. All regime data from `/api/regime` (60s polling — reduced from 30s for cost).
-   **Markets**: Displays real-time data for Crypto (spot via Binance WebSocket ~16ms, perp via Hyperliquid), Equities, Metals, and Forex. Bloomberg-style tick animations: prices flash green/red with ↑↓ arrows on every tick direction change. Market status badges: Equities show LIVE/CLOSED based on NYSE hours (9:30am–4pm ET, Mon–Fri), Forex shows LIVE/CLOSED based on forex hours (Sun 5pm–Fri 5pm ET).
-   **Macro**: Enhanced macro calendar with live ForexFactory data (60s refresh). Features expandable EventCards with actual/forecast/previous values, BEAT/MISS surprise indicators, market impact analysis (NFP, GDP, CPI, retail sales, wages), QuantBrain AI analysis per event, region filters (US/EU/UK/CA/JP/AU), impact filters (HIGH/MED/LOW), Today/Week toggle, Next Release banner, and Add to Calendar. Central bank schedule (MACRO_2026) provides fallback for FOMC/ECB/BOJ/BOC/BOE/RBA dates.
-   **Brief**: Presents an AI-generated daily market commentary with asset analysis and a subscription form.
-   **Signals**: QuantBrain-scored trading signals with Entry/Target(3×ATR)/StopLoss(1.5×ATR) levels, Strength Meter (bullProbability), High Confidence filter (>75%), whale-aligned glow animation (gold-pulse CSS), MasterScore/riskOn display, AI Trade Reasonings, and "Trade Now" button opening glassmorphism TradeConfirmationModal with capital protection (disabled at MasterScore<35). NotificationManager prevents duplicate alerts via hash-based deduplication. French i18n labels: Entrée, Objectif, Arrêt des Pertes.
-   **Alerts**: Allows users to set custom price and funding alerts with browser notifications. Alerts are persisted to the `user_alerts` database table via API (GET/POST/DELETE `/api/alerts`, POST `/api/alerts/:id/trigger`). Alerts auto-expire after 1 month; expired alerts are cleaned up hourly. Alert banners auto-dismiss after 5 seconds.
-   **Wallet**: Integrates with Phantom wallet for Solana operations, including a Perps PnL calculator. Now includes full Hyperliquid account integration: EVM address linking (localStorage), live clearinghouseState (account value, withdrawable, margin used, unrealized PnL), open perp positions with mark PnL, open orders, and AI-powered personalized trade signals using Claude that factor in the trader's live portfolio exposure. Tabs: Overview, HL Account, Positions, AI Signal, Orders, Tokens, Send, Sign, History, PnL Calc.
-   **AI**: Provides Claude-powered market analysis and trade ideas, leveraging the QuantBrain engine for confluence scoring, Kelly Criterion, and regime detection. Includes a timeframe toggle (Today/Mid-Term/Long-Term) for tailored trade ideas. Now features AI Trade Reasonings section showing MasterScore-enriched signals with Entry/Target/StopLoss and "Trade Now" buttons.
-   **About**: Story behind CLVRQuant, why users need it daily, and a comprehensive glossary of technical terms (QuantBrain Score, Alpha Signals, Kelly Criterion, Funding Rate, Open Interest, etc.). Accessible to all users including guests.
-   **Account** (client/src/AccountPage.jsx): User account management with Plan (subscription + promo code status with expiry countdown + pause/resume/cancel buttons), Referral (referral code display + copy button + how-it-works guide), Emails, Billing (billing status card with next due date, billing history, payment method management), and Legal tabs. Stripe endpoints: POST `/api/stripe/pause` (pause_collection), POST `/api/stripe/resume`, POST `/api/stripe/cancel` (cancel_at_period_end). Portal uses session auth (no client-supplied customerId). Only visible to authenticated users (not guests).

Key components include `AlertBanner` for notifications, `Countdown` for macro events, and `LiqHeatmap` for liquidation clusters (using real OI data from Hyperliquid + leverage distribution). News intelligence is sourced from CryptoCompare and Twitter/X, and feeds into the AI system. Both AI and Brief tabs include live macro event context in their prompts.

**i18n / Language Toggle**: EN/FR toggle button in header (between PRO badge and OUT button). Stored in localStorage (`clvr_lang`). Full LANG_EN/LANG_FR dictionaries cover all Radar labels, signal fields, tab names, regime/crash/liquidity terms. Module-level `i18n` variable is updated on toggle via `getI18n(lang)`. Note: `let i18n` is mutable at module scope — toggling updates it and triggers re-render via `setLang`.

### Backend (server/routes.ts)

The backend provides API routes for all data and AI interactions. It acts as a proxy for external APIs, caching responses to manage rate limits and improve performance.

-   **Data Routes**: `/api/crypto` (Binance, Hyperliquid), `/api/perps` (Hyperliquid), `/api/finnhub` (stocks, metals, forex), `/api/signals` (with globalRiskOn, whaleAlerts), `/api/whales`, `/api/macro` (FairEconomy calendar), `/api/polymarket`, `/api/regime` (Market Regime + Crash Detector + Liquidity Index).
-   **AI Routes**: `/api/ai/analyze` (Anthropic Claude proxy).
-   **Subscription Routes**: `/api/subscribe`.
-   **Regime Engine**: `calcMarketRegime()` (Crypto 35%/Equities 35%/Metals 15%/Forex 15%), `calcCrashProbability()` (Volatility 40%/Liquidity 30%/EquityTrend 20%/CryptoStress 10%), `calcLiquidityIndex()` (credit/bond/breadth scoring). VIX approximated via UVXY ETF proxy. 30s cache TTL.
-   **Referral System**: Auto-generates CLVR-REF-XXXXXX on signup, `checkAndGrantReferralReward()` grants 1 week Pro when referred user upgrades.
-   **Promo Expiry Reminder**: `checkPromoExpiryReminders()` runs daily, emails users 14 days before promo expiration.
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