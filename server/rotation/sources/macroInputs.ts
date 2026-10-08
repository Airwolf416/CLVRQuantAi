import { computeMacroState, type MacroSeries, type MacroSeriesSet } from "../engines/macro";
import type { RotationEtfFlows, RotationFredData, RotationSourceResult } from "../types";
import type { YahooMacroPayload } from "./yahooMacro";
import type { RotationPriceSeries } from "../engines/crypto";

const DAY = 86_400_000;

function seriesRows(data: RotationFredData | null, seriesId: string) {
  return data?.series.find(series => series.seriesId === seriesId)?.observations ?? [];
}

function alignedFred(
  data: RotationFredData | null,
  anchorId: string,
  requiredIds: string[],
  formula: (values: Record<string, number>) => number,
  sourceStale: boolean,
): MacroSeries {
  if (!data) return { observations: [], stale: true, error: "FRED data unavailable" };
  const ids = [anchorId, ...requiredIds];
  const rows = Object.fromEntries(ids.map(id => [id, seriesRows(data, id)]));
  if (ids.some(id => !rows[id].length)) {
    return { observations: [], stale: true, error: `FRED series unavailable: ${ids.filter(id => !rows[id].length).join(", ")}` };
  }
  const anchorDates = [...new Set(rows[anchorId].map(row => row.date))].sort();
  const latestById: Record<string, { index: number; value: number | null }> = Object.fromEntries(ids.map(id => [id, { index: 0, value: null }]));
  const observations: { t: number; value: number }[] = [];
  for (const date of anchorDates) {
    const values: Record<string, number> = {};
    let complete = true;
    for (const id of ids) {
      const seriesRowsForId = rows[id];
      let cursor = latestById[id].index;
      while (cursor < seriesRowsForId.length && seriesRowsForId[cursor].date <= date) {
        if (seriesRowsForId[cursor].value != null) latestById[id].value = seriesRowsForId[cursor].value;
        cursor++;
      }
      latestById[id].index = cursor;
      if (latestById[id].value == null) complete = false;
      else values[id] = latestById[id].value!;
    }
    if (complete) {
      const value = formula(values);
      if (Number.isFinite(value)) observations.push({ t: Date.parse(`${date}T00:00:00.000Z`), value });
    }
  }
  const missingUsedSeries = ids.filter(id => data.unavailableSeries.includes(id));
  const partialUnrelatedFailure = data.unavailableSeries.length > 0 && missingUsedSeries.length === 0;
  const stale = (sourceStale && !partialUnrelatedFailure) || missingUsedSeries.length > 0;
  return observations.length
    ? { observations, stale, error: stale ? "Required FRED observations are stale or unavailable" : null }
    : { observations: [], stale: true, error: "No aligned FRED observations" };
}

function yahooSeries(data: YahooMacroPayload | null, symbol: string): MacroSeries {
  const series = data?.series[symbol];
  return series
    ? { observations: series.observations, stale: series.stale, error: series.error }
    : { observations: [], stale: true, error: `Yahoo series ${symbol} unavailable` };
}

function etfFlowSeries(flows: RotationEtfFlows | null, stale: boolean): MacroSeries {
  const rows = flows?.rows.slice().sort((a, b) => a.date.localeCompare(b.date)) ?? [];
  const observations = rows.flatMap((row, index) => {
    const lastFive = rows.slice(Math.max(0, index - 4), index + 1);
    if (lastFive.length < 5 || lastFive.some(item => item.totalNetFlowUsd == null)) return [];
    return [{
      t: Date.parse(`${row.date}T23:59:59.999Z`),
      value: lastFive.reduce((sum, item) => sum + item.totalNetFlowUsd!, 0),
    }];
  });
  return {
    observations,
    stale: stale || observations.length === 0,
    error: stale || observations.length === 0 ? "ETF flow source is stale or has insufficient history" : null,
  };
}

export function buildMacroInputs(input: {
  fred: RotationSourceResult<RotationFredData>;
  etfFlows: RotationSourceResult<RotationEtfFlows>;
  yahoo: RotationSourceResult<YahooMacroPayload>;
}) {
  const fred = input.fred.data;
  const yahoo = input.yahoo.data;
  const observations: MacroSeriesSet = {
    netLiquidity: alignedFred(fred, "DFF", ["WALCL", "WTREGEN", "RRPONTSYD"],
      values => values.WALCL - values.WTREGEN - values.RRPONTSYD * 1000, input.fred.stale),
    dxy: yahooSeries(yahoo, "DX-Y.NYB"),
    treasury10y: yahooSeries(yahoo, "^TNX"),
    vix: yahooSeries(yahoo, "^VIX"),
    btcEtfFlows: etfFlowSeries(input.etfFlows.data, input.etfFlows.stale),
    nasdaq: yahooSeries(yahoo, "^NDX"),
    wti: yahooSeries(yahoo, "CL=F"),
    fedPolicyProxy: alignedFred(fred, "DFF", ["DGS2"], values => values.DGS2 - values.DFF, input.fred.stale),
    gold: yahooSeries(yahoo, "GC=F"),
  };
  const equitySeries: Record<string, RotationPriceSeries> = {};
  for (const symbol of ["BIL", "TLT", "SPY", "QQQ"]) {
    const row = yahoo?.series[symbol];
    if (row) equitySeries[symbol] = {
      id: symbol.toLowerCase(),
      symbol,
      rank: null,
      marketCap: null,
      points: row.observations.map(point => ({ t: point.t, price: point.value })),
    };
  }
  return {
    observations,
    equitySeries,
    state: (asOf: string | number) => computeMacroState(observations, asOf),
    sourceStatus: {
      fred: { stale: input.fred.stale, asOf: input.fred.asOf, error: input.fred.error ?? null },
      etfFlows: { stale: input.etfFlows.stale, asOf: input.etfFlows.asOf, error: input.etfFlows.error ?? null },
      yahoo: { stale: input.yahoo.stale, asOf: input.yahoo.asOf, error: input.yahoo.error ?? null },
    },
  };
}

export function makeDailyFlowPercentileHistory(
  points: { date: string; totalNetFlowUsd: number | null }[],
  asOf: number,
): { t: number; value: number }[] {
  return points.flatMap((row, index) => {
    const t = Date.parse(`${row.date}T23:59:59.999Z`);
    if (row.totalNetFlowUsd == null || t > asOf || index < 4) return [];
    const preceding = points.slice(index - 4, index + 1);
    if (preceding.some(point => point.totalNetFlowUsd == null)) return [];
    return [{ t, value: preceding.reduce((sum, point) => sum + point.totalNetFlowUsd!, 0) }];
  });
}
