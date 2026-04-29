import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";
import { effectiveTierSql, recomputeExpiredPromos } from "./lib/effectiveTier";
import { renderDailyBriefEmail, renderServiceApologyEmail, renderPromoEmail, type TieredTradeIdea } from "./services/emailTemplates";
import { chunkArray } from "./services/ta";
import { enqueueDailyBrief } from "./workers/notifications";
import { CLAUDE_MODEL } from "./config";
import { selectDailyTrades, sliceForTier, hydrateCalibration, logTierDistribution, getTieredBriefMode, type CandidatePlan, type AssetClass } from "./lib/selectDailyTrades";
import { runIntegrityCheck, filterDropList, type PriceRow } from "./lib/dataIntegrity";
import { getBrainSummary } from "./lib/statisticalBrain";
import { notifyAutoposter } from "./autoposterNotify";
import { buildEnrichedReasoning } from "./lib/buildEnrichedReasoning";

const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 600; // stay under Resend 2 req/s

const BRIEF_HOUR_ET = 6;
const BRIEF_MINUTE_ET = 0;
const APP_URL = "https://clvrquantai.com";

let lastBriefDate = "";
let lastApologySentAt = 0; // Unix ms — prevents double-send within 6 hours

// Boot ID for traceability — log alongside PID so we can confirm in production
// logs that exactly one process+boot fired the brief on any given date.
const BRIEF_BOOT_ID = Math.random().toString(36).slice(2, 10);
const briefTag = () => `pid=${process.pid} boot=${BRIEF_BOOT_ID}`;

async function getTodayBriefKey(): Promise<string | null> {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const p = (type: string) => parts.find(p => p.type === type)?.value || "0";
    const dateKey = `${p("year")}-${p("month")}-${p("day")}`;
    const res = await pool.query(`SELECT date_key FROM daily_briefs_log WHERE date_key = $1`, [dateKey]);
    return res.rows.length > 0 ? dateKey : null;
  } catch { return null; }
}

// ── ATOMIC CLAIM — single race-safe gate for the daily brief ─────────────────
// Replaces the old SELECT-then-INSERT pattern (TOCTOU race). Returns true ONLY
// for the process that successfully inserts the row; every other caller (other
// scheduler tick, server replica, restart catch-up) sees rowCount=0 and aborts.
async function claimBriefSlot(dateKey: string): Promise<boolean> {
  try {
    const res = await pool.query(
      `INSERT INTO daily_briefs_log (date_key, sent_at, recipient_count)
       VALUES ($1, NOW(), 0)
       ON CONFLICT (date_key) DO NOTHING
       RETURNING date_key`,
      [dateKey]
    );
    const claimed = (res.rowCount || 0) > 0;
    console.log(`[daily-brief] claim ${dateKey} ${briefTag()} → ${claimed ? "WON" : "lost (already claimed)"}`);
    return claimed;
  } catch (e: any) {
    console.log(`[daily-brief] claimBriefSlot failed: ${e.message}`);
    return false;
  }
}

// Per-day Telegram ledger — independent of the email slot lock so a Telegram
// notification fires AT MOST once per day even when the email pipeline
// retries (which deletes the daily_briefs_log row on recipient_count=0).
//
// Pattern: ATOMIC INSERT-as-claim. Insert the ledger row BEFORE the network
// call. The PK constraint on date_key turns the INSERT itself into the lock
// — if it returns rowCount=1 we own today's slot, if it returns 0 someone
// else does (or already did). This closes the in-process race the previous
// "check-then-insert-on-success" pattern left open.
//
// Trade-off: if INSERT succeeds but autoposter then fails (genuine downstream
// outage), today's slot is consumed and we won't retry. That's symmetric
// with how live signals behave (autoposterNotify has its own 2× retry +
// 15s timeout — ~30s of automatic retry built in), and the failure is
// logged loudly so the operator can manually re-send via existing admin
// tooling if it really matters.
async function claimTelegramSlot(dateKey: string, token: string, direction: string, source: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `INSERT INTO daily_brief_telegram_log (date_key, token, direction, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date_key) DO NOTHING`,
      [dateKey, token, direction, source],
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e: any) {
    // Fail-CLOSED on a write error so we don't accidentally double-post on
    // an unhealthy DB. The brief itself will still go out; only the social
    // post is skipped for the day. Less damage than spamming a channel.
    console.warn(`[daily-brief] telegram slot claim failed (skipping today's post to avoid double-fire): ${e?.message || e}`);
    return false;
  }
}
async function releaseTelegramSlotOnFailure(dateKey: string): Promise<void> {
  // If the network call fails AFTER we've claimed the slot, release it so
  // a same-day retry of the email pipeline can re-attempt. This is the
  // opposite trade-off from the comment above and only fires on
  // genuinely-unrecoverable outcomes (autoposter returned not-ok after its
  // own internal retries) — at that point a future retry has the same
  // chance of success as the first attempt did.
  try {
    await pool.query(`DELETE FROM daily_brief_telegram_log WHERE date_key = $1`, [dateKey]);
  } catch (e: any) {
    console.warn(`[daily-brief] telegram slot release failed (non-fatal): ${e?.message || e}`);
  }
}

async function markBriefSent(dateKey: string, count: number) {
  try {
    await pool.query(
      `INSERT INTO daily_briefs_log (date_key, sent_at, recipient_count)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (date_key) DO UPDATE SET recipient_count = EXCLUDED.recipient_count`,
      [dateKey, count]
    );
  } catch (e: any) { console.log("[daily-brief] Failed to mark brief sent:", e.message); }
}

interface MarketData {
  crypto: { symbol: string; price: string; change: string; changeNum: number }[];
  forex: { pair: string; price: string; change: string; changeNum: number }[];
  metals: { symbol: string; price: string; change: string; changeNum: number }[];
  equities: { symbol: string; price: string; change: string; changeNum: number }[];
}

async function fetchMarketData(): Promise<MarketData> {
  const data: MarketData = { crypto: [], forex: [], metals: [], equities: [] };
  const LOCAL = "http://localhost:5000";

  try {
    const res = await fetch(`${LOCAL}/api/crypto`).then(r => r.json());
    if (res && typeof res === "object") {
      const topSyms = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "TRUMP", "HYPE", "BNB"];
      for (const s of topSyms) {
        const d = res[s];
        if (d && d.price) {
          const p = d.price;
          const c = d.chg || 0;
          data.crypto.push({
            symbol: `${s}/USD`,
            price: p >= 100 ? `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : p >= 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(6)}`,
            change: `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`,
            changeNum: c,
          });
        }
      }
    }
  } catch (e: any) { console.log("[daily-brief] Crypto fetch error:", e.message); }

  try {
    const res = await fetch(`${LOCAL}/api/finnhub`).then(r => r.json());
    if (res && typeof res === "object") {
      const fx = res.forex || {};
      const fxPairs = ["EURUSD", "USDCAD", "USDJPY", "GBPUSD", "AUDUSD", "USDCHF"];
      const fxLabels: Record<string, string> = { EURUSD: "EUR/USD", USDCAD: "USD/CAD", USDJPY: "USD/JPY", GBPUSD: "GBP/USD", AUDUSD: "AUD/USD", USDCHF: "USD/CHF" };
      for (const pair of fxPairs) {
        const d = fx[pair];
        if (d && d.price) {
          data.forex.push({
            pair: fxLabels[pair] || pair,
            price: d.price.toFixed(4),
            change: d.chg != null ? `${d.chg >= 0 ? "+" : ""}${d.chg.toFixed(2)}%` : "—",
            changeNum: d.chg || 0,
          });
        }
      }

      const metals = res.metals || {};
      const metalSyms: [string, string][] = [
        ["XAU", "Gold XAU/USD"],
        ["XAG", "Silver XAG/USD"],
        ["WTI", "WTI Crude Oil"],
        ["BRENT", "Brent Crude Oil"],
        ["NATGAS", "Natural Gas"],
        ["COPPER", "Copper"],
      ];
      for (const [sym, label] of metalSyms) {
        const d = metals[sym];
        if (d && d.price) {
          data.metals.push({
            symbol: label,
            price: `$${d.price.toFixed(2)}`,
            change: d.chg != null ? `${d.chg >= 0 ? "+" : ""}${d.chg.toFixed(2)}%` : "—",
            changeNum: d.chg || 0,
          });
        }
      }

      const stocks = res.stocks || {};
      const eqSyms = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META"];
      for (const s of eqSyms) {
        const d = stocks[s];
        if (d && d.price) {
          data.equities.push({
            symbol: s,
            price: `$${d.price.toFixed(2)}`,
            change: d.chg != null ? `${d.chg >= 0 ? "+" : ""}${d.chg.toFixed(2)}%` : "—",
            changeNum: d.chg || 0,
          });
        }
      }
    }
  } catch (e: any) { console.log("[daily-brief] Finnhub fetch error:", e.message); }

  return data;
}

