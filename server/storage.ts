import { type User, type InsertUser, type AccessCode, type InsertAccessCode, type Referral, type InsertReferral, type UserAlert, type InsertUserAlert, type WebAuthnCredential, type SignalHistoryRecord, type WatchlistItem, type InsertWatchlistItem, type TradeJournalEntry, users, accessCodes, referrals, userAlerts, webauthnCredentials, signalHistory, watchlistItems, tradeJournal } from "@shared/schema";
import { db } from "./db";
import { eq, sql, and, gt, lt, desc, ne } from "drizzle-orm";

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
  getWatchlistByUser(userId: string): Promise<WatchlistItem[]>;
  addWatchlistItem(data: InsertWatchlistItem): Promise<WatchlistItem>;
  removeWatchlistItem(id: number, userId: string): Promise<void>;
  updateWatchlistMinConf(id: number, userId: string, minConf: number): Promise<void>;
  getAllWatchlists(): Promise<WatchlistItem[]>;
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

  async getAccessCode(code: string): Promise<AccessCode | undefined> {
    const [ac] = await db.select().from(accessCodes).where(eq(accessCodes.code, code));
    return ac;
  }

  async createAccessCode(data: InsertAccessCode): Promise<AccessCode> {
    const [ac] = await db.insert(accessCodes).values(data).returning();
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
    await db.update(users).set({ emailVerified: true, emailVerificationToken: null }).where(eq(users.id, userId));
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
    const all = await db.select().from(signalHistory).orderBy(desc(signalHistory.ts)).limit(500);
    const wins = all.filter(s => s.outcome === "WIN").length;
    const losses = all.filter(s => s.outcome === "LOSS").length;
    const pending = all.filter(s => s.outcome === "PENDING").length;
    const resolved = all.filter(s => s.pnlPct && s.outcome !== "PENDING");
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
    return { total: all.length, wins, losses, pending, avgPnl: +avgPnl.toFixed(2), weeklyData, byAsset, byDirection };
  }

  // ── Watchlist ───────────────────────────────────────────────────────────────
  async getWatchlistByUser(userId: string): Promise<WatchlistItem[]> {
    return db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId));
  }

  async addWatchlistItem(data: InsertWatchlistItem): Promise<WatchlistItem> {
    const [item] = await db.insert(watchlistItems).values(data).returning();
    return item;
  }

  async removeWatchlistItem(id: number, userId: string): Promise<void> {
    await db.delete(watchlistItems).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
  }

  async updateWatchlistMinConf(id: number, userId: string, minConf: number): Promise<void> {
    await db.update(watchlistItems).set({ minConf }).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
  }

  async getAllWatchlists(): Promise<WatchlistItem[]> {
    return db.select().from(watchlistItems).where(eq(watchlistItems.alertEnabled, true));
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
}

export const storage = new DatabaseStorage();
