export interface ExposureCandidate<T = unknown> {
  direction: "LONG" | "SHORT";
  assetClass: string;
  symbol: string;
  correlationToBtc?: number | null;
  payload: T;
}
export interface ExposureSelection<T = unknown> { selected: ExposureCandidate<T>[]; demoted: Array<ExposureCandidate<T> & { exposureNote: string }>; }

/** Ranked-set only: callers must not apply this to a single ticker request. */
export function selectExposureCapped<T>(ranked: ExposureCandidate<T>[]): ExposureSelection<T> {
  const selected: ExposureCandidate<T>[] = [], demoted: Array<ExposureCandidate<T> & { exposureNote: string }> = [];
  const correlatedByDirection: Record<string, number> = { LONG: 0, SHORT: 0 };
  for (const candidate of ranked) {
    if (typeof candidate.correlationToBtc === "number" && Math.abs(candidate.correlationToBtc) > .75 && correlatedByDirection[candidate.direction] >= 2) {
      demoted.push({ ...candidate, exposureNote: "same_direction_btc_correlation_cap" });
      continue;
    }
    selected.push(candidate);
    if (typeof candidate.correlationToBtc === "number" && Math.abs(candidate.correlationToBtc) > .75) correlatedByDirection[candidate.direction]++;
  }
  return { selected, demoted };
}