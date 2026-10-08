import { ROTATION_CONFIG } from "../config";
import type { RotationFredData, RotationFredSeries, RotationSourceResult } from "../types";
import { cachedRotationSource, fetchJson } from "./cache";

function validFredData(value: unknown): value is RotationFredData {
  return !!value && Array.isArray((value as any).series)
    && Array.isArray((value as any).unavailableSeries)
    && (value as any).series.every((series: any) => typeof series.seriesId === "string"
      && Array.isArray(series.observations)
      && series.observations.every((point: any) =>
        typeof point.date === "string" && (point.value === null || Number.isFinite(point.value))));
}

function parseSeries(seriesId: string, payload: any): RotationFredSeries | null {
  if (!Array.isArray(payload?.observations)) return null;
  const observations = payload.observations
    .filter((row: any) => typeof row?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row: any) => ({
      date: row.date,
      value: row.value === "." || row.value == null ? null : Number(row.value),
    }))
    .filter((row: any) => row.value === null || Number.isFinite(row.value));
  if (!observations.length) return null;
  return { seriesId, observations };
}

export function createFredSource() {
  return {
    async fetch(date?: string): Promise<RotationSourceResult<RotationFredData>> {
      const today = new Date().toISOString().slice(0, 10);
      const endDate = date || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate > today) {
        throw new Error("FRED end date must be a valid date no later than today");
      }
      const key = process.env.FRED_API_KEY;
      if (!key) {
        return { data: null, asOf: null, stale: true, error: "FRED_API_KEY is not configured" };
      }
      return cachedRotationSource({
        key: `rotation:source:fred:${endDate}`,
        ttlSeconds: ROTATION_CONFIG.source.freshTtlSeconds.fred,
        load: async () => {
          const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 370 * 86_400_000)
            .toISOString().slice(0, 10);
          const series: RotationFredSeries[] = [];
          const unavailableSeries: string[] = [];
          for (const seriesId of ROTATION_CONFIG.source.fredSeries) {
            try {
              const params = new URLSearchParams({
                series_id: seriesId,
                api_key: key,
                file_type: "json",
                observation_start: startDate,
                observation_end: endDate,
                sort_order: "asc",
              });
              const payload = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?${params}`, "FRED");
              const parsed = parseSeries(seriesId, payload);
              if (parsed) series.push(parsed);
              else unavailableSeries.push(seriesId);
            } catch {
              unavailableSeries.push(seriesId);
            }
          }
          if (!series.length) throw new Error("FRED returned no valid observations");
          return { series, unavailableSeries } satisfies RotationFredData;
        },
        validate: validFredData,
        timestamp: payload => payload.series.flatMap(series => series.observations.map(point => point.date))
          .sort().at(-1) || null,
      });
    },
  };
}
