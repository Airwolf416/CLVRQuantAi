import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { aiSignalLog } from "@shared/schema";

// ── Per-asset cooldown ────────────────────────────────────────────────────────
// Hard floor of 2h between signals on the same (token, direction). Prevents
// spam when a setup keeps re-printing on every 5m close (e.g. ONDO firing 4
// LONGs in 3h during a grind-up).
//
// Reads from ai_signal_log so cooldown state survives restarts and is shared
// across processes. The query is keyed on (token, direction) and orders by
// created_at desc — fast on the existing PK + token index.
const COOLDOWN_MINUTES = 120;

export type CooldownResult = { inCooldown: boolean; minutesLeft?: number };

export async function isInCooldown(
  token: string,
  direction: "LONG" | "SHORT"
): Promise<CooldownResult> {
  try {
    const rows = await db
      .select({ createdAt: aiSignalLog.createdAt })
      .from(aiSignalLog)
      .where(and(eq(aiSignalLog.token, token), eq(aiSignalLog.direction, direction)))
      .orderBy(desc(aiSignalLog.createdAt))
      .limit(1);
    if (!rows.length || !rows[0].createdAt) return { inCooldown: false };
    const minutesSince = (Date.now() - new Date(rows[0].createdAt).getTime()) / 60000;
    if (minutesSince < COOLDOWN_MINUTES) {
      return { inCooldown: true, minutesLeft: Math.ceil(COOLDOWN_MINUTES - minutesSince) };
    }
    return { inCooldown: false };
  } catch (e: any) {
    console.warn("[Cooldown] query failed, failing open:", e?.message || e);
    return { inCooldown: false };
  }
}

export const COOLDOWN_WINDOW_MINUTES = COOLDOWN_MINUTES;
