// Calendar dates are ET dates, not browser-local dates or UTC midnight instants.
export function etDateParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
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
  return events.filter(e => e.date >= start && e.date <= (tab === "today" ? start : end))
    .filter(e => region === "ALL" || (e.country || "").toUpperCase() === region)
    .filter(e => impact === "ALL" || e.impact === impact)
    .sort((a, b) => a.date.localeCompare(b.date) ||
      (a.timeET || a.time || "00:00").localeCompare(b.timeET || b.time || "00:00"));
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
      if (!hasData || force) onUpdate({ loading: true, error: false });
      try {
        const result = await load(force);
        const events = Array.isArray(result) ? result : result?.events;
        if (!Array.isArray(events)) throw new Error("Invalid macro calendar response");
        if (disposed || request !== sequence) return;
        hasData = true;
        onUpdate({ events, loading: false, error: false, stale: !Array.isArray(result) && !!result.stale });
      } catch {
        if (disposed || request !== sequence) return;
        onUpdate({ loading: false, error: true, stale: hasData });
      } finally {
        if (request === sequence) pending = false;
      }
    },
    dispose() { disposed = true; sequence++; },
  };
}