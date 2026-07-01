import { pool } from "./db";

/**
 * Creates all required tables on startup using IF NOT EXISTS.
 * Safe to run on every deploy — never drops or truncates existing data.
 * This ensures Railway's database is always ready even after a reset.
 */
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── users ────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username                 TEXT NOT NULL UNIQUE,
        email                    TEXT NOT NULL UNIQUE,
        password                 TEXT NOT NULL,
        name                     TEXT NOT NULL DEFAULT 'Trader',
        tier                     TEXT NOT NULL DEFAULT 'free',
        subscribe_to_brief       BOOLEAN NOT NULL DEFAULT false,
        stripe_customer_id       TEXT,
        stripe_subscription_id   TEXT,
        reset_token              TEXT,
        reset_token_expiry       TIMESTAMP,
        promo_code               TEXT,
        promo_expires_at         TIMESTAMP,
        referral_code            TEXT UNIQUE,
        referred_by              TEXT,
        must_change_password     BOOLEAN DEFAULT false,
        email_verified           BOOLEAN NOT NULL DEFAULT false,
        email_verification_token TEXT,
        is_admin                 BOOLEAN NOT NULL DEFAULT false,
        created_at               TIMESTAMP DEFAULT NOW()
      )
    `);
    // Idempotent migration for existing DBs
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`);
    // Promote owner to admin (idempotent)
    await client.query(`UPDATE users SET is_admin = true WHERE LOWER(email) = LOWER('mikeclaver@gmail.com') AND is_admin = false`);

    // ── access_codes ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        code        TEXT NOT NULL UNIQUE,
        label       TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'vip',
        active      BOOLEAN NOT NULL DEFAULT true,
        use_count   INTEGER DEFAULT 0,
        max_uses    INTEGER,
        used_by     TEXT,
        used_at     TIMESTAMP,
        expires_at  TIMESTAMP,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    // Idempotent migration — adds the new redemption_type column to existing
    // DBs. Drives the kill-the-exploit logic in /api/verify-code:
    //   single_use_global   → ONE total redemption ever; the existing
    //                          single-use codes (CLVR-FF-*, individual VIPs)
    //                          where max_uses IS NULL or = 1.
    //   single_use_per_user → each verified user can redeem ONCE; shared
    //                          group codes like CLVR-VIP-GROUP2026 (max_uses
    //                          = -1) and any limited multi-use code.
    // Backfill existing rows so prod doesn't end up with NULL after the ALTER.
    await client.query(`
      ALTER TABLE access_codes
        ADD COLUMN IF NOT EXISTS redemption_type VARCHAR(32) NOT NULL DEFAULT 'single_use_per_user'
    `);
    await client.query(`
      UPDATE access_codes
         SET redemption_type = 'single_use_global'
       WHERE redemption_type IS NULL OR (max_uses IS NULL OR max_uses = 1)
    `);
    await client.query(`
      UPDATE access_codes
         SET redemption_type = 'single_use_per_user'
       WHERE max_uses = -1 OR max_uses > 1
    `);

    // ── code_redemptions ─────────────────────────────────────────────────────
    // Per-redemption ledger — the source of truth for who redeemed what and
    // the SOLE mechanism preventing the QR/group-code spam exploit. The
    // UNIQUE(code, user_id) constraint is the lock: any concurrent INSERT
    // race serializes through Postgres, only one wins, the rest get a
    // unique-violation. Replaces the old "users.promo_code = X means done"
    // implicit dedup, which had no race protection AND only tracked the
    // user's MOST RECENT code (so re-redeeming overwrote the prior promo
    // and silently re-fired Elite emails + reset the expiry).
    await client.query(`
      CREATE TABLE IF NOT EXISTS code_redemptions (
        id            BIGSERIAL PRIMARY KEY,
        code          TEXT NOT NULL,
        user_id       VARCHAR NOT NULL,
        redeemed_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        ip_address    TEXT,
        user_agent    TEXT,
        tier_granted  TEXT NOT NULL,
        UNIQUE (code, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_code_redemptions_user ON code_redemptions (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_code_redemptions_code ON code_redemptions (code)`);

    // ── redemption_attempts ──────────────────────────────────────────────────
    // Append-only audit log of every redemption attempt (success AND failure).
    // Drives the per-user 5/hour rate limit AND gives ops a queryable signal
    // for brute-force / scraping patterns. NOT a dedup mechanism — that's
    // strictly code_redemptions' job. Result is one of: success, unverified,
    // unauthenticated, user_not_found, not_found, inactive, expired,
    // already_redeemed, global_limit_reached, rate_limited, claim_error.
    await client.query(`
      CREATE TABLE IF NOT EXISTS redemption_attempts (
        id              BIGSERIAL PRIMARY KEY,
        user_id         VARCHAR,
        code_attempted  TEXT,
        attempted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        ip_address      TEXT,
        result          VARCHAR(32) NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_redemption_attempts_user_time ON redemption_attempts (user_id, attempted_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_redemption_attempts_ip_time  ON redemption_attempts (ip_address, attempted_at)`);

    // One-time backfill: grandfather every user who currently has a promo_code
    // pointing at a known access_code into the new code_redemptions ledger.
    // We CANNOT retroactively "audit and revoke" past CLVR-VIP-GROUP2026 spam
    // because the old flow only ever stored the user's MOST RECENT code on
    // users.promo_code (a single TEXT field, not a per-redemption row), so
    // there's no historical multi-redemption data to audit against. Going
    // forward the UNIQUE(code, user_id) constraint kills the exploit. This
    // backfill ensures existing users keep access AND can't re-redeem.
    await client.query(`
      INSERT INTO code_redemptions (code, user_id, tier_granted, redeemed_at)
      SELECT u.promo_code, u.id, COALESCE(NULLIF(u.tier, ''), 'elite'),
             COALESCE(u.created_at, NOW())
        FROM users u
        JOIN access_codes ac ON ac.code = u.promo_code
       WHERE u.promo_code IS NOT NULL AND u.id IS NOT NULL
      ON CONFLICT (code, user_id) DO NOTHING
    `);

    // ── user_sessions (connect-pg-simple) ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid    VARCHAR NOT NULL PRIMARY KEY,
        sess   JSON NOT NULL,
        expire TIMESTAMP NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire)
    `);

    // ── daily_briefs_log ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_briefs_log (
        id              SERIAL PRIMARY KEY,
        date_key        VARCHAR NOT NULL UNIQUE,
        sent_at         TIMESTAMP DEFAULT NOW(),
        recipient_count INTEGER DEFAULT 0
      )
    `);

    // ── daily_brief_telegram_log ─────────────────────────────────────────────
    // Independent ledger so the morning Telegram trade idea fires AT MOST
    // once per day, even when the email pipeline retries (which deletes the
    // daily_briefs_log row on recipient_count=0). The PK constraint on
    // date_key acts as the lock — see claimTelegramSlot() in dailyBrief.ts:
    // INSERT ... ON CONFLICT DO NOTHING is used as an atomic claim BEFORE
    // the autoposter network call, and releaseTelegramSlotOnFailure() DELETEs
    // the row on a hard failure so a future retry can re-attempt.
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_brief_telegram_log (
        date_key   VARCHAR PRIMARY KEY,
        sent_at    TIMESTAMP DEFAULT NOW(),
        token      VARCHAR,
        direction  VARCHAR,
        source     VARCHAR
      )
    `);

    // ── promo_reminder_log ───────────────────────────────────────────────────
    // Idempotency ledger so the promo-expiry reminder fires AT MOST once per
    // (user, kind, expiry_date). Two reminders are sent per access-code grant:
    //   kind = 'expiry_7d'  → ~one week before promo_expires_at
    //   kind = 'expiry_0d'  → on the day of expiry (within 24h)
    // Including expiry_date in the PK lets a user receive a fresh pair of
    // reminders if they redeem a NEW code (later expiry). The PK constraint
    // is the lock — claimPromoReminderSlot()/releasePromoReminderSlot() in
    // storage.ts use INSERT ... ON CONFLICT DO NOTHING as the atomic claim.
    // Mirrors the daily_brief_telegram_log pattern below.
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_reminder_log (
        user_id     VARCHAR NOT NULL,
        kind        VARCHAR NOT NULL,
        expiry_date DATE    NOT NULL,
        sent_at     TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, kind, expiry_date)
      )
    `);

    // ── push_subscriptions ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           SERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL,
        subscription JSONB NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── subscribers ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        email      TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL DEFAULT 'Trader',
        active     BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── concierge_bookings ───────────────────────────────────────────────────
    // 30-min 1-on-1 platform training sessions booked via the AI Concierge.
    // price_usd=0 rows are free (eligible Elite); paid rows go through Stripe
    // checkout (status flips pending→confirmed on webhook / success).
    await client.query(`
      CREATE TABLE IF NOT EXISTS concierge_bookings (
        id                SERIAL PRIMARY KEY,
        user_id           VARCHAR NOT NULL,
        slot_date         TEXT NOT NULL,
        slot_time         TEXT NOT NULL,
        timezone          TEXT NOT NULL DEFAULT 'America/Toronto',
        price_usd         INTEGER NOT NULL DEFAULT 0,
        tier              TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        stripe_session_id TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS concierge_bookings_user_idx ON concierge_bookings (user_id, created_at DESC)`);
    // Additive: Google Calendar event id + Meet link + a finalize idempotency
    // stamp. emails_sent_at guards against double calendar-create / double email
    // on Stripe webhook retries (it is the single finalize gate).
    await client.query(`ALTER TABLE concierge_bookings ADD COLUMN IF NOT EXISTS calendar_event_id TEXT`).catch(() => {});
    await client.query(`ALTER TABLE concierge_bookings ADD COLUMN IF NOT EXISTS meet_link TEXT`).catch(() => {});
    await client.query(`ALTER TABLE concierge_bookings ADD COLUMN IF NOT EXISTS emails_sent_at TIMESTAMPTZ`).catch(() => {});

    // ── referrals ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id                SERIAL PRIMARY KEY,
        referrer_user_id  TEXT NOT NULL,
        referred_user_id  TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending',
        reward_granted    BOOLEAN NOT NULL DEFAULT false,
        created_at        TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── user_alerts ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_alerts (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        sym        TEXT NOT NULL,
        field      TEXT NOT NULL,
        condition  TEXT NOT NULL,
        threshold  TEXT NOT NULL,
        label      TEXT NOT NULL,
        triggered  BOOLEAN NOT NULL DEFAULT false,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── support_threads ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_threads (
        id              SERIAL PRIMARY KEY,
        user_id         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'open',
        subject         TEXT,
        last_message_at TIMESTAMP DEFAULT NOW(),
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads (status, last_message_at)`);
    // Additive columns: owner_notified_at gates the single "a client reached out"
    // email (one per conversation episode; reset to NULL on close). The *_typing_at
    // timestamps power the live "is typing…" indicator (freshness-windowed on read).
    await client.query(`ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS owner_notified_at TIMESTAMP`);
    await client.query(`ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS user_typing_at TIMESTAMP`);
    await client.query(`ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS owner_typing_at TIMESTAMP`);

    // ── support_messages ─────────────────────────────────────────────────────
    // sender: 'user' | 'owner' | 'ai' | 'system'   msg_type: 'text' | 'meeting_request' | 'system'
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id             SERIAL PRIMARY KEY,
        thread_id      INTEGER NOT NULL,
        sender         TEXT NOT NULL,
        body           TEXT NOT NULL,
        msg_type       TEXT NOT NULL DEFAULT 'text',
        meta           JSONB,
        read_by_owner  BOOLEAN NOT NULL DEFAULT false,
        read_by_user   BOOLEAN NOT NULL DEFAULT false,
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages (thread_id, created_at)`);

    // ── user_positions — user's own open positions WITH their stated plan ────
    // Compliance keystone: AI measures price vs the user's OWN entry/stop/target.
    // The AI never invents targets — it reflects the trader's precommitment back.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_positions (
        id            SERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL,
        symbol        TEXT NOT NULL,
        asset_class   TEXT NOT NULL DEFAULT 'equity',
        side          TEXT NOT NULL DEFAULT 'long',
        entry_price   NUMERIC,
        size_usd      NUMERIC,
        leverage      NUMERIC NOT NULL DEFAULT 1,
        stop_price    NUMERIC,
        target_price  NUMERIC,
        status        TEXT NOT NULL DEFAULT 'open',
        notes         TEXT,
        opened_at     TIMESTAMP DEFAULT NOW(),
        closed_at     TIMESTAMP,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_positions_user ON user_positions (user_id, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_positions_symbol ON user_positions (symbol)
    `);

    // ── position_event_log — idempotent dedup for T-1 / T-0 notifications ────
    // UNIQUE(position_id, event_date, phase) + ON CONFLICT DO NOTHING means a
    // server restart can never double-send a given position/event/phase.
    // phase: 't_minus_1' = 8:00 PM ET day before | 't_zero' = 7:00 AM ET day of
    await client.query(`
      CREATE TABLE IF NOT EXISTS position_event_log (
        id            SERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL,
        position_id   INTEGER NOT NULL,
        symbol        TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        event_date    DATE NOT NULL,
        phase         TEXT NOT NULL,
        tier_at_send  TEXT NOT NULL,
        channel       TEXT NOT NULL DEFAULT 'email',
        sent_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE (position_id, event_date, phase)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_position_event_log_user ON position_event_log (user_id)
    `);

    // ── webauthn_credentials ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id            SERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── signal_history ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_history (
        id              SERIAL PRIMARY KEY,
        signal_id       INTEGER NOT NULL,
        token           TEXT NOT NULL,
        direction       TEXT NOT NULL,
        conf            INTEGER NOT NULL DEFAULT 0,
        advanced_score  INTEGER DEFAULT 0,
        entry           TEXT NOT NULL,
        tp1             TEXT,
        stop_loss       TEXT,
        leverage        TEXT,
        pct_move        TEXT,
        tp1_pct         TEXT,
        stop_pct        TEXT,
        reasoning       TEXT[],
        score_breakdown TEXT,
        is_strong_signal BOOLEAN DEFAULT FALSE,
        outcome         TEXT DEFAULT 'PENDING',
        pnl_pct         TEXT,
        ts              TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    // Migrate old signal_history tables that may be missing columns
    const sigCols = ['conf', 'advanced_score', 'stop_loss', 'leverage', 'pct_move',
      'tp1_pct', 'stop_pct', 'reasoning', 'score_breakdown', 'is_strong_signal',
      'created_at', 'updated_at'];
    for (const col of sigCols) {
      const colType = col === 'conf' ? 'INTEGER DEFAULT 0'
        : col === 'advanced_score' ? 'INTEGER DEFAULT 0'
        : col === 'is_strong_signal' ? 'BOOLEAN DEFAULT FALSE'
        : col === 'reasoning' ? 'TEXT[]'
        : col === 'created_at' || col === 'updated_at' ? 'TIMESTAMP DEFAULT NOW()'
        : 'TEXT';
      await client.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS ${col} ${colType}`).catch(() => {});
    }

    // ── ai_signal_log (unified log for Trade Ideas / Quant / Signals / Basket) ─
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_signal_log (
        id                 SERIAL PRIMARY KEY,
        source             VARCHAR(30) NOT NULL,
        token              VARCHAR(20) NOT NULL,
        direction          VARCHAR(10) NOT NULL,
        trade_type         VARCHAR(20),
        entry_price        DECIMAL(20,8) NOT NULL,
        tp1_price          DECIMAL(20,8),
        tp2_price          DECIMAL(20,8),
        tp3_price          DECIMAL(20,8),
        stop_loss          DECIMAL(20,8),
        leverage           VARCHAR(10),
        conviction         INTEGER,
        edge_score         VARCHAR(10),
        edge_source        VARCHAR(20),
        kronos             BOOLEAN DEFAULT FALSE,
        kill_clock_hours   INTEGER,
        kill_clock_expires TIMESTAMP,
        outcome            VARCHAR(20) DEFAULT 'PENDING',
        pnl_pct            DECIMAL(10,4),
        resolved_at        TIMESTAMP,
        thesis             TEXT,
        invalidation       TEXT,
        scores             JSONB,
        created_at         TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_signal_log_outcome ON ai_signal_log (outcome)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_signal_log_source ON ai_signal_log (source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_signal_log_created ON ai_signal_log (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_signal_log_pending_expires ON ai_signal_log (outcome, kill_clock_expires) WHERE outcome = 'PENDING'`);
    // Performance context aggregation index — covers the hot per-(token,direction,resolved-window) query
    await client.query(`CREATE INDEX IF NOT EXISTS idx_perf_combo ON ai_signal_log (token, direction, created_at DESC) WHERE outcome IS NOT NULL AND outcome <> 'PENDING'`);

    // ── Module 1 (Setup Archetypes): additive column + index for per-archetype
    // stats. shared/schema.ts intentionally NOT touched per project preferences
    // — Drizzle stays the source of truth for typed columns, but additive raw
    // SQL CREATE/ALTER IF NOT EXISTS is the documented pattern (see access-code
    // redemption work). Archetype text is one of:
    //   BREAKOUT_RETEST | TREND_PULLBACK | RANGE_FADE |
    //   MEAN_REVERSION_EXHAUSTION | NEWS_MOMO | VWAP_RECLAIM | UNCLASSIFIED
    await client.query(`ALTER TABLE ai_signal_log ADD COLUMN IF NOT EXISTS archetype TEXT`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_signal_log_archetype ON ai_signal_log (token, direction, archetype, created_at DESC) WHERE archetype IS NOT NULL AND outcome IS NOT NULL AND outcome <> 'PENDING'`).catch(() => {});

    // ── Module 2 (Setup Taxonomy + Per-Setup Stats): additive columns +
    // tables. Same forbidden-file constraints as Module 1 — shared/schema.ts
    // intentionally NOT touched; raw SQL CREATE/ALTER IF NOT EXISTS is the
    // documented additive pattern. Columns/tables added here:
    //
    //   ai_signal_log.classification_source       — 'live' | 'backfill' | NULL
    //   ai_signal_log.classification_diagnostics  — JSONB audit trail of
    //     which classifier inputs were populated, NULL'd, treated as
    //     no-concept (asset class has no funding/OI), and which MEAN_REV
    //     clauses fired. Powers admin near-miss reports.
    //   suppressed_signals — shadow log of UNCLASSIFIED signals that WOULD
    //     be dropped under ARCHETYPE_SUPPRESSION_ENABLED=true. Always
    //     written (shadow mode default) so we can audit suppression impact
    //     before flipping the flag.
    //   backfilled_classifications — 1h-only 90d backfill rows for
    //     TREND_PULLBACK / RANGE_FADE / MEAN_REVERSION_EXHAUSTION. Joined
    //     to ai_signal_log via source_signal_id for outcome resolution.
    //   stats_divergence_log — T10 shadow-compare: TS-computed stats vs
    //     materialized-view stats divergence >1pp.
    //   stats_refresh_log — T09 MV refresh history for monitoring.
    await client.query(`ALTER TABLE ai_signal_log ADD COLUMN IF NOT EXISTS classification_source TEXT`).catch(() => {});
    await client.query(`ALTER TABLE ai_signal_log ADD COLUMN IF NOT EXISTS classification_diagnostics JSONB`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS suppressed_signals (
        id                          SERIAL PRIMARY KEY,
        ts                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ticker                      VARCHAR(20) NOT NULL,
        intended_direction          VARCHAR(10) NOT NULL,
        asset_class                 VARCHAR(20),
        source_endpoint             VARCHAR(30),
        suppression_reason          TEXT NOT NULL,
        raw_signal_payload          JSONB,
        classification_diagnostics  JSONB
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_suppressed_signals_ts     ON suppressed_signals (ts DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_suppressed_signals_token  ON suppressed_signals (ticker, intended_direction)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_suppressed_signals_reason ON suppressed_signals (suppression_reason)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS backfilled_classifications (
        id                  SERIAL PRIMARY KEY,
        source_signal_id    INTEGER NOT NULL REFERENCES ai_signal_log(id) ON DELETE CASCADE,
        archetype           TEXT NOT NULL,
        classified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        classifier_version  TEXT NOT NULL,
        diagnostics         JSONB
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_backfill_unique     ON backfilled_classifications (source_signal_id, classifier_version)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_backfill_arch              ON backfilled_classifications (archetype)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_backfill_classified_at     ON backfilled_classifications (classified_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stats_divergence_log (
        id              SERIAL PRIMARY KEY,
        ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archetype       TEXT NOT NULL,
        token           TEXT,
        direction       TEXT,
        ts_n            INTEGER,
        mv_n            INTEGER,
        ts_wr_lcb       DOUBLE PRECISION,
        mv_wr_lcb       DOUBLE PRECISION,
        divergence_abs  DOUBLE PRECISION
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stats_divergence_ts ON stats_divergence_log (ts DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stats_refresh_log (
        id             SERIAL PRIMARY KEY,
        started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms    INTEGER,
        rows_refreshed INTEGER,
        success        BOOLEAN,
        error_message  TEXT
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stats_refresh_started ON stats_refresh_log (started_at DESC)`);

    // ── Module 2 T08 — wilson_lcb() plpgsql + archetype_stats MV ──────────────
    // Database-side computation of the Wilson lower confidence bound so the
    // materialized view can store stats ready-to-render without a round trip
    // to Node for each card. IMMUTABLE — Postgres can cache results across
    // calls inside the same query. Confidence values tested: 0.80 (z=0.8416)
    // is the display default; 0.95 (z=1.6449) kept for the deprecation
    // window where both bounds are surfaced side-by-side.
    //
    // The CREATE OR REPLACE is idempotent on body changes and safe to re-run.
    await client.query(`
      CREATE OR REPLACE FUNCTION wilson_lcb(wins INTEGER, total INTEGER, confidence FLOAT)
      RETURNS FLOAT
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      DECLARE
        z      FLOAT;
        p      FLOAT;
        denom  FLOAT;
        centre FLOAT;
        margin FLOAT;
      BEGIN
        IF total IS NULL OR total <= 0 THEN
          RETURN 0;
        END IF;
        z := CASE
               WHEN confidence >= 0.99 THEN 2.5758
               WHEN confidence >= 0.95 THEN 1.6449
               WHEN confidence >= 0.90 THEN 1.2816
               WHEN confidence >= 0.80 THEN 0.8416
               ELSE 0.8416
             END;
        p      := wins::FLOAT / total::FLOAT;
        denom  := 1 + (z*z)/total;
        centre := p + (z*z)/(2*total);
        margin := z * sqrt( (p*(1-p) + (z*z)/(4*total)) / total );
        RETURN GREATEST(0, (centre - margin) / denom);
      END;
      $$;
    `).catch((e: any) => console.warn("[initDb] wilson_lcb create skipped:", e?.message));

    // Materialized view: ONE row per (archetype, classification_source) with
    // pre-computed n/wins/wr_point/wr_lcb_80/wr_lcb_95/median_r/p75_hold/
    // median_time_to_tp/sl. Both live ai_signal_log rows and joined backfill
    // rows are included. classification_source distinguishes 'live' vs
    // 'backfill' so the admin can A/B them in T12.
    //
    // CREATE MATERIALIZED VIEW does NOT support IF NOT EXISTS in older PG
    // versions, so we DO block + IF NOT EXISTS guard.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_matviews WHERE matviewname = 'archetype_stats'
        ) THEN
          CREATE MATERIALIZED VIEW archetype_stats AS
          WITH all_rows AS (
            SELECT
              COALESCE(archetype, 'UNCLASSIFIED') AS archetype,
              'live'::TEXT                         AS classification_source,
              outcome,
              pnl_pct,
              EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60 AS duration_min
            FROM ai_signal_log
            WHERE outcome IS NOT NULL AND outcome <> 'PENDING'
              AND resolved_at IS NOT NULL
              AND (classification_source IS NULL OR classification_source = 'live')
            UNION ALL
            SELECT
              bc.archetype                                              AS archetype,
              'backfill'::TEXT                                          AS classification_source,
              sl.outcome,
              sl.pnl_pct,
              EXTRACT(EPOCH FROM (sl.resolved_at - sl.created_at)) / 60 AS duration_min
            FROM backfilled_classifications bc
            JOIN ai_signal_log sl ON sl.id = bc.source_signal_id
            WHERE sl.outcome IS NOT NULL AND sl.outcome <> 'PENDING'
              AND sl.resolved_at IS NOT NULL
              AND bc.archetype NOT IN (
                'BACKFILL_UNRECOVERABLE',
                'SKIPPED_ARCHETYPE_NOT_ALLOWED'
              )
          )
          SELECT
            archetype,
            classification_source,
            COUNT(*)::INTEGER                                                        AS n,
            SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')
                     THEN 1 ELSE 0 END)::INTEGER                                     AS wins,
            SUM(CASE WHEN outcome IN ('SL_HIT','EXPIRED_LOSS') THEN 1 ELSE 0 END)::INTEGER AS losses,
            CASE WHEN COUNT(*) > 0
                 THEN SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')
                               THEN 1 ELSE 0 END)::FLOAT / COUNT(*)::FLOAT
                 ELSE 0 END                                                          AS wr_point,
            wilson_lcb(
              SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')
                       THEN 1 ELSE 0 END)::INTEGER,
              COUNT(*)::INTEGER, 0.80)                                               AS wr_lcb_80,
            wilson_lcb(
              SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')
                       THEN 1 ELSE 0 END)::INTEGER,
              COUNT(*)::INTEGER, 0.95)                                               AS wr_lcb_95,
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pnl_pct/10.0), 0)   AS median_r,
            COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY duration_min), 0)  AS p75_hold_minutes,
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_min)
                     FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')), 0)
                                                                                     AS median_time_to_tp_min,
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_min)
                     FILTER (WHERE outcome IN ('SL_HIT','EXPIRED_LOSS')), 0)
                                                                                     AS median_time_to_sl_min,
            NOW()                                                                    AS refreshed_at
          FROM all_rows
          GROUP BY archetype, classification_source;
        END IF;
      END
      $$;
    `).catch((e: any) => console.warn("[initDb] archetype_stats MV create skipped:", e?.message));

    // Unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS archetype_stats_pk
        ON archetype_stats (archetype, classification_source)
    `).catch((e: any) => console.warn("[initDb] archetype_stats_pk skipped:", e?.message));

    // First-time population (non-concurrent; subsequent refreshes via T09
    // hourly cron will be CONCURRENTLY). Guard against double-refresh on a
    // fresh DB where the MV is empty by checking pg_stat_user_tables.
    try {
      const seedCheck: any = await client.query(`
        SELECT COUNT(*)::INTEGER AS n FROM archetype_stats
      `);
      const seeded = Number(seedCheck?.rows?.[0]?.n || 0);
      if (seeded === 0) {
        await client.query(`REFRESH MATERIALIZED VIEW archetype_stats`);
        console.log("[initDb] archetype_stats MV seeded (initial refresh).");
      }
    } catch (e: any) {
      console.warn("[initDb] archetype_stats initial refresh skipped:", e?.message);
    }

    // ── Module 3 (PostTradeAnalyzer — Phase A) — additive tables + MV ─────────
    // Same forbidden-file constraints as Modules 1/2 — shared/schema.ts is NOT
    // touched. Phase A creates the storage but only `post_trade_analysis`
    // receives writes; `model_adjustments` stays empty until Phase B wires
    // the auto-adjust feedback loop. `archetype_scorecard` is a read-only MV
    // refreshed by the existing M2 hourly cron (extended in M3 T04).
    //
    // We also extend `stats_refresh_log` with `mv_name` so the refresher can
    // distinguish which MV each row refers to (archetype_stats vs
    // archetype_scorecard). Pre-existing rows get NULL — interpreted as the
    // original M2 MV (archetype_stats).
    await client.query(`ALTER TABLE stats_refresh_log ADD COLUMN IF NOT EXISTS mv_name TEXT`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS post_trade_analysis (
        id                    SERIAL PRIMARY KEY,
        signal_id             INTEGER NOT NULL REFERENCES ai_signal_log(id) ON DELETE CASCADE,
        analyzed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        primary_tag           TEXT NOT NULL DEFAULT 'PENDING_ANALYSIS',
        secondary_tags        TEXT[] DEFAULT '{}',
        assigned_archetype    TEXT,
        actual_archetype      TEXT,
        mfe_r                 DOUBLE PRECISION,
        mae_r                 DOUBLE PRECISION,
        diagnosis_confidence  DOUBLE PRECISION,
        explanation_text      TEXT,
        diagnostics           JSONB
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pta_signal_id ON post_trade_analysis (signal_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pta_primary_tag ON post_trade_analysis (primary_tag)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pta_analyzed_at ON post_trade_analysis (analyzed_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pta_pending ON post_trade_analysis (primary_tag) WHERE primary_tag = 'PENDING_ANALYSIS'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS model_adjustments (
        id                    SERIAL PRIMARY KEY,
        adjusted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archetype             TEXT NOT NULL,
        parameter_name        TEXT NOT NULL,
        old_value             DOUBLE PRECISION,
        new_value             DOUBLE PRECISION,
        trigger_reason        TEXT,
        trigger_metric_value  DOUBLE PRECISION,
        sample_size           INTEGER,
        source                TEXT NOT NULL DEFAULT 'organic'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_model_adj_archetype ON model_adjustments (archetype, adjusted_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_model_adj_source ON model_adjustments (source)`);

    // archetype_scorecard — read-only MV. Trailing-50 window per archetype,
    // effective WR = (clean_win + chop_win + runner_win +
    // thesis_invalidated_correctly + stale_flat_correct) / total. The MV is
    // grouped by archetype only (vol_regime not yet plumbed onto
    // ai_signal_log; placeholder column is always NULL until that arrives —
    // unique index includes it so the structure is future-proof).
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_matviews WHERE matviewname = 'archetype_scorecard'
        ) THEN
          CREATE MATERIALIZED VIEW archetype_scorecard AS
          WITH recent AS (
            SELECT
              COALESCE(sl.archetype, 'UNCLASSIFIED') AS archetype,
              NULL::TEXT                              AS vol_regime,
              sl.outcome,
              sl.pnl_pct,
              pta.primary_tag,
              pta.secondary_tags,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(sl.archetype, 'UNCLASSIFIED')
                ORDER BY sl.resolved_at DESC NULLS LAST
              ) AS rn
            FROM ai_signal_log sl
            LEFT JOIN post_trade_analysis pta ON pta.signal_id = sl.id
            WHERE sl.outcome IS NOT NULL AND sl.outcome <> 'PENDING'
              AND sl.resolved_at IS NOT NULL
          ),
          trailing50 AS (SELECT * FROM recent WHERE rn <= 50)
          SELECT
            archetype,
            vol_regime,
            COUNT(*)::INTEGER                                                     AS trailing_n,
            CASE WHEN COUNT(*) > 0
                 THEN SUM(CASE WHEN primary_tag IN (
                                'clean_win','chop_win','runner_win',
                                'thesis_invalidated_correctly','stale_flat_correct'
                              ) THEN 1 ELSE 0 END)::FLOAT / COUNT(*)::FLOAT
                 ELSE 0 END                                                       AS effective_win_rate,
            AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct::FLOAT ELSE NULL END)  AS avg_realized_pnl_pct,
            (
              SELECT ARRAY_AGG(tag ORDER BY cnt DESC)
              FROM (
                SELECT primary_tag AS tag, COUNT(*) AS cnt
                FROM trailing50 t2
                WHERE t2.archetype = trailing50.archetype
                  AND COALESCE(t2.vol_regime, '') = COALESCE(trailing50.vol_regime, '')
                  AND primary_tag IS NOT NULL
                GROUP BY 1
                ORDER BY cnt DESC
                LIMIT 3
              ) sub
            ) AS top_3_diagnosis_tags,
            NOW() AS last_updated
          FROM trailing50
          GROUP BY archetype, vol_regime;
        END IF;
      END$$;
    `).catch((e: any) => console.warn("[initDb] archetype_scorecard MV create skipped:", e?.message));
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS archetype_scorecard_pk
        ON archetype_scorecard (archetype, COALESCE(vol_regime, ''))
    `).catch((e: any) => console.warn("[initDb] archetype_scorecard_pk skipped:", e?.message));
    try {
      const seedCheck: any = await client.query(`SELECT COUNT(*)::INTEGER AS n FROM archetype_scorecard`);
      if (Number(seedCheck?.rows?.[0]?.n || 0) === 0) {
        await client.query(`REFRESH MATERIALIZED VIEW archetype_scorecard`);
        console.log("[initDb] archetype_scorecard MV seeded (initial refresh).");
      }
    } catch (e: any) {
      console.warn("[initDb] archetype_scorecard initial refresh skipped:", e?.message);
    }

    // ── signal_shadow_inversions (the "Reverse Costanza" backtest) ────────────
    // For every real signal we publish, a mirrored twin (opposite direction,
    // SL/TP reflected across entry) is logged here and resolved against the
    // same live price feed. Used to measure what flipping the system would
    // actually have earned, without changing live behavior. Forward-only.
    // Column names MUST match shared/schema.ts (Drizzle is the source of
    // truth). Earlier revisions of this CREATE used tp1_price/tp2_price/
    // tp3_price/stop_loss, which Drizzle now calls inverted_tp1/2/3 and
    // inverted_sl — that drift broke production: every shadow-inversion
    // INSERT and the outcome-resolver's SELECT both errored with
    // `column "inverted_tp1" does not exist`. Fresh installs and any newly
    // provisioned prod DB now get the correct columns. Existing databases
    // that were created with the old names need a one-off rename migration
    // (out of scope for this file, which uses CREATE TABLE IF NOT EXISTS).
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_shadow_inversions (
        id                  SERIAL PRIMARY KEY,
        source_signal_id    INTEGER NOT NULL REFERENCES ai_signal_log(id) ON DELETE CASCADE,
        token               VARCHAR(20) NOT NULL,
        original_direction  VARCHAR(10) NOT NULL,
        inverted_direction  VARCHAR(10) NOT NULL,
        entry_price         DECIMAL(20,8) NOT NULL,
        inverted_tp1        DECIMAL(20,8),
        inverted_tp2        DECIMAL(20,8),
        inverted_tp3        DECIMAL(20,8),
        inverted_sl         DECIMAL(20,8),
        kill_clock_expires  TIMESTAMP,
        outcome             VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        pnl_pct             DECIMAL(10,4),
        resolved_at         TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_source_signal ON signal_shadow_inversions (source_signal_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_outcome       ON signal_shadow_inversions (outcome)`);

    // Ensure columns referenced by the backfill exist — use SAVEPOINTs so
    // any failure does not abort the outer transaction.
    // Reconcile EVERY column the code (resolver SELECT/UPDATE, backfill INSERT,
    // signalLogger INSERT, routes reporting) reads or writes. Databases created
    // before the tp1_price→inverted_tp1 rename are missing the inverted_*
    // columns; CREATE TABLE IF NOT EXISTS cannot add them, so the shadow
    // resolver errored with `column "inverted_tp1" does not exist`. Postgres
    // only reports the FIRST missing column, so all columns are reconciled in
    // one pass here. Types match the CREATE statement and shared/schema.ts
    // exactly. Every statement is idempotent (ADD COLUMN IF NOT EXISTS), adds
    // nullable/defaulted columns only, and never touches existing row data.
    await client.query('SAVEPOINT pre_shadow_cols');
    try {
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS source_signal_id   INTEGER`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS token              VARCHAR(20)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS original_direction  TEXT`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS inverted_direction  TEXT`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS entry_price         DECIMAL(20,8)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS inverted_tp1        DECIMAL(20,8)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS inverted_tp2        DECIMAL(20,8)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS inverted_tp3        DECIMAL(20,8)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS inverted_sl         DECIMAL(20,8)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS kill_clock_expires  TIMESTAMP`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS outcome             VARCHAR(20) NOT NULL DEFAULT 'PENDING'`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS pnl_pct             DECIMAL(10,4)`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS resolved_at         TIMESTAMP`);
      await client.query(`ALTER TABLE signal_shadow_inversions ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP DEFAULT NOW()`);
      await client.query('RELEASE SAVEPOINT pre_shadow_cols');
    } catch (e: any) {
      await client.query('ROLLBACK TO SAVEPOINT pre_shadow_cols');
      console.warn('[initDb] shadow column migration skipped:', e?.message);
    }

    // ── One-shot backfill: shadow rows for ai_signal_log entries that were
    // logged BEFORE signalLogger gained the shadow-writer (May 2026). Without
    // this, prod's ShadowInversionsPanel is empty even though the writer is
    // live, because no historical signal ever produced a shadow twin.
    // Idempotent — only inserts where source_signal_id has no shadow yet.
    // Resolved outcome on the parent signal is propagated to the shadow as
    // PENDING so the resolver picks them up on the next live-price tick.
    await client.query('SAVEPOINT pre_shadow_backfill');
    try {
      const bf = await client.query(`
        INSERT INTO signal_shadow_inversions (
          source_signal_id, token, original_direction, inverted_direction,
          entry_price, inverted_sl, inverted_tp1, inverted_tp2, inverted_tp3,
          kill_clock_expires, outcome, created_at
        )
        SELECT
          s.id,
          s.token,
          s.direction,
          CASE WHEN s.direction = 'LONG' THEN 'SHORT' ELSE 'LONG' END,
          s.entry_price,
          CASE WHEN s.stop_loss IS NOT NULL
               AND (2 * s.entry_price - s.stop_loss) > 0
               THEN (2 * s.entry_price - s.stop_loss) END,
          CASE WHEN s.tp1_price IS NOT NULL
               AND (2 * s.entry_price - s.tp1_price) > 0
               THEN (2 * s.entry_price - s.tp1_price) END,
          CASE WHEN s.tp2_price IS NOT NULL
               AND (2 * s.entry_price - s.tp2_price) > 0
               THEN (2 * s.entry_price - s.tp2_price) END,
          CASE WHEN s.tp3_price IS NOT NULL
               AND (2 * s.entry_price - s.tp3_price) > 0
               THEN (2 * s.entry_price - s.tp3_price) END,
          s.kill_clock_expires,
          -- Pre-expire stale rows so the resolver isn't flooded with
          -- months-old signals. Only signals still inside their kill-clock
          -- (or with no clock, but created in the last 7d) start as PENDING.
          CASE
            WHEN s.kill_clock_expires IS NOT NULL AND s.kill_clock_expires < NOW()
              THEN 'EXPIRED_TIME'
            WHEN s.kill_clock_expires IS NULL AND s.created_at < NOW() - INTERVAL '7 days'
              THEN 'EXPIRED_TIME'
            ELSE 'PENDING'
          END,
          s.created_at
        FROM ai_signal_log s
        WHERE s.direction IN ('LONG','SHORT')
          AND s.entry_price IS NOT NULL
          -- Only backfill last 90d so we don't churn through ancient history.
          AND s.created_at > NOW() - INTERVAL '90 days'
          AND NOT EXISTS (
            SELECT 1 FROM signal_shadow_inversions x WHERE x.source_signal_id = s.id
          )
      `);
      await client.query('RELEASE SAVEPOINT pre_shadow_backfill');
      if ((bf.rowCount || 0) > 0) {
        console.log(`[initDb] shadow-inversion backfill: created ${bf.rowCount} rows for historical ai_signal_log entries`);
      }
    } catch (bfErr: any) {
      await client.query('ROLLBACK TO SAVEPOINT pre_shadow_backfill');
      console.error(`[initDb] shadow-inversion backfill failed (non-fatal): ${bfErr?.message || bfErr}`);
    }

    // ── adaptive_thresholds (auto-tuning per token + direction) ───────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS adaptive_thresholds (
        id                 SERIAL PRIMARY KEY,
        token              VARCHAR(20) NOT NULL,
        direction          VARCHAR(10) NOT NULL,
        trade_type         VARCHAR(20) DEFAULT 'ALL',
        baseline_threshold INTEGER DEFAULT 75,
        current_threshold  INTEGER DEFAULT 75,
        adjustment         INTEGER DEFAULT 0,
        win_rate_30d       DECIMAL(5,2),
        sample_size        INTEGER DEFAULT 0,
        suppressed         BOOLEAN DEFAULT FALSE,
        manual_override    BOOLEAN DEFAULT FALSE,
        last_recalc        TIMESTAMP DEFAULT NOW(),
        updated_at         TIMESTAMP DEFAULT NOW(),
        UNIQUE(token, direction, trade_type)
      )
    `);

    // ── trade_journal ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_journal (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        asset       TEXT NOT NULL,
        direction   TEXT NOT NULL,
        entry       TEXT NOT NULL,
        stop        TEXT,
        tp1         TEXT,
        tp2         TEXT,
        size        TEXT,
        notes       TEXT,
        outcome     TEXT NOT NULL DEFAULT 'OPEN',
        pnl_pct     TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        closed_at   TIMESTAMP
      )
    `);

    // ── watchlist_items ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist_items (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        symbol      TEXT NOT NULL,
        asset_class TEXT NOT NULL DEFAULT 'crypto',
        note        TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── chart_ai_usage ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS chart_ai_usage (
        user_id  TEXT NOT NULL,
        date     DATE NOT NULL,
        count    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, date)
      )
    `);

    // ── chart_ai_analyses ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS chart_ai_analyses (
        id            SERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL,
        horizon       TEXT NOT NULL,
        asset         TEXT,
        image_hash    TEXT,
        response_json JSONB NOT NULL,
        cost_estimate NUMERIC(10,4),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chart_ai_analyses_user
      ON chart_ai_analyses (user_id, created_at DESC)
    `);

    // ── chart_ai_monthly_spend ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS chart_ai_monthly_spend (
        month         TEXT PRIMARY KEY,
        total_spend   NUMERIC(10,4) NOT NULL DEFAULT 0,
        alert_sent_at TIMESTAMPTZ
      )
    `);

    // ── chartai_plans + chartai_outcomes (structured plan + outcome tracking) ─
    // Mirrors the Drizzle definitions in shared/schema.ts so the schema is
    // available even on fresh deploys where `npm run db:push` hasn't run yet.
    // Drizzle (db:push) is the canonical source; this is the safety net.
    await client.query(`
      CREATE TABLE IF NOT EXISTS chartai_plans (
        request_id            VARCHAR(12) PRIMARY KEY,
        plan_id               VARCHAR(64),
        user_id               TEXT NOT NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ticker                TEXT NOT NULL,
        asset_class           TEXT NOT NULL,
        session               TEXT,
        refusal_code          TEXT,
        refusal_explanation   TEXT,
        bias                  TEXT,
        direction             TEXT,
        entry_low             NUMERIC(20,8),
        entry_high            NUMERIC(20,8),
        stop_loss             NUMERIC(20,8),
        take_profit_1         NUMERIC(20,8),
        take_profit_2         NUMERIC(20,8),
        rr_tp1                NUMERIC(8,3),
        rr_tp2                NUMERIC(8,3),
        time_horizon_min      INTEGER,
        hard_exit_timer_min   INTEGER,
        conviction            INTEGER,
        invalidation          TEXT,
        rationale             TEXT,
        snapshot              JSONB NOT NULL,
        model                 TEXT NOT NULL,
        input_tokens          INTEGER,
        cache_read_tokens     INTEGER,
        output_tokens         INTEGER,
        latency_ms            INTEGER,
        chart_image_attached  BOOLEAN NOT NULL DEFAULT FALSE,
        schema_version        TEXT NOT NULL,
        framework_version     TEXT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_plans_user_created   ON chartai_plans (user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_plans_ticker_created ON chartai_plans (ticker, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_plans_bias           ON chartai_plans (bias)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_plans_refusal        ON chartai_plans (refusal_code)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chartai_outcomes (
        request_id                 VARCHAR(12) PRIMARY KEY
                                   REFERENCES chartai_plans(request_id) ON DELETE CASCADE,
        status                     TEXT NOT NULL DEFAULT 'open',
        fill_price                 NUMERIC(20,8),
        entry_filled_at            TIMESTAMPTZ,
        resolved_at                TIMESTAMPTZ,
        exit_price                 NUMERIC(20,8),
        realized_r                 NUMERIC(8,3),
        realized_pct               NUMERIC(8,4),
        duration_minutes           INTEGER,
        max_favorable_excursion_r  NUMERIC(8,3),
        max_adverse_excursion_r    NUMERIC(8,3),
        time_to_first_05r_min      INTEGER,
        resolution_source          TEXT,
        notes                      TEXT,
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_outcomes_status   ON chartai_outcomes (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chartai_outcomes_resolved ON chartai_outcomes (resolved_at DESC)`);

    // ── update_log_entries (improvement log buffer for weekly digest) ─────────
    // Owner adds noteworthy improvements throughout the week; the weekly AI
    // digest pulls from these. Also written to by the agent's `logImprovement`
    // helper and by the `/api/internal/improvement-log/mirror` endpoint when
    // the dev workspace mirrors entries to prod.
    await client.query(`
      CREATE TABLE IF NOT EXISTS update_log_entries (
        id                       SERIAL PRIMARY KEY,
        headline                 TEXT NOT NULL,
        detail                   TEXT,
        emoji                    TEXT,
        added_by                 TEXT,
        included_in_update_id    INTEGER,
        created_at               TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_update_log_pending ON update_log_entries (created_at DESC) WHERE included_in_update_id IS NULL`);

    // ── weekly_updates (published weekly digest entries) ──────────────────────
    // Each row is one published weekly update. The Saturday scheduler / admin
    // "Generate & Publish Now" writes here and the digest email reads from here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_updates (
        id                     SERIAL PRIMARY KEY,
        version                TEXT,
        title                  TEXT NOT NULL,
        summary                TEXT NOT NULL,
        items                  JSONB NOT NULL,
        email_sent_at          TIMESTAMP,
        email_recipient_count  INTEGER DEFAULT 0,
        created_by             TEXT,
        created_at             TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_weekly_updates_created ON weekly_updates (created_at DESC)`);

    // ── news_items (deduped news feed) ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_items (
        id           SERIAL PRIMARY KEY,
        external_id  TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL,
        source       TEXT,
        tickers      TEXT,
        sentiment    VARCHAR(16),
        severity     VARCHAR(16),
        url          TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS news_items_created_at_idx ON news_items (created_at)`);

    // ── user_promoted_assets (Elite Promote-to-Scanner) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_promoted_assets (
        id             SERIAL PRIMARY KEY,
        user_id        VARCHAR(64) NOT NULL,
        asset_symbol   VARCHAR(32) NOT NULL,
        asset_class    VARCHAR(16) NOT NULL,
        yahoo_symbol   VARCHAR(32) NOT NULL,
        promoted_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS user_promoted_assets_user_idx ON user_promoted_assets (user_id)`);

    // ── quant_scores (composite quant scoring per symbol) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS quant_scores (
        id            SERIAL PRIMARY KEY,
        symbol        TEXT NOT NULL,
        composite_z   DOUBLE PRECISION NOT NULL,
        side          TEXT,
        regime        TEXT NOT NULL,
        passes        BOOLEAN NOT NULL,
        gates_failed  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        factors       JSONB NOT NULL,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS quant_scores_symbol_ts_idx ON quant_scores (symbol, ts)`);

    // ── microstructure_snapshots (orderbook/CVD/OFI snapshots) ───────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS microstructure_snapshots (
        id        SERIAL PRIMARY KEY,
        symbol    TEXT NOT NULL,
        mid       DOUBLE PRECISION,
        obi       DOUBLE PRECISION,
        wobi      DOUBLE PRECISION,
        cvd       DOUBLE PRECISION,
        cvd_z     DOUBLE PRECISION,
        ofi_1m    DOUBLE PRECISION,
        ofi_z     DOUBLE PRECISION,
        funding   DOUBLE PRECISION,
        oi        DOUBLE PRECISION,
        ts        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS micro_snapshots_symbol_ts_idx ON microstructure_snapshots (symbol, ts)`);

    // ── signal_rejections (durable rejection log for admin tuning) ───────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_rejections (
        id              SERIAL PRIMARY KEY,
        ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source          TEXT NOT NULL,
        token           TEXT NOT NULL,
        direction       TEXT,
        reason          TEXT NOT NULL,
        detail          TEXT NOT NULL,
        proposed_entry  DOUBLE PRECISION,
        proposed_sl     DOUBLE PRECISION,
        proposed_tp1    DOUBLE PRECISION,
        conviction      INTEGER
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS signal_rejections_ts_idx     ON signal_rejections (ts)`);
    await client.query(`CREATE INDEX IF NOT EXISTS signal_rejections_reason_idx ON signal_rejections (reason)`);
    await client.query(`CREATE INDEX IF NOT EXISTS signal_rejections_token_idx  ON signal_rejections (token)`);

    // ── high_conviction_review (May 2026 — ConvictionCap diagnostic) ─────────
    // Captures a full feature snapshot every time a candidate is published
    // with raw conviction ≥ 50. Used by /api/admin/high-conviction-analysis
    // to compute Pearson correlation between each numeric feature and the
    // eventual outcome, so the inverted-confidence bug can be diagnosed.
    await client.query(`
      CREATE TABLE IF NOT EXISTS high_conviction_review (
        id                    SERIAL PRIMARY KEY,
        ts                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_endpoint       TEXT NOT NULL,
        token                 TEXT NOT NULL,
        direction             TEXT NOT NULL,
        raw_conviction        DOUBLE PRECISION NOT NULL,
        displayed_conviction  DOUBLE PRECISION NOT NULL,
        archetype             TEXT,
        signal_id             TEXT,
        ai_signal_log_id      INTEGER,
        feature_snapshot      JSONB,
        outcome               TEXT,
        pnl_pct               DOUBLE PRECISION,
        resolved_at           TIMESTAMPTZ
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS high_conv_review_ts_idx        ON high_conviction_review (ts)`);
    await client.query(`CREATE INDEX IF NOT EXISTS high_conv_review_token_idx     ON high_conviction_review (token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS high_conv_review_signal_id_idx ON high_conviction_review (signal_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS high_conv_review_outcome_idx   ON high_conviction_review (outcome)`);

    // ── earnings_cache (May 2026 — Earnings Radar) ───────────────────────────
    // Stores AI verdicts + computed quant features per upcoming earnings
    // event. Refreshed nightly at 06:15 ET by earningsScanScheduler. Used
    // by /api/earnings/radar to render the EARNINGS → RADAR section.
    await client.query(`
      CREATE TABLE IF NOT EXISTS earnings_cache (
        symbol            VARCHAR(10)  NOT NULL,
        report_date       DATE         NOT NULL,
        report_time       VARCHAR(10)  NOT NULL DEFAULT 'BMO',
        company_name      TEXT,
        market_cap        BIGINT,
        eps_estimate      NUMERIC(12,4),
        revenue_estimate  BIGINT,
        features          JSONB        NOT NULL DEFAULT '{}'::jsonb,
        ai_analysis       JSONB        NOT NULL DEFAULT '{}'::jsonb,
        computed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (symbol, report_date)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS earnings_cache_report_date_idx ON earnings_cache(report_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS earnings_cache_verdict_idx     ON earnings_cache((ai_analysis->>'verdict'))`);

    await client.query("COMMIT");
    console.log("[db] All tables verified / created successfully");

    // ── Chart AI performance views (post-commit, idempotent) ──────────────────
    // Wrapped separately so a view definition error never blocks startup.
    // Keyed on TEXT user_id (matches our existing convention everywhere).
    try {
      await pool.query(`
        CREATE OR REPLACE VIEW v_chartai_resolved AS
        SELECT
          p.request_id,
          p.user_id,
          p.created_at,
          p.ticker,
          p.asset_class,
          p.bias,
          p.direction,
          p.conviction,
          p.schema_version,
          p.framework_version,
          o.status,
          o.fill_price,
          o.exit_price,
          o.realized_r,
          o.realized_pct,
          o.duration_minutes,
          o.max_favorable_excursion_r,
          o.max_adverse_excursion_r,
          o.time_to_first_05r_min,
          o.resolved_at
        FROM chartai_plans p
        JOIN chartai_outcomes o ON o.request_id = p.request_id
        WHERE o.resolved_at IS NOT NULL
      `);
      await pool.query(`
        CREATE OR REPLACE VIEW v_chartai_daily_perf AS
        SELECT
          user_id,
          (resolved_at AT TIME ZONE 'UTC')::date AS day,
          schema_version,
          framework_version,
          COUNT(*)                                                              AS resolved_count,
          COUNT(*) FILTER (WHERE status IN ('tp1_hit','tp2_hit'))                AS wins,
          COUNT(*) FILTER (WHERE status = 'sl_hit')                              AS sl_count,
          COUNT(*) FILTER (WHERE status IN ('hard_exit','time_stop','expired'))  AS time_or_hard_exits,
          ROUND(AVG(realized_r)::numeric, 3)                                     AS avg_r,
          ROUND(SUM(realized_r)::numeric, 3)                                     AS total_r,
          ROUND(AVG(max_favorable_excursion_r)::numeric, 3)                      AS avg_mfe_r,
          ROUND(AVG(max_adverse_excursion_r)::numeric, 3)                        AS avg_mae_r
        FROM v_chartai_resolved
        GROUP BY user_id, (resolved_at AT TIME ZONE 'UTC')::date, schema_version, framework_version
      `);
      await pool.query(`
        CREATE OR REPLACE VIEW v_chartai_bias_perf AS
        SELECT
          user_id,
          bias,
          direction,
          schema_version,
          framework_version,
          COUNT(*) AS n,
          ROUND(
            (COUNT(*) FILTER (WHERE status IN ('tp1_hit','tp2_hit')))::numeric
              / NULLIF(COUNT(*), 0),
            4
          ) AS win_rate,
          ROUND(AVG(realized_r)::numeric, 3) AS avg_r,
          ROUND(SUM(realized_r)::numeric, 3) AS total_r
        FROM v_chartai_resolved
        GROUP BY user_id, bias, direction, schema_version, framework_version
      `);
      console.log("[db] chartai_* perf views (re)created");
    } catch (viewErr: any) {
      console.warn("[db] chartai_* views skipped:", viewErr?.message);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Table initialization failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
