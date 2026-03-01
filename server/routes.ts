import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE"];
const CRYPTO_BASE: Record<string, number> = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072};
const BINANCE_MAP: Record<string, string> = {BTC:"BTCUSDT",ETH:"ETHUSDT",SOL:"SOLUSDT",WIF:"WIFUSDT",DOGE:"DOGEUSDT",AVAX:"AVAXUSDT",LINK:"LINKUSDT",ARB:"ARBUSDT",PEPE:"PEPEUSDT"};
const BINANCE_SYMS = Object.values(BINANCE_MAP);

const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR"];
const EQUITY_BASE: Record<string, number> = {TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310};

const METALS_BASE: Record<string, number> = {XAU:3285,XAG:32.8};
const FOREX_BASE: Record<string, number> = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654};

const cache: Record<string, { data: any; ts: number }> = {};
const FINNHUB_TTL = 120000;

let finnhubFetchLock: Promise<any> | null = null;
let stockRefreshRunning = false;
let hlRefreshRunning = false;
const hlData: Record<string, { funding: number; oi: number }> = {};

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
        result[sym] = {
          price,
          chg: parseFloat(t.priceChangePercent),
          funding: hlData[sym]?.funding || 0,
          oi: hlData[sym]?.oi || 0,
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
          result[sym] = {
            price,
            chg: CRYPTO_BASE[sym] ? +((price - CRYPTO_BASE[sym]) / CRYPTO_BASE[sym] * 100).toFixed(2) : 0,
            funding: hlData[sym]?.funding || 0,
            oi: hlData[sym]?.oi || 0,
            live: true,
          };
        }
      }
    } catch {}
  }
  return result;
}

async function startHyperliquidRefreshLoop() {
  if (hlRefreshRunning) return;
  hlRefreshRunning = true;
  while (true) {
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(5000),
      });
      const meta: any = await r.json();
      const universe = meta[0].universe;
      const ctxs = meta[1];
      universe.forEach((asset: any, i: number) => {
        if (CRYPTO_SYMS.includes(asset.name)) {
          hlData[asset.name] = {
            funding: +(parseFloat(ctxs[i]?.funding || 0) * 100).toFixed(4),
            oi: parseFloat(ctxs[i]?.openInterest || 0) * parseFloat(ctxs[i]?.markPx || 0),
          };
        }
      });
    } catch (e: any) {
      console.error("Hyperliquid refresh error:", e.message);
    }
    await delay(10000);
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
        stocks[sym] = await fhQuoteSafe(sym);
        await delay(1500);
      }

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
  } catch {
    for (const sym of Object.keys(FOREX_BASE)) {
      forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false };
    }
  }
  return forex;
}

