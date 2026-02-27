# AlphaScan v11 | Perp Intelligence

## Overview

AlphaScan v11 is a market intelligence dashboard for cryptocurrency, stocks, metals, and forex. It displays real-time data from Hyperliquid (crypto) and Finnhub (stocks/metals/forex), and includes an AI analyst feature powered by Anthropic's Claude. The UI has a dark/light mode, monospace terminal aesthetic styled with IBM Plex Mono font and inline CSS.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (client/src/App.jsx)

- **Single-file React app** with inline styles (not Tailwind for main UI)
- **Data polling**: Crypto every 3s, Finnhub every 15s, signals/news rotate via 1s tick
- **Bottom nav**: 5 tabs — Prices, Watch, Signals, Alerts, AI
- **Prices tab**: Sub-tabs for Crypto, Stocks, Metals, Forex
- **Watchlist**: Star any symbol to add to watchlist; persisted in state
- **Price alerts**: Create custom alerts on price/funding with browser notifications
- **OI sparklines**: SVG sparkline charts for crypto open interest history
- **Dark/light mode**: Toggle via header button; theme colors stored in DARK/LIGHT objects
- **Share signal**: Copy signal details to clipboard
- **Price flash animations**: Green/red background flash on price changes
- **AI Analyst**: Sends market context to `/api/ai/analyze` for Claude analysis
- **Font**: IBM Plex Mono (loaded via Google Fonts in index.html)

### Backend (server/routes.ts)

- **API Routes**:
  - `GET /api/crypto` — Proxies Hyperliquid API (allMids + metaAndAssetCtxs), cached 3s
  - `GET /api/finnhub` — Serves cached Finnhub data from background refresh loop
  - `POST /api/ai/analyze` — Proxies Anthropic Claude API (claude-sonnet-4-20250514)
- **Finnhub background loop**: Fetches stocks one at a time with 1.5s gaps to avoid rate limits (60 req/min free tier), refreshes every 120s
- **Forex**: Uses free exchangerate-api.com (no key needed)
- **Metals**: Uses Finnhub OANDA symbols (XAU_USD, XAG_USD)
- **Caching**: Server-side cache prevents redundant external API calls
- **Fallback**: Returns cached data on API errors; returns static baseline prices on first-time failures

### Server Stability (server/index.ts)

- **process.exit(1) intercept**: Vite's esbuild service occasionally crashes (SIGHUP signal kills the esbuild subprocess), which triggers `process.exit(1)` via vite.ts custom error logger. The intercept blocks this exit to keep the Express server running.
- **SIGTERM/SIGINT handlers**: Set shuttingDown flag so real shutdown still works
- **Logging**: API request logging without response bodies

### Build System

- **Client**: Vite builds React app to `dist/public/`
- **Server**: esbuild bundles Express server to `dist/index.cjs`
- **Dev**: `npm run dev` runs tsx with Vite middleware (HMR)

### Key Files

- `client/src/App.jsx` — Main React dashboard component (v11 with bottom nav, watchlist, alerts, sparklines, dark/light mode)
- `client/index.html` — HTML shell with IBM Plex Mono font
- `client/src/main.tsx` — React entry point
- `client/src/index.css` — Tailwind directives + CSS variables (for build pipeline)
- `server/routes.ts` — API proxy routes with caching and background refresh loop
- `server/index.ts` — Express server setup with process.exit intercept
- `server/vite.ts` — Vite dev middleware (DO NOT EDIT — has process.exit(1) on errors)
- `vite.config.ts` — Vite config (DO NOT EDIT)

## External Dependencies

### APIs
- **Hyperliquid** — Free, no API key, crypto mid prices + funding rates + open interest
- **Finnhub** — Free tier API key (env var FINNHUB_KEY), stock/metals/forex quotes
- **ExchangeRate API** — Free, no API key, forex rates
- **Anthropic Claude** — Requires `ANTHROPIC_API_KEY` environment variable

### Environment Variables
- `FINNHUB_KEY` — Required for stock/metals quotes
- `ANTHROPIC_API_KEY` — Required for AI analyst feature
- `SESSION_SECRET` — Available but not currently used

## Important Notes

- DO NOT edit `server/vite.ts` or `vite.config.ts`
- DO NOT edit `package.json` without user permission
- The app uses inline styles, not Tailwind for the main UI
- All external API calls are proxied through the backend (no API keys in frontend)
- Two browser tabs may connect via Vite HMR (Replit preview + webview); caching handles this
