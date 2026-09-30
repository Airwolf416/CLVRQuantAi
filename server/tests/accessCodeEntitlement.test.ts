import assert from "node:assert/strict";
import { test } from "node:test";
import { accessCodeTier, effectiveCodeTier, redemptionError } from "../lib/accessCodeEntitlement";

test("issued trial/Pro and VIP/FF types grant the promised tiers", () => {
  assert.equal(accessCodeTier("trial"), "pro");
  assert.equal(accessCodeTier("pro"), "pro");
  assert.equal(accessCodeTier("vip"), "elite"); // VIP and FF are both stored as vip
  assert.equal(accessCodeTier("unknown"), null);
});

test("redemption never downgrades an existing entitlement", () => {
  assert.equal(effectiveCodeTier("free", "pro"), "pro");
  assert.equal(effectiveCodeTier("free", "elite"), "elite");
  assert.equal(effectiveCodeTier("elite", "pro"), "elite");
  assert.equal(effectiveCodeTier("pro", "elite"), "elite");
});

test("invalid, expired, and already claimed results are distinct", () => {
  assert.deepEqual(redemptionError("not_found"), { valid: false, code: "not_found", error: "Code not found or no longer active" });
  assert.match(redemptionError("expired").error, /expired/);
  assert.match(redemptionError("already_redeemed_user").error, /already redeemed/);
  assert.match(redemptionError("already_redeemed_global").error, /already been claimed/);
});