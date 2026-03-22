// ─────────────────────────────────────────────────────────────────────────────
// Social Intelligence — CLVRQuant
// Replaced Twitter135/RapidAPI (broken) with Stocktwits free API
// Stocktwits: explicit user-tagged Bullish/Bearish sentiment, no API key needed
// Cache: 4 minutes
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_MS = 4 * 60 * 1000;

// Symbols: use .X suffix for crypto on Stocktwits
const SYMBOLS = [
  { ticker: "$BTC",  st: "BTC.X",  label: "Bitcoin"    },
  { ticker: "$ETH",  st: "ETH.X",  label: "Ethereum"   },
  { ticker: "$SOL",  st: "SOL.X",  label: "Solana"     },
  { ticker: "$DOGE", st: "DOGE.X", label: "Dogecoin"   },
  { ticker: "$MSTR", st: "MSTR",   label: "MicroStrategy" },
  { ticker: "$NVDA", st: "NVDA",   label: "Nvidia"     },
  { ticker: "$TSLA", st: "TSLA",   label: "Tesla"      },
  { ticker: "$COIN", st: "COIN",   label: "Coinbase"   },
];

const SENTIMENT_KEYWORDS_BULL = [
  "bull","bullish","moon","pump","rally","buy","long","breakout","ath",
  "surge","green","higher","recovery","bounce","accumulate","📈","🚀","🟢",
];
const SENTIMENT_KEYWORDS_BEAR = [
  "bear","bearish","dump","crash","sell","short","collapse","drop","fall",
  "correction","plunge","tank","red","lower","📉","🔴","rekt",
];

function classifySentiment(text: string): "bullish" | "bearish" | "neutral" {
  if (!text) return "neutral";
  const t = text.toLowerCase();
  let bull = 0, bear = 0;
  SENTIMENT_KEYWORDS_BULL.forEach(w => { if (t.includes(w)) bull++; });
  SENTIMENT_KEYWORDS_BEAR.forEach(w => { if (t.includes(w)) bear++; });
  return bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
}

function isWithinHours(dateStr: string, hours: number): boolean {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  return !isNaN(ts) && (Date.now() - ts) < hours * 3_600_000;
}

// ── Stocktwits fetch helper ───────────────────────────────────────────────────
async function stFetch(symbol: string): Promise<any[]> {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json?limit=30`;
    const r = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "CLVRQuant/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[stocktwits] ${symbol} → HTTP ${r.status}`);
      return [];
    }
    const d: any = await r.json();
    return d?.messages || [];
  } catch (e: any) {
    console.warn(`[stocktwits] ${symbol} error:`, e.message);
    return [];
  }
}

// ── Per-symbol sentiment ──────────────────────────────────────────────────────
async function fetchTickerMentions(): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  await Promise.allSettled(SYMBOLS.map(async (sym) => {
    const messages = await stFetch(sym.st);
    const recent   = messages.filter(m => isWithinHours(m.created_at, 2));

    let bull = 0, bear = 0, neutral = 0;
    const posts: any[] = [];

    for (const m of recent) {
      // Stocktwits users can explicitly tag sentiment — trust that first
      const tagged = m.entities?.sentiment?.basic;
      let sent: "bullish" | "bearish" | "neutral";
      if (tagged === "Bullish")       { sent = "bullish"; bull++; }
      else if (tagged === "Bearish")  { sent = "bearish"; bear++; }
      else {
        sent = classifySentiment(m.body || "");
        if (sent === "bullish")      bull++;
        else if (sent === "bearish") bear++;
        else                         neutral++;
      }
      posts.push({
        id:        m.id,
        text:      (m.body || "").slice(0, 200),
        likes:     m.likes?.total || 0,
        createdAt: m.created_at,
        handle:    m.user?.username || "",
        followers: m.user?.followers_count || 0,
        sentiment: sent,
        url:       `https://stocktwits.com/${m.user?.username}/message/${m.id}`,
      });
    }

    const total = Math.max(recent.length, 1);
    const score = Math.round((bull / total) * 100);

    // Sort by engagement + followers as proxy for "whale"
    posts.sort((a, b) => (b.likes + b.followers * 0.01) - (a.likes + a.followers * 0.01));

    results[sym.ticker] = {
      ticker:         sym.ticker,
      count1h:        recent.length,
      bullishCount:   bull,
      bearishCount:   bear,
      neutralCount:   neutral,
      sentimentScore: score,
      isSpiking:      recent.length > 12,
      topPosts:       posts.slice(0, 3),
    };
  }));

  return results;
}

// ── Overall market sentiment (aggregate all symbols) ─────────────────────────
function buildOverallSentiment(mentions: Record<string, any>) {
  // Use weighted-average of per-ticker sentimentScore so BTC/ETH bearishness
  // isn't drowned out by small-cap DOGE having many bullish posts.
  // Each ticker's sentimentScore (0-100%) is weighted; BTC=3x, ETH=2x, others=1x.
  let wScoreSum = 0, wTotal = 0;
  let totalBull = 0, totalBear = 0, totalPosts = 0;

  for (const sym of Object.values(mentions)) {
    const score = sym.sentimentScore ?? 50;
    const posts = sym.count1h || 0;
    // Skip tickers with fewer than 2 posts — not statistically meaningful
    if (posts < 2) continue;
    const w = sym.ticker === "$BTC" ? 3 : sym.ticker === "$ETH" ? 2 : 1;
    wScoreSum += score * w;
    wTotal    += w;
    totalBull  += sym.bullishCount || 0;
    totalBear  += sym.bearishCount || 0;
    totalPosts += posts;
  }

  const overallScore = wTotal > 0 ? Math.round(wScoreSum / wTotal) : 50;

  return {
    score:         overallScore,
    weightedScore: overallScore,
    label:
      overallScore > 65 ? "VERY BULLISH" :
      overallScore > 55 ? "BULLISH"      :
      overallScore < 35 ? "VERY BEARISH" :
      overallScore < 45 ? "BEARISH"      : "NEUTRAL",
    bullishCount:  totalBull,
    bearishCount:  totalBear,
    totalTweets:   totalPosts,
    sampleSize:    `${totalPosts} posts across ${Object.keys(mentions).length} tickers (last 2h)`,
  };
}

