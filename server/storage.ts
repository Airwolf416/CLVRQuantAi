import { type User, type InsertUser, type AccessCode, type InsertAccessCode, type Referral, type InsertReferral, type UserAlert, type InsertUserAlert, type WebAuthnCredential, type SignalHistoryRecord, type TradeJournalEntry, type WatchlistItem, users, accessCodes, referrals, userAlerts, webauthnCredentials, signalHistory, tradeJournal, watchlistItems } from "@shared/schema";
import { db, pool } from "./db";
import { eq, sql, and, gt, lt, desc, ne } from "drizzle-orm";

// Promo-reminder idempotency: kinds are 'expiry_7d' | 'expiry_0d'.
// expiry_date is the user's promoExpiresAt as a UTC date (YYYY-MM-DD), so
// re-redeeming a NEW access code with a later expiry date allows a fresh pair
// of reminders to fire. Table is created in initDb.ts.
export type PromoReminderKind = "expiry_7d" | "expiry_0d";
const toExpiryDate = (d: Date | string): string =>
  (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStripeCustomer(userId: string, customerId: string): Promise<void>;
  updateUserSubscription(userId: string, subscriptionId: string | null, tier: string): Promise<void>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  updateUserResetToken(userId: string, token: string, expiry: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;
  clearResetToken(userId: string): Promise<void>;
  updateUserPromoCode(userId: string, code: string, expiresAt: Date | null): Promise<void>;
  updateUserReferralCode(userId: string, code: string): Promise<void>;
  updateUserReferredBy(userId: string, referralCode: string): Promise<void>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  getUsersWithExpiringPromos(daysUntilExpiry: number): Promise<User[]>;
  getAccessCode(code: string): Promise<AccessCode | undefined>;
  createAccessCode(data: InsertAccessCode): Promise<AccessCode>;
  revokeAccessCode(code: string): Promise<void>;
  listAccessCodes(): Promise<AccessCode[]>;
  createReferral(data: InsertReferral): Promise<Referral>;
  getReferralByReferred(referredUserId: string): Promise<Referral | undefined>;
  grantReferralReward(referralId: number): Promise<void>;
  getUserAlerts(userId: string): Promise<UserAlert[]>;
  createUserAlert(data: InsertUserAlert): Promise<UserAlert>;
  deleteUserAlert(id: number, userId: string): Promise<void>;
  updateUserAlertTriggered(id: number, userId: string): Promise<void>;
  deleteExpiredAlerts(): Promise<number>;
  createWebAuthnCredential(userId: string, credentialId: string): Promise<void>;
  getWebAuthnCredentialsByUser(userId: string): Promise<WebAuthnCredential[]>;
  getUserByCredentialId(credentialId: string): Promise<User | undefined>;
  deleteWebAuthnCredential(credentialId: string, userId: string): Promise<void>;
  setEmailVerificationToken(userId: string, token: string): Promise<void>;
  getUserByEmailVerificationToken(token: string): Promise<User | undefined>;
  markEmailVerified(userId: string): Promise<void>;
  // Signal history
  saveSignalRecord(data: {
    signalId: number; token: string; direction: string; conf: number;
    advancedScore: number; entry: string; tp1?: string; stopLoss?: string;
    leverage?: string; pctMove?: string; tp1Pct?: string; stopPct?: string;
    reasoning?: string[]; scoreBreakdown?: string; isStrongSignal: boolean;
    ts: Date;
  }): Promise<void>;
  getSignalHistory(limit: number, offset: number): Promise<SignalHistoryRecord[]>;
  getPendingSignals(): Promise<SignalHistoryRecord[]>;
  resolveSignalOutcome(signalId: number, outcome: string, pnlPct: string): Promise<void>;
  updateSignalOutcomeById(id: number, outcome: string, pnlPct?: string): Promise<void>;
  getSignalStats(): Promise<{ total: number; wins: number; losses: number; pending: number; avgPnl: number; weeklyData: any[]; byAsset: any[]; byDirection: any[] }>;
  // Trade Journal
  getTradeJournal(userId: string): Promise<TradeJournalEntry[]>;
  addTradeJournalEntry(data: Omit<TradeJournalEntry, "id" | "createdAt" | "closedAt">): Promise<TradeJournalEntry>;
  updateTradeJournalEntry(id: number, userId: string, updates: Partial<TradeJournalEntry>): Promise<void>;
  deleteTradeJournalEntry(id: number, userId: string): Promise<void>;
  // Watchlist
  getUserWatchlist(userId: string): Promise<WatchlistItem[]>;
  addToWatchlist(userId: string, symbol: string, assetClass: string, note?: string): Promise<WatchlistItem>;
  removeFromWatchlist(userId: string, symbol: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserStripeCustomer(userId: string, customerId: string): Promise<void> {
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  }

  async updateUserSubscription(userId: string, subscriptionId: string | null, tier: string): Promise<void> {
    await db.update(users).set({ stripeSubscriptionId: subscriptionId, tier }).where(eq(users.id, userId));
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return user;
  }

  async updateUserResetToken(userId: string, token: string, expiry: Date): Promise<void> {
    await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }

  async clearResetToken(userId: string): Promise<void> {
    await db.update(users).set({ resetToken: null, resetTokenExpiry: null }).where(eq(users.id, userId));
  }

  async updateUserPromoCode(userId: string, code: string, expiresAt: Date | null): Promise<void> {
    await db.update(users).set({ promoCode: code, promoExpiresAt: expiresAt }).where(eq(users.id, userId));
  }

  async updateUserReferralCode(userId: string, code: string): Promise<void> {
    await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
  }

  async updateUserReferredBy(userId: string, referralCode: string): Promise<void> {
    await db.update(users).set({ referredBy: referralCode }).where(eq(users.id, userId));
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, code));
    return user;
  }

  async getUsersWithExpiringPromos(daysUntilExpiry: number): Promise<User[]> {
    const now = new Date();
    const target = new Date(now.getTime() + daysUntilExpiry * 86400000);
    const dayBefore = new Date(target.getTime() - 86400000);
    return db.select().from(users).where(
      and(
        gt(users.promoExpiresAt!, dayBefore),
        lt(users.promoExpiresAt!, target)
      )
    );
  }

  // ── Promo-reminder idempotency ledger ───────────────────────────────────
  // Atomic claim-before-send pattern: a single INSERT ... ON CONFLICT DO NOTHING
  // is the lock. Returns true iff THIS caller won the claim and must send the
  // email. On send failure the caller MUST release the slot so a future
  // scheduler tick can retry. Mirrors claimTelegramSlot/releaseTelegramSlotOnFailure
  // in dailyBrief.ts. This eliminates the read-then-write race that could
  // let two concurrent workers (overlapping ticks, restart + 60s setTimeout,
  // multiple replicas) both pass a `wasSent?` check and both send.
  // Fail-CLOSED on DB error: if we cannot claim atomically we MUST NOT send,
  // because we have no way to dedupe a successful send afterwards.
  async claimPromoReminderSlot(userId: string, kind: PromoReminderKind, expiryDate: Date | string): Promise<boolean> {
    try {
      const r = await pool.query(
        `INSERT INTO promo_reminder_log (user_id, kind, expiry_date)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, kind, expiry_date) DO NOTHING`,
        [userId, kind, toExpiryDate(expiryDate)],
      );
      return (r.rowCount ?? 0) > 0;
    } catch (e: any) {
      console.error("[promo-reminder-log] claim error (skipping send):", e.message);
      return false;
    }
  }

  async releasePromoReminderSlot(userId: string, kind: PromoReminderKind, expiryDate: Date | string): Promise<void> {
    try {
      await pool.query(
        "DELETE FROM promo_reminder_log WHERE user_id = $1 AND kind = $2 AND expiry_date = $3",
        [userId, kind, toExpiryDate(expiryDate)],
      );
    } catch (e: any) {
      console.error("[promo-reminder-log] release error:", e.message);
    }
  }

  // ── Redemption audit log ────────────────────────────────────────────────
  // Append-only audit of every /api/verify-code attempt. Drives the per-user
  // 5/hour rate limit and gives ops a queryable feed for brute-force patterns.
  // Fail-open (errors are logged but never bubble to the caller) — this is a
  // monitoring channel, not a correctness mechanism. The kill-the-exploit
  // dedup is enforced by code_redemptions' UNIQUE(code, user_id), not here.
  async logRedemptionAttempt(
    userId: string | null,
    codeAttempted: string | null,
    ipAddress: string | null,
    result: string,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO redemption_attempts (user_id, code_attempted, ip_address, result)
         VALUES ($1, $2, $3, $4)`,
        [userId, codeAttempted, ipAddress || null, result],
      );
    } catch (e: any) {
      console.error("[redemption-attempts] log error:", e.message);
    }
  }

  async countRecentRedemptionAttempts(userId: string, hoursBack: number): Promise<number> {
    try {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM redemption_attempts
          WHERE user_id = $1
            AND attempted_at > NOW() - ($2 || ' hours')::INTERVAL`,
        [userId, String(hoursBack)],
      );
      return r.rows[0]?.n ?? 0;
    } catch (e: any) {
      console.error("[redemption-attempts] count error:", e.message);
      return 0;
    }
  }

  async getAccessCode(code: string): Promise<AccessCode | undefined> {
    const [ac] = await db.select().from(accessCodes).where(eq(accessCodes.code, code));
    return ac;
  }

  async createAccessCode(data: InsertAccessCode): Promise<AccessCode> {
    const [ac] = await db.insert(accessCodes).values(data).returning();
    // The redemption_type column was added via raw SQL in initDb.ts and is NOT
    // part of the Drizzle schema, so the INSERT above never sets it and the
    // column default ('single_use_per_user') would kick in. For admin-created
    // codes via /api/access-codes (private VIP/FF style) the correct semantic
    // is single-use globally — force it explicitly so a future admin code can
    // never be silently turned into a per-user-reusable code.
    if (ac?.code) {
      await pool.query(
        `UPDATE access_codes SET redemption_type = 'single_use_global' WHERE code = $1`,
        [ac.code]
      );
    }
    return ac;
  }

  async revokeAccessCode(code: string): Promise<void> {
    await db.update(accessCodes).set({ active: false }).where(eq(accessCodes.code, code));
  }

  async listAccessCodes(): Promise<AccessCode[]> {
    return db.select().from(accessCodes);
  }

  async createReferral(data: InsertReferral): Promise<Referral> {
    const [ref] = await db.insert(referrals).values(data).returning();
    return ref;
  }

  async getReferralByReferred(referredUserId: string): Promise<Referral | undefined> {
    const [ref] = await db.select().from(referrals).where(eq(referrals.referredUserId, referredUserId));
    return ref;
  }

  async grantReferralReward(referralId: number): Promise<void> {
    await db.update(referrals).set({ rewardGranted: true, status: "completed" }).where(eq(referrals.id, referralId));
  }

  async getUserAlerts(userId: string): Promise<UserAlert[]> {
    return db.select().from(userAlerts).where(eq(userAlerts.userId, userId));
  }

  async createUserAlert(data: InsertUserAlert): Promise<UserAlert> {
    const [alert] = await db.insert(userAlerts).values(data).returning();
    return alert;
  }

  async deleteUserAlert(id: number, userId: string): Promise<void> {
    await db.delete(userAlerts).where(and(eq(userAlerts.id, id), eq(userAlerts.userId, userId)));
  }

  async updateUserAlertTriggered(id: number, userId: string): Promise<void> {
    await db.update(userAlerts).set({ triggered: true }).where(and(eq(userAlerts.id, id), eq(userAlerts.userId, userId)));
  }

  async deleteExpiredAlerts(): Promise<number> {
    const now = new Date();
    const result = await db.delete(userAlerts).where(lt(userAlerts.expiresAt, now)).returning();
    return result.length;
  }

  async createWebAuthnCredential(userId: string, credentialId: string): Promise<void> {
    await db.insert(webauthnCredentials).values({ userId, credentialId }).onConflictDoNothing();
  }

  async getWebAuthnCredentialsByUser(userId: string): Promise<WebAuthnCredential[]> {
    return db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
  }

  async getUserByCredentialId(credentialId: string): Promise<User | undefined> {
    const [row] = await db
      .select({ user: users })
      .from(webauthnCredentials)
      .innerJoin(users, eq(users.id, webauthnCredentials.userId))
      .where(eq(webauthnCredentials.credentialId, credentialId));
    return row?.user;
  }

  async deleteWebAuthnCredential(credentialId: string, userId: string): Promise<void> {
    await db.delete(webauthnCredentials).where(
      and(eq(webauthnCredentials.credentialId, credentialId), eq(webauthnCredentials.userId, userId))
    );
  }

  async setEmailVerificationToken(userId: string, token: string): Promise<void> {
    await db.update(users).set({ emailVerificationToken: token }).where(eq(users.id, userId));
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user;
  }

  async markEmailVerified(userId: string): Promise<void> {
    // Intentionally do NOT clear emailVerificationToken here. Email apps
    // (Gmail/iMessage/Outlook safe-link preview, antivirus link scanners,
    // and double-tap users) commonly hit the verification URL twice. If we
    // nulled the token on first hit, the second hit would 404 and the user
    // would see "Link Invalid" right after being successfully verified.
    // Keeping the token lets the verify-email endpoint detect the second
    // hit and return a friendly "already verified" success instead.
    // The token IS overwritten the next time setEmailVerificationToken
    // runs (resend / new signup flow), so it never lingers indefinitely.
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  }

  // ── Signal History ──────────────────────────────────────────────────────────
  async saveSignalRecord(data: {
    signalId: number; token: string; direction: string; conf: number;
    advancedScore: number; entry: string; tp1?: string; stopLoss?: string;
    leverage?: string; pctMove?: string; tp1Pct?: string; stopPct?: string;
    reasoning?: string[]; scoreBreakdown?: string; isStrongSignal: boolean;
    ts: Date;
  }): Promise<void> {
    await db.insert(signalHistory).values(data).onConflictDoNothing();
  }

  async getSignalHistory(limit: number, offset: number): Promise<SignalHistoryRecord[]> {
    return db.select().from(signalHistory).orderBy(desc(signalHistory.ts)).limit(limit).offset(offset);
  }

  async getPendingSignals(): Promise<SignalHistoryRecord[]> {
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
    return db.select().from(signalHistory)
      .where(and(eq(signalHistory.outcome, "PENDING"), gt(signalHistory.ts, cutoff)));
  }

  async resolveSignalOutcome(signalId: number, outcome: string, pnlPct: string): Promise<void> {
    await db.update(signalHistory)
      .set({ outcome, pnlPct, updatedAt: new Date() })
      .where(eq(signalHistory.signalId, signalId));
  }

  async updateSignalOutcomeById(id: number, outcome: string, pnlPct?: string): Promise<void> {
    await db.update(signalHistory)
      .set({ outcome, ...(pnlPct !== undefined ? { pnlPct } : {}), updatedAt: new Date() })
      .where(eq(signalHistory.id, id));
  }

  async getSignalStats(): Promise<{ total: number; wins: number; losses: number; pending: number; avgPnl: number; weeklyData: any[]; byAsset: any[]; byDirection: any[] }> {
    const all = await db.select().from(signalHistory).orderBy(desc(signalHistory.ts)).limit(10000);
    const wins = all.filter(s => s.outcome === "WIN").length;
    const losses = all.filter(s => s.outcome === "LOSS").length;
    const pending = all.filter(s => s.outcome === "PENDING").length;
    const resolved = all.filter(s => s.pnlPct && (s.outcome === "WIN" || s.outcome === "LOSS"));
    const avgPnl = resolved.length > 0
      ? resolved.reduce((sum, s) => sum + parseFloat(s.pnlPct || "0"), 0) / resolved.length
      : 0;
    // Weekly data (last 8 weeks)
    const weeklyMap: Record<string, { wins: number; losses: number; week: string }> = {};
    for (const s of all) {
      const d = new Date(s.ts);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weeklyMap[key]) weeklyMap[key] = { wins: 0, losses: 0, week: key };
      if (s.outcome === "WIN") weeklyMap[key].wins++;
      if (s.outcome === "LOSS") weeklyMap[key].losses++;
    }
    const weeklyData = Object.values(weeklyMap).sort((a, b) => a.week.localeCompare(b.week)).slice(-8);
    // By asset
    const assetMap: Record<string, { wins: number; total: number; pnlSum: number }> = {};
    for (const s of all) {
      if (!assetMap[s.token]) assetMap[s.token] = { wins: 0, total: 0, pnlSum: 0 };
      assetMap[s.token].total++;
      if (s.outcome === "WIN") assetMap[s.token].wins++;
      if (s.pnlPct) assetMap[s.token].pnlSum += parseFloat(s.pnlPct);
    }
    const byAsset = Object.entries(assetMap).map(([token, v]) => ({
      token, total: v.total, winRate: v.total > 0 ? Math.round(v.wins / v.total * 100) : 0,
      avgPnl: v.total > 0 ? +(v.pnlSum / v.total).toFixed(2) : 0,
    })).sort((a, b) => b.total - a.total).slice(0, 10);
    // By direction
    const dirMap: Record<string, { wins: number; total: number }> = { LONG: { wins: 0, total: 0 }, SHORT: { wins: 0, total: 0 } };
    for (const s of all) {
      if (!dirMap[s.direction]) continue;
      dirMap[s.direction].total++;
      if (s.outcome === "WIN") dirMap[s.direction].wins++;
    }
    const byDirection = Object.entries(dirMap).map(([direction, v]) => ({
      direction, total: v.total, winRate: v.total > 0 ? Math.round(v.wins / v.total * 100) : 0,
    }));
    const meaningful = wins + losses + pending;
    return { total: meaningful, wins, losses, pending, avgPnl: +avgPnl.toFixed(2), weeklyData, byAsset, byDirection };
  }

  // ── Trade Journal ─────────────────────────────────────────────────────────
  async getTradeJournal(userId: string): Promise<TradeJournalEntry[]> {
    return db.select().from(tradeJournal).where(eq(tradeJournal.userId, userId)).orderBy(desc(tradeJournal.createdAt)).limit(200);
  }

  async addTradeJournalEntry(data: Omit<TradeJournalEntry, "id" | "createdAt" | "closedAt">): Promise<TradeJournalEntry> {
    const [entry] = await db.insert(tradeJournal).values(data).returning();
    return entry;
  }

  async updateTradeJournalEntry(id: number, userId: string, updates: Partial<TradeJournalEntry>): Promise<void> {
    const { id: _id, userId: _uid, createdAt: _ca, ...safeUpdates } = updates as any;
    if (updates.outcome && updates.outcome !== "OPEN") {
      (safeUpdates as any).closedAt = new Date();
    }
    await db.update(tradeJournal).set(safeUpdates).where(and(eq(tradeJournal.id, id), eq(tradeJournal.userId, userId)));
  }

  async deleteTradeJournalEntry(id: number, userId: string): Promise<void> {
    await db.delete(tradeJournal).where(and(eq(tradeJournal.id, id), eq(tradeJournal.userId, userId)));
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────
  async getUserWatchlist(userId: string): Promise<WatchlistItem[]> {
    return db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)).orderBy(desc(watchlistItems.createdAt));
  }

  async addToWatchlist(userId: string, symbol: string, assetClass: string, note?: string): Promise<WatchlistItem> {
    const existing = await db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.symbol, symbol)));
    if (existing.length > 0) return existing[0];
    const [item] = await db.insert(watchlistItems).values({ userId, symbol, assetClass, note }).returning();
    return item;
  }

  async removeFromWatchlist(userId: string, symbol: string): Promise<void> {
    await db.delete(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.symbol, symbol)));
  }
}

export const storage = new DatabaseStorage();
