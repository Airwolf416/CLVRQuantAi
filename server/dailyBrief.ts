import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";

const BRIEF_HOUR_ET = 6;
const BRIEF_MINUTE_ET = 0;

let lastBriefDate = "";

async function generateBriefContent(): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  let cryptoData = "", stockData = "", metalData = "", fxData = "";
  try {
    const [cryptoRes, stockRes] = await Promise.allSettled([
      fetch("https://api.binance.com/api/v3/ticker/24hr").then(r => r.json()),
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
      }).then(r => r.json()),
    ]);

    const symbols = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "MATIC", "TRUMP", "HYPE"];
    if (cryptoRes.status === "fulfilled" && Array.isArray(cryptoRes.value)) {
      const tickers = cryptoRes.value;
      cryptoData = symbols.map(s => {
        const t = tickers.find((x: any) => x.symbol === `${s}USDT`);
        return t ? `${s}: $${parseFloat(t.lastPrice).toLocaleString()} (${parseFloat(t.priceChangePercent) >= 0 ? "+" : ""}${parseFloat(t.priceChangePercent).toFixed(2)}%)` : `${s}: n/a`;
      }).join(" | ");
    }

    try {
      const fhRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_KEY || ""}`);
      const equities = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META"];
      const eqPrices = await Promise.allSettled(
        equities.map(s =>
          fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${process.env.FINNHUB_KEY || ""}`)
            .then(r => r.json())
            .then(d => `${s}: $${d.c?.toFixed(2)} (${d.dp >= 0 ? "+" : ""}${d.dp?.toFixed(2)}%)`)
        )
      );
      stockData = eqPrices.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<string>).value).join(" | ");
    } catch {}

    try {
      const goldRes = await fetch("https://www.goldapi.io/api/XAU/USD", {
        headers: { "x-access-token": "goldapi-demo", "Content-Type": "application/json" },
      }).then(r => r.json());
      metalData = `XAU: $${goldRes.price?.toFixed(2) || "n/a"}`;
    } catch {}

    try {
      const fxRes = await fetch("https://open.er-api.com/v6/latest/USD").then(r => r.json());
      if (fxRes.rates) {
        const pairs = ["EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];
        fxData = pairs.map(c => `USD/${c}: ${fxRes.rates[c]?.toFixed(4) || "n/a"}`).join(" | ");
      }
    } catch {}
  } catch {}

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  const prompt = `Generate a concise morning market brief for ${today}. ALL data below is REAL and LIVE from exchanges:
CRYPTO: ${cryptoData || "Data unavailable"}
EQUITIES: ${stockData || "Data unavailable"}
COMMODITIES: ${metalData || "Data unavailable"}
FOREX: ${fxData || "Data unavailable"}

Return a JSON object with these fields:
{"headline":"One-line market summary","marketSentiment":"bullish/bearish/neutral","keyMoves":[{"asset":"BTC","move":"+2.3%","note":"Breaking above key resistance"}],"analysis":"2-3 paragraph market analysis with key themes, levels, and what to watch today","watchItems":["Item to watch 1","Item to watch 2"],"riskLevel":"low/medium/high","riskNote":"Brief risk note"}

IMPORTANT: Return ONLY the JSON object. No markdown, no backticks, just the raw JSON.`;

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
        max_tokens: 1024,
        system: "You are CLVRQuant, an elite quantitative market analyst. Write concise, data-driven morning briefs. Use the REAL price data provided. Be specific about levels, trends, and actionable insights.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const text = data.content?.[0]?.text || "";
    return text;
  } catch {
    return null;
  }
}

