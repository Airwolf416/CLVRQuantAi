// ─────────────────────────────────────────────────────────────────────────────
// TwitterIntelligence.jsx — CLVRQuant Social Intelligence Layer
// Data source: Stocktwits (free, explicit user-tagged sentiment, no API key)
// Backend route: /api/twitter  |  Cache: 4 minutes
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";

const MONO  = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const REFRESH_MS = 4 * 60 * 1000; // 4 minutes

// ── Colors ───────────────────────────────────────────────────────────────────
const sentColor = s =>
  s > 65 ? "#00c787" : s > 55 ? "#4ade80" : s < 35 ? "#ff4060" : s < 45 ? "#f87171" : "#c9a84c";

const sentLabel = s =>
  s > 65 ? "VERY BULLISH" : s > 55 ? "BULLISH" : s < 35 ? "VERY BEARISH" : s < 45 ? "BEARISH" : "NEUTRAL";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Module-level singleton store ──────────────────────────────────────────────
let _state    = null;
let _lastFetch = 0;
let _loading  = false;
let _listeners = new Set();

function notify() { _listeners.forEach(fn => fn(_state)); }

async function doFetch() {
  if (_loading) return;
  _loading = true;
  try {
    const r = await fetch("/api/twitter");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data && !data.error) {
      _state     = data;
      _lastFetch = Date.now();
      notify();
    }
  } catch (e) {
    console.warn("[TwitterIntelligence]", e.message);
  } finally {
    _loading = false;
  }
}

let _intervalId = null;
function ensurePolling() {
  if (_intervalId) return;
  doFetch();
  _intervalId = setInterval(() => {
    if (Date.now() - _lastFetch > REFRESH_MS) doFetch();
  }, 60_000);
}

// ── React hook ────────────────────────────────────────────────────────────────
export function useTwitterIntelligence() {
  const [data, setData]       = useState(_state);
  const [loading, setLoading] = useState(!_state);

  useEffect(() => {
    ensurePolling();
    if (_state) { setData(_state); setLoading(false); }
    const unsub = () => _listeners.delete(listener);
    const listener = d => { setData(d); setLoading(false); };
    _listeners.add(listener);
    return unsub;
  }, []);

  const hasKey = true; // key is always on the server
  return {
    whales:       data?.whales    || [],
    mentions:     data?.mentions  || {},
    breaking:     data?.breaking  || [],
    sentiment:    data?.sentiment || { score:50, label:"NEUTRAL", totalTweets:0, weightedScore:50, sampleSize:"loading..." },
    aiContext:    data?.aiContext  || "",
    loading,
    hasKey,
    hasData:      !!data,
    fetchedAtStr: data?.fetchedAtStr || "",
    timeAgo,
    refresh:      () => { _lastFetch = 0; doFetch(); },
  };
}

// ── AI context builder for per-asset injection ────────────────────────────────
export function buildAssetTwitterContext(data, ticker) {
  if (!data) return "";
  const { whales, mentions, breaking, sentiment } = data;
  const lines = [];
  const tickerData = mentions[`$${ticker}`] || mentions[ticker];
  if (tickerData) {
    lines.push(`${ticker} on X (last 1h): ${tickerData.count1h} mentions | ${tickerData.sentimentScore}% bullish | 🟢${tickerData.bullishCount} 🔴${tickerData.bearishCount}`);
    if (tickerData.isSpiking) lines.push(`⚠ MENTION SPIKE — unusually high ${ticker} activity on X`);
  }
  const relWhales = whales.filter(w => w.assets?.includes(ticker) && w.isRecent);
  relWhales.slice(0, 2).forEach(w =>
    lines.push(`@${w.whale.handle}: "${w.tweet.text.slice(0, 100)}" → ${w.sentiment.toUpperCase()} (${w.tweet.likes} likes)`)
  );
  const relBreaking = breaking.filter(t => t.assets?.includes(ticker));
  relBreaking.slice(0, 2).forEach(t =>
    lines.push(`Breaking @${t.handle}: "${t.text.slice(0, 100)}" → ${t.sentiment.toUpperCase()}`)
  );
  lines.push(`Overall X mood: ${sentiment.label} (${sentiment.score}%)`);
  return lines.join("\n") || "";
}

