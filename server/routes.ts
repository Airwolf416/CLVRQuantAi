import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { pool } from "./db";
import bcrypt from "bcryptjs";
import { getUncachableResendClient } from "./resendClient";
import WebSocket from "ws";
import webpush from "web-push";
import { fetchInsiderData, startInsiderRefresh, getInsiderScanStatus } from "./insider";

// ── VAPID Web Push (locked-screen notifications) ─────────────────────────────
const VAPID_PUBLIC_KEY  = "BGY47DEls18XHZ7xJiYDf7yNNvF9UhfjA16bkErYfhrJAVxF-P5mhrEz1rI5qp0JT2gdPc80f7swZBVgRMw3PMs";
const VAPID_PRIVATE_KEY = "JYSHjiS26v9DWkwQ-kc-fdoBjn2sBlaTyJOo8JPttoI";
webpush.setVapidDetails("mailto:noreply@clvrquantai.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Helper: send a web push to all subscriptions of a user
const PUSH_ORIGIN = process.env.APP_URL
  || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "https://clvrquantai.com");

async function sendWebPushToUser(userId: string, title: string, body: string, tag = "clvrquant") {
  try {
    const subs = await pool.query("SELECT id, subscription FROM push_subscriptions WHERE user_id = $1", [userId]);
    for (const row of subs.rows) {
      try {
        const payload = JSON.stringify({
          title,
          body,
          tag,
          // Absolute icon URL — required for OS lock-screen rendering (relative paths fail)
          icon: `${PUSH_ORIGIN}/icons/icon-512.png`,
          badge: `${PUSH_ORIGIN}/icons/icon-192.png`,
          url: "/",
          timestamp: Date.now(),
        });
        await webpush.sendNotification(row.subscription, payload, {
          // urgency:"high" maps to APNs priority 10 → immediate lock-screen delivery on iOS
          urgency: "high",
          // TTL: 24 h — if device is offline the notification is retried for 24 hours
          TTL: 86400,
          // topic: collapse key so duplicate alerts replace each other
          topic: tag.replace(/[^a-zA-Z0-9\-_.~%]/g, "-").slice(0, 32),
        });
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — remove it
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
        }
      }
    }
  } catch {}
}

const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP","BNB","ADA","DOT","MATIC","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const CRYPTO_BASE: Record<string, number> = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,MATIC:0.55,UNI:9.5,AAVE:220,NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18,TRUMP:3.5,HYPE:31};
const BINANCE_MAP: Record<string, string> = {BTC:"BTCUSDT",ETH:"ETHUSDT",SOL:"SOLUSDT",WIF:"WIFUSDT",DOGE:"DOGEUSDT",AVAX:"AVAXUSDT",LINK:"LINKUSDT",ARB:"ARBUSDT",PEPE:"PEPEUSDT",XRP:"XRPUSDT",BNB:"BNBUSDT",ADA:"ADAUSDT",DOT:"DOTUSDT",UNI:"UNIUSDT",AAVE:"AAVEUSDT",NEAR:"NEARUSDT",SUI:"SUIUSDT",APT:"APTUSDT",OP:"OPUSDT",TIA:"TIAUSDT",SEI:"SEIUSDT",JUP:"JUPUSDT",ONDO:"ONDOUSDT",RENDER:"RENDERUSDT",FET:"FETUSDT",HBAR:"HBARUSDT",TRUMP:"TRUMPUSDT",HYPE:"HYPEUSDT"};
const BINANCE_SYMS = Object.values(BINANCE_MAP);

const HL_PERP_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","kPEPE","XRP","BNB","ADA","DOT","MATIC","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const HL_TO_APP: Record<string, string> = {kPEPE:"PEPE"};
const APP_TO_HL: Record<string, string> = {PEPE:"kPEPE"};

// Must match the frontend MarketTab EQUITY_SYMS exactly so all rows get prices
const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","NFLX","HOOD","ORCL","TSM","GME","RIVN","BABA","HIMS","CRCL"];
const EQUITY_BASE: Record<string, number> = {
  TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310,AMD:145,PLTR:70,COIN:210,NFLX:850,
  HOOD:41,ORCL:148,TSM:180,GME:27,RIVN:13,BABA:131,HIMS:26,CRCL:25,
  // basket-only extras kept for fallback
  SQ:66,SHOP:95,CRM:290,DIS:105,JPM:240,V:328,XOM:113,WMT:90,BAC:44,
};
const EQUITY_FH_MAP: Record<string, string> = {}; // no special ticker remapping needed

const METALS_BASE: Record<string, number> = {XAU:5160,XAG:84,WTI:91,BRENT:93,NATGAS:4,COPPER:5.8,PLATINUM:2150};

// ── Basket Prices: Yahoo Finance ticker map for ALL 140+ basket assets ───────
const BASKET_YAHOO_MAP: Record<string, string> = {
  // Crypto
  BTC:"BTC-USD",ETH:"ETH-USD",SOL:"SOL-USD",XRP:"XRP-USD",DOGE:"DOGE-USD",
  AVAX:"AVAX-USD",LINK:"LINK-USD",BNB:"BNB-USD",ADA:"ADA-USD",SUI:"SUI-USD",
  DOT:"DOT-USD",HYPE:"HYPE11-USD",
  // US Equities (N.America)
  AAPL:"AAPL",NVDA:"NVDA",MSFT:"MSFT",GOOGL:"GOOGL",AMZN:"AMZN",
  META:"META",TSLA:"TSLA",MSTR:"MSTR",AMD:"AMD",PLTR:"PLTR",
  COIN:"COIN",NFLX:"NFLX",JPM:"JPM",V:"V",XOM:"XOM",
  WMT:"WMT",BAC:"BAC",UNH:"UNH",DIS:"DIS",CRM:"CRM",
  // Canada TSX
  RY:"RY.TO",TD:"TD.TO",CNQ:"CNQ.TO",SU:"SU.TO",BCE:"BCE.TO",
  // Europe
  ASML:"ASML",SAP:"SAP",NESN:"NESN.SW",LVMH:"MC.PA",
  SHEL:"SHEL",HSBA:"HSBA.L",AZN:"AZN",NVO:"NVO",
  SIEGY:"SIEGY",TTE:"TTE",BP:"BP",ULVR:"ULVR.L",
  // Middle East
  "2222.SR":"2222.SR","2010.SR":"2010.SR",
  QNBK:"QNBK.QA",EMIRATESNBD:"ENBD.DU",ADNOCDIST:"ADNOCDIST.AD",ETISALAT:"ETISALAT.AD",
  // Asia
  TSM:"TSM",BABA:"BABA",TCEHY:"TCEHY",
  "005930":"005930.KS","9984.T":"9984.T","7203.T":"7203.T",
  "7974.T":"7974.T","0700.HK":"0700.HK",
  PDD:"PDD",JD:"JD",RELIANCE:"RELIANCE.NS",INFY:"INFY",
  // Commodities (futures / ETFs)
  XAU:"GC=F",XAG:"SI=F",WTI:"CL=F",BRENT:"BZ=F",
  NATGAS:"NG=F",COPPER:"HG=F",PLATINUM:"PL=F",PALLADIUM:"PA=F",
  WHEAT:"ZW=F",CORN:"ZC=F",SOYBEANS:"ZS=F",
  COFFEE:"KC=F",SUGAR:"SB=F",
  URANIUM:"URA",DUBAI:"BZ=F",LNG:"UNG",
};
const BASKET_PRICE_TTL = 5 * 60 * 1000; // 5-min cache
const metalsRef: Record<string, {price:number,ts:number}> = {};

const ENERGY_ETF_MAP: Record<string, {etfSym: string, factor: number}> = {
  WTI: { etfSym: "USO", factor: 0.840 },
  BRENT: { etfSym: "BNO", factor: 2.105 },
  NATGAS: { etfSym: "UNG", factor: 0.32 },
};
const FOREX_BASE: Record<string, number> = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654,NZDUSD:0.5932,EURGBP:0.8526,EURJPY:162.45,GBPJPY:190.52,USDMXN:17.15,USDZAR:18.45,USDTRY:32.5,USDSGD:1.34};

const cache: Record<string, { data: any; ts: number }> = {};
const FINNHUB_TTL = 120000;

// ── SHARED AI RESPONSE CACHE ──────────────────────────────────────────────
// One Claude call per unique prompt per 5 minutes, regardless of user count.
// With 500 users, this reduces AI costs by ~99% for identical market analysis queries.
const aiCache = new Map<string, { text: string; ts: number }>();
const AI_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function hashStr(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}

function hashPrompt(system: string, msg: string): string {
  // Trade ideas: use time-bucketed cache (15 min) so all Pro users in same window share one response
  if (msg.includes("TOP 4 TRADE IDEAS") || msg.includes("TOP 3 TRADE IDEAS")) {
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    return "trade-ideas-" + hashStr(msg.slice(0, 200)) + "-" + bucket;
  }
  // Macro event analysis: bucket per event name + hour
  if (msg.startsWith("Analyze this economic release:")) {
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    return "macro-" + hashStr(msg.slice(0, 300)) + "-" + bucket;
  }
  // Default: hash system (first 200 chars) + full user message
  const str = system.slice(0, 200) + "|" + msg.slice(0, 600);
  return hashStr(str);
}

// Per-user AI rate limiting: free = 15 calls/hour, pro = 60 calls/hour
const aiRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkAiRateLimit(userId: string, isPro: boolean): boolean {
  const now = Date.now();
  const limit = isPro ? 60 : 15;
  let entry = aiRateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 3600000 };
    aiRateLimits.set(userId, entry);
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Cleanup stale AI cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of aiCache) {
    if (now - v.ts > AI_CACHE_TTL) aiCache.delete(k);
  }
}, 600000);

let finnhubFetchLock: Promise<any> | null = null;
let stockRefreshRunning = false;
let hlRefreshRunning = false;
const hlData: Record<string, { funding: number; oi: number; perpPrice: number; volume: number }> = {};

const priceHistory: Record<string, { price: number; ts: number }[]> = {};
const liveSignals: any[] = [];
let signalIdCounter = 10000;
const MOVE_WINDOW = 5 * 60 * 1000;
const SIGNAL_COOLDOWN = 10 * 60 * 1000;
const lastSignalTime: Record<string, number> = {};

// Session-aware thresholds — stricter in low-liquidity sessions
const SESSION_THRESHOLDS: Record<string, { minMove: number; minVolMult: number; minOI: number }> = {
  ASIAN:    { minMove: 2.0, minVolMult: 4.0, minOI: 15_000_000 },
  LONDON:   { minMove: 1.5, minVolMult: 3.0, minOI: 10_000_000 },
  NY:       { minMove: 1.5, minVolMult: 3.0, minOI: 10_000_000 },
  POST_NY:  { minMove: 2.0, minVolMult: 4.0, minOI: 15_000_000 },
  DEFAULT:  { minMove: 1.5, minVolMult: 3.0, minOI: 10_000_000 },
};

const whaleAlerts: { sym: string; ts: number; type: string; amount: string }[] = [];

// ─── MACRO RISK ENGINE ──────────────────────────────────────────────────────
// Shared cache so detectMoves can access upcoming macro events
let sharedMacroCache: { events: any[]; ts: number } = { events: [], ts: 0 };
export function updateSharedMacroCache(events: any[]) { sharedMacroCache = { events, ts: Date.now() }; }

const HIGH_IMPACT_KEYWORDS = ["FOMC", "CPI", "NFP", "Non-Farm", "Fed Rate", "Interest Rate", "GDP", "PCE", "PPI", "Powell"];

function getMacroRisk(): { highRisk: boolean; flags: string[]; confPenalty: number } {
  const flags: string[] = [];
  const now = Date.now();
  const in48h = now + 48 * 60 * 60 * 1000;
  const events = sharedMacroCache.events;
  for (const ev of events) {
    if (ev.impact !== "HIGH" && ev.impact !== "HIGH") continue;
    if (!ev.impact || ev.impact === "LOW") continue;
    const evDate = new Date(ev.date + "T" + (ev.timeET || "08:30").replace(" ET", "").replace(" UTC", "")).getTime();
    if (isNaN(evDate)) continue;
    if (evDate > now && evDate < in48h) {
      const isHighImpact = ev.impact === "HIGH" && HIGH_IMPACT_KEYWORDS.some(k => (ev.name || "").includes(k));
      if (isHighImpact) flags.push(`${ev.name} in <48h`);
    }
  }
  const highRisk = flags.length > 0;
  return { highRisk, flags, confPenalty: highRisk ? 20 : 0 };
}

function getSessionET(): { session: string; label: string; warning: string | null } {
  const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  if (etHour >= 0 && etHour < 8) return { session: "ASIAN", label: "Asian Session", warning: "Asian session — lower liquidity, tighter targets" };
  if (etHour >= 8 && etHour < 16) return { session: "NY", label: "NY Session", warning: null };
  if (etHour >= 16 && etHour < 20) return { session: "POST_NY", label: "Post-NY", warning: "Post-NY — avoid new day trades unless strong momentum" };
  return { session: "OVERNIGHT", label: "Overnight", warning: "Late session — Asian open, reduced liquidity" };
}

function recordPrice(sym: string, price: number) {
  if (!price || price <= 0) return;
  const now = Date.now();
  if (!priceHistory[sym]) priceHistory[sym] = [];
  priceHistory[sym].push({ price, ts: now });
  priceHistory[sym] = priceHistory[sym].filter(p => now - p.ts < 15 * 60 * 1000);
}

function calcATR(sym: string): number {
  const hist = priceHistory[sym];
  if (!hist || hist.length < 10) return 0;
  const recent = hist.slice(-60);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    intervals.push(Math.abs(recent[i].price - recent[i - 1].price));
  }
  if (intervals.length === 0) return 0;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

