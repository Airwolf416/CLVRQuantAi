export const BRIEF_TIME_ZONES = [
  { value: "Pacific/Honolulu", label: "Honolulu — Hawaii" },
  { value: "America/Anchorage", label: "Anchorage — Alaska" },
  { value: "America/Vancouver", label: "Vancouver — Pacific" },
  { value: "America/Los_Angeles", label: "Los Angeles — Pacific" },
  { value: "America/Phoenix", label: "Phoenix — Mountain (no DST)" },
  { value: "America/Edmonton", label: "Edmonton — Mountain" },
  { value: "America/Denver", label: "Denver — Mountain" },
  { value: "America/Winnipeg", label: "Winnipeg — Central" },
  { value: "America/Chicago", label: "Chicago — Central" },
  { value: "America/Toronto", label: "Toronto — Eastern" },
  { value: "America/New_York", label: "New York — Eastern" },
  { value: "America/Halifax", label: "Halifax — Atlantic" },
  { value: "America/St_Johns", label: "St. John’s — Newfoundland" },
  { value: "America/Sao_Paulo", label: "São Paulo — Brasília" },
  { value: "Atlantic/Reykjavik", label: "Reykjavík — GMT" },
  { value: "Europe/London", label: "London — UK" },
  { value: "Europe/Paris", label: "Paris — Central Europe" },
  { value: "Africa/Johannesburg", label: "Johannesburg — South Africa" },
  { value: "Asia/Dubai", label: "Dubai — Gulf" },
  { value: "Asia/Kolkata", label: "Mumbai — India" },
  { value: "Asia/Bangkok", label: "Bangkok — Indochina" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Tokyo", label: "Tokyo — Japan" },
  { value: "Asia/Seoul", label: "Seoul — Korea" },
  { value: "Australia/Sydney", label: "Sydney — Eastern Australia" },
  { value: "Pacific/Auckland", label: "Auckland — New Zealand" },
] as const;

export type BriefTimeZone = typeof BRIEF_TIME_ZONES[number]["value"];

export function isBriefTimeZone(value: unknown): value is BriefTimeZone {
  return typeof value === "string" &&
    BRIEF_TIME_ZONES.some(zone => zone.value === value);
}
