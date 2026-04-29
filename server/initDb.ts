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

    // ── signal_shadow_inversions (the "Reverse Costanza" backtest) ────────────
    // For every real signal we publish, a mirrored twin (opposite direction,
    // SL/TP reflected across entry) is logged here and resolved against the
    // same live price feed. Used to measure what flipping the system would
    // actually have earned, without changing live behavior. Forward-only.
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_shadow_inversions (
        id                  SERIAL PRIMARY KEY,
        source_signal_id    INTEGER NOT NULL REFERENCES ai_signal_log(id) ON DELETE CASCADE,
        token               VARCHAR(20) NOT NULL,
        inverted_direction  VARCHAR(10) NOT NULL,
        entry_price         DECIMAL(20,8) NOT NULL,
        tp1_price           DECIMAL(20,8),
        tp2_price           DECIMAL(20,8),
        tp3_price           DECIMAL(20,8),
        stop_loss           DECIMAL(20,8),
        kill_clock_expires  TIMESTAMP,
        outcome             VARCHAR(20) DEFAULT 'PENDING',
        pnl_pct             DECIMAL(10,4),
        resolved_at         TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_source_signal ON signal_shadow_inversions (source_signal_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_outcome       ON signal_shadow_inversions (outcome)`);

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
