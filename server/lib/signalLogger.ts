import { db } from "../db";
import { aiSignalLog, signalShadowInversions, type InsertAiSignalLog } from "@shared/schema";

export type SignalSource = "trade_ideas" | "quant_scanner" | "signals_tab" | "basket";

export interface LogSignalInput {
  source: SignalSource;
  token: string;
  direction: "LONG" | "SHORT";
  tradeType?: string | null;
  entryPrice: number | string;
  tp1Price?: number | string | null;
  tp2Price?: number | string | null;
  tp3Price?: number | string | null;
  stopLoss?: number | string | null;
  leverage?: string | null;
  conviction?: number | null;
  edgeScore?: string | null;
  edgeSource?: string | null;
  kronos?: boolean;
  killClockHours?: number | null;
  thesis?: string | null;
  invalidation?: string | null;
  scores?: any;
  // ── Visibility / promotion ──
  scope?: "global" | "promoted";
  targetUserId?: string | null;
  // ── News snapshot at signal time (for outcome ↔ news correlation) ──
  newsContext?: any;
}

const toDec = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, $]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n.toString();
};

export async function logSignal(input: LogSignalInput): Promise<number | null> {
  try {
    const entry = toDec(input.entryPrice);
    if (!entry) {
      console.warn(`[signalLogger] skipped ${input.source}/${input.token} — invalid entry price`);
      return null;
    }
    const killClockExpires = input.killClockHours
      ? new Date(Date.now() + input.killClockHours * 60 * 60 * 1000)
      : null;

    const row: InsertAiSignalLog = {
      source: input.source,
      token: (input.token || "").toUpperCase(),
      direction: input.direction,
      tradeType: input.tradeType ?? null,
      entryPrice: entry,
      tp1Price: toDec(input.tp1Price),
      tp2Price: toDec(input.tp2Price),
      tp3Price: toDec(input.tp3Price),
      stopLoss: toDec(input.stopLoss),
      leverage: input.leverage ?? null,
      conviction: input.conviction ?? null,
      edgeScore: input.edgeScore ?? null,
      edgeSource: input.edgeSource ?? null,
      kronos: input.kronos || false,
      killClockHours: input.killClockHours ?? null,
      killClockExpires,
      outcome: "PENDING",
      thesis: input.thesis ?? null,
      invalidation: input.invalidation ?? null,
      scores: input.scores ?? null,
      scope: input.scope ?? "global",
      targetUserId: input.targetUserId ?? null,
      newsContext: input.newsContext ?? null,
    };

    const [inserted] = await db.insert(aiSignalLog).values(row).returning({ id: aiSignalLog.id });
    const insertedId = inserted?.id ?? null;

    // ── Shadow-inverted twin ("Reverse Costanza" backtest) ─────────────────
    // For every real signal, write a mirror with the opposite direction and
    // SL/TP levels reflected across the entry price. Risk and reward
    // distances are preserved, so this measures what flipping the system
    // would actually have made — resolved by the same live-price feed used
    // for the real signal. Failure here is non-fatal: the shadow is a
    // diagnostic, never blocks signal publication.
    if (insertedId != null) {
      try {
        const entryNum = Number(entry);
        const mirror = (lvl: string | null): string | null => {
          if (lvl == null) return null;
          const n = parseFloat(lvl);
          if (!Number.isFinite(n)) return null;
          const mirrored = 2 * entryNum - n;
          // A target more than 1× entry away on the original side mirrors to
          // a non-positive price on the opposite side. We can't trade or
          // resolve that meaningfully, so skip the level — the resolver
          // already null-skips per-target.
          if (!Number.isFinite(mirrored) || mirrored <= 0) return null;
          return mirrored.toString();
        };
        await db.insert(signalShadowInversions).values({
          sourceSignalId: insertedId,
          token: row.token,
          originalDirection: row.direction,
          invertedDirection: row.direction === "LONG" ? "SHORT" : "LONG",
          entryPrice: entry,
          invertedSl: mirror(row.stopLoss ?? null),
          invertedTp1: mirror(row.tp1Price ?? null),
          invertedTp2: mirror(row.tp2Price ?? null),
          invertedTp3: mirror(row.tp3Price ?? null),
          killClockExpires: row.killClockExpires ?? null,
          outcome: "PENDING",
        });
      } catch (shadowErr) {
        console.warn(
          `[signalLogger] shadow inversion insert failed for signal ${insertedId} (non-fatal):`,
          (shadowErr as Error)?.message ?? shadowErr
        );
      }
    }

    return insertedId;
  } catch (err) {
    console.error(`[signalLogger] failed to log ${input.source}/${input.token}:`, err);
    return null;
  }
}
