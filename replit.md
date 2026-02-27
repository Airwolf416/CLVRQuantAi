# AlphaScan v12 | Perp Intelligence

## Overview

AlphaScan v12 is a mobile-first market intelligence dashboard for cryptocurrency, stocks, metals, and forex. It displays real-time data from Hyperliquid (crypto), Finnhub (stocks), gold-api.com (metals), and exchangerate-api.com (forex), plus an AI analyst powered by Anthropic Claude. New in v12: Macro central bank calendar, AI-powered daily brief, and email subscription.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (client/src/App.jsx)

- **Single-file React app** with inline styles (not Tailwind for main UI)
- **Data polling**: Crypto every 3s via `/api/crypto`, Finnhub every 15s via `/api/finnhub`, signals/news rotate via 1s tick
- **Bottom nav**: 5 tabs — Prices, Macro, Brief, Signals, AI
- **Prices tab**: Sub-tabs for Crypto, Stocks, Metals, Forex
- **Macro tab**: Central bank calendar (FED/ECB/BOJ/BOC/BOE/RBA) + US data events (CPI/NFP/PCE); bank filter; iCal download; Ask AI button
- **Brief tab**: AI-generated morning market commentary with price snapshot, per-asset analysis, watch items, key risk; email subscription form
- **Signals tab**: With watchlist filter, crypto/equity/metals/forex sub-filters
- **AI tab**: Claude-powered analysis with live market context
- **Watchlist**: Star any symbol; persisted in state
- **Price alerts**: Custom alerts on price/funding with browser notifications (guarded with `typeof Notification`)
- **OI sparklines**: SVG sparkline charts for crypto open interest history
- **Dark/light mode**: Toggle via header button with gold border + text label ("LIGHT"/"DARK")
- **Share signal**: Copy signal to clipboard with textarea fallback for non-HTTPS
- **Toast**: useRef pattern to stabilize callback, 2500ms auto-dismiss, empty dependency array
- **Tick interval**: Uses tickRef.current (useRef) instead of tick state in dependency array
- **Font**: IBM Plex Mono (loaded via Google Fonts in index.html)

### Backend (server/routes.ts)

- **API Routes**:
  - `GET /api/crypto` — Proxies Hyperliquid API (allMids + metaAndAssetCtxs), cached 3s
  - `GET /api/finnhub` — Serves cached Finnhub data from background refresh loop (stocks via Finnhub, metals via gold-api.com, forex via exchangerate-api.com)
  - `POST /api/ai/analyze` — Proxies Anthropic Claude API (claude-sonnet-4-20250514)
  - `POST /api/subscribe` — Email subscription (stored in-memory array)
- **Finnhub background loop**: Fetches stocks one at a time with 1.5s gaps to avoid rate limits (60 req/min free tier), refreshes every 120s
- **Forex**: Uses free exchangerate-api.com (no key needed)
- **Metals**: Uses gold-api.com free API (no key needed) — `https://api.gold-api.com/price/XAU` and `/XAG`
- **Caching**: Server-side cache prevents redundant external API calls
- **Fallback**: Returns cached data on API errors; returns static baseline prices on first-time failures

### Server Stability (server/index.ts)

- **process.exit(1) intercept**: Vite's esbuild service occasionally crashes (SIGHUP signal kills the esbuild subprocess), which triggers `process.exit(1)` via vite.ts custom error logger. The intercept blocks this exit to keep the Express server running.
- **SIGTERM/SIGINT handlers**: Set shuttingDown flag so real shutdown still works

### Build System

- **Client**: Vite builds React app to `dist/public/`
- **Server**: esbuild bundles Express server to `dist/index.cjs`
- **Dev**: `npm run dev` runs tsx with Vite middleware (HMR)

### Key Files

- `client/src/App.jsx` — Main React dashboard component (v12 with macro calendar, daily brief, email subscription)
- `client/index.html` — HTML shell with IBM Plex Mono font
- `client/src/main.tsx` — React entry point
- `client/src/index.css` — Tailwind directives + CSS variables (for build pipeline)
- `server/routes.ts` — API proxy routes with caching, background refresh loop, subscribe endpoint
- `server/index.ts` — Express server setup with process.exit intercept
- `server/vite.ts` — Vite dev middleware (DO NOT EDIT — has process.exit(1) on errors)
- `vite.config.ts` — Vite config (DO NOT EDIT)

## External Dependencies

### APIs
- **Hyperliquid** — Free, no API key, crypto mid prices + funding rates + open interest
- **Finnhub** — Free tier API key (env var FINNHUB_KEY), stock quotes only
- **gold-api.com** — Free, no API key, XAU and XAG spot prices
- **ExchangeRate API** — Free, no API key, forex rates
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
- Finnhub free tier only works for stocks; OANDA metals/forex symbols return "no access" on free tier
- Metals use gold-api.com, forex uses exchangerate-api.com as free alternatives
- Email subscribers stored in-memory (not persisted to DB)
- Toast fix: useRef(onDone) pattern with empty dep array prevents re-render loop
- Notification API: always guard with `typeof Notification !== "undefined"`
- Clipboard: check `navigator.clipboard && window.isSecureContext` first, then fallback to `document.execCommand("copy")`
