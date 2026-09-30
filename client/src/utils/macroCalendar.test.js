import { test } from "node:test";
import assert from "node:assert/strict";
import { macroWeekRange, macroEventDate, macroEventInstant, selectUpcomingMacroEvents, filterMacroCalendar, createMacroLoader } from "./macroCalendar.js";

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

test("timestamped weekly entries normalize to ET, not UTC or browser-local date", () => {
  const now = new Date("2026-03-09T05:00:00Z");
  assert.equal(macroEventDate("2026-03-09T03:30:00Z"), "2026-03-08");
  assert.equal(macroEventDate("2026-03-09T04:30:00Z"), "2026-03-09");
  assert.equal(macroEventDate("2026-03-09"), "2026-03-09");
  assert.equal(macroEventDate("2026-02-30"), null);
  const events = [
    { date: "2026-03-09T04:30:00Z", country: "US", impact: "HIGH" },
    { date: "2026-03-09T03:30:00Z", country: "US", impact: "HIGH" },
  ];
  assert.equal(filterMacroCalendar(events, "today", "ALL", "ALL", now).length, 1);
  assert.equal(filterMacroCalendar(events, "week", "ALL", "ALL", now).length, 1);
});

test("Radar and Macro choose the same earliest upcoming release, regardless of impact", () => {
  const now = new Date("2026-06-17T14:00:00Z"); // 10:00 ET
  const events = [
    { name: "FOMC Cook", date: "2026-06-17", timeET: "15:25", impact: "HIGH" },
    { name: "Tschudin", date: "2026-06-17", timeET: "10:30", impact: "LOW" },
    { name: "already released", date: "2026-06-17", timeET: "10:15", released: true },
    { name: "past", date: "2026-06-17", timeET: "09:00" },
    { name: "tomorrow", date: "2026-06-18", timeET: "08:30" },
  ];
  const upcoming = selectUpcomingMacroEvents(events, now);
  assert.deepEqual(upcoming.map(e => e.name), ["Tschudin", "FOMC Cook", "tomorrow"]);
  assert.equal(upcoming[0].target.toISOString(), "2026-06-17T14:30:00.000Z");
  assert.equal(macroEventInstant({ date: "2026-12-17", timeET: "10:30" }).toISOString(), "2026-12-17T15:30:00.000Z");
  assert.equal(selectUpcomingMacroEvents(events, new Date("2026-06-17T14:31:00Z"))[0].name, "FOMC Cook");
});

test("initial failure is not an empty calendar; retry succeeds", async () => {
  const states = [];
  let calls = 0;
  const loader = createMacroLoader(async () => {
    if (++calls === 1) throw Error("503");
    return [{ date: "2026-03-09" }];
  }, s => states.push(s));
  await loader.fetch();
  assert.deepEqual(states.at(-1), { loading: false, error: "503", stale: false });
  await loader.fetch(true);
  assert.deepEqual(states.at(-1), { events: [{ date: "2026-03-09" }], loading: false, error: false, stale: false });
});

test("slow stale request cannot override retry; refresh failure retains loaded events", async () => {
  const states = [];
  let resolveOld;
  let calls = 0;
  const loader = createMacroLoader(() => {
    if (++calls === 1) return new Promise(resolve => { resolveOld = resolve; });
    if (calls === 2) return Promise.resolve([{ name: "new", date: "2026-03-09" }]);
    return Promise.reject(Error("offline"));
  }, s => states.push(s));
  const old = loader.fetch();
  await loader.fetch(); // timer must not queue another overlapping request
  assert.equal(calls, 1);
  await loader.fetch(true);
  resolveOld([{ name: "stale", date: "2026-03-09" }]);
  await old;
  assert.equal(states.filter(s => s.events).length, 1);
  assert.equal(states.at(-1).events[0].name, "new");
  await loader.fetch();
  assert.deepEqual(states.at(-1), { loading: false, error: "offline", stale: true });
  loader.dispose();
});

test("invalid payload is an error, not a zero-event success; genuine empty succeeds", async () => {
  const states = [];
  let result = { events: [{ date: "not a date" }] };
  const loader = createMacroLoader(async () => result, state => states.push(state));
  await loader.fetch();
  assert.equal(states.at(-1).error, "Invalid macro calendar response");
  result = { events: [] };
  await loader.fetch(true);
  assert.deepEqual(states.at(-1), { events: [], loading: false, error: false, stale: false });
});