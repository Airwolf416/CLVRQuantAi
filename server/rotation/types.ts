export interface RotationSourceResult<T> {
  data: T | null;
  asOf: string | null;
  stale: boolean;
  lastGoodAt?: string;
  error?: string;
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
