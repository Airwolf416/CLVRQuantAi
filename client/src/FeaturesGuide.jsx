const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", inputBg:"#080d18",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

const SECTIONS = [
  {
    title: "Radar Command Center",
    icon: "01",
    items: [
      "Real-time push notifications for market-moving events",
      "Active alert panel with dismissible banners (volume spikes, funding flips, macro events, price signals)",
      "Live macro event countdown timers with days/hours/min/sec",
      "Volume spike detector — fires when volume exceeds 5x the 5-period average",
      "Funding rate monitor with flip detection — alerts on bullish/bearish funding reversals and extreme levels",
      "Liquidation heatmap for BTC, ETH, SOL, and XAU — visualizes stop/liquidation cluster zones",
      "Upcoming events list showing next 5 central bank and economic data releases",
    ],
  },
  {
    title: "Markets & Prices",
    icon: "02",
    items: [
      "32 cryptocurrency tokens with live spot prices from Binance (updates every 3 seconds)",
      "Spot/Perp toggle — view perpetual futures prices, funding rates, open interest, and 24h volume from Hyperliquid",
      "OI sparkline charts showing open interest trends",
      "16 equities from Yahoo Finance + FMP (TSLA, NVDA, AAPL, GOOGL, META, MSFT, AMZN, and more)",
      "7 commodities including gold (XAU), silver (XAG), platinum, oil (WTI/Brent), natural gas, and copper",
      "14 forex pairs (EUR/USD, GBP/USD, USD/JPY, and more) from ExchangeRate API",
      "24-hour change percentage with green/red color coding",
    ],
  },
  {
    title: "Macro Calendar",
    icon: "03",
    items: [
      "Central bank rate decisions: FED, ECB, BOJ, BOC, BOE, RBA",
      "Economic data releases: CPI, NFP, PCE, and more",
      "Filter by bank or view all upcoming events",
      "Impact level indicators (HIGH, MEDIUM)",
      "iCal download for any event — add directly to your calendar",
      "Ask AI button — get CLVR AI's take on any macro event",
      "Auto-sourced from FairEconomy calendar API",
    ],
  },
  {
    title: "Morning Brief",
    icon: "04",
    items: [
      "AI-generated daily market commentary powered by CLVR AI (Claude)",
      "Price snapshot of top assets at time of generation",
      "Per-asset analysis with actionable insight (not generic summaries)",
      "Watch items and key risk callouts",
      "Mike Claver attribution and CLVRQuant branding",
      "Email subscription form — get the brief delivered to your inbox",
    ],
  },
  {
    title: "Alpha Signals",
    icon: "05",
    items: [
      "Live-detected signals based on 1.5% price moves within 5-minute windows",
      "Tracks all 30+ crypto tokens, equities, metals, and forex",
      "Signal cooldown prevents duplicate alerts (10-minute window)",
      "Filter by asset class: Crypto, Equities, Metals, Forex",
      "Share signal to clipboard with one tap",
      "Signal strength and direction indicators (bullish/bearish)",
    ],
  },
  {
    title: "Custom Price Alerts",
    icon: "06",
    items: [
      "Set above/below price alerts on any asset",
      "Set funding rate threshold alerts on crypto perpetuals",
      "Browser push notifications when alerts trigger",
      "Alert management — view and delete active alerts",
      "Powered by the Notification API with graceful fallbacks",
    ],
  },
  {
    title: "Phantom Wallet",
    icon: "07",
    items: [
      "Connect Phantom browser extension for Solana wallet integration",
      "Live SOL balance display (via secure backend RPC proxy)",
      "SPL token portfolio — view all token holdings with known symbol mapping",
      "Send SOL — live Solana transfers signed through Phantom",
      "Sign messages — wallet authentication and message signing",
      "Transaction history tracking",
      "Perps PnL Calculator — calculates gross/net PnL, ROE, fees, margin, liquidation price, and breakeven for leveraged trades",
      "Works on mobile (Phantom app in-browser) and desktop (extension)",
    ],
  },
  {
    title: "QuantBrain AI",
    icon: "08",
    items: [
      "8-factor confluence scoring engine: funding rate, volume spike, OI trend, Polymarket odds (BTC/Fed), social sentiment, liquidation heatmap, Fear & Greed index",
      "Kelly Criterion position sizing — mathematically optimal bet sizing based on edge",
      "Full Kelly, Half Kelly, Quarter Kelly, and Fixed 1% position size recommendations",
      "Regime detection — identifies momentum vs mean reversion markets",
      "Win probability estimation using Bayesian scoring",
      "Expected value calculator per trade",
      "Trade setup builder with entry/target/stop/R:R calculation",
      "AI Analyst mode — sends all signal data to CLVR AI for structured trade ideas with cross-asset reasoning",
      "Auto-populates from live Hyperliquid data when available",
    ],
  },
  {
    title: "CLVRQuant AI Analyst",
    icon: "09",
    items: [
      "CLVR AI market analysis with full context (all live prices, news, signals) — powered by Claude",
      "Quick-access asset chips — one tap to ask about BTC, ETH, SOL, TRUMP, HYPE, XAU, EURUSD, TSLA, NVDA",
      "Free-form question input — ask anything about any market",
      "System prompt includes all 30+ crypto, 16 stocks, 7 commodities, 14 forex pairs with real-time prices",
      "News intelligence feed integrated into AI context",
    ],
  },
  {
    title: "News Intelligence",
    icon: "10",
    items: [
      "Aggregated from CryptoCompare, Twitter/X (RapidAPI), and CryptoPanic",
      "Auto-tagged by asset (BTC, ETH, SOL, XRP, etc.)",
      "Filterable by asset or SOCIAL (Twitter/X posts)",
      "Integrated into Radar tab, AI context, and morning brief",
      "Updates every 120 seconds",
    ],
  },
  {
    title: "PWA & Mobile",
    icon: "11",
    items: [
      "Progressive Web App — installable on iOS and Android home screen",
      "Optimized for iPhone and iPad (max-width 780px)",
      "Safe area insets for notch/Dynamic Island devices",
      "8-tab bottom navigation with overflow scroll",
      "Bloomberg-style sound notifications (optional)",
      "Dark mode only — premium navy/gold aesthetic",
    ],
  },
];

