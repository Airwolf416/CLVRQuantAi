// ── News context for the signal gate ─────────────────────────────────────────
// Live signal gating reads from a small in-memory cache (no DB round-trip),
// refreshed every 5 minutes from CryptoPanic. Headlines are crudely classified
// into bullish / bearish / neutral via keyword matching, and a severity is
// derived from event keywords. The persistent `news_items` table is written
// fire-and-forget elsewhere (see lib/newsPersist) for later analytics.

const CPANIC_KEY = process.env.CRYPTOPANIC_API_KEY || "";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CachedNewsItem {
  externalId: string;
  title: string;
  source: string;
  tickers: string;
  sentiment: "bullish" | "bearish" | "neutral";
  severity: "low" | "medium" | "high";
  url: string;
  createdAt: number;            // ms epoch
}

let cache: { items: CachedNewsItem[]; ts: number } = { items: [], ts: 0 };

// ── Heuristic classifiers ────────────────────────────────────────────────────
const BULLISH_KW = [
  "rally", "surge", "soar", "jump", "all-time high", "ath", "breakout", "approval",
  "approves", "approved", "buy", "bullish", "upgrade", "beat", "beats", "record",
  "inflows", "etf approved", "halving", "accumulation", "partnership", "launch",
];
const BEARISH_KW = [
  "crash", "plunge", "tumble", "selloff", "sell-off", "rejected", "reject", "ban",
  "hack", "exploit", "lawsuit", "sec sues", "sec charges", "investigation",
  "downgrade", "miss", "misses", "outflow", "outflows", "liquidation",
  "bearish", "warning", "halts", "halted", "recession", "default", "fraud",
];
const HIGH_SEVERITY_KW = [
  "fomc", "fed decision", "rate decision", "cpi", "ppi", "nfp", "non-farm",
  "etf approved", "etf approval", "etf rejected", "war", "invasion", "strike",
  "ceasefire", "sec sues", "sec charges", "indicted", "arrested", "exploit",
  "hack", "halts", "halted", "default", "bankruptcy", "emergency",
];
const MEDIUM_SEVERITY_KW = [
  "earnings", "guidance", "fed minutes", "lagarde", "powell", "boj", "boe",
  "opec", "tariff", "sanction", "downgrade", "upgrade", "partnership",
];

function classifyTitle(title: string): { sentiment: CachedNewsItem["sentiment"]; severity: CachedNewsItem["severity"] } {
  const t = title.toLowerCase();
  let sentiment: CachedNewsItem["sentiment"] = "neutral";
  if (BEARISH_KW.some((k) => t.includes(k))) sentiment = "bearish";
  else if (BULLISH_KW.some((k) => t.includes(k))) sentiment = "bullish";

  let severity: CachedNewsItem["severity"] = "low";
  if (HIGH_SEVERITY_KW.some((k) => t.includes(k))) severity = "high";
  else if (MEDIUM_SEVERITY_KW.some((k) => t.includes(k))) severity = "medium";

  return { sentiment, severity };
}

// Map each tradeable asset to news keywords (ticker first, broader tags after)
const ASSET_NEWS_MAP: Record<string, string[]> = {
  BTC: ["BTC", "BITCOIN", "CRYPTO"],
  ETH: ["ETH", "ETHEREUM", "CRYPTO"],
  SOL: ["SOL", "SOLANA", "CRYPTO"],
  XRP: ["XRP", "RIPPLE", "CRYPTO"],
  BNB: ["BNB", "BINANCE", "CRYPTO"],
  DOGE: ["DOGE", "DOGECOIN", "CRYPTO"],
  ADA: ["ADA", "CARDANO", "CRYPTO"],
  AVAX: ["AVAX", "AVALANCHE"],
  LINK: ["LINK", "CHAINLINK"],
  DOT: ["DOT", "POLKADOT"],
  ARB: ["ARB", "ARBITRUM"],
  OP: ["OP", "OPTIMISM"],
  NEAR: ["NEAR"],
  SUI: ["SUI"],
  APT: ["APT", "APTOS"],
  TIA: ["TIA", "CELESTIA"],
  SEI: ["SEI"],
  HYPE: ["HYPE", "HYPERLIQUID"],
  AAVE: ["AAVE", "DEFI"],
  UNI: ["UNI", "UNISWAP", "DEFI"],
  PEPE: ["PEPE"],
  WIF: ["WIF"],
  TRUMP: ["TRUMP"],
  JUP: ["JUP", "JUPITER"],
  ONDO: ["ONDO", "RWA"],
  RENDER: ["RENDER", "RNDR"],
  INJ: ["INJ", "INJECTIVE"],
  FET: ["FET", "AI CRYPTO"],
  TAO: ["TAO", "BITTENSOR"],
  PENDLE: ["PENDLE", "DEFI"],
  HBAR: ["HBAR", "HEDERA"],
  POL: ["POL", "POLYGON", "MATIC"],
  EURUSD: ["EUR", "ECB", "LAGARDE", "EUROZONE", "DXY"],
  GBPUSD: ["GBP", "BOE", "UK", "POUND", "DXY"],
  USDJPY: ["JPY", "BOJ", "YEN", "JAPAN", "DXY"],
  AUDUSD: ["AUD", "RBA", "AUSTRALIA", "DXY"],
  USDCAD: ["CAD", "BOC", "CANADA", "OIL", "DXY"],
  GOLD: ["GOLD", "XAU", "METALS", "DXY", "FED"],
  SILVER: ["SILVER", "XAG", "METALS"],
  WTI: ["WTI", "OIL", "CRUDE", "OPEC", "BRENT", "ENERGY", "IRAN"],
  NATGAS: ["NATGAS", "NATURAL GAS", "HENRY HUB", "TTF", "ENERGY"],
  SPY: ["SPY", "SP500", "S&P", "FED", "EARNINGS"],
  QQQ: ["QQQ", "NASDAQ", "TECH", "FED"],
  NVDA: ["NVDA", "NVIDIA", "AI", "CHIPS", "SEMICONDUCTOR"],
  AAPL: ["AAPL", "APPLE"],
  MSFT: ["MSFT", "MICROSOFT"],
  TSLA: ["TSLA", "TESLA", "EV"],
};

