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
        id          SERIAL PRIMARY KEY,
        signal_id   INTEGER NOT NULL,
        token       TEXT NOT NULL,
        direction   TEXT NOT NULL,
        entry       TEXT,
        tp1         TEXT,
        sl          TEXT,
        confidence  INTEGER,
        outcome     TEXT NOT NULL DEFAULT 'PENDING',
        pnl_pct     TEXT,
        ts          TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);

    // ── watchlist_items ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist_items (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        asset       TEXT NOT NULL,
        min_conf    INTEGER NOT NULL DEFAULT 70,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
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