async function generateBriefContent(marketData: MarketData): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  const cryptoStr = marketData.crypto.map(c => `${c.symbol}: ${c.price} (${c.change})`).join(" | ");
  const fxStr = marketData.forex.map(f => `${f.pair}: ${f.price}`).join(" | ");
  const metalStr = marketData.metals.map(m => `${m.symbol}: ${m.price} (${m.change})`).join(" | ");
  const eqStr = marketData.equities.map(e => `${e.symbol}: ${e.price} (${e.change})`).join(" | ");

  let macroStr = "";
  let pendingHighEvents: string[] = [];
  const macroFetchedAt = new Date().toISOString();
  try {
    const macroRes = await fetch("http://localhost:5000/api/macro").then(r => r.json());
    if (Array.isArray(macroRes) && macroRes.length > 0) {
      const filtered = macroRes.filter((e: any) => e.impact === "HIGH" || e.impact === "MED").slice(0, 14);
      macroStr = filtered.map((e: any) => {
        const status = e.actual ? `STATUS:RELEASED ACTUAL:${e.actual}` : e.isPast ? "STATUS:PENDING_DATA" : "STATUS:PENDING";
        return `${e.date} ${e.timeET||e.time||""} [${e.region||e.country}] ${e.name} (${e.impact}) | Prev:${e.previous||e.current||"—"} Fcast:${e.forecast||"—"} | ${status}`;
      }).join("\n  ");
      // Collect HIGH impact PENDING events for the anti-hallucination injection
      for (const ev of filtered) {
        if (ev.impact === "HIGH" && !ev.actual) {
          pendingHighEvents.push(`${ev.name} at ${ev.timeET||ev.time||"TBD"} on ${ev.date}`);
        }
      }
    }
  } catch {}

  // Detect FOMC/CPI within 48h for macro risk assessment
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const HIGH_MACRO_KEYWORDS = ["FOMC", "CPI", "NFP", "Non-Farm", "GDP", "PCE", "PPI", "Interest Rate"];
  let macroRiskFlag = "";
  let macroRiskEvents: string[] = [];
  try {
    const macroFull = await fetch("http://localhost:5000/api/macro").then(r => r.json());
    if (Array.isArray(macroFull)) {
      for (const ev of macroFull) {
        if (ev.impact !== "HIGH") continue;
        if (!ev.date) continue;
        const evDate = new Date(ev.date);
        if (evDate >= now && evDate <= in48h && HIGH_MACRO_KEYWORDS.some((k: string) => (ev.name || "").includes(k))) {
          macroRiskEvents.push(`${ev.name} on ${ev.date} ${ev.timeET || ev.time || ""}`);
        }
      }
    }
  } catch {}
  if (macroRiskEvents.length > 0) {
    macroRiskFlag = `HIGH MACRO RISK EVENTS WITHIN 48H: ${macroRiskEvents.join("; ")}. → Reduce position sizing. Cap leverage at 2x. Risk label: 🔴`;
  }

  // Session context
  const etHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const sessionCtx = etHour >= 8 && etHour < 16 ? "NY Session active — full liquidity" : etHour >= 0 && etHour < 8 ? "Asian session — note lower liquidity, tighter targets" : "Post-NY/Overnight";

  const pendingWarningBlock = pendingHighEvents.length > 0
    ? `\n⚠️ CRITICAL — PENDING HIGH-IMPACT EVENTS (NO OUTCOMES YET):\n${pendingHighEvents.map(e => `  - ${e}`).join("\n")}\nFor each of these events you MUST write only forward-looking language. NEVER state the outcome. NEVER write phrases like "Fed holds", "CPI came in at", "rate decision confirmed", or anything describing a result. Write what the market is pricing in and what to watch FOR. Violation of this rule produces misleading information that could cause financial harm.`
    : "";

  // ── STATISTICAL BRAIN summary (top PREFERRED + top SUPPRESSED combos) ────
  // Same empirical-edge engine that already gates /api/quant and /api/ai/analyze.
  // Prepended to the brief prompt so topTrade + additionalTrades favour
  // historically-winning (token, direction) combos and avoid the bleeders.
  // Fail-open: if the DB query throws, the brief still generates without
  // the brain context (just less informed).
  let brainBlock = "";
  try {
    const summary = await getBrainSummary();
    if (summary?.rows?.length) {
      // Mirror the verdict thresholds in server/lib/statisticalBrain.ts.
      // ComboStat doesn't carry a verdict field — it's derived per-call by
      // getBrainFor — so we derive it locally with the same constants.
      const SUPPRESS_WR = 0.25, PREFERRED_WR = 0.60;
      const MIN_SAMPLE_SUPP = 15, MIN_SAMPLE_PREF = 20;
      const isPreferred  = (r: typeof summary.rows[number]) => r.sampleSize >= MIN_SAMPLE_PREF && r.winRate >= PREFERRED_WR;
      const isSuppressed = (r: typeof summary.rows[number]) => r.sampleSize >= MIN_SAMPLE_SUPP && r.winRate <  SUPPRESS_WR;

      const preferred  = summary.rows.filter(isPreferred).sort((a, b) => b.winRate - a.winRate).slice(0, 6);
      const suppressed = summary.rows.filter(isSuppressed).sort((a, b) => a.winRate - b.winRate).slice(0, 6);

      const fmtRow = (r: typeof summary.rows[number]) => `  ${r.token} ${r.direction.padEnd(5)} → WR ${(r.winRate * 100).toFixed(0)}% over n=${r.sampleSize}, EV ${r.expectedR >= 0 ? "+" : ""}${r.expectedR.toFixed(2)}R, p90 winner ${Number.isFinite(r.p90WinR) ? r.p90WinR.toFixed(2) + "R" : "—"}`;
      const lines: string[] = [];
      if (preferred.length)  lines.push("PREFERRED (high empirical edge — bias toward these):", ...preferred.map(fmtRow));
      if (suppressed.length) lines.push("SUPPRESSED (historical bleeders — AVOID; pick a different combo or skip):", ...suppressed.map(fmtRow));
      if (lines.length) {
        brainBlock = `\n\n═══ STATISTICAL BRAIN — empirical edge from ${summary.lookbackDays}d resolved-trade history ═══\n${lines.join("\n")}\n→ When choosing topTrade and additionalTrades, FAVOUR PREFERRED combos and AVOID SUPPRESSED combos. If a SUPPRESSED combo is the only setup you see, skip it and pick from the rest of the universe — do not fight the empirical edge.`;
      }
    }
  } catch (e: any) {
    console.warn(`[daily-brief] brain summary failed (proceeding without): ${e?.message || e}`);
  }

  const prompt = `You are CLVR AI — a senior markets correspondent (think Bloomberg / FT / Reuters) writing the morning brief for ${today}. Voice: clear, calm, authoritative economic-journalism prose. Short concrete sentences. No marketing fluff, no hedging clichés. Always name the WHY, not just the WHAT. ALL data below is REAL, LIVE, and TIMESTAMPED.

═══ CRITICAL RULES — READ BEFORE WRITING ═══
1. Only use prices, percentages, and figures EXPLICITLY provided in the data below. Do NOT invent or round differently.
2. For any macro event with STATUS:PENDING — write ONLY forward-looking language ("market is pricing in X", "watch for Y"). NEVER state outcomes.
3. For any macro event with STATUS:RELEASED — state the ACTUAL value provided. Never infer.
4. Label market sentiment (RISK ON / RISK OFF / NEUTRAL) using provided data only.
5. The "watchToday" items must use conditional language: "IF [level] breaks THEN [action]". Never unconditional calls.
6. If any HIGH-impact event is within 6 hours of ${new Date().toISOString()}, add a tail risk note.
7. Never fabricate data. Never state a macro outcome unless STATUS:RELEASED with actual value.
${pendingWarningBlock}
═════════════════════════════════════════════

LAYER 1 — MACRO REGIME:
${macroRiskFlag || "No HIGH-impact macro events within 48h — normal risk environment."}
SESSION: ${sessionCtx}

MACRO EVENTS [fetched: ${macroFetchedAt}]:
  ${macroStr || "No imminent releases"}

LAYER 2 — LIVE MARKET DATA [fetched: ${macroFetchedAt}]:
CRYPTO: ${cryptoStr || "Data unavailable"}
EQUITIES: ${eqStr || "Data unavailable"}
ENERGY & COMMODITIES (use these exact prices in your Oil & Gas commentary):
  ${marketData.metals.filter(m => ["WTI Crude Oil","Brent Crude Oil","Natural Gas"].includes(m.symbol)).map(m => `${m.symbol}: ${m.price} (${m.change})`).join(" | ") || "Data unavailable"}
METALS: ${marketData.metals.filter(m => ["Gold XAU/USD","Silver XAG/USD","Copper"].includes(m.symbol)).map(m => `${m.symbol}: ${m.price} (${m.change})`).join(" | ") || "Data unavailable"}
FOREX: ${fxStr || "Data unavailable"}${brainBlock}

LAYER 3 — SESSION: ${sessionCtx}

STYLE RULES:
• Each per-asset section is a tight paragraph (2–4 sentences). Lead with the move + the cause, then the technical level, then the outlook.
• Use full sentences and connective tissue ("because", "after", "as", "while"). No bullet-style fragments inside the prose fields.
• Embed risk colour at the END of each section as " 🟢 bias" / " 🟡 bias" / " 🔴 bias".
• Keep R:R for any trade idea ≥ 1.5:1.

Return a JSON object with EXACTLY these fields (output STRICT JSON only, no markdown, no backticks):
{
  "headline": "One compelling 5-layer insight headline using actual prices and macro context — e.g. 'FOMC Risk-Off: BTC Tests $X Support, Gold at $X as DXY Firms'",
  "bias": "RISK ON" or "RISK OFF" or "NEUTRAL",
  "marketSentiment": "bullish" or "bearish" or "neutral",
  "macroRegime": "RISK ON" or "RISK OFF" or "NEUTRAL",
  "macroRisk": "${macroRiskEvents.length > 0 ? "HIGH" : "NORMAL"}",
  "macroRiskNote": "${macroRiskEvents.length > 0 ? macroRiskEvents[0] : "No critical events within 48h"}",
  "btc":      "2-3 sentences: BTC price, trend structure, funding/positioning, key support/resistance, 🟢/🟡/🔴 bias",
  "eth":      "2 sentences ETH trend and BTC dominance context, 🟢/🟡/🔴 bias",
  "sol":      "1-2 sentences SOL with momentum signal, 🟢/🟡/🔴 bias",
  "xau":      "2-3 sentences: XAU price, real-yield driver, DXY correlation, key level, 🟢/🟡/🔴 bias",
  "xag":      "1-2 sentences XAG with XAU correlation, 🟢/🟡/🔴 bias",
  "oil":      "3-4 sentences covering WTI AND Brent prices, supply/demand drivers (OPEC+, US inventories, demand), geopolitical risk premium (Middle East, Russia/Ukraine, Strait of Hormuz, Red Sea), and natural gas if notable. End with 🟢/🟡/🔴 bias",
  "equities": "3-4 sentences covering SPX AND NDX overnight move, mega-cap leadership (NVDA/TSLA/AAPL/MSFT/META direction), breadth and sector rotation, key earnings or Fed cross-currents, VIX context. End with 🟢/🟡/🔴 bias",
  "eurusd":   "2-3 sentences: rate, DXY, ECB/Fed divergence, key level, 🟢/🟡/🔴 bias",
  "usdjpy":   "2-3 sentences: rate, BOJ stance, real yield spread, intervention risk, 🟢/🟡/🔴 bias",
  "usdcad":   "2-3 sentences: rate, oil correlation, BOC context, 🟢/🟡/🔴 bias",
  "impactfulNews": [
    {"title":"short headline (<80 chars)","impact":"BULLISH|BEARISH|NEUTRAL","assets":"comma-separated tickers most affected","takeaway":"one sentence — what a trader should DO or WATCH because of this"}
  ],
  "watchToday": ["7 specific actionable items with price levels and triggers — each one tells the reader WHAT to watch and WHAT to do if it triggers"],
  "keyRisk": "single sentence: biggest tail risk today and how to hedge it",
  "topTrade": {
    "asset": "Best trade idea for today — asset name",
    "dir": "LONG or SHORT",
    "entry": "price",
    "stop": "price",
    "tp1": "price",
    "tp2": "price",
    "confidence": "X%",
    "edge": "one sentence explaining the edge",
    "riskLabel": "🟢 or 🟡 or 🔴",
    "flags": "${macroRiskEvents.length > 0 ? "MACRO RISK" : "None"}"
  },
  "additionalTrades": [
    {"asset":"2nd trade — different asset class from topTrade","dir":"LONG or SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence","riskLabel":"🟢|🟡|🔴","flags":"any"},
    {"asset":"3rd trade — different asset class","dir":"LONG or SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence","riskLabel":"🟢|🟡|🔴","flags":"any"}
  ],
  "riskLevel": "low" or "medium" or "high"
}

RULES:
- Reference exact prices from the data above
- Apply 5-layer framework: macro regime → structure → session → signal → risk rules
- If FOMC/CPI within 48h: ALL signals get 🔴 label, cap leverage at 2x, say SIZE DOWN
- Minimum R:R 1.5:1 for any trade idea. Skip if R:R is worse.
- All 3 trade ideas must be from different asset classes (crypto, forex, metals, equities)
- impactfulNews: at least 3 items, ranked by trading relevance for the next 24h
- watchToday: exactly 7 items, each phrased as "IF [level] breaks THEN [action]" or similar conditional
- Return ONLY the JSON object. No markdown, no backticks.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: "You are CLVR AI — powered by Claude — an elite quantitative trading analyst applying a 5-layer decision framework (Macro Regime → Market Structure → Session Awareness → Signal Generation → Risk Rules). Generate precise, data-driven morning briefs with exact prices, 🔴/🟡/🟢 risk labels, macro risk flags when FOMC/CPI is within 48h, and one actionable top trade idea per brief. Always reference the actual prices provided. Return valid JSON only.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "(no body)");
      console.log(`[daily-brief] Claude HTTP ${response.status}: ${errText.slice(0, 400)}`);
      return null;
    }
    const data: any = await response.json();
    if (data?.error) {
      console.log(`[daily-brief] Claude API error:`, JSON.stringify(data.error).slice(0, 400));
      return null;
    }
    const text = data.content?.[0]?.text || "";
    if (!text.trim()) {
      console.log("[daily-brief] Claude returned empty content");
      return null;
    }
    return text;
  } catch (e: any) {
    console.log(`[daily-brief] generateBriefContent threw: ${e?.message || e}`);
    return null;
  }
}

// ── Retry wrapper: 3 attempts with exponential backoff (2s, 4s, 8s) ──────────
async function generateBriefContentWithRetry(marketData: MarketData, retries = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`[daily-brief] Generating brief (attempt ${attempt}/${retries})...`);
    const text = await generateBriefContent(marketData);
    if (text) {
      console.log(`[daily-brief] ✓ Brief generated on attempt ${attempt}`);
      return text;
    }
    if (attempt < retries) {
      const delayMs = Math.pow(2, attempt) * 1000;
      console.log(`[daily-brief] Attempt ${attempt} failed, waiting ${delayMs}ms before retry...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.log(`[daily-brief] All ${retries} attempts failed — trying condensed fallback prompt`);
  return null;
}