function calcMasterScore(sym: string, dir: string): { score: number; riskOn: number; reasoning: string[] } {
  const hl = hlData[sym];
  const hist = priceHistory[sym];
  let score = 50;
  const reasoning: string[] = [];
  const funding = hl?.funding || 0;
  const oiM = hl?.oi ? Math.round(hl.oi / 1e6) : 0;
  const fundingAligned = (dir === "LONG" && funding < 0) || (dir === "SHORT" && funding > 0);
  if (fundingAligned) { score += 12; reasoning.push("Funding rate aligned with direction (+12)"); }
  else if (Math.abs(funding) > 0.03) { score -= 8; reasoning.push("Funding rate opposing direction (-8)"); }
  else reasoning.push("Funding neutral (0)");
  if (oiM > 500) { score += 10; reasoning.push(`High OI $${oiM}M — institutional interest (+10)`); }
  else if (oiM > 100) { score += 5; reasoning.push(`Moderate OI $${oiM}M (+5)`); }
  if (hist && hist.length >= 10) {
    const prices = hist.slice(-20).map(p => p.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min;
    const current = prices[prices.length - 1];
    const rsiPos = range > 0 ? (current - min) / range : 0.5;
    if (dir === "LONG" && rsiPos < 0.3) { score += 15; reasoning.push("RSI oversold zone — contrarian bullish (+15)"); }
    else if (dir === "SHORT" && rsiPos > 0.7) { score += 15; reasoning.push("RSI overbought zone — contrarian bearish (+15)"); }
    else if (dir === "LONG" && rsiPos > 0.8) { score -= 5; reasoning.push("RSI extended — late entry risk (-5)"); }
    else if (dir === "SHORT" && rsiPos < 0.2) { score -= 5; reasoning.push("RSI compressed — late entry risk (-5)"); }
  }
  const recentWhale = whaleAlerts.filter(w => w.sym === sym && Date.now() - w.ts < 300000);
  if (recentWhale.length > 0) { score += 8; reasoning.push(`Whale activity detected within 5min — smart money alignment (+8)`); }
  let riskOn = 50;
  const allSyms = Object.keys(priceHistory);
  let upCount = 0, totalCount = 0;
  for (const s of allSyms) {
    const h = priceHistory[s];
    if (!h || h.length < 5) continue;
    totalCount++;
    if (h[h.length - 1].price > h[Math.max(0, h.length - 5)].price) upCount++;
  }
  if (totalCount > 0) riskOn = Math.round((upCount / totalCount) * 100);
  if (riskOn > 60) { score += 5; reasoning.push(`Global Risk-On score ${riskOn}% (+5)`); }
  else if (riskOn < 40) { score -= 5; reasoning.push(`Global Risk-Off score ${riskOn}% (-5)`); }
  score = Math.max(5, Math.min(98, score));
  return { score, riskOn, reasoning };
}

// ─── MARKET REGIME ENGINE ────────────────────────────
function calcRSI(sym: string, period = 14): number {
  const h = priceHistory[sym];
  if (!h || h.length < period + 1) return 50;
  const prices = h.slice(-(period + 1)).map(p => p.price);
  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMomentum(sym: string): number {
  const h = priceHistory[sym];
  if (!h || h.length < 5) return 0;
  const recent = h[h.length - 1].price;
  const older = h[Math.max(0, h.length - Math.min(h.length, 30))].price;
  return older > 0 ? ((recent - older) / older) * 100 : 0;
}

function calc50MA(sym: string): number {
  const h = priceHistory[sym];
  if (!h || h.length < 10) return h?.[h.length - 1]?.price || 0;
  const pts = h.slice(-Math.min(h.length, 50));
  return pts.reduce((s, p) => s + p.price, 0) / pts.length;
}

let regimeCache: { data: any; ts: number } | null = null;

async function checkAndGrantReferralReward(userId: string) {
  try {
    const user = await storage.getUser(userId);
    if (!user?.referredBy) return;
    const referrer = await storage.getUserByReferralCode(user.referredBy);
    if (!referrer) return;
    const referral = await storage.getReferralByReferred(userId);
    if (!referral || referral.rewardGranted) return;
    await storage.grantReferralReward(referral.id);
    const rewardExpiry = new Date(Date.now() + 7 * 86400000);
    if (referrer.tier !== "pro") {
      await pool.query("UPDATE users SET tier = 'pro', promo_expires_at = $1 WHERE id = $2", [rewardExpiry, referrer.id]);
    }
    try {
      const { client: resend, fromEmail } = await getUncachableResendClient();
      await resend.emails.send({
        from: fromEmail, to: referrer.email,
        reply_to: "MikeClaver@CLVRQuantAI.com",
        subject: "CLVRQuant — You earned 1 week of Pro!",
        headers: {
          "List-Unsubscribe": "<mailto:MikeClaver@CLVRQuantAI.com?subject=unsubscribe>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        text: `Congratulations, ${referrer.name}!\n\nYour referral just subscribed to CLVRQuant Pro. You've earned 1 week of free Pro access as a thank you!\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com\nTo unsubscribe: MikeClaver@CLVRQuantAI.com`,
        html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
          <div style="text-align:center;margin-bottom:24px"><div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d">CLVRQuant</div></div>
          <div style="border-top:1px solid #141e35;padding-top:20px">
            <p style="font-size:14px;color:#f0f4ff">Congratulations, ${referrer.name}!</p>
            <p style="font-size:13px;color:#6b7fa8;line-height:1.8">Your referral just subscribed to CLVRQuant Pro. You've earned <strong style="color:#e8c96d">1 week of free Pro access</strong> as a thank you!</p>
            <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a></p>
          <p style="font-size:9px;color:#2a3650;text-align:center;line-height:2">You are receiving this email because you have a CLVRQuant account. <a href="https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(referrer.email)}" style="color:#4a5d80;text-decoration:underline">Unsubscribe</a></p>
          </div></div>`,
      });
    } catch {}
    console.log(`[referral] Granted 1-week Pro reward to ${referrer.email} for referral of user ${userId}`);
  } catch (e: any) {
    console.error("[referral] Reward check error:", e.message);
  }
}

async function checkPromoExpiryReminders() {
  try {
    const users14 = await storage.getUsersWithExpiringPromos(14);
    for (const u of users14) {
      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        const expiryDate = u.promoExpiresAt ? new Date(u.promoExpiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "soon";
        await resend.emails.send({
          from: fromEmail, to: u.email,
          reply_to: "MikeClaver@CLVRQuantAI.com",
          subject: "CLVRQuant — Your Pro access expires in 2 weeks",
          headers: {
            "List-Unsubscribe": `<https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(u.email)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          text: `Hey ${u.name},\n\nYour CLVRQuant Pro access (promo code: ${u.promoCode}) expires on ${expiryDate}.\n\nTo keep uninterrupted access to AI analysis, signals, and all Pro features, subscribe before it expires at https://clvrquantai.com\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com\nUnsubscribe: https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(u.email)}`,
          html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
            <div style="text-align:center;margin-bottom:24px"><div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d">CLVRQuant</div></div>
            <div style="border-top:1px solid #141e35;padding-top:20px">
              <p style="font-size:14px;color:#f0f4ff">Hey ${u.name},</p>
              <p style="font-size:13px;color:#6b7fa8;line-height:1.8">Your CLVRQuant Pro access via promotion code <strong style="color:#e8c96d">${u.promoCode}</strong> expires on <strong style="color:#f0f4ff">${expiryDate}</strong>.</p>
              <p style="font-size:13px;color:#6b7fa8;line-height:1.8">To keep uninterrupted access to AI analysis, signals, and all Pro features, consider subscribing before it expires.</p>
              <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a></p>
              <p style="font-size:9px;color:#2a3650;text-align:center;line-height:2">You are receiving this email because you have a CLVRQuant account. <a href="https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(u.email)}" style="color:#4a5d80;text-decoration:underline">Unsubscribe</a></p>
            </div></div>`,
        });
        console.log(`[promo-reminder] Sent expiry reminder to ${u.email}`);
      } catch {}
    }
  } catch (e: any) {
    console.error("[promo-reminder] Error:", e.message);
  }
}

function calcMarketRegime() {
  const btcMom = calcMomentum("BTC");
  const btcRsi = calcRSI("BTC");
  const btcFunding = hlData["BTC"]?.funding || 0;

  let cryptoScore = 50;
  if (btcMom > 2) cryptoScore += 20; else if (btcMom > 0.5) cryptoScore += 10;
  else if (btcMom < -2) cryptoScore -= 20; else if (btcMom < -0.5) cryptoScore -= 10;
  if (btcRsi > 60) cryptoScore += 10; else if (btcRsi < 40) cryptoScore -= 10;
  if (btcFunding > 0.01) cryptoScore -= 5; else if (btcFunding < -0.01) cryptoScore += 5;
  cryptoScore = Math.max(0, Math.min(100, cryptoScore));

  const qqq = priceHistory["QQQ"] || priceHistory["NVDA"];
  const nasdaqMom = qqq ? calcMomentum("NVDA") : 0;
  const vixPrice = priceHistory["VIX"]?.[priceHistory["VIX"]?.length - 1]?.price || 0;
  let equityScore = 50;
  if (nasdaqMom > 1) equityScore += 15; else if (nasdaqMom > 0) equityScore += 5;
  else if (nasdaqMom < -1) equityScore -= 15; else if (nasdaqMom < 0) equityScore -= 5;
  if (vixPrice > 30) equityScore -= 25; else if (vixPrice > 25) equityScore -= 15;
  else if (vixPrice > 20) equityScore -= 5; else if (vixPrice < 15) equityScore += 10;
  equityScore = Math.max(0, Math.min(100, equityScore));

  const goldMom = calcMomentum("XAU");
  let metalsScore = 50;
  if (goldMom > 1) metalsScore -= 10; else if (goldMom < -1) metalsScore += 10;
  metalsScore = Math.max(0, Math.min(100, metalsScore));

  const eurUsdPrice = priceHistory["EURUSD"]?.[priceHistory["EURUSD"]?.length - 1]?.price || 0;
  const usdJpyPrice = priceHistory["USDJPY"]?.[priceHistory["USDJPY"]?.length - 1]?.price || 0;
  const eurMom = calcMomentum("EURUSD");
  const jpyMom = calcMomentum("USDJPY");
  let forexScore = 50;
  const usdStrength = (-eurMom + jpyMom) / 2;
  if (usdStrength > 0.5) forexScore -= 10; else if (usdStrength < -0.5) forexScore += 10;
  forexScore = Math.max(0, Math.min(100, forexScore));

  const compositeScore = Math.round(
    cryptoScore * 0.35 + equityScore * 0.35 + metalsScore * 0.15 + forexScore * 0.15
  );

  const regime = compositeScore >= 60 ? "RISK_ON" : compositeScore <= 40 ? "RISK_OFF" : "NEUTRAL";

  return {
    regime, score: compositeScore,
    components: {
      crypto: { score: cryptoScore, btcMom: +btcMom.toFixed(2), btcRsi: +btcRsi.toFixed(1), btcFunding: +btcFunding.toFixed(4), weight: "35%" },
      equities: { score: equityScore, nasdaqMom: +nasdaqMom.toFixed(2), vix: +vixPrice.toFixed(1), weight: "35%" },
      metals: { score: metalsScore, goldMom: +goldMom.toFixed(2), weight: "15%" },
      forex: { score: forexScore, usdStrength: +usdStrength.toFixed(2), eurUsd: +eurUsdPrice.toFixed(4), usdJpy: +usdJpyPrice.toFixed(2), weight: "15%" },
    },
  };
}

// ─── CLVR CRASH DETECTOR ─────────────────────────────
function calcCrashProbability() {
  const vixPrice = priceHistory["VIX"]?.[priceHistory["VIX"]?.length - 1]?.price || 0;
  let volatilityScore = 0;
  if (vixPrice > 35) volatilityScore = 95;
  else if (vixPrice > 30) volatilityScore = 80;
  else if (vixPrice > 25) volatilityScore = 60;
  else if (vixPrice > 20) volatilityScore = 35;
  else volatilityScore = 10;

  const eurMom = calcMomentum("EURUSD");
  const dxyRising = eurMom < -0.3;
  let liquidityScore = 0;
  const avgFunding = Object.values(hlData).reduce((s, d) => s + Math.abs(d.funding || 0), 0) / Math.max(1, Object.keys(hlData).length);
  if (dxyRising) liquidityScore += 40;
  if (avgFunding > 0.03) liquidityScore += 30;
  else if (avgFunding > 0.01) liquidityScore += 15;
  liquidityScore = Math.min(100, liquidityScore);

  const nasdaqMom = calcMomentum("NVDA");
  let equityTrendScore = 0;
  if (nasdaqMom < -3) equityTrendScore = 90;
  else if (nasdaqMom < -1) equityTrendScore = 60;
  else if (nasdaqMom < 0) equityTrendScore = 30;
  else equityTrendScore = 10;

  const btcMom = calcMomentum("BTC");
  const btcMA = calc50MA("BTC");
  const btcCurrent = priceHistory["BTC"]?.[priceHistory["BTC"]?.length - 1]?.price || 0;
  let cryptoStressScore = 0;
  if (btcCurrent < btcMA && btcMom < 0) cryptoStressScore = 70;
  else if (btcMom < -2) cryptoStressScore = 50;
  else if (btcMom < 0) cryptoStressScore = 25;
  else cryptoStressScore = 5;

  const probability = Math.round(
    volatilityScore * 0.40 + liquidityScore * 0.30 + equityTrendScore * 0.20 + cryptoStressScore * 0.10
  );

  const signals: string[] = [];
  if (vixPrice > 25) signals.push(`VIX spike detected (${vixPrice.toFixed(1)})`);
  if (dxyRising) signals.push("Dollar strengthening — global liquidity tightening");
  if (nasdaqMom < 0) signals.push("Nasdaq momentum negative");
  if (btcCurrent < btcMA) signals.push(`BTC below moving average ($${btcMA.toFixed(0)})`);
  if (avgFunding > 0.02) signals.push("High funding rates — overleveraged market");

  const status = probability >= 80 ? "CRASH_WARNING" : probability >= 60 ? "HIGH_RISK" : probability >= 40 ? "CAUTION" : "NORMAL";

  return {
    probability, status, signals,
    components: {
      volatility: { score: volatilityScore, vix: +vixPrice.toFixed(1), weight: "40%" },
      liquidity: { score: liquidityScore, dxyRising, avgFunding: +avgFunding.toFixed(4), weight: "30%" },
      equityTrend: { score: equityTrendScore, nasdaqMom: +nasdaqMom.toFixed(2), weight: "20%" },
      cryptoStress: { score: cryptoStressScore, btcMom: +btcMom.toFixed(2), btcVsMA: btcCurrent > 0 ? +((btcCurrent / btcMA - 1) * 100).toFixed(2) : 0, weight: "10%" },
    },
  };
}

// ─── CLVR GLOBAL LIQUIDITY INDEX ─────────────────────
function calcLiquidityIndex() {
  const eurMom = calcMomentum("EURUSD");
  const usdStrength = -eurMom;
  let currencyScore = 50;
  if (usdStrength > 1) currencyScore = 25;
  else if (usdStrength > 0.3) currencyScore = 35;
  else if (usdStrength < -1) currencyScore = 80;
  else if (usdStrength < -0.3) currencyScore = 65;

  const avgFunding = Object.values(hlData).reduce((s, d) => s + (d.funding || 0), 0) / Math.max(1, Object.keys(hlData).length);
  let creditScore = 50;
  if (avgFunding > 0.03) creditScore = 30;
  else if (avgFunding > 0.01) creditScore = 40;
  else if (avgFunding < -0.01) creditScore = 65;
  else if (avgFunding < -0.03) creditScore = 80;

  const allSyms = Object.keys(priceHistory);
  let upCount = 0, totalCount = 0;
  for (const s of allSyms) {
    const h = priceHistory[s];
    if (!h || h.length < 5) continue;
    totalCount++;
    if (h[h.length - 1].price > h[Math.max(0, h.length - 5)].price) upCount++;
  }
  const breadthScore = totalCount > 0 ? Math.round((upCount / totalCount) * 100) : 50;

  const totalOI = Object.values(hlData).reduce((s, d) => s + (d.oi || 0), 0);
  let oiScore = 50;
  if (totalOI > 50e9) oiScore = 75;
  else if (totalOI > 20e9) oiScore = 60;
  else if (totalOI < 5e9) oiScore = 30;

  const score = Math.round(currencyScore * 0.30 + creditScore * 0.25 + breadthScore * 0.25 + oiScore * 0.20);
  const mode = score >= 60 ? "LIQUIDITY_EXPANSION" : score <= 40 ? "LIQUIDITY_CONTRACTION" : "NEUTRAL";

  const implications: string[] = [];
  if (score >= 60) { implications.push("Bullish for BTC"); implications.push("Bullish for tech stocks"); }
  else if (score <= 40) { implications.push("Bearish for BTC"); implications.push("Caution on tech stocks"); }
  else { implications.push("Neutral stance recommended"); }

  return {
    score, mode, implications,
    components: {
      currency: { score: currencyScore, usdStrength: +usdStrength.toFixed(2), weight: "30%" },
      credit: { score: creditScore, avgFunding: +avgFunding.toFixed(4), weight: "25%" },
      breadth: { score: breadthScore, upRatio: totalCount > 0 ? `${upCount}/${totalCount}` : "0/0", weight: "25%" },
      openInterest: { score: oiScore, totalOI: `$${(totalOI / 1e9).toFixed(1)}B`, weight: "20%" },
    },
  };
}

function detectMoves() {
  const now = Date.now();
  for (const sym of CRYPTO_SYMS) {
    const hist = priceHistory[sym];
    if (!hist || hist.length < 3) continue;
    if (lastSignalTime[sym] && now - lastSignalTime[sym] < SIGNAL_COOLDOWN) continue;

    const current = hist[hist.length - 1];
    const windowPts = hist.filter(p => now - p.ts >= MOVE_WINDOW * 0.8 && now - p.ts <= MOVE_WINDOW * 1.2);
    const windowStart = windowPts.length > 0 ? windowPts[0] : hist.filter(p => now - p.ts <= MOVE_WINDOW).sort((a, b) => a.ts - b.ts)[0];
    if (!windowStart || windowStart === current) continue;
    if (now - windowStart.ts < MOVE_WINDOW * 0.5) continue;

    const pctMove = ((current.price - windowStart.price) / windowStart.price) * 100;
    const absPctMove = Math.abs(pctMove);

    const dir = pctMove > 0 ? "LONG" : "SHORT";
    const icon = pctMove > 0 ? "+" : "-";
    const absPct = absPctMove.toFixed(1);
    const elapsed = Math.round((current.ts - windowStart.ts) / 60000);

    // Session-aware thresholds
    const sessionInfo = getSessionET();
    const sessionKey = sessionInfo.session || "DEFAULT";
    const thresh = SESSION_THRESHOLDS[sessionKey] || SESSION_THRESHOLDS.DEFAULT;

    const hl = hlData[sym];
    const oiVal = hl?.oi || 0;
    const fundingVal = hl?.funding || 0;

    // Compute volume multiplier from price history (use point count as proxy for volume activity)
    const recentPts = hist.filter(p => now - p.ts <= MOVE_WINDOW);
    const olderPts = hist.filter(p => now - p.ts > MOVE_WINDOW && now - p.ts <= MOVE_WINDOW * 4);
    const avgRecentVol = olderPts.length > 0 ? olderPts.length / 3 : 1;
    const volumeMult = avgRecentVol > 0 ? recentPts.length / avgRecentVol : 1;

    // ── MULTI-FACTOR SIGNAL QUALITY CHECKS (FIX 6b) ─────────────────────────
    const prev1minPts = hist.filter(p => now - p.ts <= 60000 && now - p.ts > 5000);
    const lastMinPt = prev1minPts.length > 0 ? prev1minPts[prev1minPts.length - 1] : null;
    const last1minMove = lastMinPt ? ((current.price - lastMinPt.price) / lastMinPt.price) * 100 : 0;
    const notFading = dir === "LONG" ? last1minMove >= -0.1 : last1minMove <= 0.1;

    const checks: Record<string, { pass: boolean; label: string; detail: string }> = {
      priceMove: {
        pass: absPctMove >= thresh.minMove,
        label: `Price move ${absPct}% in ${elapsed}min`,
        detail: `≥${thresh.minMove}% required`,
      },
      volume: {
        pass: volumeMult >= thresh.minVolMult || volumeMult === 1,
        label: `Activity ${volumeMult.toFixed(1)}x avg`,
        detail: `≥${thresh.minVolMult}x required`,
      },
      minOI: {
        pass: oiVal === 0 || oiVal >= thresh.minOI,
        label: oiVal > 0 ? `OI $${(oiVal / 1e6).toFixed(0)}M` : "OI data unavailable",
        detail: `≥$${(thresh.minOI / 1e6).toFixed(0)}M required`,
      },
      fundingHealthy: {
        pass: Math.abs(fundingVal) <= 0.003,
        label: `Funding ${fundingVal >= 0 ? "+" : ""}${(fundingVal * 100).toFixed(4)}%/8h`,
        detail: "≤|0.003%| healthy",
      },
      notFading: {
        pass: notFading,
        label: notFading ? "Move still sustained" : "Move fading in last 1min",
        detail: "Must not reverse in last 1min",
      },
    };

    const passedCount = Object.values(checks).filter(c => c.pass).length;
    const totalChecks = Object.keys(checks).length;
    // Must pass at least 4/5 checks (or 3/5 if price move is very strong ≥3%)
    const minPassed = absPctMove >= 3 ? 3 : 4;
    if (passedCount < minPassed) {
      const failed = Object.entries(checks).filter(([,v]) => !v.pass).map(([k]) => k).join(", ");
      console.log(`[SIGNAL] ${sym} FILTERED — only ${passedCount}/${totalChecks} checks passed. Failed: ${failed}`);
      continue;
    }

    const checksArray = Object.entries(checks).map(([key, c]) => ({
      key,
      pass: c.pass,
      label: c.label,
      detail: c.detail,
    }));

    const fundingStr = hl?.funding ? ` Funding: ${hl.funding >= 0 ? "+" : ""}${(hl.funding).toFixed(4)}%/8h.` : "";
    const oiStr = hl?.oi ? ` OI: $${(hl.oi / 1e6).toFixed(0)}M.` : "";

    const atr = calcATR(sym);
    const entry = current.price;

    // FIX 6a: Minimum TP distance — at least 0.5% for TP1, 1.0% for TP2
    const precision = entry < 0.01 ? 6 : entry < 1 ? 4 : entry < 100 ? 3 : 2;
    const minTP1Dist = entry * 0.005;
    const minTP2Dist = entry * 0.010;
    const minStopDist = entry * 0.003;

    const rawStop = atr > 0 ? atr * 1.5 : entry * 0.015;
    const rawTP1 = atr > 0 ? atr * 2 : entry * 0.02;
    const rawTP2 = atr > 0 ? atr * 4 : entry * 0.04;

    const stopLoss = dir === "LONG"
      ? +Math.max((entry - rawStop), (entry - Math.max(rawStop, minStopDist))).toFixed(precision)
      : +Math.min((entry + rawStop), (entry + Math.max(rawStop, minStopDist))).toFixed(precision);

    const tp1 = dir === "LONG"
      ? +Math.max(entry + rawTP1, entry + minTP1Dist).toFixed(precision)
      : +Math.min(entry - rawTP1, entry - minTP1Dist).toFixed(precision);

    const tp2 = dir === "LONG"
      ? +Math.max(entry + rawTP2, entry + minTP2Dist).toFixed(precision)
      : +Math.min(entry - rawTP2, entry - minTP2Dist).toFixed(precision);

    const actualStop = Math.abs(entry - stopLoss);
    const actualTP1 = Math.abs(entry - tp1);
    const actualTP2 = Math.abs(entry - tp2);
    const stopPct = (actualStop / entry * 100).toFixed(1);
    const tp1Pct = (actualTP1 / entry * 100).toFixed(1);
    const tp2Pct = (actualTP2 / entry * 100).toFixed(1);
    const rr1 = actualStop > 0 ? (actualTP1 / actualStop).toFixed(1) : "1.3";
    const rr2 = actualStop > 0 ? (actualTP2 / actualStop).toFixed(1) : "2.7";
    const target = tp2;

    // Confidence reflects check quality
    const checkConf = Math.round((passedCount / totalChecks) * 100);

    const master = calcMasterScore(sym, dir);

    // ── LAYER 1: Macro Risk ──────────────────────────────────────────
    const macroRisk = getMacroRisk();

    // 24h spike check (Layer 2)
    const hist24 = priceHistory[sym] || [];
    const oldest24 = hist24.find(p => now - p.ts >= 14 * 60 * 1000); // 14min window
    const spike24 = oldest24 ? Math.abs(((current.price - oldest24.price) / oldest24.price) * 100) : 0;
    const isPostSpike = spike24 > 20;

    // Confidence: blend move magnitude + check pass rate, then apply macro/session/spike penalties
    let confBase = Math.min(90, Math.round(
      (60 + Math.floor(absPctMove * 5)) * 0.6 + checkConf * 0.4
    ));
    const confFlags: string[] = [];
    if (macroRisk.highRisk) {
      confBase = Math.max(30, confBase - macroRisk.confPenalty);
      confFlags.push(...macroRisk.flags.map(f => `HIGH MACRO RISK: ${f} — SIZE DOWN`));
    }
    if (isPostSpike) {
      confBase = Math.max(25, confBase - 15);
      confFlags.push("POST-SPIKE — MEAN REVERSION RISK HIGH");
    }
    if (sessionInfo.session === "POST_NY") {
      confBase = Math.max(20, confBase - 10);
      if (sessionInfo.warning) confFlags.push(sessionInfo.warning);
    }
    if (sessionInfo.session === "ASIAN") {
      confBase = Math.max(30, confBase - 5);
      if (sessionInfo.warning) confFlags.push(sessionInfo.warning);
    }

    // Risk label (5-layer system)
    const riskLabel = macroRisk.highRisk || isPostSpike ? "🔴" : confFlags.length > 0 ? "🟡" : confBase >= 70 ? "🟢" : "🟡";

    // Leverage: never >5x, reduce in high macro risk
    const baseLev = Math.abs(pctMove) >= 3 ? 3 : 2;
    const finalLev = macroRisk.highRisk ? Math.min(baseLev, 2) : sessionInfo.session === "ASIAN" ? Math.min(baseLev, 2) : baseLev;

    const desc = pctMove > 0
      ? `${riskLabel} ${sym} +${absPct}% in ${elapsed}min — from $${fmt2(windowStart.price, sym)} to $${fmt2(current.price, sym)}.${fundingStr}${oiStr}${confFlags.length > 0 ? " ⚠️ " + confFlags[0] : ""}`
      : `${riskLabel} ${sym} −${absPct}% in ${elapsed}min — from $${fmt2(windowStart.price, sym)} to $${fmt2(current.price, sym)}.${fundingStr}${oiStr}${confFlags.length > 0 ? " ⚠️ " + confFlags[0] : ""}`;

    const tags = [
      { l: "LIVE DETECTED", c: "green" },
      { l: Math.abs(pctMove) >= 3 ? "MAJOR MOVE" : "BREAKOUT", c: Math.abs(pctMove) >= 3 ? "red" : "orange" },
    ];
    if (hl?.funding && Math.abs(hl.funding) > 0.01) tags.push({ l: hl.funding > 0 ? "HIGH FUND" : "NEG FUND", c: hl.funding > 0 ? "orange" : "green" });
    const recentWhale = whaleAlerts.filter(w => w.sym === sym && now - w.ts < 300000);
    if (recentWhale.length > 0) tags.push({ l: "WHALE ALIGNED", c: "cyan" });
    if (macroRisk.highRisk) tags.push({ l: "MACRO RISK", c: "red" });
    if (isPostSpike) tags.push({ l: "POST-SPIKE", c: "orange" });
    if (sessionInfo.session === "ASIAN") tags.push({ l: "ASIAN SESSION", c: "purple" });
    if (sessionInfo.session === "NY") tags.push({ l: "NY SESSION", c: "green" });

    const signal = {
      id: signalIdCounter++,
      icon,
      dir,
      token: sym,
      conf: confBase,
      lev: `${finalLev}x`,
      src: "alpha-detect",
      desc,
      tags,
      ts: now,
      real: true,
      pctMove: +pctMove.toFixed(2),
      entry,
      target,
      tp1,
      tp2,
      stopLoss,
      stopPct,
      tp1Pct,
      tp2Pct,
      rr1,
      rr2,
      atr: +atr.toFixed(6),
      masterScore: master.score,
      riskOn: master.riskOn,
      reasoning: master.reasoning,
      riskLabel,
      timeframe: "DAY",
      session: sessionInfo.label,
      macroFlags: confFlags,
      whaleAligned: recentWhale.length > 0,
      checks: checksArray,
      checksPassedCount: passedCount,
      checksTotalCount: totalChecks,
    };

    liveSignals.unshift(signal);
    if (liveSignals.length > 50) liveSignals.length = 50;
    lastSignalTime[sym] = now;
    console.log(`[SIGNAL] ${sym} ${dir} ${absPct}% in ${elapsed}min — price $${fmt2(current.price, sym)} | MasterScore: ${master.score}`);
  }
}

function fmt2(p: number, sym: string): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 100) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(6);
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBinancePrices(): Promise<Record<string, any>> {
  const symbols = encodeURIComponent(JSON.stringify(BINANCE_SYMS));
  const r = await fetch(
    `https://api.binance.us/api/v3/ticker/24hr?symbols=${symbols}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`Binance ${r.status}`);
  const data: any[] = await r.json();
  const reverseMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(BINANCE_MAP)) reverseMap[v] = k;
  const result: Record<string, any> = {};
  for (const t of data) {
    const sym = reverseMap[t.symbol];
    if (sym) {
      const price = parseFloat(t.lastPrice);
      if (price > 0) {
        recordPrice(sym, price);
        result[sym] = {
          price,
          chg: parseFloat(t.priceChangePercent),
          funding: hlData[sym]?.funding || 0,
          oi: hlData[sym]?.oi || 0,
          perpPrice: hlData[sym]?.perpPrice || 0,
          volume: hlData[sym]?.volume || 0,
          live: true,
        };
      }
    }
  }
  const missingSym = CRYPTO_SYMS.filter(s => !result[s]);
  if (missingSym.length > 0) {
    try {
      const hlr = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        signal: AbortSignal.timeout(5000),
      });
      const mids: any = await hlr.json();
      for (const sym of missingSym) {
        if (mids[sym]) {
          const price = parseFloat(mids[sym]);
          recordPrice(sym, price);
          result[sym] = {
            price,
            chg: hlData[sym]?.dayChg ?? (CRYPTO_BASE[sym] ? +((price - CRYPTO_BASE[sym]) / CRYPTO_BASE[sym] * 100).toFixed(2) : 0),
            funding: hlData[sym]?.funding || 0,
            oi: hlData[sym]?.oi || 0,
            perpPrice: price,
            volume: hlData[sym]?.volume || 0,
            live: true,
          };
        }
      }
    } catch {}
  }
  detectMoves();
  return result;
}

async function startHyperliquidRefreshLoop() {
  if (hlRefreshRunning) return;
  hlRefreshRunning = true;
  while (true) {
    try {
      const [r1, r2] = await Promise.all([
        fetch("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "allMids" }),
          signal: AbortSignal.timeout(5000),
        }),
        fetch("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "metaAndAssetCtxs" }),
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      const mids: any = await r1.json();
      const meta: any = await r2.json();
      const universe = meta[0].universe;
      const ctxs = meta[1];
      universe.forEach((asset: any, i: number) => {
        if (HL_PERP_SYMS.includes(asset.name)) {
          const appName = HL_TO_APP[asset.name] || asset.name;
          const markPx = parseFloat(ctxs[i]?.markPx || 0);
          const prevDayPx = parseFloat(ctxs[i]?.prevDayPx || 0);
          const dayChg = prevDayPx > 0 ? +((markPx - prevDayPx) / prevDayPx * 100).toFixed(2) : 0;
          hlData[appName] = {
            funding: +(parseFloat(ctxs[i]?.funding || 0) * 100).toFixed(4),
            oi: parseFloat(ctxs[i]?.openInterest || 0) * markPx,
            perpPrice: mids[asset.name] ? parseFloat(mids[asset.name]) : 0,
            volume: parseFloat(ctxs[i]?.dayNtlVlm || 0),
            dayChg,
          };
          if (markPx > 0) recordPrice(appName, markPx);
        }
      });
      detectMoves();
    } catch (e: any) {
      console.error("Hyperliquid refresh error:", e.message);
    }
    await delay(5000);
  }
}

async function fhQuoteSafe(symbol: string): Promise<{price:number,chg:number,live:boolean}> {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.status === 429 || r.status === 503) {
      throw new Error(`rate limited ${r.status}`);
    }
    if (!r.ok) throw new Error(`Finnhub ${r.status}`);
    const d: any = await r.json();
    if (!d || !d.c || d.c === 0) throw new Error("zero price");
    return {
      price: d.c,
      chg: d.dp ?? (d.pc ? ((d.c - d.pc) / d.pc * 100) : 0),
      live: true
    };
  } catch {
    return { price: EQUITY_BASE[symbol] || 0, chg: 0, live: false };
  }
}

async function startStockRefreshLoop() {
  if (stockRefreshRunning) return;
  stockRefreshRunning = true;

  while (true) {
    try {
      const stocks: Record<string, any> = {};
      for (const sym of EQUITY_SYMS) {
        const fhSym = EQUITY_FH_MAP[sym] || sym;
        const q = await fhQuoteSafe(fhSym);
        if (!q.live) q.price = EQUITY_BASE[sym] || q.price;
        stocks[sym] = q;
        await delay(1500);
      }

      try {
        const vixQ = await fhQuoteSafe("UVXY");
        if (vixQ.live && vixQ.price > 0) {
          const approxVIX = vixQ.price * 0.65 + 12;
          recordPrice("VIX", approxVIX);
        }
      } catch {}

      const [metals, forex] = await Promise.all([fetchMetals(), fetchForex()]);
      const result = { stocks, metals, forex };
      cache["finnhub"] = { data: result, ts: Date.now() };
    } catch (e: any) {
      console.error("Stock refresh error:", e.message);
    }

    await delay(120000);
  }
}

async function fetchForex(): Promise<Record<string, any>> {
  const forex: Record<string, any> = {};
  try {
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD",
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`ExchangeRate ${r.status}`);
    const data: any = await r.json();
    const rates = data.rates || {};
    const pairs: Record<string, { to: string; invert: boolean }> = {
      EURUSD: { to: "EUR", invert: true },
      GBPUSD: { to: "GBP", invert: true },
      USDJPY: { to: "JPY", invert: false },
      USDCHF: { to: "CHF", invert: false },
      AUDUSD: { to: "AUD", invert: true },
      USDCAD: { to: "CAD", invert: false },
      NZDUSD: { to: "NZD", invert: true },
      USDMXN: { to: "MXN", invert: false },
      USDZAR: { to: "ZAR", invert: false },
      USDTRY: { to: "TRY", invert: false },
      USDSGD: { to: "SGD", invert: false },
    };
    const crossPairs: Record<string, { base: string; quote: string }> = {
      EURGBP: { base: "EUR", quote: "GBP" },
      EURJPY: { base: "EUR", quote: "JPY" },
      GBPJPY: { base: "GBP", quote: "JPY" },
    };
    for (const [sym, cfg] of Object.entries(pairs)) {
      const rate = rates[cfg.to];
      if (rate) {
        const price = cfg.invert ? +(1 / rate).toFixed(4) : +rate.toFixed(4);
        const base = FOREX_BASE[sym];
        forex[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
      } else {
        forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
      }
    }
    for (const [sym, cfg] of Object.entries(crossPairs)) {
      const baseRate = rates[cfg.base];
      const quoteRate = rates[cfg.quote];
      if (baseRate && quoteRate) {
        const price = +(quoteRate / baseRate).toFixed(4);
        const base = FOREX_BASE[sym];
        forex[sym] = { price, chg: base ? +((price - base) / base * 100).toFixed(2) : 0, live: true };
      } else {
        forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
      }
    }
  } catch {
    for (const sym of Object.keys(FOREX_BASE)) {
      forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
    }
  }
  return forex;
}

async function fetchMetals(): Promise<Record<string, any>> {
  const metals: Record<string, any> = {};
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const sym of ["XAU", "XAG", "XPT", "HG"] as const) {
    const appSym = sym === "XPT" ? "PLATINUM" : sym === "HG" ? "COPPER" : sym;
    try {
      const r = await fetch(
        `https://api.gold-api.com/price/${sym}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        const d: any = await r.json();
        if (d?.price && d.price > 0) {
          const now = Date.now();
          if (!metalsRef[appSym] || now - metalsRef[appSym].ts > DAY_MS) {
            metalsRef[appSym] = { price: d.price, ts: now };
          }
          const ref = metalsRef[appSym].price;
          const chg = ref ? +((d.price - ref) / ref * 100).toFixed(2) : 0;
          metals[appSym] = { price: d.price, chg, live: true };
          continue;
        }
      }
    } catch {}
    metals[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
  }
  for (const [appSym, cfg] of Object.entries(ENERGY_ETF_MAP)) {
    try {
      const q = await fhQuoteSafe(cfg.etfSym);
      if (q.live && q.price > 0) {
        const commodityPrice = +(q.price * cfg.factor).toFixed(2);
        metals[appSym] = { price: commodityPrice, chg: q.chg, live: true };
      } else {
        metals[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
      }
    } catch {
      metals[appSym] = { price: METALS_BASE[appSym] || 0, chg: 0, live: false };
    }
    await delay(300);
  }
  return metals;
}

// ─── Finnhub WebSocket for real-time equity + commodity ETF prices ───
const FH_WS_SYMS: Record<string, string> = {};
EQUITY_SYMS.forEach(sym => { FH_WS_SYMS[EQUITY_FH_MAP[sym] || sym] = `eq:${sym}`; });
Object.entries(ENERGY_ETF_MAP).forEach(([appSym, cfg]) => { FH_WS_SYMS[cfg.etfSym] = `etf:${appSym}:${cfg.factor}`; });
// Extra WS basket symbols — BABA & TSM now in EQUITY_SYMS; budget: 50-20-3-14=13 slots, use 12
const BASKET_EXTRA_SYMS = [
  "JPM","V","XOM","WMT","BAC",               // S&P 500 extras (5)
  "ASML","AZN",                              // EU ADRs on NASDAQ (2)
  "URA","WEAT","CORN",                       // Commodity ETFs (3)
  "RY","TD",                                 // TSX dual-listed (2) = 12 total
];
BASKET_EXTRA_SYMS.forEach(sym => { if (!FH_WS_SYMS[sym]) FH_WS_SYMS[sym] = `eq:${sym}`; });
const FOREX_FH_SYMS: Record<string, string> = {
  "OANDA:EUR_USD":"EURUSD","OANDA:GBP_USD":"GBPUSD","OANDA:USD_JPY":"USDJPY",
  "OANDA:USD_CHF":"USDCHF","OANDA:AUD_USD":"AUDUSD","OANDA:USD_CAD":"USDCAD",
  "OANDA:NZD_USD":"NZDUSD","OANDA:EUR_GBP":"EURGBP","OANDA:EUR_JPY":"EURJPY",
  "OANDA:GBP_JPY":"GBPJPY","OANDA:USD_MXN":"USDMXN","OANDA:USD_ZAR":"USDZAR",
  "OANDA:USD_TRY":"USDTRY","OANDA:USD_SGD":"USDSGD",
};

const livePrices: Record<string, { price: number; chg: number; ts: number; type: string }> = {};
const sseClients: Set<Response> = new Set();

// ── Server-side price cache for alert checking (crypto via Binance REST) ──────
const serverPriceCache: Record<string, { price: number; chg: number; updatedAt: number }> = {};
const alertLastFiredMs: Map<number, number> = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // don't re-fire same alert within 5 min

async function refreshServerPriceCache() {
  try {
    const data = await fetchBinancePrices();
    for (const [sym, info] of Object.entries(data as Record<string, any>)) {
      serverPriceCache[sym] = { price: info.price, chg: info.chg ?? 0, updatedAt: Date.now() };
    }
  } catch {}
  // Also copy equity/metal/forex from livePrices
  for (const [sym, info] of Object.entries(livePrices)) {
    serverPriceCache[sym] = { price: info.price, chg: info.chg, updatedAt: info.ts };
  }
}

async function checkServerAlerts() {
  try {
    const now = new Date();
    const result = await pool.query(
      `SELECT id, user_id, sym, field, condition, threshold, label FROM user_alerts WHERE triggered = false AND expires_at > $1`,
      [now]
    );
    if (!result.rows.length) return;

    for (const alert of result.rows) {
      const { id, user_id, sym, field, condition, threshold, label } = alert;

      // Skip if still in cooldown
      const lastFired = alertLastFiredMs.get(id) || 0;
      if (Date.now() - lastFired < ALERT_COOLDOWN_MS) continue;

      const cached = serverPriceCache[sym];
      if (!cached) continue;

      const currentVal = field === "chg" ? cached.chg : cached.price;
      const thresholdVal = parseFloat(threshold);
      if (isNaN(thresholdVal)) continue;

      const hit = (condition === ">" && currentVal > thresholdVal)
                || (condition === "<" && currentVal < thresholdVal);
      if (!hit) continue;

      alertLastFiredMs.set(id, Date.now());

      // Mark triggered in DB
      await pool.query(`UPDATE user_alerts SET triggered = true WHERE id = $1`, [id]);

      // Format notification
      const dir = condition === ">" ? "above" : "below";
      const displayVal = field === "chg"
        ? `${currentVal.toFixed(2)}%`
        : currentVal >= 1 ? `$${currentVal.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${currentVal.toFixed(6)}`;
      const title = `⚡ ${label || `${sym} Alert`}`;
      const body  = `${sym} ${field === "chg" ? "change" : "price"} is ${dir} ${field === "chg" ? `${thresholdVal}%` : `$${thresholdVal.toLocaleString()}`} — now ${displayVal}`;

      await sendWebPushToUser(user_id, title, body, `price-alert-${id}`);
      console.log(`[alerts] 🔔 Fired push for user ${user_id}: ${title} — ${body}`);
    }
  } catch (e) {
    console.error("[alerts] Error checking server alerts:", e);
  }
}

function broadcastSSE(data: Record<string, any>) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

let fhWsConnected = false;
function startFinnhubWebSocket() {
  if (!FINNHUB_KEY) return;
  let retries = 0;
  const connect = () => {
    // 429 guard: don't reconnect more than once every 10s in back-off states
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    ws.on("open", () => {
      fhWsConnected = true;
      retries = 0;
      // Throttle subscriptions: send in batches of 10 with 400ms delay to avoid 1006 force-close
      const allSubs = [
        ...Object.keys(FH_WS_SYMS),
        ...Object.keys(FOREX_FH_SYMS),
      ];
      const BATCH = 10;
      const sendBatch = (i: number) => {
        if (i >= allSubs.length || ws.readyState !== 1 /* OPEN */) return;
        for (let j = i; j < Math.min(i + BATCH, allSubs.length); j++) {
          ws.send(JSON.stringify({ type: "subscribe", symbol: allSubs[j] }));
        }
        setTimeout(() => sendBatch(i + BATCH), 400);
      };
      sendBatch(0);
      console.log(`[finnhub-ws] connected, subscribing to ${Object.keys(FH_WS_SYMS).length} equities/ETFs + ${Object.keys(FOREX_FH_SYMS).length} forex`);
    });
    ws.on("message", (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type !== "trade" || !msg.data?.length) return;
        const batch: Record<string, any> = {};
        for (const trade of msg.data) {
          const fhSym = trade.s;
          const price = trade.p;
          if (!price || price <= 0) continue;

          const eqMapping = FH_WS_SYMS[fhSym];
          if (eqMapping) {
            if (eqMapping.startsWith("eq:")) {
              const appSym = eqMapping.slice(3);
              const base = EQUITY_BASE[appSym];
              const chg = base ? +((price - base) / base * 100).toFixed(2) : 0;
              livePrices[appSym] = { price, chg, ts: Date.now(), type: "equity" };
              batch[appSym] = { price, chg, type: "equity" };
            } else if (eqMapping.startsWith("etf:")) {
              const parts = eqMapping.split(":");
              const appSym = parts[1];
              const factor = parseFloat(parts[2]);
              const commodityPrice = +(price * factor).toFixed(2);
              const base = METALS_BASE[appSym];
              const chg = base ? +((commodityPrice - base) / base * 100).toFixed(2) : 0;
              livePrices[appSym] = { price: commodityPrice, chg, ts: Date.now(), type: "metal" };
              batch[appSym] = { price: commodityPrice, chg, type: "metal" };
            }
          }
          const fxMapping = FOREX_FH_SYMS[fhSym];
          if (fxMapping) {
            const base = FOREX_BASE[fxMapping];
            const chg = base ? +((price - base) / base * 100).toFixed(2) : 0;
            livePrices[fxMapping] = { price, chg, ts: Date.now(), type: "forex" };
            batch[fxMapping] = { price, chg, type: "forex" };
          }
        }
        if (Object.keys(batch).length && sseClients.size > 0) {
          broadcastSSE(batch);
        }
      } catch {}
    });
    ws.on("error", (err: any) => { fhWsConnected = false; console.warn("[finnhub-ws] error:", err?.message || err); });
    ws.on("close", (code: number, reason: Buffer) => {
      fhWsConnected = false;
      retries++;
      // Start at 10s min backoff, cap at 5min — prevents 429 on rapid reconnects
      const backoff = Math.min(10000 + (retries - 1) * 5000, 300000);
      const msg = reason?.toString?.() || "";
      console.log(`[finnhub-ws] disconnected (code=${code}${msg ? " reason=" + msg : ""}), retrying in ${(backoff / 1000).toFixed(0)}s`);
      setTimeout(connect, backoff);
    });
  };
  connect();
}

// ── Generate rotating 7-day trial code for the owner ─────────────────────────
async function generateTrialCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from({length:8}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  const code = `CLVR-TRIAL-${rand}`;
  const expires = new Date(); expires.setDate(expires.getDate() + 7);
  await pool.query(
    `INSERT INTO access_codes (code, label, type, active, expires_at, max_uses)
     VALUES ($1, 'Owner Trial — 7 Days Free Pro', 'trial', true, $2, 1)
     ON CONFLICT (code) DO NOTHING`,
    [code, expires]
  );
  return code;
}

async function getCurrentTrialCode(): Promise<{code:string, expiresAt:string}|null> {
  try {
    const res = await pool.query(
      `SELECT code, expires_at FROM access_codes
       WHERE type='trial' AND active=true AND expires_at > NOW()
       AND (max_uses IS NULL OR use_count < max_uses OR use_count IS NULL)
       AND used_by IS NULL
       ORDER BY created_at DESC LIMIT 1`
    );
    if (res.rows.length > 0) return { code: res.rows[0].code, expiresAt: res.rows[0].expires_at };
    const code = await generateTrialCode();
    return { code, expiresAt: new Date(Date.now() + 7*86400000).toISOString() };
  } catch { return null; }
}

async function seedAccessCodes() {
  const ffCodes = [
    { code: "CLVR-FF-MIKE01", label: "Friends & Family — Mike #1" },
    { code: "CLVR-FF-MIKE02", label: "Friends & Family — Mike #2" },
    { code: "CLVR-FF-MIKE03", label: "Friends & Family — Mike #3" },
    { code: "CLVR-FF-MIKE04", label: "Friends & Family — Mike #4" },
    { code: "CLVR-FF-MIKE05", label: "Friends & Family — Mike #5" },
    { code: "CLVR-FF-GIFT01", label: "Friends & Family — Gift #1" },
    { code: "CLVR-FF-GIFT02", label: "Friends & Family — Gift #2" },
    { code: "CLVR-FF-GIFT03", label: "Friends & Family — Gift #3" },
    { code: "CLVR-FF-GIFT04", label: "Friends & Family — Gift #4" },
    { code: "CLVR-FF-GIFT05", label: "Friends & Family — Gift #5" },
    { code: "CLVR-VIP-FAMILY1", label: "Family VIP #1" },
    { code: "CLVR-VIP-FAMILY2", label: "Family VIP #2" },
    { code: "CLVR-VIP-FAMILY3", label: "Family VIP #3" },
    { code: "CLVR-VIP-FRIEND1", label: "Friend VIP #1" },
    { code: "CLVR-VIP-FRIEND2", label: "Friend VIP #2" },
    { code: "CLVR-VIP-FRIEND3", label: "Friend VIP #3" },
    { code: "CLVR-VIP-FRIEND4", label: "Friend VIP #4" },
    { code: "CLVR-VIP-FRIEND5", label: "Friend VIP #5" },
    { code: "CLVR-VIP-YANN", label: "VIP — Yann" },
    { code: "CLVR-VIP-DAHLYN", label: "VIP — Dahlyn" },
    { code: "CLVR-VIP-NANCY", label: "VIP — Nancy" },
  ];
  try {
    for (const c of ffCodes) {
      const isFF = c.code.startsWith("CLVR-FF-");
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + (isFF ? 1 : 3));
      await pool.query(
        `INSERT INTO access_codes (code, label, type, active, expires_at)
         VALUES ($1, $2, 'vip', true, $3)
         ON CONFLICT (code) DO NOTHING`,
        [c.code, c.label, expiresAt]
      );
    }
    // VIP group code — unlimited uses, shared by a group (max_uses = -1 means unlimited)
    const groupExpiry = new Date();
    groupExpiry.setMonth(groupExpiry.getMonth() + 1);
    await pool.query(
      `INSERT INTO access_codes (code, label, type, active, expires_at, max_uses)
       VALUES ('CLVR-VIP-GROUP2026', 'Group VIP — Shared Code (1 month)', 'vip', true, $1, -1)
       ON CONFLICT (code) DO UPDATE SET active = true, expires_at = $1`,
      [groupExpiry]
    );
    // Ensure an initial trial code exists
    await getCurrentTrialCode();
    console.log(`[seed] Access codes seeded (${ffCodes.length + 1} codes + group VIP + trial)`);
  } catch (err: any) {
    console.error("[seed] Access code seeding failed:", err.message);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await seedAccessCodes();
  startStockRefreshLoop();
  startHyperliquidRefreshLoop();
  // Delay WS startup by 5s to let server settle and avoid 429 on rapid restarts
  setTimeout(startFinnhubWebSocket, 5000);

  app.get("/api/stream", (req, res) => {
    if (sseClients.size >= 50) {
      return res.status(503).json({ error: "Too many stream connections" });
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const status = { wsConnected: fhWsConnected };
    res.write(`data: ${JSON.stringify(status)}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); }
      catch { sseClients.delete(res); clearInterval(heartbeat); }
    }, 15000);
    req.on("close", () => { sseClients.delete(res); clearInterval(heartbeat); });
  });

  app.get("/api/crypto", async (_req, res) => {
    const cached = cache["crypto"];
    if (cached && Date.now() - cached.ts < 1500) {
      return res.json(cached.data);
    }
    try {
      const result = await fetchBinancePrices();
      cache["crypto"] = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      if (cached) return res.json(cached.data);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/perps", async (_req, res) => {
    const result: Record<string, any> = {};
    for (const sym of CRYPTO_SYMS) {
      const hl = hlData[sym];
      if (hl && hl.perpPrice > 0) {
        const base = CRYPTO_BASE[sym];
        result[sym] = {
          price: hl.perpPrice,
          chg: base ? +((hl.perpPrice - base) / base * 100).toFixed(2) : 0,
          funding: hl.funding,
          oi: hl.oi,
          volume: hl.volume,
          live: true,
        };
      } else {
        result[sym] = { price: CRYPTO_BASE[sym], chg: 0, funding: 0, oi: 0, volume: 0, live: false };
      }
    }
    res.json(result);
  });

  const POLY_MARKETS = [
    { id:"fed-cut-march",   cat:"macro",   label:"Fed cuts rates in March?",          slug:"will-the-fed-cut-rates-at-the-march-2025-meeting",    assets:["BTC","ETH","XAU","EURUSD"] },
    { id:"fed-cut-may",     cat:"macro",   label:"Fed cuts rates in May?",             slug:"will-the-fed-cut-rates-at-the-may-2025-meeting",      assets:["BTC","ETH","XAU"] },
    { id:"fed-cut-june",    cat:"macro",   label:"Fed cuts by June 2025?",             slug:"will-the-federal-reserve-cut-rates-by-june-2025",    assets:["BTC","XAU","EURUSD"] },
    { id:"cpi-below-3",     cat:"macro",   label:"CPI below 3% in March?",             slug:"will-us-cpi-be-below-3-percent-in-march-2025",       assets:["BTC","XAU","EURUSD"] },
    { id:"pce-soft",        cat:"macro",   label:"PCE below 2.5% in March?",           slug:"will-us-pce-be-below-25-in-march-2025",              assets:["BTC","ETH","SOL"] },
    { id:"recession-2025",  cat:"macro",   label:"US recession in 2025?",              slug:"us-recession-in-2025",                               assets:["XAU","BTC","USDJPY"] },
    { id:"btc-100k",        cat:"crypto",  label:"BTC hits $100k before June?",        slug:"will-bitcoin-reach-100000-before-june-2025",         assets:["BTC"] },
    { id:"btc-150k",        cat:"crypto",  label:"BTC hits $150k in 2025?",            slug:"will-bitcoin-reach-150000-in-2025",                  assets:["BTC"] },
    { id:"eth-5k",          cat:"crypto",  label:"ETH hits $5k in 2025?",              slug:"will-ethereum-reach-5000-in-2025",                   assets:["ETH"] },
    { id:"eth-3k",          cat:"crypto",  label:"ETH hits $3k before June?",          slug:"will-ethereum-reach-3000-before-june-2025",          assets:["ETH"] },
    { id:"sol-200",         cat:"crypto",  label:"SOL hits $200 in 2025?",             slug:"will-solana-reach-200-in-2025",                      assets:["SOL"] },
    { id:"btc-strategic",   cat:"crypto",  label:"US strategic BTC reserve?",          slug:"will-us-establish-a-strategic-bitcoin-reserve",      assets:["BTC","ETH"] },
    { id:"trump-tariff-90", cat:"trump",   label:"Trump pauses all tariffs?",          slug:"will-trump-pause-all-tariffs-90-days",               assets:["BTC","XAU","EURUSD"] },
    { id:"trump-crypto-eo", cat:"trump",   label:"Trump signs crypto EO in 2025?",     slug:"will-trump-sign-crypto-executive-order-2025",        assets:["BTC","ETH","SOL"] },
    { id:"trump-china",     cat:"trump",   label:"US-China trade deal in 2025?",       slug:"us-china-trade-deal-2025",                           assets:["BTC","XAU","USDCAD"] },
    { id:"doge-budget",     cat:"trump",   label:"DOGE cuts $1T from budget?",         slug:"will-doge-cut-1-trillion-from-federal-budget-2025",  assets:["XAU","BTC"] },
    { id:"dollar-collapse", cat:"trump",   label:"DXY drops 10%+ in 2025?",            slug:"will-the-dollar-index-drop-10-percent-2025",         assets:["XAU","BTC","EURUSD"] },
  ];

  // ── Twitter/X Social Intelligence ────────────────────────────────────────
  app.get("/api/twitter", async (_req, res) => {
    try {
      const { getTwitterData } = await import("./twitter");
      const data = await getTwitterData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message, hasKey: false });
    }
  });

  app.get("/api/polymarket", async (_req, res) => {
    const cached = cache["polymarket"];
    if (cached && Date.now() - cached.ts < 60000) {
      return res.json(cached.data);
    }
    const results: Record<string, any> = {};
    const fetches = POLY_MARKETS.map(async (m) => {
      try {
        const r = await fetch(
          `https://gamma-api.polymarket.com/markets?slug=${m.slug}&limit=1`,
          { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return;
        const d: any = await r.json();
        const market = Array.isArray(d) ? d[0] : d?.markets?.[0];
        if (!market) return;
        const prices = market.outcomePrices ? JSON.parse(market.outcomePrices) : null;
        const yes = prices ? Math.round(parseFloat(prices[0]) * 100) : null;
        if (yes !== null) {
          results[m.id] = { yes, live: true, cat: m.cat, label: m.label, assets: m.assets };
        }
      } catch {}
    });
    await Promise.allSettled(fetches);
    cache["polymarket"] = { data: results, ts: Date.now() };
    res.json(results);
  });

  app.post("/api/solana-rpc", async (req, res) => {
    try {
      const { method, params } = req.body;
      const allowed = ["getBalance", "getTokenAccountsByOwner", "getSignaturesForAddress", "getLatestBlockhash"];
      if (!allowed.includes(method)) return res.status(400).json({ error: "Method not allowed" });
      const rpcRes = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const data = await rpcRes.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/signals", (_req, res) => {
    const since = parseInt(_req.query.since as string) || 0;
    const filtered = since ? liveSignals.filter(s => s.ts > since) : liveSignals;
    let globalRiskOn = 50;
    const allSyms = Object.keys(priceHistory);
    let upCount = 0, totalCount = 0;
    for (const s of allSyms) {
      const h = priceHistory[s];
      if (!h || h.length < 5) continue;
      totalCount++;
      if (h[h.length - 1].price > h[Math.max(0, h.length - 5)].price) upCount++;
    }
    if (totalCount > 0) globalRiskOn = Math.round((upCount / totalCount) * 100);
    res.json({
      signals: filtered,
      tracking: Object.keys(priceHistory).length,
      historyDepth: Object.values(priceHistory).reduce((sum, h) => sum + h.length, 0),
      globalRiskOn,
      whaleAlerts: whaleAlerts.filter(w => Date.now() - w.ts < 600000),
    });
  });

  app.get("/api/whales", (_req, res) => {
    res.json({ whales: whaleAlerts.filter(w => Date.now() - w.ts < 600000) });
  });

  app.get("/api/regime", (_req, res) => {
    if (regimeCache && Date.now() - regimeCache.ts < 30000) {
      return res.json(regimeCache.data);
    }
    const regime = calcMarketRegime();
    const crash = calcCrashProbability();
    const liquidity = calcLiquidityIndex();
    const data = { regime, crash, liquidity, ts: Date.now() };
    regimeCache = { data, ts: Date.now() };
    res.json(data);
  });

  // ── Political keyword sets for market impact classification ─────────────────
  const POLITICAL_KEYWORDS = [
    "trump","tariff","tariffs","trade war","trade deal","china","sanctions","executive order",
    "white house","fed rate","powell","federal reserve","rate cut","rate hike","interest rate",
    "congress","senate","treasury","dollar","oil","opec","embargo","deregulation","stimulus",
    "crypto regulation","sec","gensler","bitcoin reserve","strategic reserve","deficit","debt ceiling",
  ];
  const BEARISH_POLITICAL = ["tariff","tariffs","sanction","sanctions","rate hike","ban","crackdown","trade war","restrict","embargo","aggressive fed"];
  const BULLISH_POLITICAL = ["rate cut","stimulus","deregulation","pro-crypto","bitcoin reserve","strategic reserve","executive order","adoption","dovish","deal signed","trade deal"];

  function classifyPolitical(text: string): { isPolitical: boolean; marketImpact: "bullish"|"bearish"|"neutral" } {
    const lower = text.toLowerCase();
    const isPolitical = POLITICAL_KEYWORDS.some(k => lower.includes(k));
    if (!isPolitical) return { isPolitical: false, marketImpact: "neutral" };
    const isBullish = BULLISH_POLITICAL.some(k => lower.includes(k));
    const isBearish = BEARISH_POLITICAL.some(k => lower.includes(k));
    const marketImpact = isBullish && !isBearish ? "bullish" : isBearish && !isBullish ? "bearish" : "neutral";
    return { isPolitical: true, marketImpact };
  }

  app.get("/api/news", async (_req, res) => {
    const cached = cache["news"];
    if (cached && Date.now() - cached.ts < 60000) {
      return res.json(cached.data);
    }
    const results: any[] = [];
    const TRACKED = [...CRYPTO_SYMS, ...EQUITY_SYMS, "XAU", "XAG", "GOLD", "SILVER", "OIL", "USD", "EUR", "JPY", "GBP"];
    const matchAssets = (text: string) => {
      const upper = text.toUpperCase();
      return TRACKED.filter(s => {
        if (s.length <= 2) return false;
        return upper.includes(s) || upper.includes("$" + s);
      }).slice(0, 5);
    };
    try {
      const r = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular", {
        headers: { "Accept": "application/json", "User-Agent": "CLVRQuant/2.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data: any = await r.json();
        const rawData = data?.Data;
        const posts = Array.isArray(rawData) ? rawData : [];
        for (const p of posts.slice(0, 20)) {
          const cats = (p.categories || "").split("|").map((c: string) => c.trim()).filter(Boolean);
          const assets = matchAssets(p.title + " " + (p.tags || "") + " " + cats.join(" "));
          const upvotes = parseInt(p.upvotes) || 0;
          const downvotes = parseInt(p.downvotes) || 0;
          const sentiment = upvotes + downvotes > 0 ? (upvotes - downvotes) / (upvotes + downvotes) : 0;
          results.push({
            id: "cc-" + p.id,
            source: p.source_info?.name || p.source || "CryptoCompare",
            icon: "N",
            color: "blue",
            title: p.title,
            body: p.body || "",
            sentiment,
            score: Math.min(10, Math.max(1, Math.round(upvotes / 2) + 3)),
            assets,
            categories: cats,
            ts: (p.published_on || Math.floor(Date.now() / 1000)) * 1000,
            url: p.url || "#",
            imageUrl: p.imageurl || null,
          });
        }
      }
    } catch (e: any) {
      console.error("CryptoCompare news error:", e.message);
    }
    const CPANIC_KEY = process.env.CRYPTOPANIC_API_KEY || "";
    if (CPANIC_KEY) {
      try {
        const r = await fetch(`https://cryptopanic.com/api/v1/posts/?auth_token=${CPANIC_KEY}&public=true&filter=hot`, {
          headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; CLVRQuant/2.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const ct = r.headers.get("content-type") || "";
          if (ct.includes("json")) {
            const data: any = await r.json();
            const posts = Array.isArray(data?.results) ? data.results : [];
            for (const p of posts.slice(0, 10)) {
              const currencies = (p.currencies || []).map((c: any) => c.code).filter(Boolean);
              const votes = p.votes || {};
              const pos = (votes.positive || 0) + (votes.important || 0) + (votes.liked || 0);
              const neg = (votes.negative || 0) + (votes.disliked || 0) + (votes.toxic || 0);
              const sentiment = pos + neg > 0 ? (pos - neg) / (pos + neg) : 0;
              const titleLower = (p.title || "").toLowerCase();
              const isWhale = titleLower.includes("whale") || titleLower.includes("transferred") || titleLower.includes("moved") && (titleLower.includes("million") || titleLower.includes("$"));
              const newsAssets = currencies.length > 0 ? currencies : matchAssets(p.title);
              if (isWhale && newsAssets.length > 0) {
                for (const a of newsAssets) {
                  if (CRYPTO_SYMS.includes(a) && !whaleAlerts.find(w => w.sym === a && Date.now() - w.ts < 300000)) {
                    whaleAlerts.push({ sym: a, ts: Date.now(), type: "transfer", amount: p.title.match(/\$[\d,.]+[MBK]?/)?.[0] || "large" });
                    if (whaleAlerts.length > 100) whaleAlerts.splice(0, whaleAlerts.length - 50);
                    console.log(`[WHALE] ${a} whale activity detected: ${p.title.substring(0, 80)}`);
                  }
                }
              }
              results.push({
                id: "cp-" + p.id,
                source: p.source?.title || "CryptoPanic",
                icon: "CP",
                color: "cyan",
                title: p.title,
                body: "",
                sentiment,
                score: Math.min(10, Math.max(1, pos + 3)),
                assets: newsAssets,
                categories: [p.kind || "news"],
                ts: new Date(p.published_at || Date.now()).getTime(),
                url: p.url || "#",
                imageUrl: null,
              });
            }
          }
        }
      } catch (e: any) {
        console.error("CryptoPanic news error:", e.message);
      }
    }
    // ── Stocktwits social posts → inject into news feed for SOCIAL filter ──
    try {
      const { getTwitterData } = await import("./twitter");
      const twData = await getTwitterData();
      if (twData && !twData.error) {
        // Pull top posts from each ticker's Stocktwits feed
        const seen = new Set<string>();
        const allPosts: any[] = [];
        for (const sym of Object.values(twData.mentions || {})) {
          const m = sym as any;
          for (const post of (m.topPosts || [])) {
            if (post.text && !seen.has(post.text.slice(0, 60))) {
              seen.add(post.text.slice(0, 60));
              allPosts.push({ ...post, ticker: m.ticker });
            }
          }
        }
        // Also pull breaking posts
        for (const post of (twData.breaking || [])) {
          if (post.text && !seen.has(post.text.slice(0, 60))) {
            seen.add(post.text.slice(0, 60));
            allPosts.push({ ...post, ticker: post.assets?.[0] || "SOCIAL" });
          }
        }
        allPosts.sort((a, b) => b.likes - a.likes);
        for (const post of allPosts.slice(0, 12)) {
          const sentNum = post.sentiment === "bullish" ? 0.6 : post.sentiment === "bearish" ? -0.6 : 0;
          const { isPolitical, marketImpact } = classifyPolitical(post.text);
          results.push({
            id:          "st-" + (post.id || Math.random().toString(36).slice(2)),
            source:      `@${post.handle} (Stocktwits)`,
            icon:        "ST",
            color:       "cyan",
            title:       post.text.slice(0, 220),
            body:        "",
            sentiment:   sentNum,
            score:       Math.min(10, 4 + Math.round(post.likes / 10)),
            assets:      post.ticker ? [post.ticker.replace("$", "")] : [],
            categories:  ["twitter", "social", ...(isPolitical ? ["political"] : [])],
            political:   isPolitical,
            marketImpact: isPolitical ? marketImpact : null,
            ts:          post.createdAt ? new Date(post.createdAt).getTime() : Date.now() - 600_000,
            url:         post.url || "#",
            imageUrl:    null,
          });
        }
      }
    } catch (e: any) {
      console.warn("[news] Stocktwits inject error:", e.message);
    }

    // ── Geopolitical/Conflict RSS feeds ─────────────────────────────────────
    const CONFLICT_RSS = [
      "https://feeds.reuters.com/reuters/worldnews",
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://rss.dw.com/xml/rss-en-world",
    ];
    const CONFLICT_KEYWORDS = [
      "war","military","troops","missile","nuclear","airstrike","air strike","bombing","bomb","attack","combat",
      "invasion","invade","offensive","casualties","rebels","conflict","ceasefire","cease-fire","battle","siege",
      "sanctions","sanction","blockade","embargo","chokepoint","strait","pipeline","oil supply","supply chain disruption",
      "coup","uprising","emergency","martial law","escalation","escalate",
      "ukraine","russia","taiwan","iran","north korea","middle east","red sea","suez","hormuz","black sea",
      "gaza","hamas","hezbollah","nato","warship","fighter jet","drone strike","ballistic",
      "central bank emergency","rate emergency","financial crisis","bank collapse",
    ];
    function isConflictItem(title: string, body = ""): boolean {
      const text = (title + " " + body).toLowerCase();
      return CONFLICT_KEYWORDS.some(kw => text.includes(kw));
    }
    function parseRSSXML(xml: string): Array<{title:string,link:string,pubDate:string,description:string}> {
      const items: any[] = [];
      const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      for (const block of itemMatches) {
        const get = (tag: string) => {
          const m = block.match(new RegExp(`<${tag}[^>]*>\\s*(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`, "i"));
          return m ? m[1].trim() : "";
        };
        items.push({ title: get("title"), link: get("link"), pubDate: get("pubDate"), description: get("description") });
      }
      return items;
    }
    const conflictFetchPromises = CONFLICT_RSS.map(rssUrl =>
      fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CLVRQuant/2.0)", "Accept": "application/rss+xml, text/xml, */*" },
        signal: AbortSignal.timeout(7000),
      }).then(r => r.ok ? r.text() : "").catch(() => "").then(text => ({ rssUrl, text }))
    );
    const conflictTexts = await Promise.all(conflictFetchPromises);
    for (const { rssUrl, text: xml } of conflictTexts) {
      if (!xml) continue;
      const rssItems = parseRSSXML(xml);
      for (const item of rssItems.slice(0, 15)) {
        if (!item.title) continue;
        if (!isConflictItem(item.title, item.description)) continue;
        const titleLow = item.title.toLowerCase();
        const oilRelated = ["oil","opec","petroleum","energy","pipeline","refinery","strait","hormuz","red sea"].some(k => titleLow.includes(k));
        const goldRelated = ["gold","haven","safe","treasury","bond"].some(k => titleLow.includes(k));
        const assets = [
          ...(oilRelated ? ["WTI","BRENT"] : []),
          ...(goldRelated ? ["XAU"] : []),
          "CONFLICT",
        ];
        results.push({
          id: "geo-" + Buffer.from(item.title.slice(0, 60)).toString("base64").slice(0, 16),
          source: rssUrl.includes("reuters") ? "Reuters" : rssUrl.includes("bbc") ? "BBC" : "DW World",
          icon: "🌐",
          color: "orange",
          title: item.title,
          body: item.description?.replace(/<[^>]+>/g, "").slice(0, 200) || "",
          sentiment: -0.3,
          score: 8,
          assets,
          categories: ["conflict", "geopolitical"],
          political: true,
          isConflict: true,
          marketImpact: "bearish",
          ts: item.pubDate ? new Date(item.pubDate).getTime() : Date.now() - 3600_000,
          url: item.link || "#",
          imageUrl: null,
        });
      }
    }

    // Apply political classification to all non-twitter news items
    for (const item of results) {
      if (!item.political) {
        const { isPolitical, marketImpact } = classifyPolitical(item.title);
        if (isPolitical) {
          item.political = true;
          item.marketImpact = marketImpact;
          if (!item.categories.includes("political")) item.categories.push("political");
        }
      }
      // Conflict classification
      if (!item.isConflict && isConflictItem(item.title, item.body || "")) {
        item.isConflict = true;
        if (!item.categories.includes("conflict")) item.categories.push("conflict");
      }
    }

    results.sort((a, b) => b.ts - a.ts);
    const deduped = results.filter((item, index, self) =>
      index === self.findIndex(t => t.title === item.title)
    ).slice(0, 60);
    cache["news"] = { data: deduped, ts: Date.now() };
    res.json(deduped);
  });

  // ── INSIDER TRADING FEED ────────────────────────────────────────────────────
  app.get("/api/insider/status", (_req, res) => {
    res.json(getInsiderScanStatus());
  });

  app.get("/api/insider", async (_req, res) => {
    try {
      const data = await fetchInsiderData();
      const status = getInsiderScanStatus();
      res.json({
        trades: data,
        loading: data.length === 0 && status.scanning,
        scanning: status.scanning,
        scanPhase: status.phase,
        scanDone: status.done,
        scanTotal: status.total,
        fetchedAt: Date.now(),
      });
    } catch (e: any) {
      console.error("[insider] route error:", e.message);
      res.status(500).json({ trades: [], loading: false, fetchedAt: Date.now(), error: e.message });
    }
  });

  app.get("/api/finnhub", async (_req, res) => {
    const cached = cache["finnhub"];
    if (cached) {
      return res.json(cached.data);
    }
    if (!finnhubFetchLock) {
      finnhubFetchLock = (async () => {
        try {
          const [metals, forex] = await Promise.all([fetchMetals(), fetchForex()]);
          const stocks: Record<string, any> = {};
          EQUITY_SYMS.forEach(sym => { stocks[sym] = { price: EQUITY_BASE[sym], chg: 0, live: false }; });
          const result = { stocks, metals, forex };
          cache["finnhub"] = { data: result, ts: Date.now() };
          return result;
        } catch { return null; } finally { finnhubFetchLock = null; }
      })();
    }
    const earlyResult = await finnhubFetchLock;
    if (earlyResult) return res.json(earlyResult);
    const stocks: Record<string, any> = {};
    EQUITY_SYMS.forEach(sym => { stocks[sym] = { price: EQUITY_BASE[sym], chg: 0, live: false }; });
    const metals: Record<string, any> = {};
    Object.keys(METALS_BASE).forEach(sym => { metals[sym] = { price: METALS_BASE[sym], chg: 0, live: false }; });
    const forex: Record<string, any> = {};
    Object.entries(FOREX_BASE).forEach(([sym, price]) => { forex[sym] = { price, chg: 0, live: false }; });
    res.json({ stocks, metals, forex });
  });

  // ── /api/basket-prices — live prices for ALL 140+ basket assets ─────────────
  // Pattern: always serve from cache instantly; refresh in background every 5 min
  const COINGECKO_IDS: Record<string, string> = {
    BTC:"bitcoin",ETH:"ethereum",SOL:"solana",XRP:"ripple",DOGE:"dogecoin",
    AVAX:"avalanche-2",LINK:"chainlink",BNB:"binancecoin",ADA:"cardano",
    SUI:"sui",DOT:"polkadot",HYPE:"hyperliquid",
  };
  const BASKET_EQUITIES_US = [
    "AAPL","NVDA","MSFT","GOOGL","AMZN","META","TSLA","MSTR","AMD","PLTR",
    "COIN","NFLX","JPM","V","XOM","WMT","BAC","UNH","DIS","CRM",
    "RY","TD","CNQ","SU","BCE",
    "ASML","SAP","AZN","NVO","SHEL","TTE","BP","SIEGY","TCEHY",
    "TSM","BABA","PDD","JD","INFY",
  ];
  const BASKET_INTL_FH: Record<string, { fhTick: string; currency: string }> = {
    NESN:{fhTick:"NESN.SW",currency:"CHF"},LVMH:{fhTick:"MC.PA",currency:"EUR"},
    HSBA:{fhTick:"HSBA.L",currency:"GBP"},ULVR:{fhTick:"ULVR.L",currency:"GBP"},
    "2222.SR":{fhTick:"2222.SR",currency:"SAR"},"2010.SR":{fhTick:"2010.SR",currency:"SAR"},
    QNBK:{fhTick:"QNBK.QA",currency:"QAR"},EMIRATESNBD:{fhTick:"ENBD.DU",currency:"AED"},
    ADNOCDIST:{fhTick:"ADNOCDIST.AD",currency:"AED"},ETISALAT:{fhTick:"ETISALAT.AD",currency:"AED"},
    "005930":{fhTick:"005930.KS",currency:"KRW"},"9984.T":{fhTick:"9984.T",currency:"JPY"},
    "7203.T":{fhTick:"7203.T",currency:"JPY"},"7974.T":{fhTick:"7974.T",currency:"JPY"},
    "0700.HK":{fhTick:"0700.HK",currency:"HKD"},RELIANCE:{fhTick:"RELIANCE.NS",currency:"INR"},
  };
  const BASKET_COMMODITIES: Record<string, { metalsKey?: string; etfSym?: string; base: number }> = {
    XAU:{metalsKey:"XAU",base:3100},XAG:{metalsKey:"XAG",base:35},
    PLATINUM:{metalsKey:"PLATINUM",base:920},PALLADIUM:{metalsKey:"PALLADIUM",base:1000},
    COPPER:{metalsKey:"COPPER",base:5.8},WTI:{metalsKey:"WTI",base:70},
    BRENT:{metalsKey:"BRENT",base:72},NATGAS:{metalsKey:"NATGAS",base:4},
    WHEAT:{etfSym:"WEAT",base:5.8},CORN:{etfSym:"CORN",base:22},
    SOYBEANS:{etfSym:"SOYB",base:24},COFFEE:{etfSym:"JO",base:45},
    SUGAR:{etfSym:"SGG",base:35},URANIUM:{etfSym:"URA",base:28},
    DUBAI:{etfSym:"BNO",base:35},LNG:{etfSym:"UNG",base:10},
  };

  // Seed initial basket price cache with base prices so first request is instant
  (function seedBasketCache() {
    const init: Record<string, any> = {};
    for (const sym of Object.keys(COINGECKO_IDS)) init[sym] = { price: CRYPTO_BASE[sym] || 0, chg: 0, currency: "USD", live: false };
    for (const sym of BASKET_EQUITIES_US) init[sym] = { price: EQUITY_BASE[sym] || 0, chg: 0, currency: "USD", live: false };
    for (const [sym, { currency }] of Object.entries(BASKET_INTL_FH)) init[sym] = { price: 0, chg: 0, currency, live: false };
    for (const [sym, { base }] of Object.entries(BASKET_COMMODITIES)) init[sym] = { price: base, chg: 0, currency: "USD", live: false };
    cache["basketPricesAll"] = { data: init, ts: 0 }; // ts=0 forces refresh on first request
  })();

  let basketRefreshRunning = false;
  async function refreshBasketPrices() {
    if (basketRefreshRunning) return;
    basketRefreshRunning = true;
    const results: Record<string, any> = { ...(cache["basketPricesAll"]?.data || {}) };

    try {
      // 1. Crypto: CoinGecko batch (single fast call)
      try {
        const ids = Object.values(COINGECKO_IDS).join(",");
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (r.ok) {
          const data: any = await r.json();
          for (const [appSym, geckoId] of Object.entries(COINGECKO_IDS)) {
            const d = (data as any)[geckoId];
            if (d?.usd) results[appSym] = { price: d.usd, chg: d.usd_24h_change ?? 0, currency: "USD", live: true };
          }
        }
      } catch (e: any) { console.warn("[basket] CoinGecko:", e.message); }

      // 2. US equities: use livePrices + finnhub cache (no extra API calls needed)
      const fhCached = cache["finnhub"]?.data;
      for (const sym of BASKET_EQUITIES_US) {
        const lp = livePrices[sym];
        if (lp?.price && lp.price > 0) {
          results[sym] = { price: lp.price, chg: lp.chg, currency: "USD", live: true };
        } else {
          const cs = fhCached?.stocks?.[sym];
          if (cs?.price && cs.price > 0) results[sym] = { price: cs.price, chg: cs.chg ?? 0, currency: "USD", live: cs.live ?? false };
        }
      }

      // 3. International equities: parallel Finnhub calls (4 concurrent max)
      if (FINNHUB_KEY) {
        const intlEntries = Object.entries(BASKET_INTL_FH).filter(([sym]) => !(results[sym]?.live));
        const CONCURRENCY = 4;
        for (let i = 0; i < intlEntries.length; i += CONCURRENCY) {
          const batch = intlEntries.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(async ([appSym, { fhTick, currency }]) => {
            try {
              const q = await fhQuoteSafe(fhTick);
              if (q.price > 0) results[appSym] = { price: q.price, chg: q.chg, currency, live: q.live };
            } catch {}
          }));
          await new Promise(r => setTimeout(r, 1200)); // stay under 60/min
        }
      }

      // 4. Commodities: metals cache + livePrices for ETFs
      const metalCache = fhCached?.metals || {};
      for (const [appSym, { metalsKey, etfSym, base }] of Object.entries(BASKET_COMMODITIES)) {
        if (metalsKey && metalCache[metalsKey]?.price) {
          const m = metalCache[metalsKey];
          results[appSym] = { price: m.price, chg: m.chg ?? 0, currency: "USD", live: m.live ?? false };
        } else if (etfSym) {
          const lp = livePrices[etfSym];
          if (lp?.price && lp.price > 0) {
            results[appSym] = { price: lp.price, chg: lp.chg, currency: "USD", live: true };
          } else if (FINNHUB_KEY) {
            try {
              const q = await fhQuoteSafe(etfSym);
              if (q.price > 0) results[appSym] = { price: q.price, chg: q.chg, currency: "USD", live: q.live };
            } catch {}
          }
          if (!results[appSym] || !results[appSym].price) results[appSym] = { price: base, chg: 0, currency: "USD", live: false };
        }
      }
    } finally {
      cache["basketPricesAll"] = { data: results, ts: Date.now() };
      const liveCount = Object.values(results).filter((r: any) => r.live).length;
      console.log(`[basket-prices] refresh complete: ${Object.keys(results).length} symbols, ${liveCount} live`);
      basketRefreshRunning = false;
    }
  }

  // Kick off first refresh after 3s (let other data sources warm up first)
  setTimeout(refreshBasketPrices, 3000);
  setInterval(refreshBasketPrices, BASKET_PRICE_TTL);

  // Start EDGAR insider scan in background (non-blocking; takes ~60-90s to populate)
  startInsiderRefresh();

  app.get("/api/basket-prices", (_req, res) => {
    const cached = cache["basketPricesAll"];
    if (!cached) return res.json({});
    // Trigger background refresh if stale (non-blocking)
    if (Date.now() - cached.ts > BASKET_PRICE_TTL) {
      refreshBasketPrices().catch(() => {});
    }
    res.json(cached.data);
  });

  // ── Yahoo Finance quote fetcher (global stocks, no API key) ─────────────────
  async function fetchYahooQuote(rawTicker: string): Promise<{ ticker: string; price: number; currency: string; name: string; change: number; changePct: number; exchange: string } | { error: string }> {
    // Normalise exchange suffixes: "FLT CN" → "FLT.TO", "VOD LN" → "VOD.L", etc.
    const exchangeMap: Record<string, string> = {
      "CN": ".TO", "CA": ".TO", "LN": ".L", "L": ".L",
      "PA": ".PA", "FP": ".PA", "GR": ".DE", "XE": ".DE",
      "HK": ".HK", "JP": ".T", "AU": ".AX", "AT": ".AX",
      "SS": ".SS", "SZ": ".SZ", "SI": ".SI", "MI": ".MI",
      "AX": ".AX", "TO": ".TO", "V": ".V",
    };
    let ticker = rawTicker.trim().toUpperCase();
    // Handle "SYM EXCHANGE" format (e.g. "FLT CN" or "VOD LN")
    const parts = ticker.split(/\s+/);
    if (parts.length === 2) {
      const suffix = exchangeMap[parts[1]];
      ticker = suffix ? parts[0] + suffix : parts[0];
    }
    // Remove any "EQUITY" / "CORP" Bloomberg suffixes
    ticker = ticker.replace(/\s+(EQUITY|CORP|LTD)$/i, "").trim();

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
      if (!r.ok) return { error: `Yahoo Finance returned ${r.status} for ${ticker}` };
      const data: any = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return { error: `No price data found for ${ticker}` };
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || meta.previousClose || price;
      const change = price - prev;
      const changePct = prev > 0 ? (change / prev) * 100 : 0;
      return {
        ticker,
        price,
        currency: meta.currency || "USD",
        name: meta.shortName || meta.longName || ticker,
        change: parseFloat(change.toFixed(4)),
        changePct: parseFloat(changePct.toFixed(2)),
        exchange: meta.fullExchangeName || meta.exchangeName || "",
      };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  // Tool definitions for Claude tool use
  const AI_TOOLS = [
    {
      name: "get_market_quote",
      description: "Fetch the current real-time price, change, and basic info for ANY global stock, ETF, index, or asset using its ticker symbol. Supports US equities (AAPL, NVDA), Canadian stocks (FLT CN → FLT.TO), UK stocks (VOD LN → VOD.L), European, Asian, and Australian listings. Use this whenever the user asks about an asset whose price isn't in the system data feed.",
      input_schema: {
        type: "object",
        properties: {
          ticker: {
            type: "string",
            description: "The ticker symbol, optionally with exchange code. Examples: 'FLT CN', 'VOD LN', 'SHOP', 'AAPL', 'BMW GR', 'BHP AT', 'FLT.TO'. Pass exactly as the user gave it."
          }
        },
        required: ["ticker"]
      }
    }
  ];

  // ── Quant Engine: indicator computation + Claude structured analysis ──────────
  const QUANT_RISK_PROFILES: Record<string, { label:string; slMultiplier:number; leverage:[number,number]; riskPct:number; minWinProb:number; tpRatios:[number,number]; holdHorizon:string }> = {
    low:  { label:"CONSERVATIVE", slMultiplier:2.5, leverage:[1,3],   riskPct:1, minWinProb:85, tpRatios:[2.0,4.0], holdHorizon:"swing trade — 2 to 7 days" },
    mid:  { label:"BALANCED",     slMultiplier:1.8, leverage:[3,7],   riskPct:2, minWinProb:80, tpRatios:[1.5,3.0], holdHorizon:"intraday to short swing — 4 hours to 3 days" },
    high: { label:"AGGRESSIVE",   slMultiplier:1.2, leverage:[5,15],  riskPct:4, minWinProb:75, tpRatios:[1.2,2.5], holdHorizon:"scalp to intraday — 15 minutes to 8 hours" },
  };
  const QUANT_TIMEFRAMES: Record<string, { label:string; interval:string; count:number; binanceInterval:string }> = {
    today: { label:"Today",     interval:"15m", count:200, binanceInterval:"15m" },
    mid:   { label:"Mid-Term",  interval:"4h",  count:300, binanceInterval:"4h"  },
    long:  { label:"Long-Term", interval:"1d",  count:200, binanceInterval:"1d"  },
  };
  const BINANCE_SYMBOLS: Record<string, string> = {
    BTC:"BTCUSDT", ETH:"ETHUSDT", SOL:"SOLUSDT", AVAX:"AVAXUSDT",
    ARB:"ARBUSDT", WIF:"WIFUSDT", DOGE:"DOGEUSDT", PEPE:"PEPEUSDT",
    SUI:"SUIUSDT", LINK:"LINKUSDT", XRP:"XRPUSDT", ADA:"ADAUSDT",
    HYPE:"HYPEUSDT", TRUMP:"TRUMPUSDT",
  };
  function quantIntervalToMs(interval: string): number {
    const map: Record<string,number> = { "1m":60000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000 };
    return map[interval] || 3600000;
  }
  async function fetchHLCandlesQuant(ticker: string, interval: string, count: number) {
    try {
      const endTime = Date.now();
      const startTime = endTime - (count * quantIntervalToMs(interval));
      const r = await fetch("https://api.hyperliquid.xyz/info", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ type:"candleSnapshot", req:{ coin:ticker, interval, startTime, endTime } }),
      });
      const data: any = await r.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data.map((c: any) => ({ t:parseFloat(c.t), o:parseFloat(c.o), h:parseFloat(c.h), l:parseFloat(c.l), c:parseFloat(c.c), v:parseFloat(c.v||0) }));
    } catch { return null; }
  }
  async function fetchBinanceCandlesQuant(ticker: string, interval: string, count: number) {
    const symbol = BINANCE_SYMBOLS[ticker];
    if (!symbol) return null;
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(count,1000)}`);
      const data: any = await r.json();
      if (!Array.isArray(data)) return null;
      return data.map((c: any) => ({ t:parseFloat(c[0]), o:parseFloat(c[1]), h:parseFloat(c[2]), l:parseFloat(c[3]), c:parseFloat(c[4]), v:parseFloat(c[5]) }));
    } catch { return null; }
  }
  async function fetchFinnhubCandlesQuant(ticker: string, interval: string, count: number) {
    const apiKey = process.env.FINNHUB_KEY || process.env.FINNHUB_API_KEY;
    if (!apiKey) return null;
    try {
      const resMap: Record<string,string> = { "15m":"15","1h":"60","4h":"240","1d":"D" };
      const res = resMap[interval] || "60";
      const to = Math.floor(Date.now() / 1000);
      const from = to - (count * quantIntervalToMs(interval) / 1000);
      const r = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=${res}&from=${from}&to=${to}&token=${apiKey}`);
      const data: any = await r.json();
      if (data.s !== "ok" || !data.c?.length) return null;
      return data.t.map((t: number, i: number) => ({ t:t*1000, o:parseFloat(data.o[i]), h:parseFloat(data.h[i]), l:parseFloat(data.l[i]), c:parseFloat(data.c[i]), v:parseFloat(data.v?.[i]||0) }));
    } catch { return null; }
  }
  async function fetchQuantCandles(ticker: string, assetClass: string, interval: string, count: number) {
    if (assetClass === "crypto") {
      const [hl, binance] = await Promise.all([
        fetchHLCandlesQuant(ticker, interval, count),
        fetchBinanceCandlesQuant(ticker, interval, Math.min(count*2, 1000)),
      ]);
      if (hl && binance) return binance.length > hl.length ? binance : hl;
      return hl || binance;
    }
    const finnhub = await fetchFinnhubCandlesQuant(ticker, interval, count);
    if (finnhub) return finnhub;
    return fetchHLCandlesQuant(ticker, interval, count);
  }
  function computeQuantIndicators(candles: any[]) {
    if (!candles || candles.length < 50) return null;
    const closes  = candles.map((c: any) => c.c);
    const highs   = candles.map((c: any) => c.h);
    const lows    = candles.map((c: any) => c.l);
    const volumes = candles.map((c: any) => c.v);
    const n = closes.length;
    function ema(data: number[], period: number): number[] {
      if (data.length < period) return [data[data.length-1]];
      const k = 2 / (period + 1);
      let val = data.slice(0, period).reduce((a: number, b: number) => a+b, 0) / period;
      const out = [val];
      for (let i = period; i < data.length; i++) { val = data[i]*k + val*(1-k); out.push(val); }
      return out;
    }
    const ema20arr  = ema(closes, 20);
    const ema50arr  = ema(closes, 50);
    const ema200arr = ema(closes, Math.min(200, n-1));
    const ema12arr  = ema(closes, 12);
    const ema26arr  = ema(closes, 26);
    const currentEma20  = ema20arr[ema20arr.length-1];
    const currentEma50  = ema50arr[ema50arr.length-1];
    const currentEma200 = ema200arr[ema200arr.length-1];
    const currentPrice  = closes[n-1];
    let gains = 0, losses = 0;
    for (let i = n-14; i < n; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const rsi = Math.round(100 - 100 / (1 + (gains / Math.max(losses, 0.0001))));
    const macdLine   = ema12arr.slice(ema12arr.length - ema26arr.length).map((v: number, i: number) => v - ema26arr[i]);
    const signalLine = ema(macdLine, 9);
    const macd     = macdLine[macdLine.length-1];
    const macdSig  = signalLine[signalLine.length-1];
    const macdHist = macd - macdSig;
    const prevHist = macdLine[macdLine.length-2] - signalLine[signalLine.length-2];
    const trVals: number[] = [];
    for (let i = Math.max(1, n-30); i < n; i++) {
      trVals.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
    }
    const atr14  = trVals.slice(-14).reduce((a: number, b: number) => a+b, 0) / 14;
    const atrPct = (atr14 / currentPrice) * 100;
    const recent50    = candles.slice(-50);
    const recentHighs = recent50.map((c: any) => c.h).sort((a: number, b: number) => b-a);
    const recentLows  = recent50.map((c: any) => c.l).sort((a: number, b: number) => a-b);
    const resistance  = recentHighs.filter((v: number) => v > currentPrice).slice(0, 3);
    const support     = recentLows.filter((v: number) => v < currentPrice).slice(0, 3);
    const avgVol  = volumes.slice(-20).reduce((a: number, b: number) => a+b, 0) / 20;
    const lastVol = volumes[n-1];
    const volRatio = lastVol / Math.max(avgVol, 0.0001);
    const volumeSignal = volRatio>2?"SURGE":volRatio>1.3?"ABOVE AVG":volRatio<0.7?"BELOW AVG":"NORMAL";
    const trend =
      currentPrice>currentEma20 && currentEma20>currentEma50 && currentEma50>currentEma200 ? "STRONG UPTREND" :
      currentPrice<currentEma20 && currentEma20<currentEma50 && currentEma50<currentEma200 ? "STRONG DOWNTREND" :
      currentPrice>currentEma50 ? "UPTREND" : currentPrice<currentEma50 ? "DOWNTREND" : "RANGING";
    const high24 = Math.max(...candles.slice(-24).map((c: any) => c.h));
    const low24  = Math.min(...candles.slice(-24).map((c: any) => c.l));
    const high7d = Math.max(...candles.slice(-Math.min(168,n)).map((c: any) => c.h));
    const low7d  = Math.min(...candles.slice(-Math.min(168,n)).map((c: any) => c.l));
    const posInRange = Math.round((currentPrice-low24) / Math.max(high24-low24, 0.0001) * 100);
    let momentum = 50;
    if (rsi>60) momentum+=10; if (rsi<40) momentum-=10;
    if (macdHist>0 && macdHist>prevHist) momentum+=10; if (macdHist<0 && macdHist<prevHist) momentum-=10;
    if (currentPrice>currentEma20) momentum+=8; if (currentPrice<currentEma20) momentum-=8;
    if (volumeSignal==="SURGE") momentum+=5;
    momentum = Math.max(0, Math.min(100, momentum));
    return {
      currentPrice,
      ema20:currentEma20, ema50:currentEma50, ema200:currentEma200,
      priceVsEma20:((currentPrice-currentEma20)/currentEma20*100).toFixed(2),
      priceVsEma50:((currentPrice-currentEma50)/currentEma50*100).toFixed(2),
      priceVsEma200:((currentPrice-currentEma200)/currentEma200*100).toFixed(2),
      rsi, rsiLabel:rsi>70?"OVERBOUGHT":rsi>60?"BULLISH":rsi<30?"OVERSOLD":rsi<40?"BEARISH":"NEUTRAL",
      macd:parseFloat(macd.toFixed(4)), macdSignal:parseFloat(macdSig.toFixed(4)), macdHist:parseFloat(macdHist.toFixed(4)),
      macdCrossing:macdHist>0&&prevHist<=0?"BULLISH_CROSS":macdHist<0&&prevHist>=0?"BEARISH_CROSS":macdHist>0?"BULLISH":"BEARISH",
      atr14:parseFloat(atr14.toFixed(6)), atrPct:parseFloat(atrPct.toFixed(3)),
      nearestResistance:resistance[0]||null, resistanceLevels:resistance,
      nearestSupport:support[0]||null, supportLevels:support,
      volumeSignal, volumeRatio:parseFloat(volRatio.toFixed(2)),
      trend, momentumScore:momentum,
      high24, low24, high7d, low7d, posInRange,
      range24hPct:parseFloat(((high24-low24)/low24*100).toFixed(2)),
    };
  }

  function computeMultiTFConfluence(tf15m: any[] | null, tf4h: any[] | null, tf1d: any[] | null) {
    function emaOf(closes: number[], period: number): number {
      if (closes.length < period) return closes[closes.length - 1] || 0;
      const k = 2 / (period + 1);
      let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
      return val;
    }
    function getTrend(candles: any[] | null): { trend: string; ema9: number; ema21: number; bars: number } {
      if (!candles || candles.length < 21) return { trend: "NEUTRAL", ema9: 0, ema21: 0, bars: 0 };
      const closes = candles.map((c: any) => c.c);
      const ema9  = emaOf(closes, 9);
      const ema21 = emaOf(closes, 21);
      const trend = ema9 > ema21 * 1.001 ? "BULLISH" : ema9 < ema21 * 0.999 ? "BEARISH" : "NEUTRAL";
      return { trend, ema9, ema21, bars: candles.length };
    }
    const t15m = getTrend(tf15m);
    const t4h  = getTrend(tf4h);
    const t1d  = getTrend(tf1d);
    const trends = [t15m.trend, t4h.trend, t1d.trend];
    const allBull = trends.every(t => t === "BULLISH");
    const allBear = trends.every(t => t === "BEARISH");
    const twoBull = trends.filter(t => t === "BULLISH").length >= 2;
    const twoBear = trends.filter(t => t === "BEARISH").length >= 2;
    const confluent = allBull || allBear;
    const direction = allBull ? "BULLISH" : allBear ? "BEARISH" : twoBull ? "LEANING_BULL" : twoBear ? "LEANING_BEAR" : "MIXED";
    const strength  = (allBull || allBear) ? "STRONG" : (twoBull || twoBear) ? "MODERATE" : "WEAK";
    return { "15m": t15m, "4h": t4h, "1d": t1d, confluent, direction, strength };
  }

  function computeBayesianScore(ind: any, confluence: any) {
    const WEIGHTS: Record<string, number> = {
      rsi_bullish: 0.65, rsi_oversold: 0.72, macd_bull_cross: 0.72,
      ema_bull_stack: 0.68, volume_surge: 0.60, mtf_confluence_bull: 0.75,
      price_above_ema200: 0.70, rsi_bearish: 0.65, rsi_overbought: 0.72,
      macd_bear_cross: 0.72, ema_bear_stack: 0.68, mtf_confluence_bear: 0.75,
      price_below_ema200: 0.70,
    };
    const direction = ind.trend?.includes("UP") ? "bull" : ind.trend?.includes("DOWN") ? "bear" : "neutral";
    const signals: string[] = [];
    if (direction === "bull") {
      if (ind.rsi >= 50 && ind.rsi <= 70) signals.push("rsi_bullish");
      if (ind.rsi < 35)                   signals.push("rsi_oversold");
      if (ind.macdCrossing?.includes("BULL")) signals.push("macd_bull_cross");
      if (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200) signals.push("ema_bull_stack");
      if (["SURGE","ABOVE AVG"].includes(ind.volumeSignal)) signals.push("volume_surge");
      if (confluence?.direction === "BULLISH" || confluence?.direction === "LEANING_BULL") signals.push("mtf_confluence_bull");
      if (ind.currentPrice > ind.ema200)  signals.push("price_above_ema200");
    } else if (direction === "bear") {
      if (ind.rsi <= 50 && ind.rsi >= 30) signals.push("rsi_bearish");
      if (ind.rsi > 70)                   signals.push("rsi_overbought");
      if (ind.macdCrossing?.includes("BEAR")) signals.push("macd_bear_cross");
      if (ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200) signals.push("ema_bear_stack");
      if (["SURGE","ABOVE AVG"].includes(ind.volumeSignal)) signals.push("volume_surge");
      if (confluence?.direction === "BEARISH" || confluence?.direction === "LEANING_BEAR") signals.push("mtf_confluence_bear");
      if (ind.currentPrice < ind.ema200)  signals.push("price_below_ema200");
    }
    const PRIOR = 0.50;
    let pS = PRIOR, pF = 1 - PRIOR;
    for (const sig of signals) { const w = WEIGHTS[sig] || 0.55; pS *= w; pF *= (1 - w); }
    const prob = signals.length > 0 ? pS / (pS + pF) : PRIOR;
    const pct  = parseFloat((prob * 100).toFixed(1));
    const tier  = pct >= 80 ? "A" : pct >= 70 ? "B" : pct >= 60 ? "C" : "D";
    const label = tier === "A" ? "ELITE CONVICTION" : tier === "B" ? "HIGH CONVICTION" : tier === "C" ? "MODERATE" : "LOW — STAND ASIDE";
    return { probability: pct, signals_used: signals, tier, interpretation: label, direction };
  }

  function checkMacroKillSwitch(macroData: any[]) {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    for (const evt of macroData) {
      if (evt.impact !== "HIGH" && evt.impact !== "⬛") continue;
      try {
        const timeStr = (evt.timeET || evt.time || "").replace(/\s*ET\s*/i, "").trim();
        const dateStr = evt.date || "";
        if (!dateStr || !timeStr || timeStr === "All Day" || timeStr === "Tentative") continue;
        const evtDate = new Date(`${dateStr} ${timeStr} EST`);
        if (isNaN(evtDate.getTime())) continue;
        const diff = evtDate.getTime() - now;
        if (diff > -60 * 60 * 1000 && diff < FOUR_HOURS_MS) {
          const hoursAway = Math.max(0, diff / (60 * 60 * 1000));
          return {
            safe: false,
            warning: `HIGH IMPACT: ${evt.name} in ${hoursAway.toFixed(1)}h — reduce size`,
            nearest_event: { name: evt.name, time: evt.timeET || evt.time, date: evt.date, hours_away: parseFloat(hoursAway.toFixed(1)) },
          };
        }
      } catch { /* skip unparseable */ }
    }
    return { safe: true, warning: null, nearest_event: null };
  }

  app.post("/api/quant", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });
    try {
      const { ticker, marketType, userQuery, riskId, timeframeId, assetClass, twitterContext } = req.body;
      if (!ticker || !marketType || !riskId || !timeframeId) return res.status(400).json({ error: "Missing required parameters." });
      const risk = QUANT_RISK_PROFILES[riskId];
      const tf   = QUANT_TIMEFRAMES[timeframeId];
      if (!risk || !tf) return res.status(400).json({ error: "Invalid risk or timeframe." });
      const cls: string = assetClass || (["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD"].includes(ticker) ? "equity" : ["XAU","CL","SILVER","NATGAS","COPPER","BRENTOIL"].includes(ticker) ? "commodity" : "crypto");

      const [candles, candles15m, candles4h, candles1d] = await Promise.all([
        fetchQuantCandles(ticker, cls, tf.interval, tf.count),
        fetchQuantCandles(ticker, cls, "15",   50),
        fetchQuantCandles(ticker, cls, "60",   60),
        fetchQuantCandles(ticker, cls, "D",    30),
      ]);
      if (!candles) return res.status(502).json({ error: "Failed to fetch market data." });
      const ind = computeQuantIndicators(candles);
      if (!ind) return res.status(500).json({ error: "Insufficient candle data for indicators." });

      const confluence    = computeMultiTFConfluence(candles15m, candles4h, candles1d);
      const bayesian      = computeBayesianScore(ind, confluence);
      const macroKillSwitch = checkMacroKillSwitch(macroCache.data || []);

      const mtfStr = `
MULTI-TIMEFRAME CONFLUENCE (EMA9 vs EMA21):
  15m: ${confluence["15m"].trend.padEnd(8)} | EMA9=$${confluence["15m"].ema9.toFixed(4)} vs EMA21=$${confluence["15m"].ema21.toFixed(4)} (${confluence["15m"].bars} bars)
  4h:  ${confluence["4h"].trend.padEnd(8)} | EMA9=$${confluence["4h"].ema9.toFixed(4)} vs EMA21=$${confluence["4h"].ema21.toFixed(4)} (${confluence["4h"].bars} bars)
  1d:  ${confluence["1d"].trend.padEnd(8)} | EMA9=$${confluence["1d"].ema9.toFixed(4)} vs EMA21=$${confluence["1d"].ema21.toFixed(4)} (${confluence["1d"].bars} bars)
  VERDICT: ${confluence.confluent ? "CONFLUENT" : "CONFLICTING"} — ${confluence.direction} (${confluence.strength})

BAYESIAN BRAIN SCORE:
  Probability: ${bayesian.probability}% → ${bayesian.interpretation} [Tier ${bayesian.tier}]
  Active signals: ${bayesian.signals_used.join(", ") || "none"}

MACRO KILL SWITCH: ${macroKillSwitch.safe ? "CLEAR — no HIGH impact events within 4h" : macroKillSwitch.warning}`;

      const indContext = `
TECHNICAL ANALYSIS — ${tf.label} (${tf.interval} candles, ${candles.length} bars):
Current: $${ind.currentPrice.toFixed(4)}
EMA20:   $${ind.ema20.toFixed(4)} (${ind.priceVsEma20}% ${parseFloat(ind.priceVsEma20)>0?"above":"below"})
EMA50:   $${ind.ema50.toFixed(4)} (${ind.priceVsEma50}% ${parseFloat(ind.priceVsEma50)>0?"above":"below"})
EMA200:  $${ind.ema200.toFixed(4)} (${ind.priceVsEma200}% ${parseFloat(ind.priceVsEma200)>0?"above":"below"})
Trend: ${ind.trend}
RSI(14): ${ind.rsi} → ${ind.rsiLabel}
MACD(12,26,9) Histogram: ${ind.macdHist} → ${ind.macdCrossing}
ATR(14): $${ind.atr14} (${ind.atrPct}% of price)
→ ${risk.label} SL distance: $${(ind.atr14 * risk.slMultiplier).toFixed(4)} (${(ind.atrPct * risk.slMultiplier).toFixed(2)}%)
Nearest Resistance: $${ind.nearestResistance?.toFixed(4)||"none above"}
Nearest Support:    $${ind.nearestSupport?.toFixed(4)||"none below"}
24h High: $${ind.high24.toFixed(4)} | 24h Low: $${ind.low24.toFixed(4)} | Range: ${ind.range24hPct}%
7d  High: $${ind.high7d.toFixed(4)} | 7d  Low:  $${ind.low7d.toFixed(4)}
Position in 24h range: ${ind.posInRange}% from bottom
Volume: ${ind.volumeSignal} (${ind.volumeRatio}× average)
Momentum Score: ${ind.momentumScore}/100
${mtfStr}`;

      const system = `You are the most elite quantitative analyst and systematic trader on the planet. You think like a hybrid of Paul Tudor Jones + Stan Druckenmiller + a senior quant desk head. Capital preservation first. Never force a trade.

PROFILE: ${risk.label}
Stop Loss: exactly ${risk.slMultiplier}× ATR from entry OR nearest structural level (whichever is tighter)
Leverage: ${risk.leverage[0]}x–${risk.leverage[1]}x maximum
Risk per trade: ${risk.riskPct}% of portfolio
Minimum win probability to issue trade: ${risk.minWinProb}%
TP1 ratio: ${risk.tpRatios[0]}:1 minimum | TP2 ratio: ${risk.tpRatios[1]}:1 minimum
Typical hold: ${risk.holdHorizon}

ABSOLUTE RULES:
1. If setup probability < ${risk.minWinProb}% → signal MUST be NEUTRAL. Never force a trade.
2. SL must be at ${risk.slMultiplier}× ATR OR structural support/resistance — cite which and why.
3. Every price level must be justified by specific technical data.
4. Leverage must respect ${risk.leverage[0]}x–${risk.leverage[1]}x range.
5. TP1 and TP2 must be at logical resistance levels or ATR multiples.
6. Hold duration must respect the profile horizon: ${risk.holdHorizon}.
7. If MACD, RSI, EMA, and volume all conflict → NEUTRAL. Confluence required.

Respond ONLY with valid JSON. No markdown. No backticks.

{
  "signal": "STRONG_LONG"|"LONG"|"NEUTRAL"|"SHORT"|"STRONG_SHORT",
  "win_probability": 0-100,
  "opportunity_score": 0-100,
  "entry": { "price": number, "zone_low": number, "zone_high": number, "rationale": "string" },
  "stopLoss": { "price": number, "distance_pct": number, "rationale": "string" },
  "tp1": { "price": number, "gain_pct": number, "rr_ratio": number, "rationale": "string" },
  "tp2": { "price": number, "gain_pct": number, "rr_ratio": number, "rationale": "string" },
  "leverage": { "recommended": number, "max": number, "rationale": "string" },
  "hold": { "duration": "string", "key_events": ["string"], "exit_conditions": ["string"] },
  "technical_summary": { "trend": "string", "key_levels": "string", "momentum": "string", "volume": "string", "pattern": "string" },
  "quant_rationale": "string",
  "risks": ["string"],
  "invalidation": "string",
  "hold_duration": "string"
}`;

      const userMsg = `ASSET: ${ticker} | MARKET: ${marketType} | CLASS: ${cls.toUpperCase()}
USER QUERY: "${userQuery || `Analyze optimal ${risk.label} setup`}"

${indContext}

${twitterContext ? `TWITTER/X SOCIAL INTELLIGENCE:\n${twitterContext}` : ""}

DATA SOURCES: HL candles (${candles.length} bars) + ${BINANCE_SYMBOLS[ticker] ? "Binance deeper history" : "Finnhub spot"} · All live

Calculate the highest probability setup for the ${risk.label} profile.
Every level must be technically defensible. Return JSON only.`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000, system, messages:[{ role:"user", content:userMsg }] }),
      });
      if (!aiRes.ok) { const e = await aiRes.text(); console.error("[/api/quant]", e); return res.status(502).json({ error:"AI Engine failed." }); }
      const aiData: any = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || "";
      const clean = rawText.replace(/```json|```/g, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(clean); } catch { console.error("[/api/quant parse]", clean.slice(0,200)); return res.status(500).json({ error:"AI returned malformed data." }); }
      parsed.indicators       = ind;
      parsed.multi_tf         = confluence;
      parsed.bayesian         = bayesian;
      parsed.macro_kill_switch = macroKillSwitch;
      parsed.conviction_tier  = bayesian.tier;
      if (!parsed.rr && parsed.tp1?.price && parsed.stopLoss?.price && parsed.entry?.price) {
        const rAmt = Math.abs(parsed.entry.price - parsed.stopLoss.price);
        const rwAmt = Math.abs(parsed.tp1.price - parsed.entry.price);
        parsed.rr = rAmt > 0.000001 ? rwAmt / rAmt : 0;
      }
      res.json(parsed);
    } catch (err: any) {
      console.error("[Quant Engine]", err);
      res.status(500).json({ error:"Internal server error in Quant Engine." });
    }
  });

  app.post("/api/ai/analyze", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });

    const system = req.body.system || req.body.systemPrompt || "";
    const userMessage = req.body.userMessage || req.body.prompt || "";
    if (!userMessage) return res.status(400).json({ error: "userMessage is required" });

    // Auth check — AI is Pro-only
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Sign in required to use AI." });
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ error: "Sign in required to use AI." });
    }
    const isPro = dbUser.tier === "pro" || dbUser.email === "mikeclaver@gmail.com";
    if (!isPro) {
      return res.status(403).json({ error: "AI Market Analyst is a Pro feature. Upgrade to Pro to unlock CLVR AI analysis." });
    }

    if (!checkAiRateLimit(userId, true)) {
      return res.status(429).json({
        error: "Rate limit: 60 AI requests/hour on Pro.",
        cached: false,
      });
    }

    // Check shared response cache — same prompt for any user = cached response
    const cacheKey = hashPrompt(system, userMessage);
    const cached = aiCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < AI_CACHE_TTL) {
      return res.json({ text: cached.text, response: cached.text, cached: true });
    }

    // Pro users always get Claude Sonnet 4 for best quality analysis
    const model = "claude-sonnet-4-20250514";

    const callClaude = async (messages: any[], withTools = true) => {
      const body: any = {
        model,
        max_tokens: 1500,
        system: system || "",
        messages,
      };
      if (withTools) body.tools = AI_TOOLS;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      return r;
    };

    try {
      const messages: any[] = [{ role: "user", content: userMessage }];
      let response = await callClaude(messages);

      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes("credit balance") || errorText.includes("credit_balance") || response.status === 529) {
          return res.status(503).json({ error: "__MAINTENANCE__" });
        }
        return res.status(response.status).json({ error: `API Error ${response.status}: ${errorText}` });
      }

      let data: any = await response.json();
      if (data.error) {
        const msg = data.error.message || "";
        if (msg.includes("credit balance") || msg.includes("credit_balance")) {
          return res.status(503).json({ error: "__MAINTENANCE__" });
        }
        return res.status(400).json({ error: msg });
      }

      // ── Tool use loop (max 3 tool calls to prevent runaway) ─────────────────
      let toolRounds = 0;
      while (data.stop_reason === "tool_use" && toolRounds < 3) {
        toolRounds++;
        const toolUseBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");
        const toolResults: any[] = [];

        for (const tb of toolUseBlocks) {
          if (tb.name === "get_market_quote") {
            const rawTicker = tb.input?.ticker || "";
            console.log(`[ai-tools] get_market_quote called for: ${rawTicker}`);
            const quote = await fetchYahooQuote(rawTicker);
            const resultText = "error" in quote
              ? `Could not fetch quote for "${rawTicker}": ${quote.error}`
              : `LIVE QUOTE — ${quote.name} (${quote.ticker}) on ${quote.exchange}: ${quote.currency} ${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} | Change: ${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(4)} (${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%) | [Source: Yahoo Finance — live data]`;
            toolResults.push({
              type: "tool_result",
              tool_use_id: tb.id,
              content: resultText,
            });
          }
        }

        // Append assistant message + tool results and continue
        messages.push({ role: "assistant", content: data.content });
        messages.push({ role: "user", content: toolResults });

        response = await callClaude(messages, false); // no tools on follow-up — get final answer
        if (!response.ok) {
          const errorText = await response.text();
          return res.status(response.status).json({ error: `API Error ${response.status}: ${errorText}` });
        }
        data = await response.json();
        if (data.error) return res.status(400).json({ error: data.error.message || "AI error" });
      }

      const text = (data.content || []).map((b: any) => b.text || "").join("") || "No response.";

      // Cache the response for all users
      aiCache.set(cacheKey, { text, ts: Date.now() });

      res.json({ text, response: text, cached: false, model });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── MACRO CALENDAR ──────────────────────────────────────
  const MACRO_2026 = [
    // FED (FOMC) 2026 — published schedule
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-01-28",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision with press conference. Held at 4.25%–4.50%.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",actual:"4.25%–4.50%",unit:"%",released:true},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-03-18",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve held rates at 4.25%–4.50% with updated dot plot. Powell flagged uncertainty but no urgency to cut.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",actual:"4.25%–4.50%",unit:"%",released:true},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-04-29",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision. Watch for guidance on rate path.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-06-17",time:"14:00 ET",impact:"HIGH",desc:"Mid-year FOMC with economic projections update. First potential cut of 2026.",currency:"USD",forecast:"4.00%–4.25%",previous:"4.25%–4.50%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-07-29",time:"14:00 ET",impact:"HIGH",desc:"July FOMC rate decision.",currency:"USD",forecast:"4.00%–4.25%",previous:"4.00%–4.25%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-09-16",time:"14:00 ET",impact:"HIGH",desc:"September FOMC with updated dot plot.",currency:"USD",forecast:"3.75%–4.00%",previous:"4.00%–4.25%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-11-04",time:"14:00 ET",impact:"HIGH",desc:"November FOMC rate decision.",currency:"USD",forecast:"3.75%–4.00%",previous:"3.75%–4.00%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-12-16",time:"14:00 ET",impact:"HIGH",desc:"Final 2026 FOMC with year-end projections.",currency:"USD",forecast:"3.50%–3.75%",previous:"3.75%–4.00%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-02-18",time:"14:00 ET",impact:"MED",desc:"Minutes from January FOMC meeting.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-04-08",time:"14:00 ET",impact:"MED",desc:"Minutes from March FOMC meeting.",currency:"USD"},
    // ECB 2026 — Deposit Facility Rate
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-01-22",time:"13:45 CET",impact:"HIGH",desc:"ECB monetary policy decision. Held at 2.75%.",currency:"EUR",forecast:"2.75%",previous:"3.00%",actual:"2.75%",unit:"%",released:true},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-03-05",time:"13:45 CET",impact:"HIGH",desc:"ECB rate decision. Watch Lagarde presser for EUR/USD direction.",currency:"EUR",forecast:"2.50%",previous:"2.75%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-04-16",time:"13:45 CET",impact:"HIGH",desc:"Spring ECB meeting with updated staff projections.",currency:"EUR",forecast:"2.25%",previous:"2.50%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-06-04",time:"13:45 CET",impact:"HIGH",desc:"ECB mid-year rate decision.",currency:"EUR",forecast:"2.00%",previous:"2.25%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-07-16",time:"13:45 CET",impact:"HIGH",desc:"July ECB monetary policy decision.",currency:"EUR",forecast:"2.00%",previous:"2.00%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-09-10",time:"13:45 CET",impact:"HIGH",desc:"September ECB with updated projections.",currency:"EUR",forecast:"1.75%",previous:"2.00%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-10-29",time:"13:45 CET",impact:"HIGH",desc:"October ECB rate decision.",currency:"EUR",forecast:"1.75%",previous:"1.75%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-12-17",time:"13:45 CET",impact:"HIGH",desc:"Final 2026 ECB meeting.",currency:"EUR",forecast:"1.50%",previous:"1.75%",unit:"%"},
    // BOJ 2026 — Short-term Policy Rate
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-01-22",time:"~03:00 ET",impact:"HIGH",desc:"Bank of Japan monetary policy decision. USD/JPY highly sensitive.",currency:"JPY",forecast:"0.50%",previous:"0.50%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-03-19",time:"~03:00 ET",impact:"HIGH",desc:"BOJ spring meeting. Watch for rate hike signals.",currency:"JPY",forecast:"0.75%",previous:"0.50%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-04-28",time:"~03:00 ET",impact:"HIGH",desc:"BOJ with updated quarterly outlook report.",currency:"JPY",forecast:"0.75%",previous:"0.75%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-06-18",time:"~03:00 ET",impact:"HIGH",desc:"June BOJ. Hawkish surprise = major JPY rally.",currency:"JPY",forecast:"1.00%",previous:"0.75%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-07-16",time:"~03:00 ET",impact:"HIGH",desc:"Mid-year BOJ with outlook report update.",currency:"JPY",forecast:"1.00%",previous:"1.00%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-09-17",time:"~03:00 ET",impact:"HIGH",desc:"September BOJ meeting.",currency:"JPY",forecast:"1.25%",previous:"1.00%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-10-29",time:"~03:00 ET",impact:"HIGH",desc:"October BOJ with quarterly outlook.",currency:"JPY",forecast:"1.25%",previous:"1.25%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-12-18",time:"~03:00 ET",impact:"HIGH",desc:"Final 2026 BOJ meeting.",currency:"JPY",forecast:"1.50%",previous:"1.25%",unit:"%"},
    // BOC 2026 — Overnight Rate
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-01-21",time:"09:45 ET",impact:"HIGH",desc:"Bank of Canada rate decision. Cut to 2.75%.",currency:"CAD",forecast:"2.75%",previous:"3.00%",actual:"2.75%",unit:"%",released:true},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-03-04",time:"09:45 ET",impact:"HIGH",desc:"BOC rate decision. Oil prices key for CAD outlook.",currency:"CAD",forecast:"2.50%",previous:"2.75%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-04-15",time:"09:45 ET",impact:"HIGH",desc:"Spring BOC with MPR update.",currency:"CAD",forecast:"2.25%",previous:"2.50%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-06-03",time:"09:45 ET",impact:"HIGH",desc:"June BOC rate decision.",currency:"CAD",forecast:"2.00%",previous:"2.25%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-07-15",time:"09:45 ET",impact:"HIGH",desc:"Mid-year BOC with MPR.",currency:"CAD",forecast:"2.00%",previous:"2.00%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-09-09",time:"09:45 ET",impact:"HIGH",desc:"September BOC rate decision.",currency:"CAD",forecast:"1.75%",previous:"2.00%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-10-28",time:"09:45 ET",impact:"HIGH",desc:"October BOC with MPR update.",currency:"CAD",forecast:"1.75%",previous:"1.75%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-12-09",time:"09:45 ET",impact:"HIGH",desc:"Final 2026 BOC meeting.",currency:"CAD",forecast:"1.50%",previous:"1.75%",unit:"%"},
    // BOE 2026 — Bank Rate
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-02-05",time:"12:00 GMT",impact:"HIGH",desc:"Bank of England rate decision with Monetary Policy Report. Cut to 4.50%.",currency:"GBP",forecast:"4.50%",previous:"4.75%",actual:"4.50%",unit:"%",released:true},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-03-19",time:"12:00 GMT",impact:"HIGH",desc:"BOE rate decision. GBP/USD driven by BoE tone.",currency:"GBP",forecast:"4.25%",previous:"4.50%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-05-07",time:"12:00 GMT",impact:"HIGH",desc:"Spring BOE with updated MPR.",currency:"GBP",forecast:"4.00%",previous:"4.25%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-06-18",time:"12:00 GMT",impact:"HIGH",desc:"June BOE rate decision.",currency:"GBP",forecast:"3.75%",previous:"4.00%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-08-06",time:"12:00 GMT",impact:"HIGH",desc:"August BOE with MPR update.",currency:"GBP",forecast:"3.75%",previous:"3.75%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-09-17",time:"12:00 GMT",impact:"HIGH",desc:"September BOE meeting.",currency:"GBP",forecast:"3.50%",previous:"3.75%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-11-05",time:"12:00 GMT",impact:"HIGH",desc:"November BOE with MPR.",currency:"GBP",forecast:"3.50%",previous:"3.50%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-12-17",time:"12:00 GMT",impact:"HIGH",desc:"Final 2026 BOE meeting.",currency:"GBP",forecast:"3.25%",previous:"3.50%",unit:"%"},
    // RBA 2026
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-02-17",time:"14:30 AET",impact:"MED",desc:"Reserve Bank of Australia rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-04-07",time:"14:30 AET",impact:"MED",desc:"RBA rate decision. AUD sensitive to China data.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-05-19",time:"14:30 AET",impact:"MED",desc:"May RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-07-07",time:"14:30 AET",impact:"MED",desc:"July RBA rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-08-04",time:"14:30 AET",impact:"MED",desc:"August RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-09-01",time:"14:30 AET",impact:"MED",desc:"September RBA rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-11-03",time:"14:30 AET",impact:"MED",desc:"November RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-12-01",time:"14:30 AET",impact:"MED",desc:"Final 2026 RBA meeting.",currency:"AUD"},
    // Key US economic data releases 2026
    {bank:"CPI",flag:"🇦🇺",name:"CPI m/m",date:"2026-02-24",time:"08:30 ET",impact:"HIGH",desc:"Australia CPI month-over-month.",currency:"AUD"},
    {bank:"CPI",flag:"🇦🇺",name:"CPI y/y",date:"2026-02-24",time:"08:30 ET",impact:"HIGH",desc:"Australia CPI year-over-year.",currency:"AUD"},
    {bank:"USD",flag:"🇺🇸",name:"Unemployment Claims",date:"2026-02-26",time:"08:30 ET",impact:"MED",desc:"Weekly initial jobless claims.",currency:"USD"},
    {bank:"GDP",flag:"🇺🇸",name:"GDP m/m",date:"2026-02-27",time:"08:30 ET",impact:"HIGH",desc:"US GDP month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"Core PPI m/m",date:"2026-02-27",time:"08:30 ET",impact:"MED",desc:"US Core Producer Price Index month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"PPI m/m",date:"2026-02-27",time:"08:30 ET",impact:"MED",desc:"US Producer Price Index month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"Non-Farm Payrolls",date:"2026-03-06",time:"08:30 ET",impact:"HIGH",desc:"US jobs report.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"CPI m/m",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"US Consumer Price Index month-over-month.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"CPI y/y",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"US Consumer Price Index year-over-year.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"Core CPI m/m",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"Core CPI (excl. food & energy).",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-03-18",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision with projections.",currency:"USD"},
  ].map((e, i) => ({ current: "—", forecast: "—", previous: "—", unit: "", ...e, id: i + 1 }));

  let macroCache: { data: any[]; ts: number } = { data: [], ts: 0 };
  // Keeps released events for today so they're never lost when the API stops returning them
  const releasedEventsMemory: Map<string, any> = new Map();
  let releasedMemoryDate = ""; // track which calendar date the memory belongs to
  const MACRO_CACHE_MS = 300000; // 5 minutes — avoids ForexFactory rate limits (429 retry-after ~300s)
  let ffRateLimitUntil = 0; // don't re-hit FF API until this timestamp passes

  // Returns true if any event is past its scheduled release time but still has no actual value
  // In that case we skip cache and fetch fresh data immediately
  function hasPastDueEvents(events: any[]): boolean {
    const nowMs = Date.now();
    return events.some((e: any) => {
      if (e.released || e.actual) return false;
      try {
        const [y, mo, d] = e.date.split("-").map(Number);
        const [h, m] = (e.timeET || "00:00").split(":").map(Number);
        // Convert ET release time to UTC (use -4 for EDT March-November, -5 for EST)
        const etOffset = (mo >= 3 && mo <= 11) ? 4 : 5;
        const releaseMs = Date.UTC(y, mo - 1, d, h + etOffset, m, 0);
        return releaseMs < nowMs;
      } catch { return false; }
    });
  }

  function getDateRange() {
    // Use ET date to match client-side macroTodayStr
    const todayETStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const todayStart = new Date(todayETStr + "T00:00:00");
    const endDate = new Date(todayStart);
    endDate.setDate(todayStart.getDate() + 14);
    endDate.setHours(23, 59, 59, 999);
    return { todayStart, endDate };
  }

  const COUNTRY_TO_REGION: Record<string,string> = {
    USD:"United States",EUR:"Eurozone",GBP:"United Kingdom",
    CAD:"Canada",JPY:"Japan",AUD:"Australia",CHF:"Switzerland",NZD:"New Zealand",CNY:"China",
  };
  const COUNTRY_TO_CODE: Record<string,string> = {
    USD:"US",EUR:"EU",GBP:"UK",CAD:"CA",JPY:"JP",AUD:"AU",CHF:"CH",NZD:"NZ",CNY:"CN",
  };

  // Compute whether an event's scheduled release time has already passed
  function computeIsPast(dateStr: string, timeET: string): boolean {
    try {
      const [y, mo, d] = dateStr.split("-").map(Number);
      const [h, m] = timeET.split(":").map(Number);
      const etOffset = (mo >= 3 && mo <= 11) ? 4 : 5; // EDT vs EST
      return Date.UTC(y, mo - 1, d, h + etOffset, m, 30) < Date.now(); // +30s grace
    } catch { return false; }
  }

  // Build ForexFactory day URLs for a range of days around today
  function getFFDayUrls(): string[] {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const urls: string[] = [];
    for (let offset = -3; offset <= 14; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
      const mon = months[d.getMonth()];
      urls.push(`https://www.forexfactory.com/calendar?day=${mon}${d.getDate()}.${d.getFullYear()}`);
    }
    return urls;
  }


  // Parse event JSON objects from ForexFactory website HTML using brace counting
  // The website embeds full event data (including actual values) that the JSON API lacks
  function parseFFWebsiteEvents(html: string): any[] {
    const events: any[] = [];
    const marker = '{"id":';
    let pos = 0;
    while ((pos = html.indexOf(marker, pos)) !== -1) {
      // Walk forward counting braces to find the closing }
      let depth = 0;
      let inStr = false;
      let i = pos;
      for (; i < Math.min(html.length, pos + 4000); i++) {
        const c = html[i];
        if (inStr) {
          if (c === "\\") { i++; } // skip escaped char
          else if (c === '"') { inStr = false; }
        } else {
          if (c === '"') { inStr = true; }
          else if (c === '{') { depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0) { i++; break; }
          }
        }
      }
      const objStr = html.slice(pos, i);
      try {
        const obj = JSON.parse(objStr);
        // Only include if it has the fields we expect from calendar events
        if (obj.ebaseId !== undefined && obj.dateline && obj.currency && obj.impactName) {
          events.push(obj);
        }
      } catch {}
      pos = pos + 1;
    }
    return events;
  }

  async function fetchLiveCalendar(): Promise<any[]> {
    // Skip if currently rate-limited
    if (Date.now() < ffRateLimitUntil) {
      console.log(`[macro] FF rate-limited for ${Math.round((ffRateLimitUntil - Date.now()) / 1000)}s more`);
      return [];
    }
    const RELEVANT_CURRENCIES = new Set(["USD","EUR","GBP","JPY","CAD","AUD","CHF","NZD"]);
    const allRaw: any[] = [];

    const seenEventIds = new Set<number>();
    const dayUrls = getFFDayUrls();
    let rateLimited = false;

    try {
      // Fetch all day pages in parallel (3 at a time) to get actual values for each day
      const BATCH_SIZE = 3;
      for (let b = 0; b < dayUrls.length && !rateLimited; b += BATCH_SIZE) {
        const batch = dayUrls.slice(b, b + BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(url =>
          fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(12000),
          }).then(async res => ({ url, res, html: res.ok ? await res.text() : null }))
        ));

        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const { url, res, html } = result.value;
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get("retry-after") || "300") * 1000;
            ffRateLimitUntil = Date.now() + retryAfter;
            console.log(`[macro] FF website 429 — backing off ${Math.round(retryAfter / 1000)}s`);
            rateLimited = true; break;
          }
          if (!html) { console.log(`[macro] FF ${res.status} for ${url}`); continue; }
          const parsed = parseFFWebsiteEvents(html);
          let added = 0;
          for (const obj of parsed) {
            if (!RELEVANT_CURRENCIES.has(obj.currency)) continue;
            if (obj.name === "Bank Holiday") continue;
            if (seenEventIds.has(obj.id)) continue; // dedup across pages
            seenEventIds.add(obj.id);
            allRaw.push(obj);
            added++;
          }
          console.log(`[macro] FF ${url.slice(-15)}: ${parsed.length} parsed, ${added} new`);
        }
      }
    } catch {}

    if (!allRaw.length) return [];

    return allRaw.map((e: any, i: number) => {
      const dt = new Date(e.dateline * 1000);
      const dateStr = dt.toISOString().slice(0, 10);
      const timeET = dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
      const actual = e.actual && e.actual !== "" ? String(e.actual) : null;
      const forecast = e.forecast && e.forecast !== "" ? String(e.forecast) : "—";
      const previous = e.previous && e.previous !== "" ? String(e.previous) : "—";
      const released = actual !== null;
      const isPast = computeIsPast(dateStr, timeET);
      const cc = COUNTRY_TO_CODE[e.currency] || e.currency?.slice(0, 2) || "US";
      return {
        id: 10000 + i,
        bank: mapCountryToBank(e.currency, e.name),
        flag: countryFlag(e.currency),
        name: e.name,
        date: dateStr,
        time: timeET + " ET",
        timeET,
        country: cc,
        region: COUNTRY_TO_REGION[e.currency] || cc,
        current: previous,
        forecast,
        previous,
        actual,
        unit: "",
        released,
        isPast,
        impact: e.impactName === "high" ? "HIGH" : e.impactName === "medium" ? "MED" : "LOW",
        desc: `${e.name}. Previous: ${previous}. Forecast: ${forecast}.${released ? ` Actual: ${actual}.` : isPast ? " Data not yet available." : " Pending release."}`,
        currency: e.currency,
        live: true,
      };
    });
  }

  function mapCountryToBank(country: string, title: string): string {
    const t = title.toLowerCase();
    if (t.includes("fomc") || t.includes("fed")) return "FED";
    if (t.includes("ecb")) return "ECB";
    if (t.includes("boj")) return "BOJ";
    if (t.includes("boc") || (country === "CAD" && t.includes("rate"))) return "BOC";
    if (t.includes("boe") || (country === "GBP" && t.includes("rate"))) return "BOE";
    if (t.includes("rba") || (country === "AUD" && t.includes("rate"))) return "RBA";
    if (t.includes("cpi") || t.includes("inflation")) return "CPI";
    if (t.includes("nonfarm") || t.includes("non-farm") || t.includes("employment change")) return "NFP";
    if (t.includes("pce")) return "PCE";
    if (t.includes("gdp")) return "GDP";
    if (t.includes("pmi")) return "PMI";
    return country;
  }

  function countryFlag(country: string): string {
    const flags: Record<string,string> = {USD:"🇺🇸",EUR:"🇪🇺",GBP:"🇬🇧",JPY:"🇯🇵",CAD:"🇨🇦",AUD:"🇦🇺",CHF:"🇨🇭",NZD:"🇳🇿"};
    return flags[country] || "🌐";
  }

  app.get("/api/macro", async (_req, res) => {
    try {
      // Today's date in ET timezone — matches client's macroTodayStr
      const todayETStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

      // Clear released memory if date changed (new calendar day in ET)
      if (releasedMemoryDate !== todayETStr) {
        releasedEventsMemory.clear();
        releasedMemoryDate = todayETStr;
      }

      let liveEvents: any[] = [];
      const cacheExpired = Date.now() - macroCache.ts > MACRO_CACHE_MS;
      const pastDue = !cacheExpired && macroCache.data.length > 0 && hasPastDueEvents(macroCache.data);
      if (cacheExpired || pastDue) {
        const fetched = await fetchLiveCalendar();
        if (fetched.length > 0) {
          macroCache = { data: fetched, ts: Date.now() };
          updateSharedMacroCache(fetched);
          liveEvents = fetched;
        } else if (macroCache.data.length > 0) {
          liveEvents = macroCache.data;
        } else {
          macroCache = { data: [], ts: Date.now() - MACRO_CACHE_MS + 60000 };
          liveEvents = [];
        }
      } else {
        liveEvents = macroCache.data;
        if (liveEvents.length > 0) updateSharedMacroCache(liveEvents);
      }

      // Update released events memory: accumulate any released events from today
      liveEvents.forEach((e: any) => {
        if (e.released && e.date === todayETStr) {
          releasedEventsMemory.set(`${e.date}-${e.name}`, e);
        }
      });

      // Merge in any released events from memory that fresh data may have dropped
      const liveKeys = new Set(liveEvents.map((e: any) => `${e.date}-${e.name}`));
      const memoryEvents = Array.from(releasedEventsMemory.values()).filter((e: any) => !liveKeys.has(`${e.date}-${e.name}`));
      liveEvents = [...liveEvents, ...memoryEvents];

      const { todayStart, endDate } = getDateRange();
      const existingDates = new Set(liveEvents.map((e: any) => `${e.date}-${e.name}`));
      // For MACRO_2026 fallback events, compute isPast so they don't show as "PENDING" when past their date
      const macro2026Enriched = MACRO_2026
        .filter(e => !existingDates.has(`${e.date}-${e.name}`))
        .map(e => ({ ...e, isPast: computeIsPast(e.date, (e.time || "08:30 ET").replace(" ET","").trim()) }));
      // FIX 1: Deduplicate by composite key (name + date + time) before returning
      const rawCombined = [
        ...liveEvents,
        ...macro2026Enriched,
      ].filter(e => {
        const d = new Date(e.date);
        return d >= todayStart && d <= endDate;
      });

      const dedupMap: Record<string, any> = {};
      for (const ev of rawCombined) {
        const key = `${(ev.name || "").toLowerCase().trim()}_${ev.date}_${ev.timeET || ev.time || ""}`;
        if (!dedupMap[key]) {
          dedupMap[key] = { ...ev };
        } else {
          // Merge: prefer the entry with more complete data
          if (!dedupMap[key].forecast && ev.forecast) dedupMap[key].forecast = ev.forecast;
          if (!dedupMap[key].previous && ev.previous) dedupMap[key].previous = ev.previous;
          if (!dedupMap[key].actual && ev.actual) dedupMap[key].actual = ev.actual;
          if (!dedupMap[key].current && ev.current) dedupMap[key].current = ev.current;
        }
      }

      const combined = Object.values(dedupMap)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      res.json(combined);
    } catch (e: any) {
      const { todayStart, endDate } = getDateRange();
      res.json(MACRO_2026.filter(e => {
        const d = new Date(e.date);
        return d >= todayStart && d <= endDate;
      }).map(e => ({ ...e, isPast: computeIsPast(e.date, (e.time || "08:30 ET").replace(" ET","").trim()) })));
    }
  });


  app.post("/api/subscribe", async (req, res) => {
    const { email, name } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    try {
      await pool.query(
        `INSERT INTO subscribers (id, email, name, active) VALUES (gen_random_uuid(), $1, $2, true) ON CONFLICT (email) DO UPDATE SET active = true, name = COALESCE($2, subscribers.name)`,
        [email, name || "Trader"]
      );
      const countResult = await pool.query("SELECT count(*) FROM subscribers WHERE active = true");
      res.json({ ok: true, count: parseInt(countResult.rows[0].count) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/unsubscribe", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    try {
      await pool.query("UPDATE subscribers SET active = false WHERE email = $1", [email]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // CASL one-click unsubscribe link (GET — linked from every marketing email)
  app.get("/api/unsubscribe", async (req, res) => {
    const email = decodeURIComponent((req.query.email as string) || "");
    if (!email || !email.includes("@")) {
      return res.status(400).send(`<html><body style="font-family:sans-serif;background:#050709;color:#c8d4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;padding:40px"><h2 style="color:#ff4060">Invalid unsubscribe link.</h2><p>Please contact <a href="mailto:Support@CLVRQuantAI.com" style="color:#c9a84c">Support@CLVRQuantAI.com</a></p></div></body></html>`);
    }
    try {
      await pool.query("UPDATE subscribers SET active = false WHERE LOWER(email) = LOWER($1)", [email]);
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed — CLVRQuant</title></head><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;padding:40px;max-width:500px"><div style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#e8c96d;margin-bottom:16px">CLVRQuant</div><h2 style="color:#f0f4ff;margin-bottom:12px">You've been unsubscribed</h2><p style="color:#6b7fa8;line-height:1.8;margin-bottom:20px">${email} has been removed from CLVRQuant morning brief emails. You will no longer receive marketing communications from us.</p><p style="font-size:12px;color:#4a5d80">Changed your mind? You can re-subscribe anytime from the app.<br>Questions? <a href="mailto:Support@CLVRQuantAI.com" style="color:#c9a84c;text-decoration:none">Support@CLVRQuantAI.com</a></p></div></body></html>`);
    } catch (e: any) {
      res.status(500).send("Error processing unsubscribe request.");
    }
  });

  app.post("/api/send-test-brief", async (req, res) => {
    try {
      const { sendDailyBriefEmails } = await import("./dailyBrief");
      sendDailyBriefEmails().catch((e: any) => console.log("[test-brief] Error:", e.message));
      res.json({ ok: true, message: "Brief generation started — check server logs" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/send-apology-brief", async (req, res) => {
    // Owner-only: must be logged in as the owner account
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const userEmail = (userRes.rows[0]?.email || "").toLowerCase();
      if (userEmail !== "mikeclaver@gmail.com") {
        return res.status(403).json({ error: "Owner only" });
      }
      const { sendApologyBriefEmails } = await import("./dailyBrief");
      sendApologyBriefEmails().catch((e: any) => console.log("[apology-brief] Error:", e.message));
      res.json({ ok: true, message: "Apology brief sending started — check server logs" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/send-service-apology", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const userEmail = (userRes.rows[0]?.email || "").toLowerCase();
      if (userEmail !== "mikeclaver@gmail.com") return res.status(403).json({ error: "Owner only" });
      const { sendServiceApologyEmail } = await import("./dailyBrief");
      const result = await sendServiceApologyEmail();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/send-promo-email", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const userEmail = (userRes.rows[0]?.email || "").toLowerCase();
      if (userEmail !== "mikeclaver@gmail.com") return res.status(403).json({ error: "Owner only" });
      const { sendPromoEmail } = await import("./dailyBrief");
      const result = await sendPromoEmail();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/stripe/config", async (_req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (e: any) {
      res.status(500).json({ error: "Stripe not configured" });
    }
  });

  app.get("/api/stripe/products", async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT p.id, p.name, p.description, p.metadata,
               pr.id as price_id, pr.unit_amount, pr.currency,
               pr.recurring->>'interval' as interval
        FROM stripe.products p
        JOIN stripe.prices pr ON pr.product = p.id
        WHERE p.active = true AND pr.active = true
        ORDER BY pr.unit_amount ASC
      `);
      if (result.rows.length > 0) {
        return res.json(result.rows);
      }

      const stripe = await getUncachableStripeClient();
      const products = await stripe.products.search({ query: "metadata['app']:'clvrquant'" });
      if (products.data.length === 0) return res.json([]);
      const prices = await stripe.prices.list({ product: products.data[0].id, active: true });
      const rows = prices.data.map(p => ({
        id: products.data[0].id,
        name: products.data[0].name,
        description: products.data[0].description,
        metadata: products.data[0].metadata,
        price_id: p.id,
        unit_amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
      })).sort((a: any, b: any) => (a.unit_amount || 0) - (b.unit_amount || 0));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── /api/prices — fetch live price IDs by lookup_key ──────────────────────
  app.get("/api/prices", async (_req, res) => {
    try {
      const stripe = await getUncachableStripeClient();

      // Fetch all tier prices in one request
      const { data: byKey } = await stripe.prices.list({
        lookup_keys: ['pro_monthly', 'pro_yearly', 'elite_monthly', 'elite_yearly'],
        active: true,
        expand: ['data.product'],
      });

      const proMonthly    = byKey.find(p => p.lookup_key === 'pro_monthly');
      const proYearly     = byKey.find(p => p.lookup_key === 'pro_yearly');
      const eliteMonthly  = byKey.find(p => p.lookup_key === 'elite_monthly');
      const eliteYearly   = byKey.find(p => p.lookup_key === 'elite_yearly');

      const toObj = (p: any) => p ? { price_id: p.id, unit_amount: p.unit_amount, interval: p.recurring?.interval, lookup_key: p.lookup_key } : null;

      if (proMonthly && proYearly) {
        return res.json({
          monthly:       toObj(proMonthly),
          yearly:        toObj(proYearly),
          eliteMonthly:  toObj(eliteMonthly),
          eliteYearly:   toObj(eliteYearly),
        });
      }

      // Fallback: enumerate all products tagged for clvrquant
      const products = await stripe.products.search({ query: "metadata['app']:'clvrquant'" });
      if (products.data.length > 0) {
        const result: Record<string,any> = {};
        for (const prod of products.data) {
          const { data: prices } = await stripe.prices.list({ product: prod.id, active: true });
          const tier = (prod.metadata as any)?.tier || 'pro';
          for (const p of prices) {
            const key = `${tier}_${p.recurring?.interval === 'year' ? 'yearly' : 'monthly'}`;
            result[key] = toObj(p);
          }
        }
        if (result['pro_monthly'] && result['pro_yearly']) {
          return res.json({
            monthly:      result['pro_monthly'],
            yearly:       result['pro_yearly'],
            eliteMonthly: result['elite_monthly'] ?? null,
            eliteYearly:  result['elite_yearly'] ?? null,
          });
        }
      }

      res.status(404).json({ error: 'No active prices found — ensure pro_monthly, pro_yearly, elite_monthly, elite_yearly lookup_keys exist in Stripe' });
    } catch (e: any) {
      console.error('[stripe] /api/prices error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/stripe/checkout", async (req, res) => {
    const { priceId, email } = req.body;
    if (!priceId) return res.status(400).json({ error: "priceId required" });

    try {
      const stripe = await getUncachableStripeClient();
      const baseUrl = process.env.APP_URL
        || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 'http://localhost:5000');

      const sessionParams: any = {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}?session_id={CHECKOUT_SESSION_ID}&status=success`,
        cancel_url: `${baseUrl}?status=cancel`,
        payment_method_types: ['card'],
      };

      if (email) {
        sessionParams.customer_email = email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) {
      console.error('[stripe] Checkout error:', e.message, e.type, e.code);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/stripe/subscription", async (req, res) => {
    const sessionId = req.query.session_id as string;
    if (!sessionId) return res.json({ tier: "free" });

    try {
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        return res.json({
          tier: "pro",
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        });
      }
      res.json({ tier: "free" });
    } catch (e: any) {
      res.json({ tier: "free" });
    }
  });

  app.post("/api/stripe/portal", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });

    try {
      const user = await storage.getUser(userId);
      const customerId = user?.stripeCustomerId;
      if (!customerId) return res.status(400).json({ error: "No Stripe customer found" });

      const stripe = await getUncachableStripeClient();
      const baseUrl = process.env.APP_URL
        || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 'http://localhost:5000');

      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: baseUrl,
      });
      res.json({ url: portal.url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/stripe/pause", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user?.stripeSubscriptionId) return res.status(400).json({ error: "No active subscription" });
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        pause_collection: { behavior: "void" },
      });
      res.json({ ok: true, status: "paused" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/stripe/resume", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user?.stripeSubscriptionId) return res.status(400).json({ error: "No active subscription" });
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        pause_collection: "",
      } as any);
      res.json({ ok: true, status: "active" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/stripe/cancel", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user?.stripeSubscriptionId) return res.status(400).json({ error: "No active subscription" });
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      res.json({ ok: true, status: "canceling" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const alerts = await storage.getUserAlerts(userId);
      res.json(alerts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/alerts", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    const { sym, field, condition, threshold, label } = req.body;
    if (!sym || !field || !condition || threshold === undefined || !label) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      const alert = await storage.createUserAlert({
        userId,
        sym,
        field,
        condition,
        threshold: String(threshold),
        label,
        expiresAt,
      });
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      await storage.deleteUserAlert(Number(req.params.id), userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/alerts/:id/trigger", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const alertId = Number(req.params.id);
      await storage.updateUserAlertTriggered(alertId, userId);
      // Send locked-screen web push notification
      const { label, sym, threshold, condition } = req.body || {};
      const pushTitle = `🔔 Alert: ${label || sym || "Price Alert"}`;
      const pushBody  = `${sym || ""} ${condition || ""} $${threshold || ""} — tap to view`.trim();
      sendWebPushToUser(userId, pushTitle, pushBody, `alert-${alertId}`).catch(() => {});
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const OWNER_CODE = process.env.OWNER_CODE || "CLVR-OWNER-2026";
  const OWNER_EMAIL = "mikeclaver@gmail.com";

  async function isOwner(userId: string): Promise<boolean> {
    if (!userId) return false;
    try {
      const user = await storage.getUser(userId);
      return user?.email === OWNER_EMAIL;
    } catch { return false; }
  }

  app.post("/api/verify-code", async (req, res) => {
    const rawCode = req.body.code;
    const userId = (req.session as any)?.userId || null;
    if (!rawCode) return res.status(400).json({ error: "Code required" });
    const code = rawCode.trim().toUpperCase();

    if (code === OWNER_CODE) {
      if (!userId || !(await isOwner(userId))) {
        return res.json({ valid: false, error: "This code is reserved" });
      }
      return res.json({ valid: true, tier: "pro", type: "owner", label: "Owner Access" });
    }

    if (!userId) {
      console.log(`[verify-code] No session userId for code=${code}`);
      return res.json({ valid: false, error: "You must be signed in to use an access code" });
    }

    try {
      const acRes = await pool.query("SELECT * FROM access_codes WHERE code = $1", [code]);
      const ac = acRes.rows[0];
      if (!ac || !ac.active) {
        console.log(`[verify-code] Code not found or inactive: ${code}`);
        return res.json({ valid: false, error: "Code not found" });
      }
      if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
        return res.json({ valid: false, error: "This code has expired" });
      }
      const maxUses = ac.max_uses; // null = single use, -1 = unlimited, N = up to N uses
      const useCount = ac.use_count || 0;
      const isMultiUse = maxUses !== null;
      // For single-use codes: block if claimed by someone else
      if (!isMultiUse && ac.used_by && ac.used_by !== userId) {
        return res.json({ valid: false, error: "This code has already been claimed by another user" });
      }
      // For multi-use codes with a limit: check if limit reached
      if (isMultiUse && maxUses > 0 && useCount >= maxUses) {
        return res.json({ valid: false, error: "This code has reached its maximum number of uses" });
      }
      // Mark usage
      if (!isMultiUse) {
        // Single-use: mark the used_by field
        if (!ac.used_by) {
          await pool.query("UPDATE access_codes SET used_by = $1, used_at = NOW(), use_count = COALESCE(use_count,0)+1 WHERE code = $2", [userId, code]);
        }
      } else {
        // Multi-use: only increment count (unlimited or limited)
        await pool.query("UPDATE access_codes SET use_count = COALESCE(use_count,0)+1 WHERE code = $1", [code]);
      }
      const promoExpiry = ac.expires_at || null;
      await storage.updateUserPromoCode(userId, code, promoExpiry ? new Date(promoExpiry) : null);
      await pool.query("UPDATE users SET tier = 'pro' WHERE id = $1", [userId]);
      checkAndGrantReferralReward(userId).catch(() => {});
      // If it was a trial code, auto-generate a new one for the owner
      if (ac.type === "trial") {
        getCurrentTrialCode().catch(() => {}); // ensure next trial code exists
      }
      console.log(`[verify-code] SUCCESS: ${code} redeemed by user ${userId}, expires ${promoExpiry}`);
      return res.json({ valid: true, tier: "pro", type: ac.type, label: ac.label, expiresAt: promoExpiry });
    } catch (err: any) {
      console.error(`[verify-code] ERROR for code=${code}:`, err.message);
      res.json({ valid: false, error: "Verification failed — please try again" });
    }
  });

  app.post("/api/access-codes", async (req, res) => {
    const { ownerCode, code, label, type } = req.body;
    if (ownerCode !== OWNER_CODE) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    if (!code || !label) {
      return res.status(400).json({ error: "code and label required" });
    }
    try {
      const codeType = type || "vip";
      const ac = await storage.createAccessCode({ code, label, type: codeType });
      if (codeType === "vip") {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 3);
        await pool.query("UPDATE access_codes SET expires_at = $1 WHERE code = $2", [expiresAt, code]);
        res.json({ ...ac, expiresAt });
      } else {
        res.json(ac);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/access-codes/revoke", async (req, res) => {
    const { ownerCode, code } = req.body;
    if (ownerCode !== OWNER_CODE) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    try {
      await storage.revokeAccessCode(code);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Web Push subscription endpoints ──────────────────────────────────────────
  app.get("/api/push/public-key", (_req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post("/api/push/subscribe", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription" });
    try {
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)
         ON CONFLICT (user_id, subscription) DO NOTHING`,
        [userId, JSON.stringify(subscription)]
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1", [userId]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Owner: current trial code + generate new one ──────────────────────────
  app.get("/api/admin/current-trial-code", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    const trial = await getCurrentTrialCode();
    if (!trial) return res.status(500).json({ error: "Could not get trial code" });
    res.json(trial);
  });

  app.post("/api/admin/generate-trial-code", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    // Deactivate old unused trial codes
    await pool.query("UPDATE access_codes SET active = false WHERE type = 'trial' AND used_by IS NULL AND use_count = 0");
    const code = await generateTrialCode();
    const expiresAt = new Date(Date.now() + 7*86400000).toISOString();
    res.json({ code, expiresAt });
  });

  // ── Admin: Generate single-use 1/2/3-month Pro access codes (owner only) ──
  app.post("/api/admin/generate-access-code", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    const { durationMonths, label: rawLabel } = req.body;
    const months = parseInt(durationMonths, 10);
    if (![1, 2, 3].includes(months)) return res.status(400).json({ error: "durationMonths must be 1, 2, or 3" });
    try {
      const code = `PRO-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + months * 30 * 86400000).toISOString();
      const label = rawLabel?.trim() || `${months}-month Pro code`;
      await pool.query(
        `INSERT INTO access_codes (code, label, type, active, expires_at, max_uses)
         VALUES ($1, $2, 'pro', true, $3, 1)`,
        [code, label, expiresAt]
      );
      res.json({ code, expiresAt, durationMonths: months, label });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Export all users as CSV (owner only) ──────────────────────────
  app.get("/api/admin/users/export", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    try {
      const result = await pool.query(
        `SELECT id, name, email, tier, email_verified, subscribe_to_brief, promo_code, promo_expires_at, created_at
         FROM users ORDER BY created_at DESC`
      );
      const rows = result.rows;
      const headers = ["id","name","email","tier","email_verified","subscribe_to_brief","promo_code","promo_expires_at","created_at"];
      const csv = [
        headers.join(","),
        ...rows.map(r => headers.map(h => {
          const v = r[h] ?? "";
          return `"${String(v).replace(/"/g,'""')}"`;
        }).join(","))
      ].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="clvrquant-users-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: List all users as JSON (owner only) ────────────────────────────
  app.get("/api/admin/users/list", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    try {
      const result = await pool.query(
        `SELECT id, name, email, tier, email_verified, subscribe_to_brief, promo_code, promo_expires_at, created_at
         FROM users ORDER BY created_at DESC`
      );
      res.json({ count: result.rows.length, users: result.rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Restore a user by email (owner only, for recovery) ────────────
  app.post("/api/admin/users/restore", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId || !(await isOwner(userId))) return res.status(403).json({ error: "Unauthorized" });
    const { name, email, tier = "free", emailVerified = true } = req.body;
    if (!email || !name) return res.status(400).json({ error: "name and email required" });
    try {
      const bcrypt = await import("bcrypt");
      const tempPwd = Math.random().toString(36).slice(2, 10);
      const hashed = await bcrypt.hash(tempPwd, 12);
      const crypto = await import("crypto");
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email, password, tier, email_verified, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (email) DO NOTHING`,
        [id, name.trim(), email.toLowerCase().trim(), hashed, tier, emailVerified]
      );
      res.json({ ok: true, tempPassword: tempPwd, note: "Send this temp password to the user so they can sign in and reset it." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Downgrade to free (cancel Stripe sub + clear promo tier) ─────────────
  app.post("/api/stripe/downgrade", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ error: "User not found" });
      // Cancel Stripe subscription if one exists
      if (user.stripeSubscriptionId) {
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        } catch {}
      }
      // Clear tier and promo code
      await pool.query(
        "UPDATE users SET tier = 'free', promo_code = NULL, promo_expires_at = NULL, stripe_subscription_id = NULL WHERE id = $1",
        [userId]
      );
      // Remove any active access code claim
      await pool.query("UPDATE access_codes SET used_by = NULL, used_at = NULL WHERE used_by = $1", [userId]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/send-welcome-blast", async (req, res) => {
    const { ownerCode } = req.body;
    if (ownerCode !== OWNER_CODE) return res.status(403).json({ error: "Unauthorized" });
    try {
      const { targets } = req.body;
      const allUsers = targets && Array.isArray(targets) && targets.length > 0
        ? { rows: targets }
        : await pool.query("SELECT id, name, email, tier, subscribe_to_brief FROM users WHERE email LIKE '%@%' ORDER BY email");
      const { client: resend, fromEmail: blastFrom } = await getUncachableResendClient();
      const senderAddress = blastFrom;
      const results: any[] = [];
      for (const u of allUsers.rows) {
        try {
          const dailyEmail = u.subscribe_to_brief;
          const emailResult = await resend.emails.send({
            from: senderAddress,
            reply_to: "MikeClaver@CLVRQuantAI.com",
            to: u.email,
            subject: "Welcome to CLVRQuant — Your Market Intelligence Terminal",
            headers: {
              "List-Unsubscribe": "<mailto:MikeClaver@CLVRQuantAI.com?subject=unsubscribe>",
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            text: `Welcome to CLVRQuant, ${u.name}!\n\nYour account is now live at https://clvrquantai.com\n\nWhat you have access to:\n- Real-time prices across 32 crypto, 16 equities, 7 commodities, 14 forex\n- Live signal detection with QuantBrain AI scoring\n- Macro calendar — central bank decisions & economic events\n- AI Market Analyst — ask anything, get trade ideas\n- Price alerts and push notifications\n- Phantom Wallet — Solana integration\n${dailyEmail ? "- Daily 6AM Brief — Subscribed\n" : ""}\nDISCLAIMER: CLVRQuant is for informational and educational purposes only. Nothing constitutes financial advice.\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com\nTo unsubscribe reply with "unsubscribe"`,
            html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
              <div style="text-align:center;margin-bottom:24px">
                <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuant</div>
                <div style="font-family:monospace;font-size:10px;color:#4a5d80;letter-spacing:0.3em;margin-top:4px">AI · MARKET INTELLIGENCE</div>
              </div>
              <div style="border-top:1px solid #141e35;padding-top:20px">
                <p style="font-size:16px;color:#f0f4ff;margin-bottom:4px">Welcome, <strong>${u.name}</strong></p>
                <p style="font-size:13px;color:#6b7fa8;line-height:1.8">Your CLVRQuant account is live. Here's what you have access to:</p>
                <div style="background:#0c1220;border:1px solid #141e35;border-radius:4px;padding:16px;margin:16px 0">
                  <div style="font-family:monospace;font-size:10px;color:#c9a84c;letter-spacing:0.15em;margin-bottom:10px">YOUR FEATURES</div>
                  ${[
                    "Real-time prices — 32 crypto, 16 equities, 7 commodities, 14 forex",
                    "Live signal detection — QuantBrain AI scoring",
                    "Macro calendar — Central bank decisions & economic events",
                    "AI Market Analyst — Ask anything, get trade ideas",
                    "Price alerts — Custom notifications",
                    "Phantom Wallet — Solana integration",
                    dailyEmail ? "📧 Daily 6AM Brief — Subscribed ✓" : "📧 Daily 6AM Brief — Not subscribed",
                  ].map(f => `<div style="font-size:12px;color:#c8d4ee;padding:4px 0;display:flex;align-items:center;gap:8px"><span style="color:#c9a84c">✦</span> ${f}</div>`).join("")}
                </div>
                <div style="background:rgba(255,140,0,0.06);border:1px solid rgba(255,140,0,0.15);border-radius:4px;padding:12px 16px;margin:16px 0">
                  <div style="font-size:10px;color:#ff8c00;font-weight:700;letter-spacing:0.15em;margin-bottom:4px">IMPORTANT DISCLAIMER</div>
                  <div style="font-size:10px;color:#6b7fa8;line-height:1.7">CLVRQuant is for informational and educational purposes only. Nothing constitutes financial advice. All trading involves significant risk of loss. CLVRQuant and Mike Claver bear no liability for any financial decisions.</div>
                </div>
                <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a> · Not financial advice</p>
              </div>
            </div>`,
          });
          const id = emailResult?.data?.id || emailResult?.id || "ok";
          const err = emailResult?.error;
          results.push({ email: u.email, status: err ? "error" : "sent", id, error: err || null });
          console.log(`[welcome-blast] ${err ? "FAILED" : "SENT"}: ${u.email} id=${id}`);
          await new Promise(r => setTimeout(r, 600));
        } catch (e: any) {
          results.push({ email: u.email, status: "error", error: e.message });
          console.error(`[welcome-blast] EXCEPTION: ${u.email}: ${e.message}`);
        }
      }
      res.json({ total: allUsers.rows.length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    const { name, email, password, dailyEmail, referralCode: refCode } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    try {
      const existing = await storage.getUserByEmail(email.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });
      const hashed = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        username: email.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password: hashed,
        name: name.trim(),
        subscribeToBrief: !!dailyEmail,
      });
      const crypto = await import("crypto");
      const myRefCode = "CLVR-REF-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      await storage.updateUserReferralCode(user.id, myRefCode);
      const verifyToken = crypto.randomBytes(24).toString("hex");
      await storage.setEmailVerificationToken(user.id, verifyToken);
      if (refCode && refCode.startsWith("CLVR-REF-")) {
        const referrer = await storage.getUserByReferralCode(refCode);
        if (referrer) {
          await storage.updateUserReferredBy(user.id, refCode);
          await storage.createReferral({ referrerUserId: referrer.id, referredUserId: user.id });
        }
      }
      if (dailyEmail) {
        await pool.query(
          `INSERT INTO subscribers (id, email, name, active) VALUES (gen_random_uuid(), $1, $2, true) ON CONFLICT (email) DO UPDATE SET active = true, name = COALESCE($2, subscribers.name)`,
          [email.toLowerCase().trim(), name.trim()]
        );
      }
      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        console.log(`[signup] Resend fromEmail configured as: "${fromEmail}"`);
        const senderAddress = fromEmail;
        console.log(`[signup] Sending welcome email to ${email.toLowerCase().trim()} from ${senderAddress}`);
        const verifyUrl = `https://clvrquantai.com?verify=${verifyToken}`;
        const emailResult = await resend.emails.send({
          from: senderAddress,
          reply_to: "MikeClaver@CLVRQuantAI.com",
          to: email.toLowerCase().trim(),
          subject: "Verify your CLVRQuant account",
          headers: {
            "List-Unsubscribe": "<mailto:MikeClaver@CLVRQuantAI.com?subject=unsubscribe>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          text: `Welcome to CLVRQuant, ${name.trim()}!\n\nVerify your email to activate your account:\n${verifyUrl}\n\nFeatures included:\n- Real-time prices across 32 crypto, 16 equities, 7 commodities, 14 forex\n- Live signal detection with QuantBrain AI scoring\n- Macro calendar — central bank decisions & economic events\n- AI Market Analyst — ask anything, get trade ideas (Pro)\n- Price alerts and push notifications\n- Phantom Wallet — Solana integration\n\nDISCLAIMER: CLVRQuant is for informational and educational purposes only. Nothing constitutes financial advice. All trading involves significant risk of loss.\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com`,
          html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
            <div style="text-align:center;margin-bottom:28px">
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuant</div>
              <div style="font-family:monospace;font-size:10px;color:#4a5d80;letter-spacing:0.3em;margin-top:4px">AI · MARKET INTELLIGENCE</div>
            </div>
            <div style="border-top:1px solid #141e35;padding-top:24px">
              <p style="font-size:17px;color:#f0f4ff;margin-bottom:6px">Welcome, <strong>${name.trim()}</strong> 👋</p>
              <p style="font-size:13px;color:#6b7fa8;line-height:1.8;margin-bottom:28px">One step left — verify your email to activate your account and access your market intelligence terminal.</p>

              <div style="text-align:center;margin:28px 0">
                <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:16px;padding:16px 40px;border-radius:6px;text-decoration:none;letter-spacing:0.02em">
                  ✦ Verify My Email
                </a>
              </div>

              <p style="font-size:11px;color:#4a5d80;text-align:center;margin-bottom:32px">Or copy this link into your browser:<br><span style="font-family:monospace;font-size:10px;color:#6b7fa8;word-break:break-all">${verifyUrl}</span></p>

              <div style="background:#0c1220;border:1px solid #141e35;border-radius:4px;padding:16px;margin:16px 0">
                <div style="font-family:monospace;font-size:10px;color:#c9a84c;letter-spacing:0.15em;margin-bottom:10px">YOUR FEATURES</div>
                ${[
                  "Real-time prices — 32 crypto, 16 equities, 7 commodities, 14 forex",
                  "Live signal detection — QuantBrain AI scoring",
                  "Macro calendar — Central bank decisions & economic events",
                  "AI Market Analyst — Ask anything, get trade ideas (Pro)",
                  "Price alerts — Custom push notifications",
                  "Phantom Wallet — Solana integration",
                  dailyEmail ? "📧 Daily 6AM Brief — Subscribed ✓" : "📧 Daily 6AM Brief — Available on Pro",
                ].map(f => `<div style="font-size:12px;color:#c8d4ee;padding:4px 0"><span style="color:#c9a84c">✦</span> ${f}</div>`).join("")}
              </div>

              <div style="background:rgba(255,140,0,0.06);border:1px solid rgba(255,140,0,0.15);border-radius:4px;padding:12px 16px;margin:20px 0">
                <div style="font-size:10px;color:#ff8c00;font-weight:700;letter-spacing:0.15em;margin-bottom:4px">IMPORTANT DISCLAIMER</div>
                <div style="font-size:10px;color:#6b7fa8;line-height:1.7">CLVRQuant is for informational and educational purposes only. Nothing constitutes financial advice. All trading involves significant risk of loss. CLVRQuant and Mike Claver bear no liability for any financial decisions.</div>
              </div>
              <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a> · Not financial advice</p>
            </div>
          </div>`,
        });
        if (emailResult?.error) {
          console.error(`[signup] Resend returned error for ${email.toLowerCase().trim()}:`, JSON.stringify(emailResult.error));
        } else {
          console.log(`[signup] Welcome email delivered to ${email.toLowerCase().trim()}, id=${emailResult?.data?.id || emailResult?.id || "ok"}`);
        }
      } catch (emailErr: any) {
        console.error(`[signup] Welcome email FAILED for ${email.toLowerCase().trim()}:`, JSON.stringify(emailErr));
      }
      (req.session as any).userId = user.id;
      req.session.save(() => {
        res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, tier: user.tier, emailVerified: false, pendingVerification: true } });
      });
    } catch (e: any) {
      console.error("Signup error:", e.message);
      if (e.message?.includes("unique") || e.message?.includes("duplicate")) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      res.status(500).json({ error: "Signup failed. Please try again." });
    }
  });

  app.post("/api/auth/signin", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    if (!password) return res.status(400).json({ error: "Password required" });
    try {
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) return res.status(401).json({ error: "Invalid email or password" });
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });
      const ownerMatch = user.email === OWNER_EMAIL;
      const tier = ownerMatch ? "pro" : user.tier;
      if (ownerMatch && user.tier !== "pro") {
        await pool.query("UPDATE users SET tier = 'pro' WHERE id = $1", [user.id]);
      }
      const mustChangePassword = !!(user as any).mustChangePassword;
      (req.session as any).userId = user.id;
      req.session.save(() => {
        res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, tier, emailVerified: user.emailVerified, pendingVerification: !user.emailVerified && !!user.emailVerificationToken }, mustChangePassword });
      });
    } catch (e: any) {
      res.status(500).json({ error: "Sign in failed" });
    }
  });

  app.post("/api/auth/change-password", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    // Enforce strong password: at least 1 uppercase, 1 lowercase, 1 number
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must include uppercase, lowercase, and a number" });
    }
    try {
      const hashed = await bcrypt.hash(newPassword, 12);
      await pool.query("UPDATE users SET password = $1, must_change_password = false WHERE id = $2", [hashed, userId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.json({ user: null });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.json({ user: null });
      const tier = user.email === OWNER_EMAIL ? "pro" : user.tier;
      const pendingVerification = !user.emailVerified && !!user.emailVerificationToken;
      res.json({ user: { id: user.id, name: user.name, email: user.email, tier, emailVerified: user.emailVerified, pendingVerification } });
    } catch {
      res.json({ user: null });
    }
  });

  app.post("/api/auth/signout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  // ── EMAIL VERIFICATION ──────────────────────────────────────────────────
  app.get("/api/auth/verify-email", async (req, res) => {
    const { token } = req.query as { token?: string };
    if (!token) return res.status(400).json({ error: "Missing token" });
    try {
      const user = await storage.getUserByEmailVerificationToken(token);
      if (!user) return res.status(404).json({ error: "Invalid or expired verification link" });
      await storage.markEmailVerified(user.id);
      res.json({ ok: true, email: user.email, name: user.name });
    } catch (e: any) {
      console.error("[verify-email]", e.message);
      res.status(500).json({ error: "Verification failed. Please try again." });
    }
  });

  app.post("/api/auth/resend-verification", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.emailVerified) return res.json({ ok: true, message: "Email already verified" });
      const crypto = await import("crypto");
      const token = crypto.randomBytes(24).toString("hex");
      await storage.setEmailVerificationToken(userId, token);
      const verifyUrl = `https://clvrquantai.com?verify=${token}`;
      const { client: resend, fromEmail: resendFrom } = await getUncachableResendClient();
      await resend.emails.send({
        from: resendFrom,
        reply_to: "MikeClaver@CLVRQuantAI.com",
        to: user.email,
        subject: "Verify your CLVRQuant email",
        headers: {
          "List-Unsubscribe": "<mailto:MikeClaver@CLVRQuantAI.com?subject=unsubscribe>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        text: `Hi ${user.name},\n\nClick the link below to verify your email and activate your CLVRQuant account:\n${verifyUrl}\n\nIf you didn't sign up, you can ignore this email.\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com`,
        html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d">CLVRQuant</div>
            <div style="font-family:monospace;font-size:10px;color:#4a5d80;letter-spacing:0.3em;margin-top:4px">AI · MARKET INTELLIGENCE</div>
          </div>
          <p style="font-size:15px;color:#f0f4ff">Hi <strong>${user.name}</strong>,</p>
          <p style="font-size:13px;color:#6b7fa8;line-height:1.8;margin-bottom:28px">Click the button below to confirm your email and activate your account.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:16px;padding:16px 40px;border-radius:6px;text-decoration:none">Verify My Email</a>
          </div>
          <p style="font-size:11px;color:#4a5d80;text-align:center;margin-bottom:6px">Or copy this link:<br><span style="font-family:monospace;font-size:10px;color:#6b7fa8;word-break:break-all">${verifyUrl}</span></p>
          <p style="font-size:10px;color:#3a4d68;text-align:center;margin-top:20px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a></p>
        </div>`,
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[resend-verification]", e.message);
      res.status(500).json({ error: "Failed to send email. Try again later." });
    }
  });

  // ── WEBAUTHN / FACE ID BIOMETRIC AUTH ────────────────────────────────────
  // Simplified flow: store credential ID server-side, verify on auth.
  // Actual biometric check is done locally by the device (no signature verification needed).

  // Register a new WebAuthn credential for the logged-in user
  app.post("/api/auth/webauthn/register", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not signed in" });
    const { credentialId } = req.body;
    if (!credentialId || typeof credentialId !== "string") return res.status(400).json({ error: "credentialId required" });
    try {
      await storage.createWebAuthnCredential(uid, credentialId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List credentials for logged-in user (so frontend can show "biometric enabled")
  app.get("/api/auth/webauthn/credentials", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not signed in" });
    try {
      const creds = await storage.getWebAuthnCredentialsByUser(uid);
      res.json({ credentials: creds.map(c => ({ id: c.id, createdAt: c.createdAt })) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Authenticate with credential ID (creates session for that user)
  app.post("/api/auth/webauthn/authenticate", async (req, res) => {
    const { credentialId } = req.body;
    if (!credentialId || typeof credentialId !== "string") return res.status(400).json({ error: "credentialId required" });
    try {
      const user = await storage.getUserByCredentialId(credentialId);
      if (!user) return res.status(401).json({ error: "Unknown credential" });
      const tier = user.email === "mikeclaver@gmail.com" ? "pro" : user.tier;
      // Set BOTH session.userId (used by all protected routes) and session.user (legacy)
      (req.session as any).userId = user.id;
      (req.session as any).user = { id: user.id, email: user.email, name: user.name, tier, username: user.username };
      await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, tier, username: user.username } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove a biometric credential
  app.delete("/api/auth/webauthn/credential/:credId", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not signed in" });
    try {
      await storage.deleteWebAuthnCredential(req.params.credId, uid);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    try {
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) return res.json({ ok: true });
      const crypto = await import("crypto");
      const tempPassword = "CLVR-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600000);
      const hashedTemp = await bcrypt.hash(tempPassword, 12);
      await storage.updateUserResetToken(user.id, token, expiry);
      const APP_URL = process.env.APP_URL || "https://clvrquant.replit.app";
      const resetLink = `${APP_URL}?reset=${token}`;
      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        await resend.emails.send({
          from: fromEmail,
          reply_to: "MikeClaver@CLVRQuantAI.com",
          to: email.toLowerCase().trim(),
          subject: "CLVRQuant — Password Reset",
          text: `Hello ${user.name},\n\nYou requested a password reset.\n\nTemporary password: ${tempPassword}\n\nOr reset via link (expires in 1 hour):\n${resetLink}\n\nIf you didn't request this, ignore this email.\n\n© 2026 CLVRQuant · MikeClaver@CLVRQuantAI.com`,
          html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
            <div style="text-align:center;margin-bottom:24px">
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d">CLVRQuant</div>
              <div style="font-family:monospace;font-size:10px;color:#4a5d80;letter-spacing:0.3em;margin-top:4px">PASSWORD RESET</div>
            </div>
            <div style="border-top:1px solid #141e35;padding-top:20px">
              <p style="font-size:14px;color:#f0f4ff">Hello ${user.name},</p>
              <p style="font-size:13px;color:#6b7fa8;line-height:1.8">You requested a password reset. Here is your temporary password:</p>
              <div style="background:#0c1220;border:1px solid #c9a84c;border-radius:4px;padding:16px;margin:16px 0;text-align:center">
                <div style="font-family:monospace;font-size:22px;color:#e8c96d;letter-spacing:0.15em;font-weight:900">${tempPassword}</div>
              </div>
              <p style="font-size:13px;color:#6b7fa8;line-height:1.8">Use this temporary password to sign in, then set a new password. Or click the link below:</p>
              <div style="text-align:center;margin:20px 0">
                <a href="${resetLink}" style="background:rgba(201,168,76,0.15);color:#e8c96d;padding:12px 32px;border-radius:4px;text-decoration:none;font-family:Georgia,serif;font-weight:700;font-size:14px;border:1px solid rgba(201,168,76,0.3)">Reset Password →</a>
              </div>
              <p style="font-size:11px;color:#4a5d80;margin-top:20px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
              <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#4a5d80;text-decoration:none;">MikeClaver@CLVRQuantAI.com</a></p>
            </div>
          </div>`,
        });
        await storage.updateUserPassword(user.id, hashedTemp);
        await pool.query("UPDATE users SET must_change_password = true WHERE id = $1", [user.id]);
      } catch (emailErr: any) {
        console.error("Reset email failed:", emailErr.message);
        await storage.clearResetToken(user.id);
      }
      res.json({ ok: true });
    } catch (e: any) {
      console.error("Forgot password error:", e.message);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token) return res.status(400).json({ error: "Reset token required" });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    try {
      const user = await storage.getUserByResetToken(token);
      if (!user) return res.status(400).json({ error: "Invalid or expired reset link" });
      if (user.resetTokenExpiry && new Date(user.resetTokenExpiry) < new Date()) {
        return res.status(400).json({ error: "Reset link has expired. Please request a new one." });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(user.id, hashed);
      await storage.clearResetToken(user.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  app.get("/api/account", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const tier = user.email === OWNER_EMAIL ? "pro" : user.tier;
      const subRow = await pool.query("SELECT active FROM subscribers WHERE email = $1", [user.email]);
      const dailyEmail = subRow.rows.length > 0 ? subRow.rows[0].active : false;
      let stripeInfo: any = null;
      if (user.stripeSubscriptionId) {
        try {
          const stripe = await getUncachableStripeClient();
          const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          stripeInfo = {
            status: sub.status,
            currentPeriodEnd: (sub as any).current_period_end ? new Date((sub as any).current_period_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null,
            cancelAtPeriodEnd: (sub as any).cancel_at_period_end || false,
            paused: !!(sub as any).pause_collection,
            interval: (sub as any).items?.data?.[0]?.price?.recurring?.interval || "month",
            amount: (sub as any).items?.data?.[0]?.price?.unit_amount ? "$" + ((sub as any).items.data[0].price.unit_amount / 100).toFixed(2) : null,
          };
        } catch (e: any) { console.log("[account] Stripe sub fetch error:", e.message); }
      }
      let invoices: any[] = [];
      if (user.stripeCustomerId) {
        try {
          const stripe = await getUncachableStripeClient();
          const inv = await stripe.invoices.list({ customer: user.stripeCustomerId, limit: 10 });
          invoices = inv.data.map((i: any) => ({
            date: new Date(i.created * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            description: i.lines?.data?.[0]?.description || "CLVRQuant Pro",
            amount: "$" + ((i.amount_paid || 0) / 100).toFixed(2),
            status: i.status === "paid" ? "Paid" : i.status,
          }));
        } catch (e: any) { console.log("[account] Stripe invoices fetch error:", e.message); }
      }
      res.json({
        id: user.id, name: user.name, email: user.email, tier,
        memberSince: user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "2026",
        dailyEmail,
        stripeCustomerId: user.stripeCustomerId || null,
        stripeSubscriptionId: user.stripeSubscriptionId || null,
        subscription: stripeInfo,
        invoices,
        referralCode: user.referralCode || null,
        promoCode: user.promoCode || null,
        promoExpiresAt: user.promoExpiresAt ? new Date(user.promoExpiresAt).toISOString() : null,
        isOwner: user.email === OWNER_EMAIL,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/account/toggle-daily-email", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const { subscribe } = req.body;
      if (subscribe) {
        await pool.query(
          "INSERT INTO subscribers (id, email, name, active) VALUES (gen_random_uuid(), $1, $2, true) ON CONFLICT (email) DO UPDATE SET active = true",
          [user.email, user.name]
        );
      } else {
        await pool.query("UPDATE subscribers SET active = false WHERE email = $1", [user.email]);
      }
      res.json({ ok: true, dailyEmail: !!subscribe });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/account", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.stripeSubscriptionId) {
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        } catch (e: any) { console.log("[account] Stripe cancel error:", e.message); }
      }
      await pool.query("UPDATE subscribers SET active = false WHERE email = $1", [user.email]);
      await pool.query("UPDATE access_codes SET used_by = NULL, used_at = NULL WHERE used_by = $1", [userId]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      req.session.destroy(() => {});
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/access-codes", async (req, res) => {
    const ownerCode = req.query.ownerCode as string;
    if (ownerCode !== OWNER_CODE) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    try {
      const codes = await storage.listAccessCodes();
      res.json(codes);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  setInterval(() => { checkPromoExpiryReminders().catch(() => {}); }, 86400000);
  setTimeout(() => { checkPromoExpiryReminders().catch(() => {}); }, 60000);
  setInterval(async () => {
    try { const n = await storage.deleteExpiredAlerts(); if (n > 0) console.log(`[cleanup] Deleted ${n} expired alerts`); } catch {}
  }, 3600000);
  setTimeout(async () => {
    try { const n = await storage.deleteExpiredAlerts(); if (n > 0) console.log(`[cleanup] Deleted ${n} expired alerts`); } catch {}
  }, 30000);

  // ── Server-side alert checking (lock screen push notifications) ──────────────
  // Refresh prices every 30s, check alerts every 15s
  setInterval(() => { refreshServerPriceCache().catch(() => {}); }, 30000);
  setInterval(() => { checkServerAlerts().catch(() => {}); }, 15000);
  // Initial warm-up: cache prices first, then immediately check alerts
  setTimeout(async () => {
    await refreshServerPriceCache().catch(() => {});
    await checkServerAlerts().catch(() => {});
    console.log("[alerts] Server-side alert checker started");
  }, 8000);

  return httpServer;
}
