import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, TIER_ORDER, annualSavings, annualDiscount, BRIEF_RULE, SIGNAL_RULE } from "./pricing.js";
import { PASSWORD_MIN_LENGTH, passwordHints } from "./passwordPolicy.js";

test("public plans retain their CAD list prices and derive annual savings", () => {
  assert.deepEqual(TIER_ORDER, ["free", "pro", "elite"]);
  assert.deepEqual(TIER_ORDER.map(id => TIERS[id].monthlyPrice), [0, 29.99, 129]);
  assert.equal(TIERS.pro.yearlyPrice, 299);
  assert.equal(TIERS.elite.yearlyPrice, 1199);
  assert.equal(annualDiscount(TIERS.pro), 17);
  assert.equal(annualDiscount(TIERS.elite), 23);
  assert.ok(annualSavings(TIERS.pro) > 0);
});

test("Free signals and opt-in brief rules are explicit", () => {
  assert.match(SIGNAL_RULE, /delayed 30 minutes/);
  assert.match(SIGNAL_RULE, /Pro & Elite: real-time/);
  assert.match(BRIEF_RULE, /Free gets the market summary without trade-idea cards/);
  assert.match(BRIEF_RULE, /Pro gets up to 1 trade idea and Elite up to 3/);
});

test("password requires length only; strength criteria are hints", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.deepEqual(passwordHints("abcdefghij").map(h => h.met), [true, false, false, false]);
  assert.deepEqual(passwordHints("Abcdefghi1!").map(h => h.met), [true, true, true, true]);
});