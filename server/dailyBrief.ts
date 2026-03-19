import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";

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
      const metalSyms = [["XAU", "Gold XAU/USD"], ["XAG", "Silver XAG/USD"]];
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
METALS: ${metalStr || "Data unavailable"}
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
      "title": "Gold & Commodities",
      "text": "3-4 sentences: XAU current price, real yield driver, DXY correlation, WTI oil price. End with 🟢/🟡/🔴 bias."
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

function buildTradeBlock(trade: any, label: string): string {
  if (!trade) return "";
  return `<div style="background:rgba(20,30,53,.6);border:1px solid rgba(201,168,76,.2);border-radius:4px;padding:16px 20px;margin-bottom:12px">
    <div style="font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:0.18em;margin-bottom:12px;font-weight:700">⚡ ${label}</div>
    <div style="font-size:15px;font-weight:700;color:#e8e0d0;margin-bottom:8px">${trade.riskLabel || "🟡"} ${trade.asset || ""} ${trade.dir || ""}</div>
    <div style="font-family:monospace;font-size:11px;color:#c5cfe0;line-height:2.0">
      📍 Entry: ${trade.entry || "—"}<br>
      🛑 Stop: ${trade.stop || "—"}<br>
      🎯 TP1: ${trade.tp1 || "—"}<br>
      🎯 TP2: ${trade.tp2 || "—"}<br>
      📊 Confidence: ${trade.confidence || "—"}<br>
      ⚠️ Flags: ${trade.flags || "None"}
    </div>
    ${trade.edge ? `<div style="margin-top:10px;font-size:12px;color:#8a96b2;line-height:1.7;font-style:italic">💡 ${trade.edge}</div>` : ""}
  </div>`;
}

