// ─────────────────────────────────────────────────────────────────────────────
// Twitter/X Intelligence — server-side handler for CLVRQuant
// All Twitter135 API calls happen here. API key stays secure on the server.
// Frontend calls /api/twitter — results cached 4 minutes
// ─────────────────────────────────────────────────────────────────────────────

const RAPIDAPI_HOST = "twitter135.p.rapidapi.com";
const BASE_URL      = `https://${RAPIDAPI_HOST}`;
const CACHE_MS      = 4 * 60 * 1000; // 4 minutes

// ── Whale accounts ────────────────────────────────────────────────────────────
const WHALE_ACCOUNTS = [
  { handle:"elonmusk",        name:"Elon Musk",          category:"crypto",    weight:10 },
  { handle:"saylor",          name:"Michael Saylor",     category:"crypto",    weight:9  },
  { handle:"cz_binance",      name:"CZ Binance",         category:"crypto",    weight:8  },
  { handle:"VitalikButerin",  name:"Vitalik Buterin",    category:"crypto",    weight:8  },
  { handle:"brian_armstrong", name:"Brian Armstrong",    category:"crypto",    weight:7  },
  { handle:"tyler",           name:"Tyler Winklevoss",   category:"crypto",    weight:7  },
  { handle:"chamath",         name:"Chamath Palihap.",   category:"macro",     weight:8  },
  { handle:"RaoulGMI",        name:"Raoul Pal",          category:"macro",     weight:8  },
  { handle:"PeterSchiff",     name:"Peter Schiff",       category:"commodity", weight:7  },
  { handle:"federalreserve",  name:"Federal Reserve",    category:"macro",     weight:9  },
  { handle:"KitcoNewsNOW",    name:"Kitco News",         category:"commodity", weight:7  },
  { handle:"ZeroHedge",       name:"ZeroHedge",          category:"macro",     weight:6  },
];

// ── Sentiment classifier ──────────────────────────────────────────────────────
const BULLISH_WORDS = [
  "bull","bullish","moon","mooning","pump","rally","buy","long","breakout",
  "ath","all time high","surge","rip","explode","🚀","🔥","📈","🟢",
  "accumulate","hodl","hold","bullrun","up only","send it","massive",
  "positive","gain","profit","green","higher","recovery","bounce",
];
const BEARISH_WORDS = [
  "bear","bearish","dump","crash","sell","short","collapse","drop","fall",
  "rug","scam","dead","rekt","liquidated","📉","🔴","🩸","down",
  "lower","recession","fear","panic","correction","plunge","tank",
  "negative","loss","red","warning","danger","caution","bubble",
];

function classifySentiment(text: string): "bullish"|"bearish"|"neutral" {
  if (!text) return "neutral";
  const t = text.toLowerCase();
  let bull = 0, bear = 0;
  BULLISH_WORDS.forEach(w => { if (t.includes(w)) bull++; });
  BEARISH_WORDS.forEach(w => { if (t.includes(w)) bear++; });
  if (bull === 0 && bear === 0) return "neutral";
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

const ASSET_MAP: Record<string,string> = {
  "bitcoin":"BTC","btc":"BTC","$btc":"BTC",
  "ethereum":"ETH","eth":"ETH","$eth":"ETH",
  "solana":"SOL","sol":"SOL","$sol":"SOL",
  "dogecoin":"DOGE","doge":"DOGE","$doge":"DOGE",
  "nvidia":"NVDA","nvda":"NVDA","$nvda":"NVDA",
  "tesla":"TSLA","tsla":"TSLA","$tsla":"TSLA",
  "apple":"AAPL","aapl":"AAPL","$aapl":"AAPL",
  "microsoft":"MSFT","msft":"MSFT","$msft":"MSFT",
  "microstrategy":"MSTR","mstr":"MSTR","$mstr":"MSTR",
  "coinbase":"COIN","$coin":"COIN",
  "palantir":"PLTR","pltr":"PLTR","$pltr":"PLTR",
  "meta":"META","$meta":"META",
  "amd":"AMD","$amd":"AMD",
  "gold":"XAU","xau":"XAU","$gold":"XAU",
  "silver":"XAG","xag":"XAG","$silver":"XAG",
  "oil":"OIL","crude":"OIL","$oil":"OIL",
};

function extractAssets(text: string): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const found: string[] = [];
  Object.entries(ASSET_MAP).forEach(([k, v]) => {
    if (t.includes(k) && !found.includes(v)) found.push(v);
  });
  return found;
}

function isWithinHours(dateStr: string, hours: number): boolean {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  return !isNaN(ts) && (Date.now() - ts) < hours * 3_600_000;
}

