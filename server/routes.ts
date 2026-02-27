import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE"];
const CRYPTO_BASE: Record<string, number> = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072};

const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR"];
const EQUITY_BASE: Record<string, number> = {TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310};

const METALS_BASE: Record<string, number> = {XAU:3285,XAG:32.8};
const FOREX_BASE: Record<string, number> = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654};

const cache: Record<string, { data: any; ts: number }> = {};
const CRYPTO_TTL = 3000;
const FINNHUB_TTL = 120000;

let finnhubFetchLock: Promise<any> | null = null;
let stockRefreshRunning = false;

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

  app.get("/api/crypto", async (_req, res) => {
    const cached = cache["crypto"];
    if (cached && Date.now() - cached.ts < CRYPTO_TTL) {
      return res.json(cached.data);
    }
    try {
      const r1 = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        signal: AbortSignal.timeout(5000)
      });
      const mids: any = await r1.json();

      const r2 = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
        signal: AbortSignal.timeout(5000)
      });
      const meta: any = await r2.json();
      const universe = meta[0].universe;
      const ctxs = meta[1];
      const funding: Record<string, any> = {};
      universe.forEach((asset: any, i: number) => {
        if (CRYPTO_SYMS.includes(asset.name)) {
          funding[asset.name] = {
            funding: +(parseFloat(ctxs[i]?.funding || 0) * 100).toFixed(4),
            oi: parseFloat(ctxs[i]?.openInterest || 0) * parseFloat(ctxs[i]?.markPx || 0)
          };
        }
      });

      const result: Record<string, any> = {};
      CRYPTO_SYMS.forEach(sym => {
        if (mids[sym]) {
          const price = parseFloat(mids[sym]);
          const base = CRYPTO_BASE[sym];
          result[sym] = {
            price,
            chg: base ? +((price - base) / base * 100).toFixed(2) : 0,
            funding: funding[sym]?.funding || 0,
            oi: funding[sym]?.oi || 0,
            live: true
          };
        }
      });
      cache["crypto"] = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      const fallback = cache["crypto"];
      if (fallback) return res.json(fallback.data);
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

  return httpServer;
}