// ── Shared TweetCard ─────────────────────────────────────────────────────────
function TweetCard({ tweet, sentiment, whale, isViral, assets, ago }) {
  const col = sentiment === "bullish" ? "0,199,135" : sentiment === "bearish" ? "255,64,96" : "201,168,76";
  const c   = sentiment === "bullish" ? "#00c787"   : sentiment === "bearish" ? "#ff4060"   : "#c9a84c";
  return (
    <div style={{ background:`rgba(${col},0.04)`, border:`1px solid rgba(${col},0.18)`, borderRadius:4, padding:"9px 11px", marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:10, fontWeight:800, color:"#e8e0d0", fontFamily:MONO }}>@{whale?.handle || tweet.handle}</span>
          {whale && <span style={{ fontSize:8, color:"#5a6a8a", fontFamily:MONO }}>{whale.name}</span>}
          {isViral && <span style={{ fontSize:7, color:"#c9a84c", fontFamily:MONO, background:"rgba(201,168,76,.1)", padding:"1px 5px", borderRadius:2 }}>🔥 VIRAL</span>}
        </div>
        <span style={{ fontSize:7, color:"#2a3650", fontFamily:MONO }}>{ago}</span>
      </div>
      <div style={{ fontSize:9, color:"#8a96b2", fontFamily:MONO, lineHeight:1.65, marginBottom:5 }}>
        "{tweet.text?.slice(0, 160)}{tweet.text?.length > 160 ? "…" : ""}"
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <span style={{ fontSize:8, fontWeight:700, color:c, fontFamily:MONO }}>{sentiment?.toUpperCase()}</span>
        <span style={{ fontSize:8, color:"#3a4560", fontFamily:MONO }}>♥ {tweet.likes?.toLocaleString()}</span>
        <span style={{ fontSize:8, color:"#3a4560", fontFamily:MONO }}>↺ {tweet.retweets?.toLocaleString()}</span>
        {assets?.length > 0 && <span style={{ fontSize:8, color:"#6b7a99", fontFamily:MONO }}>{assets.join(" · ")}</span>}
        {tweet.url && <a href={tweet.url} target="_blank" rel="noreferrer" style={{ fontSize:7, color:"#4a5d80", fontFamily:MONO, textDecoration:"none" }}>View ↗</a>}
      </div>
    </div>
  );
}

// ── COMPONENT 1: TwitterSentimentBadge — compact header badge ─────────────────
export function TwitterSentimentBadge() {
  const { sentiment, fetchedAtStr, loading } = useTwitterIntelligence();
  const col = sentColor(sentiment.score);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.02)", border:`1px solid rgba(${sentiment.score>55?"0,199,135":sentiment.score<45?"255,64,96":"201,168,76"},0.2)`, borderRadius:3, padding:"4px 9px" }}>
      <span style={{ fontSize:11, color:"#e8e0d0" }}>𝕏</span>
      {loading
        ? <span style={{ fontSize:7, color:"#3a4560", fontFamily:MONO }}>loading…</span>
        : <>
            <span style={{ fontSize:8, fontWeight:700, color:col, fontFamily:MONO }}>{sentLabel(sentiment.score)}</span>
            <span style={{ fontSize:8, color:"#4a5d80", fontFamily:MONO }}>{sentiment.score}%</span>
          </>
      }
    </div>
  );
}