// ── API helper ────────────────────────────────────────────────────────────────
async function twitterGet(endpoint: string, params: Record<string,string> = {}): Promise<any> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL(`${BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url.toString(), {
      headers: {
        "x-rapidapi-key":  apiKey,
        "x-rapidapi-host": RAPIDAPI_HOST,
      },
    });
    if (!r.ok) {
      console.warn(`[twitter] ${endpoint} → HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e: any) {
    console.warn(`[twitter] ${endpoint} error:`, e.message);
    return null;
  }
}

// ── Tweet extractor ───────────────────────────────────────────────────────────
function extractTweets(data: any): any[] {
  return (
    data?.result?.timeline?.instructions
      ?.flatMap((i: any) => i.entries || [])
      ?.filter((e: any) => e.content?.itemContent?.tweet_results?.result)
      ?.map((e: any) => {
        const t    = e.content.itemContent.tweet_results.result;
        const user = t.core?.user_results?.result?.legacy;
        return {
          id:        t.legacy?.id_str           || "",
          text:      t.legacy?.full_text         || "",
          likes:     t.legacy?.favorite_count    || 0,
          retweets:  t.legacy?.retweet_count     || 0,
          createdAt: t.legacy?.created_at        || "",
          author:    user?.name                  || "Unknown",
          handle:    user?.screen_name           || "",
        };
      }) || []
  );
}

// ── Stream 1: Whale activity ──────────────────────────────────────────────────
async function fetchWhaleActivity() {
  const top = WHALE_ACCOUNTS
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  const results: any[] = [];
  await Promise.allSettled(top.map(async (whale) => {
    const data   = await twitterGet("/UserTweets/", { username: whale.handle, count: "5" });
    const tweets = extractTweets(data).slice(0, 3);
    if (!tweets.length) return;
    const latest    = tweets[0];
    const sentiment = classifySentiment(latest.text);
    results.push({
      whale,
      tweet: { ...latest, url: `https://twitter.com/${whale.handle}/status/${latest.id}` },
      sentiment,
      isRecent: isWithinHours(latest.createdAt, 4),
      isViral:  latest.likes > 5000 || latest.retweets > 1000,
      assets:   extractAssets(latest.text),
    });
  }));

  return results.sort((a, b) => {
    if (a.isViral  !== b.isViral)  return a.isViral  ? -1 : 1;
    if (a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
    return b.whale.weight - a.whale.weight;
  });
}

// ── Stream 2: Ticker mention volume ──────────────────────────────────────────
async function fetchTickerMentions() {
  const top = ["$BTC","$ETH","$SOL","$NVDA","$TSLA","$MSTR","$COIN","$GOLD"];
  const results: Record<string,any> = {};

  await Promise.allSettled(top.map(async (ticker) => {
    const data   = await twitterGet("/SearchV2/", {
      query: `${ticker} lang:en -is:retweet`,
      count: "25",
      type:  "Latest",
    });
    const tweets = extractTweets(data);
    const recent = tweets.filter(t => isWithinHours(t.createdAt, 1));
    const bull   = recent.filter(t => classifySentiment(t.text) === "bullish").length;
    const bear   = recent.filter(t => classifySentiment(t.text) === "bearish").length;
    const engage = recent.reduce((s, t) => s + t.likes + t.retweets * 3, 0);
    const score  = recent.length > 0 ? Math.round((bull / recent.length) * 100) : 50;
    results[ticker] = {
      ticker,
      count1h:         recent.length,
      bullishCount:    bull,
      bearishCount:    bear,
      neutralCount:    recent.length - bull - bear,
      sentimentScore:  score,
      totalEngagement: engage,
      isSpiking:       recent.length > 15,
      topTweet:        tweets.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))[0] || null,
    };
  }));

  return results;
}

// ── Stream 3: Breaking / viral tweets ────────────────────────────────────────
async function fetchBreakingTweets() {
  const data = await twitterGet("/SearchV2/", {
    query: "crypto market stocks bitcoin breaking lang:en -is:retweet min_faves:100",
    count: "15",
    type:  "Latest",
  });
  return extractTweets(data)
    .filter(t => isWithinHours(t.createdAt, 2))
    .map(t => ({
      ...t,
      sentiment: classifySentiment(t.text),
      assets:    extractAssets(t.text),
      isViral:   t.likes > 1000,
      url:       `https://twitter.com/${t.handle}/status/${t.id}`,
    }))
    .sort((a, b) => (b.likes + b.retweets * 3) - (a.likes + a.retweets * 3))
    .slice(0, 6);
}

