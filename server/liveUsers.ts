// ── In-memory live-user tracker ─────────────────────────────────────────────
// Records "last seen" timestamps per authenticated user, bucketed by tier.
// Powers the owner-only stats panel under Account → Owner so the founder can
// see how many people are actually using the site right now (not just total
// signups). Updated on every successful /api/auth/me hit (clients poll it
// frequently for session validation), so the data refreshes naturally.
//
// Memory footprint is bounded because we only ever store one row per userId
// and we evict rows older than INACTIVE_EVICT_MS on each read. Even with
// 100k registered users only the actively-polling ones live in the map.

type LiveRecord = {
  userId: string;
  email: string;
  tier: string;
  lastSeenAt: number;
};

const liveByUser = new Map<string, LiveRecord>();

// Evict from the in-memory map after 30 minutes of silence. Anyone still
// using the site will be re-added on their next /api/auth/me poll.
const INACTIVE_EVICT_MS = 30 * 60 * 1000;

// Default "live right now" window. /api/auth/me is polled by the client at
// least once per session refresh cycle, so a 2-minute window safely captures
// anyone with the tab open and not idle.
const DEFAULT_LIVE_WINDOW_MS = 2 * 60 * 1000;

export function recordActivity(userId: string, email: string, tier: string) {
  if (!userId) return;
  liveByUser.set(userId, {
    userId,
    email: (email || "").toLowerCase(),
    tier: (tier || "free").toLowerCase(),
    lastSeenAt: Date.now(),
  });
}

function evictStale() {
  const cutoff = Date.now() - INACTIVE_EVICT_MS;
  for (const [k, v] of liveByUser) {
    if (v.lastSeenAt < cutoff) liveByUser.delete(k);
  }
}

// Returns the actual list of live users (email + tier + lastSeenAt) within
// the given window, sorted most-recent-first. Used by the owner-only
// "Who's on the site right now" panel — counts alone aren't enough to
// answer "who exactly is using my website?".
export function getLiveUserList(windowMs: number = DEFAULT_LIVE_WINDOW_MS) {
  evictStale();
  const cutoff = Date.now() - windowMs;
  const out: LiveRecord[] = [];
  for (const r of liveByUser.values()) {
    if (r.lastSeenAt >= cutoff) out.push(r);
  }
  out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return {
    users: out,
    total: out.length,
    windowMs,
    asOf: Date.now(),
  };
}

export function getLiveStats(windowMs: number = DEFAULT_LIVE_WINDOW_MS) {
  evictStale();
  const cutoff = Date.now() - windowMs;
  const byTier: Record<string, number> = { free: 0, pro: 0, elite: 0 };
  let total = 0;
  for (const r of liveByUser.values()) {
    if (r.lastSeenAt >= cutoff) {
      total++;
      byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    }
  }
  return {
    total,
    byTier,
    windowMs,
    trackedUsersInMemory: liveByUser.size,
    asOf: Date.now(),
  };
}
