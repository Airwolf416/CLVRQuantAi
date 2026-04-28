import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, serial, integer, decimal, jsonb, doublePrecision, index } from "drizzle-orm/pg-core";
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
  isAdmin: boolean("is_admin").notNull().default(false),
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

// ── AI Signal Log (unified log for Trade Ideas / Quant / Signals / Basket) ──
export const aiSignalLog = pgTable("ai_signal_log", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 30 }).notNull(),          // 'trade_ideas' | 'quant_scanner' | 'signals_tab' | 'basket'
  token: varchar("token", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),    // 'LONG' | 'SHORT'
  tradeType: varchar("trade_type", { length: 20 }),             // 'SCALP' | 'DAY_TRADE' | 'SWING' | 'POSITION'
  entryPrice: decimal("entry_price", { precision: 20, scale: 8 }).notNull(),
  tp1Price: decimal("tp1_price", { precision: 20, scale: 8 }),
  tp2Price: decimal("tp2_price", { precision: 20, scale: 8 }),
  tp3Price: decimal("tp3_price", { precision: 20, scale: 8 }),
  stopLoss: decimal("stop_loss", { precision: 20, scale: 8 }),
  leverage: varchar("leverage", { length: 10 }),
  conviction: integer("conviction"),                             // 0-100
  edgeScore: varchar("edge_score", { length: 10 }),              // '68%'
  edgeSource: varchar("edge_source", { length: 20 }),            // 'OI-verified' | 'estimated' | 'no OI'
  kronos: boolean("kronos").default(false),
  killClockHours: integer("kill_clock_hours"),
  killClockExpires: timestamp("kill_clock_expires"),
  outcome: varchar("outcome", { length: 20 }).default("PENDING"),// 'PENDING' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED_WIN' | 'EXPIRED_LOSS'
  pnlPct: decimal("pnl_pct", { precision: 10, scale: 4 }),
  resolvedAt: timestamp("resolved_at"),
  thesis: text("thesis"),
  invalidation: text("invalidation"),
  scores: jsonb("scores"),
  // ── Visibility scope ──
  // 'global'   = default 47-asset scanner output, visible to every user
  // 'promoted' = generated for a single Elite user's promoted asset; visible
  //              only to that user via targetUserId
  scope: varchar("scope", { length: 16 }).default("global").notNull(),
  targetUserId: varchar("target_user_id", { length: 64 }),
  // News context snapshot at signal-generation time — used for later
  // outcome ↔ news-conflict correlation analysis. Shape:
  // { hasConflict, severity, bearishCount, bullishCount, neutralCount,
  //   confidenceAdjustment, topHeadlines:[...] }
  newsContext: jsonb("news_context"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AiSignalLogRecord = typeof aiSignalLog.$inferSelect;
export type InsertAiSignalLog = typeof aiSignalLog.$inferInsert;

// ── News Items (persisted CryptoPanic feed for analytics + correlation) ──────
// Live signal gating reads from the in-memory cache for speed; this table is
// the historical record. Dedupe on externalId. Nightly cleanup drops > 90d.
export const newsItems = pgTable("news_items", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  title: text("title").notNull(),
  source: text("source"),
  tickers: text("tickers"),                                  // comma-joined symbols
  sentiment: varchar("sentiment", { length: 16 }),           // bullish | bearish | neutral
  severity: varchar("severity", { length: 16 }),             // low | medium | high
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byCreatedAt: index("news_items_created_at_idx").on(t.createdAt),
}));
export type NewsItem = typeof newsItems.$inferSelect;
export type InsertNewsItem = typeof newsItems.$inferInsert;

// ── User Promoted Assets (Elite-only Promote-to-Scanner) ─────────────────────
// Each Elite user can promote up to 5 basket assets to receive personalised
// signals scoped to them only. Default 47-asset global scanner is untouched.
export const userPromotedAssets = pgTable("user_promoted_assets", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  assetSymbol: varchar("asset_symbol", { length: 32 }).notNull(),  // display label, e.g. "TSM", "0700.HK"
  assetClass: varchar("asset_class", { length: 16 }).notNull(),    // crypto | equity | commodity | forex
  yahooSymbol: varchar("yahoo_symbol", { length: 32 }).notNull(),  // resolved yfinance symbol
  promotedAt: timestamp("promoted_at").defaultNow().notNull(),
}, (t) => ({
  byUser: index("user_promoted_assets_user_idx").on(t.userId),
}));
export type UserPromotedAsset = typeof userPromotedAssets.$inferSelect;
export type InsertUserPromotedAsset = typeof userPromotedAssets.$inferInsert;

