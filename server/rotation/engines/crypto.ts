import { ROTATION_CONFIG } from "../config";

export type PricePoint = { t: number; price: number };
export type RotationPriceSeries = {
  id: string;
  symbol: string;
  rank: number | null;
  marketCap: number | null;
  points: PricePoint[];
};

export type SentimentComponents = {
  fundingOiWeighted7d: number | null;
  aggregateOiChange30d: number | null;
  memeExcess30d: number | null;
  fearGreed: number | null;
  stableDominanceChange30d: number | null;
  smallCapAsi: number | null;
};

export type SentimentComponentHistory = Partial<Record<keyof SentimentComponents, number[]>>;

const DAY = 86_400_000;
const ASI_LABELS = ["STRONG_BTC", "BTC_BIAS", "NEUTRAL", "ALT_BIAS", "ALT_SEASON"] as const;
type AsiLabel = typeof ASI_LABELS[number];

function validPoints(points: PricePoint[], asOf: number): PricePoint[] {
  const byDay = new Map<string, PricePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.t) || point.t > asOf || !Number.isFinite(point.price) || point.price <= 0) continue;
    const day = new Date(point.t).toISOString().slice(0, 10);
    const prior = byDay.get(day);
    if (!prior || point.t > prior.t) byDay.set(day, point);
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

function priceAtOrBefore(points: PricePoint[], target: number, maxGapDays = 2): number | null {
  let candidate: PricePoint | undefined;
  for (const point of points) {
    if (point.t > target) break;
    candidate = point;
  }
  return candidate && target - candidate.t <= maxGapDays * DAY ? candidate.price : null;
}

function returnAt(series: RotationPriceSeries, asOf: number, days: number): number | null {
  const points = validPoints(series.points, asOf);
  const current = priceAtOrBefore(points, asOf);
  const past = priceAtOrBefore(points, asOf - days * DAY);
  return current && past ? current / past - 1 : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function asiLabel(value: number): AsiLabel {
  if (value <= ROTATION_CONFIG.asiBands.strongBtcMax) return "STRONG_BTC";
  if (value <= ROTATION_CONFIG.asiBands.btcBiasMax) return "BTC_BIAS";
  if (value <= ROTATION_CONFIG.asiBands.neutralMax) return "NEUTRAL";
  if (value <= ROTATION_CONFIG.asiBands.altBiasMax) return "ALT_BIAS";
  return "ALT_SEASON";
}

function stabilizeAsiLabel(value: number | null, previousLabels: (string | null)[], previousConfirmed: string | null): {
  candidate: AsiLabel | null; confirmed: string | null; consecutiveDays: number;
} {
  if (value == null) return { candidate: null, confirmed: previousConfirmed, consecutiveDays: 0 };
  const candidate = asiLabel(value);
  const previous = previousLabels.slice(0, 2);
  const consecutiveDays = previous[0] === candidate
    ? 1 + (previous[1] === candidate ? 1 : 0) : 1;
  const confirmed = consecutiveDays >= 3 ? candidate : previousConfirmed;
  return { candidate, confirmed, consecutiveDays };
}

function tierAsi(
  coins: { series: RotationPriceSeries; ret30: number; btc30: number }[],
): { asi: number | null; eligible: number; wins: number } {
  const eligible = coins.filter(({ series }) => series.rank != null);
  if (!eligible.length || !Number.isFinite(eligible[0]?.btc30)) {
    return { asi: null, eligible: eligible.length, wins: 0 };
  }
  const wins = eligible.filter(({ ret30, btc30 }) => ret30 > btc30).length;
  return { asi: eligible.length ? (wins / eligible.length) * 100 : null, eligible: eligible.length, wins };
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0, xx = 0, yy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    numerator += dx * dy; xx += dx * dx; yy += dy * dy;
  }
  return xx > 0 && yy > 0 ? numerator / Math.sqrt(xx * yy) : null;
}

function ranks(values: number[]): number[] {
  return values.map(value => {
    const less = values.filter(other => other < value).length;
    const equal = values.filter(other => other === value).length;
    return less + (equal - 1) / 2 + 1;
  });
}

function assetRiskMetrics(series: RotationPriceSeries, asOf: number) {
  const points = validPoints(series.points, asOf);
  const current = priceAtOrBefore(points, asOf);
  const start = priceAtOrBefore(points, asOf - 20 * DAY);
  const recent = points.filter(point => point.t >= asOf - 21 * DAY);
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) returns.push(recent[i].price / recent[i - 1].price - 1);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const vol = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252)
    : null;
  const ret20 = current && start ? current / start - 1 : null;
  return {
    ret20,
    realizedVol: vol,
    riskAdjustedReturn: ret20 != null && vol != null && vol > 1e-9 && returns.length >= 10 ? ret20 / vol : null,
  };
}

