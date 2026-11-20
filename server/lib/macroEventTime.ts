/** Calendar dates and times are Eastern, including on DST rollover days. */
export function macroEventTime(event: { date?: string; timeET?: string; time?: string }): number | null {
  const date = String(event.date || "");
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date)) {
    const value = Date.parse(date);
    return Number.isFinite(value) ? value : null;
  }
  const time = String(event.timeET || event.time || "").match(/^(\d{1,2}):(\d{2})(?:\s*ET)?$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", timeZoneName: "shortOffset",
  }).formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === "timeZoneName")?.value;
  const hours = offset?.match(/^GMT-([45])$/)?.[1];
  if (!hours) return null;
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, Number(time[1]) + Number(hours), Number(time[2]));
}

export function upcomingBriefEvents(events: any[], now = Date.now()): any[] {
  return events.filter(event => {
    const ts = macroEventTime(event);
    return ts != null && ts > now && event.released !== true && (event.actual == null || event.actual === "" || event.actual === "—");
  }).sort((a, b) => macroEventTime(a)! - macroEventTime(b)!);
}
