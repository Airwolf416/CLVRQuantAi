import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketSessionContext, dueBriefZones, isBriefScheduleDue, localBriefClock, usEquityHoliday } from "./briefSchedule";
import { isBriefTimeZone } from "@shared/briefTimeZones";
import { runIntegrityCheck } from "./dataIntegrity";
import { shouldCacheAiAnalysis } from "./aiAnalysisCache";

test("local 6 AM follows daylight saving rather than a fixed UTC offset", () => {
  assert.equal(localBriefClock(new Date("2026-07-06T10:00:00Z"), "America/Toronto").hour, 6);
  assert.equal(localBriefClock(new Date("2026-11-09T11:00:00Z"), "America/Toronto").hour, 6);
  assert.equal(isBriefScheduleDue(new Date("2026-11-09T10:59:00Z"), "America/Toronto"), false);
  assert.equal(isBriefScheduleDue(new Date("2026-11-09T11:00:00Z"), "America/Toronto"), true);
  assert.equal(isBriefScheduleDue(new Date("2026-11-09T13:59:00Z"), "America/Toronto"), true);
  assert.equal(isBriefScheduleDue(new Date("2026-11-09T14:00:00Z"), "America/Toronto"), false);
});

test("midnight cannot accidentally trigger morning catch-up", () => {
  const midnight = new Date("2026-11-09T05:00:00Z");
  assert.equal(localBriefClock(midnight, "America/Toronto").hour, 0);
  assert.equal(isBriefScheduleDue(midnight, "America/Toronto"), false);
});

test("different time zones have different due windows and local dates", () => {
  const now = new Date("2026-11-09T11:00:00Z");
  assert.deepEqual(dueBriefZones(now, ["America/Toronto", "America/Vancouver", "Asia/Tokyo", "invalid"]), [
    { timeZone: "America/Toronto", dateKey: "2026-11-09" },
  ]);
  assert.equal(localBriefClock(new Date("2026-11-09T23:00:00Z"), "Asia/Tokyo").dateKey, "2026-11-10");
  assert.equal(isBriefTimeZone("Asia/Kolkata"), true);
  assert.equal(isBriefTimeZone("unsupported"), false);
});

test("weekend recap closes cash markets and FX without closing crypto", () => {
  const saturday = buildMarketSessionContext(new Date("2026-11-07T15:00:00Z"), "America/Toronto");
  assert.equal(saturday.isLocalWeekend, true);
  assert.equal(saturday.usEquitiesOpen, false);
  assert.equal(saturday.forexOpen, false);
  assert.match(saturday.text, /Crypto trades 24\/7/);
  assert.match(saturday.text, /closed for the weekend/);
});

test("FX reopens Sunday at 5 PM ET and remains open Monday evening", () => {
  assert.equal(buildMarketSessionContext(new Date("2026-11-08T21:59:00Z"), "America/Toronto").forexOpen, false);
  assert.equal(buildMarketSessionContext(new Date("2026-11-08T22:00:00Z"), "America/Toronto").forexOpen, true);
  assert.equal(buildMarketSessionContext(new Date("2026-11-10T01:00:00Z"), "America/Toronto").forexOpen, true);
  assert.equal(buildMarketSessionContext(new Date("2026-11-06T22:00:00Z"), "America/Toronto").forexOpen, false);
});

test("common US full-day exchange holidays are accounted for", () => {
  assert.equal(usEquityHoliday("2026-04-03"), "Good Friday");
  assert.equal(usEquityHoliday("2026-07-03"), "Independence Day");
  assert.equal(usEquityHoliday("2026-11-26"), "Thanksgiving");
  const christmas = buildMarketSessionContext(new Date("2026-12-25T15:00:00Z"), "Europe/London");
  assert.equal(christmas.usEquitiesOpen, false);
  assert.equal(christmas.usHoliday, "Christmas Day");
  assert.match(christmas.text, /European\/African morning/);
});

test("unchanged closed-market quotes do not prevent a weekend brief", () => {
  const rows = [
    { symbol: "SPX", price: "6000", change: "0%", changeNum: 0 },
    { symbol: "EURUSD", price: "1.1", change: "0%", changeNum: 0 },
    { symbol: "BTC", price: "80000", change: "1%", changeNum: 1 },
  ];
  assert.equal(runIntegrityCheck(rows).criticalFailure, true);
  const report = runIntegrityCheck(rows, [], new Set(["SPX", "EURUSD"]));
  assert.equal(report.criticalFailure, false);
  assert.equal(report.staleCount, 0);
  const badCrypto = runIntegrityCheck([{ ...rows[2], changeNum: 0 }], [], new Set(["SPX"]));
  assert.equal(badCrypto.criticalFailure, true);
});

test("empty or malformed trade batches are never shared-cached", () => {
  assert.equal(shouldCacheAiAnalysis('{"trades":[]}'), false);
  assert.equal(shouldCacheAiAnalysis('{"trades":[], "empty_reason":{"type":"ALL_REJECTED"}}'), false);
  assert.equal(shouldCacheAiAnalysis('{"trades":['), false);
  assert.equal(shouldCacheAiAnalysis(""), false);
  assert.equal(shouldCacheAiAnalysis('{"trades":[{"symbol":"BTC"}]}'), true);
  assert.equal(shouldCacheAiAnalysis("A normal Ask AI response."), true);
});
