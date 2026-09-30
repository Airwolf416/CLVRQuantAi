import test from "node:test";
import assert from "node:assert/strict";
import { requiresVerifiedEmail, verificationAccess } from "./verificationGate";
import { claimResendCooldown } from "./resendCooldown";
import { verifyTurnstile } from "./turnstile";

test("verification gate blocks direct market and AI API routes, retains account shell", () => {
  for (const path of ["/api/signals/feed", "/api/crypto", "/api/macro", "/api/ai/analyze", "/api/chart-ai/analyze", "/api/journal"]) {
    assert.equal(requiresVerifiedEmail(path), true, path);
  }
  for (const path of ["/api/auth/me", "/api/auth/resend-verification", "/api/stripe/subscription", "/api/support/thread"]) {
    assert.equal(requiresVerifiedEmail(path), false, path);
  }
  assert.equal(verificationAccess(null), 401);
  assert.equal(verificationAccess({ emailVerified: false }), 403);
  assert.equal(verificationAccess({ emailVerified: true }), 200);
  assert.equal(verificationAccess({ emailVerified: false, isAdmin: true }), 200);
});

test("resend cooldown returns retry seconds on repeated request and keys by account", async () => {
  let hits = 0;
  const db = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /ON CONFLICT/);
      assert.match(sql, /INTERVAL '60 seconds'/);
      assert.deepEqual(params, ["email-verification:user-1"]);
      return { rows: [{ hits: ++hits, retry_after: 60 }] };
    },
  };
  assert.equal(await claimResendCooldown(db, "user-1"), 0);
  assert.equal(await claimResendCooldown(db, "user-1"), 60);
});

test("Turnstile fails closed without credentials, on errors and on rejected tokens", async () => {
  const success = async () => new Response(JSON.stringify({ success: true }));
  const fail = async () => new Response(JSON.stringify({ success: false }));
  assert.equal(await verifyTurnstile("token", undefined, "", success as typeof fetch), false);
  assert.equal(await verifyTurnstile("", undefined, "secret", success as typeof fetch), false);
  assert.equal(await verifyTurnstile("token", undefined, "secret", fail as typeof fetch), false);
  assert.equal(await verifyTurnstile("token", undefined, "secret", (async () => { throw new Error("offline"); }) as typeof fetch), false);
  assert.equal(await verifyTurnstile("token", undefined, "secret", success as typeof fetch), true);
});