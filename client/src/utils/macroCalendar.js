// Calendar dates are ET dates, not browser-local dates or UTC midnight instants.
export function etDateParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
}

// Feed entries can be ET calendar dates or timestamped instants. Never compare
// their raw representations (or parse a date-only string as UTC midnight).
export function macroEventDate(value) {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : etDateParts(instant).date;
}

export function macroWeekRange(now = new Date()) {
  const { date, weekday } = etDateParts(now);
  const daysToSunday = 6 - ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const end = new Date(`${date}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + daysToSunday);
  return { start: date, end: end.toISOString().slice(0, 10) };
}

export function filterMacroCalendar(events, tab, region, impact, now = new Date()) {
  const { start, end } = macroWeekRange(now);
  return events.filter(e => {
    const date = macroEventDate(e.date);
    return date && date >= start && date <= (tab === "today" ? start : end);
  })
    .filter(e => region === "ALL" || (e.country || "").toUpperCase() === region)
    .filter(e => impact === "ALL" || e.impact === impact)
    .sort((a, b) => macroEventDate(a.date).localeCompare(macroEventDate(b.date)) ||
      (a.timeET || a.time || "00:00").localeCompare(b.timeET || b.time || "00:00"));
}

// One ordering/range for both Radar's countdown and Macro's NEXT RELEASE.
// The feed dates are ET calendar days; use the offset on the event's date,
// never the device's timezone or today's offset (DST can change before then).
export function macroEventInstant(event) {
  const date = macroEventDate(event?.date);
  if (!date) return null;
  if (event.date !== date) return new Date(event.date);
  const time = (event.timeET || event.time || "").trim();
  const match = time.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?(?:\s*ET)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > (match[3] ? 12 : 23) || minutes > 59) return null;
  if (match[3]) hours = hours % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
  const [year, month, day] = date.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", timeZoneName: "shortOffset",
  }).formatToParts(noon).find(part => part.type === "timeZoneName")?.value;
  const matchOffset = offset?.match(/^GMT-([45])$/);
  if (!matchOffset) return null;
  return new Date(Date.UTC(year, month - 1, day, hours + Number(matchOffset[1]), minutes));
}

export function selectUpcomingMacroEvents(events, now = new Date()) {
  return events.filter(event => !event.released).map(event => {
    const target = macroEventInstant(event);
    return target ? { ...event, target, diffMs: target.getTime() - now.getTime() } : null;
  }).filter(event => event && event.diffMs > 0)
    .sort((a, b) => a.diffMs - b.diffMs || String(a.id || a.name).localeCompare(String(b.id || b.name)));
}

// Only the newest request may commit; failed refreshes never erase previously loaded events.
export function createMacroLoader(load, onUpdate) {
  let sequence = 0;
  let pending = false;
  let disposed = false;
  let hasData = false;
  return {
    async fetch(force = false) {
      if (disposed || (pending && !force)) return;
      const request = ++sequence;
      pending = true;
      if (!hasData) onUpdate({ loading: true, error: false });
      try {
        const result = await load(force);
        const events = Array.isArray(result) ? result : result?.events;
        if (!Array.isArray(events) || events.some(e => !e || !macroEventDate(e.date))) {
          throw new Error("Invalid macro calendar response");
        }
        if (disposed || request !== sequence) return;
        hasData = true;
        onUpdate({ events, loading: false, error: false, stale: !Array.isArray(result) && !!result.stale });
      } catch (error) {
        if (disposed || request !== sequence) return;
        onUpdate({ loading: false, error: error?.message || "Macro calendar unavailable", stale: hasData });
      } finally {
        if (request === sequence) pending = false;
      }
    },
    dispose() { disposed = true; sequence++; },
  };
}