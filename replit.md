# AlphaScan v10 | Perp Intelligence

## Overview

AlphaScan v10 is a market intelligence dashboard for cryptocurrency, stocks, metals, and forex. It displays real-time data from Hyperliquid (crypto) and Finnhub (stocks/metals/forex), and includes an AI analyst feature powered by Anthropic's Claude. The UI has a dark, monospace terminal aesthetic styled with IBM Plex Mono font and inline CSS.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (client/src/App.jsx)

- **Single-file React app** with inline styles (not Tailwind for main UI)
- **Data polling**: Crypto every 5s, Finnhub every 15s, signals/news every 60s
- **Sections**: Crypto (with funding/OI), Stocks, Metals, Forex, Signals, News, AI Analyst
- **AI Analyst**: Sends market context to `/api/ai/analyze` for Claude analysis
- **Font**: IBM Plex Mono (loaded via Google Fonts in index.html)
- **Theme**: Dark (#04060d background), green accents

### Backend (server/routes.ts)

- **API Routes**:
  - `GET /api/crypto` — Proxies Hyperliquid API (allMids + metaAndAssetCtxs), cached 2s
  - `GET /api/finnhub` — Proxies Finnhub API for stocks/metals/forex, cached 10s
  - `POST /api/ai/analyze` — Proxies Anthropic Claude API (claude-sonnet-4-20250514)
- **Caching**: Server-side cache prevents redundant external API calls from multiple browser tabs
- **Fallback**: Returns cached data on API errors; returns static baseline prices on first-time failures

### Server Stability (server/index.ts)

- **process.exit(1) intercept**: Vite's esbuild service occasionally crashes (SIGHUP signal kills the esbuild subprocess), which triggers `process.exit(1)` via vite.ts custom error logger. The intercept blocks this exit to keep the Express server running.
- **Logging**: API request logging without response bodies (to avoid excessive log output)

### Build System

- **Client**: Vite builds React app to `dist/public/`
- **Server**: esbuild bundles Express server to `dist/index.cjs`
- **Dev**: `npm run dev` runs tsx with Vite middleware (HMR)

### Key Files

- `client/src/App.jsx` — Main React dashboard component
- `client/index.html` — HTML shell with IBM Plex Mono font
- `client/src/main.tsx` — React entry point
- `client/src/index.css` — Tailwind directives + CSS variables (for build pipeline)
- `server/routes.ts` — API proxy routes with caching
- `server/index.ts` — Express server setup with process.exit intercept
- `server/vite.ts` — Vite dev middleware (DO NOT EDIT — has process.exit(1) on errors)
- `vite.config.ts` — Vite config (DO NOT EDIT)

## External Dependencies

### APIs
- **Hyperliquid** — Free, no API key, crypto mid prices + funding rates + open interest
- **Finnhub** — Free tier API key (hardcoded in routes.ts), stock quotes
- **Anthropic Claude** — Requires `ANTHROPIC_API_KEY` environment variable

### Environment Variables
- `ANTHROPIC_API_KEY` — Required for AI analyst feature
- `SESSION_SECRET` — Available but not currently used

## Important Notes

- DO NOT edit `server/vite.ts` or `vite.config.ts`
- DO NOT edit `package.json` without user permission
- The app uses inline styles, not Tailwind for the main UI
- Two browser tabs may connect via Vite HMR (Replit preview + webview); caching handles this
