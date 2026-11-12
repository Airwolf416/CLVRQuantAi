import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesRelease, verifyRelease } from "./verify-release.mjs";

const sha = "a".repeat(40);
const current = { ok: true, revision: sha, tradeIdeaPolicy: "crypto-compatible-floor-v1" };
test("health 200 alone and wrong revision or policy cannot pass", () => {
  assert.equal(matchesRelease({ ok: true }, sha), false);
  assert.equal(matchesRelease({ ...current, revision: "b".repeat(40) }, sha), false);
  assert.equal(matchesRelease({ ...current, tradeIdeaPolicy: "old" }, sha), false);
  assert.equal(matchesRelease(current, sha), true);
});
test("mixed replicas and request failures reset the consecutive evidence", async () => {
  const values = [current, null, current, "failure", current, current];
  let calls = 0;
  await verifyRelease("https://example.com", sha, {
    attempts: 6, required: 2, sleep: async () => {}, log: () => {},
    fetchHealth: async () => {
      const value = values[calls++];
      if (value === "failure") throw new Error("network");
      return { ok: true, json: async () => value };
    },
  });
  assert.equal(calls, 6);
});
test("stale runtime fails the release instead of reporting success", async () => {
  await assert.rejects(verifyRelease("https://example.com", sha, {
    attempts: 2, required: 2, sleep: async () => {}, log: () => {},
    fetchHealth: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  }), /could not be verified/);
});