// ── Stream 4: Overall sentiment ───────────────────────────────────────────────
async function fetchOverallSentiment() {
  const data   = await twitterGet("/SearchV2/", {
    query: "crypto market stocks bitcoin ethereum lang:en -is:retweet",
    count: "40",
    type:  "Latest",
  });
  const tweets = extractTweets(data).filter(t => isWithinHours(t.createdAt, 2));
  const total  = Math.max(tweets.length, 1);
  const bull   = tweets.filter(t => classifySentiment(t.text) === "bullish").length;
  const bear   = tweets.filter(t => classifySentiment(t.text) === "bearish").length;
  const score  = Math.round((bull / total) * 100);

  const wBull  = tweets.filter(t => classifySentiment(t.text) === "bullish")
    .reduce((s, t) => s + 1 + Math.log(t.likes + 1), 0);
  const wBear  = tweets.filter(t => classifySentiment(t.text) === "bearish")
    .reduce((s, t) => s + 1 + Math.log(t.likes + 1), 0);
  const wTotal = wBull + wBear + 0.001;

  return {
    score,
    weightedScore: Math.round((wBull / wTotal) * 100),
    label:
      score > 65 ? "VERY BULLISH" :
      score > 55 ? "BULLISH"      :
      score < 35 ? "VERY BEARISH" :
      score < 45 ? "BEARISH"      : "NEUTRAL",
    bullishCount:  bull,
    bearishCount:  bear,
    totalTweets:   tweets.length,
    sampleSize:    `${tweets.length} tweets (last 2h)`,
  };
}

// ── AI context builder ────────────────────────────────────────────────────────
function buildAIContext(data: any): string {
  if (!data) return "";
  const { whales, mentions, breaking, sentiment } = data;
  const lines: string[] = ["\n── TWITTER/X SOCIAL INTELLIGENCE ──"];

  lines.push(`Overall Sentiment: ${sentiment.label} (${sentiment.score}% bullish, weighted: ${sentiment.weightedScore}%)`);
  lines.push(`Sample: ${sentiment.sampleSize}`);

  const recentWhales = whales.filter((w: any) => w.isRecent);
  if (recentWhales.length) {
    lines.push("WHALE ACTIVITY (last 4h):");
    recentWhales.slice(0, 4).forEach((w: any) => {
      lines.push(`  @${w.whale.handle}${w.isViral ? " [VIRAL]" : ""}: "${w.tweet.text.slice(0, 120)}"`);
      lines.push(`  → ${w.sentiment.toUpperCase()} | ${w.tweet.likes} likes${w.assets.length ? ` | ${w.assets.join(",")}` : ""}`);
    });
  }

  const spikes = Object.values(mentions).filter((m: any) => m.isSpiking);
  if (spikes.length) {
    lines.push("MENTION SPIKES (unusual 1h activity):");
    (spikes as any[]).forEach(m => lines.push(`  ${m.ticker}: ${m.count1h} mentions | ${m.sentimentScore}% bullish`));
  }

  if (breaking.length) {
    lines.push("BREAKING / VIRAL TWEETS:");
    breaking.slice(0, 3).forEach((t: any) => {
      lines.push(`  @${t.handle}: "${t.text.slice(0, 100)}"`);
      lines.push(`  → ${t.sentiment.toUpperCase()} | ${t.likes} likes | ${t.assets.join(",") || "general"}`);
    });
  }

  lines.push("── END TWITTER INTELLIGENCE ──");
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

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return { error: "RAPIDAPI_KEY not configured", hasKey: false };
  }

  _fetching = true;
  try {
    console.log("[twitter] Fetching fresh data...");
    const [whales, sentiment] = await Promise.all([
      fetchWhaleActivity(),
      fetchOverallSentiment(),
    ]);
    await new Promise(r => setTimeout(r, 600));
    const [mentions, breaking] = await Promise.all([
      fetchTickerMentions(),
      fetchBreakingTweets(),
    ]);

    const data = {
      whales,
      mentions,
      breaking,
      sentiment,
      hasKey: true,
      fetchedAt:    Date.now(),
      fetchedAtStr: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) + " ET",
      aiContext:    buildAIContext({ whales, mentions, breaking, sentiment }),
    };

    _cache = { data, ts: Date.now() };
    console.log(`[twitter] Done — ${whales.length} whales, ${Object.keys(mentions).length} tickers, ${breaking.length} breaking, sentiment=${sentiment.score}%`);
    return data;
  } catch (e: any) {
    console.error("[twitter] Error:", e.message);
    return _cache?.data || { error: e.message, hasKey: true };
  } finally {
    _fetching = false;
  }
}
