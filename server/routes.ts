import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { pool } from "./db";
import bcrypt from "bcryptjs";
import { getUncachableResendClient } from "./resendClient";
import WebSocket from "ws";

const FINNHUB_KEY = process.env.FINNHUB_KEY || "";

const CRYPTO_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP","BNB","ADA","DOT","MATIC","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const CRYPTO_BASE: Record<string, number> = {BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,MATIC:0.55,UNI:9.5,AAVE:220,NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18,TRUMP:3.5,HYPE:31};
const BINANCE_MAP: Record<string, string> = {BTC:"BTCUSDT",ETH:"ETHUSDT",SOL:"SOLUSDT",WIF:"WIFUSDT",DOGE:"DOGEUSDT",AVAX:"AVAXUSDT",LINK:"LINKUSDT",ARB:"ARBUSDT",PEPE:"PEPEUSDT",XRP:"XRPUSDT",BNB:"BNBUSDT",ADA:"ADAUSDT",DOT:"DOTUSDT",UNI:"UNIUSDT",AAVE:"AAVEUSDT",NEAR:"NEARUSDT",SUI:"SUIUSDT",APT:"APTUSDT",OP:"OPUSDT",TIA:"TIAUSDT",SEI:"SEIUSDT",JUP:"JUPUSDT",ONDO:"ONDOUSDT",RENDER:"RENDERUSDT",FET:"FETUSDT",HBAR:"HBARUSDT",TRUMP:"TRUMPUSDT",HYPE:"HYPEUSDT"};
const BINANCE_SYMS = Object.values(BINANCE_MAP);

const HL_PERP_SYMS = ["BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","kPEPE","XRP","BNB","ADA","DOT","MATIC","UNI","AAVE","NEAR","SUI","APT","OP","TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE"];
const HL_TO_APP: Record<string, string> = {kPEPE:"PEPE"};
const APP_TO_HL: Record<string, string> = {PEPE:"kPEPE"};

const EQUITY_SYMS = ["TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR","COIN","SQ","SHOP","CRM","NFLX","DIS"];
const EQUITY_BASE: Record<string, number> = {TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,MSTR:310,AMD:145,PLTR:70,COIN:210,SQ:66,SHOP:95,CRM:290,NFLX:850,DIS:105};
const EQUITY_FH_MAP: Record<string, string> = { SQ: "XYZ" };

const METALS_BASE: Record<string, number> = {XAU:5160,XAG:84,WTI:91,BRENT:93,NATGAS:4,COPPER:5.8,PLATINUM:2150};
const metalsRef: Record<string, {price:number,ts:number}> = {};

const ENERGY_ETF_MAP: Record<string, {etfSym: string, factor: number}> = {
  WTI: { etfSym: "USO", factor: 0.840 },
  BRENT: { etfSym: "BNO", factor: 2.105 },
  NATGAS: { etfSym: "UNG", factor: 0.32 },
};
const FOREX_BASE: Record<string, number> = {EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,AUDUSD:0.6524,USDCAD:1.3654,NZDUSD:0.5932,EURGBP:0.8526,EURJPY:162.45,GBPJPY:190.52,USDMXN:17.15,USDZAR:18.45,USDTRY:32.5,USDSGD:1.34};

const cache: Record<string, { data: any; ts: number }> = {};
const FINNHUB_TTL = 120000;

let finnhubFetchLock: Promise<any> | null = null;
let stockRefreshRunning = false;
let hlRefreshRunning = false;
const hlData: Record<string, { funding: number; oi: number; perpPrice: number; volume: number }> = {};

const priceHistory: Record<string, { price: number; ts: number }[]> = {};
const liveSignals: any[] = [];
let signalIdCounter = 10000;
const MOVE_THRESHOLD = 0.8;
const MOVE_WINDOW = 5 * 60 * 1000;
const SIGNAL_COOLDOWN = 10 * 60 * 1000;
const lastSignalTime: Record<string, number> = {};

