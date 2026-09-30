export type WeeklyEvent = {
  title: string; country: string; date: string; impact: string;
  forecast?: string; previous?: string; actual?: string;
};

function utcWeeklyEvent(title: string, country: string, date: string, time: string,
  impact: string, forecast: string, previous: string): WeeklyEvent {
  const dm = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!dm || !tm) throw new Error("Invalid FF calendar date/time");
  const hour = (Number(tm[1]) % 12) + (tm[3].toLowerCase() === "pm" ? 12 : 0);
  return {
    title, country,
    date: `${dm[3]}-${dm[1]}-${dm[2]}T${String(hour).padStart(2, "0")}:${tm[2]}:00Z`,
    impact, forecast, previous,
  };
}

// FF CSV timestamps are UTC (the JSON feed has explicit ET offsets).
// Require complete rows; never publish a partially parsed calendar.
export function parseMacroWeeklyCsv(csv: string): WeeklyEvent[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift() !== "Title,Country,Date,Time,Impact,Forecast,Previous,URL")
    throw new Error("Invalid FF calendar CSV header");
  return lines.filter(Boolean).map(line => {
    const columns = line.split(",");
    if (columns.length !== 8) throw new Error("Incomplete FF calendar CSV row");
    const [title, country, date, time, impact, forecast, previous] = columns;
    return utcWeeklyEvent(title, country, date, time, impact, forecast, previous);
  });
}

export function parseMacroWeeklyXml(xml: string): WeeklyEvent[] {
  if (!xml.includes("<weeklyevents>") || !xml.includes("</weeklyevents>"))
    throw new Error("Invalid FF calendar XML document");
  const rows = [...xml.matchAll(/<event>([\s\S]*?)<\/event>/g)];
  if ((xml.match(/<event>/g) || []).length !== rows.length)
    throw new Error("Incomplete FF calendar XML document");
  const field = (row: string, key: string) => {
    const match = row.match(new RegExp(`<${key}(?:\\s*\\/|>([\\s\\S]*?)<\\/${key})>`));
    if (!match) throw new Error(`Missing FF calendar XML ${key}`);
    return (match[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  };
  return rows.map(([, row]) => utcWeeklyEvent(
    field(row, "title"), field(row, "country"), field(row, "date"),
    field(row, "time"), field(row, "impact"), field(row, "forecast"), field(row, "previous"),
  ));
}

export function etWeekStart(date: string): string {
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString().slice(0, 10);
}

export function validateMacroWeeklyFeed(raw: unknown, todayET: string): WeeklyEvent[] {
  if (!Array.isArray(raw)) throw new Error("FF weekly calendar response is not an array");
  if (raw.some(e => !e || typeof e.title !== "string" || !e.title ||
    typeof e.country !== "string" || typeof e.date !== "string" ||
    !Number.isFinite(Date.parse(e.date)) || typeof e.impact !== "string")) {
    throw new Error("FF weekly calendar contains invalid entries");
  }
  // FF publishes Sunday–Saturday. Reject a prior week's successful HTTP
  // response during rollover; otherwise it would appear as a genuine empty.
  const start = new Date(`${etWeekStart(todayET)}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const first = start.toISOString().slice(0, 10), last = end.toISOString().slice(0, 10);
  if (raw.length && !raw.some(e => {
    const date = new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return date >= first && date <= last;
  })) throw new Error("FF weekly calendar belongs to a different week");
  return raw;
}