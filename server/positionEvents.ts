import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";
import { CLAUDE_MODEL } from "./config";

const TMINUS1_HOUR_ET = 20; // 8:00 PM ET, day before
const TZERO_HOUR_ET = 7;    // 7:00 AM ET, day of
const FINNHUB_KEY = process.env.FINNHUB_KEY || "";
const LOCAL = "http://localhost:5000";
const APP_URL = "https://clvrquantai.com";

type Phase = "t_minus_1" | "t_zero";
const lastRun: Record<string, string> = {}; // phase -> dateKey (in-memory guard)

function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function dateKeyET(d: Date) { return d.toISOString().split("T")[0]; }

async function livePrice(sym: string): Promise<number | null> {
  try {
    const r = await fetch(`${LOCAL}/api/basket-prices?syms=${encodeURIComponent(sym)}`).then(x => x.json());
    const v = r?.[sym];
    const p = v?.price ?? v?.last ?? v;
    return typeof p === "number" ? p : (p ? Number(p) : null);
  } catch { return null; }
}

async function fetchEvents(targetDate: string) {
  const events: Record<string, { type: "earnings" | "ipo"; hour?: string; epsEst?: any; revEst?: any; name?: string }> = {};
  if (!FINNHUB_KEY) return events;
  try {
    const e = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${targetDate}&to=${targetDate}&token=${FINNHUB_KEY}`).then(r => r.json());
    for (const row of (e?.earningsCalendar || [])) {
      if (row?.symbol) events[String(row.symbol).toUpperCase()] = { type: "earnings", hour: row.hour, epsEst: row.epsEstimate, revEst: row.revenueEstimate };
    }
  } catch {}
  try {
    const i = await fetch(`https://finnhub.io/api/v1/calendar/ipo?from=${targetDate}&to=${targetDate}&token=${FINNHUB_KEY}`).then(r => r.json());
    for (const row of (i?.ipoCalendar || [])) {
      if (row?.symbol) events[String(row.symbol).toUpperCase()] = { type: "ipo", name: row.name };
    }
  } catch {}
  return events;
}