function avgNonNull(values: (number | null)[]): number | null {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
}

function computeLadder(
  input: {
    coins: RotationPriceSeries[];
    memeSeries: RotationPriceSeries[];
    equity: Record<string, RotationPriceSeries>;
    memeIds: Set<string>;
  },
  asOf: number,
) {
  const allCoins = [...new Map([...input.coins, ...input.memeSeries].map(coin => [coin.id, coin])).values()];
  const coinById = new Map(allCoins.map(coin => [coin.id, coin]));
  const named = (symbol: string) => Object.values(input.equity).find(row => row.symbol.toUpperCase() === symbol);
  const assets = [
    { name: "BIL", series: named("BIL") ? [named("BIL")!] : [] },
    { name: "TLT", series: named("TLT") ? [named("TLT")!] : [] },
    { name: "SPY", series: named("SPY") ? [named("SPY")!] : [] },
    { name: "QQQ", series: named("QQQ") ? [named("QQQ")!] : [] },
    { name: "BTC", series: allCoins.filter(row => row.symbol.toLowerCase() === "btc") },
    { name: "ETH", series: allCoins.filter(row => row.symbol.toLowerCase() === "eth") },
    { name: "LARGE_ALTS", series: allCoins.filter(row => row.rank != null && row.rank >= 2 && row.rank <= 10 && row.symbol.toLowerCase() !== "eth") },
    { name: "MID_ALTS", series: allCoins.filter(row => row.rank != null && row.rank >= 11 && row.rank <= 50) },
    { name: "SMALL_ALTS", series: allCoins.filter(row => row.rank != null && row.rank >= 51 && row.rank <= 100) },
    { name: "MEMES_TOP20", series: [...input.memeIds].flatMap(id => coinById.has(id) ? [coinById.get(id)!] : []) },
  ];
  const rungs = assets.map((asset, index) => {
    const metrics = asset.series.map(series => assetRiskMetrics(series, asOf));
    const return20d = avgNonNull(metrics.map(row => row.ret20));
    const realizedVol = avgNonNull(metrics.map(row => row.realizedVol));
    return {
      index,
      name: asset.name,
      constituentCount: asset.series.length,
      return20d,
      realizedVol,
      riskAdjustedReturn: return20d != null && realizedVol != null && realizedVol > 1e-9
        ? return20d / realizedVol : null,
    };
  });
  const valid = rungs.filter(rung => rung.riskAdjustedReturn != null);
  const slope = valid.length >= 3
    ? pearson(ranks(valid.map(rung => rung.index)), ranks(valid.map(rung => rung.riskAdjustedReturn!)))
    : null;
  const leader = [...valid].sort((a, b) => b.riskAdjustedReturn! - a.riskAdjustedReturn!)[0] ?? null;
  const btcIndex = rungs.findIndex(rung => rung.name === "BTC");
  let rotationDepth: number | null = null;
  if (rungs[btcIndex]?.riskAdjustedReturn != null) {
    rotationDepth = 0;
    let prior = rungs[btcIndex].riskAdjustedReturn!;
    for (let i = btcIndex + 1; i < rungs.length; i++) {
      const score = rungs[i].riskAdjustedReturn;
      if (score == null || score <= prior) break;
      rotationDepth++;
      prior = score;
    }
  }
  return {
    rungs,
    slope,
    appetite: slope == null ? "UNAVAILABLE" : slope > 0 ? "EXPANDING_RISK" : "FLIGHT_TO_SAFETY",
    leadership: leader ? { rung: leader.name, riskAdjustedReturn: leader.riskAdjustedReturn } : null,
    rotationDepthFromBtc: rotationDepth,
  };
}