// ── COMPONENT 2: TwitterMarketModeStrip — compact strip for Market tab ────────
export function TwitterMarketModeStrip() {
  const { sentiment, mentions, loading } = useTwitterIntelligence();
  const col = sentColor(sentiment.score);
  if (loading && !sentiment.totalTweets) return (
    <div data-testid="twitter-market-strip" style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:4, padding:"7px 11px", display:"flex", alignItems:"center", gap:9, marginBottom:10, opacity:0.5 }}>
      <span style={{ fontSize:10, color:"#c9a84c", fontFamily:MONO, fontWeight:700 }}>ST</span>
      <span style={{ fontSize:7, color:"#3a4560", fontFamily:MONO }}>Social intelligence loading…</span>
    </div>
  );
  const spikes = Object.values(mentions).filter(m => m.isSpiking);

  return (
    <div data-testid="twitter-market-strip" style={{ background:"rgba(255,255,255,0.02)", border:`1px solid rgba(${sentiment.score>55?"0,199,135":sentiment.score<45?"255,64,96":"201,168,76"},0.15)`, borderRadius:4, padding:"7px 11px", display:"flex", alignItems:"center", gap:9, flexWrap:"wrap", marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
        <span style={{ fontSize:8, fontWeight:800, color:"#c9a84c", fontFamily:MONO }}>SOCIAL</span>
        <span style={{ fontSize:8, fontWeight:700, color:col, fontFamily:MONO }}>{sentLabel(sentiment.score)}</span>
        <span style={{ fontSize:8, color:"#4a5d80", fontFamily:MONO }}>{sentiment.score}%</span>
      </div>
      <div style={{ flex:1, height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden", minWidth:40 }}>
        <div style={{ height:"100%", width:`${sentiment.score}%`, background:col, borderRadius:2, transition:"width 1s ease" }}/>
      </div>
      {spikes.map(m => (
        <div key={m.ticker} style={{ background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.2)", borderRadius:3, padding:"2px 6px" }}>
          <span style={{ fontSize:7, color:"#c9a84c", fontFamily:MONO }}>⚠ {m.ticker} spike</span>
        </div>
      ))}
      <span style={{ fontSize:7, color:"#2a3650", fontFamily:MONO }}>𝕏 · {sentiment.sampleSize}</span>
    </div>
  );
}

// ── COMPONENT 3: TwitterSignalPanel — for Signals/AI tab ──────────────────────
export function TwitterSignalPanel({ ticker }) {
  const { whales, mentions, breaking, sentiment, loading, timeAgo: ta } = useTwitterIntelligence();
  const [open, setOpen] = useState(false);

  const tickerData  = mentions[`$${ticker}`] || mentions[ticker] || null;
  const relWhales   = whales.filter(w => w.assets?.includes(ticker) && w.isRecent);
  const relBreaking = breaking.filter(t => t.assets?.includes(ticker));
  const col         = sentColor(sentiment.score);
  const hasTwData   = tickerData || relWhales.length > 0 || relBreaking.length > 0;

  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid rgba(${sentiment.score>55?"0,199,135":sentiment.score<45?"255,64,96":"201,168,76"},0.12)`, borderRadius:4, overflow:"hidden", marginTop:8 }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding:"10px 12px", cursor:"pointer", userSelect:"none", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ fontSize:12, color:"#e8e0d0" }}>𝕏</span>
          <div>
            <div style={{ fontSize:8, color:"#c9a84c", letterSpacing:"0.15em", fontFamily:MONO, fontWeight:700 }}>SOCIAL INTELLIGENCE · {ticker}</div>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:MONO, marginTop:1 }}>
              {loading ? "Fetching…" : `${sentiment.sampleSize} · ${sentLabel(sentiment.score)} · refreshes 4 min`}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:13, fontWeight:900, color:col, fontFamily:MONO }}>{sentiment.score}%</div>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:MONO }}>bullish</div>
          </div>
          <span style={{ fontSize:8, color:"#3a4560", transform:open?"rotate(180deg)":"none", transition:"transform 0.2s", display:"inline-block" }}>▼</span>
        </div>
      </div>

      <div style={{ height:2, background:"rgba(255,255,255,0.04)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${sentiment.score}%`, background:`linear-gradient(90deg,${col}40,${col})`, transition:"width 1s ease" }}/>
      </div>

      {open && (
        <div style={{ padding:"11px 12px" }}>
          {tickerData && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:3, padding:"9px 11px", marginBottom:9 }}>
              <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:7 }}>{ticker} MENTIONS · LAST 1H</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:5 }}>
                {[
                  { label:"MENTIONS",  value:tickerData.count1h,                      color:"#e8e0d0" },
                  { label:"SENTIMENT", value:`${tickerData.sentimentScore}%`,          color:sentColor(tickerData.sentimentScore) },
                  { label:"BULLISH",   value:tickerData.bullishCount,                  color:"#00c787" },
                  { label:"BEARISH",   value:tickerData.bearishCount,                  color:"#ff4060" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background:"rgba(255,255,255,0.02)", borderRadius:3, padding:"6px 7px", textAlign:"center" }}>
                    <div style={{ fontSize:6, color:"#3a4560", fontFamily:MONO, marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:12, fontWeight:800, color, fontFamily:MONO }}>{value}</div>
                  </div>
                ))}
              </div>
              {tickerData.isSpiking && (
                <div style={{ marginTop:7, background:"rgba(201,168,76,.06)", border:"1px solid rgba(201,168,76,.2)", borderRadius:3, padding:"5px 9px", fontSize:8, color:"#c9a84c", fontFamily:MONO }}>
                  ⚠ MENTION SPIKE — unusually high {ticker} activity this hour
                </div>
              )}
            </div>
          )}
          {relWhales.length > 0 && (
            <div style={{ marginBottom:9 }}>
              <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:7 }}>WHALE ACTIVITY</div>
              {relWhales.slice(0, 2).map((w, i) => (
                <TweetCard key={i} tweet={w.tweet} sentiment={w.sentiment} whale={w.whale} isViral={w.isViral} assets={w.assets} ago={ta(w.tweet.createdAt)} />
              ))}
            </div>
          )}
          {relBreaking.length > 0 && (
            <div style={{ marginBottom:9 }}>
              <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:7 }}>BREAKING TWEETS</div>
              {relBreaking.slice(0, 2).map((t, i) => (
                <TweetCard key={i} tweet={t} sentiment={t.sentiment} isViral={t.isViral} assets={t.assets} ago={ta(t.createdAt)} />
              ))}
            </div>
          )}
          {!hasTwData && (
            <div style={{ fontSize:8, color:"#3a4560", fontFamily:MONO, textAlign:"center", padding:"10px 0" }}>
              No specific {ticker} Twitter activity in last 2h
            </div>
          )}
          <div style={{ background:"rgba(255,255,255,0.02)", borderRadius:3, padding:"7px 10px" }}>
            <div style={{ fontSize:7, color:"#4a5d80", fontFamily:MONO, marginBottom:2 }}>OVERALL SOCIAL MOOD (STOCKTWITS)</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:10, fontWeight:700, color:col, fontFamily:MONO }}>{sentLabel(sentiment.score)}</span>
              <span style={{ fontSize:8, color:"#5a6a8a", fontFamily:MONO }}>{sentiment.score}% bullish · {sentiment.sampleSize}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── COMPONENT 4: TwitterMorningBrief — full brief panel ───────────────────────
