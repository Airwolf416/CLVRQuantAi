import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";

const BRIEF_HOUR_ET = 6;
const BRIEF_MINUTE_ET = 0;
const APP_URL = "https://clvrquant.replit.app";

let lastBriefDate = "";

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
  try {
    const macroRes = await fetch("http://localhost:5000/api/macro").then(r => r.json());
    if (Array.isArray(macroRes) && macroRes.length > 0) {
      macroStr = macroRes.filter((e: any) => e.impact === "HIGH").slice(0, 8).map((e: any) => `${e.date} ${e.time||""} ${e.bank}: ${e.name} prev:${e.current} fcast:${e.forecast}`).join(" | ");
    }
  } catch {}

  const prompt = `Generate a morning market brief for ${today}. ALL data below is REAL and LIVE:
CRYPTO: ${cryptoStr || "Data unavailable"}
EQUITIES: ${eqStr || "Data unavailable"}
METALS: ${metalStr || "Data unavailable"}
FOREX: ${fxStr || "Data unavailable"}
${macroStr ? `UPCOMING MACRO EVENTS: ${macroStr}` : ""}

Return a JSON object with EXACTLY these fields:
{
  "headline": "One compelling headline summarizing today's market",
  "marketSentiment": "bullish" or "bearish" or "neutral",
  "commentary": [
    {
      "emoji": "₿",
      "title": "Bitcoin (BTC/USD)",
      "text": "2-4 sentences of analysis with specific price levels, support/resistance, and what to watch. Mention key technical levels."
    },
    {
      "emoji": "🇪🇺",
      "title": "EUR/USD",
      "text": "2-4 sentences about EUR/USD with specific levels and drivers."
    },
    {
      "emoji": "🍁",
      "title": "USD/CAD",
      "text": "2-4 sentences about USD/CAD with oil correlation and levels."
    },
    {
      "emoji": "🇯🇵",
      "title": "USD/JPY",
      "text": "2-4 sentences about USD/JPY with BOJ risk and intervention levels."
    },
    {
      "emoji": "🥇",
      "title": "Gold & Silver (XAU/XAG)",
      "text": "2-4 sentences about precious metals with real yield drivers and levels."
    }
  ],
  "watchItems": ["5-7 specific things to watch today with context"],
  "riskLevel": "low" or "medium" or "high",
  "riskNote": "Brief risk summary"
}

RULES:
- Use the REAL price data provided — reference actual current prices and percentage moves
- Be specific about support/resistance levels, not vague
- Mention catalysts: Fed speakers, data releases, BOJ policy, oil prices, DXY
- Each commentary should be unique and insightful, not generic
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
        max_tokens: 2048,
        system: "You are CLVRQuant, an elite quantitative market analyst at a top hedge fund. Write concise, data-driven morning briefs with specific price levels and actionable intelligence. Use the REAL data provided. Sound authoritative but clear.",
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

function buildEmailHtml(briefJson: any, dateStr: string, marketData: MarketData): string {
  const sentimentColor = briefJson.marketSentiment === "bullish" ? "#00c787" : briefJson.marketSentiment === "bearish" ? "#ff4060" : "#e8c96d";

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
    <div style="display:inline-block;padding:4px 14px;border-radius:2px;font-family:monospace;font-size:9px;letter-spacing:0.15em;color:${sentimentColor};border:1px solid ${sentimentColor};margin-bottom:4px">${(briefJson.marketSentiment || "NEUTRAL").toUpperCase()}</div>
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
      MIKE CLAVER · NOT FINANCIAL ADVICE<br>
      AI-POWERED RESEARCH FOR EDUCATIONAL PURPOSES ONLY<br>
      ALL DATA IS INFORMATIONAL — TRADE AT YOUR OWN RISK
    </div>
  </div>

</div>
</body></html>`;
}

async function sendDailyBriefEmails() {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  console.log(`[daily-brief] Generating brief for ${today}...`);

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

  const html = buildEmailHtml(briefJson, today, marketData);

  const subsResult = await pool.query("SELECT email, name FROM subscribers WHERE active = true");
  const subs = subsResult.rows;

  if (subs.length === 0) {
    console.log("[daily-brief] No active subscribers");
    return;
  }

  console.log(`[daily-brief] Sending to ${subs.length} subscribers...`);

  try {
    const { client, fromEmail } = await getUncachableResendClient();

    for (const sub of subs) {
      try {
        const senderAddress = fromEmail && !fromEmail.endsWith("@gmail.com") ? fromEmail : "CLVRQuant <onboarding@resend.dev>";
        await client.emails.send({
          from: senderAddress,
          to: sub.email,
          subject: `📊 CLVRQuant Morning Brief — ${today}`,
          html,
        });
        console.log(`[daily-brief] Sent to ${sub.email}`);
      } catch (e: any) {
        console.log(`[daily-brief] Failed to send to ${sub.email}:`, e.message);
      }
    }
    console.log("[daily-brief] All emails sent");
  } catch (e: any) {
    console.log("[daily-brief] Resend client error:", e.message);
  }
}

export function startDailyBriefScheduler() {
  console.log("[daily-brief] Scheduler started — briefs will be sent at 6:00 AM ET daily");

  setInterval(() => {
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
