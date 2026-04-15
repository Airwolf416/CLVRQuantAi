// ── Asset symbol configuration for CLVRQuantAI ───────────────────────────────
// Single source of truth for all symbol arrays, maps, and base prices.
// Import from here instead of defining inline in routes.ts.

export const CRYPTO_SYMS = [
  "BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","PEPE","XRP",
  "BNB","ADA","DOT","POL","UNI","AAVE","NEAR","SUI","APT","OP",
  "TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE",
];

export const CRYPTO_BASE: Record<string, number> = {
  BTC:84000,ETH:1590,SOL:130,WIF:0.82,DOGE:0.168,AVAX:20.1,LINK:12.8,ARB:0.38,
  PEPE:0.0000072,XRP:2.1,BNB:600,ADA:0.65,DOT:6.5,POL:0.55,UNI:9.5,AAVE:220,
  NEAR:4.5,SUI:2.8,APT:8.2,OP:1.8,TIA:5.2,SEI:0.35,JUP:0.85,ONDO:1.2,
  RENDER:6.5,INJ:18,FET:1.5,TAO:380,PENDLE:3.8,HBAR:0.18,TRUMP:3.5,HYPE:31,
};

export const BINANCE_MAP: Record<string, string> = {
  BTC:"BTCUSDT",ETH:"ETHUSDT",SOL:"SOLUSDT",WIF:"WIFUSDT",DOGE:"DOGEUSDT",
  AVAX:"AVAXUSDT",LINK:"LINKUSDT",ARB:"ARBUSDT",PEPE:"PEPEUSDT",XRP:"XRPUSDT",
  BNB:"BNBUSDT",ADA:"ADAUSDT",DOT:"DOTUSDT",POL:"POLUSDT",UNI:"UNIUSDT",AAVE:"AAVEUSDT",
  NEAR:"NEARUSDT",SUI:"SUIUSDT",APT:"APTUSDT",OP:"OPUSDT",TIA:"TIAUSDT",
  SEI:"SEIUSDT",JUP:"JUPUSDT",ONDO:"ONDOUSDT",RENDER:"RENDERUSDT",FET:"FETUSDT",
  HBAR:"HBARUSDT",TRUMP:"TRUMPUSDT",HYPE:"HYPEUSDT",
};

export const BINANCE_SYMS = Object.values(BINANCE_MAP);

export const HL_PERP_SYMS = [
  "BTC","ETH","SOL","WIF","DOGE","AVAX","LINK","ARB","kPEPE","XRP",
  "BNB","ADA","DOT","POL","UNI","AAVE","NEAR","SUI","APT","OP",
  "TIA","SEI","JUP","ONDO","RENDER","INJ","FET","TAO","PENDLE","HBAR","TRUMP","HYPE",
];

export const HL_TO_APP: Record<string, string> = { kPEPE: "PEPE" };
export const APP_TO_HL: Record<string, string> = { PEPE: "kPEPE" };

// Hyperliquid perp price scaling — kXXX tokens are quoted per 1000 tokens.
// Multiply the raw markPx/perpPrice by this factor to get the per-token USD price.
export const HL_SCALE_FACTORS: Record<string, number> = {
  kPEPE: 0.001, // 1 kPEPE contract = 1000 PEPE → price_per_PEPE = markPx × 0.001
};

// Must match the frontend MarketTab EQUITY_SYMS exactly
export const EQUITY_SYMS = [
  "TSLA","NVDA","AAPL","GOOGL","META","MSFT","AMZN","MSTR","AMD","PLTR",
  "COIN","NFLX","HOOD","ORCL","TSM","GME","RIVN","BABA","HIMS","CRCL",
];

export const EQUITY_BASE: Record<string, number> = {
  TSLA:248,NVDA:103,AAPL:209,GOOGL:155,META:558,MSFT:388,AMZN:192,
  MSTR:310,AMD:145,PLTR:70,COIN:210,NFLX:850,HOOD:41,ORCL:148,
  TSM:180,GME:27,RIVN:13,BABA:131,HIMS:26,CRCL:25,
  // basket-only extras kept for fallback
  SQ:66,SHOP:95,CRM:290,DIS:105,JPM:240,V:328,XOM:113,WMT:90,BAC:44,
};

export const EQUITY_FH_MAP: Record<string, string> = {};

export const METALS_BASE: Record<string, number> = {
  XAU:4495, XAG:70, WTI:100, BRENT:105, NATGAS:3.0, COPPER:5.49, PLATINUM:1870,
};