// ── Fetch + cache ────────────────────────────────────────────────────────────
async function refreshCacheIfStale(): Promise<void> {
  if (Date.now() - cache.ts < CACHE_TTL_MS && cache.items.length > 0) return;
  if (!CPANIC_KEY) {
    cache = { items: [], ts: Date.now() };
    return;
  }
  try {
    const r = await fetch(
      `https://cryptopanic.com/api/v1/posts/?auth_token=${CPANIC_KEY}&public=true&filter=hot&kind=news`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j: any = await r.json();
    const items: CachedNewsItem[] = (j?.results || []).slice(0, 80).map((p: any) => {
      const title = String(p.title || "");
      const tickers = (p.currencies || []).map((c: any) => c.code).join(",");
      const { sentiment, severity } = classifyTitle(title);
      return {
        externalId: String(p.id || `${title}-${p.published_at}`),
        title,
        source: p.source?.title || "CryptoPanic",
        tickers,
        sentiment,
        severity,
        url: p.url || "",
        createdAt: new Date(p.published_at || Date.now()).getTime(),
      };
    });
    cache = { items, ts: Date.now() };
  } catch {
    // keep stale cache on failure (fail-open)
    cache.ts = Date.now() - CACHE_TTL_MS + 60_000; // retry in 1 min
  }
}

// Used by lib/newsPersist to avoid re-fetching
export function getCachedNewsItems(): CachedNewsItem[] {
  return cache.items;
}

// ── Public API ───────────────────────────────────────────────────────────────
export interface NewsImpact {
  hasConflict: boolean;
  severity: "low" | "medium" | "high" | null;
  bearishCount: number;
  bullishCount: number;
  neutralCount: number;
  topHeadlines: string[];
  confidenceAdjustment: number;  // -100 to +5
  shouldBlock: boolean;
}

export async function getNewsImpact(
  token: string,
  direction: "LONG" | "SHORT",
  lookbackMinutes: number = 240
): Promise<NewsImpact> {
  await refreshCacheIfStale();

  const keywords = ASSET_NEWS_MAP[token.toUpperCase()] || [token.toUpperCase()];
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;

  const relevant = cache.items.filter((it) => {
    if (it.createdAt < cutoff) return false;
    const blob = `${it.title} ${it.tickers}`.toUpperCase();
    return keywords.some((kw) => blob.includes(kw));
  });

  let bearish = 0, bullish = 0, neutral = 0;
  let maxSeverity: NewsImpact["severity"] = null;
  const headlines: string[] = [];

  for (const it of relevant) {
    if (it.sentiment === "bearish") bearish++;
    else if (it.sentiment === "bullish") bullish++;
    else neutral++;

    if (it.severity === "high") maxSeverity = "high";
    else if (it.severity === "medium" && maxSeverity !== "high") maxSeverity = "medium";
    else if (it.severity === "low" && !maxSeverity) maxSeverity = "low";

    if (headlines.length < 3) headlines.push(it.title);
  }

  const contradicts =
    (direction === "LONG" && bearish > bullish) ||
    (direction === "SHORT" && bullish > bearish);

  let confidenceAdjustment = 0;
  let shouldBlock = false;

  if (contradicts && maxSeverity === "high") {
    shouldBlock = true;
    confidenceAdjustment = -100;
  } else if (contradicts && maxSeverity === "medium") {
    confidenceAdjustment = -20;
  } else if (contradicts) {
    confidenceAdjustment = -10;
  } else if (!contradicts && maxSeverity === "high") {
    confidenceAdjustment = 5;
  }

  return {
    hasConflict: contradicts,
    severity: maxSeverity,
    bearishCount: bearish,
    bullishCount: bullish,
    neutralCount: neutral,
    topHeadlines: headlines,
    confidenceAdjustment,
    shouldBlock,
  };
}

// Convenience for the AI prompt — last N high/medium severity headlines
// across the whole feed (not per-asset).
export async function getRecentCriticalHeadlines(limit: number = 5, lookbackHours: number = 4): Promise<CachedNewsItem[]> {
  await refreshCacheIfStale();
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  return cache.items
    .filter((it) => it.createdAt >= cutoff && (it.severity === "high" || it.severity === "medium"))
    .slice(0, limit);
}
