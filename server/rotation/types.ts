export interface RotationSourceResult<T> {
  data: T | null;
  asOf: string | null;
  stale: boolean;
  lastGoodAt?: string;
  error?: string;
}

export interface RotationSourceAdapter<T> {
  fetch(date?: string): Promise<RotationSourceResult<T>>;
}

export interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  last_updated?: string | null;
}

export interface CoinGeckoGlobal {
  data: {
    total_market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    market_cap_percentage?: Record<string, number>;
    updated_at?: number;
  };
}

export interface RotationCryptoSources {
  markets: RotationSourceResult<CoinGeckoMarket[]>;
  global: RotationSourceResult<CoinGeckoGlobal>;
  stablecoins: RotationSourceResult<CoinGeckoMarket[]>;
  memes: RotationSourceResult<CoinGeckoMarket[]>;
}

export interface RotationMacroQuote {
  symbol: string;
  price: number;
  changePercent: number | null;
  asOf: string;
}

export interface RotationMacroQuotes {
  quotes: RotationMacroQuote[];
  unavailableSymbols: string[];
}

export interface RotationFredObservation {
  date: string;
  value: number | null;
}

export interface RotationFredSeries {
  seriesId: string;
  observations: RotationFredObservation[];
}

export interface RotationFredData {
  series: RotationFredSeries[];
  unavailableSeries: string[];
}

export interface RotationEtfFlowRow {
  date: string;
  totalNetFlowUsd: number | null;
}

export interface RotationEtfFlows {
  provider: "farside" | "sosovalue";
  rows: RotationEtfFlowRow[];
}

export interface RotationPerpMarket {
  symbol: string;
  fundingRatePct: number;
  openInterestUsd: number;
  price: number;
  asOf: string;
}

export interface RotationFearGreed {
  value: number;
  classification: string;
  asOf: string;
}

export interface RotationAllSources extends RotationCryptoSources {
  fmp: RotationSourceResult<RotationMacroQuotes>;
  fred: RotationSourceResult<RotationFredData>;
  etfFlows: RotationSourceResult<RotationEtfFlows>;
  fundingOi: RotationSourceResult<RotationPerpMarket[]>;
  fearGreed: RotationSourceResult<RotationFearGreed>;
}

export type CoinGeckoSourcePayload = RotationCryptoSources;
