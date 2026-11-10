import { BRIEF_TIME_ZONES, type BriefTimeZone } from "@shared/briefTimeZones";

const partsIn = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
};

export function localBriefDate(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localBriefClock(date: Date, timeZone: string) {
  const p = partsIn(date, timeZone);
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + (weekday - first + 7) % 7 + 7 * (n - 1);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - (last.getUTCDay() - weekday + 7) % 7;
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const observed = new Date(Date.UTC(year, month - 1, day + (dow === 6 ? -1 : dow === 0 ? 1 : 0)));
  return observed.toISOString().slice(0, 10);
}

function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function usEquityHoliday(dateKey: string): string | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  const holidays = new Map<string, string>();
  const add = (date: string, name: string) => holidays.set(date, name);
  add(observedFixedHoliday(year, 1, 1), "New Year’s Day");
  if (year >= 1998) add(`${year}-01-${String(nthWeekday(year, 1, 1, 3)).padStart(2, "0")}`, "Martin Luther King Jr. Day");
  add(`${year}-02-${String(nthWeekday(year, 2, 1, 3)).padStart(2, "0")}`, "Presidents Day");
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  add(goodFriday.toISOString().slice(0, 10), "Good Friday");
  add(`${year}-05-${String(lastWeekday(year, 5, 1)).padStart(2, "0")}`, "Memorial Day");
  if (year >= 2022) add(observedFixedHoliday(year, 6, 19), "Juneteenth");
  add(observedFixedHoliday(year, 7, 4), "Independence Day");
  add(`${year}-09-${String(nthWeekday(year, 9, 1, 1)).padStart(2, "0")}`, "Labor Day");
  add(`${year}-11-${String(nthWeekday(year, 11, 4, 4)).padStart(2, "0")}`, "Thanksgiving");
  add(observedFixedHoliday(year, 12, 25), "Christmas Day");
  return holidays.get(dateKey) || null;
}

function easternDateTime(date: Date) {
  const p = partsIn(date, "America/New_York");
  return { dateKey: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function buildMarketSessionContext(date: Date, timeZone: BriefTimeZone) {
  const local = localBriefClock(date, timeZone);
  const et = easternDateTime(date);
  const weekend = local.weekday === "Saturday" || local.weekday === "Sunday";
  const holiday = usEquityHoliday(et.dateKey);
  const etWeekday = et.weekday !== "Saturday" && et.weekday !== "Sunday";
  const equitiesOpen = !holiday && etWeekday && et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60;
  const forexOpen = et.weekday === "Saturday" ? false
    : et.weekday === "Sunday" ? et.minutes >= 17 * 60
    : et.weekday === "Friday" ? et.minutes < 17 * 60
    : true;
  const regionalFocus = timeZone.startsWith("Europe/") || timeZone.startsWith("Africa/") || timeZone === "Atlantic/Reykjavik"
    ? "Prioritize the European/African morning, the Asian overnight recap, and the forthcoming US session."
    : timeZone.startsWith("Asia/")
      ? "Prioritize the Asian local-day outlook and the most recent completed US session."
      : timeZone.startsWith("Australia/") || timeZone === "Pacific/Auckland"
        ? "Prioritize the Australia/New Zealand morning, upcoming Asian sessions, and the most recent US session."
        : "Prioritize the Americas morning and the overnight Asian/European recap.";
  const weekdayNotes: string[] = [
    `Recipient local date: ${local.dateKey}, ${local.weekday}, in ${timeZone}. ${regionalFocus}`,
    "Regional focus is based on the selected time zone, not nationality. Only discuss regional instruments supported by supplied data; never invent local quotes, holidays, or exchange-open status.",
  ];
  if (weekend) weekdayNotes.push(`It is ${local.weekday} in the subscriber’s local time zone (${timeZone}); use a weekend-aware market recap.`);
  if (equitiesOpen) weekdayNotes.push("US cash equities are in regular session now.");
  else if (holiday) weekdayNotes.push(`US cash equities are closed for ${holiday}; quote changes must not be described as live session moves.`);
  else if (!etWeekday) weekdayNotes.push(`US cash equities are closed for the weekend (${et.weekday} in New York).`);
  else weekdayNotes.push("US cash equities are outside regular hours; use last available prices and do not imply the cash session is live.");
  weekdayNotes.push(forexOpen
    ? "The standard FX week is open; forex trades nearly 24/5, not 24/7."
    : "The standard FX week is closed right now; do not describe FX quotes as live.");
  weekdayNotes.push("Crypto trades 24/7. State the quote timestamp/status honestly.");
  return {
    localDate: local.dateKey,
    localWeekday: local.weekday,
    isLocalWeekend: weekend,
    usHoliday: holiday,
    usEquitiesOpen: equitiesOpen,
    forexOpen,
    text: weekdayNotes.join("\n"),
  };
}

export function isBriefScheduleDue(date: Date, timeZone: string) {
  if (!BRIEF_TIME_ZONES.some(zone => zone.value === timeZone)) return false;
  const clock = localBriefClock(date, timeZone);
  return clock.hour >= 6 && clock.hour < 9;
}

export function dueBriefZones(now: Date, zones: readonly string[] = BRIEF_TIME_ZONES.map(z => z.value)) {
  return zones.flatMap(zone => {
    if (!isBriefScheduleDue(now, zone)) return [];
    const clock = localBriefClock(now, zone);
    return [{ timeZone: zone as BriefTimeZone, dateKey: clock.dateKey }];
  });
}
