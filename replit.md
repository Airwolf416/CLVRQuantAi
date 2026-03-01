# CLVRQuant v1 | Trade Smarter with AI

## Overview

CLVRQuant v1 is a luxury-styled mobile-first market intelligence dashboard for cryptocurrency, stocks, metals, and forex. It displays real-time data from Hyperliquid (crypto), Finnhub (stocks), gold-api.com (metals), and exchangerate-api.com (forex), plus an AI analyst powered by Anthropic Claude. Features include a macro central bank calendar, AI-powered daily brief, email subscription, price alerts, and quant signals.

## User Preferences

Preferred communication style: Simple, everyday language.

## Design System — CLVRQuant Navy/Gold Aesthetic

- **Theme**: Always dark mode (no toggle) — bg:#050709, panel:#0c1220, border:#141e35
- **Gold accent**: #c9a84c (primary), #e8c96d (light), #f7e0a0 (highlight)
- **Fonts**: Playfair Display (SERIF — headers/titles), IBM Plex Mono (MONO — data/labels), Barlow (SANS — body)
- **Design language**: 2px border-radius, letterSpacing 0.15em on labels, subtle gold gradients, grid overlay background on body, serif italic for CTAs
- **Watchlist symbol**: ✦ (not ⭐)
- **Panels**: Matte navy with gold-tinted header backgrounds (rgba(201,168,76,.03))
- **Buttons**: Gold-bordered with serif italic text (e.g. "Analyze →", "Subscribe →")

## System Architecture

### Frontend (client/src/App.jsx)

- **Single-file React app** with inline styles (CLVRQuant theme, not Tailwind for main UI)
- **Data polling**: Crypto every 3s via `/api/crypto`, Finnhub every 15s via `/api/finnhub`, signals/news rotate via 1s tick
- **Bottom nav**: 6 tabs — Markets, Macro, Brief, Signals, Alerts, AI
- **Markets tab**: Sub-tabs for Crypto, Equities, Metals, Forex
- **Macro tab**: Central bank calendar (FED/ECB/BOJ/BOC/BOE/RBA) + US data events (CPI/NFP/PCE); bank filter; iCal download; Ask AI button
- **Brief tab**: AI-generated morning market commentary with CLVRQuant-branded header, price snapshot, per-asset analysis (serif italic), watch items, key risk, Mike Claver attribution; email subscription form
- **Signals tab**: With watchlist filter (✦ Watch), crypto/equity/metals/forex sub-filters
- **Alerts tab**: Custom alerts on price/funding with browser notifications (guarded with `typeof Notification`)
- **AI tab**: Claude-powered analysis with live market context, gold-bordered buttons
- **Watchlist**: ✦ symbol toggle; persisted in state
- **OI sparklines**: SVG sparkline charts for crypto open interest history
- **Share signal**: Copy signal to clipboard with textarea fallback for non-HTTPS
- **Toast**: Gold background, useRef pattern to stabilize callback, 2500ms auto-dismiss
- **Tick interval**: Uses tickRef.current (useRef) instead of tick state in dependency array
- **Fonts**: Playfair Display + IBM Plex Mono + Barlow loaded via @import in App.jsx style tag

### Backend (server/routes.ts)

- **API Routes**:
  - `GET /api/crypto` — Proxies Hyperliquid API (allMids + metaAndAssetCtxs), cached 3s
  - `GET /api/finnhub` — Serves cached Finnhub data from background refresh loop (stocks via Finnhub, metals via gold-api.com, forex via exchangerate-api.com)
  - `GET /api/macro` — FairEconomy calendar, today+ events only, HIGH+MED impact, excludes Bank Holidays; 10-min cache with 1-min retry on empty; fallback hardcoded events for Feb-Mar 2026
  - `POST /api/ai/analyze` — Proxies Anthropic Claude API (claude-sonnet-4-20250514)
  - `POST /api/subscribe` — Email subscription (stored in-memory array)
- **Finnhub background loop**: Fetches stocks one at a time with 1.5s gaps (60 req/min free tier), refreshes every 120s
- **Forex**: Free exchangerate-api.com (no key)
- **Metals**: gold-api.com free API — `/price/XAU` and `/price/XAG`
- **Macro**: Content-type check prevents HTML rate-limit pages from crashing JSON parser; empty results are not cached for full 10 minutes
- **Caching**: Server-side cache prevents redundant external API calls
- **Fallback**: Returns cached data on API errors; returns static baseline prices on first-time failures

### Server Stability (server/index.ts)

- **process.exit(1) intercept**: Vite's esbuild service crash handler blocked to keep Express running
- **SIGTERM/SIGINT handlers**: Set shuttingDown flag so real shutdown still works

### Build System

- **Client**: Vite builds React app to `dist/public/`
- **Server**: esbuild bundles Express server to `dist/index.cjs`
- **Dev**: `npm run dev` runs tsx with Vite middleware (HMR)

### Key Files

- `client/src/App.jsx` — Main React dashboard (CLVRQuant v1 reskin with all features)
- `client/index.html` — HTML shell with SEO meta tags
- `client/src/main.tsx` — React entry point
- `client/src/index.css` — Tailwind directives + CSS variables (for build pipeline)
- `server/routes.ts` — API proxy routes with caching, background refresh, macro calendar, subscribe, live signal detection
- `server/index.ts` — Express server with process.exit intercept
- `server/vite.ts` — Vite dev middleware (DO NOT EDIT)
- `vite.config.ts` — Vite config (DO NOT EDIT)

## External Dependencies

### APIs
- **Binance US** — Free, no API key, crypto spot last traded prices for 26 tokens (primary price source); MATIC/INJ/TAO/PENDLE fallback to HL
- **Hyperliquid** — Free, no API key, perp mid-prices + funding rates + open interest for 30 tokens (background loop every 5s); also provides spot fallback for non-Binance tokens
- **Finnhub** — Free tier API key (env var FINNHUB_KEY), 16 stock quotes + commodity futures (CL=WTI, BZ=Brent, NG=NatGas, HG=Copper)
- **gold-api.com** — Free, no API key, XAU/XAG/XPT (Platinum) spot prices
- **ExchangeRate API** — Free, no API key, 14 forex pairs (11 USD-based + 3 cross pairs)
- **FairEconomy** — Free, no API key, macro economic calendar (rate-limited)
- **Anthropic Claude** — Requires `ANTHROPIC_API_KEY` environment variable

### Environment Variables
- `FINNHUB_KEY` — Required for stock quotes
- `ANTHROPIC_API_KEY` — Required for AI analyst + daily brief features
- `SESSION_SECRET` — Available but not currently used

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
