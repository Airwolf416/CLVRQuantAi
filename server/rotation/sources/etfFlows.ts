import { ROTATION_CONFIG } from "../config";
import type { RotationEtfFlowRow, RotationEtfFlows, RotationSourceResult } from "../types";
import { cachedRotationSource, fetchText } from "./cache";

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function parseFlowValue(text: string): number | null {
  const normalized = text.replace(/[,$£€\s]/g, "").replace(/[–—]/g, "-");
  if (!normalized || normalized === "-" || normalized.toLowerCase() === "n/a") return null;
  const parens = /^\(.*\)$/.test(normalized);
  const raw = Number(normalized.replace(/[()]/g, ""));
  if (!Number.isFinite(raw)) return null;
  // Farside presents daily net flows in millions of USD.
  return (parens ? -raw : raw) * 1_000_000;
}

export function parseFarsideHtml(html: string): RotationEtfFlowRow[] {
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(match => [...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map(cell => decodeHtml(cell[1])))
      .filter(cells => cells.length >= 2);
    const headerIndex = rows.findIndex(cells => cells.some(cell => /^date$/i.test(cell))
      && cells.some(cell => /\btotal\b/i.test(cell)));
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(header => header.toLowerCase());
    const totalIndex = headers.findIndex(header => /\btotal\b/i.test(header));
    if (totalIndex < 0) continue;
    const result = rows.slice(headerIndex + 1).flatMap(cells => {
      const dateText = cells[0];
      const parsedDate = Date.parse(dateText);
      if (!Number.isFinite(parsedDate) || totalIndex >= cells.length) return [];
      return [{ date: new Date(parsedDate).toISOString().slice(0, 10),
        totalNetFlowUsd: parseFlowValue(cells[totalIndex]) }];
    });
    if (result.length) return result;
  }
  throw new Error("Farside ETF table format was not recognized");
}

function validFlows(value: unknown): value is RotationEtfFlows {
  return !!value && ["farside", "sosovalue"].includes((value as any).provider)
    && Array.isArray((value as any).rows)
    && (value as any).rows.every((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && (row.totalNetFlowUsd === null || Number.isFinite(row.totalNetFlowUsd)));
}

export function createEtfFlowSource() {
  return {
    async fetch(date?: string): Promise<RotationSourceResult<RotationEtfFlows>> {
      const today = new Date().toISOString().slice(0, 10);
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)) {
        throw new Error("ETF flow date must be a valid date no later than today");
      }
      const requestedDate = date || today;
      return cachedRotationSource({
        key: `rotation:source:etf-flows:${requestedDate}`,
        ttlSeconds: ROTATION_CONFIG.source.freshTtlSeconds.etfFlows,
        load: async () => {
          // SoSoValue's authenticated API contract is not configured in this app.
          // Until its endpoint is explicitly configured, use the public Farside table.
          const html = await fetchText(ROTATION_CONFIG.source.farsideBitcoinEtfUrl, "Farside");
          const allRows = parseFarsideHtml(html).filter(row => row.date <= requestedDate);
          if (!allRows.length) throw new Error("Farside has no ETF flow rows for the requested date");
          return { provider: "farside", rows: allRows.slice(-90) } satisfies RotationEtfFlows;
        },
        validate: validFlows,
        timestamp: payload => payload.rows.map(row => row.date).sort().at(-1) || null,
      });
    },
  };
}
