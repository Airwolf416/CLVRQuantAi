import test from "node:test";
import assert from "node:assert/strict";
import { signupProtectionRequired } from "./signupProtection";

test("temporary pause is explicit and independent of credentials", () => {
  assert.equal(signupProtectionRequired({}), false);
  assert.equal(signupProtectionRequired({ SIGNUP_BOT_PROTECTION_ENABLED: "false" }), false);
});

test("re-enabling requires verification even if credentials are missing", () => {
  assert.equal(signupProtectionRequired({ SIGNUP_BOT_PROTECTION_ENABLED: "true" }), true);
  assert.equal(signupProtectionRequired({ SIGNUP_BOT_PROTECTION_ENABLED: " TRUE " }), true);
});