// ── Whale posts = highest-engagement posts across all symbols ─────────────────
function buildWhaleActivity(mentions: Record<string, any>) {
  const all: any[] = [];
  for (const sym of Object.values(mentions)) {
    for (const post of (sym.topPosts || [])) {
      all.push({
        whale:    { handle: post.handle, name: `@${post.handle}`, category: "market", weight: post.followers > 10000 ? 8 : 5 },
        tweet:    { ...post },
        sentiment: post.sentiment,
        isRecent:  isWithinHours(post.createdAt, 4),
        isViral:   post.likes > 50,
        assets:    [sym.ticker],
      });
    }
  }
  return all
    .filter(w => w.isRecent)
    .sort((a, b) => {
      if (a.isViral !== b.isViral) return a.isViral ? -1 : 1;
      return (b.tweet.likes + b.tweet.followers * 0.01) - (a.tweet.likes + a.tweet.followers * 0.01);
    })
    .slice(0, 8);
}

// ── Breaking = top bullish/bearish posts with high engagement ─────────────────
function buildBreaking(mentions: Record<string, any>) {
  const all: any[] = [];
  for (const sym of Object.values(mentions)) {
    for (const post of (sym.topPosts || [])) {
      if (post.sentiment !== "neutral" && post.likes > 5) {
        all.push({ ...post, assets: [sym.ticker] });
      }
    }
  }
  return all
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 6);
}

// ── AI context builder ────────────────────────────────────────────────────────
function buildAIContext(data: any): string {
  if (!data) return "";
  const { mentions, breaking, sentiment } = data;
  const lines: string[] = ["\n── STOCKTWITS SOCIAL INTELLIGENCE ──"];

  lines.push(`Overall Sentiment: ${sentiment.label} (${sentiment.score}% bullish, weighted: ${sentiment.weightedScore}%)`);
  lines.push(`Sample: ${sentiment.sampleSize}`);

  const spikes = Object.values(mentions).filter((m: any) => m.isSpiking);
  if (spikes.length) {
    lines.push("MENTION SPIKES:");
    (spikes as any[]).forEach(m =>
      lines.push(`  ${m.ticker}: ${m.count1h} posts | ${m.sentimentScore}% bullish | 🟢${m.bullishCount} 🔴${m.bearishCount}`)
    );
  }

  if (breaking.length) {
    lines.push("TOP POSTS BY ENGAGEMENT:");
    breaking.slice(0, 4).forEach((t: any) => {
      lines.push(`  @${t.handle} [${t.sentiment?.toUpperCase()}]: "${t.text.slice(0, 100)}" (${t.likes} likes) ${t.assets.join(",")}`);
    });
  }

  const byTicker = Object.values(mentions).slice(0, 6) as any[];
  lines.push("TICKER SENTIMENT:");
  byTicker.forEach(m =>
    lines.push(`  ${m.ticker}: ${m.sentimentScore}% bullish (${m.count1h} posts, 🟢${m.bullishCount} 🔴${m.bearishCount})`)
  );

  lines.push("── END SOCIAL INTELLIGENCE ──");
  return lines.join("\n");
}

// ── Module-level 4-minute cache ───────────────────────────────────────────────
let _cache: { data: any; ts: number } | null = null;
let _fetching = false;

export async function getTwitterData(): Promise<any> {
  if (_cache && (Date.now() - _cache.ts) < CACHE_MS) {
    return _cache.data;
  }
  if (_fetching) return _cache?.data || null;

  _fetching = true;
  try {
    console.log("[stocktwits] Fetching fresh social intelligence...");
    const mentions = await fetchTickerMentions();

    const sentiment = buildOverallSentiment(mentions);
    const whales    = buildWhaleActivity(mentions);
    const breaking  = buildBreaking(mentions);

    const data = {
      whales,
      mentions,
      breaking,
      sentiment,
      hasKey:       true,
      source:       "Stocktwits",
      fetchedAt:    Date.now(),
      fetchedAtStr: new Date().toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      }) + " ET",
      aiContext: buildAIContext({ mentions, breaking, sentiment }),
    };

    _cache = { data, ts: Date.now() };
    console.log(`[stocktwits] Done — ${Object.keys(mentions).length} tickers, sentiment=${sentiment.score}% (${sentiment.label}), ${whales.length} whale posts, ${breaking.length} breaking`);
    return data;
  } catch (e: any) {
    console.error("[stocktwits] Error:", e.message);
    return _cache?.data || { error: e.message, hasKey: true, sentiment: { score: 50, label: "NEUTRAL", totalTweets: 0, weightedScore: 50, sampleSize: "error — retrying..." } };
  } finally {
    _fetching = false;
  }
}