async function eliteAnalysis(p: any, ev: any, price: number | null): Promise<any | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const system =
    "You are the CLVRQuant Position Monitor — educational decision-support, NOT a financial advisor. " +
    "ABSOLUTE RULES: Never tell the user to buy, sell, add, trim, hold, take profit, or cut a loss. " +
    "Never say 'you should' or issue any directive. Describe the situation vs the trader's OWN stated " +
    "plan (entry/stop/target) and the catalyst, then a NEUTRAL menu of what traders in this setup " +
    "typically weigh. The trader decides. Return ONLY valid JSON: " +
    '{"planDistance":"string","catalyst":"string","considerations":["string","string","string"],"neuroNudge":"string"}';
  const userMsg =
    `Position: ${p.side} ${p.symbol} (${p.asset_class}), ${p.leverage}x. ` +
    `Plan — entry ${p.entry_price ?? "n/a"}, stop ${p.stop_price ?? "n/a"}, target ${p.target_price ?? "n/a"}, size ${p.size_usd ?? "n/a"} USD. ` +
    `Current price ${price ?? "unknown"}. ` +
    `Catalyst: ${ev.type === "earnings" ? `earnings (${ev.hour || "time TBD"}), EPS est ${ev.epsEst ?? "n/a"}, rev est ${ev.revEst ?? "n/a"}` : `IPO event (${ev.name || p.symbol})`}. ` +
    `Describe plan-distance, give exactly 3 neutral considerations, one cold-state neuroNudge. Do not advise.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!r.ok) return null;
    const d: any = await r.json();
    return JSON.parse((d.content?.[0]?.text || "{}").match(/\{[\s\S]*\}/)?.[0] || "{}");
  } catch { return null; }
}

function buildHtml(p: any, ev: any, price: number | null, phase: Phase, isElite: boolean, a: any | null) {
  const when = phase === "t_minus_1" ? "tomorrow" : "today";
  const evLabel = ev.type === "earnings"
    ? `reports earnings ${when}${ev.hour ? ` (${ev.hour})` : ""}`
    : `has an IPO event ${when}`;
  const facts = ev.type === "earnings"
    ? `<div style="font-family:monospace;font-size:12px;color:#c5cfe0;line-height:2">EPS est: ${ev.epsEst ?? "—"}<br>Revenue est: ${ev.revEst ?? "—"}</div>`
    : `<div style="font-family:monospace;font-size:12px;color:#c5cfe0;line-height:2">${ev.name || p.symbol}</div>`;
  let eliteBlock = "";
  if (isElite && a) {
    eliteBlock = `
      <div style="border-top:1px solid rgba(201,168,76,.2);margin-top:16px;padding-top:16px">
        <div style="font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:.18em;font-weight:700;margin-bottom:10px">AI READ — DECISION SUPPORT</div>
        <div style="font-family:monospace;font-size:12px;color:#c5cfe0;line-height:1.7">${a.planDistance || ""}</div>
        ${a.catalyst ? `<div style="font-family:monospace;font-size:12px;color:#c5cfe0;line-height:1.7;margin-top:8px">${a.catalyst}</div>` : ""}
        ${Array.isArray(a.considerations) ? `<ul style="color:#9fb0c8;font-size:12.5px;line-height:1.7;margin:10px 0 0;padding-left:18px">${a.considerations.map((c: string) => `<li>${c}</li>`).join("")}</ul>` : ""}
        ${a.neuroNudge ? `<div style="font-style:italic;font-size:12.5px;color:#c9a84c;margin-top:10px">${a.neuroNudge}</div>` : ""}
      </div>`;
  }
  return `<div style="background:#0A0A0A;color:#e8e0d0;font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;border:1px solid rgba(201,168,76,.25);border-radius:8px">
    <div style="font-family:Georgia,serif;font-weight:900;font-size:22px;color:#c9a84c;margin-bottom:2px">CLVRQuant</div>
    <div style="font-family:monospace;font-size:9px;color:#7d8aa0;letter-spacing:.18em;text-transform:uppercase;margin-bottom:20px">Position Event Monitor</div>
    <div style="font-size:17px;font-weight:700;margin-bottom:6px">${p.symbol} ${evLabel}</div>
    <div style="font-family:monospace;font-size:11px;color:#7d8aa0;margin-bottom:14px">Your position: ${p.side} ${Number(p.leverage)}x · current ${price != null ? `$${Number(price).toLocaleString()}` : "—"}</div>
    ${facts}
    ${eliteBlock}
    <div style="margin-top:20px"><a href="${APP_URL}" style="background:rgba(201,168,76,.14);border:1px solid #c9a84c;color:#c9a84c;border-radius:4px;padding:9px 20px;text-decoration:none;font-style:italic;font-weight:700;font-size:13px">Open Position Monitor →</a></div>
    <div style="font-family:monospace;font-size:9px;color:#7d8aa0;margin-top:22px;letter-spacing:.06em">Educational support only — not financial advice. DYOR.</div>
    <div style="font-family:monospace;font-size:9px;color:#566;margin-top:8px">© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com</div>
  </div>`;
}

async function runPhase(phase: Phase) {
  const now = etNow();
  const target = new Date(now);
  if (phase === "t_minus_1") target.setDate(target.getDate() + 1);
  const targetDate = dateKeyET(target);

  const posRes = await pool.query(
    `SELECT p.*, u.email, u.name, u.tier
     FROM user_positions p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'open' AND p.asset_class IN ('equity','etf')`
  );
  if (posRes.rows.length === 0) { console.log(`[pos-events][${phase}] no eligible positions`); return; }

  const events = await fetchEvents(targetDate);
  if (Object.keys(events).length === 0) { console.log(`[pos-events][${phase}] no events on ${targetDate}`); return; }

  const { client } = await getUncachableResendClient();
  let sent = 0, idx = 0;
  for (const p of posRes.rows) {
    const ev = events[String(p.symbol).toUpperCase()];
    if (!ev) continue;
    // Idempotency: claim the slot first
    const claim = await pool.query(
      `INSERT INTO position_event_log (user_id, position_id, symbol, event_type, event_date, phase, tier_at_send)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (position_id, event_date, phase) DO NOTHING RETURNING id`,
      [p.user_id, p.id, p.symbol, ev.type, targetDate, phase, p.tier]
    );
    if (claim.rows.length === 0) continue; // already sent
    const isElite = p.tier === "elite" || (p.email || "").toLowerCase() === "mikeclaver@gmail.com";
    if (idx++ > 0) await new Promise(r => setTimeout(r, 600)); // Resend 2 req/s
    try {
      const price = await livePrice(p.symbol);
      const a = isElite ? await eliteAnalysis(p, ev, price) : null;
      const subj = ev.type === "earnings"
        ? (phase === "t_minus_1" ? `⏰ ${p.symbol} reports tomorrow — you hold a position` : `📊 ${p.symbol} reports today`)
        : (phase === "t_minus_1" ? `⏰ ${p.symbol} IPO event tomorrow` : `🚀 ${p.symbol} IPO event today`);
      const resp = await client.emails.send({
        from: "CLVRQuant <hello@clvrquantai.com>",
        to: p.email,
        replyTo: "MikeClaver@CLVRQuantAI.com",
        subject: subj,
        text: `${p.symbol} ${ev.type} ${phase === "t_minus_1" ? "tomorrow" : "today"}. Open the Position Monitor at ${APP_URL}. Educational support only — not financial advice. DYOR.`,
        html: buildHtml(p, ev, price, phase, isElite, a),
      });
      if (!(resp as any).error) { sent++; console.log(`[pos-events][${phase}] sent ${p.symbol} -> ${p.email} [${p.tier}]`); }
    } catch (e: any) { console.log(`[pos-events][${phase}] send fail ${p.email}:`, e.message); }
  }
  console.log(`[pos-events][${phase}] done — ${sent} sent for ${targetDate}`);
}

export function startPositionEventScheduler() {
  console.log("[pos-events] Scheduler started — T-1 8:00 PM ET, T-0 7:00 AM ET");
  const tick = async () => {
    const now = etNow();
    const hour = now.getHours(), minute = now.getMinutes(), key = dateKeyET(now);
    if (hour === TMINUS1_HOUR_ET && minute === 0 && lastRun["t_minus_1"] !== key) {
      lastRun["t_minus_1"] = key;
      runPhase("t_minus_1").catch(e => console.log("[pos-events] t_minus_1 error:", e.message));
    }
    if (hour === TZERO_HOUR_ET && minute === 0 && lastRun["t_zero"] !== key) {
      lastRun["t_zero"] = key;
      runPhase("t_zero").catch(e => console.log("[pos-events] t_zero error:", e.message));
    }
  };
  setInterval(tick, 30_000);
  // Light startup catch-up (server may have been down at the trigger minute)
  setTimeout(async () => {
    const now = etNow(); const hour = now.getHours(); const key = dateKeyET(now);
    if (hour >= TZERO_HOUR_ET && hour < 11 && lastRun["t_zero"] !== key) { lastRun["t_zero"] = key; runPhase("t_zero").catch(() => {}); }
    if (hour >= TMINUS1_HOUR_ET && hour <= 23 && lastRun["t_minus_1"] !== key) { lastRun["t_minus_1"] = key; runPhase("t_minus_1").catch(() => {}); }
  }, 12_000);
}
