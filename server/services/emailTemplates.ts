// ── Email Template Service — Handlebars-powered ───────────────────────────────
// Compiles and renders the daily brief email using a .hbs template.
// Falls back to a simple inline HTML if the template cannot be loaded.

import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ESM-compatible __dirname (tsx runs files as ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Template cache: compiled once per process ──────────────────────────────────

const _compiled: Record<string, HandlebarsTemplateDelegate> = {};

function getTemplate(name: string): HandlebarsTemplateDelegate {
  if (_compiled[name]) return _compiled[name];
  try {
    const tplPath = join(__dirname, `../templates/${name}.hbs`);
    const source  = readFileSync(tplPath, "utf-8");
    _compiled[name] = Handlebars.compile(source);
    return _compiled[name];
  } catch (err: any) {
    console.error(`[emailTemplates] Failed to load ${name}.hbs:`, err.message);
    throw err;
  }
}

// ── MarketData types (mirrors dailyBrief.ts) ──────────────────────────────────

interface MarketRow { symbol?: string; pair?: string; price: string; change: string; changeNum: number }
interface MarketData {
  crypto:   MarketRow[];
  forex:    MarketRow[];
  metals:   MarketRow[];
  equities: MarketRow[];
}

// ── Build price rows for the market summary table ─────────────────────────────

function buildPriceRows(marketData: MarketData) {
  const rows: Array<{ label: string; price: string; changeColor: string; arrow: string; changeDisplay: string }> = [];

  const push = (label: string, price: string, change: string, changeNum: number) => {
    const changeColor = change === "—" ? "#8a96b2" : changeNum >= 0 ? "#00c787" : "#ff4060";
    const arrow       = change === "—" ? "" : changeNum >= 0 ? "▲ " : "▼ ";
    const changeDisplay = change === "—" ? "—" : change.replace("+", "").replace("-", "");
    rows.push({ label, price, changeColor, arrow, changeDisplay });
  };

  for (const c of marketData.crypto.slice(0, 4)) push(`${c.symbol} ₿`, c.price, c.change, c.changeNum);
  for (const f of marketData.forex.slice(0, 4))   push(f.pair || "", f.price, f.change, f.changeNum);
  for (const m of marketData.metals)               push(m.symbol || "", m.price, m.change, m.changeNum);

  return rows;
}

// ── Macro regime colour helpers ───────────────────────────────────────────────

function macroRegimeColors(regime: string) {
  if (regime === "RISK ON")  return { color: "#00c787", border: "rgba(0,199,135,.4)", bg: "rgba(0,199,135,.08)" };
  if (regime === "RISK OFF") return { color: "#ff4060", border: "rgba(255,64,96,.4)", bg: "rgba(255,64,96,.08)" };
  return { color: "#e8c96d", border: "rgba(232,201,109,.4)", bg: "rgba(232,201,109,.08)" };
}

// ── Render daily brief email ──────────────────────────────────────────────────

export function renderDailyBriefEmail(
  briefJson: any,
  dateStr: string,
  marketData: MarketData,
  isPro = false,
  subscriberEmail = ""
): string {
  const template = getTemplate("daily_brief");

  const sentimentColor = briefJson.marketSentiment === "bullish" ? "#00c787"
    : briefJson.marketSentiment === "bearish" ? "#ff4060" : "#e8c96d";

  const { color: macroRegimeColor, border: macroRegimeBorderColor, bg: macroRegimeBg } =
    macroRegimeColors(briefJson.macroRegime || "");

  const additionalTrades = (briefJson.additionalTrades || []).map((t: any, i: number) => ({
    ...t,
    tradeNum: i + 2,
    flags: t.flags || "None",
    riskLabel: t.riskLabel || "🟡",
  }));

  const data = {
    dateStr,
    headline:    briefJson.headline || "Markets in Motion",
    sentimentColor,
    sentimentLabel: (briefJson.marketSentiment || "NEUTRAL").toUpperCase(),
    macroRegime:    briefJson.macroRegime || "",
    macroRegimeColor,
    macroRegimeBorderColor,
    macroRegimeBg,
    isHighMacroRisk: briefJson.macroRisk === "HIGH",
    macroRiskNote:   briefJson.macroRiskNote || "",
    priceRows:       buildPriceRows(marketData),
    commentary:      briefJson.commentary || [],
    topTrade:        briefJson.topTrade ? { ...briefJson.topTrade, flags: briefJson.topTrade.flags || "None" } : null,
    additionalTrades,
    isPro,
    watchItems:     briefJson.watchItems || [],
    riskNote:       briefJson.riskNote || "",
    riskLevelUpper: (briefJson.riskLevel || "MEDIUM").toUpperCase(),
    subscriberEmail,
    encodedEmail:   encodeURIComponent(subscriberEmail),
  };

  return template(data);
}

// ── Render service-apology email ──────────────────────────────────────────────

export function renderServiceApologyEmail(
  recipientName: string,
  recipientEmail: string
): string {
  const template = getTemplate("service-apology");
  return template({
    name:         recipientName,
    year:         new Date().getFullYear(),
    encodedEmail: encodeURIComponent(recipientEmail),
  });
}

// ── Render promo / referral email ─────────────────────────────────────────────

export function renderPromoEmail(
  recipientName: string,
  recipientEmail: string,
  referralCode: string
): string {
  const template = getTemplate("promo-email");
  return template({
    name:         recipientName || "Trader",
    refCode:      referralCode || "CLVR-REF-XXXXXX",
    appUrl:       "https://clvrquantai.com",
    year:         new Date().getFullYear(),
    encodedEmail: encodeURIComponent(recipientEmail),
  });
}