// ── Adaptive Thresholds (auto-tuning min conviction per token + direction) ──
export const adaptiveThresholds = pgTable("adaptive_thresholds", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),      // 'LONG' | 'SHORT' | 'ALL'
  tradeType: varchar("trade_type", { length: 20 }).default("ALL"),
  baselineThreshold: integer("baseline_threshold").default(75),
  currentThreshold: integer("current_threshold").default(75),
  adjustment: integer("adjustment").default(0),
  winRate30d: decimal("win_rate_30d", { precision: 5, scale: 2 }),
  sampleSize: integer("sample_size").default(0),
  suppressed: boolean("suppressed").default(false),
  manualOverride: boolean("manual_override").default(false),
  lastRecalc: timestamp("last_recalc").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AdaptiveThreshold = typeof adaptiveThresholds.$inferSelect;

// ── Watchlist Items (Pro+) ────────────────────────────────────────────────────
export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  assetClass: text("asset_class").notNull().default("crypto"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({ id: true, createdAt: true });
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;

// ── Trade Journal (Elite) ──────────────────────────────────────────────────────
export const tradeJournal = pgTable("trade_journal", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  direction: text("direction").notNull(), // LONG | SHORT
  entry: text("entry").notNull(),
  stop: text("stop"),
  tp1: text("tp1"),
  tp2: text("tp2"),
  size: text("size"),
  notes: text("notes"),
  outcome: text("outcome").default("OPEN"), // OPEN | WIN | LOSS
  pnlPct: text("pnl_pct"),
  createdAt: timestamp("created_at").defaultNow(),
  closedAt: timestamp("closed_at"),
});

export type TradeJournalEntry = typeof tradeJournal.$inferSelect;
export const insertTradeJournalSchema = createInsertSchema(tradeJournal).omit({
  id: true, createdAt: true, closedAt: true,
});
export type InsertTradeJournalEntry = z.infer<typeof insertTradeJournalSchema>;

// ── Phase 2A: Quant Service Tables ────────────────────────────────────────────
export const quantScores = pgTable("quant_scores", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  composite_z: doublePrecision("composite_z").notNull(),
  side: text("side"),
  regime: text("regime").notNull(),
  passes: boolean("passes").notNull(),
  gates_failed: text("gates_failed").array().notNull().default(sql`ARRAY[]::text[]`),
  factors: jsonb("factors").notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  bySymbolTs: index("quant_scores_symbol_ts_idx").on(t.symbol, t.ts),
}));

export type QuantScore = typeof quantScores.$inferSelect;

export const microstructureSnapshots = pgTable("microstructure_snapshots", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  mid: doublePrecision("mid"),
  obi: doublePrecision("obi"),
  wobi: doublePrecision("wobi"),
  cvd: doublePrecision("cvd"),
  cvd_z: doublePrecision("cvd_z"),
  ofi_1m: doublePrecision("ofi_1m"),
  ofi_z: doublePrecision("ofi_z"),
  funding: doublePrecision("funding"),
  oi: doublePrecision("oi"),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  bySymbolTs: index("micro_snapshots_symbol_ts_idx").on(t.symbol, t.ts),
}));

export type MicrostructureSnapshot = typeof microstructureSnapshots.$inferSelect;

// ── Persistent rejection log for the admin tuning dashboard ─────────────────
// Mirrors the in-memory ring buffer in server/lib/rejectionLog.ts but durable
// across restarts so /admin/rejections can show 30d trends.
export const signalRejections = pgTable("signal_rejections", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  source: text("source").notNull(),                    // auto_scanner | ai_signal | manual
  token: text("token").notNull(),
  direction: text("direction"),                        // LONG | SHORT | null
  reason: text("reason").notNull(),                    // RejectionReason union
  detail: text("detail").notNull(),
  proposedEntry: doublePrecision("proposed_entry"),
  proposedSl: doublePrecision("proposed_sl"),
  proposedTp1: doublePrecision("proposed_tp1"),
  conviction: integer("conviction"),
}, (t) => ({
  byTs: index("signal_rejections_ts_idx").on(t.ts),
  byReason: index("signal_rejections_reason_idx").on(t.reason),
  byToken: index("signal_rejections_token_idx").on(t.token),
}));
export type SignalRejection = typeof signalRejections.$inferSelect;

