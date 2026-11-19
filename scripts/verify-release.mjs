import { pathToFileURL } from "node:url";
import { TRADE_IDEA_POLICY_REVISION } from "../shared/tradeIdeaPolicy.js";
import { WEEKLY_DIGEST_POLICY, WEEKLY_SCHEDULE, WEEKLY_RETRY_WINDOW } from "../shared/weeklyDigestSchedule.js";

export function matchesWeeklyDigest(body) {
  const state = body?.weeklyDigest;
  return state?.policy === WEEKLY_DIGEST_POLICY && state?.schedule === WEEKLY_SCHEDULE &&
    state?.retryWindow === WEEKLY_RETRY_WINDOW && state?.enabled === true &&
    state?.started === true && state?.storageReady === true && state?.sourceReady === true &&
    state?.releasePinned === true && state?.githubConfigured === true &&
    state?.aiConfigured === true && state?.emailConfigured === true &&
    state?.lastOutcome !== "scheduler_storage_error";
}

export function matchesRelease(body, expected) {
  return /^[a-f0-9]{40}$/i.test(expected) &&
    body?.ok === true && body?.revision === expected.toLowerCase() &&
    body?.tradeIdeaPolicy === TRADE_IDEA_POLICY_REVISION;
}

export async function verifyRelease(base, expected, {
  attempts = 90, required = 10, delayMs = 10000,
  fetchHealth = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log,
  weeklyDigest = false,
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(expected)) throw new Error("Expected a full commit SHA");
  let consecutive = 0;
  for (let i = 0; i < attempts; i++) {
    const url = new URL("/health", base);
    url.searchParams.set("release_check", `${Date.now()}-${i}`);
    try {
      const response = await fetchHealth(url, {
        headers: { "Cache-Control": "no-cache", Connection: "close" },
        signal: AbortSignal.timeout(10000),
      });
      const body = response.ok ? await response.json() : null;
      consecutive = matchesRelease(body, expected) && (!weeklyDigest || matchesWeeklyDigest(body)) ? consecutive + 1 : 0;
      log(`Release check ${i + 1}: ${consecutive}/${required} consecutive matches`);
      if (consecutive >= required) return;
    } catch {
      consecutive = 0;
      log(`Release check ${i + 1}: unavailable; retrying`);
    }
    if (i + 1 < attempts) await sleep(delayMs);
  }
  throw new Error("Serving release could not be verified; do not report deployment success");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRelease(process.argv[2], process.argv[3], { weeklyDigest: process.argv.includes("--weekly-digest") }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