export const BASKET_YAHOO_MAP: Record<string, string> = {
  // Crypto
  BTC:"BTC-USD",ETH:"ETH-USD",SOL:"SOL-USD",XRP:"XRP-USD",DOGE:"DOGE-USD",
  AVAX:"AVAX-USD",LINK:"LINK-USD",BNB:"BNB-USD",ADA:"ADA-USD",SUI:"SUI-USD",
  DOT:"DOT-USD",HYPE:"HYPE11-USD",
  // US Equities
  AAPL:"AAPL",NVDA:"NVDA",MSFT:"MSFT",GOOGL:"GOOGL",AMZN:"AMZN",
  META:"META",TSLA:"TSLA",MSTR:"MSTR",AMD:"AMD",PLTR:"PLTR",
  COIN:"COIN",NFLX:"NFLX",JPM:"JPM",V:"V",XOM:"XOM",
  WMT:"WMT",BAC:"BAC",UNH:"UNH",DIS:"DIS",CRM:"CRM",
  // Canada TSX
  RY:"RY.TO",TD:"TD.TO",CNQ:"CNQ.TO",SU:"SU.TO",BCE:"BCE.TO",
  // Europe
  ASML:"ASML",SAP:"SAP",NESN:"NESN.SW",LVMH:"MC.PA",
  SHEL:"SHEL",HSBA:"HSBA.L",AZN:"AZN",NVO:"NVO",
  SIEGY:"SIEGY",TTE:"TTE",BP:"BP",ULVR:"ULVR.L",
  // Middle East
  "2222.SR":"2222.SR","2010.SR":"2010.SR",
  QNBK:"QNBK.QA",EMIRATESNBD:"ENBD.DU",ADNOCDIST:"ADNOCDIST.AD",ETISALAT:"ETISALAT.AD",
  // Asia
  TSM:"TSM",BABA:"BABA",TCEHY:"TCEHY",
  "005930":"005930.KS","9984.T":"9984.T","7203.T":"7203.T",
  "7974.T":"7974.T","0700.HK":"0700.HK",
  PDD:"PDD",JD:"JD",RELIANCE:"RELIANCE.NS",INFY:"INFY",
  // Commodities (futures / ETFs)
  XAU:"GC=F",XAG:"SI=F",WTI:"CL=F",BRENT:"BZ=F",
  NATGAS:"NG=F",COPPER:"HG=F",PLATINUM:"PL=F",PALLADIUM:"PA=F",
  WHEAT:"ZW=F",CORN:"ZC=F",SOYBEANS:"ZS=F",
  COFFEE:"KC=F",SUGAR:"SB=F",
  URANIUM:"URA",DUBAI:"BZ=F",LNG:"UNG",
};

// ENERGY_ETF_MAP is intentionally empty — energy spot prices come from Finnhub
// via OANDA CFD symbols (OANDA:WTICO_USD, OANDA:XBR_USD, OANDA:NATGAS_USD)
// through both the WebSocket feed (COMMODITY_FH_SYMS in routes.ts) and the
// REST fallback in fetchEnergyCommodities() in marketData.ts.
export const ENERGY_ETF_MAP: Record<string, { etfSym: string; factor: number }> = {};

// OANDA CFD symbols for real-time energy spot prices via Finnhub WebSocket.
// Values are the app-level symbol names stored in livePrices / cache["finnhub"].data.metals.
export const COMMODITY_FH_SYMS: Record<string, string> = {
  "OANDA:WTICO_USD":  "WTI",
  "OANDA:XBR_USD":    "BRENT",
  "OANDA:NATGAS_USD": "NATGAS",
};

// ── Basket page data ──────────────────────────────────────────────────────────

export const BASKET_EQUITIES_US = [
  "AAPL","NVDA","MSFT","GOOGL","AMZN","META","TSLA","MSTR","AMD","PLTR",
  "COIN","NFLX","JPM","V","XOM","WMT","BAC","UNH","DIS","CRM",
  "RY","TD","CNQ","SU","BCE",
  "ASML","SAP","AZN","NVO","SHEL","TTE","BP","SIEGY","TCEHY",
  "TSM","BABA","PDD","JD","INFY",
];

export const BASKET_INTL_FH: Record<string, { fhTick: string; currency: string }> = {
  NESN:{fhTick:"NESN.SW",currency:"CHF"},LVMH:{fhTick:"MC.PA",currency:"EUR"},
  HSBA:{fhTick:"HSBA.L",currency:"GBP"},ULVR:{fhTick:"ULVR.L",currency:"GBP"},
  "2222.SR":{fhTick:"2222.SR",currency:"SAR"},"2010.SR":{fhTick:"2010.SR",currency:"SAR"},
  QNBK:{fhTick:"QNBK.QA",currency:"QAR"},EMIRATESNBD:{fhTick:"ENBD.DU",currency:"AED"},
  ADNOCDIST:{fhTick:"ADNOCDIST.AD",currency:"AED"},ETISALAT:{fhTick:"ETISALAT.AD",currency:"AED"},
  "005930":{fhTick:"005930.KS",currency:"KRW"},"9984.T":{fhTick:"9984.T",currency:"JPY"},
  "7203.T":{fhTick:"7203.T",currency:"JPY"},"7974.T":{fhTick:"7974.T",currency:"JPY"},
  "0700.HK":{fhTick:"0700.HK",currency:"HKD"},RELIANCE:{fhTick:"RELIANCE.NS",currency:"INR"},
};

