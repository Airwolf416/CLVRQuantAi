import assert from "node:assert/strict";
import test from "node:test";
import { isIntradayMacroWindow, isUsTradingDay, usEquityMarketHolidays } from "./usTradingCalendar";

test("US trading calendar observes equity market holidays and weekends", () => {
  const holidays = usEquityMarketHolidays(2026);
  assert.ok(holidays.has("2026-07-03"));
  assert.ok(holidays.has("2026-11-26"));
  assert.equal(isUsTradingDay("2026-07-03"), false);
  assert.equal(isUsTradingDay("2026-10-03"), false);
  assert.equal(isUsTradingDay("2026-10-05"), true);
  assert.equal(isUsTradingDay("2026-02-30"), false);
});

test("macro refresh windows use Toronto time at 15-minute boundaries", () => {
  assert.equal(isIntradayMacroWindow(new Date("2026-10-05T12:00:00.000Z")), true); // 08:00 Toronto
  assert.equal(isIntradayMacroWindow(new Date("2026-10-05T12:15:00.000Z")), true);
  assert.equal(isIntradayMacroWindow(new Date("2026-10-05T12:07:00.000Z")), false);
  assert.equal(isIntradayMacroWindow(new Date("2026-10-05T21:00:00.000Z")), true); // 17:00 Toronto
  assert.equal(isIntradayMacroWindow(new Date("2026-10-05T21:15:00.000Z")), false);
  assert.equal(isIntradayMacroWindow(new Date("2026-07-03T12:00:00.000Z")), false); // observed July 4 holiday
});
