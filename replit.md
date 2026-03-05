# CLVRQuant v2 | Trade Smarter with AI

## Overview

CLVRQuant v2 is a luxury-styled mobile-first market intelligence dashboard for cryptocurrency, stocks, metals, and forex. It displays real-time data from Binance (crypto spot), Hyperliquid (crypto perps/funding/OI/volume), Finnhub (stocks), gold-api.com (metals), and exchangerate-api.com (forex), plus an AI analyst powered by Anthropic Claude. Features include a macro central bank calendar, AI-powered daily brief, email subscription, price alerts, quant signals, and v2 additions: Radar command center with live alert system, macro countdown timers, volume spike detection, funding rate flip alerts, liquidation heatmap, push notifications, and Phantom wallet integration with Perps PnL calculator.

## User Preferences

Preferred communication style: Simple, everyday language.

## Design System — CLVRQuant Navy/Gold Aesthetic

- **Theme**: Always dark mode (no toggle) — bg:#050709, panel:#0c1220, border:#141e35
- **Gold accent**: #c9a84c (primary), #e8c96d (light), #f7e0a0 (highlight)
- **Fonts**: Playfair Display (SERIF — headers/titles), IBM Plex Mono (MONO — data/labels), Barlow (SANS — body)
- **Design language**: 2px border-radius, letterSpacing 0.15em on labels, subtle gold gradients, grid overlay background on body, serif italic for CTAs
- **Watchlist symbol**: ✦ (not star emoji)
- **Panels**: Matte navy with gold-tinted header backgrounds (rgba(201,168,76,.03))
- **Buttons**: Gold-bordered with serif italic text (e.g. "Analyze", "Subscribe")
- **Font sizing**: Bumped up for iPhone/iPad readability — badges 9px, labels 10px, body 12-13px, panel titles 15px

## System Architecture

### Frontend (client/src/App.jsx)

- **Single-file React app** with inline styles (CLVRQuant theme, not Tailwind for main UI)
- **Data polling**: Crypto every 3s via `/api/crypto`, Finnhub every 15s via `/api/finnhub`, signals/news rotate via 1s tick
- **Bottom nav**: 9 tabs — Radar, Markets, Macro, Brief, Signals, Alerts, Wallet, AI, Guide
- **Max width**: 780px (optimized for iPad as well as iPhone)
- **Radar tab** (v2): Command center with push notification prompt, active alerts panel, live news intelligence, next macro event countdown (Countdown component), upcoming events list, volume spike monitor (6 crypto), funding rate monitor with flip detection, liquidation heatmap (BTC/ETH/SOL/XAU)
- **Markets tab**: Sub-tabs for Crypto (spot/perp), Equities, Metals, Forex
- **Macro tab**: Central bank calendar (FED/ECB/BOJ/BOC/BOE/RBA) + US data events (CPI/NFP/PCE); bank filter; iCal download; Ask AI button
- **Brief tab**: AI-generated morning market commentary with CLVRQuant-branded header, price snapshot, per-asset analysis (serif italic), watch items, key risk, Mike Claver attribution; email subscription form
- **Signals tab**: With watchlist filter, crypto/equity/metals/forex sub-filters
- **Alerts tab**: Custom alerts on price/funding with browser notifications
- **Wallet tab**: Phantom wallet integration (connect/disconnect, SOL balance, SPL tokens, send SOL, sign messages, tx history, perps PnL calculator)
- **AI tab**: Claude-powered analysis with live market context + integrated QuantBrain engine; two buttons: "Analyze" (custom queries) and "Get Today's Trade Ideas + Analysis" (QuantBrain confluence scoring, Kelly Criterion, regime detection, structured trade ideas — all running behind the scenes)
- **Guide tab**: Comprehensive features guide explaining all 11 platform capabilities with data source listing

### Phantom Wallet (client/src/PhantomWallet.jsx)