function buildEmailHtml(briefJson: any, dateStr: string): string {
  const moves = (briefJson.keyMoves || []).map((m: any) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #141e35;font-family:'IBM Plex Mono',monospace;font-size:13px;color:#e8c96d;font-weight:700">${m.asset}</td><td style="padding:8px 12px;border-bottom:1px solid #141e35;font-family:'IBM Plex Mono',monospace;font-size:13px;color:${m.move?.startsWith('+') || m.move?.startsWith('↑') ? '#00c787' : '#ff4060'}">${m.move}</td><td style="padding:8px 12px;border-bottom:1px solid #141e35;font-size:12px;color:#8a96b2">${m.note || ''}</td></tr>`
  ).join('');

  const watchItems = (briefJson.watchItems || []).map((w: string) =>
    `<li style="margin-bottom:6px;color:#c5cfe0;font-size:13px;line-height:1.7">✦ ${w}</li>`
  ).join('');

  const sentimentColor = briefJson.marketSentiment === 'bullish' ? '#00c787' : briefJson.marketSentiment === 'bearish' ? '#ff4060' : '#e8c96d';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050709;font-family:'Barlow',Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0c1220;border:1px solid #141e35">
  <div style="background:linear-gradient(135deg,#0c1220 0%,#141e35 100%);padding:28px 24px;text-align:center;border-bottom:1px solid rgba(201,168,76,.2)">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:900;color:#e8c96d;letter-spacing:0.02em">CLVRQuant</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5a6a8a;letter-spacing:0.25em;margin-top:4px">DAILY INTELLIGENCE BRIEF</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a96b2;margin-top:8px">${dateStr}</div>
  </div>
  <div style="padding:20px 24px">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:700;color:#e8e0d0;line-height:1.4;margin-bottom:12px;font-style:italic">"${briefJson.headline || 'Markets in Motion'}"</div>
    <div style="display:inline-block;padding:4px 12px;border-radius:2px;font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;color:${sentimentColor};border:1px solid ${sentimentColor};margin-bottom:16px">${(briefJson.marketSentiment || 'NEUTRAL').toUpperCase()}</div>
    ${moves ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:rgba(5,7,9,.5);border:1px solid #141e35"><thead><tr><th style="padding:8px 12px;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5a6a8a;letter-spacing:0.15em;border-bottom:1px solid #141e35">ASSET</th><th style="padding:8px 12px;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5a6a8a;letter-spacing:0.15em;border-bottom:1px solid #141e35">MOVE</th><th style="padding:8px 12px;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5a6a8a;letter-spacing:0.15em;border-bottom:1px solid #141e35">NOTE</th></tr></thead><tbody>${moves}</tbody></table>` : ''}
    <div style="font-size:14px;color:#c5cfe0;line-height:1.9;margin:16px 0;white-space:pre-wrap">${briefJson.analysis || ''}</div>
    ${watchItems ? `<div style="margin:16px 0;padding:14px 16px;background:rgba(201,168,76,.04);border:1px solid rgba(201,168,76,.15);border-radius:2px"><div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#c9a84c;letter-spacing:0.2em;margin-bottom:10px">WATCH TODAY</div><ul style="list-style:none;padding:0;margin:0">${watchItems}</ul></div>` : ''}
    ${briefJson.riskNote ? `<div style="margin:16px 0;padding:12px 16px;background:rgba(255,64,96,.04);border:1px solid rgba(255,64,96,.15);border-radius:2px"><div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:#ff4060;letter-spacing:0.15em;margin-bottom:6px">RISK: ${(briefJson.riskLevel || 'MEDIUM').toUpperCase()}</div><div style="font-size:12px;color:#8a96b2;line-height:1.7">${briefJson.riskNote}</div></div>` : ''}
  </div>
  <div style="padding:16px 24px;border-top:1px solid #141e35;text-align:center">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:#3a4a6a;letter-spacing:0.15em;line-height:1.8">CLVRQuant · MIKE CLAVER · NOT FINANCIAL ADVICE<br>AI-POWERED RESEARCH FOR EDUCATIONAL PURPOSES ONLY</div>
  </div>
</div>
</body></html>`;
}

async function sendDailyBriefEmails() {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  console.log(`[daily-brief] Generating brief for ${today}...`);

  const briefText = await generateBriefContent();
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

  const html = buildEmailHtml(briefJson, today);

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
          subject: `CLVRQuant Daily Brief — ${today}`,
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