async function fetchMetals(): Promise<Record<string, any>> {
  const metals: Record<string, any> = {};
  for (const sym of ["XAU", "XAG"] as const) {
    try {
      const r = await fetch(
        `https://api.gold-api.com/price/${sym}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        const d: any = await r.json();
        if (d?.price && d.price > 0) {
          const base = METALS_BASE[sym];
          metals[sym] = { price: d.price, chg: base ? +((d.price - base) / base * 100).toFixed(2) : 0, live: true };
          continue;
        }
      }
    } catch {}
    metals[sym] = { price: METALS_BASE[sym], chg: 0, live: false };
  }
  return metals;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  startStockRefreshLoop();
  startHyperliquidRefreshLoop();

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

  app.get("/api/finnhub", async (_req, res) => {
    const cached = cache["finnhub"];
    if (cached) {
      return res.json(cached.data);
    }
    const stocks: Record<string, any> = {};
    EQUITY_SYMS.forEach(sym => { stocks[sym] = { price: EQUITY_BASE[sym], chg: 0, live: false }; });
    const metals: Record<string, any> = { XAU: { price: METALS_BASE.XAU, chg: 0, live: false }, XAG: { price: METALS_BASE.XAG, chg: 0, live: false } };
    const forex: Record<string, any> = {};
    Object.entries(FOREX_BASE).forEach(([sym, price]) => { forex[sym] = { price, chg: 0, live: false }; });
    res.json({ stocks, metals, forex });
  });

  app.post("/api/ai/analyze", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Anthropic API key not configured" });
    }

    const { system, userMessage } = req.body;
    if (!userMessage) {
      return res.status(400).json({ error: "userMessage is required" });
    }

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
          max_tokens: 500,
          system: system || "",
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `API Error ${response.status}: ${errorText}` });
      }

      const data: any = await response.json();
      if (data.error) {
        return res.status(400).json({ error: data.error.message });
      }

      const text = (data.content || []).map((b: any) => b.text || "").join("") || "No response.";
      res.json({ text });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── MACRO CALENDAR ──────────────────────────────────────
  const MACRO_2026 = [
    // FED (FOMC) 2026 — published schedule
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-01-28",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve interest rate decision with press conference.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-03-18",time:"14:00 ET",impact:"HIGH",desc:"FOMC meeting with updated dot plot and economic projections.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-04-29",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision. Watch for guidance on rate path.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-06-17",time:"14:00 ET",impact:"HIGH",desc:"Mid-year FOMC with economic projections update.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-07-29",time:"14:00 ET",impact:"HIGH",desc:"July FOMC rate decision.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-09-16",time:"14:00 ET",impact:"HIGH",desc:"September FOMC with updated dot plot.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-11-04",time:"14:00 ET",impact:"HIGH",desc:"November FOMC rate decision.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-12-16",time:"14:00 ET",impact:"HIGH",desc:"Final 2026 FOMC with year-end projections.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-02-18",time:"14:00 ET",impact:"MED",desc:"Minutes from January FOMC meeting.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-04-08",time:"14:00 ET",impact:"MED",desc:"Minutes from March FOMC meeting.",currency:"USD"},
    // ECB 2026
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-01-22",time:"13:45 CET",impact:"HIGH",desc:"ECB monetary policy decision with press conference.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-03-05",time:"13:45 CET",impact:"HIGH",desc:"ECB rate decision. Watch Lagarde presser for EUR/USD direction.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-04-16",time:"13:45 CET",impact:"HIGH",desc:"Spring ECB meeting with updated staff projections.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-06-04",time:"13:45 CET",impact:"HIGH",desc:"ECB mid-year rate decision.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-07-16",time:"13:45 CET",impact:"HIGH",desc:"July ECB monetary policy decision.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-09-10",time:"13:45 CET",impact:"HIGH",desc:"September ECB with updated projections.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-10-29",time:"13:45 CET",impact:"HIGH",desc:"October ECB rate decision.",currency:"EUR"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-12-17",time:"13:45 CET",impact:"HIGH",desc:"Final 2026 ECB meeting.",currency:"EUR"},
    // BOJ 2026
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-01-22",time:"~03:00 ET",impact:"HIGH",desc:"Bank of Japan monetary policy decision. USD/JPY highly sensitive.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-03-19",time:"~03:00 ET",impact:"HIGH",desc:"BOJ spring meeting. Watch for rate hike signals.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-04-28",time:"~03:00 ET",impact:"HIGH",desc:"BOJ with updated quarterly outlook report.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-06-18",time:"~03:00 ET",impact:"HIGH",desc:"June BOJ. Hawkish surprise = major JPY rally.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-07-16",time:"~03:00 ET",impact:"HIGH",desc:"Mid-year BOJ with outlook report update.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-09-17",time:"~03:00 ET",impact:"HIGH",desc:"September BOJ meeting.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-10-29",time:"~03:00 ET",impact:"HIGH",desc:"October BOJ with quarterly outlook.",currency:"JPY"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-12-18",time:"~03:00 ET",impact:"HIGH",desc:"Final 2026 BOJ meeting.",currency:"JPY"},
    // BOC 2026
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-01-21",time:"09:45 ET",impact:"HIGH",desc:"Bank of Canada rate decision with MPR.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-03-04",time:"09:45 ET",impact:"HIGH",desc:"BOC rate decision. Oil prices key for CAD outlook.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-04-15",time:"09:45 ET",impact:"HIGH",desc:"Spring BOC with MPR update.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-06-03",time:"09:45 ET",impact:"HIGH",desc:"June BOC rate decision.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-07-15",time:"09:45 ET",impact:"HIGH",desc:"Mid-year BOC with MPR.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-09-09",time:"09:45 ET",impact:"HIGH",desc:"September BOC rate decision.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-10-28",time:"09:45 ET",impact:"HIGH",desc:"October BOC with MPR update.",currency:"CAD"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-12-09",time:"09:45 ET",impact:"HIGH",desc:"Final 2026 BOC meeting.",currency:"CAD"},
    // BOE 2026
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-02-05",time:"12:00 GMT",impact:"HIGH",desc:"Bank of England rate decision with Monetary Policy Report.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-03-19",time:"12:00 GMT",impact:"HIGH",desc:"BOE rate decision. GBP/USD driven by BoE tone.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-05-07",time:"12:00 GMT",impact:"HIGH",desc:"Spring BOE with updated MPR.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-06-18",time:"12:00 GMT",impact:"HIGH",desc:"June BOE rate decision.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-08-06",time:"12:00 GMT",impact:"HIGH",desc:"August BOE with MPR update.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-09-17",time:"12:00 GMT",impact:"HIGH",desc:"September BOE meeting.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-11-05",time:"12:00 GMT",impact:"HIGH",desc:"November BOE with MPR.",currency:"GBP"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-12-17",time:"12:00 GMT",impact:"HIGH",desc:"Final 2026 BOE meeting.",currency:"GBP"},
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
  ].map((e, i) => ({ ...e, id: i + 1, current: "—", forecast: "—" }));

  let macroCache: { data: any[]; ts: number } = { data: [], ts: 0 };
  const MACRO_CACHE_MS = 600000; // 10 minutes

  function getDateRange() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const endDate = new Date(todayStart);
    endDate.setDate(todayStart.getDate() + 14);
    endDate.setHours(23, 59, 59, 999);
    return { todayStart, endDate };
  }

  async function fetchLiveCalendar(): Promise<any[]> {
    try {
      const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
        headers: { "User-Agent": "AlphaScan/1.0" },
      });
      if (!res.ok) return [];
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) return [];
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return []; }
      if (!Array.isArray(data)) return [];
      const relevant = data.filter((e: any) =>
        (e.impact === "High" || e.impact === "Medium") &&
        ["USD","EUR","GBP","JPY","CAD","AUD","CHF","NZD"].includes(e.country) &&
        e.title !== "Bank Holiday"
      );
      return relevant.map((e: any, i: number) => ({
        id: 10000 + i,
        bank: mapCountryToBank(e.country, e.title),
        flag: countryFlag(e.country),
        name: e.title,
        date: e.date ? e.date.split("T")[0] : "",
        time: e.date ? new Date(e.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "",
        current: e.previous || "—",
        forecast: e.forecast || "—",
        impact: e.impact === "High" ? "HIGH" : "MED",
        desc: `${e.title}. Previous: ${e.previous || "N/A"}. Forecast: ${e.forecast || "TBD"}.`,
        currency: e.country,
        live: true,
      }));
    } catch {
      return [];
    }
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
      let liveEvents: any[] = [];
      const cacheExpired = Date.now() - macroCache.ts > MACRO_CACHE_MS;
      if (cacheExpired) {
        const fetched = await fetchLiveCalendar();
        if (fetched.length > 0) {
          macroCache = { data: fetched, ts: Date.now() };
          liveEvents = fetched;
        } else if (macroCache.data.length > 0) {
          liveEvents = macroCache.data;
        } else {
          macroCache = { data: [], ts: Date.now() - MACRO_CACHE_MS + 60000 };
          liveEvents = [];
        }
      } else {
        liveEvents = macroCache.data;
      }
      const { todayStart, endDate } = getDateRange();
      const existingDates = new Set(liveEvents.map((e: any) => `${e.date}-${e.name}`));
      const combined = [
        ...liveEvents,
        ...MACRO_2026.filter(e => !existingDates.has(`${e.date}-${e.name}`)),
      ]
        .filter(e => {
          const d = new Date(e.date);
          return d >= todayStart && d <= endDate;
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      res.json(combined);
    } catch (e: any) {
      const { todayStart, endDate } = getDateRange();
      res.json(MACRO_2026.filter(e => {
        const d = new Date(e.date);
        return d >= todayStart && d <= endDate;
      }));
    }
  });

  const subscribers: { email: string; name: string; timestamp: string }[] = [];

  app.post("/api/subscribe", async (req, res) => {
    const { email, name } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const exists = subscribers.find(s => s.email === email);
    if (!exists) {
      subscribers.push({ email, name: name || "Trader", timestamp: new Date().toISOString() });
    }
    res.json({ ok: true, count: subscribers.length });
  });

  return httpServer;
}
