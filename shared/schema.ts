import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull().default("Trader"),
  subscribeToBrief: boolean("subscribe_to_brief").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  tier: text("tier").notNull().default("free"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  promoCode: text("promo_code"),
  promoExpiresAt: timestamp("promo_expires_at"),
  referralCode: text("referral_code").unique(),
  referredBy: text("referred_by"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const accessCodes = pgTable("access_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  type: text("type").notNull().default("vip"),
  active: boolean("active").notNull().default(true),
  usedBy: text("used_by"),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subscribers = pgTable("subscribers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default("Trader"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerUserId: text("referrer_user_id").notNull(),
  referredUserId: text("referred_user_id").notNull(),
  status: text("status").notNull().default("pending"),
  rewardGranted: boolean("reward_granted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userAlerts = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  sym: text("sym").notNull(),
  field: text("field").notNull(),
  condition: text("condition").notNull(),
  threshold: text("threshold").notNull(),
  label: text("label").notNull(),
  triggered: boolean("triggered").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WebAuthnCredential = typeof webauthnCredentials.$inferSelect;

export const insertUserAlertSchema = createInsertSchema(userAlerts).pick({
  userId: true,
  sym: true,
  field: true,
  condition: true,
  threshold: true,
  label: true,
  expiresAt: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
  name: true,
  subscribeToBrief: true,
});

export const insertAccessCodeSchema = createInsertSchema(accessCodes).pick({
  code: true,
  label: true,
  type: true,
});

export const insertReferralSchema = createInsertSchema(referrals).pick({
  referrerUserId: true,
  referredUserId: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type AccessCode = typeof accessCodes.$inferSelect;
export type InsertAccessCode = z.infer<typeof insertAccessCodeSchema>;
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type UserAlert = typeof userAlerts.$inferSelect;
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;

// ── Signal History (persistent record of every fired signal) ─────────────────
export const signalHistory = pgTable("signal_history", {
  id: serial("id").primaryKey(),
  signalId: integer("signal_id").notNull(),
  token: text("token").notNull(),
  direction: text("direction").notNull(),
  conf: integer("conf").notNull().default(0),
  advancedScore: integer("advanced_score").default(0),
  entry: text("entry").notNull(),
  tp1: text("tp1"),
  stopLoss: text("stop_loss"),
  leverage: text("leverage"),
  pctMove: text("pct_move"),
  tp1Pct: text("tp1_pct"),
  stopPct: text("stop_pct"),
  reasoning: text("reasoning").array(),
  scoreBreakdown: text("score_breakdown"),
  isStrongSignal: boolean("is_strong_signal").default(false),
  outcome: text("outcome").default("PENDING"),
  pnlPct: text("pnl_pct"),
  ts: timestamp("ts").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SignalHistoryRecord = typeof signalHistory.$inferSelect;

// ── Watchlist Items (per-user list of tracked tokens) ─────────────────────────
export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull(),
  minConf: integer("min_conf").notNull().default(70),
  alertEnabled: boolean("alert_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).pick({
  userId: true,
  token: true,
  minConf: true,
});
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