function buildEmailHtml(briefJson: any, dateStr: string, marketData: MarketData, isPro: boolean = false): string {
  const sentimentColor = briefJson.marketSentiment === "bullish" ? "#00c787" : briefJson.marketSentiment === "bearish" ? "#ff4060" : "#e8c96d";
  const macroRiskBadge = briefJson.macroRisk === "HIGH"
    ? `<div style="display:inline-block;margin-left:8px;padding:3px 12px;border-radius:2px;font-family:monospace;font-size:8px;letter-spacing:0.12em;color:#ff4060;border:1px solid rgba(255,64,96,.4);background:rgba(255,64,96,.08)">🔴 MACRO RISK</div>`
    : "";
  const macroRegimeBadge = briefJson.macroRegime
    ? `<div style="display:inline-block;margin-left:8px;padding:3px 12px;border-radius:2px;font-family:monospace;font-size:8px;letter-spacing:0.12em;color:${briefJson.macroRegime==="RISK ON"?"#00c787":briefJson.macroRegime==="RISK OFF"?"#ff4060":"#e8c96d"};border:1px solid ${briefJson.macroRegime==="RISK ON"?"rgba(0,199,135,.4)":briefJson.macroRegime==="RISK OFF"?"rgba(255,64,96,.4)":"rgba(232,201,109,.4)"};background:${briefJson.macroRegime==="RISK ON"?"rgba(0,199,135,.08)":briefJson.macroRegime==="RISK OFF"?"rgba(255,64,96,.08)":"rgba(232,201,109,.08)"}">${briefJson.macroRegime}</div>`
    : "";

  const priceRow = (label: string, price: string, change: string, changeNum: number) => {
    const changeColor = change === "—" ? "#8a96b2" : changeNum >= 0 ? "#00c787" : "#ff4060";
    const arrow = change === "—" ? "" : changeNum >= 0 ? "▲ " : "▼ ";
    return `<tr>
      <td style="padding:12px 16px;border-bottom:1px solid #141e35;font-size:14px;font-weight:600;color:#e8e0d0">${label}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #141e35;font-family:'IBM Plex Mono',monospace;font-size:14px;color:#c5cfe0;text-align:center">${price}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #141e35;font-family:'IBM Plex Mono',monospace;font-size:13px;color:${changeColor};text-align:right;font-weight:600">${arrow}${change.replace("+", "").replace("-", "")}</td>
    </tr>`;
  };

  const topCrypto = marketData.crypto.slice(0, 4);
  const topFx = marketData.forex.slice(0, 4);

  let priceTableRows = "";
  for (const c of topCrypto) priceTableRows += priceRow(c.symbol + " ₿", c.price, c.change, c.changeNum);
  for (const f of topFx) priceTableRows += priceRow(f.pair, f.price, f.change, f.changeNum);
  for (const m of marketData.metals) priceTableRows += priceRow(m.symbol, m.price, m.change, m.changeNum);

  const commentarySections = (briefJson.commentary || []).map((c: any) =>
    `<div style="margin-bottom:24px">
      <div style="font-size:16px;font-weight:700;color:#e8e0d0;margin-bottom:8px">${c.emoji || "✦"} ${c.title}</div>
      <div style="font-size:13px;color:#8a96b2;line-height:1.9">${c.text}</div>
    </div>`
  ).join("");

  const watchItems = (briefJson.watchItems || []).map((w: string) =>
    `<li style="margin-bottom:8px;color:#c5cfe0;font-size:13px;line-height:1.7;padding-left:4px">• ${w}</li>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050709;font-family:'Barlow',Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0c1220">

  <div style="background:linear-gradient(135deg,#0c1220 0%,#141e35 100%);padding:28px 24px;text-align:center;border-bottom:1px solid rgba(201,168,76,.2)">
    <div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#e8c96d;letter-spacing:0.02em">CLVRQuant</div>
    <div style="font-family:monospace;font-size:9px;color:#5a6a8a;letter-spacing:0.25em;margin-top:4px">DAILY INTELLIGENCE BRIEF</div>
    <div style="font-family:monospace;font-size:11px;color:#8a96b2;margin-top:8px">${dateStr}</div>
  </div>

  <div style="padding:24px 24px 8px">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#e8e0d0;line-height:1.4;margin-bottom:12px;font-style:italic">"${briefJson.headline || "Markets in Motion"}"</div>
    <div>
      <div style="display:inline-block;padding:4px 14px;border-radius:2px;font-family:monospace;font-size:9px;letter-spacing:0.15em;color:${sentimentColor};border:1px solid ${sentimentColor};margin-bottom:4px">${(briefJson.marketSentiment || "NEUTRAL").toUpperCase()}</div>${macroRegimeBadge}${macroRiskBadge}
    </div>
    ${briefJson.macroRiskNote && briefJson.macroRisk === "HIGH" ? `<div style="margin-top:10px;padding:8px 14px;background:rgba(255,64,96,.06);border:1px solid rgba(255,64,96,.2);border-radius:3px;font-family:monospace;font-size:10px;color:#ff6080;line-height:1.6">⚠️ ${briefJson.macroRiskNote} — Reduce position sizing. Max 2x leverage.</div>` : ""}
  </div>

  <div style="padding:16px 24px">
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#e8e0d0;margin-bottom:4px">📊 Market Summary</div>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;background:rgba(5,7,9,.4);border:1px solid #141e35;border-radius:4px">
      <thead>
        <tr>
          <th style="padding:10px 16px;text-align:left;font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:0.15em;border-bottom:1px solid #1e2d4a">INSTRUMENT</th>
          <th style="padding:10px 16px;text-align:center;font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:0.15em;border-bottom:1px solid #1e2d4a">PRICE</th>
          <th style="padding:10px 16px;text-align:right;font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:0.15em;border-bottom:1px solid #1e2d4a">CHANGE</th>
        </tr>
      </thead>
      <tbody>${priceTableRows}</tbody>
    </table>
  </div>

  <div style="padding:8px 24px 24px">
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#e8e0d0;margin-bottom:16px">🧠 Market Commentary &amp; Outlook</div>
    <div style="height:2px;background:linear-gradient(90deg,#c9a84c,transparent);margin-bottom:20px"></div>
    ${commentarySections}
  </div>

  ${briefJson.topTrade ? `<div style="padding:0 24px 24px">
    <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#e8e0d0;margin-bottom:12px">${isPro ? "⚡ Today's Trade Ideas — Pro (4 Ideas)" : "⚡ Today's Top Trade Idea"}</div>
    ${buildTradeBlock(briefJson.topTrade, isPro ? "TRADE IDEA #1" : "TODAY'S TOP TRADE IDEA")}
    ${isPro && Array.isArray(briefJson.additionalTrades) ? briefJson.additionalTrades.map((t: any, i: number) => buildTradeBlock(t, `TRADE IDEA #${i + 2}`)).join("") : ""}
    ${!isPro ? `<div style="margin-top:8px;padding:10px 14px;background:rgba(201,168,76,.04);border:1px solid rgba(201,168,76,.15);border-radius:4px;font-family:monospace;font-size:10px;color:#8a96b2;text-align:center">🔒 <strong style="color:#c9a84c">Pro members get 4 trade ideas daily.</strong> Upgrade at <a href="${APP_URL}" style="color:#e8c96d;text-decoration:none">clvrquantai.com</a></div>` : ""}
  </div>` : ""}

  ${briefJson.topTrade ? `<div style="padding:0 24px 16px">
    <div style="padding:12px 16px;background:rgba(255,160,0,.04);border:1px solid rgba(255,160,0,.18);border-radius:4px">
      <div style="font-family:monospace;font-size:8px;color:#c9a84c;letter-spacing:0.18em;margin-bottom:5px;font-weight:700">⚠️ TRADE IDEA DISCLAIMER</div>
      <div style="font-size:11px;color:#6a7a9a;line-height:1.75">These trade ideas are based on market data and conditions available <strong style="color:#8a9ab2">at the time this brief was generated</strong>. Prices, funding rates, and risk factors can change rapidly between generation and when you read this. <strong style="color:#8a9ab2">Always confirm current prices before entering any position.</strong> CLVRQuant AI is not a financial advisor. All content is for research and educational purposes only. <strong style="color:#c5a060">Operate with caution. Never risk more than you can afford to lose.</strong></div>
    </div>
  </div>` : ""}

  ${watchItems ? `<div style="padding:0 24px 24px">
    <div style="background:rgba(201,168,76,.04);border:1px solid rgba(201,168,76,.15);border-radius:4px;padding:16px 20px">
      <div style="font-size:16px;font-weight:700;color:#e8e0d0;margin-bottom:12px">🚀 Key Things to Watch Today</div>
      <ul style="list-style:none;padding:0;margin:0">${watchItems}</ul>
    </div>
  </div>` : ""}

  ${briefJson.riskNote ? `<div style="padding:0 24px 24px">
    <div style="background:rgba(255,64,96,.04);border:1px solid rgba(255,64,96,.15);border-radius:4px;padding:14px 20px">
      <div style="font-family:monospace;font-size:9px;color:#ff4060;letter-spacing:0.15em;margin-bottom:6px;font-weight:700">RISK LEVEL: ${(briefJson.riskLevel || "MEDIUM").toUpperCase()}</div>
      <div style="font-size:12px;color:#8a96b2;line-height:1.7">${briefJson.riskNote}</div>
    </div>
  </div>` : ""}

  <div style="padding:0 24px 24px">
    <a href="${APP_URL}" style="display:block;text-align:center;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:Georgia,serif;font-size:15px;font-weight:700;padding:14px 24px;border-radius:4px;text-decoration:none;font-style:italic;letter-spacing:0.02em">Open CLVRQuant Dashboard →</a>
  </div>

  <div style="padding:0 24px 24px">
    <div style="background:#0a0f1a;border:1px solid #141e35;border-radius:4px;padding:16px 20px">
      <div style="font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:0.2em;margin-bottom:10px;font-weight:700">📱 INSTALL AS APP ON YOUR PHONE / IPAD</div>
      <div style="font-size:12px;color:#8a96b2;line-height:1.9">
        <strong style="color:#c5cfe0">iPhone / iPad (Safari):</strong><br>
        1. Open <a href="${APP_URL}" style="color:#e8c96d;text-decoration:underline">${APP_URL.replace("https://", "")}</a> in Safari<br>
        2. Tap the <strong style="color:#c5cfe0">Share</strong> button (square with arrow)<br>
        3. Scroll down and tap <strong style="color:#c5cfe0">"Add to Home Screen"</strong><br>
        4. Tap <strong style="color:#c5cfe0">"Add"</strong> — CLVRQuant now opens like a native app<br><br>
        <strong style="color:#c5cfe0">Android (Chrome):</strong><br>
        1. Open <a href="${APP_URL}" style="color:#e8c96d;text-decoration:underline">${APP_URL.replace("https://", "")}</a> in Chrome<br>
        2. Tap the <strong style="color:#c5cfe0">three-dot menu</strong> (top right)<br>
        3. Tap <strong style="color:#c5cfe0">"Add to Home screen"</strong> or <strong style="color:#c5cfe0">"Install app"</strong><br>
        4. CLVRQuant will appear as an app icon on your home screen
      </div>
    </div>
  </div>

  <div style="padding:16px 24px;border-top:1px solid #141e35;text-align:center">
    <div style="font-family:Georgia,serif;font-size:14px;color:#e8c96d;margin-bottom:8px">CLVRQuant</div>
    <div style="font-family:monospace;font-size:8px;color:#3a4a6a;letter-spacing:0.12em;line-height:2">
      For any issues or inquiries, please email <a href="mailto:Support@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">Support@CLVRQuantAI.com</a><br>
      NOT FINANCIAL ADVICE · AI-POWERED RESEARCH FOR EDUCATIONAL PURPOSES ONLY<br>
      ALL DATA IS INFORMATIONAL — TRADE AT YOUR OWN RISK
    </div>
  </div>

</div>
</body></html>`;
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

  console.log(`[daily-brief] Sending to ${subs.length} subscribers...`);
  let sentCount = 0;

  try {
    const { client } = await getUncachableResendClient();

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const isPro = sub.tier === "pro";
      // Stay under Resend's 2 req/s rate limit
      if (i > 0) await new Promise(r => setTimeout(r, 600));
      try {
        const html = buildEmailHtml(briefJson, today, marketData, isPro);
        const resp = await client.emails.send({
          from: "CLVRQuant <noreply@clvrquantai.com>",
          to: sub.email,
          reply_to: "MikeClaver@CLVRQuantAI.com",
          subject: `📊 CLVRQuant Morning Brief — ${today}`,
          html,
        });
        if ((resp as any).error) {
          console.log(`[daily-brief] Resend error for ${sub.email}:`, JSON.stringify((resp as any).error));
        } else {
          console.log(`[daily-brief] Sent to ${sub.email} [${sub.tier}] — id: ${(resp as any).data?.id || "unknown"}`);
          sentCount++;
        }
      } catch (e: any) {
        console.log(`[daily-brief] Failed to send to ${sub.email}:`, e.message);
      }
    }
    console.log(`[daily-brief] Done — ${sentCount}/${subs.length} emails sent`);
    // Update the count (the slot was already reserved at the top)
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

  console.log(`[daily-brief] Sending apology brief to ${subs.length} recipients...`);
  try {
    const { client } = await getUncachableResendClient();
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const isPro = sub.tier === "pro";
      // Stay well under Resend's 2 req/s rate limit
      if (i > 0) await new Promise(r => setTimeout(r, 600));
      try {
        const briefHtml = buildEmailHtml(briefJson, today, marketData, isPro);
        const apologyHtml = briefHtml.replace(
          `<div style="padding:24px 24px 8px">`,
          apologyNote + `<div style="padding:24px 24px 8px">`
        );
        const resp = await client.emails.send({
          from: "CLVRQuant <noreply@clvrquantai.com>",
          to: sub.email,
          reply_to: "MikeClaver@CLVRQuantAI.com",
          subject: `📊 CLVRQuant Morning Brief — ${today}`,
          html: apologyHtml,
        });
        if ((resp as any).error) {
          console.log(`[daily-brief] Resend API error for ${sub.email}:`, JSON.stringify((resp as any).error));
        } else {
          console.log(`[daily-brief] Apology brief sent to ${sub.email} [${sub.tier}] — id: ${(resp as any).data?.id || "unknown"}`);
        }
      } catch (e: any) {
        console.log(`[daily-brief] Failed to send apology to ${sub.email}:`, e.message);
      }
    }
    console.log("[daily-brief] Apology brief complete");
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

  console.log(`[service-apology] Sending apology to ${recipients.length} recipients...`);
  const { client } = await getUncachableResendClient();
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (i > 0) await new Promise(res => setTimeout(res, 600));
    try {
      const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Service Update — CLVRQuant</title></head>
<body style="margin:0;padding:0;background:#050709;font-family:Georgia,serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:900;color:#c9a84c;letter-spacing:0.15em">CLVR<span style="color:#e8c96d">QUANT</span></div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:#4a5d80;letter-spacing:0.2em;margin-top:4px">TRADE SMARTER WITH AI</div>
  </div>
  <div style="background:#0c1220;border:1px solid #1c2b4a;border-radius:8px;padding:32px 28px;margin-bottom:20px">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#c9a84c;letter-spacing:0.2em;margin-bottom:16px">⚡ SERVICE UPDATE</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#f0f4ff;margin:0 0 16px;line-height:1.4;font-style:italic">
      An Apology from the CLVRQuant Team
    </h1>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 16px">
      Hi ${r.name},
    </p>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 16px">
      We want to sincerely apologize for any recent disruptions or issues you may have experienced with CLVRQuant. We hold ourselves to a high standard and we know how important reliable market intelligence is to your daily trading.
    </p>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 16px">
      Our team has been working to identify and resolve the issue. We are committed to providing you with the fastest, most accurate market data and AI-powered insights available.
    </p>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 24px">
      Thank you for your patience and for being part of the CLVRQuant community. If you have any questions or continue to experience issues, please reach out to us directly — we're here to help.
    </p>
    <div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:16px 20px;margin-bottom:8px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#c9a84c;letter-spacing:0.15em;margin-bottom:6px">SUPPORT</div>
      <div style="font-size:13px;color:#c8d4ee">Email us at <a href="mailto:Support@CLVRQuantAI.com" style="color:#c9a84c;text-decoration:none">Support@CLVRQuantAI.com</a></div>
    </div>
    <div style="margin-top:24px;font-size:13px;color:#6b7fa8;font-style:italic">
      — Mike Claver, Founder<br>CLVRQuant
    </div>
  </div>
  <div style="text-align:center;font-family:'IBM Plex Mono',monospace;font-size:8px;color:#4a5d80;line-height:1.8">
    CLVRQuant · Market Intelligence for Serious Traders<br>
    © ${new Date().getFullYear()} CLVRQuantAI.com · All rights reserved
  </div>
</div></body></html>`;
      const resp = await client.emails.send({
        from: "CLVRQuant <noreply@clvrquantai.com>",
        to: r.email,
        reply_to: "Support@CLVRQuantAI.com",
        subject: "A Message from the CLVRQuant Team",
        html,
      });
      if (!(resp as any).error) { sent++; console.log(`[service-apology] Sent to ${r.email}`); }
    } catch (e: any) {
      console.log(`[service-apology] Failed for ${r.email}:`, e.message);
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

  const usersResult = await pool.query(
    `SELECT id, email, name, referral_code FROM users WHERE email IS NOT NULL`
  );
  const recipients: { id: number; email: string; name: string; referral_code: string }[] = usersResult.rows;

  console.log(`[promo-email] Sending promo to ${recipients.length} recipients...`);
  const { client } = await getUncachableResendClient();
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (i > 0) await new Promise(res => setTimeout(res, 600));
    const refCode = r.referral_code || "CLVR-REF-XXXXXX";
    const appUrl = "https://clvrquantai.com";
    try {
      const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Share CLVRQuant — Earn Free Pro Access</title></head>
<body style="margin:0;padding:0;background:#050709;font-family:Georgia,serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:900;color:#c9a84c;letter-spacing:0.15em">CLVR<span style="color:#e8c96d">QUANT</span></div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:#4a5d80;letter-spacing:0.2em;margin-top:4px">TRADE SMARTER WITH AI</div>
  </div>
  <div style="background:#0c1220;border:1px solid #1c2b4a;border-radius:8px;padding:32px 28px;margin-bottom:20px">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#c9a84c;letter-spacing:0.2em;margin-bottom:16px">🎁 EXCLUSIVE REFERRAL OFFER</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#f0f4ff;margin:0 0 16px;line-height:1.4;font-style:italic">
      Share CLVRQuant &amp; Earn <span style="color:#c9a84c">1 Week Free Pro</span>
    </h1>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 16px">
      Hi ${r.name || "Trader"},
    </p>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 16px">
      Love CLVRQuant? Know a fellow trader who needs real-time market intelligence, AI-powered signals, and macro data all in one place?
    </p>
    <p style="font-size:14px;color:#c8d4ee;line-height:1.8;margin:0 0 24px">
      <strong style="color:#f0f4ff">Share your referral code below.</strong> When your friend signs up and upgrades to a paid Pro subscription, <strong style="color:#c9a84c">you both get 1 week of CLVRQuant Pro for free</strong>.
    </p>
    <div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.3);border-radius:8px;padding:20px 24px;margin-bottom:24px;text-align:center">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#c9a84c;letter-spacing:0.2em;margin-bottom:10px">YOUR REFERRAL CODE</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:900;color:#e8c96d;letter-spacing:0.15em">${refCode}</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#6b7fa8;margin-top:8px">Share this code with your friends</div>
    </div>
    <div style="background:#060f1e;border:1px solid #141e35;border-radius:6px;padding:16px 20px;margin-bottom:24px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#6b7fa8;letter-spacing:0.15em;margin-bottom:10px">HOW IT WORKS</div>
      <div style="font-size:13px;color:#c8d4ee;line-height:2">
        <span style="color:#c9a84c">01</span> &nbsp;Share your code with a friend<br>
        <span style="color:#c9a84c">02</span> &nbsp;They sign up at <a href="${appUrl}" style="color:#c9a84c;text-decoration:none">CLVRQuantAI.com</a> and enter your code<br>
        <span style="color:#c9a84c">03</span> &nbsp;They upgrade to Pro (monthly or annual)<br>
        <span style="color:#c9a84c">04</span> &nbsp;You both receive <strong style="color:#e8c96d">1 week of Pro access FREE</strong>
      </div>
    </div>
    <div style="text-align:center">
      <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:900;letter-spacing:0.15em;padding:14px 32px;border-radius:6px;text-decoration:none">
        SHARE CLVRQUANT NOW →
      </a>
    </div>
  </div>
  <div style="text-align:center;font-family:'IBM Plex Mono',monospace;font-size:8px;color:#4a5d80;line-height:1.8">
    CLVRQuant · Market Intelligence for Serious Traders<br>
    © ${new Date().getFullYear()} CLVRQuantAI.com · All rights reserved<br>
    Questions? <a href="mailto:Support@CLVRQuantAI.com" style="color:#4a5d80">Support@CLVRQuantAI.com</a>
  </div>
</div></body></html>`;
      const resp = await client.emails.send({
        from: "CLVRQuant <noreply@clvrquantai.com>",
        to: r.email,
        reply_to: "MikeClaver@CLVRQuantAI.com",
        subject: "🎁 Share CLVRQuant & Earn 1 Week Free Pro",
        html,
      });
      if (!(resp as any).error) { sent++; console.log(`[promo-email] Sent to ${r.email}`); }
    } catch (e: any) {
      console.log(`[promo-email] Failed for ${r.email}:`, e.message);
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
          await sendDailyBriefEmails();
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
      sendDailyBriefEmails().catch(e => console.log("[daily-brief] Error:", e.message));
    }
  }, 30_000);
}

export { sendDailyBriefEmails };