export function computeSentiment(
  asOf: string | number,
  current: SentimentComponents,
  history: SentimentComponentHistory,
) {
  const cutoff = typeof asOf === "number" ? asOf : Date.parse(asOf);
  const weights: Record<keyof SentimentComponents, number> = {
    fundingOiWeighted7d: 0.25,
    aggregateOiChange30d: 0.15,
    memeExcess30d: 0.20,
    fearGreed: 0.15,
    stableDominanceChange30d: 0.15,
    smallCapAsi: 0.10,
  };
  const components = Object.entries(weights).map(([key, weight]) => {
    const name = key as keyof SentimentComponents;
    const value = current[name];
    const observations = (history[name] ?? []).filter(Number.isFinite);
    if (value == null || !Number.isFinite(value) || observations.length < 30) {
      return { name, value, percentile: null, weight, stale: true, reason: value == null ? "source_unavailable" : "history_warming" };
    }
    const rawPercentile = observations.filter(point => point <= value).length / observations.length * 100;
    const percentile = name === "stableDominanceChange30d" ? 100 - rawPercentile : rawPercentile;
    return { name, value, percentile, weight, stale: false, reason: null };
  });
  const usable = components.filter(row => row.percentile != null);
  const totalWeight = usable.reduce((sum, row) => sum + row.weight, 0);
  const score = totalWeight > 0
    ? usable.reduce((sum, row) => sum + row.percentile! * row.weight, 0) / totalWeight
    : null;
  const historyReady = components.every(row => row.percentile != null);
  const label = score == null ? null
    : score <= ROTATION_CONFIG.sentimentBands.panicMax ? "PANIC"
    : score <= ROTATION_CONFIG.sentimentBands.fearMax ? "FEAR"
    : score <= ROTATION_CONFIG.sentimentBands.normalMax ? "NORMAL"
    : score <= ROTATION_CONFIG.sentimentBands.greedMax ? "GREED"
    : "EUPHORIA";
  return {
    score,
    label,
    status: historyReady ? "ready" : "warming_up",
    availableComponents: usable.length,
    components,
  };
}

