import { DigestError } from "./weeklyDigestPolicy";

export type DigestShape = {
  version: string;
  title: string;
  summary: string;
  items: { emoji: string; title: string; description: string; sources?: number[] }[];
};

export const WEEKLY_DIGEST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "title", "summary", "items"],
  properties: {
    version: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["emoji", "title", "description", "sources"],
        properties: {
          emoji: { type: "string" }, title: { type: "string" }, description: { type: "string" },
          sources: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
};

export function parseWeeklyDigestResponse(raw: string, inputCount: number): DigestShape | null {
  let parsed: any;
  // Accept a whole fenced JSON document, never extract JSON from surrounding
  // prose. Both forms enter the same schema, source-citation and compliance gates.
  const fenced = raw.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  try { parsed = JSON.parse(fenced ? fenced[1] : raw); }
  catch { throw new DigestError("ai", "AI_INVALID_JSON"); }
  if (parsed?.version === "" && parsed?.title === "" && parsed?.summary === "" &&
      Array.isArray(parsed?.items) && parsed.items.length === 0) return null;
  if (typeof parsed?.version !== "string" || typeof parsed?.title !== "string" ||
      !parsed.title.trim() || parsed.title.length > 100 ||
      typeof parsed?.summary !== "string" || parsed.summary.length > 400 ||
      !Array.isArray(parsed?.items) || !parsed.items.length || parsed.items.length > 7) {
    throw new DigestError("ai", "INVALID_DIGEST_SCHEMA");
  }
  for (const item of parsed.items) {
    if (typeof item?.title !== "string" || !item.title.trim() || item.title.length > 100 ||
        typeof item?.description !== "string" || !item.description.trim() || item.description.length > 400 ||
        !Array.isArray(item?.sources) || !item.sources.length ||
        item.sources.some((index: any) => !Number.isInteger(index) || index < 1 || index > inputCount)) {
      const error = new DigestError("ai", "UNSUPPORTED_DIGEST_ITEM");
      // Structural diagnostics only: no generated copy or recipient information.
      Object.assign(error, { validation: {
        titleLength: typeof item?.title === "string" ? item.title.length : null,
        descriptionLength: typeof item?.description === "string" ? item.description.length : null,
        sourceCount: Array.isArray(item?.sources) ? item.sources.length : null,
        sourceRangeValid: Array.isArray(item?.sources) &&
          item.sources.every((index: any) => Number.isInteger(index) && index >= 1 && index <= inputCount),
        inputCount,
      } });
      throw error;
    }
  }
  return {
    version: parsed.version, title: parsed.title, summary: parsed.summary,
    items: parsed.items.map((item: any) => ({
      emoji: typeof item.emoji === "string" ? item.emoji.slice(0, 16) : "✨",
      title: item.title, description: item.description, sources: item.sources,
    })),
  };
}
