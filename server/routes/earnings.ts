// server/routes/earnings.ts
// GET /api/earnings — Reported (last 14d) + Upcoming (next 30d) major-cap +
// watchlist earnings, sourced entirely from Finnhub via the shared
// finnhubEarnings service (single source of truth for calendar fetch/cache).
//
// The service caches the RAW calendar window for 5 min; this route filters
// per-request by the caller's watchlist so different watchlists never receive
// each other's filtered payload (no cross-request cache bleed).
import type { Express, Request, Response } from "express";
import {
  getEarningsCalendar,
  isFinnhubEarningsConfigured,
  type EarningsRow,
} from "../services/finnhubEarnings";

const MAJOR_CAP = new Set([
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO","JPM",
  "V","UNH","XOM","MA","COST","HD","PG","JNJ","ABBV","NFLX","AMD","CRM",
  "ORCL","WMT","BAC","KO","PEP","LLY","MRK","TMUS","CSCO","ADBE","INTC",
]);

const fmt = (d: Date) => d.toISOString().slice(0, 10);

function shape(e: EarningsRow) {
  return {
    symbol: e.symbol,
    date: e.date,
    hour: e.hour,
    quarter: e.quarter,
    year: e.year,
    epsEstimate: e.epsEstimated,
    epsActual: e.epsActual,
    revenueEstimate: e.revenueEstimated,
    revenueActual: e.revenueActual,
    surprisePct: e.epsActual != null && e.epsEstimated != null && e.epsEstimated !== 0
      ? +(((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100).toFixed(1)
      : null,
  };
}

export function registerEarningsRoute(app: Express) {
  app.get("/api/earnings", async (req: Request, res: Response) => {
    try {
      if (!isFinnhubEarningsConfigured()) {
        return res.status(500).json({ error: "FINNHUB_KEY not set", reported: [], upcoming: [] });
      }

      const now = new Date();
      const from = new Date(now); from.setDate(now.getDate() - 14);
      const to   = new Date(now); to.setDate(now.getDate() + 30);

      // Service owns fetch + 5-min calendar cache keyed by the date window.
      const all = await getEarningsCalendar(fmt(from), fmt(to));

      const watchlist = String(req.query.watchlist || "")
        .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      const allowed = (s: string) => MAJOR_CAP.has(s) || watchlist.includes(s);
      const filtered = all.filter(e => allowed(e.symbol));

      const reported = filtered
        .filter(e => e.epsActual != null)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map(shape);
      const upcoming = filtered
        .filter(e => e.epsActual == null)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(shape);

      res.json({
        source: "FINNHUB",
        window: { from: fmt(from), to: fmt(to) },
        reported,
        upcoming,
        upcomingCount: upcoming.length,
      });
    } catch (e: any) {
      console.error("[earnings] error:", e?.message || e);
      res.status(502).json({ error: e?.message || "earnings failed", reported: [], upcoming: [] });
    }
  });
}
