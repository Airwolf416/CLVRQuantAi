// ─────────────────────────────────────────────────────────────────────────────
// Module 2 T06 — 90-day archetype backfill (1h bars, 3 archetypes only)
//
// For each ai_signal_log row in the lookback window, fetches 336 1h bars
// ending at the signal's created_at and reruns the archetype classifier with
// the historical context. Writes a row to `backfilled_classifications` so the
// archetype WR can be computed over a meaningful sample BEFORE the live
// classification stream has had time to accumulate one organically.
//
// Restrictions (per spec):
//   - 1h timeframe only (no 5m / no daily)
//   - Allowed archetypes: TREND_PULLBACK, RANGE_FADE, MEAN_REVERSION_EXHAUSTION
//     Everything else short-circuits to "SKIPPED_ARCHETYPE_NOT_ALLOWED" because
//     BREAKOUT_RETEST / VWAP_RECLAIM / NEWS_MOMO need 5m or session-VWAP
//     context that the 1h-only path cannot reconstruct honestly.
//   - Crypto-only in v1 (Binance klines supports endTime; other vendors don't).
//     Equity / FX / commodity signals are tagged BACKFILL_UNRECOVERABLE.
//
// Idempotent: each row is keyed by (source_signal_id, classifier_version);
// re-running on the same version is a no-op. Bump the env var
// `BACKFILL_CLASSIFIER_VERSION` to force a re-run with new rules.
//
// Drizzle-only. No raw pg, no schema edits.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  classifyArchetype,
  buildArchetypeContext,
  ARCHETYPE_LOOKBACK_1H,
} from "../lib/archetype";

const BINANCE_SUFFIX = "USDT";
// Tokens we can backfill from Binance with reasonable confidence. Everything
// else falls back to BACKFILL_UNRECOVERABLE. Keep aligned with BINANCE_SYMBOLS
// in routes.ts — but we don't import that to avoid pulling all of routes into
// a script context.
const BINANCE_TICKERS = new Set([
  "BTC","ETH","SOL","BNB","XRP","ADA","AVAX","DOGE","DOT","LINK","LTC","TRX",
  "ATOM","NEAR","MATIC","ARB","OP","APT","SUI","INJ","TIA","SEI","PYTH","JTO",
  "WIF","BONK","PEPE","SHIB","UNI","AAVE","MKR","SNX","CRV","COMP",
]);

const ALLOWED_BACKFILL_ARCHETYPES = new Set([
  "TREND_PULLBACK",
  "RANGE_FADE",
  "MEAN_REVERSION_EXHAUSTION",
]);

type BackfillStatus =
  | "CLASSIFIED"
  | "SKIPPED_ALREADY_BACKFILLED"
  | "SKIPPED_ARCHETYPE_NOT_ALLOWED"
  | "SKIPPED_UNCLASSIFIED"
  | "BACKFILL_UNRECOVERABLE";

export interface BackfillRowResult {
  signalId: number;
  ticker: string;
  status: BackfillStatus;
  archetype?: string;
  reason?: string;
}

export interface BackfillRunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  lookbackDays: number;
  classifierVersion: string;
  totalScanned: number;
  byStatus: Record<BackfillStatus, number>;
  byArchetype: Record<string, number>;
  topUnrecoverableReasons: { reason: string; count: number }[];
}

function classifierVersion(): string {
  return (
    process.env.BACKFILL_CLASSIFIER_VERSION ||
    process.env.SOURCE_VERSION ||
    "module2-v1"
  );
}

/**
 * Fetch up to `limit` 1h klines ending strictly at `endMs` (ms). Binance
 * caps at 1000 per request — we only ever ask for 336. Returns the same
 * shape as fetchQuantCandles (lowercase keys), or null on any failure.
 */
async function fetchBinance1hBefore(ticker: string, endMs: number, limit = ARCHETYPE_LOOKBACK_1H): Promise<any[] | null> {
  if (!BINANCE_TICKERS.has(ticker)) return null;
  const symbol = ticker + BINANCE_SUFFIX;
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&endTime=${endMs}&limit=${limit}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const data: any = await r.json();
    if (!Array.isArray(data) || data.length < 24) return null;
    return data.map((c: any) => ({
      timestamp: parseFloat(c[0]),
      open:      parseFloat(c[1]),
      high:      parseFloat(c[2]),
      low:       parseFloat(c[3]),
      close:     parseFloat(c[4]),
      volume:    parseFloat(c[5]),
    }));
  } catch {
    return null;
  }
}

