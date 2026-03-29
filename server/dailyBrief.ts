import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";
import { renderDailyBriefEmail, renderServiceApologyEmail, renderPromoEmail } from "./services/emailTemplates";
import { chunkArray } from "./services/ta";
import { enqueueDailyBrief } from "./workers/notifications";

const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 600; // stay under Resend 2 req/s

const BRIEF_HOUR_ET = 6;
const BRIEF_MINUTE_ET = 0;
const APP_URL = "https://clvrquantai.com";

let lastBriefDate = "";
let lastApologySentAt = 0; // Unix ms — prevents double-send within 6 hours

async function getTodayBriefKey(): Promise<string | null> {
  try {
    const now = new Date();
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const dateKey = etTime.toISOString().split("T")[0];
    const res = await pool.query(`SELECT date_key FROM daily_briefs_log WHERE date_key = $1`, [dateKey]);
    return res.rows.length > 0 ? dateKey : null;
  } catch { return null; }
}

async function markBriefSent(dateKey: string, count: number) {
  try {
    await pool.query(
      `INSERT INTO daily_briefs_log (date_key, sent_at, recipient_count)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (date_key) DO NOTHING`,
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

  const prompt = `You are CLVR AI — elite quantitative trading analyst, powered by Claude. Generate a morning market brief for ${today}. ALL data below is REAL, LIVE, and TIMESTAMPED.

═══ CRITICAL RULES — READ BEFORE WRITING ═══
1. Only use prices, percentages, and figures EXPLICITLY provided in the data below. Do NOT invent or round differently.
2. For any macro event with STATUS:PENDING — write ONLY forward-looking language ("market is pricing in X", "watch for Y"). NEVER state outcomes.
3. For any macro event with STATUS:RELEASED — state the ACTUAL value provided. Never infer.
4. Label market sentiment (RISK ON / RISK OFF / MIXED) using provided data only.
5. The "What to Watch" section must use conditional language: "IF [level] breaks THEN [action]". Never unconditional calls.
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
FOREX: ${fxStr || "Data unavailable"}

LAYER 3 — SESSION: ${sessionCtx}

Return a JSON object with EXACTLY these fields:
{
  "headline": "One compelling headline using 5-layer insight — e.g. 'FOMC Risk-Off: BTC Tests $X Support, Gold at $X as DXY Firms'",
  "marketSentiment": "bullish" or "bearish" or "neutral",
  "macroRegime": "RISK ON" or "RISK OFF" or "NEUTRAL",
  "macroRisk": "${macroRiskEvents.length > 0 ? "HIGH" : "NORMAL"}",
  "macroRiskNote": "${macroRiskEvents.length > 0 ? macroRiskEvents[0] : "No critical events within 48h"}",
  "commentary": [
    {
      "emoji": "₿",
      "title": "Bitcoin (BTC/USD)",
      "text": "3-4 sentences: current price, trend (momentum or mean-reversion?), key support/resistance levels, funding rate context, what macro catalyst could break structure. End with a 🟢/🟡/🔴 bias."
    },
    {
      "emoji": "🇪🇺",
      "title": "EUR/USD",
      "text": "3-4 sentences: current rate, DXY impact, ECB vs Fed divergence, key support/resistance. End with 🟢/🟡/🔴 bias."
    },
    {
      "emoji": "🍁",
      "title": "USD/CAD",
      "text": "3-4 sentences: current rate, oil correlation (WTI/Brent price), BOC posture, key levels. End with 🟢/🟡/🔴 bias."
    },
    {
      "emoji": "🇯🇵",
      "title": "USD/JPY",
      "text": "3-4 sentences: current rate, BOJ stance, real yield differential, intervention risk levels. End with 🟢/🟡/🔴 bias."
    },
    {
      "emoji": "🥇",
      "title": "Gold & Silver",
      "text": "3-4 sentences: XAU current price and trend, real yield driver, DXY correlation, silver ratio. End with 🟢/🟡/🔴 bias."
    },
    {
      "emoji": "🛢️",
      "title": "Oil & Gas — Geopolitical Watch",
      "text": "4-5 sentences covering: (1) WTI and Brent crude current prices and today's move direction, (2) key supply/demand drivers — OPEC+ production decisions, US inventory data, or demand outlook, (3) geopolitical risk premium — any active conflicts, sanctions, or shipping disruptions affecting energy flows (Middle East, Russia/Ukraine, Strait of Hormuz, Red Sea), (4) natural gas price if notable, (5) how oil price trajectory affects inflation expectations and central bank posture. End with 🟢/🟡/🔴 bias for energy sector."
    }
  ],
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
    {
      "asset": "2nd best trade idea — different asset class from topTrade",
      "dir": "LONG or SHORT",
      "entry": "price",
      "stop": "price",
      "tp1": "price",
      "tp2": "price",
      "confidence": "X%",
      "edge": "one sentence",
      "riskLabel": "🟢 or 🟡 or 🔴",
      "flags": "any flags"
    },
    {
      "asset": "3rd trade idea — different asset class",
      "dir": "LONG or SHORT",
      "entry": "price",
      "stop": "price",
      "tp1": "price",
      "tp2": "price",
      "confidence": "X%",
      "edge": "one sentence",
      "riskLabel": "🟢 or 🟡 or 🔴",
      "flags": "any flags"
    },
    {
      "asset": "4th trade idea — different asset class",
      "dir": "LONG or SHORT",
      "entry": "price",
      "stop": "price",
      "tp1": "price",
      "tp2": "price",
      "confidence": "X%",
      "edge": "one sentence",
      "riskLabel": "🟢 or 🟡 or 🔴",
      "flags": "any flags"
    }
  ],
  "watchItems": ["5-7 specific things to watch today — include price levels, event names, and what to do if they trigger"],
  "riskLevel": "low" or "medium" or "high",
  "riskNote": "One sentence: biggest risk to positions today and how to manage it"
}

RULES:
- Reference exact prices from the data above
- Apply 5-layer framework: macro regime → structure → session → signal → risk rules
- If FOMC/CPI within 48h: ALL signals get 🔴 label, cap leverage at 2x, say SIZE DOWN
- Minimum R:R 1.5:1 for any trade idea. Skip if R:R is worse.
- All 4 trade ideas must be from different asset classes (crypto, forex, metals, equities)
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: "You are CLVR AI — powered by Claude — an elite quantitative trading analyst applying a 5-layer decision framework (Macro Regime → Market Structure → Session Awareness → Signal Generation → Risk Rules). Generate precise, data-driven morning briefs with exact prices, 🔴/🟡/🟢 risk labels, macro risk flags when FOMC/CPI is within 48h, and one actionable top trade idea per brief. Always reference the actual prices provided. Return valid JSON only.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    return data.content?.[0]?.text || "";
  } catch {
    return null;
  }
}


async function sendDailyBriefEmails() {
  const etTime = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dateKey = etTime.toISOString().split("T")[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  // ── Double-send guard: mark as sent BEFORE generating/sending ──────────────
  // If server restarts mid-send, the DB record already exists so catch-up
  // scheduler won't fire again. (Idempotency via INSERT … ON CONFLICT DO NOTHING)
  const alreadySent = await getTodayBriefKey();
  if (alreadySent) {
    console.log(`[daily-brief] Already sent for ${dateKey}, skipping.`);
    return;
  }
  await markBriefSent(dateKey, 0); // reserve the slot; update count at end
  console.log(`[daily-brief] Reserved brief slot for ${dateKey}, generating...`);

  const marketData = await fetchMarketData();
  console.log(`[daily-brief] Market data: ${marketData.crypto.length} crypto, ${marketData.forex.length} fx, ${marketData.metals.length} metals, ${marketData.equities.length} equities`);

  const briefText = await generateBriefContent(marketData);
  if (!briefText) {
    console.log("[daily-brief] Failed to generate brief content");
    return;
  }

  let briefJson: any;
  try {
    const jsonMatch = briefText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    briefJson = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.log("[daily-brief] Failed to parse brief JSON:", e);
    return;
  }

  // Join subscribers with users table to get tier
  const subsResult = await pool.query(`
    SELECT s.email, s.name, COALESCE(u.tier, 'free') AS tier
    FROM subscribers s
    LEFT JOIN users u ON LOWER(u.email) = LOWER(s.email)
    WHERE s.active = true
  `);
  const subs = subsResult.rows;

  if (subs.length === 0) {
    console.log("[daily-brief] No active subscribers");
    return;
  }

  console.log(`[daily-brief] Sending to ${subs.length} subscribers in parallel batches of 50...`);
  let sentCount = 0;

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
        try {
          const isPro = sub.tier === "pro" || sub.tier === "elite";
          const html = renderDailyBriefEmail(briefJson, today, marketData, isPro, sub.email);
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
            `© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com`,
            `To unsubscribe: https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(sub.email)}`,
          ].join("\n");

          const resp = await client.emails.send({
            from: "CLVRQuant <hello@clvrquantai.com>",
            to: sub.email,
            replyTo: "MikeClaver@CLVRQuantAI.com",
            subject: `CLVRQuant Morning Brief — ${today}`,
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
          console.log(`[daily-brief] Failed for ${sub.email}:`, err?.message || err);
        }
      }
    }

    console.log(`[daily-brief] Done — ${sentCount}/${subs.length} emails sent across ${chunks.length} batch(es)`);
    await pool.query(
      `UPDATE daily_briefs_log SET recipient_count = $1 WHERE date_key = $2`,
      [sentCount, dateKey]
    );
  } catch (e: any) {
    console.log("[daily-brief] Resend client error:", e.message);
  }
}

async function sendApologyBriefEmails() {
  // ── Double-send guard (6-hour window) ─────────────────────────────────────
  const nowMs = Date.now();
  if (lastApologySentAt > 0 && (nowMs - lastApologySentAt) < 6 * 60 * 60 * 1000) {
    const minutesAgo = Math.round((nowMs - lastApologySentAt) / 60_000);
    console.log(`[daily-brief] Apology brief already sent ${minutesAgo}m ago — skipping to prevent duplicate.`);
    return;
  }
  lastApologySentAt = nowMs;

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  console.log(`[daily-brief] Generating apology brief for ${today}...`);

  const marketData = await fetchMarketData();
  const briefText = await generateBriefContent(marketData);
  if (!briefText) { console.log("[daily-brief] Failed to generate brief content"); return; }

  let briefJson: any;
  try {
    const jsonMatch = briefText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    briefJson = JSON.parse(jsonMatch[0]);
  } catch (e) { console.log("[daily-brief] Failed to parse brief JSON:", e); return; }

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
    SELECT s.email, s.name, COALESCE(u.tier, 'free') AS tier
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
        const isPro = sub.tier === "pro" || sub.tier === "elite";
        const briefHtml = renderDailyBriefEmail(briefJson, today, marketData, isPro, sub.email);
        const apologyHtml = briefHtml.replace(
          `<div style="padding:24px 24px 8px">`,
          apologyNote + `<div style="padding:24px 24px 8px">`
        );
        const resp = await client.emails.send({
          from: "CLVRQuant <noreply@clvrquantai.com>",
          to: sub.email,
          replyTo: "MikeClaver@CLVRQuantAI.com",
          subject: `📊 CLVRQuant Morning Brief — ${today}`,
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
        replyTo: "MikeClaver@CLVRQuantAI.com",
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

export function startDailyBriefScheduler() {
  console.log("[daily-brief] Scheduler started — briefs will be sent at 6:00 AM ET daily");

  // On startup: check if today's brief was missed (server was down at 6 AM)
  setTimeout(async () => {
    try {
      const now = new Date();
      const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const hour = etTime.getHours();
      const dateKey = etTime.toISOString().split("T")[0];
      // If it's between 6 AM and 11 AM ET and today's brief wasn't sent, send now
      if (hour >= BRIEF_HOUR_ET && hour < 11) {
        const alreadySent = await getTodayBriefKey();
        if (!alreadySent) {
          console.log("[daily-brief] Missed 6 AM brief detected on startup — sending catch-up brief now");
          lastBriefDate = dateKey;
          await enqueueDailyBrief();
        } else {
          lastBriefDate = dateKey;
          console.log("[daily-brief] Today's brief already sent — skipping catch-up");
        }
      }
    } catch (e: any) {
      console.log("[daily-brief] Startup catch-up check error:", e.message);
    }
  }, 10_000); // Wait 10s after startup for server to warm up

  setInterval(async () => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const dateKey = etTime.toISOString().split("T")[0];

    if (hour === BRIEF_HOUR_ET && minute === BRIEF_MINUTE_ET && dateKey !== lastBriefDate) {
      lastBriefDate = dateKey;
      enqueueDailyBrief().catch(e => console.log("[daily-brief] Enqueue error:", e.message));
    }
  }, 30_000);
}

export { sendDailyBriefEmails };
