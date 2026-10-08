import { ROTATION_CONFIG } from "../config";

export type MacroObservation = { t: number; value: number };
export type MacroSeries = { observations: MacroObservation[]; stale?: boolean; error?: string | null };
export type MacroSeriesSet = {
  netLiquidity: MacroSeries;
  dxy: MacroSeries;
  treasury10y: MacroSeries;
  vix: MacroSeries;
  btcEtfFlows: MacroSeries;
  nasdaq: MacroSeries;
  wti: MacroSeries;
  fedPolicyProxy: MacroSeries;
  gold?: MacroSeries;
};

const DAY = 86_400_000;
const FACTOR_WEIGHTS = ROTATION_CONFIG.macroWeights;
type FactorName = keyof typeof FACTOR_WEIGHTS;

function cleanSeries(series: MacroSeries, asOf: number): MacroObservation[] {
  const daily = new Map<string, MacroObservation>();
  for (const point of series.observations) {
    if (!Number.isFinite(point.t) || point.t > asOf || !Number.isFinite(point.value)) continue;
    const day = new Date(point.t).toISOString().slice(0, 10);
    const prior = daily.get(day);
    if (!prior || point.t > prior.t) daily.set(day, point);
  }
  return [...daily.values()].sort((a, b) => a.t - b.t);
}

function rollingChanges(points: MacroObservation[], lookbackDays: number, cutoff: number): number[] {
  const recent = points.filter(point => point.t <= cutoff).slice(-(252 + lookbackDays));
  const changes: number[] = [];
  for (let i = lookbackDays; i < recent.length; i++) {
    changes.push(recent[i].value - recent[i - lookbackDays].value);
  }
  return changes;
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function factor(
  name: FactorName | "gold",
  source: MacroSeries | undefined,
  asOf: number,
  sign: 1 | -1,
) {
  const points = source ? cleanSeries(source, asOf) : [];
  const current = points.at(-1) ?? null;
  const old20 = points.length >= 21 ? points.at(-21)! : null;
  const change20d = current && old20 ? current.value - old20.value : null;
  const history = rollingChanges(points, 20, asOf);
  const deviation = sampleStdDev(history);
  const enough = history.length >= 252 && deviation != null && deviation > 0 && change20d != null;
  const stale = !source || source.stale === true || !enough;
  const zscore = !stale && deviation ? sign * change20d! / deviation : null;
  const clippedZ = zscore == null ? null : Math.max(-ROTATION_CONFIG.riskScoreClip, Math.min(ROTATION_CONFIG.riskScoreClip, zscore));
  const scaledScore = clippedZ == null ? null : clippedZ / ROTATION_CONFIG.riskScoreClip * 100;
  const weight = name === "gold" ? 0 : FACTOR_WEIGHTS[name];
  return {
    factor: name,
    rawValue: current?.value ?? null,
    rawAsOf: current ? new Date(current.t).toISOString() : null,
    change20d,
    zscore,
    scaledScore,
    weight,
    contribution: scaledScore == null || weight === 0 ? null : scaledScore * weight,
    stale,
    status: !source ? "unavailable" : enough ? (source.stale ? "stale" : "ready") : "warming_up",
    error: source?.error ?? null,
  };
}

export function computeMacroState(input: MacroSeriesSet, asOfInput: string | number) {
  const asOf = typeof asOfInput === "number" ? asOfInput : Date.parse(asOfInput);
  if (!Number.isFinite(asOf)) throw new Error("Macro calculation requires a valid as-of timestamp");
  const factors = [
    factor("netLiquidity", input.netLiquidity, asOf, 1),
    factor("dxy", input.dxy, asOf, -1),
    factor("treasury10y", input.treasury10y, asOf, -1),
    factor("vix", input.vix, asOf, -1),
    factor("btcEtfFlows", input.btcEtfFlows, asOf, 1),
    factor("nasdaq", input.nasdaq, asOf, 1),
    factor("wti", input.wti, asOf, -1),
    factor("fedPolicyProxy", input.fedPolicyProxy, asOf, -1),
    factor("gold", input.gold, asOf, 1),
  ];
  const scored = factors.filter(row => row.weight > 0 && !row.stale && row.scaledScore != null);
  const activeWeight = scored.reduce((sum, row) => sum + row.weight, 0);
  const score = activeWeight
    ? scored.reduce((sum, row) => sum + row.scaledScore! * row.weight, 0) / activeWeight
    : null;
  const vixPoints = cleanSeries(input.vix ?? { observations: [], stale: true }, asOf);
  const vixCurrent = vixPoints.at(-1)?.value ?? null;
  const vixFiveDaysAgo = vixPoints.length >= 6 ? vixPoints.at(-6)?.value ?? null : null;
  const vixShock = input.vix?.stale || vixCurrent == null ? null : (vixCurrent > 30
    || (vixFiveDaysAgo != null && vixFiveDaysAgo > 0 && vixCurrent / vixFiveDaysAgo - 1 > 0.25));
  return {
    asOf: new Date(asOf).toISOString(),
    score,
    label: score == null ? "UNAVAILABLE" : score >= 30 ? "RISK_ON" : score <= -30 ? "RISK_OFF" : "NEUTRAL",
    status: score == null ? "warming_up" : scored.length === 8 ? "ready" : "partial",
    activeFactorCount: scored.length,
    activeWeight,
    vixShock,
    factors,
  };
}

export function fredSeriesToObservations(
  observations: { date: string; value: number | null }[],
  asOf: number,
): MacroObservation[] {
  const sorted = observations
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Date.parse(`${row.date}T00:00:00Z`) <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  const values: MacroObservation[] = [];
  let lastValue: number | null = null;
  for (const row of sorted) {
    if (row.value != null && Number.isFinite(row.value)) lastValue = row.value;
    if (lastValue != null) values.push({ t: Date.parse(`${row.date}T00:00:00Z`), value: lastValue });
  }
  return values;
}