- **usePhantom hook**: Connects to Phantom browser extension, fetches SOL balance + SPL tokens via Solana RPC
- **Known mints**: USDC, USDT, wSOL, ETH, mSOL, BONK, JUP mapped to symbols
- **Sub-tabs**: Overview, Tokens, Send, Sign, History, PnL Calc
- **sendSOL**: Uses @solana/web3.js (installed) for live SOL transfers via Phantom
- **signMessage**: Wallet authentication via Phantom signMessage
- **PerpsPnlCalculator**: Standalone perps PnL calculator with long/short direction, entry/exit price, size, leverage, maker/taker fees; calculates gross/net PnL, ROE, fees, margin, liquidation price, breakeven
- **Styling**: Matches CLVRQuant navy/gold theme (not the purple/violet default)
- **Available when disconnected**: PnL calculator shown even without wallet connection

#### v2 Components
- **sendPush**: Push notification helper (Notification API)
- **AlertBanner**: Dismissible fixed alert banner at top of screen; color-coded by type (macro=orange, volume=cyan, funding=green, liq=red, price=gold)
- **Countdown**: Live countdown timer with days/hours/min/sec; hot (red <30min), warm (orange <2hr), normal (muted) states; compact mode for inline use
- **LiqHeatmap**: Liquidation/stop cluster visualization; seeded from price levels; green=long liquidations below, red=short liquidations above
- **MACRO_EVENTS**: 16 hardcoded 2026 macro events for frontend countdown timers (FED/ECB/BOJ/BOC/BOE/NFP/CPI/PCE)

#### News Intelligence
- **newsFeed**: Array of live news items from CryptoCompare + Twitter/X (via RapidAPI Twitter API45) + CryptoPanic (when available)
- **newsFilter**: Filter for news by asset (ALL/SOCIAL/BTC/ETH/SOL/XRP/EQUITIES)
- News polling: every 120s via `/api/news`
- News data fed into AI system prompt and morning brief context

#### v2 State and Callbacks
- **notifPerm**: Push notification permission state
- **liqSym**: Selected symbol for liquidation heatmap (BTC/ETH/SOL/XAU)
- **activeAlerts**: Array of active alert objects with type, title, body, assets
- **volRef/fundRef**: Refs tracking volume/funding history for spike/flip detection
- **firedAlerts/macroFired**: Deduplication refs for alerts
- **addAlert**: Creates alert, deduplicates, sends push notification, triggers toast
- **checkVolumeSpike**: Fires alert when volume >5x the 5-period average
- **checkFundingFlip**: Fires alert on funding sign reversal or extreme levels (>0.08%)
- **checkMacroCountdowns**: Fires alerts at 60/30/10/2 minute thresholds before macro events

#### Existing Features
- **Watchlist**: toggle; persisted in state
- **OI sparklines**: SVG sparkline charts for crypto open interest history
- **Share signal**: Copy signal to clipboard with textarea fallback for non-HTTPS
- **Toast**: Gold background, useRef pattern to stabilize callback, 2500ms auto-dismiss
- **Tick interval**: Uses tickRef.current (useRef); runs checkMacroCountdowns every second
- **Fonts**: Playfair Display + IBM Plex Mono + Barlow loaded via @import in App.jsx style tag

### Backend (server/routes.ts)

- **API Routes**:
  - `GET /api/crypto` — Binance spot prices + Hyperliquid funding/OI/volume for 30 tokens, cached 1.5s
  - `GET /api/perps` — Hyperliquid perp prices + funding/OI/volume for 30 tokens
  - `GET /api/news` — Live news from CryptoCompare + Twitter/X influencers via RapidAPI (+ CryptoPanic if available), cached 120s, auto-tags assets
  - `GET /api/finnhub` — Cached Finnhub stock/metal/forex data from background refresh loop
  - `GET /api/signals` — Live-detected signals (>1.5% moves in 5-min window)
  - `GET /api/macro` — FairEconomy calendar, today+ events only, HIGH+MED impact
  - `GET /api/polymarket` — Polymarket gamma API proxy, cached 60s, 17 market slugs
  - `POST /api/ai/analyze` — Anthropic Claude API proxy (max_tokens=1024)
  - `POST /api/subscribe` — Email subscription (in-memory)