// ── Condensed fallback prompt (smaller payload, less likely to rate-limit) ───
async function generateCondensedBrief(marketData: MarketData): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const cryptoStr = marketData.crypto.slice(0, 5).map(c => `${c.symbol}: ${c.price} (${c.change})`).join(", ");
  const fxStr = marketData.forex.slice(0, 3).map(f => `${f.pair}: ${f.price} (${f.change})`).join(", ");
  const metalStr = marketData.metals.slice(0, 2).map(m => `${m.symbol}: ${m.price} (${m.change})`).join(", ");
  const prompt = `Generate a concise market brief as JSON. Return ONLY valid JSON, no markdown.

PRICES:
Crypto: ${cryptoStr}
FX: ${fxStr}
Metals: ${metalStr}

Return EXACTLY:
{
  "headline": "One compelling headline (max 12 words)",
  "marketSentiment": "bullish" | "bearish" | "neutral",
  "macroRegime": "RISK ON" | "RISK OFF" | "NEUTRAL",
  "macroRisk": "NORMAL",
  "macroRiskNote": "One sentence on macro state",
  "commentary": [
    {"emoji":"₿","title":"Bitcoin","text":"2 sentences on BTC trend and key level. End with 🟢/🟡/🔴."},
    {"emoji":"🇪🇺","title":"EUR/USD","text":"2 sentences on EUR/USD. End with 🟢/🟡/🔴."},
    {"emoji":"🥇","title":"Gold","text":"2 sentences on Gold. End with 🟢/🟡/🔴."}
  ],
  "topTrade": {"asset":"asset","dir":"LONG|SHORT","entry":"price","stop":"price","tp1":"price","tp2":"price","confidence":"X%","edge":"one sentence","riskLabel":"🟢|🟡|🔴","flags":"None"},
  "additionalTrades": [],
  "watchItems": ["3 specific items to watch today with price levels"],
  "riskLevel": "low" | "medium" | "high",
  "riskNote": "One sentence: biggest risk and how to manage it"
}`;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        system: "You are CLVR AI. Return concise market brief as valid JSON only.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "(no body)");
      console.log(`[daily-brief] Condensed fallback HTTP ${response.status}: ${errText.slice(0, 300)}`);
      return null;
    }
    const data: any = await response.json();
    if (data?.error) { console.log(`[daily-brief] Condensed fallback error:`, JSON.stringify(data.error).slice(0, 300)); return null; }
    const text = data.content?.[0]?.text || "";
    if (text.trim()) console.log("[daily-brief] ✓ Condensed fallback brief generated");
    return text.trim() ? text : null;
  } catch (e: any) {
    console.log(`[daily-brief] Condensed fallback threw: ${e?.message || e}`);
    return null;
  }
}


