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

const FH_METALS: Record<string, string> = { XAU:"OANDA:XAU_USD", XAG:"OANDA:XAG_USD" };
const FH_FOREX: Record<string, string> = {
  EURUSD:"OANDA:EUR_USD", GBPUSD:"OANDA:GBP_USD",
  USDJPY:"OANDA:USD_JPY", USDCHF:"OANDA:USD_CHF",
  AUDUSD:"OANDA:AUD_USD", USDCAD:"OANDA:USD_CAD"
};

const cache: Record<string, { data: any; ts: number }> = {};
const CRYPTO_TTL = 2000;
const FINNHUB_TTL = 10000;

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
    try {
      const stocks: Record<string, any> = {};
      const metals: Record<string, any> = {};
      const forex: Record<string, any> = {};

      await Promise.allSettled([
        ...EQUITY_SYMS.map(async sym => {
          try { stocks[sym] = await fhQuote(sym); }
          catch { stocks[sym] = { price: EQUITY_BASE[sym], chg: 0, live: false }; }
        }),
        ...Object.entries(FH_METALS).map(async ([sym, fhSym]) => {
          try { metals[sym] = await fhQuote(fhSym); }
          catch { metals[sym] = { price: METALS_BASE[sym], chg: 0, live: false }; }
        }),
        ...Object.entries(FH_FOREX).map(async ([sym, fhSym]) => {
          try { forex[sym] = await fhQuote(fhSym); }
          catch { forex[sym] = { price: FOREX_BASE[sym], chg: 0, live: false }; }
        }),
      ]);

      const result = { stocks, metals, forex };
      cache["finnhub"] = { data: result, ts: Date.now() };
      res.json(result);
    } catch (e: any) {
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