// ── Chart AI (Elite) — uploaded chart analysis with daily limits ─────────────
export const chartAiUsage = pgTable("chart_ai_usage", {
  userId: text("user_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD (UTC)
  count: integer("count").notNull().default(0),
}, (t) => ({
  pk: index("chart_ai_usage_pk").on(t.userId, t.date),
}));

export const chartAiAnalyses = pgTable("chart_ai_analyses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  horizon: text("horizon").notNull(),
  asset: text("asset"),
  imageHash: text("image_hash"),
  responseJson: jsonb("response_json").notNull(),
  costEstimate: decimal("cost_estimate", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  byUser: index("idx_chart_ai_analyses_user").on(t.userId, t.createdAt),
}));

export const chartAiMonthlySpend = pgTable("chart_ai_monthly_spend", {
  month: text("month").primaryKey(), // YYYY-MM (UTC)
  totalSpend: decimal("total_spend", { precision: 10, scale: 4 }).notNull().default("0"),
  alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
});

export type ChartAiAnalysis = typeof chartAiAnalyses.$inferSelect;
export type InsertChartAiAnalysis = typeof chartAiAnalyses.$inferInsert;

// ── Chart AI plans + outcomes (structured trade plan + resolution tracking) ──
// Backs Alert History UI + supplies labeled dataset for future ML calibration.
// Features = `snapshot` JSONB; labels = `chartaiOutcomes.realizedR` / `status`.
//
// Two tables intentionally — plans is append-only and immutable, outcomes is
// the mutable state machine (open → active → resolved). 1:1 relationship via
// requestId. We keep the legacy `chart_ai_analyses` table untouched for back-
// compat; `chartai_plans` is the richer, ML-ready successor written alongside.
//
// schemaVersion + frameworkVersion are stamped on every row so future
// iterations of the prompt schema or risk-math framework don't pollute the
// historical dataset. Bump the constants in `server/lib/chartAIVersions.ts`
// when the contract changes.
export const chartaiPlans = pgTable("chartai_plans", {
  requestId: varchar("request_id", { length: 12 }).primaryKey(),
  planId: varchar("plan_id", { length: 64 }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Asset context
  ticker: text("ticker").notNull(),
  assetClass: text("asset_class").notNull(),    // equity|perp|fx|commodity|unknown
  session: text("session"),                     // RTH|ETH|24x7

  // Plan vs refusal
  refusalCode: text("refusal_code"),            // NULL when plan generated
  refusalExplanation: text("refusal_explanation"),

  // Plan output (NULL for refusals)
  bias: text("bias"),
  direction: text("direction"),                 // long|short|no_trade
  entryLow: decimal("entry_low", { precision: 20, scale: 8 }),
  entryHigh: decimal("entry_high", { precision: 20, scale: 8 }),
  stopLoss: decimal("stop_loss", { precision: 20, scale: 8 }),
  takeProfit1: decimal("take_profit_1", { precision: 20, scale: 8 }),
  takeProfit2: decimal("take_profit_2", { precision: 20, scale: 8 }),
  rrTp1: decimal("rr_tp1", { precision: 8, scale: 3 }),
  rrTp2: decimal("rr_tp2", { precision: 8, scale: 3 }),
  timeHorizonMin: integer("time_horizon_min"),
  hardExitTimerMin: integer("hard_exit_timer_min"),
  conviction: integer("conviction"),
  invalidation: text("invalidation"),
  rationale: text("rationale"),

  // Snapshot of inputs at generation time (= ML feature vector)
  snapshot: jsonb("snapshot").notNull(),

  // Telemetry
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  chartImageAttached: boolean("chart_image_attached").notNull().default(false),

  // Versioning — stamped from constants so post-hoc analytics can segment by
  // exactly which prompt/math contract produced each row.
  schemaVersion: text("schema_version").notNull(),
  frameworkVersion: text("framework_version").notNull(),
}, (t) => ({
  byUserCreated: index("idx_chartai_plans_user_created").on(t.userId, t.createdAt),
  byTickerCreated: index("idx_chartai_plans_ticker_created").on(t.ticker, t.createdAt),
  byBias: index("idx_chartai_plans_bias").on(t.bias),
  byRefusal: index("idx_chartai_plans_refusal").on(t.refusalCode),
}));

export const chartaiOutcomes = pgTable("chartai_outcomes", {
  // FK to chartai_plans.request_id; CASCADE delete handled in initDb DDL
  requestId: varchar("request_id", { length: 12 }).primaryKey(),

  // Resolution status — open|active|tp1_hit|tp2_hit|sl_hit|hard_exit|
  // time_stop|invalidated|expired|manual_close
  status: text("status").notNull().default("open"),

  // Fill (set when price first enters entry zone)
  fillPrice: decimal("fill_price", { precision: 20, scale: 8 }),
  entryFilledAt: timestamp("entry_filled_at", { withTimezone: true }),

  // Resolution
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  exitPrice: decimal("exit_price", { precision: 20, scale: 8 }),
  realizedR: decimal("realized_r", { precision: 8, scale: 3 }),         // R-multiples
  realizedPct: decimal("realized_pct", { precision: 8, scale: 4 }),     // raw %
  durationMinutes: integer("duration_minutes"),

  // Path stats — critical features for ML calibration
  maxFavorableExcursionR: decimal("max_favorable_excursion_r", { precision: 8, scale: 3 }),
  maxAdverseExcursionR: decimal("max_adverse_excursion_r", { precision: 8, scale: 3 }),
  timeToFirst05rMin: integer("time_to_first_05r_min"),

  // Audit
  resolutionSource: text("resolution_source"),                          // auto_tracker|manual|ws_event
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byStatus: index("idx_chartai_outcomes_status").on(t.status),
  byResolved: index("idx_chartai_outcomes_resolved").on(t.resolvedAt),
}));

