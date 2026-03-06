import { type User, type InsertUser, type AccessCode, type InsertAccessCode, users, accessCodes } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStripeCustomer(userId: string, customerId: string): Promise<void>;
  updateUserSubscription(userId: string, subscriptionId: string | null, tier: string): Promise<void>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  getAccessCode(code: string): Promise<AccessCode | undefined>;
  createAccessCode(data: InsertAccessCode): Promise<AccessCode>;
  revokeAccessCode(code: string): Promise<void>;
  listAccessCodes(): Promise<AccessCode[]>;
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
}

export const storage = new DatabaseStorage();
