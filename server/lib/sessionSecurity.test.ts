import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalUpdateSucceeded,
  mergePolicyIntoSessionDocument,
  revokeCanonicalSession,
  sessionPolicyMiddleware,
  setBearerAuthContext,
} from "./sessionSecurity";
import { pool } from "../db";
import { randomUUID } from "node:crypto";

test("bearer policy persistence preserves cookie and unrelated session fields", () => {
  const original = {
    cookie: { originalMaxAge: 123, httpOnly: true },
    cart: { campaign: "welcome" },
    userId: "user-1",
    loginAt: 1,
  };
  const merged = mergePolicyIntoSessionDocument(original, {
    userId: "user-1",
    loginAt: 2,
    lastActivityAt: 3,
    sessionPolicyVersion: 1,
  });
  assert.deepEqual(merged.cookie, original.cookie);
  assert.deepEqual(merged.cart, original.cart);
  assert.equal(merged.loginAt, 2);
  assert.equal(original.loginAt, 1);
});

test("a missing canonical bearer update is rejected", () => {
  assert.equal(canonicalUpdateSucceeded(1), true);
  assert.equal(canonicalUpdateSucceeded(0), false);
  assert.equal(canonicalUpdateSucceeded(null), false);
});

test("database-side bearer policy merges preserve concurrent current fields", { skip: !process.env.DATABASE_URL }, async () => {
  const sid = `test-${randomUUID()}`;
  try {
    await pool.query(
      "INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, NOW() + INTERVAL '1 hour')",
      [sid, JSON.stringify({ userId: "u", cookie: { httpOnly: true }, cart: { source: "before" } })],
    );
    await Promise.all([
      pool.query(
        `UPDATE user_sessions SET sess = (sess::jsonb || $1::jsonb)::json
          WHERE sid = $2 AND expire > NOW()`,
        [JSON.stringify({ lastActivityAt: 22, sessionPolicyVersion: 1 }), sid],
      ),
      pool.query(
        `UPDATE user_sessions SET sess = (sess::jsonb || $1::jsonb)::json
          WHERE sid = $2 AND expire > NOW()`,
        [JSON.stringify({ cart: { source: "current" }, featureFlag: true }), sid],
      ),
    ]);
    const row = await pool.query("SELECT sess FROM user_sessions WHERE sid = $1", [sid]);
    assert.deepEqual(row.rows[0].sess.cookie, { httpOnly: true });
    assert.deepEqual(row.rows[0].sess.cart, { source: "current" });
    assert.equal(row.rows[0].sess.lastActivityAt, 22);
    assert.equal(row.rows[0].sess.featureFlag, true);
  } finally {
    await pool.query("DELETE FROM user_sessions WHERE sid = $1", [sid]);
  }
});

test("real session table bearer expiry and exact-SID revocation fail closed", { skip: !process.env.DATABASE_URL }, async () => {
  const sid = `test-${randomUUID()}`;
  const document = {
    userId: "u",
    loginAt: Date.now(),
    lastActivityAt: Date.now() - 9 * 60 * 60 * 1000,
    sessionPolicyVersion: 1,
  };
  await pool.query(
    "INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, NOW() + INTERVAL '1 hour')",
    [sid, JSON.stringify(document)],
  );
  try {
    const req: any = { path: "/protected", sessionID: "transient", session: {} };
    setBearerAuthContext(req, sid, document);
    let payload: any;
    const res: any = { status: () => res, json: (value: any) => { payload = value; return res; } };
    await sessionPolicyMiddleware(req, res, () => { throw new Error("expired bearer passed"); });
    assert.equal(payload.code, "SESSION_IDLE_EXPIRED");
    assert.equal((await pool.query("SELECT 1 FROM user_sessions WHERE sid = $1", [sid])).rowCount, 0);
    await assert.rejects(() => revokeCanonicalSession(req), { code: "SESSION_REVOKED" });
  } finally {
    await pool.query("DELETE FROM user_sessions WHERE sid = $1", [sid]);
  }
});