import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedCookieMutation } from "./csrfOrigin";

const base = { requestOrigin: "https://app.example.test", trustedOrigins: ["https://preview.replit.dev"] };

test("cookie mutations fail closed without browser origin signals", () => {
  assert.equal(isTrustedCookieMutation({ ...base }), false);
  assert.equal(isTrustedCookieMutation({ ...base, origin: base.requestOrigin }), false);
});

test("cookie mutations only accept trusted same-site origins", () => {
  assert.equal(isTrustedCookieMutation({ ...base, origin: base.requestOrigin, fetchSite: "same-origin" }), true);
  assert.equal(isTrustedCookieMutation({ ...base, origin: "https://preview.replit.dev", fetchSite: "same-site" }), true);
  assert.equal(isTrustedCookieMutation({ ...base, origin: "https://attacker.test", fetchSite: "same-site" }), false);
  assert.equal(isTrustedCookieMutation({ ...base, origin: base.requestOrigin, fetchSite: "cross-site" }), false);
});