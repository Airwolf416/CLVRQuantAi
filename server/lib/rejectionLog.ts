export type RejectionReason =
  | "CIRCUIT_BREAKER"
  | "ADAPTIVE_SUPPRESSED"
  | "FILTER_FAILED"
  | "RATE_LIMIT"
  | "COOLDOWN"
  | "LOW_OI"
  | "NEGATIVE_EV"
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

export function logRejection(entry: Omit<RejectionEntry, "ts">): void {
  const e: RejectionEntry = { ts: Date.now(), ...entry };
  ring.push(e);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
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
