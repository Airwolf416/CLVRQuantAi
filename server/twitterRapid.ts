// ─────────────────────────────────────────────────────────────────────────────
// X / Twitter via RapidAPI — companion feed to Stocktwits
// Default host: twitter154.p.rapidapi.com (Omar Mhaimdat's API)
// Override host with TWITTER_RAPIDAPI_HOST env var if you subscribe to a
// different RapidAPI Twitter provider. Returns [] on any error so the rest of
// the news feed keeps working.
// ─────────────────────────────────────────────────────────────────────────────

const HOST = process.env.TWITTER_RAPIDAPI_HOST || "twitter154.p.rapidapi.com";
const KEY = process.env.RAPIDAPI_KEY || "";
const CACHE_MS = 4 * 60 * 1000;

const QUERIES = [
  "$BTC OR $ETH macro",
  "$SPY OR $NVDA OR $TSLA",
  "Fed OR FOMC OR CPI trading",
];

interface TwitterPost {
  id: string;
  text: string;
  handle: string;
  followers: number;
  likes: number;
  retweets: number;
  createdAt: string;
  url: string;
  assets: string[];
}

let _cache: { data: TwitterPost[]; ts: number } | null = null;
let _fetching = false;

const TICKER_RE = /\$([A-Z]{2,6})\b/g;

function extractAssets(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = TICKER_RE.exec(text || "")) !== null) {
    out.add(m[1].toUpperCase());
    if (out.size >= 5) break;
  }
  return [...out];
}

async function fetchOne(query: string): Promise<TwitterPost[]> {
  if (!KEY) return [];
  try {
    const url = `https://${HOST}/search/search?query=${encodeURIComponent(query)}&section=top&limit=20&language=en`;
    const r = await fetch(url, {
      headers: {
        "x-rapidapi-key": KEY,
        "x-rapidapi-host": HOST,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[twitter-rapid] ${HOST} HTTP ${r.status} for "${query}"`);
      return [];
    }
    const d: any = await r.json();
    // twitter154 returns { results: [...], continuation_token }
    const items: any[] = Array.isArray(d?.results) ? d.results : Array.isArray(d?.data) ? d.data : [];
    return items.slice(0, 12).map((t: any): TwitterPost => {
      const text = t.text || t.full_text || t.content || "";
      const user = t.user || t.author || {};
      const handle = user.username || user.screen_name || user.handle || "";
      const id = String(t.tweet_id || t.id || t.id_str || Math.random().toString(36).slice(2));
      return {
        id,
        text: String(text).slice(0, 280),
        handle,
        followers: parseInt(user.follower_count || user.followers_count || 0, 10) || 0,
        likes: parseInt(t.favorite_count || t.likes || t.like_count || 0, 10) || 0,
        retweets: parseInt(t.retweet_count || t.retweets || 0, 10) || 0,
        createdAt: t.creation_date || t.created_at || t.date || new Date().toISOString(),
        url: handle ? `https://twitter.com/${handle}/status/${id}` : "#",
        assets: extractAssets(text),
      };
    });
  } catch (e: any) {
    console.warn(`[twitter-rapid] error for "${query}":`, e?.message);
    return [];
  }
}

export async function getRapidTwitterPosts(): Promise<TwitterPost[]> {
  if (!KEY) return [];
  if (_cache && Date.now() - _cache.ts < CACHE_MS) return _cache.data;
  if (_fetching) return _cache?.data || [];
  _fetching = true;
  try {
    const results = await Promise.all(QUERIES.map(fetchOne));
    const merged: TwitterPost[] = [];
    const seen = new Set<string>();
    for (const arr of results) {
      for (const p of arr) {
        if (!p.text || seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(p);
      }
    }
    merged.sort((a, b) => {
      const at = new Date(a.createdAt).getTime() || 0;
      const bt = new Date(b.createdAt).getTime() || 0;
      return bt - at;
    });
    _cache = { data: merged.slice(0, 30), ts: Date.now() };
    if (merged.length) console.log(`[twitter-rapid] fetched ${merged.length} posts via ${HOST}`);
    return _cache.data;
  } finally {
    _fetching = false;
  }
}

// TODO: Reddit feed - needs RapidAPI Reddit endpoint (e.g. reddit34.p.rapidapi.com).
// When the user subscribes, add a parallel fetcher here returning the same shape
// with a "reddit" source tag so the news feed can include it.
