import test from "node:test";
import assert from "node:assert/strict";
import { matchesWeeklyDigest } from "./verify-release.mjs";
import { WEEKLY_DIGEST_POLICY, WEEKLY_SCHEDULE, WEEKLY_RETRY_WINDOW } from "../shared/weeklyDigestSchedule.js";

test("weekly readiness requires real storage/source readiness and production configuration", () => {
  const weeklyDigest = {
    policy: WEEKLY_DIGEST_POLICY, schedule: WEEKLY_SCHEDULE, retryWindow: WEEKLY_RETRY_WINDOW,
    enabled: true, started: true, storageReady: true, sourceReady: true, releasePinned: true,
    githubConfigured: true, aiConfigured: true, emailConfigured: true, lastOutcome: "outside_window",
  };
  assert.equal(matchesWeeklyDigest({ weeklyDigest }), true);
  for (const key of ["enabled", "started", "storageReady", "sourceReady", "releasePinned",
    "githubConfigured", "aiConfigured", "emailConfigured"]) {
    assert.equal(matchesWeeklyDigest({ weeklyDigest: { ...weeklyDigest, [key]: false } }), false, key);
  }
  assert.equal(matchesWeeklyDigest({}), false);
  assert.equal(matchesWeeklyDigest({ weeklyDigest: { ...weeklyDigest, policy: "old" } }), false);
});