function recordPrice(sym: string, price: number) {
  if (!price || price <= 0) return;
  const now = Date.now();
  if (!priceHistory[sym]) priceHistory[sym] = [];
  priceHistory[sym].push({ price, ts: now });
  priceHistory[sym] = priceHistory[sym].filter(p => now - p.ts < 15 * 60 * 1000);
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
    if (Math.abs(pctMove) < MOVE_THRESHOLD) continue;

    const dir = pctMove > 0 ? "LONG" : "SHORT";
    const icon = pctMove > 0 ? "+" : "-";
    const absPct = Math.abs(pctMove).toFixed(1);
    const elapsed = Math.round((current.ts - windowStart.ts) / 60000);
    const hl = hlData[sym];
    const fundingStr = hl?.funding ? ` Funding: ${hl.funding >= 0 ? "+" : ""}${(hl.funding).toFixed(4)}%/8h.` : "";
    const oiStr = hl?.oi ? ` OI: $${(hl.oi / 1e6).toFixed(0)}M.` : "";

    const desc = pctMove > 0
      ? `${sym} pumped +${absPct}% in ${elapsed}min. Price moved from $${fmt2(windowStart.price, sym)} to $${fmt2(current.price, sym)}.${fundingStr}${oiStr}`
      : `${sym} dumped ${absPct}% in ${elapsed}min. Price dropped from $${fmt2(windowStart.price, sym)} to $${fmt2(current.price, sym)}.${fundingStr}${oiStr}`;

    const confBase = Math.min(95, 65 + Math.floor(Math.abs(pctMove) * 5));
    const tags = [
      { l: "LIVE DETECTED", c: "green" },
      { l: Math.abs(pctMove) >= 3 ? "MAJOR MOVE" : "BREAKOUT", c: Math.abs(pctMove) >= 3 ? "red" : "orange" },
    ];
    if (hl?.funding && Math.abs(hl.funding) > 0.01) tags.push({ l: hl.funding > 0 ? "HIGH FUND" : "NEG FUND", c: hl.funding > 0 ? "orange" : "green" });

    const signal = {
      id: signalIdCounter++,
      icon,
      dir,
      token: sym,
      conf: confBase,
      lev: Math.abs(pctMove) >= 3 ? "5x" : "3x",
      src: "alpha-detect",
      desc,
      tags,
      ts: now,
      real: true,
      pctMove: +pctMove.toFixed(2),
    };

    liveSignals.unshift(signal);
    if (liveSignals.length > 50) liveSignals.length = 50;
    lastSignalTime[sym] = now;
    console.log(`[SIGNAL] ${sym} ${dir} ${absPct}% in ${elapsed}min — price $${fmt2(current.price, sym)}`);
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
        }
      });
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
const FOREX_FH_SYMS: Record<string, string> = {
  "OANDA:EUR_USD":"EURUSD","OANDA:GBP_USD":"GBPUSD","OANDA:USD_JPY":"USDJPY",
  "OANDA:USD_CHF":"USDCHF","OANDA:AUD_USD":"AUDUSD","OANDA:USD_CAD":"USDCAD",
  "OANDA:NZD_USD":"NZDUSD","OANDA:EUR_GBP":"EURGBP","OANDA:EUR_JPY":"EURJPY",
  "OANDA:GBP_JPY":"GBPJPY","OANDA:USD_MXN":"USDMXN","OANDA:USD_ZAR":"USDZAR",
  "OANDA:USD_TRY":"USDTRY","OANDA:USD_SGD":"USDSGD",
};