- **Hyperliquid background loop**: Every 5s, fetches allMids + metaAndAssetCtxs; stores funding, OI, perpPrice, volume (dayNtlVlm)
- **Finnhub background loop**: 16 stocks x 1.5s delay (60 req/min free tier), refreshes every 120s
- **Forex**: Free exchangerate-api.com (no key)
- **Metals**: gold-api.com free API — XAU/XAG/XPT
- **Macro**: FairEconomy calendar with content-type check; empty results not cached full 10 min
- **Signal detection**: MOVE_THRESHOLD=1.5%, MOVE_WINDOW=5min, SIGNAL_COOLDOWN=10min; windowStart must be >=50% of MOVE_WINDOW old

### Server Stability (server/index.ts)

- **process.exit(1) intercept**: Vite's esbuild service crash handler blocked to keep Express running
- **SIGTERM/SIGINT handlers**: Set shuttingDown flag so real shutdown still works

### Build System

- **Client**: Vite builds React app to `dist/public/`
- **Server**: esbuild bundles Express server to `dist/index.cjs`
- **Dev**: `npm run dev` runs tsx with Vite middleware (HMR)

### Key Files

- `client/src/App.jsx` — Main React dashboard (CLVRQuant v2 with all features)
- `client/src/PhantomWallet.jsx` — Phantom wallet hook, PnL calculator, wallet panel component
- `client/src/QuantBrain.jsx` — Confluence scoring engine, Kelly Criterion, trade setup, regime detection, AI analyst
- `client/src/FeaturesGuide.jsx` — Comprehensive platform features guide
- `client/index.html` — HTML shell with SEO meta tags
- `client/src/main.tsx` — React entry point
- `client/src/index.css` — Tailwind directives + CSS variables (for build pipeline)
- `server/routes.ts` — API proxy routes with caching, background refresh, macro calendar, subscribe, live signal detection, volume tracking, Polymarket proxy
- `server/index.ts` — Express server with process.exit intercept
- `server/vite.ts` — Vite dev middleware (DO NOT EDIT)
- `vite.config.ts` — Vite config (DO NOT EDIT)

## External Dependencies

### APIs
- **Binance** — Free, no API key, crypto spot prices for 26 tokens (primary); MATIC/INJ/TAO/PENDLE fallback to HL
- **Hyperliquid** — Free, no API key, perp prices + funding + OI + 24h volume for 30 tokens (background loop every 5s)
- **CryptoCompare** — Free, no API key, crypto news feed (popular/latest) with sentiment votes
- **CryptoPanic** — API key (env var CRYPTOPANIC_API_KEY), hot news with sentiment (behind Cloudflare, may fail from servers)
- **Finnhub** — Free tier API key (env var FINNHUB_KEY), 16 stock quotes + commodity futures
- **gold-api.com** — Free, no API key, XAU/XAG/XPT spot prices
- **ExchangeRate API** — Free, no API key, 14 forex pairs
- **FairEconomy** — Free, no API key, macro economic calendar
- **Polymarket** — Free gamma-api.polymarket.com, prediction market odds
- **Solana RPC** — Free mainnet RPC (api.mainnet-beta.solana.com) for wallet balance/tokens
- **Anthropic Claude** — Requires `ANTHROPIC_API_KEY` environment variable

### NPM Packages
- **@solana/web3.js** — Solana SDK for wallet send transactions

### Environment Variables
- `FINNHUB_KEY` — Required for stock quotes
- `ANTHROPIC_API_KEY` — Required for AI analyst + daily brief features
- `RAPIDAPI_KEY` — Required for Twitter/X influencer feed (Twitter API45 on RapidAPI)
- `CRYPTOPANIC_API_KEY` — Optional, CryptoPanic news (may be blocked by Cloudflare)
- `SESSION_SECRET` — Available but not currently used
- `OWNER_CODE` — Owner access code for permanent Pro access (default: CLVR-OWNER-2026)

