export type RejectionReason =
  | "CIRCUIT_BREAKER"
  | "ADAPTIVE_SUPPRESSED"
  | "FILTER_FAILED"
  | "RATE_LIMIT"
  | "COOLDOWN"
  | "LOW_OI"
  | "NEGATIVE_EV"
  | "MACRO_HALT"
  | "MARKET_CLOSED"
  | "LOW_CONFIDENCE"
  | "ANTI_CHASE"
  // ── Signal Engine Hardening (post-LLM mechanical gates) ───────────────────
  | "SL_TOO_TIGHT_VS_ATR"
  | "COUNTER_TREND_MICRO"
  | "SL_IN_LIQUIDITY_POCKET"
  | "SHORTS_CROWDED"
  | "LONGS_CROWDED"
  | "RR_TOO_LOW_AFTER_FRICTION"
  // ── News / rate-limit gates ───────────────────────────────────────────────
  | "NEWS_CONFLICT_HIGH"
  | "RATE_LIMIT_ASSET"
  | "OTHER";

export interface RejectionEntry {
  ts: number;
  source: "auto_scanner" | "ai_signal" | "manual";
  token: string;
  direction: string | null;
  reason: RejectionReason;
  detail: string;
}

const MAX_ENTRIES = 500;
const ring: RejectionEntry[] = [];

export interface PersistContext {
  proposedEntry?: number;
  proposedSl?: number;
  proposedTp1?: number;
  conviction?: number;
}

export function logRejection(entry: Omit<RejectionEntry, "ts">, ctx?: PersistContext): void {
  const e: RejectionEntry = { ts: Date.now(), ...entry };
  ring.push(e);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
  // Best-effort durable persist for the admin tuning dashboard. Skip the
  // soft Coinglass health logs (they would dominate the table at no value).
  if (entry.detail?.startsWith("COINGLASS_UNAVAILABLE")) return;
  void persistRejectionAsync(e, ctx).catch(() => { /* swallow — non-blocking */ });
}

async function persistRejectionAsync(e: RejectionEntry, ctx?: PersistContext): Promise<void> {
  try {
    const { db } = await import("../db");
    const { signalRejections } = await import("@shared/schema");
    await db.insert(signalRejections).values({
      source: e.source,
      token: e.token,
      direction: e.direction,
      reason: e.reason,
      detail: e.detail,
      proposedEntry: ctx?.proposedEntry,
      proposedSl: ctx?.proposedSl,
      proposedTp1: ctx?.proposedTp1,
      conviction: ctx?.conviction,
    });
  } catch {
    // DB unavailable — in-memory ring still has the entry; the dashboard
    // will degrade to that source via its existing fallback path.
  }
}

export function getRecentRejections(limit = 100): RejectionEntry[] {
  const start = Math.max(0, ring.length - limit);
  return ring.slice(start).reverse();
}

export function getRejectionStats(windowMs = 60 * 60 * 1000): Record<RejectionReason, number> {
  const cutoff = Date.now() - windowMs;
  const counts: Record<string, number> = {};
  for (const e of ring) {
    if (e.ts < cutoff) continue;
    counts[e.reason] = (counts[e.reason] || 0) + 1;
  }
  return counts as Record<RejectionReason, number>;
}
