// ── Email Template Service — Handlebars-powered ───────────────────────────────
// Compiles and renders the daily brief email using a .hbs template.
// Falls back to a simple inline HTML if the template cannot be loaded.

import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Template cache: compiled once per process ──────────────────────────────────

const _compiled: Record<string, HandlebarsTemplateDelegate> = {};

function getTemplate(name: string): HandlebarsTemplateDelegate {
  if (_compiled[name]) return _compiled[name];
  try {
    // process.cwd() is the project root in both dev (tsx/ESM) and production (CJS build)
    const tplPath = resolve(process.cwd(), "server", "templates", `${name}.hbs`);
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

export interface TieredTradeIdea {
  instrument:     string;
  direction:      string;          // "LONG" | "SHORT"
  entry:          string;
  stop:           string;
  tp1:            string;
  tp2:            string;
  rrDisplay:      string;          // e.g. "2.4"
  winRateDisplay: string;          // e.g. "58% (n=44)"
  thesis?:        string;
  sessionFlag?:   string;
}

export function renderDailyBriefEmail(
  briefJson: any,
  dateStr: string,
  marketData: MarketData,
  tierOrIsPro: string | boolean = false,
  subscriberEmail = "",
  tieredTrades?: TieredTradeIdea[],         // when present → tiered v1 path
  heldSlotNote?: string,                    // e.g. "1 slot held — no setup met threshold"
): string {
  const template = getTemplate("daily_brief");

  const tier = typeof tierOrIsPro === "string" ? tierOrIsPro.toLowerCase() : (tierOrIsPro ? "pro" : "free");
  const isElite    = tier === "elite";
  const isPro      = tier === "pro";          // strict — pro means pro, not pro|elite
  const isFreeTier = !isPro && !isElite;

  const sentimentColor = briefJson.marketSentiment === "bullish" ? "#00c787"
    : briefJson.marketSentiment === "bearish" ? "#ff4060" : "#e8c96d";

  const { color: macroRegimeColor, border: macroRegimeBorderColor, bg: macroRegimeBg } =
    macroRegimeColors(briefJson.macroRegime || "");

  // ── Trade list ─────────────────────────────────────────────────────────────
  // Preferred source: tiered v1 selection. Fallback (when flag is off/shadow):
  // map Claude's legacy topTrade + additionalTrades into the same shape so the
  // new template still renders trade cards for Pro/Elite — preserves legacy
  // brief content while we run the v1 pipeline in shadow mode.
  let tradeIdeas: any[] = [];
  const accent = isElite ? "#00e5ff" : "#c9a84c";
  if (tieredTrades && tieredTrades.length) {
    tradeIdeas = tieredTrades.map((t, i) => ({ ...t, idx: i + 1, accent }));
  } else if (!isFreeTier) {
    // Legacy fallback: rehydrate from Claude's brief JSON
    const cap = isElite ? 3 : 2;
    const legacySource = [briefJson.topTrade, ...((briefJson.additionalTrades) || [])]
      .filter(Boolean)
      .slice(0, cap);
    tradeIdeas = legacySource.map((t: any, i: number) => {
      const entryN = parseFloat(String(t.entry).replace(/[^0-9.\-]/g, "")) || 0;
      const stopN  = parseFloat(String(t.stop).replace(/[^0-9.\-]/g, ""))  || 0;
      const tp2N   = parseFloat(String(t.tp2).replace(/[^0-9.\-]/g, ""))   || 0;
      const risk   = Math.abs(entryN - stopN);
      const reward = Math.abs(tp2N - entryN);
      const rr     = risk > 0 ? (reward / risk).toFixed(2) : "—";
      return {
        idx:            i + 1,
        accent,
        instrument:     t.asset || t.instrument || "—",
        direction:      String(t.dir || t.direction || "").toUpperCase(),
        entry:          String(t.entry ?? "—"),
        stop:           String(t.stop ?? "—"),
        tp1:            String(t.tp1 ?? "—"),
        tp2:            String(t.tp2 ?? "—"),
        rrDisplay:      rr,
        winRateDisplay: t.winRateDisplay || "—",
        thesis:         t.edge || t.thesis || "",
        sessionFlag:    t.sessionFlag,
      };
    });
  }
  const ideaCount = isFreeTier ? 0 : tradeIdeas.length;
  const ideaCountLabel = ideaCount === 1 ? "Idea" : "Ideas";
  const tierLabel = isElite ? "Elite" : isPro ? "Pro" : "Free";

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
    tradeIdeas,
    ideaCount,
    ideaCountLabel,
    heldSlotNote:    heldSlotNote || "",
    isPro,
    isElite,
    isFreeTier,
    tierLabel,
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
