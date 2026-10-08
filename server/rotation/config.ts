export const ROTATION_CONFIG = {
  source: {
    coinGeckoBaseUrl: "https://api.coingecko.com/api/v3",
    timeoutMs: 12_000,
    maxRetries: 2,
    retryBaseMs: 900,
    freshTtlSeconds: {
      markets: 20 * 60 * 60,
      global: 60 * 60,
      stablecoins: 20 * 60 * 60,
      memes: 20 * 60 * 60,
      history: 12 * 60 * 60,
      fmp: 15 * 60,
      fred: 6 * 60 * 60,
      etfFlows: 24 * 60 * 60,
      fundingOi: 60 * 60,
      fearGreed: 24 * 60 * 60,
    },
    staleCacheTtlSeconds: 7 * 24 * 60 * 60,
    requestTimeoutMs: 12_000,
    topUniverseSize: 100,
    stablecoinPageSize: 250,
    memeBasketSize: 20,
    fmpMacroSymbols: [
      "DX-Y.NYB", "^VIX", "^TNX", "^IRX", "GCUSD", "CLUSD",
      "^NDX", "NQ=F", "SPY", "QQQ", "TLT", "BIL",
    ],
      fredSeries: ["WALCL", "WTREGEN", "RRPONTSYD", "DFF", "DGS2"],
    perpSymbols: ["BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK"],
    farsideBitcoinEtfUrl: "https://farside.co.uk/btc/",
  },
  windows: { asiDays: [30, 60, 90], macroChangeDays: 20, macroZScoreDays: 252, sentimentDays: 365, ladderDays: 20 },
  asiWeights: { day30: 0.4, day60: 0.3, day90: 0.3 },
  asiBands: { strongBtcMax: 24, btcBiasMax: 44, neutralMax: 55, altBiasMax: 74 },
  dominanceThresholdPp: 3,
  macroWeights: {
    netLiquidity: 0.2, dxy: 0.15, treasury10y: 0.15, vix: 0.15,
    btcEtfFlows: 0.15, nasdaq: 0.1, wti: 0.05, fedPolicyProxy: 0.05,
  },
  riskScoreClip: 3,
  sentimentBands: { panicMax: 20, fearMax: 40, normalMax: 60, greedMax: 80 },
  ladder: { minSlope: -1, maxSlope: 1, rungCount: 10 },
  cache: { marketStateKey: "rotation:market_state:latest", marketStateTtlSeconds: 15 * 60 },
  exclusions: {
    stableSymbols: [
      "usdt", "usdc", "dai", "fdusd", "tusd", "usde", "pyusd", "usdd", "frax",
      "lusd", "susde", "usdp", "usdn", "eurc", "eurs", "usdtb", "usds", "usyc",
    ],
    wrappedSymbols: [
      "wbtc", "weth", "cbbtc", "tbtc", "steth", "wsteth", "reth", "cbeth",
      "weeth", "jitosol", "msol", "bsweth", "sfrxeth", "ankreth", "wbnb",
      "wavax", "wsol", "wftm",
    ],
    peggedSymbols: ["paxg", "xaut"],
    commodityPeggedSymbols: ["paxg", "xaut", "dgld", "kag", "kinesis-gold", "kinesis-silver"],
    exchangeIssuedYieldSymbols: [
      "bnb", "okb", "cro", "leo", "gt", "kcs", "ht", "mx", "bit", "wbt",
      "ftt", "bgb", "gate-token", "kucoin-shares", "huobi-token",
    ],
    stakingSymbols: [
      "steth", "wsteth", "reth", "cbeth", "weeth", "jitosol", "msol", "sfrxeth",
      "ankreth", "oseth", "sweth", "ezeth", "rsweth", "meth", "rseth",
    ],
  },
} as const;

export type RotationConfig = typeof ROTATION_CONFIG;
