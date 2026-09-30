import assert from "node:assert/strict";
import { test } from "node:test";
import { accessCodeFeedback, ACCESS_CODE_FORMATS } from "./accessCodeFeedback.js";

test("documents all issued formats", () => {
  for (const format of ["CLVR-TRIAL-", "CLVR-VIP-", "CLVR-FF-", "PRO-XXXXX-XXX"]) {
    assert.ok(ACCESS_CODE_FORMATS.includes(format));
  }
});

test("trial success uses returned tier and effective expiry, not code prefix", () => {
  assert.deepEqual(accessCodeFeedback({ valid: true, type: "trial", tier: "pro", expiresAt: "2027-04-05T00:00:00.000Z" }),
    { success: true, message: "Trial activated: Pro until April 5, 2027" });
  assert.deepEqual(accessCodeFeedback({ valid: true, type: "trial", tier: "elite", expiresAt: "2028-02-01T00:00:00.000Z" }),
    { success: true, message: "Trial activated: Elite until February 1, 2028" });
  assert.deepEqual(accessCodeFeedback({ valid: true, type: "trial", tier: "pro" }),
    { success: true, message: "Trial activated: Pro" });
});

test("invalid, expired and already redeemed failures retain server errors", () => {
  for (const [code, error] of [
    ["not_found", "Code not found or no longer active"],
    ["expired", "This code has expired"],
    ["already_redeemed_user", "You have already redeemed this code"],
    ["already_redeemed_global", "This code has already been claimed"],
  ]) {
    assert.deepEqual(accessCodeFeedback({ valid: false, code, error }), { success: false, message: error });
  }
  assert.equal(accessCodeFeedback({ valid: true, tier: undefined }).success, false);
});