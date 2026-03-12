import { type User, type InsertUser, type AccessCode, type InsertAccessCode, type Referral, type InsertReferral, type UserAlert, type InsertUserAlert, type WebAuthnCredential, users, accessCodes, referrals, userAlerts, webauthnCredentials } from "@shared/schema";
import { db } from "./db";
import { eq, sql, and, gt, lt } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