export type ChartaiPlan = typeof chartaiPlans.$inferSelect;
export type InsertChartaiPlan = typeof chartaiPlans.$inferInsert;
export type ChartaiOutcome = typeof chartaiOutcomes.$inferSelect;
export type InsertChartaiOutcome = typeof chartaiOutcomes.$inferInsert;

// ── Weekly Updates ("What's New This Week" + Saturday digest email) ──────────
// Admin posts a major update; the latest one displaces the prior on the About
// page. The Saturday 10am ET scheduler emails it to subscribers if a fresh
// (created within the last 7 days) update exists and hasn't been emailed yet.
export const weeklyUpdates = pgTable("weekly_updates", {
  id: serial("id").primaryKey(),
  version: text("version"),                                  // e.g. "v2 · Apr 21, 2026"
  title: text("title").notNull(),                            // headline
  summary: text("summary").notNull(),                        // 1-2 sentence intro
  items: jsonb("items").notNull(),                           // [{emoji, title, description}]
  emailSentAt: timestamp("email_sent_at"),                   // null until Saturday email goes out
  emailRecipientCount: integer("email_recipient_count").default(0),
  createdBy: text("created_by"),                             // admin email
  createdAt: timestamp("created_at").defaultNow(),
});
export type WeeklyUpdate = typeof weeklyUpdates.$inferSelect;
export const insertWeeklyUpdateSchema = createInsertSchema(weeklyUpdates).omit({
  id: true, createdAt: true, emailSentAt: true, emailRecipientCount: true,
});
export type InsertWeeklyUpdate = z.infer<typeof insertWeeklyUpdateSchema>;

// Update log buffer — owner adds noteworthy improvements throughout the week
// (e.g. "Added Face ID login"). When the weekly update is generated/published,
// the AI synthesizes from these curated entries instead of relying on git
// commits (which Railway deployments often strip). Entries get stamped with
// `included_in_update_id` once shipped, so the buffer naturally clears.
export const updateLogEntries = pgTable("update_log_entries", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),       // short title — what shipped
  detail: text("detail"),                     // optional longer description / why it matters to user
  emoji: text("emoji"),                       // optional emoji hint for the digest
  addedBy: text("added_by"),                  // admin email
  includedInUpdateId: integer("included_in_update_id"),  // FK to weekly_updates.id once shipped
  createdAt: timestamp("created_at").defaultNow(),
});
export type UpdateLogEntry = typeof updateLogEntries.$inferSelect;
export const insertUpdateLogEntrySchema = createInsertSchema(updateLogEntries).omit({
  id: true, createdAt: true, includedInUpdateId: true,
});
export type InsertUpdateLogEntry = z.infer<typeof insertUpdateLogEntrySchema>;