// Commodity basket entries.
// Precious metals + energy use metalsKey → looked up in cache["finnhub"].data.metals.
// Ag commodities use etfSym → fetched via Finnhub WS or REST quote.
export const BASKET_COMMODITIES: Record<string, { metalsKey?: string; etfSym?: string; base: number }> = {
  XAU:{metalsKey:"XAU",base:4495},XAG:{metalsKey:"XAG",base:70},
  PLATINUM:{metalsKey:"PLATINUM",base:1870},PALLADIUM:{metalsKey:"PALLADIUM",base:1380},
  COPPER:{metalsKey:"COPPER",base:5.49},WTI:{metalsKey:"WTI",base:100},
  BRENT:{metalsKey:"BRENT",base:105},NATGAS:{metalsKey:"NATGAS",base:3.0},
  WHEAT:{etfSym:"WEAT",base:5.8},CORN:{etfSym:"CORN",base:22},
  SOYBEANS:{etfSym:"SOYB",base:24},COFFEE:{etfSym:"JO",base:45},
  SUGAR:{etfSym:"SGG",base:35},URANIUM:{etfSym:"URA",base:28},
  DUBAI:{etfSym:"BNO",base:35},LNG:{etfSym:"UNG",base:10},
};

export const FOREX_BASE: Record<string, number> = {
  EURUSD:1.0842,GBPUSD:1.2715,USDJPY:149.82,USDCHF:0.9012,
  AUDUSD:0.6524,USDCAD:1.3654,NZDUSD:0.5932,EURGBP:0.8526,
  EURJPY:162.45,GBPJPY:190.52,USDMXN:17.15,USDZAR:18.45,USDTRY:32.5,USDSGD:1.34,
};

export const BASKET_PRICE_TTL = 5 * 60 * 1000;

export const BACKTEST_WIN_RATES: Record<string, number> = {
  "LONG_pattern_bull_flag_NY": 0.68,     "LONG_pattern_double_bottom_NY": 0.66,
  "LONG_pattern_bull_flag_LONDON": 0.65, "LONG_pattern_double_bottom_LONDON": 0.62,
  "LONG_pattern_bull_flag_ASIAN": 0.57,  "LONG_pattern_double_bottom_ASIAN": 0.55,
  "SHORT_pattern_head_shoulders_NY": 0.67,"SHORT_pattern_double_top_NY": 0.65,
  "SHORT_pattern_bear_flag_NY": 0.64,    "SHORT_pattern_head_shoulders_LONDON": 0.63,
  "SHORT_pattern_double_top_LONDON": 0.61,"SHORT_pattern_bear_flag_LONDON": 0.60,
  "LONG_DEFAULT_NY": 0.57,   "LONG_DEFAULT_LONDON": 0.55,   "LONG_DEFAULT_ASIAN": 0.52,
  "SHORT_DEFAULT_NY": 0.56,  "SHORT_DEFAULT_LONDON": 0.54,  "SHORT_DEFAULT_ASIAN": 0.51,
};

export const SESSION_THRESHOLDS: Record<string, { minMove: number; minVolMult: number; minOI: number }> = {
  ASIAN:   { minMove: 1.2, minVolMult: 2.0, minOI: 5_000_000 },
  LONDON:  { minMove: 0.8, minVolMult: 1.5, minOI: 3_000_000 },
  NY:      { minMove: 0.8, minVolMult: 1.5, minOI: 3_000_000 },
  POST_NY: { minMove: 1.0, minVolMult: 2.0, minOI: 5_000_000 },
  DEFAULT: { minMove: 0.8, minVolMult: 1.5, minOI: 3_000_000 },
};

export const HIGH_IMPACT_KEYWORDS = [
  "FOMC","CPI","NFP","Non-Farm","Fed Rate","Interest Rate","GDP","PCE","PPI","Powell",
];

export const MOVE_WINDOW    = 5  * 60 * 1000;
export const SIGNAL_COOLDOWN= 10 * 60 * 1000;
export const AI_CACHE_TTL   = 5  * 60 * 1000;
