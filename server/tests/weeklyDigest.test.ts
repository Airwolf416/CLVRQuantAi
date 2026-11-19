import test from "node:test";
import assert from "node:assert/strict";
import { saturdayDigestWindow, publicCommitSubjects, providerIdempotencyKey, recipientIdentity } from "../lib/weeklyDigestPolicy";
import { parseWeeklyDigestResponse } from "../lib/weeklyDigestContent";
import { createWeeklyDigestMailer } from "../lib/weeklyDigestMailer";
import { commitDigestNotes } from "../config/weeklyReleaseFacts";
import { runWeeklyDigestTick } from "../lib/weeklyDigestScheduler";

test("Saturday schedule uses Eastern time, with a bounded restart recovery window", () => {
  const cases: [string, string | null][] = [
    ["2026-11-21T14:59:59Z", null], ["2026-11-21T15:00:00Z", "2026-11-21"],
    ["2026-11-22T04:59:59Z", "2026-11-21"], ["2026-11-22T14:59:59Z", "2026-11-21"],
    ["2026-11-22T15:00:00Z", null], ["2026-11-23T15:00:00Z", null],
    ["2026-07-18T13:59:59Z", null], ["2026-07-18T14:00:00Z", "2026-07-18"],
    ["2026-11-01T13:59:59Z", "2026-10-31"], ["2026-11-01T15:00:00Z", null],
    ["2026-03-08T13:59:59Z", "2026-03-07"], ["2026-03-08T14:00:00Z", null],
  ];
  for (const [instant, expected] of cases) assert.equal(saturdayDigestWindow(new Date(instant)), expected, instant);
});

test("user-visible fixes remain candidates, internal noise does not", () => {
  assert.deepEqual(publicCommitSubjects([
    "fix: Correct FX prices in the morning brief", "Fix missing market labels",
    "perf: Stabilize live table refresh", "feat: Add xyz table", "feat: Add xyz table",
    "ci: Change Docker build", "test: Add fixtures", "refactor: Split helper", "Merge branch work", "Checkpoint",
  ]), ["fix: Correct FX prices in the morning brief", "Fix missing market labels",
    "perf: Stabilize live table refresh", "feat: Add xyz table"]);
});

test("idempotency identity normalizes emails and separates updates", () => {
  const first = recipientIdentity(" Trader@example.test ");
  assert.equal(first.key, recipientIdentity("trader@EXAMPLE.test").key);
  assert.equal(first.email, "trader@example.test");
  assert.notEqual(providerIdempotencyKey(1, first.key), providerIdempotencyKey(2, first.key));
});

test("reviewed facts are attached only to their exact shipped commits", () => {
  const known = commitDigestNotes([{ sha: "a210baa2c01ba5963020662e04d2cb1913446b4c", message: "Add xyz table" }]);
  assert.match(known[0], /Equities & more/);
  assert.match(known[0], /coverage/);
  assert.deepEqual(commitDigestNotes([{ sha: "unshipped", message: "Unrelated change" }]), ["Unrelated change"]);
});

test("outside the scheduled recovery window there are no database or provider operations", async () => {
  const fail = async () => { throw new Error("Must not run"); };
  assert.equal((await runWeeklyDigestTick({
    db: { connect: fail } as any, now: new Date("2026-11-19T15:00:00Z"),
    latest: fail, generate: fail, send: fail,
  })).status, "outside_window");
});

test("only an explicit valid empty editor decision means no public changes", () => {
  assert.equal(parseWeeklyDigestResponse('{"version":"","title":"","summary":"","items":[]}', 2), null);
  for (const raw of ["not JSON", "{}", '{"items":[]}', '```json\n{"items":[]}\n```']) {
    assert.throws(() => parseWeeklyDigestResponse(raw, 2));
  }
  const valid = { version: "This week", title: "Clearer market research", summary: "See the evidence.",
    items: [{ emoji: "📊", title: "Research labels", description: "See passing and below-gate ideas.", sources: [1] }] };
  assert.equal(parseWeeklyDigestResponse(JSON.stringify(valid), 1)?.items.length, 1);
  assert.equal(parseWeeklyDigestResponse("```json\n" + JSON.stringify(valid) + "\n```", 1)?.items.length, 1);
  assert.throws(() => parseWeeklyDigestResponse("Here is your digest: " + JSON.stringify(valid), 1), /AI_INVALID_JSON/);
  valid.items[0].sources = [2];
  assert.throws(() => parseWeeklyDigestResponse(JSON.stringify(valid), 1), /UNSUPPORTED_DIGEST_ITEM/);
});

test("the actual HTTP adapter sends a provider idempotency header, not an ignored SDK option", async () => {
  const requests: RequestInit[] = [];
  const mailer = createWeeklyDigestMailer("test-fixture-not-a-credential", (async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    requests.push(init!);
    return new Response('{"id":"fixture-receipt"}', { status: 200 });
  }) as typeof fetch);
  const payload = { to: "fixture@example.test", html: "<p>Fixture</p>" };
  const result = await mailer.send(payload, { idempotencyKey: "weekly-update/1/fixture" });
  assert.equal(result.data.id, "fixture-receipt");
  assert.equal((requests[0].headers as any)["Idempotency-Key"], "weekly-update/1/fixture");
  assert.equal(requests[0].body, JSON.stringify(payload));
  const failing = createWeeklyDigestMailer("fixture", (async () => new Response('{"message":"rate limit"}', { status: 429 })) as typeof fetch);
  assert.equal((await failing.send(payload, { idempotencyKey: "fixture" })).error.statusCode, 429);
});