export default function FeaturesGuide() {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 900, color: C.white, marginBottom: 6 }}>CLVRQuant Features</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.15em" }}>COMPLETE PLATFORM GUIDE</div>
      </div>

      {SECTIONS.map((section, idx) => (
        <div key={idx} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${C.border}`, background: "rgba(201,168,76,.03)" }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 900, color: C.gold, minWidth: 28 }}>{section.icon}</div>
            <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700, color: C.white }}>{section.title}</div>
          </div>
          <div style={{ padding: "10px 14px" }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: i < section.items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ color: C.gold, fontSize: 8, marginTop: 5, flexShrink: 0 }}>✦</span>
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.7, fontFamily: SANS }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ background: C.panel, border: `1px solid rgba(201,168,76,.18)`, borderRadius: 2, padding: "16px 14px", marginBottom: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.15em", marginBottom: 10 }}>DATA SOURCES</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[
            "Binance (crypto spot)",
            "Hyperliquid (perps/funding/OI)",
            "Yahoo Finance + FMP (equities, forex, commodities)",
            "ExchangeRate API (forex)",
            "gold-api.com (metals)",
            "CryptoCompare (news)",
            "CryptoPanic (news)",
            "Twitter/X via RapidAPI",
            "FairEconomy (macro calendar)",
            "Polymarket (predictions)",
            "Solana RPC (wallet)",
            "Anthropic Claude (AI)",
          ].map(src => (
            <div key={src} style={{ fontSize: 11, color: C.muted2, fontFamily: MONO, padding: "4px 0" }}>{src}</div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "20px 0 10px" }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 14, color: C.gold2, marginBottom: 6 }}>Built by Mike Claver</div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.12em" }}>CLVRQUANT v2 · AI-POWERED MARKET INTELLIGENCE</div>
      </div>
    </div>
  );
}