const livePrices: Record<string, { price: number; chg: number; ts: number; type: string }> = {};
const sseClients: Set<Response> = new Set();

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
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    ws.on("open", () => {
      fhWsConnected = true;
      retries = 0;
      for (const sym of Object.keys(FH_WS_SYMS)) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      }
      for (const sym of Object.keys(FOREX_FH_SYMS)) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      }
      console.log(`[finnhub-ws] connected, subscribed to ${Object.keys(FH_WS_SYMS).length} equities/ETFs + ${Object.keys(FOREX_FH_SYMS).length} forex`);
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
    ws.on("error", () => { fhWsConnected = false; });
    ws.on("close", () => {
      fhWsConnected = false;
      retries++;
      const backoff = Math.min(retries * 3000, 30000);
      console.log(`[finnhub-ws] disconnected, retrying in ${backoff / 1000}s`);
      setTimeout(connect, backoff);
    });
  };
  connect();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  startStockRefreshLoop();
  startHyperliquidRefreshLoop();
  startFinnhubWebSocket();

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
    res.json({
      signals: filtered,
      tracking: Object.keys(priceHistory).length,
      historyDepth: Object.values(priceHistory).reduce((sum, h) => sum + h.length, 0),
    });
  });

  app.get("/api/news", async (_req, res) => {
    const cached = cache["news"];
    if (cached && Date.now() - cached.ts < 120000) {
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
        const posts = data?.Data || [];
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
            const posts = data?.results || [];
            for (const p of posts.slice(0, 10)) {
              const currencies = (p.currencies || []).map((c: any) => c.code).filter(Boolean);
              const votes = p.votes || {};
              const pos = (votes.positive || 0) + (votes.important || 0) + (votes.liked || 0);
              const neg = (votes.negative || 0) + (votes.disliked || 0) + (votes.toxic || 0);
              const sentiment = pos + neg > 0 ? (pos - neg) / (pos + neg) : 0;
              results.push({
                id: "cp-" + p.id,
                source: p.source?.title || "CryptoPanic",
                icon: "CP",
                color: "cyan",
                title: p.title,
                body: "",
                sentiment,
                score: Math.min(10, Math.max(1, pos + 3)),
                assets: currencies.length > 0 ? currencies : matchAssets(p.title),
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
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
    if (RAPIDAPI_KEY) {
      const TWITTER_ACCOUNTS = [
        { handle: "whale_alert", label: "Whale Alert", icon: "W", color: "cyan" },
        { handle: "lookonchain", label: "Lookonchain", icon: "L", color: "blue" },
        { handle: "tier10k", label: "Tier10K", icon: "T", color: "gold" },
        { handle: "CryptoKaleo", label: "CryptoKaleo", icon: "K", color: "teal" },
        { handle: "zaborowskim", label: "Zack", icon: "Z", color: "orange" },
      ];
      for (const acc of TWITTER_ACCOUNTS.slice(0, 3)) {
        try {
          const r = await fetch(`https://twitter-api45.p.rapidapi.com/timeline.php?screenname=${acc.handle}&count=3`, {
            headers: { "X-RapidAPI-Key": RAPIDAPI_KEY, "X-RapidAPI-Host": "twitter-api45.p.rapidapi.com" },
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) {
            const data: any = await r.json();
            const tweets = data?.timeline || [];
            for (const tw of tweets.slice(0, 3)) {
              if (!tw.text) continue;
              const assets = matchAssets(tw.text);
              const favs = parseInt(tw.favorites) || 0;
              const rts = parseInt(tw.retweets) || 0;
              const engagement = favs + rts;
              results.push({
                id: "tw-" + tw.tweet_id,
                source: `@${acc.handle}`,
                icon: acc.icon,
                color: acc.color,
                title: tw.text.replace(/https:\/\/t\.co\/\S+/g, "").trim().substring(0, 200),
                body: "",
                sentiment: engagement > 500 ? 0.75 : engagement > 100 ? 0.5 : 0.3,
                score: Math.min(10, Math.round(engagement / 500) + 4),
                assets,
                categories: ["twitter"],
                ts: new Date(tw.created_at || Date.now()).getTime(),
                url: `https://x.com/${acc.handle}/status/${tw.tweet_id}`,
                imageUrl: null,
              });
            }
          }
        } catch (e: any) {
          console.error(`Twitter fetch error (${acc.handle}):`, e.message);
        }
      }
    }
    results.sort((a, b) => b.ts - a.ts);
    const deduped = results.filter((item, index, self) =>
      index === self.findIndex(t => t.title === item.title)
    ).slice(0, 25);
    cache["news"] = { data: deduped, ts: Date.now() };
    res.json(deduped);
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

  app.post("/api/ai/analyze", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Anthropic API key not configured" });
    }

    const system = req.body.system || req.body.systemPrompt || "";
    const userMessage = req.body.userMessage || req.body.prompt || "";
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
          max_tokens: 1024,
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
      res.json({ text, response: text });
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

  const COUNTRY_TO_REGION: Record<string,string> = {
    USD:"United States",EUR:"Eurozone",GBP:"United Kingdom",
    CAD:"Canada",JPY:"Japan",AUD:"Australia",CHF:"Switzerland",NZD:"New Zealand",CNY:"China",
  };
  const COUNTRY_TO_CODE: Record<string,string> = {
    USD:"US",EUR:"EU",GBP:"UK",CAD:"CA",JPY:"JP",AUD:"AU",CHF:"CH",NZD:"NZ",CNY:"CN",
  };

  async function fetchLiveCalendar(): Promise<any[]> {
    try {
      const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
        headers: { "User-Agent": "CLVRQuant/2.0" },
      });
      if (!res.ok) return [];
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) return [];
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return []; }
      if (!Array.isArray(data)) return [];
      const relevant = data.filter((e: any) =>
        (e.impact === "High" || e.impact === "Medium" || e.impact === "Low") &&
        ["USD","EUR","GBP","JPY","CAD","AUD","CHF","NZD"].includes(e.country) &&
        e.title !== "Bank Holiday"
      );
      return relevant.map((e: any, i: number) => {
        const dateStr = e.date ? e.date.split("T")[0] : "";
        const timeET = e.date ? new Date(e.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) : "00:00";
        const actual = (e.actual !== undefined && e.actual !== null && e.actual !== "") ? String(e.actual) : null;
        const forecast = (e.forecast !== undefined && e.forecast !== null && e.forecast !== "") ? String(e.forecast) : "—";
        const previous = (e.previous !== undefined && e.previous !== null && e.previous !== "") ? String(e.previous) : "—";
        const released = actual !== null;
        const cc = COUNTRY_TO_CODE[e.country] || e.country?.slice(0,2).toUpperCase() || "US";
        return {
          id: 10000 + i,
          bank: mapCountryToBank(e.country, e.title),
          flag: countryFlag(e.country),
          name: e.title,
          date: dateStr,
          time: timeET + " ET",
          timeET,
          country: cc,
          region: COUNTRY_TO_REGION[e.country] || e.country || cc,
          current: previous,
          forecast,
          previous,
          actual,
          unit: "",
          released,
          impact: e.impact === "High" ? "HIGH" : e.impact === "Medium" ? "MED" : "LOW",
          desc: `${e.title}. Previous: ${previous}. Forecast: ${forecast}.${released ? ` Actual: ${actual}.` : " Pending release."}`,
          currency: e.country,
          live: true,
        };
      });
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

  app.post("/api/send-test-brief", async (req, res) => {
    try {
      const { sendDailyBriefEmails } = await import("./dailyBrief");
      sendDailyBriefEmails().catch((e: any) => console.log("[test-brief] Error:", e.message));
      res.json({ ok: true, message: "Brief generation started — check server logs" });
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

  app.post("/api/stripe/checkout", async (req, res) => {
    const { priceId, email } = req.body;
    if (!priceId) return res.status(400).json({ error: "priceId required" });

    try {
      const stripe = await getUncachableStripeClient();
      const domains = process.env.REPLIT_DOMAINS?.split(',') || [];
      const baseUrl = domains.length > 0 ? `https://${domains[0]}` : 'http://localhost:5000';

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
    const { customerId } = req.body;
    if (!customerId) return res.status(400).json({ error: "customerId required" });

    try {
      const stripe = await getUncachableStripeClient();
      const domains = process.env.REPLIT_DOMAINS?.split(',') || [];
      const baseUrl = domains.length > 0 ? `https://${domains[0]}` : 'http://localhost:5000';

      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: baseUrl,
      });
      res.json({ url: portal.url });
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
    const { code } = req.body;
    const userId = (req.session as any)?.userId || null;
    if (!code) return res.status(400).json({ error: "Code required" });

    if (code === OWNER_CODE) {
      if (!userId || !(await isOwner(userId))) {
        return res.json({ valid: false, error: "This code is reserved" });
      }
      return res.json({ valid: true, tier: "pro", type: "owner", label: "Owner Access" });
    }

    if (!userId) {
      return res.json({ valid: false, error: "You must be signed in to use an access code" });
    }

    try {
      const ac = await storage.getAccessCode(code);
      if (!ac || !ac.active) {
        return res.json({ valid: false });
      }
      if (ac.expiresAt && new Date(ac.expiresAt) < new Date()) {
        return res.json({ valid: false, error: "This code has expired" });
      }
      if (ac.usedBy && ac.usedBy !== userId) {
        return res.json({ valid: false, error: "This code has already been claimed by another user" });
      }
      if (!ac.usedBy) {
        await pool.query(
          "UPDATE access_codes SET used_by = $1, used_at = NOW() WHERE code = $2",
          [userId, code]
        );
      }
      return res.json({ valid: true, tier: "pro", type: ac.type, label: ac.label });
    } catch {
      res.json({ valid: false });
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

  app.post("/api/auth/signup", async (req, res) => {
    const { name, email, password, dailyEmail } = req.body;
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
      if (dailyEmail) {
        await pool.query(
          `INSERT INTO subscribers (id, email, name, active) VALUES (gen_random_uuid(), $1, $2, true) ON CONFLICT (email) DO UPDATE SET active = true, name = COALESCE($2, subscribers.name)`,
          [email.toLowerCase().trim(), name.trim()]
        );
      }
      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        const senderAddress = fromEmail && !fromEmail.endsWith("@gmail.com") ? fromEmail : "CLVRQuant <onboarding@resend.dev>";
        await resend.emails.send({
          from: senderAddress,
          to: email.toLowerCase().trim(),
          subject: "Welcome to CLVRQuant — Your Market Intelligence Terminal",
          html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:32px 24px;max-width:600px;margin:0 auto">
            <div style="text-align:center;margin-bottom:24px">
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuant</div>
              <div style="font-family:monospace;font-size:10px;color:#4a5d80;letter-spacing:0.3em;margin-top:4px">AI · MARKET INTELLIGENCE</div>
            </div>
            <div style="border-top:1px solid #141e35;padding-top:20px">
              <p style="font-size:16px;color:#f0f4ff;margin-bottom:4px">Welcome, <strong>${name.trim()}</strong></p>
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
              ${dailyEmail ? `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:4px;padding:12px 16px;margin:12px 0">
                <div style="font-size:11px;color:#c9a84c;font-weight:700">Daily Brief Enrolled</div>
                <div style="font-size:11px;color:#6b7fa8;margin-top:4px;line-height:1.6">You'll receive a morning market brief at 6:00 AM ET every weekday with key levels, signals, and AI insights. You can unsubscribe anytime.</div>
              </div>` : ""}
              <div style="background:rgba(255,140,0,0.06);border:1px solid rgba(255,140,0,0.15);border-radius:4px;padding:12px 16px;margin:16px 0">
                <div style="font-size:10px;color:#ff8c00;font-weight:700;letter-spacing:0.15em;margin-bottom:4px">IMPORTANT DISCLAIMER</div>
                <div style="font-size:10px;color:#6b7fa8;line-height:1.7">CLVRQuant is for informational and educational purposes only. Nothing constitutes financial advice. All trading involves significant risk of loss. CLVRQuant and Mike Claver bear no liability for any financial decisions.</div>
              </div>
              <p style="font-size:11px;color:#4a5d80;text-align:center;margin-top:24px">© 2026 CLVRQuant · Mike Claver · Not a registered financial advisor</p>
            </div>
          </div>`,
        });
      } catch (emailErr: any) {
        console.error("Welcome email failed:", emailErr.message);
      }
      (req.session as any).userId = user.id;
      res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, tier: user.tier } });
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
      (req.session as any).userId = user.id;
      res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, tier } });
    } catch (e: any) {
      res.status(500).json({ error: "Sign in failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.json({ user: null });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.json({ user: null });
      const tier = user.email === OWNER_EMAIL ? "pro" : user.tier;
      res.json({ user: { id: user.id, name: user.name, email: user.email, tier } });
    } catch {
      res.json({ user: null });
    }
  });

  app.post("/api/auth/signout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ ok: true });
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

  return httpServer;
}