### Email System (Resend)
- **Integration**: Resend via Replit connector (`conn_resend_01KJZGAYDD4MX7AK0VZYKCYMFW`)
- **Client**: `server/resendClient.ts` — uses Replit connector for auth (never cache client)
- **Subscribers**: Persisted in `subscribers` table (email, name, active flag)
- **Daily Brief Scheduler**: `server/dailyBrief.ts` — generates AI brief via Claude + sends to all active subscribers at 6:00 AM ET
- **Email template**: Luxury CLVRQuant-branded HTML with navy/gold theme, key moves table, analysis, watch items, risk level
- **Routes**: `POST /api/subscribe`, `POST /api/unsubscribe`, `POST /api/send-test-brief` (admin test trigger)

## Monetization System (Stripe + Access Codes)

### Tier System
- **Free tier**: Prices, macro calendar, news, 3 alerts
- **Pro tier ($29/mo or $199/yr)**: AI analyst, QuantBrain trade ideas, morning briefs, unlimited alerts, signals, liquidation heatmap, volume/funding monitors

### Stripe Integration
- **Connector**: Replit Stripe integration (`conn_stripe_01KJZEVAXAFW56CC2Q2ZVCHAQ6`)
- **Products**: CLVRQuant Pro (`prod_U5r0eZMxeY4zkz`) with monthly + yearly prices
- **Webhook**: `/api/stripe/webhook` (raw body, before express.json())
- **Backend files**: `server/stripeClient.ts`, `server/webhookHandlers.ts`, `server/seed-products.ts`
- **DB tables**: `stripe.*` schema (auto-synced), `public.users` (tier, stripeCustomerId, stripeSubscriptionId), `public.access_codes`

### Access Code System
- **Owner code**: `OWNER_CODE` env var (default `CLVR-OWNER-2026`) — permanent Pro access
- **VIP codes**: Stored in `access_codes` table with optional max_uses and expiration
- **Verification**: `POST /api/verify-code` checks owner code first, then DB codes

### Frontend Paywall
- **ProGate component**: Wraps Pro features with blur overlay + upgrade CTA
- **Upgrade modal**: Shows Pro features, monthly/yearly Stripe checkout buttons, access code input
- **Header**: Shows PRO badge or UPGRADE button based on tier
- **Persistence**: Tier stored in localStorage (`clvr_tier`), verified via Stripe session or access code

### Stripe API Routes
- `GET /api/stripe/config` — Stripe publishable key
- `GET /api/stripe/products` — Active products with prices from `stripe.*` schema
- `POST /api/stripe/checkout` — Creates Stripe Checkout session
- `GET /api/stripe/subscription` — Verifies subscription from session_id
- `POST /api/stripe/portal` — Customer portal link
- `POST /api/verify-code` — Access code verification
- `GET /api/access-codes` — List access codes (admin)

## Important Notes

- DO NOT edit `server/vite.ts` or `vite.config.ts`
- DO NOT edit `package.json` without user permission
- The app uses inline styles, not Tailwind for the main UI
- All external API calls are proxied through the backend (no API keys in frontend)
- USDCAD displays 4 decimal places
- Email subscribers stored in-memory (not persisted to DB)
- Toast fix: useRef(onDone) pattern with empty dep array prevents re-render loop
- Notification API: always guard with `typeof Notification !== "undefined"`
- Clipboard: check `navigator.clipboard && window.isSecureContext` first, then fallback to `document.execCommand("copy")`
- CLVRQuant is always dark mode — no dark/light toggle
- Crypto volume tracked via Hyperliquid `dayNtlVlm` field
- Signal detection: real only (no simulated), seenSigIds ref for dedup
- AI system prompt includes ALL 30 crypto/16 stocks/7 commodities/14 forex with live prices
- Morning brief JSON extracted via regex `{[\s\S]*}` to handle markdown-wrapped responses
- No fake/mock data anywhere — all live API data only
