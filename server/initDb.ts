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
        created_at               TIMESTAMP DEFAULT NOW()
      )
    `);

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

    await client.query("COMMIT");
    console.log("[db] All tables verified / created successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[db] Table initialization failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
