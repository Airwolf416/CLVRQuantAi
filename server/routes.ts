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
const FINNHUB_TTL = 60000;

let finnhubFetchInProgress: Promise<any> | null = null;

async function fhQuote(symbol: string) {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
  );
  if (!r.ok) throw new Error(`Finnhub ${r.status}`);
  const d: any = await r.json();
  if (!d || !d.c || d.c === 0) throw new Error("zero price");
  return {
    price: d.c,
    chg: d.dp ?? (d.pc ? ((d.c - d.pc) / d.pc * 100) : 0),
    live: true
  };
}

async function fetchForexRates(): Promise<Record<string, any>> {
  const forex: Record<string, any> = {};
  try {
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (!r.ok) throw new Error(`ExchangeRate ${r.status}`);
    const data: any = await r.json();
    const rates = data.rates || {};
    const pairs: Record<string, { from: string; to: string; invert: boolean }> = {
      EURUSD: { from: "USD", to: "EUR", invert: true },
      GBPUSD: { from: "USD", to: "GBP", invert: true },
      USDJPY: { from: "USD", to: "JPY", invert: false },
      USDCHF: { from: "USD", to: "CHF", invert: false },
      AUDUSD: { from: "USD", to: "AUD", invert: true },
      USDCAD: { from: "USD", to: "CAD", invert: false },
    };
    for (const [sym, cfg] of Object.entries(pairs)) {
      const rate = rates[cfg.to];
      if (rate) {
        const price = cfg.invert ? +(1 / rate).toFixed(4) : +rate.toFixed(4);
        const base = FOREX_BASE[sym];
        forex[sym] = {
          price,
          chg: base ? +((price - base) / base * 100).toFixed(2) : 0,
          live: true
        };
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

async function fetchMetalPrices(): Promise<Record<string, any>> {
  const metals: Record<string, any> = {};
  try {
    const r = await fetch("https://api.metalpriceapi.com/v1/latest?api_key=demo&base=USD&currencies=XAU,XAG");
    if (r.ok) {
      const data: any = await r.json();
      if (data.rates?.XAU) {
        const goldPrice = +(1 / data.rates.XAU).toFixed(2);
        metals.XAU = { price: goldPrice, chg: +((goldPrice - METALS_BASE.XAU) / METALS_BASE.XAU * 100).toFixed(2), live: true };
      }
      if (data.rates?.XAG) {
        const silverPrice = +(1 / data.rates.XAG).toFixed(2);
        metals.XAG = { price: silverPrice, chg: +((silverPrice - METALS_BASE.XAG) / METALS_BASE.XAG * 100).toFixed(2), live: true };
      }
    }
  } catch {}
  if (!metals.XAU) metals.XAU = { price: METALS_BASE.XAU, chg: 0, live: false };
  if (!metals.XAG) metals.XAG = { price: METALS_BASE.XAG, chg: 0, live: false };
  return metals;
}

async function doFinnhubFetch() {
  const stocks: Record<string, any> = {};

  for (let i = 0; i < EQUITY_SYMS.length; i += 4) {
    const batch = EQUITY_SYMS.slice(i, i + 4);
    await Promise.allSettled(
      batch.map(async sym => {
        try { stocks[sym] = await fhQuote(sym); }
        catch { stocks[sym] = { price: EQUITY_BASE[sym], chg: 0, live: false }; }
      })
    );
    if (i + 4 < EQUITY_SYMS.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const [metals, forex] = await Promise.all([
    fetchMetalPrices(),
    fetchForexRates()
  ]);

  return { stocks, metals, forex };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/crypto", async (_req, res) => {
    const cached = cache["crypto"];
    if (cached && Date.now() - cached.ts < CRYPTO_TTL) {
      return res.json(cached.data);
    }
    try {
      const r1 = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" })
      });
      const mids: any = await r1.json();

      const r2 = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" })
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
    if (cached && Date.now() - cached.ts < FINNHUB_TTL) {
      return res.json(cached.data);
    }
    if (finnhubFetchInProgress) {
      try {
        const result = await finnhubFetchInProgress;
        return res.json(result);
      } catch {
        const fallback = cache["finnhub"];
        if (fallback) return res.json(fallback.data);
        return res.status(500).json({ error: "Finnhub fetch failed" });
      }
    }
    try {
      finnhubFetchInProgress = doFinnhubFetch();
      const result = await finnhubFetchInProgress;
      finnhubFetchInProgress = null;
      cache["finnhub"] = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
      finnhubFetchInProgress = null;
      const fallback = cache["finnhub"];
      if (fallback) return res.json(fallback.data);
      res.status(500).json({ error: e.message });
    }
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
