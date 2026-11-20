// ── Email Template Service — Handlebars-powered ───────────────────────────────
// Compiles and renders the daily brief email using a .hbs template.
// Falls back to a simple inline HTML if the template cannot be loaded.

import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MIN_BRIEF_TP1_RR, presentBriefTrade } from "../lib/briefTradeNumbers";

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

interface MarketRow { symbol?: string; pair?: string; price: string; priceValue?: number; change: string; changeNum: number | null }
interface MarketData {
  crypto:   MarketRow[];
  forex:    MarketRow[];
  metals:   MarketRow[];
  equities: MarketRow[];
  capturedAt?: string;
  changeWindow?: string;
}

// ── Build price rows for the market summary table ─────────────────────────────

function buildPriceRows(marketData: MarketData) {
  const rows: Array<{ label: string; price: string; changeColor: string; arrow: string; changeDisplay: string }> = [];

  const push = (label: string, price: string, change: string, changeNum: number | null) => {
    const changeColor = change === "—" ? "#8a96b2" : Number(changeNum) >= 0 ? "#00c787" : "#ff4060";
    const arrow       = change === "—" ? "" : Number(changeNum) >= 0 ? "▲ " : "▼ ";
    const changeDisplay = change === "—" ? "—" : change.replace("+", "").replace("-", "");
    rows.push({ label, price, changeColor, arrow, changeDisplay });
  };

  for (const c of marketData.crypto.slice(0, 4)) push(`${c.symbol} ₿`, c.price, c.change, c.changeNum);
  for (const f of marketData.forex.slice(0, 4))   push(f.pair || "", f.price, f.change, f.changeNum);
  for (const m of marketData.metals)               push(m.symbol || "", m.price, m.change, m.changeNum);
  for (const e of marketData.equities)             push(e.symbol || "", e.price, e.change, e.changeNum);

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
  rrDisplay?:     string;          // legacy callers ignored; ratios are recomputed
  thesis?:        string;
  sessionFlag?:   string;
  entryMode?:     string;
}

export interface DailyBriefEmailMeta {
  timeZone: string;
  sentAt: string;
}

function formatEmailClock(value: string | undefined, timeZone: string): string {
  if (!value) return "time unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return "time unavailable";
  }
}

