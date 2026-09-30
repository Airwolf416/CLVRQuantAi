import { test } from "node:test";
import assert from "node:assert/strict";
import { MacroCalendarCache } from "./macroCalendarCache";

test("cold failure rejects; valid empty weekly feed is a genuine cached empty result", async () => {
  let calls = 0;
  const cache = new MacroCalendarCache(async () => {
    if (++calls === 1) throw Error("upstream offline");
    return [];
  }, 300_000, () => 100);
  await assert.rejects(cache.get());
  assert.deepEqual(await cache.get(), { events: [], stale: false, fetchedAt: 100 });
  assert.equal(calls, 2);
  assert.deepEqual((await cache.get()).events, []);
  assert.equal(calls, 2);
});

test("past-due entries never bypass TTL; ten reloads and manual retries share a cached feed", async () => {
  let calls = 0, time = 100;
  const cache = new MacroCalendarCache(async () => { calls++; return [{ name: "past-due" }]; },
    300_000, () => time);
  await cache.get();
  for (let i = 0; i < 10; i++) assert.equal((await cache.get()).events[0].name, "past-due");
  assert.equal(calls, 1);
  time += 299_999;
  await cache.get();
  assert.equal(calls, 1);
  time += 1;
  await cache.get();
  assert.equal(calls, 2);
});

test("concurrent refreshes share one fetch; failures retain and label stale snapshot with cooldown", async () => {
  let finish: (events: { name: string }[]) => void = () => {};
  let calls = 0, time = 100;
  const cache = new MacroCalendarCache(() => {
    if (++calls === 1) return new Promise<{ name: string }[]>(resolve => { finish = resolve; });
    return Promise.reject(Error("offline"));
  }, 100, () => time);
  const a = cache.get(), b = cache.get();
  assert.equal(calls, 1);
  finish([{ name: "FOMC" }]);
  assert.deepEqual(await a, await b);
  time = 201;
  assert.deepEqual(await cache.get(), { events: [{ name: "FOMC" }], stale: true, fetchedAt: 100 });
  for (let i = 0; i < 10; i++) await cache.get(true);
  assert.equal(calls, 2);
  time += 30_000;
  await cache.get(true);
  assert.equal(calls, 3);
});