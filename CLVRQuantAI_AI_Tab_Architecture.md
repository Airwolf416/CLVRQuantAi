# CLVRQuantAI — AI Tab Full Architecture Export
**Generated: April 15, 2026**
**Purpose: Complete context document for Claude or any LLM to understand the AI tab system**

---

## TABLE OF CONTENTS
1. [System Overview](#1-system-overview)
2. [File Map](#2-file-map)
3. [AI Tab Modes](#3-ai-tab-modes)
4. [Mode 1: AI Analyst (Chat)](#4-mode-1-ai-analyst-chat)
5. [Mode 2: Quant Engine (MasterBrain)](#5-mode-2-quant-engine-masterbrain)
6. [Kronos Forecast Engine](#6-kronos-forecast-engine)
7. [Trade Ideas Generator](#7-trade-ideas-generator)
8. [Morning Brief](#8-morning-brief)
9. [Data Layer: DataBusContext](#9-data-layer-databuscontext)
10. [Data Layer: TwitterIntelligence](#10-data-layer-twitterintelligence)
11. [Data Layer: MarketDataStore](#11-data-layer-marketdatastore)
12. [My Basket](#12-my-basket)
13. [Server Routes & Auth](#13-server-routes--auth)
14. [Asset Configuration](#14-asset-configuration)
15. [System Prompts (Complete)](#15-system-prompts-complete)
16. [Signal Validation & Suppression](#16-signal-validation--suppression)
17. [Pricing & Tier Gating](#17-pricing--tier-gating)
18. [Critical Rules & Constraints](#18-critical-rules--constraints)

---

## 1. SYSTEM OVERVIEW

CLVRQuantAI is a luxury mobile-first market intelligence dashboard (navy/gold, Playfair Display + IBM Plex Mono) with real-time data across crypto, equities, commodities, and forex. The AI tab is the core intelligence layer.

**Stack:**
- Frontend: React (JSX, no TypeScript), Vite, inline styles (no CSS framework)
- Backend: Express.js (TypeScript), PostgreSQL
- AI: Claude Sonnet 4 (`claude-sonnet-4-6`) via Anthropic API
- Data: Hyperliquid WebSocket (perps/spot), Finnhub (equities/commodities), CoinGecko (crypto spot), Stocktwits (social)
- Design: Navy (#050709 / #080d18) + Gold (#c9a84c / #e8c96d), Playfair Display (serif), IBM Plex Mono (mono), Barlow (sans)

**Model constant:** `CLAUDE_MODEL = "claude-sonnet-4-6"` defined in `server/config.ts`

---

## 2. FILE MAP

| File | Lines | Purpose |
|------|-------|---------|
| `client/src/App.jsx` | ~4651 | Main dashboard. Contains AI Analyst chat, Trade Ideas, Morning Brief, mode toggle, all system prompts for chat/brief/trades |
| `client/src/tabs/AITab.jsx` | 1342 | Quant Engine (MasterBrain) — asset browser, risk profiles, scan execution, signal cards |
| `client/src/components/KronosPanel.jsx` | 401 | Kronos Forecast Engine — 5-candle trajectory forecasting (BULL/BASE/BEAR) |
| `client/src/components/MyBasket.jsx` | 520 | Personalized basket analysis — 100+ global assets, Elite-only |
| `client/src/store/TwitterIntelligence.jsx` | 394 | Social intelligence layer — Stocktwits polling, sentiment, whale tracking |
| `client/src/context/DataBusContext.jsx` | 130 | Central data bus — regime, fear/greed, kill switch, prices, funding, OI |
| `client/src/store/MarketDataStore.jsx` | — | Hyperliquid WebSocket store for perps + spot |
| `server/routes.ts` | ~5325 | All API routes including `/api/quant`, `/api/ai/analyze`, `/api/kronos`, `/api/twitter`, `/api/databus/status` |
| `server/config/assets.ts` | 179 | Asset symbol arrays, base prices, exchange mappings, backtest win rates |
| `server/config.ts` | — | `CLAUDE_MODEL` constant |

---

## 3. AI TAB MODES

The AI tab (`tab === "ai"`) has a mode toggle at App.jsx line 4259-4267:

```
┌─────────────────────────────────────────────┐
│  ◆ AI ANALYST  │  ⚡ QUANT ENGINE           │
│  (Pro+)        │  (Elite only)              │
└─────────────────────────────────────────────┘
```

- **`aiMode === "chat"`** → AI Analyst (free-form chat with Claude, trade ideas, morning brief)
- **`aiMode === "quant"`** → Quant Engine (MasterBrain multi-asset scan)

State: `const [aiMode, setAiMode] = useState("chat")`

**Tier gating:**
- AI Analyst: `isPro` (Pro or Elite)
- Quant Engine: `isElite` only, wrapped in `<ProGate feature="quant-engine" tier="elite">`

---

## 4. MODE 1: AI ANALYST (CHAT)

**Location:** App.jsx lines 4268-4339
**Route:** `POST /api/ai/analyze`

### UI Components (inside AI Analyst panel):
1. **Asset quick-chips**: BTC, ETH, SOL, TRUMP, HYPE, XAU, WTI, EURUSD, TSLA, NVDA — clicking prefills `aiInput`
2. **Analyze PERP Markets button** — builds perp snapshot string, sets `aiInput`
3. **Analyze SPOT Markets button** — builds spot snapshot string, sets `aiInput`
4. **Free-form text input** (`AIInput` component)
5. **"Analyze →" button** → calls `runAI()`
6. **Timeframe selector**: Today / Mid-Term (1-4 wks) / Long-Term (1-3 mo) — controls `aiTimeframe`
7. **"Get Top 4 Trade Ideas" button** → calls `runTradeIdeas()`
8. **Output area**: Text output or `<TradeIdeasDisplay>` component based on `aiOutputMode`
9. **TwitterSignalPanel** — shows social intelligence for detected ticker
10. **AI Trade Reasonings** — displays live signal reasoning cards

### `runAI()` Flow (App.jsx line 2647-2780):
1. Assembles 3-section data snapshot:
   - **SECTION A — HYPERLIQUID PERP DATA** (live streaming, <1s latency): Mark prices, funding rates, OI for all crypto/equity/commodity perps
   - **SECTION B — HYPERLIQUID SPOT DATA** (live): Spot prices from HL
   - **SECTION C — ADDITIONAL MARKET DATA** (30-120s delayed): CoinGecko crypto, Finnhub equities, commodities, forex
2. Also injects: Live signals, news feed, political alpha, conflict events, SEC insider buying, macro events, store mode/regime, crash probability, liquidation heatmap, Polymarket odds, Twitter context
3. Builds comprehensive system prompt (see Section 15)
4. Calls `POST /api/ai/analyze` with `{system, userMessage: aiInput}`
5. Displays response as plain text in output area

---

## 5. MODE 2: QUANT ENGINE (MASTERBRAIN)

**Location:** `client/src/tabs/AITab.jsx` (1342 lines)
**Route:** `POST /api/quant`
**Component:** `<AITab />` (exported as `AIQuantTab` alias used in App.jsx)

### UI Flow (Step-by-Step):
1. **STEP 1 — Risk Profile**: Conservative / Balanced / Aggressive
2. **STEP 2 — Asset Browser**: Search + filter 160+ assets across CRYPTO, EQUITY, COMMODITY, FX, INDEX. Select 1-5 assets.
3. **STEP 3 — Market Type**: PERP or SPOT (crypto only; equities/FX/commodities always SPOT)
4. **STEP 4 — Time Horizon**: Today (scalp-intraday) / Mid-Term (1-4 weeks) / Long-Term (1-3 months)
5. **Custom Prompt** (optional textarea)
6. **Kronos Panel** (embedded, collapsible)
7. **Execute MasterBrain Scan** button

### Risk Profiles:
```javascript
CONSERVATIVE: SL=2.5×ATR, Leverage=1-3x, Risk=1%, MinWinProb=85%, TP ratios=[2.0, 4.0]
BALANCED:     SL=1.8×ATR, Leverage=3-7x, Risk=2%, MinWinProb=80%, TP ratios=[1.5, 3.0]
AGGRESSIVE:   SL=1.2×ATR, Leverage=5-15x, Risk=4%, MinWinProb=75%, TP ratios=[1.2, 2.5]
```

### Timeframes:
```javascript
today: { interval: "15m", count: 200 }  // Scalp-Intraday
mid:   { interval: "4h",  count: 300 }  // 1-4 weeks
long:  { interval: "1d",  count: 200 }  // 1-3 months
```

### `runQuantScan()` Flow (AITab.jsx line 991-1053):
1. Iterates `selectedAssets` sequentially (not parallel)
2. For each ticker:
   a. Calls `buildAssetTwitterContext(twitterData, ticker)` for social context
   b. POSTs to `/api/quant` with `{ticker, marketType, userQuery, riskId, timeframeId, assetClass, twitterContext}`
   c. Computes R:R if not provided by API
   d. Stores `{ticker, result, error, fundingRate}`
3. Results displayed as:
   - **ScanSummaryBanner**: Assets scanned, signals found, regime, crash prob, macro warning
   - **SignalCard** (top 3 qualifying): Entry/TP1/TP2/SL grid, leverage, R:R, duration, edge factors, Bayesian meter, multi-TF confluence, Fear & Greed, pattern detection
   - **SuppressedCard**: Blocked signals with suppression rules
   - **Error cards**

### Qualifying Signal Criteria (client-side):
```javascript
qualifyingSignals = scanResults.filter(r =>
  r.result &&
  r.result.signal !== "SUPPRESSED" &&
  r.result.signal &&
  r.result.entry?.price &&
  (r.result.rr == null || r.result.rr >= 1.3)
).sort((a,b) => (b.result.win_probability||0) - (a.result.win_probability||0));
```
Top 3 displayed as SignalCards.

### Sub-Components in AITab.jsx:
- `AssetBrowser` — 160+ asset grid with live prices, funding, OI badges
- `ScanSummaryBanner` — scan results header with regime, crash prob, macro warning
- `SignalCard` — full signal display with entry/TP/SL, conviction bar, tier badge, edge factors, advanced quant detail (Bayesian, multi-TF, F&G, patterns, indicators)
- `SuppressedCard` — blocked signal with rules
- `NoSignalsState` — shown when 0 qualifying signals
- `LoadingBrain` — animated loading with step progress
- `BayesianMeter` — animated probability gauge with tier
- `MultiTFStrip` — 15m/4h/1d trend alignment visualization
- `FearGreedPanel` — sentiment gauge
- `PatternPanel` — detected chart patterns (bull flag, bear flag, H&S, double top/bottom)
- `StatBox` / `LevelRow` — data display helpers

---

## 6. KRONOS FORECAST ENGINE

**Frontend:** `client/src/components/KronosPanel.jsx` (401 lines)
**Route:** `POST /api/kronos`
**Tier:** Elite only
**Token budget:** 1200 max_tokens

### UI:
- Collapsible panel with header showing ensemble signal badge
- Asset selector: BTC, ETH, SOL, HYPE, DOGE, AVAX, XRP, LINK, NVDA, TSLA, XAU, CL
- Timeframe: 15m, 1H, 4H, 1D
- "Run Kronos Forecast" button
- Results: Ensemble signal (STRONG_LONG to STRONG_SHORT), confidence %, volatility regime, 3 trajectory cards (BULL/BASE/BEAR) with sparklines and 5-candle price paths, key levels (support/resistance), sequence pattern

### Server Flow (routes.ts line 3311-3480):
1. Auth check — Elite tier required
2. Fetches 48 candles via `fetchQuantCandles(ticker, cls, timeframe, 48)`
3. Normalizes to OHLCV, takes last 24 candles
4. Computes log returns, historical volatility, next-candle range estimate
5. Formats OHLCV string (T-23 → T+0)
6. Calls Claude with Kronos system prompt (see Section 15)
7. Parses JSON response, repairs if needed
8. Backfills volatility forecast if AI didn't provide it
9. Kronos flip push notification: if ensemble signal changed from prior call with confidence ≥ 65%, broadcasts push notification

### Response JSON shape:
```json
{
  "asset": "BTC",
  "timeframe": "4h",
  "current_price": 84000,
  "ensemble_signal": "LONG",
  "ensemble_confidence": 72,
  "volatility_forecast": { "regime": "MODERATE", "annualized_pct": 45.2, "next_candle_range_pct": 1.8, "note": "..." },
  "trajectories": {
    "bull": { "probability": 45, "prices": [84100, 84500, 85200, 86000, 87000], "final_pct_change": 3.57, "catalyst": "...", "label": "..." },
    "base": { "probability": 35, "prices": [...], ... },
    "bear": { "probability": 20, "prices": [...], ... }
  },
  "key_levels": { "resistance": 86000, "support": 82000 },
  "sequence_pattern": "Ascending triangle with higher lows...",
  "model_note": "..."
}
```

---

## 7. TRADE IDEAS GENERATOR

**Location:** App.jsx `runTradeIdeas()` (lines 2782-2854)
**Route:** `POST /api/ai/analyze` (same as chat, but with trade-specific system prompt)
**Token budget:** 4096 max_tokens
**Output mode:** `aiOutputMode = "trades"` → renders via `<TradeIdeasDisplay>`

### Flow:
1. Computes confluence score from BTC funding rate, volume spike, OI trend
2. Determines regime (MOMENTUM or MEAN REVERSION)
3. Computes Bayesian probability and Kelly criterion
4. Assembles market data (same 3-section format as AI Analyst)
5. Builds trade-specific system prompt with strict JSON output format
6. Timeframe options: INTRADAY/SWING, MID-TERM (1-4 week), LONG-TERM (1-3 month)

### Expected JSON Response:
```json
{
  "generated": "ISO-DATE",
  "regime": { "score": 63, "label": "RISK-ON", "bias": "Mean-Reversion" },
  "macroStatus": { "clear": true, "nextEvent": "...", "notes": "..." },
  "volRegime": "HIGH",
  "trades": [
    {
      "rank": 1, "asset": "INJ/USDT", "direction": "LONG", "tradeType": "DAY TRADE",
      "entry": 3.29, "sl": 3.07,
      "tp1": { "price": 3.58, "pct": 50, "rr": "1.3:1" },
      "tp2": { "price": 3.82, "pct": 30, "rr": "2.4:1" },
      "tp3": { "price": 4.10, "pct": 20, "trailing": true },
      "leverage": "3x", "killClock": "24H", "conviction": 72,
      "edge": "72%", "edgeSource": "estimated",
      "thesis": "Short thesis here.",
      "invalidation": "Break below $3.07 with volume",
      "flags": ["Small OI", "HIGH vol"],
      "scores": { "trend": 75, "momentum": 80, "structure": 68, "oi": 65, "volume": 55, "macro": 70 },
      "postTp1": "SL to breakeven at $3.29"
    }
  ]
}
```

---

## 8. MORNING BRIEF

**Location:** App.jsx `generateBrief()` (lines 2601-2644)
**Route:** `POST /api/ai/analyze` with `maxTokens: 4000`
**Output:** Parsed JSON stored in `briefData` state

### Brief JSON Structure:
```json
{
  "headline": "5-layer insight headline",
  "bias": "RISK ON|RISK OFF|NEUTRAL",
  "macroRisk": "HIGH|NORMAL",
  "btc": "2-3 sentences",
  "eth": "2 sentences",
  "sol": "1-2 sentences",
  "xau": "2-3 sentences",
  "xag": "1 sentence",
  "eurusd": "2-3 sentences",
  "usdjpy": "2-3 sentences",
  "usdcad": "2-3 sentences",
  "watchToday": ["7 actionable items"],
  "keyRisk": "single sentence",
  "topTrade": { "asset", "dir", "entry", "stop", "tp1", "tp2", "confidence", "edge", "riskLabel", "flags" },
  "additionalTrades": [3 more trades]
}
```

---

## 9. DATA LAYER: DataBusContext

**File:** `client/src/context/DataBusContext.jsx` (130 lines)
**Route polled:** `GET /api/databus/status` every 30 seconds

### Provided Context Values:
```javascript
{
  regime:      { score: 50, label: "NEUTRAL"|"RISK_ON"|"RISK_OFF", trend: "sideways" },
  fearGreed:   { value: 50, classification: "Neutral", signal: "neutral" },
  killSwitch:  { active: false, reason: null, expiresAt: null, nearest_event: null },
  prices:      {},     // 48 symbols price map
  funding:     {},     // 32 crypto perps funding rates
  oi:          {},     // 32 crypto perps open interest
  freshness:   null,   // ms since last backend tick
  macroEvents: [],     // upcoming macro events
  loading:     true,
  lastFetch:   null,
  error:       null,
  refetch:     () => {},
}
```

### Helper Exports:
- `mapRegimeLabel(label)` — RISK_ON → "BULL_TREND", RISK_OFF → "BEAR_TREND"
- `regimeMultiplier(label)` — RISK_ON → 1.1, RISK_OFF → 0.7, else 1.0
- `fearGreedColor(value)` — color gradient from red (extreme fear) to green (extreme greed)

### Usage:
- `AITab.jsx` uses `useDataBus()` for regime, killSwitch, macroEvents, prices, funding, oi
- App.jsx uses it for regime display, kill switch warnings

---

## 10. DATA LAYER: TwitterIntelligence

**File:** `client/src/store/TwitterIntelligence.jsx` (394 lines)
**Route polled:** `GET /api/twitter` (Stocktwits) every 4 minutes
**Architecture:** Module-level singleton store (not React context)

### Hook: `useTwitterIntelligence()`
Returns:
```javascript
{
  whales:       [],    // whale account tweets
  mentions:     {},    // per-ticker mention data { count1h, sentimentScore, bullishCount, bearishCount, isSpiking }
  breaking:     [],    // breaking news tweets
  sentiment:    { score: 50, label: "NEUTRAL", totalTweets: 0, weightedScore: 50, sampleSize: "..." },
  aiContext:    "",    // pre-formatted context string
  loading:      false,
  hasKey:       true,  // always true (key on server)
  hasData:      false,
  fetchedAtStr: "",
  timeAgo:      fn,
  refresh:      fn,
}
```

### `buildAssetTwitterContext(data, ticker)` — Per-Asset AI Context Builder:
Generates a multi-line string for injection into AI prompts:
- Ticker mention count, sentiment score, bull/bear ratio
- Spike warnings
- Relevant whale tweets (top 2)
- Breaking tweets (top 2)
- Overall social mood

### Exported Components:
1. **`TwitterSentimentBadge`** — compact header badge showing sentiment score + label
2. **`TwitterMarketModeStrip`** — market tab strip with sentiment bar + mention spikes
3. **`TwitterSignalPanel`** — collapsible panel for AI tab showing per-ticker intelligence
4. **`TwitterMorningBrief`** — full brief panel with sentiment grid, whale activity, breaking tweets

---

## 11. DATA LAYER: MarketDataStore

**File:** `client/src/store/MarketDataStore.jsx`
**Protocol:** Hyperliquid WebSocket (wss://api.hyperliquid.xyz/ws)

Provides live streaming data for:
- **Perps** (`storePerps`): Mark price, 24h change, funding rate, open interest for all HL-listed assets
- **Spot** (`storeSpot`): Spot prices and 24h change

Key function: `fmtPrice(price)` — formats price for display

**CRITICAL:** File is `.jsx` — all imports must use explicit `.jsx` extension.

---

## 12. MY BASKET

**File:** `client/src/components/MyBasket.jsx` (520 lines)
**Tier:** Elite only
**Location:** Below AI Analyst/Quant Engine in AI tab (App.jsx lines 4341-4354)

### Asset Database (100+ global assets):
- **Crypto** (12): BTC, ETH, SOL, HYPE, XRP, DOGE, AVAX, LINK, BNB, ADA, SUI, DOT
- **Equities — N. America** (25): AAPL, NVDA, MSFT, GOOGL, AMZN, META, TSLA, MSTR, AMD, PLTR, COIN, NFLX, JPM, V, XOM, WMT, BAC, UNH, DIS, CRM + Canadian (RY, TD, CNQ, SU, BCE)
- **Equities — Europe** (12): ASML, SAP, NESN, LVMH, SHEL, HSBA, AZN, NVO, SIEGY, TTE, BP, ULVR
- **Equities — Middle East** (6+): Saudi Aramco, SABIC, Emirates NBD, QNB Group, etc. (includes halal flag)
- **Equities — Asia** (9+): TSM, BABA, TCEHY, Samsung, SoftBank, Toyota, etc.
- **Commodities** (16+): XAU, XAG, WTI, BRENT, NATGAS, COPPER, PLATINUM, WHEAT, CORN, etc.
- **Forex** (10+): EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, etc.

Max 5 assets selected at once.

### Props received from App.jsx:
```javascript
isPro, onUpgrade, aiLoading, setAiLoading, setAiOutput,
storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices
```

---

## 13. SERVER ROUTES & AUTH

### `/api/ai/analyze` (POST) — routes.ts line 3168
- **Auth:** Pro or Elite (checks `getEffectiveTier()`)
- **Rate limit:** 60 AI requests/hour via `checkAiRateLimit()`
- **IP rate limit:** `aiIpLimiter` middleware
- **Cache:** Shared response cache keyed by `hashPrompt(system, userMessage)`, TTL = 5 minutes
- **Model:** `CLAUDE_MODEL` (claude-sonnet-4-6)
- **Max tokens:** Caller-specified (default 1500, max 8192)
- **Tool use:** Supports `get_market_quote` tool (Yahoo Finance live quotes) — max 3 tool rounds
- **Input:** `{ system, userMessage, maxTokens? }`
- **Output:** `{ text, response, cached, model }`
- **Maintenance detection:** Credit balance errors return `{ error: "__MAINTENANCE__" }` (status 503)

### `/api/quant` (POST) — routes.ts line 2681
- **Auth:** Pro or Elite
- **Rate limit:** Same 60/hour
- **Input:** `{ ticker, marketType, userQuery, riskId, timeframeId, assetClass, twitterContext }`
- **Server-side computation before AI call:**
  1. Fetches candles: primary TF + 15m + 4h + 1d + 1h
  2. Computes indicators (EMA20/50/200, RSI, MACD, ATR, volume, momentum)
  3. Multi-TF confluence (EMA9 vs EMA21 on 15m/4h/1d)
  4. Pattern detection (bull flag, bear flag, H&S, double top/bottom)
  5. Bayesian brain score
  6. Macro kill switch check
  7. Signal suppression rules (6-rule engine)
  8. Validation gate: OI factor, macro factor, session factor, momentum factor
  9. Adjusted score, P_win, Expected Value, Kelly criterion
  10. Fibonacci entry levels (0.382 conservative / 0.500 aggressive)
  11. Formation timing, entry window, hold times
- **Hard blocks before AI call:** OI < $5M, negative EV, hard suppression
- **Post-AI processing:**
  1. JSON repair (markdown stripping, trailing comma removal)
  2. Attach server-computed data (indicators, multi_tf, bayesian, macro, patterns, fear_greed)
  3. Enforce pre-computed values (adjusted_score, ev, position_size — cannot be overridden by AI)
  4. Duration validation: must be one of `["2-4 hours", "12-24 hours", "2-3 days", "1-2 weeks"]`
  5. Direction/TP/SL validation: corrects inverted levels, recalculates gain_pct and rr_ratio
  6. Remove TP3 if conditions not met (adj_score < 85 or OI < $100M)
  7. Compute RR if missing

### `/api/kronos` (POST) — routes.ts line 3311
- **Auth:** Elite only
- **Input:** `{ ticker, timeframe }`
- **Max tokens:** 1200
- **Post-processing:** Backfills volatility forecast, adds `generated_at`, flip push notifications

### `/api/twitter` (GET) — routes.ts line 1363
- **Auth:** None (public)
- **Source:** Stocktwits API
- **Cache:** 4 minutes

### `/api/databus/status` (GET)
- **Auth:** None (public)
- **Refresh cadence:** Backend refreshes every 30 seconds
- **Returns:** regime, fearGreed, killSwitch, prices (48 symbols), funding (32 crypto), OI (32 crypto), freshness, macroEvents

---

## 14. ASSET CONFIGURATION

**File:** `server/config/assets.ts` (179 lines)

### Symbol Arrays:
```typescript
CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP",
  "BNB","ADA","DOT","POL","UNI","AAVE","NEAR","SUI","APT","OP",
  "TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"]  // 32 assets

EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR",
  "COIN","NFLX","HOOD","ORCL","TSM","GME","RIVN","BABA","HIMS","CRCL"]  // 20 assets

HL_PERP_SYMS = [same as CRYPTO_SYMS with kPEPE instead of PEPE]
```

### Quant Engine Asset Library (AITab.jsx):
160+ assets across:
- CRYPTO LARGE_CAP (14): BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE, DOT, POL, LINK, LTC, UNI, ATOM
- CRYPTO MID_CAP (28): HYPE, HBAR, TIA, FET, NEAR, SUI, APT, ARB, OP, INJ, SEI, AAVE, ONDO, RENDER, PENDLE, JUP, TAO, WIF, TRUMP, PEPE, BONK, FLOKI, WLD, EIGEN, PYTH, STX, MANTA, ALT, DYM, STRK, ZK, BLAST
- CRYPTO SMALL_CAP (9): POPCAT, MEW, BOME, NEIRO, PNUT, ACT, VIRTUAL, AI16Z, GRIFFAIN
- EQUITY LARGE_CAP (20): AAPL, MSFT, NVDA, TSLA, META, GOOGL, AMZN, NFLX, AMD, COIN, MSTR, PLTR, HOOD, SOFI, RKLB, IONQ, SMCI, ARM, CRWD, PANW
- EQUITY LEVERAGED_ETF (7): SQQQ, TQQQ, SOXS, SOXL, UVXY, SPXU, SPXL
- COMMODITY METALS (3): XAU, XAG, COPPER + ENERGY (4): CL, NG, NATGAS, HG
- FX MAJOR (7): EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD + CROSS (2): EURJPY, GBPJPY + COMMODITY_FX (1): XAUUSD
- INDEX (8): SPX, NDX, DJI, VIX, DAX, FTSE, NIKKEI, HSI

### HL Scale Factors:
```typescript
HL_SCALE_FACTORS = { kPEPE: 0.001 }  // 1 kPEPE = 1000 PEPE, multiply markPx by 0.001
```

### Session Thresholds:
```typescript
ASIAN:   { minMove: 1.2%, minVolMult: 2.0, minOI: $5M }
LONDON:  { minMove: 0.8%, minVolMult: 1.5, minOI: $3M }
NY:      { minMove: 0.8%, minVolMult: 1.5, minOI: $3M }
POST_NY: { minMove: 1.0%, minVolMult: 2.0, minOI: $5M }
```

### Backtest Win Rates:
```
LONG_pattern_bull_flag_NY: 68%    SHORT_pattern_head_shoulders_NY: 67%
LONG_pattern_double_bottom_NY: 66%  SHORT_pattern_double_top_NY: 65%
LONG_DEFAULT_NY: 57%              SHORT_DEFAULT_NY: 56%
```

---

## 15. SYSTEM PROMPTS (COMPLETE)

### 15a. AI Analyst System Prompt (App.jsx line 2689-2767)

```
You are CLVRQuantAI's AI Analyst for leveraged perp futures across crypto, FX, commodities, and equities. Be direct, data-driven, no fluff.

RULES — apply to EVERY output:

1. TRADE TYPE: Classify as SCALP (1-4H hold), DAY TRADE (4-24H), SWING (1-7D), or POSITION (1-4W). Default to DAY TRADE if unclear.

2. VOLATILITY REGIME: Compare current ATR to 20-period avg ATR on the trade type's reference timeframe.
   HIGH (ATR>1.5x avg): compress TP 30%, widen SL 20%, reduce size 25%.
   NORMAL (0.7-1.5x): standard params.
   LOW (ATR<0.7x): skip or reduce size 50%.

3. ATR-SCALED TP/SL — reference timeframes: SCALP=ATR(1H), DAY=ATR(4H), SWING=ATR(1D), POSITION=ATR(1W).
   TP1=0.5x ATR (50% position), TP2=1x ATR (30%), TP3=1.5x ATR (20% trailing).
   SL: SCALP=0.3-0.5x ATR, DAY=0.5-0.75x ATR, SWING=0.75-1x ATR, POSITION=1-1.5x ATR.
   Minimum R:R to TP1 must be 1.2:1 or reject the signal.

4. KILL CLOCK: SCALP=2-4H, DAY=12-24H, SWING=48-72H, POSITION=5-7D.

5. MACRO GATE: Block signals within 2H of FOMC/CPI/NFP/BOJ/ECB/BOE.

6. OI OVERLAY (when available): OI rising+price rising=bullish, OI rising+price falling=bearish, etc.

7. EDGE LABELING: Always state "OI-verified", "estimated", or "no OI".

8. POST-TP1: Move SL to breakeven. After TP2: trail SL at 0.5x ATR.

OUTPUT FORMAT for signals:
[EMOJI] [ASSET]/USDT [DIRECTION] — [TRADE TYPE]
Vol Regime: [🔴/🟡/🟢] [HIGH/NORMAL/LOW]
Entry: [price] | TP1-3 | SL: [price]
R:R: [X:1] | Edge: [X]% | Kill: [X]H | Leverage: [X]x
Thesis | Invalidation | Post-TP1 plan

DATA USAGE PROTOCOL:
→ PERP/futures question → use SECTION A (HL mark price + funding + OI are definitive)
→ SPOT question → use SECTION B first, SECTION C as confirmation
→ EQUITY/COMMODITY → HL synthetic perps in SECTION A for futures; SECTION C for cash/spot
→ FOREX → SECTION C only (no HL forex perpetuals)
→ If SECTION A and SECTION C differ by >0.5% → flag basis difference, trust SECTION A

End every signal with CLVR SIGNAL block:
━━━ CLVR SIGNAL ━━━
🔥/⚡/⚠️/❌ TIER [1/2/3/NO TRADE] | [ASSET] [LONG/SHORT]
Entry/SL/TP1/TP2, Leverage, Conviction, Kelly, Edge, Flags, Audit
```

### 15b. Quant Engine (MasterBrain) System Prompt (routes.ts line 2902-3031)

```
You are CLVRQuantAI Signal Engine — a precision trade signal generator for leveraged perpetual futures. Think like Paul Tudor Jones + Stan Druckenmiller. Capital preservation first. Never force a trade.

PROFILE: [CONSERVATIVE|BALANCED|AGGRESSIVE]
Leverage: Xx-Yx | Risk/trade: Z% | Min win prob: W%
TP1 ratio: X:1 | TP2 ratio: Y:1 | Horizon: [...]

SECTION 1 — SIGNAL VALIDATION GATE (pre-computed — DO NOT recalculate)
  Open Interest, Macro Risk, Session, Momentum Speed
  ADJUSTED SCORE, P_WIN, EXPECTED VALUE, KELLY f*

SECTION 2 — ENTRY: FIBONACCI RETRACEMENT (MANDATORY — never enter at spike top)
  Conservative (0.382 fib) and Aggressive (0.500 fib) levels
  Entry window timing

SECTION 3 — HOLD TIME & EXIT TIMING
  Duration categories, SL management rules

SECTION 4 — TAKE PROFIT
  TP1 (60%), TP2 (30%), TP3 (10% runner — conditional)

ABSOLUTE RULES:
1. win_probability < minWinProb → NEUTRAL
2. NEVER set entry at spike high
3. SL below structural low with ATR buffer
4. R:R ≥ 1.5:1 required
5-8. Leverage range, hold times, indicator confluence, risk flags

DIRECTION CONSISTENCY CHECK
ASSET CONSTRAINT: Only analyze the specified ticker
OUTPUT LENGTH: quant_rationale MAX 2 sentences, invalidation MAX 2 sentences
DURATION: Only "2-4 hours", "12-24 hours", "2-3 days", "1-2 weeks"
DIRECTION VALIDATION: TP levels must match direction

JSON output schema: { signal, win_probability, adjusted_score, entry, stopLoss, tp1, tp2, tp3?, leverage, hold, position_size, technical_summary, quant_rationale, risks, risk_flags, invalidation }
```

### 15c. Kronos System Prompt (routes.ts line 3365-3401)

```
You are the Kronos Forecast Engine — a probabilistic K-line sequence model inspired by the Kronos foundation model (AAAI 2026, arXiv:2508.02739). You analyze OHLCV sequences using autoregressive pattern recognition to generate multi-trajectory price forecasts.

Methodology:
1. Analyze K-line sequence for momentum, mean-reversion, volatility, pivots
2. Generate 3 trajectories (BULL/BASE/BEAR) with 5 future candles each
3. Assign probabilities summing to 100
4. Derive ensemble signal
5. Estimate forward volatility regime

KRONOS OVERLAY: Only fire when ALL conditions met: edge>72%, vol NORMAL/HIGH, macro clear, OI confirms, 3+ factors >70, R:R ≥ 1.5:1.
```

### 15d. Trade Ideas System Prompt (App.jsx line 2818-2840)

```
You are CLVRQuantAI's Trade Idea Generator. Return EXACTLY 4 trade ideas as JSON.

RULES:
- 4 trades, ranked by conviction (highest first)
- Diverse assets (mix crypto, equity, FX, commodity)
- ATR-scaled TP/SL
- Vol regime check
- Macro gate: block if high-impact within 2H
- Min R:R to TP1: 1.2:1
- Kill clock: SCALP 2-4H, DAY 12-24H, SWING 48-72H
- Edge labeling: "OI-verified", "estimated", or "no OI"
- Timeframe focus: [TODAY|MID-TERM|LONG-TERM]
```

### 15e. Macro AI System Prompt (App.jsx line 2512)

```
You are QuantBrain, an elite quantitative market intelligence analyst for CLVRQuant. Provide concise, data-driven analysis of economic releases. Focus on: 1) What the data means for markets, 2) Which assets most affected, 3) How this changes the macro picture, 4) What to watch next.
```

### 15f. Morning Brief System Prompt (App.jsx line 2617)

```
You are CLVR AI — elite quantitative trading analyst, powered by Claude. Generate a morning brief for [DATE] using the 5-layer trading framework. ALL data below is REAL and LIVE.

LAYER 1 — MACRO REGIME (risk warnings)
LAYER 2 — LIVE MARKET DATA (all asset classes)
LAYERS 3-5: Session awareness, min R:R 1.5:1, 🔴/🟡/🟢 risk labels

Output JSON with: headline, bias, macroRisk, btc/eth/sol/xau/xag/eurusd/usdjpy/usdcad analysis, watchToday[7], keyRisk, topTrade + 3 additionalTrades
```

---

## 16. SIGNAL VALIDATION & SUPPRESSION

### Pre-AI Validation Gate (routes.ts lines 2750-2852):

**OI Factor:**
- < $5M → HARD BLOCK (0)
- < $10M → 0.60
- < $20M → 0.70
- < $100M → 0.90
- ≥ $100M → 1.00

**Macro Factor:**
- Safe → 1.00
- HIGH impact warning → 0.75
- Other warning → 0.85

**Session Factor:**
- Weekend → 0.75
- NY Open 90min (9:30-11:00 ET) → 1.10
- London Open 90min (8:00-9:30 ET) → 1.05
- Asia/Off-hours (21:00-3:00 ET) → 0.85
- Regular → 1.00

**Momentum Factor:**
- ATR% > 1.5% → 0.70 (spike, too fast)
- ATR% 0.5-1.5% → 1.00 (normal)
- ATR% < 0.5% → 1.10 (slow, sustained)

**Adjusted Score:** `rawScore × oiFactor × macroFactor × sessionFactor × momentumFactor`

**Signal Tier:**
- < 55 → BLOCKED
- < 65 → WATCH_ONLY
- < 75 → MED
- < 85 → HIGH
- ≥ 85 → STRONG

**Hard Blocks (before AI call):**
1. OI factor = 0 → SUPPRESSED
2. EV ≤ 0 → SUPPRESSED
3. Signal suppression rules (6-rule engine) → SUPPRESSED if hard

### Post-AI Server-Side Enforcement:
1. **Duration validation:** Must be exactly one of `["2-4 hours", "12-24 hours", "2-3 days", "1-2 weeks"]`
2. **Direction/TP/SL validation:** If LONG, TP > entry, SL < entry (and vice versa for SHORT). Inverted levels are corrected with recalculated gain_pct and rr_ratio.
3. **TP3 removal:** Deleted unless adj_score ≥ 85 AND OI > $100M
4. **Pre-computed values override AI:** adjusted_score, ev, position_size (tier, kelly_fraction, margin_pct)

---

## 17. PRICING & TIER GATING

### Tiers:
- **Free**: Live market data, 1 morning brief idea
- **Pro** ($19/mo): AI Analyst (30/day), QuantBrain signals, alerts, 4 trade ideas
- **Elite** ($49/mo): Everything in Pro + Quant Engine (MasterBrain), Kronos, My Basket, SEC Insider Flow, Squawk Box, unlimited AI chat

### Auth Flow:
- Session-based (`req.session.userId`)
- `getEffectiveTier(user)` returns "free", "pro", or "elite"
- Owner email: `OWNER_EMAIL = "mikeclaver@gmail.com"` (module-level constant in routes.ts — always gets elite)

### Rate Limits:
- 60 AI requests per hour per user
- IP-based rate limiting via `aiIpLimiter` middleware
- AI response cache: 5 minute TTL, keyed by prompt hash

---

## 18. CRITICAL RULES & CONSTRAINTS

1. **NO WATCHLIST** — Watchlist has been permanently removed. Never add it back in any nav, pricing, or feature reference.
2. **Duration allowlist (strict):** `["2-4 hours", "12-24 hours", "2-3 days", "1-2 weeks"]` — exact string match enforced server-side.
3. **SL/TP minimums:** SL=1.5%, TP1=2.5%, TP2=4.0%. ATR multipliers: rawStop=3.0x, rawTP1=5.0x, rawTP2=9.0x
4. **quant_rationale:** MAX 2 sentences. Barlow italic rendering.
5. **MarketDataStore is `.jsx`** — all imports must use explicit `.jsx` extension.
6. **Never define React components inside Dashboard function** — module-level only.
7. **Do NOT edit `server/vite.ts` or `vite.config.ts`**.
8. **AI Model:** `claude-sonnet-4-6` in `server/config.ts`
9. **Deployment:** `git add -A && git commit -m "..." && git push origin main` from Shell. Railway auto-deploys. Do NOT use Replit publish.
10. **Direction validation is server-enforced** — if AI returns inverted TP/SL levels relative to signal direction, the server corrects them and recalculates gain_pct and rr_ratio.
11. **JSON output robustness** — Both `/api/quant` and `/api/kronos` use a `repairJson()` function that strips markdown fences, trailing commas, and extracts JSON from mixed text.
12. **Signal qualifying criteria (client-side):** signal !== "SUPPRESSED", has entry price, R:R ≥ 1.3. Top 3 by win_probability displayed.
13. **Twitter context is per-asset** — `buildAssetTwitterContext()` filters whale/breaking/mention data for the specific ticker being analyzed.
14. **Kronos flip notifications** — When ensemble signal changes between calls with confidence ≥ 65%, push notification is broadcast.

---

*End of architecture export. This document contains the complete AI tab system for CLVRQuantAI as of April 15, 2026.*