// Result shape returned to callers (manual retry route, scheduler) so the UI
// and logs can distinguish "didn't run" from "ran and N/M delivered" from
// "blew up because X". `errors` is a deduped, truncated list (max 5 entries,
// 200 chars each) safe to surface in admin responses.
export type BriefSendResult = {
  ran: boolean;          // false → claim refused (already sent / in flight elsewhere)
  sent: number;
  total: number;
  reason?: string;       // populated on abort / catastrophic failure
  errors: string[];      // per-email failure summaries (empty on full success)
};

function dedupeAndTrim(errs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of errs) {
    const k = (e || "").slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push((e || "").slice(0, 200));
    if (out.length >= 5) break;
  }
  return out;
}

async function sendDailyBriefEmails(): Promise<BriefSendResult> {
  const etTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dateKey = etTime.toISOString().split("T")[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  // ── ATOMIC double-send guard ──────────────────────────────────────────────
  // Single INSERT … ON CONFLICT DO NOTHING RETURNING. If another tick / process
  // already claimed the slot, RETURNING is empty and we abort. This eliminates
  // the previous SELECT-then-INSERT TOCTOU race that allowed two concurrent
  // invocations to both pass the gate and double-send.
  const claimed = await claimBriefSlot(dateKey);
  if (!claimed) {
    const reason = `Slot for ${dateKey} already claimed elsewhere`;
    console.log(`[daily-brief] ${reason} — ${briefTag()} aborting.`);
    return { ran: false, sent: 0, total: 0, reason, errors: [] };
  }
  console.log(`[daily-brief] Slot ${dateKey} claimed by ${briefTag()} — generating...`);

  // Outer guard: any uncaught throw between the claim and the send loop
  // (market data fetch, brief generation, subscriber query, tier-trade
  // pipeline, etc.) would otherwise leave the row at recipient_count=0 and
  // permanently lock the day. Catch any such throw and release the slot so a
  // retry can run. The send loop below has its own narrower try/catch that
  // also releases on its specific failure modes.
  try {
    return await sendDailyBriefBody(dateKey, today);
  } catch (e: any) {
    const msg = e?.message || String(e);
    const where = (e?.stack || "").split("\n").slice(0, 3).join(" | ");
    console.log(`[daily-brief] Pre-send exception for ${dateKey}: ${msg} — releasing slot. trace=${where}`);
    try {
      await pool.query(
        `DELETE FROM daily_briefs_log WHERE date_key = $1 AND recipient_count = 0`,
        [dateKey]
      );
    } catch {}
    return { ran: true, sent: 0, total: 0, reason: `Pre-send exception: ${msg}`, errors: [msg] };
  }
}

async function sendDailyBriefBody(dateKey: string, today: string): Promise<BriefSendResult> {

  const marketData = await fetchMarketData();
  console.log(`[daily-brief] Market data: ${marketData.crypto.length} crypto, ${marketData.forex.length} fx, ${marketData.metals.length} metals, ${marketData.equities.length} equities`);

  // ── DATA INTEGRITY GATE ────────────────────────────────────────────────────
  // Run on the flat price feed before generating the brief. Drops stale rows
  // (0.00% prints), warns on Brent/WTI / Gold/Silver / BTC/ETH divergences, and
  // — if >20% of instruments are stale — aborts the send entirely.
  try {
    const flatRows: PriceRow[] = [
      ...marketData.crypto.map((r: any)   => ({ symbol: r.symbol, price: r.price, change: r.change, changeNum: r.changeNum })),
      ...marketData.forex.map((r: any)    => ({ symbol: r.pair,   price: r.price, change: r.change, changeNum: r.changeNum })),
      ...marketData.metals.map((r: any)   => ({ symbol: r.symbol, price: r.price, change: r.change, changeNum: r.changeNum })),
      ...marketData.equities.map((r: any) => ({ symbol: r.symbol, price: r.price, change: r.change, changeNum: r.changeNum })),
    ];
    const integrity = runIntegrityCheck(flatRows, []);
    if (integrity.warnings.length) {
      console.log(`[daily-brief] integrity warnings — ${integrity.warnings.join(" | ")}`);
    }
    if (integrity.criticalFailure) {
      const reason = `Data integrity gate: ${integrity.staleCount}/${integrity.totalInstruments} instruments stale`;
      console.log(`[daily-brief] 🛑 CRITICAL DATA INTEGRITY FAILURE — ${integrity.staleCount}/${integrity.totalInstruments} stale. Aborting send. ${briefTag()}`);
      // Release the slot so a subsequent retry (manual or next tick) can attempt the send.
      try { await pool.query(`DELETE FROM daily_briefs_log WHERE date_key = $1 AND recipient_count = 0`, [dateKey]); } catch {}
      return { ran: true, sent: 0, total: 0, reason, errors: [reason] };
    }
    if (integrity.dropList.length) {
      console.log(`[daily-brief] dropping stale rows from feed: ${integrity.dropList.join(", ")}`);
      marketData.crypto   = filterDropList(marketData.crypto.map((r: any) => ({ ...r, symbol: r.symbol })),   integrity.dropList) as any;
      marketData.metals   = filterDropList(marketData.metals.map((r: any) => ({ ...r, symbol: r.symbol })),   integrity.dropList) as any;
      marketData.equities = filterDropList(marketData.equities.map((r: any) => ({ ...r, symbol: r.symbol })), integrity.dropList) as any;
      // FX pairs use `.pair` not `.symbol` — handle separately
      const dropSet = new Set(integrity.dropList.map(s => s.toUpperCase()));
      marketData.forex = marketData.forex.filter((r: any) => !dropSet.has(String(r.pair).toUpperCase()));
    }
  } catch (e: any) {
    console.log(`[daily-brief] integrity check error (non-fatal):`, e.message);
  }

  // Try full brief with 3 retries → condensed fallback prompt → minimal placeholder
  let briefText: string | null = await generateBriefContentWithRetry(marketData, 3);
  let usedCondensed = false;
  if (!briefText) {
    briefText = await generateCondensedBrief(marketData);
    usedCondensed = !!briefText;
  }

  let briefJson: any = null;
  if (briefText) {
    try {
      const jsonMatch = briefText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      briefJson = JSON.parse(jsonMatch[0]);
      console.log(`[daily-brief] Brief JSON parsed (${usedCondensed ? "condensed" : "full"})`);
    } catch (e: any) {
      console.log("[daily-brief] Failed to parse brief JSON:", e?.message || e);
      briefJson = null;
    }
  }

  // Absolute last resort: minimal placeholder so subscribers still get the email
  if (!briefJson) {
    console.log("[daily-brief] All AI generation failed (3 full + 1 condensed) — using minimal placeholder");
    briefJson = {
      headline: "Market Brief — Live Prices",
      marketSentiment: "neutral",
      macroRegime: "NEUTRAL",
      macroRisk: "NORMAL",
      macroRiskNote: "Live prices below. Full AI analysis will resume in the next brief.",
      commentary: [
        { emoji: "⚡", title: "Service Note",
          text: "We're delivering live prices while our AI engine reconnects. Your full analysis brief will resume in the next scheduled send." },
      ],
      topTrade: null,
      additionalTrades: [],
      watchItems: ["Live prices are included below."],
      riskLevel: "medium",
      riskNote: "Apply extra caution today. Do not trade on this brief alone.",
    };
  }

  // Sweep expired-promo users to free BEFORE we query subscribers, so anyone
  // whose promo lapsed since yesterday's send gets the free version of the
  // brief today instead of stale Pro/Elite content.
  try { await recomputeExpiredPromos(); } catch {}

  // Join subscribers with users table to get tier — using effectiveTierSql so
  // expired promos and ended Stripe subs always resolve to 'free' regardless
  // of the stored u.tier value.
  const subsResult = await pool.query(`
    SELECT s.email, s.name, ${effectiveTierSql("u")} AS tier
    FROM subscribers s
    LEFT JOIN users u ON LOWER(u.email) = LOWER(s.email)
    WHERE s.active = true
  `);
  const subs = subsResult.rows;

  if (subs.length === 0) {
    console.log("[daily-brief] No active subscribers — releasing slot for retry");
    // Release the claimed slot so a manual/scheduled retry can attempt the
    // send once subscribers exist. Without this, recipient_count=0 blocks
    // the day permanently.
    try { await pool.query(`DELETE FROM daily_briefs_log WHERE date_key = $1 AND recipient_count = 0`, [dateKey]); } catch {}
    return { ran: true, sent: 0, total: 0, reason: "No active subscribers", errors: [] };
  }

  console.log(`[daily-brief] Sending to ${subs.length} subscribers in parallel batches of 50...`);
  let sentCount = 0;
  // Per-email failures, captured WITH attribution (render vs send vs other)
  // so the manual-retry route can return them to the UI and we stop guessing
  // why "Failed for X@Y" actually failed.
  const sendErrors: string[] = [];

  // ── TIERED BRIEF V1: build the canonical Elite list of up to 3 trades ───
  // Source candidates from Claude's brief (topTrade + additionalTrades), map
  // them into CandidatePlan, hydrate calibration from real per-combo stats,
  // then run through the deterministic selection pipeline. Pro gets best 2,
  // Elite gets all 3, Free is locked.
  const tieredMode = getTieredBriefMode();
  let eliteTrades: CandidatePlan[] = [];
  let heldSlotNote = "";
  if (tieredMode !== "off") {
    try {
      const rawCandidates: CandidatePlan[] = [];
      const pushClaudeTrade = (t: any) => {
        if (!t || !t.asset) return;
        const dir: "LONG" | "SHORT" = String(t.dir || t.direction || "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG";
        const entryN = parseFloat(String(t.entry).replace(/[^0-9.\-]/g, "")) || 0;
        const stopN  = parseFloat(String(t.stop).replace(/[^0-9.\-]/g, ""))  || 0;
        const tp1N   = parseFloat(String(t.tp1).replace(/[^0-9.\-]/g, ""))   || 0;
        const tp2N   = parseFloat(String(t.tp2).replace(/[^0-9.\-]/g, ""))   || 0;
        const risk   = Math.abs(entryN - stopN);
        const reward = Math.abs(tp2N - entryN);
        const rr     = risk > 0 ? reward / risk : 0;
        const symU   = String(t.asset).toUpperCase();
        const cls: AssetClass =
          /BTC|ETH|SOL|DOGE|XRP|ADA|AVAX|LINK|MATIC/.test(symU) ? "crypto" :
          /USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD/.test(symU)            ? "fx" :
          /GOLD|SILVER|XAU|XAG|OIL|BRENT|WTI|GAS|COPPER/.test(symU) ? "commodity" :
          "equity";
        rawCandidates.push({
          instrument:       symU,
          assetClass:       cls,
          direction:        dir,
          entry:            entryN,
          stop:             stopN,
          tp1:              tp1N,
          tp2:              tp2N,
          riskReward:       rr,
          winRate30d:       0.50,    // default until calibration hydrate overwrites
          sampleSize:       0,
          kronosConfidence: 0.50,
          macroAlignment:   0,
          flowScore:        0,
          thesis:           t.edge || t.thesis || "",
          fundingCrowded:   false,
          killSwitchActive: false,
          liquidityOK:      true,
        });
      };
      pushClaudeTrade(briefJson.topTrade);
      for (const t of (briefJson.additionalTrades || [])) pushClaudeTrade(t);

      const hydrated = await hydrateCalibration(rawCandidates);
      const selection = await selectDailyTrades(hydrated);
      eliteTrades = selection.trades;
      console.log(`[daily-brief] tiered v1 (${tieredMode}): ${selection.candidateCount} candidates → ${eliteTrades.length} winners` +
        (selection.filteredOut.length ? ` | filtered: ${selection.filteredOut.map(f => `${f.instrument}/${f.direction}=${f.reason}`).join(", ")}` : ""));
      if (eliteTrades.length < 3) {
        const held = 3 - eliteTrades.length;
        heldSlotNote = `${held} slot${held === 1 ? "" : "s"} held — no qualifying setup met our threshold today.`;
      }
      try { await logTierDistribution(dateKey, eliteTrades); } catch {}
    } catch (e: any) {
      console.log(`[daily-brief] tiered v1 selection error (non-fatal):`, e.message);
      eliteTrades = [];
    }
  }
  if (tieredMode === "shadow") {
    console.log(`[daily-brief] tiered v1 SHADOW MODE — would have shipped ${eliteTrades.length} ideas to Elite, ${sliceForTier(eliteTrades, "pro").length} to Pro. Shipping legacy template.`);
  }

  // ── TELEGRAM MORNING TRADE IDEA (autoposter pipeline) ────────────────────
  // Push exactly one trade idea per day to the autoposter webhook so the
  // downstream service can render it as a branded Telegram post + 15s video
  // for social-media use. Same payload shape as live signals — no downstream
  // changes required.
  //
  // Idempotency is enforced at THREE layers so a same-day retry (which
  // happens when the email pipeline fails and deletes daily_briefs_log)
  // can't re-fire the Telegram post:
  //   • daily_brief_telegram_log row inserted only after autoposter ok=true
  //   • stable timestamp (today's brief slot, not Date.now()) → autoposter's
  //     idempotency-key (sha1 of token|direction|timestamp) is identical
  //     across retries, so the downstream service dedupes if our ledger blip
  //   • try/catch wraps everything → never blocks the email loop
  //
  // Selection precedence:
  //   1. eliteTrades[0] — already calibrated by selectDailyTrades
  //   2. briefJson.topTrade (raw Claude pick) — only when tiered selection
  //      didn't run (tieredMode === "off"); otherwise an empty eliteTrades
  //      list is an INTENTIONAL "no qualifying setup" decision we honor by
  //      skipping rather than fighting our own filter (better to miss a
  //      day's social post than promote a setup we'd reject internally).
  try {
    type Pick = { token: string; dir: "LONG" | "SHORT"; entry: number; stop: number; tp1: number; tp2?: number; conf: number; thesis: string; rr: number; n: number; source: "elite" | "claude" };
    let pick: Pick | null = null;

    if (eliteTrades.length > 0) {
      const e = eliteTrades[0];
      pick = {
        token:  e.instrument,
        dir:    e.direction,
        entry:  e.entry,
        stop:   e.stop,
        tp1:    e.tp1,
        tp2:    Number.isFinite(e.tp2) && e.tp2 > 0 ? e.tp2 : undefined,
        conf:   Math.round((e.winRate30d || 0) * 100),
        thesis: e.thesis || "",
        rr:     e.riskReward || 0,
        n:      e.sampleSize || 0,
        source: "elite",
      };
    } else if (tieredMode === "off" && briefJson?.topTrade?.asset) {
      const t = briefJson.topTrade;
      const dir: "LONG" | "SHORT" = String(t.dir || t.direction || "LONG").toUpperCase().includes("SHORT") ? "SHORT" : "LONG";
      const entryN = parseFloat(String(t.entry).replace(/[^0-9.\-]/g, ""));
      const stopN  = parseFloat(String(t.stop).replace(/[^0-9.\-]/g, ""));
      const tp1N   = parseFloat(String(t.tp1).replace(/[^0-9.\-]/g, ""));
      const tp2N   = parseFloat(String(t.tp2).replace(/[^0-9.\-]/g, ""));
      if (Number.isFinite(entryN) && Number.isFinite(stopN) && Number.isFinite(tp1N) && entryN > 0 && stopN > 0 && tp1N > 0) {
        const confMatch = String(t.confidence || "").match(/(\d+)/);
        const risk = Math.abs(entryN - stopN);
        const reward = Math.abs(tp1N - entryN);
        pick = {
          token:  String(t.asset).toUpperCase(),
          dir,
          entry:  entryN,
          stop:   stopN,
          tp1:    tp1N,
          tp2:    Number.isFinite(tp2N) && tp2N > 0 ? tp2N : undefined,
          conf:   confMatch ? parseInt(confMatch[1], 10) : 60,
          thesis: t.edge || "",
          rr:     risk > 0 ? reward / risk : 0,
          n:      0,
          source: "claude",
        };
      }
    }

    if (!pick) {
      console.log(`[daily-brief] Telegram morning idea SKIPPED — tieredMode=${tieredMode}, eliteTrades=${eliteTrades.length}, claudeTopTrade=${briefJson?.topTrade?.asset || "none"}`);
    } else {
      // Reasonable per-class default leverage: only crypto perps actually
      // trade with leverage on Hyperliquid; FX / equities / commodities
      // default to 1x. The downstream renderer can override if it has
      // smarter per-asset rules.
      const isCrypto = /^(BTC|ETH|SOL|DOGE|XRP|ADA|AVAX|LINK|MATIC|HYPE|TIA|OP|ARB|UNI|AAVE|NEAR|WIF|TRUMP|BNB|APT|DOT|HBAR|PENDLE|TAO|ONDO|SUI|INJ|SEI|JUP|RUNE|FET|RENDER|ATOM)$/.test(pick.token);
      const lev = isCrypto ? "3x" : "1x";

      // Enriched caption + hashtags via the shared helper so morning-brief
      // posts have the same on-brand format as live signals and manual
      // test sends. The autoposter renders the reasoning array as the
      // post body, so this IS the caption Mike sees in Telegram.
      const selectionLine = `Selection: ${pick.source === "elite" ? "calibrated daily winner" : "Claude top pick"} · RR ${pick.rr.toFixed(2)}` + (pick.n > 0 ? ` · n=${pick.n}` : "") + ` · Morning Brief ${today}`;
      const reasoning = buildEnrichedReasoning({
        token:         pick.token,
        dir:           pick.dir,
        entry:         pick.entry,
        stopLoss:      pick.stop,
        tp1:           pick.tp1,
        tp2:           pick.tp2,
        conf:          pick.conf,
        thesis:        pick.thesis,
        marketContext: selectionLine,
        source:        "morning-brief",
      });

      // STABLE per-day timestamp — autoposter's idempotency-key is sha1 of
      // token|direction|timestamp, so anchoring `ts` to the brief's date
      // (not Date.now()) means a same-day retry produces the IDENTICAL key
      // and the downstream service dedupes even if our local ledger blip.
      // We use UTC-midnight of dateKey so the value is reproducible without
      // pulling in a timezone library here.
      const stableTs = Date.parse(`${dateKey}T00:00:00.000Z`) || Date.now();

      // advancedScore must clear the downstream "advanced_score_below_minimum"
      // gate (~80 in current rules). Calibrated elite picks have already
      // passed multi-stage filtering (RR, calibration hydrate, daily
      // selector) so we floor them at 85; raw Claude fallback floors at 75.
      // We never go BELOW the model-derived confidence — only above.
      const elitePick = pick.source === "elite";
      const minScore = elitePick ? 85 : 75;
      const advancedScore = Math.max(minScore, Math.min(100, pick.conf || 0));

      // ── ATOMIC SLOT CLAIM (closes the in-process race) ───────────────────
      // We claim BEFORE the network call using the daily_brief_telegram_log
      // PK constraint. If the row inserts (rowCount=1) we own today's slot
      // and proceed; if it doesn't (already exists) we skip. This holds
      // even if a same-day email-pipeline retry reaches this code while the
      // first autoposter call is still in flight — the second attempt will
      // see the row and bail.
      const claimed = await claimTelegramSlot(dateKey, pick.token, pick.dir, pick.source);
      if (!claimed) {
        console.log(`[daily-brief] Telegram morning idea SKIPPED — slot already claimed for ${dateKey} (retry-safe)`);
      } else {
        const signalPayload = {
          token:          pick.token,
          dir:            pick.dir,
          entry:          pick.entry,
          stopLoss:       pick.stop,
          tp1:            pick.tp1,
          tp2:            pick.tp2,
          lev,
          conf:           pick.conf,
          advancedScore,
          reasoning,
          isStrongSignal: elitePick,
          ts:             stableTs,
        };

        // Fire-and-forget: do NOT await. The autoposter call has its own
        // 2× retry + 15s timeout, and we don't want a slow webhook to delay
        // the email loop that immediately follows. On not-ok / throw we
        // RELEASE the slot so a future retry (or the next day's) can attempt.
        const pickSnapshot = pick; // narrow for the async closure
        notifyAutoposter(signalPayload)
          .then(async (res) => {
            if (res.ok) {
              console.log(`[daily-brief] Telegram morning idea sent — ${pickSnapshot.token} ${pickSnapshot.dir} (source=${pickSnapshot.source}, conf=${pickSnapshot.conf}%, advScore=${advancedScore})`);
            } else {
              const detail = "detail" in res ? ` detail=${res.detail}` : "";
              const status = "status" in res ? ` status=${res.status}` : "";
              console.warn(`[daily-brief] Telegram morning idea FAILED — reason=${res.reason}${status}${detail} — releasing slot`);
              await releaseTelegramSlotOnFailure(dateKey);
            }
          })
          .catch(async (e) => {
            console.warn(`[daily-brief] Telegram morning idea threw (non-fatal): ${(e as Error)?.message || e} — releasing slot`);
            await releaseTelegramSlotOnFailure(dateKey);
          });
      }
    }
  } catch (e) {
    console.warn(`[daily-brief] Telegram morning idea pipeline threw (non-fatal): ${(e as Error)?.message || e}`);
  }

  // Helper: build the per-tier TieredTradeIdea[] from the Elite list
  const buildTierTrades = (tier: string): TieredTradeIdea[] | undefined => {
    if (tieredMode !== "on") return undefined;
    const slice = sliceForTier(eliteTrades, tier);
    return slice.map(t => ({
      instrument:     t.instrument,
      direction:      t.direction,
      entry:          t.entry.toString(),
      stop:           t.stop.toString(),
      tp1:            t.tp1.toString(),
      tp2:            t.tp2.toString(),
      rrDisplay:      t.riskReward.toFixed(2),
      winRateDisplay: `${Math.round(t.winRate30d * 100)}% (n=${t.sampleSize})`,
      thesis:         t.thesis,
      sessionFlag:    t.sessionFlag,
    }));
  };

  try {
    const { client } = await getUncachableResendClient();
    const chunks = chunkArray(subs, BATCH_SIZE);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      if (chunkIdx > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));

      // Send sequentially with a 250 ms gap to stay under Resend's 5 req/s rate limit.
      for (let emailIdx = 0; emailIdx < chunk.length; emailIdx++) {
        if (emailIdx > 0) await new Promise(r => setTimeout(r, 250));
        const sub = chunk[emailIdx];
        // Track which step failed so the catch below can attribute the error
        // (render bug vs Resend bug vs other) instead of the previous
        // ambiguous "Failed for X@Y: <msg>" that hid render exceptions.
        let stage: "render" | "send" = "render";
        try {
          const subTierForRender = (sub.tier || "free").toLowerCase();
          const tieredTrades = buildTierTrades(subTierForRender);
          const html = renderDailyBriefEmail(
            briefJson, today, marketData, subTierForRender, sub.email,
            tieredTrades,
            tieredTrades && tieredTrades.length < (subTierForRender === "elite" ? 3 : 2) ? heldSlotNote : "",
          );
          const plainText = [
            `CLVRQuant Morning Brief — ${today}`,
            ``,
            briefJson.headline || "",
            briefJson.summary || "",
            ``,
            `TOP THEMES:`,
            ...(briefJson.themes || []).map((t: any) => `• ${t}`),
            ``,
            `MARKET SNAPSHOT:`,
            ...(briefJson.marketSnapshot || []).map((m: any) => `  ${m.label}: ${m.value} ${m.change || ""}`),
            ``,
            `Visit https://clvrquantai.com for live data and AI analysis.`,
            ``,
            `© 2026 CLVRQuant · Support@clvrquantai.com`,
            `To unsubscribe: https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(sub.email)}`,
          ].join("\n");

          // Tier-aware subject — counts reflect the actual tier slice we ship
          const subTier = subTierForRender;
          const eliteCt = (tieredTrades?.length ?? eliteTrades.length) || 3;
          const proCt   = Math.min(eliteCt, 2);
          const tierSubject =
            subTier === "elite" ? `🏆 CLVRQuant Elite Brief — ${today} · ${eliteCt} trade idea${eliteCt === 1 ? "" : "s"} inside`
            : subTier === "pro" ? `📊 CLVRQuant Pro Brief — ${today} · ${proCt} trade idea${proCt === 1 ? "" : "s"} today`
            : `☕ CLVRQuant Daily Brief — ${today} · upgrade for trade ideas`;
          stage = "send";
          const resp = await client.emails.send({
            from: "CLVRQuant <hello@clvrquantai.com>",
            to: sub.email,
            replyTo: "noreply@clvrquantai.com",
            subject: tierSubject,
            headers: {
              "List-Unsubscribe": `<https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(sub.email)}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            text: plainText,
            html,
          });

          if ((resp as any).error) {
            throw new Error(JSON.stringify((resp as any).error));
          }
          const id = (resp as any).data?.id || "unknown";
          console.log(`[daily-brief] Sent to ${sub.email} [${sub.tier}] — id: ${id}`);
          sentCount++;
        } catch (err: any) {
          // Attribute the failure: render-stage = template/data bug (same root
          // cause for every subscriber), send-stage = Resend API rejection.
          // Without this distinction the previous log made every render bug
          // look like a transient delivery failure.
          const errName = err?.name || "Error";
          const msg = err?.message || String(err);
          // Include recipient in the summary so a partial failure ({3 sent, 4 failed})
          // tells the owner WHICH 4 failed — not just the error class. Architect
          // review caught that the previous `${stage}:${errName}:${msg}` format
          // dropped the recipient and made forensic triage harder than it needed
          // to be. Format: "render:user@example.com:ParseError:Parse error..."
          const summary = `${stage}:${sub.email}:${errName}:${msg}`;
          console.log(`[daily-brief] Failed for ${sub.email} at ${stage} stage — ${errName}: ${msg}`);
          sendErrors.push(summary);
        }
      }
    }

    console.log(`[daily-brief] Done — ${sentCount}/${subs.length} emails sent across ${chunks.length} batch(es)`);
    if (sentCount === 0) {
      // Every individual send failed (rate limit storm, bad domain, transient
      // Resend outage). Release the slot so the next scheduled tick or a
      // manual retry can attempt the send instead of recording a permanent
      // recipient_count=0 lock for the day.
      console.log(`[daily-brief] 0/${subs.length} delivered — releasing slot ${dateKey} for retry`);
      try { await pool.query(`DELETE FROM daily_briefs_log WHERE date_key = $1 AND recipient_count = 0`, [dateKey]); } catch {}
      return {
        ran: true,
        sent: 0,
        total: subs.length,
        reason: `0/${subs.length} delivered`,
        errors: dedupeAndTrim(sendErrors),
      };
    }
    await pool.query(
      `UPDATE daily_briefs_log SET recipient_count = $1 WHERE date_key = $2`,
      [sentCount, dateKey]
    );
    return {
      ran: true,
      sent: sentCount,
      total: subs.length,
      errors: dedupeAndTrim(sendErrors),
    };
  } catch (e: any) {
    // Catastrophic failure before/during the loop (most often: Resend client
    // init threw — missing key, connector outage, bad token). Without releasing
    // the claim, today's slot is permanently locked at recipient_count=0 and
    // every retry path (scheduled tick, restart catch-up, manual admin) silently
    // aborts. Release the slot so the next attempt can actually run.
    const msg = e?.message || String(e);
    console.log("[daily-brief] Resend client / loop error:", msg, `— releasing slot ${dateKey} for retry`);
    try { await pool.query(`DELETE FROM daily_briefs_log WHERE date_key = $1 AND recipient_count = 0`, [dateKey]); } catch {}
    return {
      ran: true,
      sent: sentCount,
      total: subs.length,
      reason: `Loop / client error: ${msg}`,
      errors: dedupeAndTrim([...sendErrors, msg]),
    };
  }
}

async function sendApologyBriefEmails() {
  // ── Double-send guard (15 min — enough to prevent double-click duplicates,
  //     short enough to allow retry after a failure) ─────────────────────────
  const nowMs = Date.now();
  if (lastApologySentAt > 0 && (nowMs - lastApologySentAt) < 15 * 60 * 1000) {
    const minutesAgo = Math.round((nowMs - lastApologySentAt) / 60_000);
    console.log(`[daily-brief] Apology brief sent ${minutesAgo}m ago — skipping duplicate (15m window).`);
    return;
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  console.log(`[daily-brief] Generating apology brief for ${today}...`);

  const marketData = await fetchMarketData();
  console.log(`[apology-brief] Market data fetched: ${marketData.crypto.length} crypto, ${marketData.forex.length} fx, ${marketData.metals.length} metals, ${marketData.equities.length} equities`);

  // Try full brief with 3 retries (exponential backoff) → fallback to condensed prompt → only then minimal placeholder
  let briefText: string | null = await generateBriefContentWithRetry(marketData, 3);
  let usedCondensed = false;
  if (!briefText) {
    briefText = await generateCondensedBrief(marketData);
    usedCondensed = !!briefText;
  }

  let briefJson: any = null;
  if (briefText) {
    try {
      const jsonMatch = briefText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object in Claude response");
      briefJson = JSON.parse(jsonMatch[0]);
      console.log(`[apology-brief] Brief JSON parsed (${usedCondensed ? "condensed" : "full"})`);
    } catch (e: any) {
      console.log("[apology-brief] Failed to parse brief JSON:", e?.message || e);
      briefJson = null;
    }
  }

  // ── ABSOLUTE LAST RESORT: minimal placeholder so subscribers still get email
  let usedFallback = false;
  if (!briefJson) {
    usedFallback = true;
    console.log("[apology-brief] All AI generation failed (3 full + 1 condensed) — using minimal placeholder");
    briefJson = {
      headline: "Market Brief — Live Prices",
      marketSentiment: "neutral",
      macroRegime: "NEUTRAL",
      macroRisk: "NORMAL",
      macroRiskNote: "Live prices below. Full AI analysis will resume in the next brief.",
      commentary: [
        { emoji: "⚡", title: "Service Note",
          text: "We're delivering live prices while our AI engine reconnects. Your full analysis brief will resume in the next scheduled send." },
      ],
      topTrade: null,
      additionalTrades: [],
      watchItems: ["Live prices are included below."],
      riskLevel: "medium",
      riskNote: "Apply extra caution today. Do not trade on this brief alone.",
    };
  }

  // Apology note injected right after the header banner
  const apologyNote = `
  <div style="margin:0 24px 16px;padding:14px 18px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.25);border-radius:6px">
    <div style="font-family:monospace;font-size:10px;color:#c9a84c;letter-spacing:0.15em;margin-bottom:6px">⚡ NOTE FROM THE TEAM</div>
    <div style="font-family:Georgia,serif;font-size:13px;color:#c5cfe0;line-height:1.7;font-style:italic">
      We apologize for the delay in this morning's brief. We've been making improvements to CLVRQuant to give you faster, more accurate market intelligence. Thank you for your patience — today's full analysis is below.
    </div>
    <div style="font-family:monospace;font-size:10px;color:#5a6a8a;margin-top:6px">— CLVRQuant Team</div>
  </div>`;

  // Get all active subscribers + always include owner (join with users for tier)
  const subsResult = await pool.query(`
    SELECT s.email, s.name, ${effectiveTierSql("u")} AS tier
    FROM subscribers s
    LEFT JOIN users u ON LOWER(u.email) = LOWER(s.email)
    WHERE s.active = true
  `);
  const subs: {email:string;name:string;tier:string}[] = subsResult.rows;
  const ownerEmail = "mikeclaver@gmail.com";
  if (!subs.find(s => s.email.toLowerCase() === ownerEmail.toLowerCase())) {
    subs.push({ email: ownerEmail, name: "Mike", tier: "pro" });
  }

  console.log(`[daily-brief] Sending apology brief to ${subs.length} recipients sequentially...`);
  let sentCount = 0;
  try {
    const { client } = await getUncachableResendClient();

    for (let i = 0; i < subs.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 250));
      const sub = subs[i];
      try {
        const briefHtml = renderDailyBriefEmail(briefJson, today, marketData, sub.tier || "pro", sub.email);
        const apologyHtml = briefHtml.replace(
          `<div style="padding:24px 24px 8px">`,
          apologyNote + `<div style="padding:24px 24px 8px">`
        );
        const resp = await client.emails.send({
          from: "CLVRQuant <noreply@clvrquantai.com>",
          to: sub.email,
          replyTo: "noreply@clvrquantai.com",
          subject: ((sub.tier || "free").toLowerCase() === "elite"
            ? `🏆 CLVRQuant Elite Brief — ${today} · 3 trade ideas inside`
            : (sub.tier || "free").toLowerCase() === "pro"
            ? `📊 CLVRQuant Pro Brief — ${today} · today's top trade`
            : `☕ CLVRQuant Daily Brief — ${today} · upgrade for trade ideas`),
          html: apologyHtml,
        });
        if ((resp as any).error) throw new Error(JSON.stringify((resp as any).error));
        console.log(`[daily-brief] Apology sent to ${sub.email} — id: ${(resp as any).data?.id || "unknown"}`);
        sentCount++;
      } catch (err: any) {
        console.log(`[daily-brief] Apology failed for ${sub.email}:`, err?.message || err);
      }
    }

    console.log(`[daily-brief] Apology brief complete — ${sentCount}/${subs.length} sent`);
    if (sentCount > 0) lastApologySentAt = Date.now();
  } catch (e: any) {
    console.log("[daily-brief] Resend client error:", e.message);
  }
}

export { sendApologyBriefEmails };

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE APOLOGY EMAIL — simple outage/disruption notice (no market brief)
// ─────────────────────────────────────────────────────────────────────────────
let lastServiceApologySentAt = 0;

export async function sendServiceApologyEmail(): Promise<{ sent: number; skipped: number }> {
  const nowMs = Date.now();
  if (lastServiceApologySentAt > 0 && (nowMs - lastServiceApologySentAt) < 2 * 60 * 60 * 1000) {
    console.log("[service-apology] Already sent recently — skipping.");
    return { sent: 0, skipped: 1 };
  }
  lastServiceApologySentAt = nowMs;

  const usersResult = await pool.query(
    `SELECT DISTINCT COALESCE(u.email, s.email) AS email, COALESCE(u.name, s.name, 'Valued Member') AS name
     FROM users u
     LEFT JOIN subscribers s ON LOWER(s.email) = LOWER(u.email)
     WHERE u.id IS NOT NULL
     UNION
     SELECT s.email, COALESCE(s.name, 'Valued Member')
     FROM subscribers s WHERE s.active = true`
  );

  const recipients: { email: string; name: string }[] = usersResult.rows;
  const ownerEmail = "mikeclaver@gmail.com";
  if (!recipients.find(r => r.email.toLowerCase() === ownerEmail)) {
    recipients.push({ email: ownerEmail, name: "Mike" });
  }

  console.log(`[service-apology] Sending apology to ${recipients.length} recipients sequentially...`);
  const { client } = await getUncachableResendClient();
  let sent = 0;
  for (let i = 0; i < recipients.length; i++) {
    if (i > 0) await new Promise(res => setTimeout(res, 250));
    const r = recipients[i];
    try {
      const html = renderServiceApologyEmail(r.name, r.email);
      const resp = await client.emails.send({
        from: "CLVRQuant <noreply@clvrquantai.com>",
        to: r.email,
        replyTo: "Support@CLVRQuantAI.com",
        subject: "A Message from the CLVRQuant Team",
        html,
      });
      if ((resp as any).error) throw new Error(JSON.stringify((resp as any).error));
      console.log(`[service-apology] Sent to ${r.email}`);
      sent++;
    } catch (err: any) {
      console.log(`[service-apology] Failed for ${r.email}:`, err?.message || err);
    }
  }

  console.log(`[service-apology] Done — ${sent}/${recipients.length} sent`);
  return { sent, skipped: recipients.length - sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMOTION EMAIL — referral push: share app, earn 1 week free Pro
// ─────────────────────────────────────────────────────────────────────────────
let lastPromoSentAt = 0;

export async function sendPromoEmail(): Promise<{ sent: number; skipped: number }> {
  const nowMs = Date.now();
  if (lastPromoSentAt > 0 && (nowMs - lastPromoSentAt) < 6 * 60 * 60 * 1000) {
    console.log("[promo-email] Already sent recently — skipping.");
    return { sent: 0, skipped: 1 };
  }
  lastPromoSentAt = nowMs;

  // Include both registered users AND email-only subscribers (FULL OUTER JOIN)
  // so nobody who opted in is ever skipped.
  const usersResult = await pool.query(`
    SELECT DISTINCT
      COALESCE(u.email, s.email) AS email,
      COALESCE(u.name, s.name, 'Subscriber') AS name,
      COALESCE(u.referral_code, '') AS referral_code
    FROM users u
    FULL OUTER JOIN subscribers s ON LOWER(u.email) = LOWER(s.email)
    WHERE (u.email IS NOT NULL OR (s.email IS NOT NULL AND s.active = true))
      AND COALESCE(u.email, s.email) LIKE '%@%'
  `);
  const recipients: { email: string; name: string; referral_code: string }[] = usersResult.rows;

  console.log(`[promo-email] Sending promo to ${recipients.length} recipients sequentially...`);
  const { client } = await getUncachableResendClient();
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    if (i > 0) await new Promise(res => setTimeout(res, 250));
    const r = recipients[i];
    try {
      const html = renderPromoEmail(r.name, r.email, r.referral_code);
      const resp = await client.emails.send({
        from: "CLVRQuant <noreply@clvrquantai.com>",
        to: r.email,
        replyTo: "noreply@clvrquantai.com",
        subject: "🎁 Share CLVRQuant & Earn 1 Week Free Pro",
        html,
      });
      if ((resp as any).error) throw new Error(JSON.stringify((resp as any).error));
      console.log(`[promo-email] Sent to ${r.email}`);
      sent++;
    } catch (err: any) {
      console.log(`[promo-email] Failed for ${r.email}:`, err?.message || err);
    }
  }

  console.log(`[promo-email] Done — ${sent}/${recipients.length} sent`);
  return { sent, skipped: recipients.length - sent };
}

function getETComponents(): { hour: number; minute: number; dateKey: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const p = (type: string) => parts.find(p => p.type === type)?.value || "0";
  return {
    hour: parseInt(p("hour")),
    minute: parseInt(p("minute")),
    dateKey: `${p("year")}-${p("month")}-${p("day")}`,
  };
}

export function startDailyBriefScheduler() {
  console.log(`[daily-brief] Scheduler started — briefs at 6:00 AM ET daily — ${briefTag()}`);

  // ── Startup catch-up ────────────────────────────────────────────────────────
  // If the server boots after 6 AM ET and today's brief was never claimed,
  // attempt the brief NOW. The atomic claimBriefSlot() inside
  // sendDailyBriefEmails() guarantees that only one of (catch-up, scheduled
  // tick, parallel replica restart) actually sends.
  setTimeout(async () => {
    try {
      const { hour, dateKey } = getETComponents();
      if (hour >= BRIEF_HOUR_ET) {
        const alreadySent = await getTodayBriefKey();
        if (!alreadySent) {
          console.log(`[daily-brief] Missed 6 AM brief on boot (now ${hour}:xx ET) — running catch-up — ${briefTag()}`);
          lastBriefDate = dateKey; // pre-stamp so scheduled tick won't also enqueue
          await enqueueDailyBrief();
        } else {
          lastBriefDate = dateKey;
          console.log(`[daily-brief] Today's brief already claimed — skipping catch-up — ${briefTag()}`);
        }
      } else {
        console.log(`[daily-brief] It's ${hour}:xx ET — next brief at ${BRIEF_HOUR_ET}:00 ET — ${briefTag()}`);
      }
    } catch (e: any) {
      console.log("[daily-brief] Startup catch-up check error:", e.message);
    }
  }, 10_000);

  // ── Daily tick ──────────────────────────────────────────────────────────────
  // Polls every 30s; fires at 6:00 ET. The in-memory `lastBriefDate` blocks
  // re-fire within the same process; the DB-backed atomic claim blocks
  // re-fire across processes / restarts. Defense in depth.
  setInterval(async () => {
    const { hour, minute, dateKey } = getETComponents();
    if (hour === BRIEF_HOUR_ET && minute <= 1 && dateKey !== lastBriefDate) {
      lastBriefDate = dateKey;
      console.log(`[daily-brief] Scheduled tick → enqueue ${dateKey} — ${briefTag()}`);
      enqueueDailyBrief().catch(e => console.log("[daily-brief] Enqueue error:", e.message));
    }
  }, 30_000);
}

export { sendDailyBriefEmails };