export function renderDailyBriefEmail(
  briefJson: any,
  dateStr: string,
  marketData: MarketData,
  tierOrIsPro: string | boolean = false,
  subscriberEmail = "",
  tieredTrades?: TieredTradeIdea[],         // when present → tiered v1 path
  heldSlotNote?: string,                    // e.g. "1 slot held — no setup met threshold"
  marketSessionNote?: string,
  emailMeta?: DailyBriefEmailMeta,
): string {
  const template = getTemplate("daily_brief");

  const tier = typeof tierOrIsPro === "string" ? tierOrIsPro.toLowerCase() : (tierOrIsPro ? "pro" : "free");
  const isElite    = tier === "elite";
  const isPro      = tier === "pro";          // strict — pro means pro, not pro|elite
  const isFreeTier = !isPro && !isElite;

  // ── Schema reconciliation ───────────────────────────────────────────────────
  // The brief generator now returns the SAME rich schema as the on-demand brief
  // on the Brief tab (per-asset prose: btc/eth/sol/xau/xag/oil/equities/eurusd/
  // usdjpy/usdcad, plus impactfulNews / watchToday / keyRisk). Older briefs may
  // still arrive with the legacy schema (commentary[], watchItems, riskNote).
  // Map both to the variables the template expects so subscribers see exactly
  // what the on-demand brief shows.
  const bias = briefJson.bias || briefJson.macroRegime || "NEUTRAL";
  const sentimentRaw = (briefJson.marketSentiment || (
    bias === "RISK ON" ? "bullish" : bias === "RISK OFF" ? "bearish" : "neutral"
  )).toLowerCase();
  const sentimentColor = sentimentRaw === "bullish" ? "#00c787"
    : sentimentRaw === "bearish" ? "#ff4060" : "#e8c96d";
  const sentimentLabel = sentimentRaw.toUpperCase();

  const macroRegimeStr = briefJson.macroRegime || briefJson.bias || "";
  const { color: macroRegimeColor, border: macroRegimeBorderColor, bg: macroRegimeBg } =
    macroRegimeColors(macroRegimeStr);

  // Build commentary[] from the rich per-asset fields if present, else use the
  // legacy commentary[] verbatim. The order/labels match the on-demand brief
  // section in App.jsx so the email reads the same as the in-app experience.
  const richAssetSpecs: Array<{ key: string; emoji: string; title: string }> = [
    { key: "btc",      emoji: "₿",   title: "Bitcoin (BTC/USD)" },
    { key: "eth",      emoji: "Ξ",   title: "Ethereum (ETH/USD)" },
    { key: "sol",      emoji: "◎",   title: "Solana (SOL/USD)" },
    { key: "equities", emoji: "📈", title: "US Equities (SPX · NDX)" },
    { key: "xau",      emoji: "🥇", title: "Gold (XAU/USD)" },
    { key: "xag",      emoji: "🥈", title: "Silver (XAG/USD)" },
    { key: "oil",      emoji: "🛢️", title: "Oil & Energy (WTI · Brent · NatGas)" },
    { key: "eurusd",   emoji: "€",   title: "EUR/USD" },
    { key: "usdjpy",   emoji: "¥",   title: "USD/JPY" },
    { key: "usdcad",   emoji: "$",   title: "USD/CAD" },
  ];
  const richCommentary = richAssetSpecs
    .filter(s => typeof briefJson[s.key] === "string" && briefJson[s.key].trim().length > 0)
    .map(s => ({ emoji: s.emoji, title: s.title, text: briefJson[s.key] }));
  const commentary = richCommentary.length > 0
    ? richCommentary
    : (Array.isArray(briefJson.commentary) ? briefJson.commentary : []);

  // watchToday (rich) → watchItems (template). keyRisk (rich) → riskNote.
  const watchItems = Array.isArray(briefJson.watchToday) && briefJson.watchToday.length > 0
    ? briefJson.watchToday
    : (Array.isArray(briefJson.watchItems) ? briefJson.watchItems : []);
  const riskNote = (briefJson.keyRisk && String(briefJson.keyRisk).trim())
    || (briefJson.riskNote && String(briefJson.riskNote).trim())
    || "";

  // riskLevel: prefer Claude's value, otherwise derive from macroRisk.
  const riskLevelRaw = (briefJson.riskLevel
    || (briefJson.macroRisk === "HIGH" ? "high" : "medium")).toLowerCase();

  // Impactful News — pass through to template (only present in rich schema).
  const impactfulNews = Array.isArray(briefJson.impactfulNews)
    ? briefJson.impactfulNews.slice(0, 5).map((n: any) => {
        const impact = String(n.impact || "NEUTRAL").toUpperCase();
        const impactColor = impact === "BULLISH" ? "#00c787" : impact === "BEARISH" ? "#ff4060" : "#e8c96d";
        return {
          title: n.title || "—",
          impact,
          impactColor,
          assets: n.assets || "",
          takeaway: n.takeaway || "",
        };
      })
    : [];

  // ── Trade list ─────────────────────────────────────────────────────────────
  // Preferred source: tiered v1 selection. Fallback (when flag is off/shadow):
  // map Claude's legacy topTrade + additionalTrades into the same shape so the
  // new template still renders trade cards for Pro/Elite — preserves legacy
  // brief content while we run the v1 pipeline in shadow mode.
  // Tier caps: Pro = 1 idea (topTrade only), Elite = 3 ideas (top + 2 additional).
  let tradeIdeas: any[] = [];
  const accent = isElite ? "#00e5ff" : "#c9a84c";
  const safeIdea = (t: any) => {
    const result = presentBriefTrade(t);
    if (!result.ok) {
      console.warn(`[daily-brief] Excluded trade at render: ${result.reasons.join("; ")}`);
      return [];
    }
    if (result.trade.rrTp1 < MIN_BRIEF_TP1_RR) {
      console.warn(`[daily-brief] Excluded trade at render: R:R to TP1 ${result.trade.rrTp1.toFixed(2)}:1 below ${MIN_BRIEF_TP1_RR.toFixed(2)}:1`);
      return [];
    }
    return [result.trade];
  };
  if (tieredTrades !== undefined && !isFreeTier) {
    // An explicitly empty selection must not resurrect rejected legacy trades.
    tradeIdeas = tieredTrades.flatMap(safeIdea);
  } else if (!isFreeTier) {
    // Legacy fallback: rehydrate from Claude's brief JSON
    const cap = isElite ? 3 : 1;
    const legacySource = [briefJson.topTrade, ...((briefJson.additionalTrades) || [])]
      .filter(Boolean)
      .slice(0, cap);
    tradeIdeas = legacySource.flatMap(safeIdea);
  }
  tradeIdeas = tradeIdeas.map((t, i) => ({ ...t, idx: i + 1, accent }));
  const ideaCount = isFreeTier ? 0 : tradeIdeas.length;
  const ideaCountLabel = ideaCount === 1 ? "Idea" : "Ideas";
  const tierLabel = isElite ? "Elite" : isPro ? "Pro" : "Free";
  const timeZone = emailMeta?.timeZone || "America/Toronto";
  const snapshotTime = formatEmailClock(marketData.capturedAt, timeZone);
  const sentTime = formatEmailClock(emailMeta?.sentAt, timeZone);
  const snapshotMeta = marketData.capturedAt
    ? `Shared snapshot captured ${snapshotTime} · change ${marketData.changeWindow || "reference window unavailable"}`
    : "";

  const data = {
    dateStr,
    headline:    briefJson.headline || "Markets in Motion",
    marketSessionNote: marketSessionNote || "",
    snapshotMeta,
    sentTime,
    sentimentColor,
    sentimentLabel,
    macroRegime:    macroRegimeStr,
    macroRegimeColor,
    macroRegimeBorderColor,
    macroRegimeBg,
    isHighMacroRisk: briefJson.macroRisk === "HIGH",
    macroRiskNote:   briefJson.macroRiskNote || "",
    priceRows:       buildPriceRows(marketData),
    commentary,
    impactfulNews,
    hasImpactfulNews: impactfulNews.length > 0,
    tradeIdeas,
    ideaCount,
    ideaCountLabel,
    heldSlotNote:    heldSlotNote || "",
    isPro,
    isElite,
    isFreeTier,
    tierLabel,
    watchItems,
    riskNote,
    riskLevelUpper: riskLevelRaw.toUpperCase(),
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