export function TwitterMorningBrief() {
  const { whales, mentions, breaking, sentiment, loading, fetchedAtStr, timeAgo: ta } = useTwitterIntelligence();
  const col         = sentColor(sentiment.score);
  const viralWhales = whales.filter(w => w.isViral);
  const spikes      = Object.values(mentions).filter(m => m.isSpiking);
  const topMentions = Object.values(mentions).sort((a, b) => b.count1h - a.count1h).slice(0, 6);

  if (loading && !sentiment.totalTweets) return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:4, padding:14 }}>
      <div style={{ fontSize:9, color:"#3a4560", fontFamily:MONO }}>↻ Loading social intelligence…</div>
    </div>
  );

  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${col}20`, borderRadius:4, overflow:"hidden", marginTop:12 }}>
      {/* Header */}
      <div style={{ padding:"12px 14px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
              <span style={{ fontSize:9, fontWeight:800, color:"#c9a84c", fontFamily:MONO }}>STOCKTWITS</span>
              <span style={{ fontSize:8, color:"#c9a84c", letterSpacing:"0.15em", fontFamily:MONO, fontWeight:700 }}>SOCIAL INTELLIGENCE</span>
            </div>
            <div style={{ fontSize:18, fontWeight:900, color:col, fontFamily:MONO }}>{sentLabel(sentiment.score)}</div>
            <div style={{ fontSize:7, color:"#5a6a8a", fontFamily:MONO, marginTop:2 }}>{sentiment.sampleSize} · {fetchedAtStr} · updates every 4 min</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:MONO, marginBottom:2 }}>BULLISH SCORE</div>
            <div style={{ fontSize:26, fontWeight:900, color:col, fontFamily:MONO, lineHeight:1 }}>{sentiment.score}<span style={{ fontSize:13 }}>%</span></div>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:MONO, marginTop:2 }}>weighted: {sentiment.weightedScore}%</div>
          </div>
        </div>
        <div style={{ height:4, background:"rgba(255,255,255,0.06)", borderRadius:3, marginTop:8, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${sentiment.score}%`, background:`linear-gradient(90deg,${col}40,${col})`, borderRadius:3, transition:"width 1.5s ease" }}/>
        </div>
      </div>

      <div style={{ padding:"12px 14px" }}>
        {/* Spikes */}
        {spikes.length > 0 && (
          <div style={{ background:"rgba(201,168,76,.05)", border:"1px solid rgba(201,168,76,.2)", borderRadius:3, padding:"9px 12px", marginBottom:10 }}>
            <div style={{ fontSize:7, color:"#c9a84c", letterSpacing:"0.15em", fontFamily:MONO, fontWeight:700, marginBottom:6 }}>⚠ MENTION SPIKES</div>
            {spikes.map(m => (
              <div key={m.ticker} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:10, fontWeight:800, color:"#e8e0d0", fontFamily:MONO }}>{m.ticker}</span>
                <div style={{ display:"flex", gap:10 }}>
                  <span style={{ fontSize:8, color:"#c9a84c", fontFamily:MONO }}>{m.count1h}/hr</span>
                  <span style={{ fontSize:8, color:sentColor(m.sentimentScore), fontFamily:MONO }}>{m.sentimentScore}% bullish</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ticker sentiment grid */}
        {topMentions.length > 0 && (
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:7 }}>MOST DISCUSSED · LAST 1H</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
              {topMentions.map(m => (
                <div key={m.ticker} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:3, padding:"8px 9px" }}>
                  <div style={{ fontSize:9, fontWeight:800, color:"#e8e0d0", fontFamily:MONO, marginBottom:2 }}>{m.ticker}</div>
                  <div style={{ fontSize:13, fontWeight:900, color:sentColor(m.sentimentScore), fontFamily:MONO }}>{m.sentimentScore}%</div>
                  <div style={{ fontSize:7, color:"#3a4560", fontFamily:MONO }}>{m.count1h} tweets</div>
                  <div style={{ height:2, background:"rgba(255,255,255,0.06)", borderRadius:2, marginTop:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${m.sentimentScore}%`, background:sentColor(m.sentimentScore), borderRadius:2 }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Viral whales */}
        {viralWhales.length > 0 && (
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:6 }}>🔥 VIRAL WHALE ACTIVITY</div>
            {viralWhales.slice(0, 2).map((w, i) => (
              <TweetCard key={i} tweet={w.tweet} sentiment={w.sentiment} whale={w.whale} isViral assets={w.assets} ago={ta(w.tweet.createdAt)} />
            ))}
          </div>
        )}

        {/* Breaking tweets */}
        {breaking.length > 0 && (
          <div>
            <div style={{ fontSize:7, color:"#5a6a8a", letterSpacing:"0.12em", fontFamily:MONO, marginBottom:6 }}>BREAKING TWEETS</div>
            {breaking.slice(0, 3).map((t, i) => (
              <TweetCard key={i} tweet={t} sentiment={t.sentiment} isViral={t.isViral} assets={t.assets} ago={ta(t.createdAt)} />
            ))}
          </div>
        )}

        {!loading && !viralWhales.length && !breaking.length && !topMentions.length && (
          <div style={{ fontSize:9, color:"#3a4560", fontFamily:MONO, textAlign:"center", padding:"16px 0" }}>
            No Twitter activity data yet — fetching now…
          </div>
        )}
      </div>
    </div>
  );
}