export function computeCryptoRotation(input: {
  asOf: string;
  coins: RotationPriceSeries[];
  totalMarketCap: number | null;
  stablecoins: { id: string; symbol: string; marketCap: number | null }[];
  priorDominance: { btcExStables: number | null; stable: number | null } | null;
  previousAsiLabels?: (string | null)[];
  previousConfirmedAsiLabel?: string | null;
  equitySeries?: Record<string, RotationPriceSeries>;
  memeIds?: string[];
  memeSeries?: RotationPriceSeries[];
  sentimentHistory?: SentimentComponentHistory;
  fundingOiHistory?: { timestamp: string; fundingOiWeighted: number | null; aggregateOi: number | null }[];
  fearGreedHistory?: number[];
}) {
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error("Crypto rotation requires a valid as-of timestamp");
  const cleanCoins = input.coins.map(coin => ({ ...coin, points: validPoints(coin.points, asOf) }));
  const btc = cleanCoins.find(coin => coin.symbol.toLowerCase() === "btc" || coin.id === "bitcoin");
  const btcReturns = btc ? Object.fromEntries([30, 60, 90].map(days => [days, returnAt(btc, asOf, days)])) : {};
  const alts = cleanCoins.filter(coin => coin.rank != null && coin.rank >= 2 && coin.rank <= 100
    && coin.symbol.toLowerCase() !== "btc");
  const eligibility = alts.flatMap(series => {
    const returns = [30, 60, 90].map(days => returnAt(series, asOf, days));
    if (returns.some(value => value == null)) return [];
    return [{
      series,
      ret30: returns[0]!,
      ret60: returns[1]!,
      ret90: returns[2]!,
      excess90: returns[2]! - (btcReturns[90] ?? 0),
    }];
  });
  const asi30 = tierAsi(eligibility.map(row => ({ series: row.series, ret30: row.ret30, btc30: btcReturns[30] ?? Infinity })));
  const asi60Wins = eligibility.filter(row => row.ret60 > (btcReturns[60] ?? Infinity)).length;
  const asi90Wins = eligibility.filter(row => row.ret90 > (btcReturns[90] ?? Infinity)).length;
  const asi60 = { asi: eligibility.length && btcReturns[60] != null ? asi60Wins / eligibility.length * 100 : null, eligible: eligibility.length, wins: asi60Wins };
  const asi90 = { asi: eligibility.length && btcReturns[90] != null ? asi90Wins / eligibility.length * 100 : null, eligible: eligibility.length, wins: asi90Wins };
  const composite = asi30.asi != null && asi60.asi != null && asi90.asi != null
    ? asi30.asi * ROTATION_CONFIG.asiWeights.day30
      + asi60.asi * ROTATION_CONFIG.asiWeights.day60
      + asi90.asi * ROTATION_CONFIG.asiWeights.day90
    : null;
  const weightedWins = eligibility.reduce((sum, row) => sum + (row.ret90 > (btcReturns[90] ?? Infinity) ? Math.max(0, row.series.marketCap ?? 0) : 0), 0);
  const totalEligibleCap = eligibility.reduce((sum, row) => sum + Math.max(0, row.series.marketCap ?? 0), 0);
  const capWeightedAsi90 = totalEligibleCap > 0 ? weightedWins / totalEligibleCap * 100 : null;
  const btcMomentum = asi30.asi != null && asi90.asi != null ? asi30.asi - asi90.asi : null;
  const tier = (min: number, max: number) => {
    const rows = eligibility.filter(row => row.series.rank! >= min && row.series.rank! <= max);
    const byWindow = ([30, 60, 90] as const).map(days => {
      const wins = rows.filter(row => row[`ret${days}`] > (btcReturns[days] ?? Infinity)).length;
      return { asi: rows.length && btcReturns[days] != null ? wins / rows.length * 100 : null, wins };
    });
    const composite = byWindow.every(row => row.asi != null)
      ? byWindow[0].asi! * ROTATION_CONFIG.asiWeights.day30
        + byWindow[1].asi! * ROTATION_CONFIG.asiWeights.day60
        + byWindow[2].asi! * ROTATION_CONFIG.asiWeights.day90
      : null;
    return {
      asi30: byWindow[0].asi, asi60: byWindow[1].asi, asi90: byWindow[2].asi,
      composite, eligible: rows.length, wins: byWindow[2].wins,
    };
  };
  const smallTier = tier(51, 100);
  const labelState = stabilizeAsiLabel(
    composite,
    input.previousAsiLabels ?? [],
    input.previousConfirmedAsiLabel ?? null,
  );
  const btcMarketCap = btc?.marketCap ?? null;
  const usdtUsdcMcap = input.stablecoins
    .filter(coin => ["usdt", "usdc"].includes(coin.symbol.toLowerCase()) || ["tether", "usd-coin"].includes(coin.id))
    .reduce((sum, coin) => sum + Math.max(0, coin.marketCap ?? 0), 0);
  const allStableMcap = input.stablecoins.reduce((sum, coin) => sum + Math.max(0, coin.marketCap ?? 0), 0);
  const totalMcap = input.totalMarketCap != null && input.totalMarketCap > 0 ? input.totalMarketCap : null;
  const rawDominance = totalMcap && btcMarketCap != null ? btcMarketCap / totalMcap * 100 : null;
  const dominanceExStables = totalMcap && btcMarketCap != null && allStableMcap < totalMcap
    ? btcMarketCap / (totalMcap - allStableMcap) * 100 : null;
  const stableDominance = totalMcap && usdtUsdcMcap > 0 ? usdtUsdcMcap / totalMcap * 100 : null;
  const dominanceChange30Pp = dominanceExStables != null && input.priorDominance?.btcExStables != null
    ? dominanceExStables - input.priorDominance.btcExStables : null;
  const stableDominanceChange30d = stableDominance != null && input.priorDominance?.stable != null
    ? stableDominance - input.priorDominance.stable : null;
  const dominanceRegime = dominanceChange30Pp == null ? "WARMING_UP"
    : dominanceChange30Pp > ROTATION_CONFIG.dominanceThresholdPp ? "STRONG_BTC"
    : dominanceChange30Pp < -ROTATION_CONFIG.dominanceThresholdPp ? "ALT_ROTATION" : "NEUTRAL";
  const confirmedAltSeason = labelState.confirmed === "ALT_SEASON"
    && (dominanceRegime === "ALT_ROTATION" || (dominanceRegime === "NEUTRAL" && dominanceChange30Pp! < 0));

  const eth = cleanCoins.find(coin => coin.symbol.toLowerCase() === "eth" || coin.id === "ethereum");
  let ethBtc: any = { ratio: null, return30d: null, above50d: null, above200d: null, leadership: "UNAVAILABLE", narrowRally: false };
  if (btc && eth) {
    const ratios: PricePoint[] = [];
    for (let days = 0; days <= 220; days++) {
      const target = asOf - days * DAY;
      const btcPrice = priceAtOrBefore(btc.points, target);
      const ethPrice = priceAtOrBefore(eth.points, target);
      if (btcPrice && ethPrice) ratios.push({ t: target, price: ethPrice / btcPrice });
    }
    ratios.sort((a, b) => a.t - b.t);
    const currentRatio = priceAtOrBefore(ratios, asOf);
    const ratio30ago = priceAtOrBefore(ratios, asOf - 30 * DAY);
    const meanFor = (days: number) => {
      const values = ratios.filter(point => point.t <= asOf && point.t >= asOf - days * DAY).map(point => point.price);
      return values.length >= days * 0.8 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    const avg50 = meanFor(50), avg200 = meanFor(200);
    const ret30 = currentRatio && ratio30ago ? currentRatio / ratio30ago - 1 : null;
    const above50 = currentRatio != null && avg50 != null ? currentRatio > avg50 : null;
    const above200 = currentRatio != null && avg200 != null ? currentRatio > avg200 : null;
    const leadership = ret30 != null && above50 === true && ret30 > 0.05 ? "LEADING"
      : ret30 != null && above50 === false && ret30 < -0.05 ? "LAGGING" : "NEUTRAL";
    ethBtc = {
      ratio: currentRatio,
      return30d: ret30,
      above50d: above50,
      above200d: above200,
      leadership,
      narrowRally: labelState.confirmed === "ALT_SEASON" && leadership === "LAGGING",
    };
  }

  const fundingRows = (input.fundingOiHistory ?? [])
    .filter(row => Date.parse(row.timestamp) <= asOf && Number.isFinite(Date.parse(row.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const fundingLast7 = fundingRows.slice(-7);
  const fundingOiWeighted7d = fundingLast7.length === 7 && fundingLast7.every(row => row.fundingOiWeighted != null)
    ? fundingLast7.reduce((sum, row) => sum + row.fundingOiWeighted!, 0) / 7 : null;
  const oiCurrent = fundingRows.at(-1)?.aggregateOi ?? null;
  const oi30 = fundingRows.length >= 31 ? fundingRows.at(-31)?.aggregateOi ?? null : null;
  const aggregateOiChange30d = oiCurrent != null && oi30 != null && oi30 > 0 ? oiCurrent / oi30 - 1 : null;
  const memeIds = new Set(input.memeIds ?? []);
  const memeSeries = [...new Map((input.memeSeries ?? []).map(row => [row.id, row])).values()];
  const memeExcess30dValues = memeSeries
    .filter(row => memeIds.has(row.id))
    .flatMap(row => {
      const ret = returnAt(row, asOf, 30);
      return ret != null && btcReturns[30] != null ? [ret - btcReturns[30]!] : [];
    });
  const memeExcess30d = avgNonNull(memeExcess30dValues);
  const currentSentiment: SentimentComponents = {
    fundingOiWeighted7d,
    aggregateOiChange30d,
    memeExcess30d,
    fearGreed: input.fearGreedHistory?.at(-1) ?? null,
    stableDominanceChange30d,
    smallCapAsi: smallTier.composite,
  };
  const sentimentHistory: SentimentComponentHistory = { ...(input.sentimentHistory ?? {}) };
  if (input.fearGreedHistory) sentimentHistory.fearGreed = input.fearGreedHistory.slice(0, -1);
  const sentiment = computeSentiment(asOf, currentSentiment, sentimentHistory);
  const ladder = computeLadder({
    coins: cleanCoins,
    memeSeries,
    equity: input.equitySeries ?? {},
    memeIds,
  }, asOf);

  return {
    status: eligibility.length ? "partial" : "warming_up",
    asOf: new Date(asOf).toISOString(),
    asi: {
      day30: asi30,
      day60: asi60,
      day90: asi90,
      composite,
      capWeighted90: capWeightedAsi90,
      momentum30Minus90: btcMomentum,
      medianExcess90: median(eligibility.map(row => row.excess90)),
      tiers: { ranks2to10: tier(2, 10), ranks11to50: tier(11, 50), ranks51to100: smallTier },
      candidateLabel: labelState.candidate,
      confirmedLabel: labelState.confirmed,
      candidateConsecutiveDays: labelState.consecutiveDays,
      eligible: eligibility.length,
      excludedInsufficientHistory: alts.length - eligibility.length,
    },
    dominance: {
      raw: rawDominance,
      exStables: dominanceExStables,
      change30dPp: dominanceChange30Pp,
      regime: dominanceRegime,
      usdtUsdcShare: stableDominance,
      stableShareChange30dPp: stableDominanceChange30d,
      altSeasonConfirmed: confirmedAltSeason,
      divergence: labelState.confirmed === "ALT_SEASON" && !confirmedAltSeason,
    },
    ethBtc,
    ladder,
    sentiment,
    currentSentiment,
    returns: eligibility.map(row => ({
      coinId: row.series.id,
      ret30: row.ret30,
      ret60: row.ret60,
      ret90: row.ret90,
      beatBtc30: row.ret30 > (btcReturns[30] ?? Infinity),
      beatBtc60: row.ret60 > (btcReturns[60] ?? Infinity),
      beatBtc90: row.ret90 > (btcReturns[90] ?? Infinity),
    })),
    btcReturns,
    fundingOiCurrent: fundingRows.at(-1) ?? null,
    stableMcap: allStableMcap,
    btcMcap: btcMarketCap,
    totalMcap,
  };
}