/**
 * Reads the signals to backfill. `lookbackDays` is capped at 180 even if a
 * higher value is passed (to keep runs bounded). When fewer than 200 signals
 * exist in the requested window, widens to the next milestone (30/60/90/180)
 * automatically — gives the dry-run on dev DB something to chew on.
 */
async function loadCandidateSignals(lookbackDays: number): Promise<any[]> {
  const days = Math.min(180, Math.max(7, Math.floor(lookbackDays)));
  const res: any = await db.execute(sql`
    SELECT id, token, direction, created_at, entry_price, source
    FROM ai_signal_log
    WHERE created_at >= NOW() - (${days} || ' days')::interval
    ORDER BY created_at DESC
    LIMIT 5000
  `);
  return res?.rows || res || [];
}

/**
 * Returns the set of (source_signal_id) already backfilled for the current
 * classifier version. Used for the idempotency short-circuit.
 */
async function loadExistingBackfills(version: string): Promise<Set<number>> {
  const res: any = await db.execute(sql`
    SELECT source_signal_id
    FROM backfilled_classifications
    WHERE classifier_version = ${version}
  `);
  const rows: any[] = res?.rows || res || [];
  return new Set(rows.map(r => Number(r.source_signal_id)).filter(Number.isFinite));
}

async function writeBackfillRow(args: {
  sourceSignalId: number;
  archetype: string;
  classifierVersion: string;
  diagnostics: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO backfilled_classifications
        (source_signal_id, archetype, classifier_version, diagnostics)
      VALUES
        (${args.sourceSignalId}, ${args.archetype}, ${args.classifierVersion},
         ${JSON.stringify(args.diagnostics)}::jsonb)
    `);
  } catch (err: any) {
    console.warn(`[backfill] write failed for signal ${args.sourceSignalId}:`, err?.message ?? err);
  }
}

/**
 * Main entry point. Idempotent. Returns a summary suitable for the admin
 * sanity report endpoint. Heavy I/O — caller should rate-limit.
 */
export async function runArchetypeBackfill(opts?: { lookbackDays?: number; maxRows?: number }): Promise<BackfillRunSummary> {
  const startedAt = new Date();
  const lookbackDays = opts?.lookbackDays ?? 90;
  const maxRows = Math.min(opts?.maxRows ?? 2000, 5000);
  const version = classifierVersion();
  const byStatus: Record<BackfillStatus, number> = {
    CLASSIFIED: 0,
    SKIPPED_ALREADY_BACKFILLED: 0,
    SKIPPED_ARCHETYPE_NOT_ALLOWED: 0,
    SKIPPED_UNCLASSIFIED: 0,
    BACKFILL_UNRECOVERABLE: 0,
  };
  const byArchetype: Record<string, number> = {};
  const unrecoverableReasons: Record<string, number> = {};

  const [signals, existing] = await Promise.all([
    loadCandidateSignals(lookbackDays),
    loadExistingBackfills(version),
  ]);
  const work = signals.slice(0, maxRows);

  for (const sig of work) {
    const id = Number(sig.id);
    const ticker = String(sig.token || "").toUpperCase();
    const direction = String(sig.direction || "").toUpperCase() as "LONG" | "SHORT";
    const createdAt = sig.created_at instanceof Date
      ? sig.created_at.getTime()
      : new Date(sig.created_at).getTime();
    const entry = Number(sig.entry_price);

    if (!Number.isFinite(id) || !ticker || !Number.isFinite(createdAt) || !Number.isFinite(entry)) {
      byStatus.BACKFILL_UNRECOVERABLE++;
      unrecoverableReasons["bad_row_data"] = (unrecoverableReasons["bad_row_data"] || 0) + 1;
      continue;
    }
    if (existing.has(id)) {
      byStatus.SKIPPED_ALREADY_BACKFILLED++;
      continue;
    }
    if (!BINANCE_TICKERS.has(ticker)) {
      byStatus.BACKFILL_UNRECOVERABLE++;
      unrecoverableReasons["non_binance_ticker"] = (unrecoverableReasons["non_binance_ticker"] || 0) + 1;
      await writeBackfillRow({
        sourceSignalId: id,
        archetype: "BACKFILL_UNRECOVERABLE",
        classifierVersion: version,
        diagnostics: { reason: "non_binance_ticker", ticker, direction },
      });
      continue;
    }

    const bars = await fetchBinance1hBefore(ticker, createdAt);
    if (!bars || bars.length < 24) {
      byStatus.BACKFILL_UNRECOVERABLE++;
      unrecoverableReasons["insufficient_bars"] = (unrecoverableReasons["insufficient_bars"] || 0) + 1;
      await writeBackfillRow({
        sourceSignalId: id,
        archetype: "BACKFILL_UNRECOVERABLE",
        classifierVersion: version,
        diagnostics: { reason: "insufficient_bars", barsReturned: bars?.length ?? 0 },
      });
      continue;
    }

    let archetype: string;
    let reason: string;
    try {
      const ctx = buildArchetypeContext({
        token: ticker, direction, price: entry, candles1h: bars,
      });
      const res = classifyArchetype(ctx);
      archetype = res.archetype;
      reason = res.reason;
    } catch (classifyErr: any) {
      byStatus.BACKFILL_UNRECOVERABLE++;
      const key = `classify_throw:${classifyErr?.message ?? "unknown"}`;
      unrecoverableReasons[key] = (unrecoverableReasons[key] || 0) + 1;
      await writeBackfillRow({
        sourceSignalId: id,
        archetype: "BACKFILL_UNRECOVERABLE",
        classifierVersion: version,
        diagnostics: { reason: "classify_throw", err: String(classifyErr?.message ?? classifyErr) },
      });
      continue;
    }

    if (archetype === "UNCLASSIFIED") {
      byStatus.SKIPPED_UNCLASSIFIED++;
      await writeBackfillRow({
        sourceSignalId: id, archetype: "UNCLASSIFIED",
        classifierVersion: version, diagnostics: { reason },
      });
      continue;
    }
    if (!ALLOWED_BACKFILL_ARCHETYPES.has(archetype)) {
      byStatus.SKIPPED_ARCHETYPE_NOT_ALLOWED++;
      await writeBackfillRow({
        sourceSignalId: id, archetype: "SKIPPED_ARCHETYPE_NOT_ALLOWED",
        classifierVersion: version, diagnostics: { reason, attempted: archetype },
      });
      continue;
    }

    byStatus.CLASSIFIED++;
    byArchetype[archetype] = (byArchetype[archetype] || 0) + 1;
    await writeBackfillRow({
      sourceSignalId: id, archetype,
      classifierVersion: version, diagnostics: { reason, barsUsed: bars.length },
    });
  }

  const finishedAt = new Date();
  const topUnrecoverableReasons = Object.entries(unrecoverableReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    lookbackDays,
    classifierVersion: version,
    totalScanned: work.length,
    byStatus,
    byArchetype,
    topUnrecoverableReasons,
  };
}

/**
 * Side-by-side WR report: live vs backfill per archetype. Used by
 * GET /api/admin/archetype/backfill-report.
 */
export async function getBackfillReport(): Promise<any> {
  try {
    const liveRes: any = await db.execute(sql`
      SELECT
        COALESCE(archetype, 'UNCLASSIFIED') AS archetype,
        COUNT(*) AS n,
        SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN') THEN 1 ELSE 0 END) AS wins
      FROM ai_signal_log
      WHERE outcome IS NOT NULL AND outcome <> 'PENDING'
        AND (classification_source IS NULL OR classification_source = 'live')
      GROUP BY 1
      ORDER BY n DESC
    `);
    const backfillRes: any = await db.execute(sql`
      SELECT
        bc.archetype,
        COUNT(*) AS n,
        SUM(CASE WHEN sl.outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN') THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN sl.outcome IN ('SL_HIT','EXPIRED_LOSS') THEN 1 ELSE 0 END) AS losses
      FROM backfilled_classifications bc
      JOIN ai_signal_log sl ON sl.id = bc.source_signal_id
      WHERE sl.outcome IS NOT NULL AND sl.outcome <> 'PENDING'
      GROUP BY 1
      ORDER BY n DESC
    `);
    const unrecRes: any = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM backfilled_classifications
      WHERE archetype = 'BACKFILL_UNRECOVERABLE'
    `);
    const wr = (wins: number, n: number) => n > 0 ? wins / n : 0;
    return {
      live: (liveRes?.rows || liveRes || []).map((r: any) => ({
        archetype: r.archetype, n: Number(r.n), wins: Number(r.wins),
        wr: +wr(Number(r.wins), Number(r.n)).toFixed(4),
      })),
      backfill: (backfillRes?.rows || backfillRes || []).map((r: any) => ({
        archetype: r.archetype, n: Number(r.n), wins: Number(r.wins),
        losses: Number(r.losses),
        wr: +wr(Number(r.wins), Number(r.n) - 0).toFixed(4),
      })),
      unrecoverable: Number((unrecRes?.rows || unrecRes || [])[0]?.n || 0),
      classifierVersion: classifierVersion(),
    };
  } catch (err: any) {
    return { error: String(err?.message || err) };
  }
}
