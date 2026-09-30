import { test } from "node:test";
import assert from "node:assert/strict";
import { macroWeekRange, filterMacroCalendar, createMacroLoader } from "./macroCalendar.js";

test("ET week ends Sunday, including across DST, timezone and year boundary", () => {
  assert.deepEqual(macroWeekRange(new Date("2026-03-09T02:00:00Z")),
    { start: "2026-03-08", end: "2026-03-08" }); // Sunday evening ET
  assert.deepEqual(macroWeekRange(new Date("2026-03-09T05:00:00Z")),
    { start: "2026-03-09", end: "2026-03-15" });
  assert.deepEqual(macroWeekRange(new Date("2027-01-01T02:00:00Z")),
    { start: "2026-12-31", end: "2027-01-03" });
});

test("week shares upcoming dates with radar; today/region/impact filter transitions", () => {
  const events = [
    { date: "2026-03-08", country: "US", impact: "HIGH", timeET: "23:00", name: "Sunday" },
    { date: "2026-03-09", country: "EU", impact: "MED", timeET: "09:00", name: "Europe" },
    { date: "2026-03-09", country: "US", impact: "HIGH", timeET: "08:30", name: "US" },
    { date: "2026-03-15", country: "US", impact: "HIGH", timeET: "12:00", name: "End" },
    { date: "2026-03-16", country: "US", impact: "HIGH", timeET: "08:30", name: "Next week" },
  ];
  const now = new Date("2026-03-09T12:00:00Z");
  assert.deepEqual(filterMacroCalendar(events, "week", "ALL", "ALL", now).map(e => e.name),
    ["US", "Europe", "End"]);
  assert.deepEqual(filterMacroCalendar(events, "today", "US", "HIGH", now).map(e => e.name), ["US"]);
  assert.deepEqual(filterMacroCalendar(events, "week", "EU", "HIGH", now), []);
});

test("initial failure is not an empty calendar; retry succeeds", async () => {
  const states = [];
  let calls = 0;
  const loader = createMacroLoader(async () => {
    if (++calls === 1) throw Error("503");
    return [{ date: "2026-03-09" }];
  }, s => states.push(s));
  await loader.fetch();
  assert.deepEqual(states.at(-1), { loading: false, error: true, stale: false });
  await loader.fetch(true);
  assert.deepEqual(states.at(-1), { events: [{ date: "2026-03-09" }], loading: false, error: false, stale: false });
});

test("slow stale request cannot override retry; refresh failure retains loaded events", async () => {
  const states = [];
  let resolveOld;
  let calls = 0;
  const loader = createMacroLoader(() => {
    if (++calls === 1) return new Promise(resolve => { resolveOld = resolve; });
    if (calls === 2) return Promise.resolve([{ name: "new" }]);
    return Promise.reject(Error("offline"));
  }, s => states.push(s));
  const old = loader.fetch();
  await loader.fetch(); // timer must not queue another overlapping request
  assert.equal(calls, 1);
  await loader.fetch(true);
  resolveOld([{ name: "stale" }]);
  await old;
  assert.equal(states.filter(s => s.events).length, 1);
  assert.equal(states.at(-1).events[0].name, "new");
  await loader.fetch();
  assert.deepEqual(states.at(-1), { loading: false, error: true, stale: true });
  loader.dispose();
});