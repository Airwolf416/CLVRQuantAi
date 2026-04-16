import { and, gte, ne } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog } from "@shared/schema";

const WIN_OUTCOMES = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES = new Set(["SL_HIT", "EXPIRED_LOSS"]);

let _cached: { ts: number; text: string } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function buildPerformanceContext(): Promise<string> {
  if (_cached && Date.now() - _cached.ts < CACHE_TTL_MS) return _cached.text;
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const resolved = await db.select()
      .from(aiSignalLog)
      .where(and(
        ne(aiSignalLog.outcome, "PENDING"),
        gte(aiSignalLog.createdAt, thirtyDaysAgo),
      ));

    if (resolved.length < 5) {
      const text = "HISTORICAL PERFORMANCE: Insufficient data (<5 resolved signals in last 30 days). Use standard parameters.";
      _cached = { ts: Date.now(), text };
      return text;
    }

    const wins   = resolved.filter(s => WIN_OUTCOMES.has(s.outcome || ""));
    const losses = resolved.filter(s => LOSS_OUTCOMES.has(s.outcome || ""));
    const overallWinRate = Math.round((wins.length / resolved.length) * 100);

    const byAsset: Record<string, { wins: number; total: number; pnls: number[] }> = {};
    const byDirection: Record<string, { wins: number; total: number }> = {};
    const byTradeType: Record<string, { wins: number; total: number }> = {};

    for (const s of resolved) {
      const tok = s.token;
      const isWin = WIN_OUTCOMES.has(s.outcome || "");

      if (!byAsset[tok]) byAsset[tok] = { wins: 0, total: 0, pnls: [] };
      byAsset[tok].total++;
      if (isWin) byAsset[tok].wins++;
      const pnl = s.pnlPct != null ? parseFloat(s.pnlPct) : NaN;
      if (Number.isFinite(pnl)) byAsset[tok].pnls.push(pnl);

      const dir = s.direction;
      if (!byDirection[dir]) byDirection[dir] = { wins: 0, total: 0 };
      byDirection[dir].total++;
      if (isWin) byDirection[dir].wins++;

      const tt = s.tradeType || "UNKNOWN";
      if (!byTradeType[tt]) byTradeType[tt] = { wins: 0, total: 0 };
      byTradeType[tt].total++;
      if (isWin) byTradeType[tt].wins++;
    }

    const recentLosses = losses.slice(-5).map(s =>
      `${s.token} ${s.direction} (${s.tradeType || "?"}) — ${s.outcome}, ${s.pnlPct ?? "?"}%`
    );
    const recentWins = wins.slice(-5).map(s =>
      `${s.token} ${s.direction} (${s.tradeType || "?"}) — ${s.outcome}, +${s.pnlPct ?? "?"}%`
    );

    let ctx = `HISTORICAL PERFORMANCE CONTEXT (last 30 days, ${resolved.length} resolved signals):\n`;
    ctx += `Overall win rate: ${overallWinRate}% (${wins.length}W / ${losses.length}L)\n\n`;

    ctx += `By asset:\n`;
    for (const [token, data] of Object.entries(byAsset)) {
      const wr = Math.round((data.wins / data.total) * 100);
      const avgPnl = data.pnls.length
        ? (data.pnls.reduce((a, b) => a + b, 0) / data.pnls.length).toFixed(2)
        : "?";
      ctx += `  ${token}: ${wr}% win rate (${data.total} signals, avg PnL ${avgPnl}%)\n`;
    }

    ctx += `\nBy direction:\n`;
    for (const [dir, data] of Object.entries(byDirection)) {
      ctx += `  ${dir}: ${Math.round((data.wins / data.total) * 100)}% win rate (${data.total} signals)\n`;
    }

    ctx += `\nBy trade type:\n`;
    for (const [tt, data] of Object.entries(byTradeType)) {
      ctx += `  ${tt}: ${Math.round((data.wins / data.total) * 100)}% win rate (${data.total} signals)\n`;
    }

    if (recentLosses.length > 0) {
      ctx += `\nRecent losses (AVOID similar setups):\n`;
      for (const l of recentLosses) ctx += `  ❌ ${l}\n`;
    }
    if (recentWins.length > 0) {
      ctx += `\nRecent wins (FAVOR similar setups):\n`;
      for (const w of recentWins) ctx += `  ✅ ${w}\n`;
    }

    ctx += `\nINSTRUCTIONS: Use this performance data to improve signal quality. Favor asset/direction/trade-type combos with >65% win rate. Be MORE cautious with combos below 50%. If a specific asset has been consistently losing, either skip it or require higher conviction (75%+).`;

    _cached = { ts: Date.now(), text: ctx };
    return ctx;
  } catch (err) {
    console.error("[PerformanceContext] Error building context:", err);
    return "HISTORICAL PERFORMANCE: Error loading performance data. Use standard parameters.";
  }
}

export function invalidatePerformanceContextCache(): void {
  _cached = null;
}
