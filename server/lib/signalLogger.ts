import { db } from "../db";
import { aiSignalLog, type InsertAiSignalLog } from "@shared/schema";

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
    return inserted?.id ?? null;
  } catch (err) {
    console.error(`[signalLogger] failed to log ${input.source}/${input.token}:`, err);
    return null;
  }
}
