// Builds the `reasoning` array sent to the autoposter webhook.
//
// The downstream Telegram autoposter renders the reasoning array as the
// post body / caption (one line per array entry). It does NOT have any
// dedicated "caption" or "hashtags" fields in its payload contract — all
// human-readable copy travels as reasoning lines. This helper assembles
// a consistent, on-brand caption + hashtags so every Telegram trade idea
// (live signals, morning brief, manual test sends) has the same shape.
//
// Layout produced:
//   [0]  banner (e.g. "TEST POST" or "Morning Brief 6:00 AM ET")
//   [1]  setup line — "📈 BTC LONG setup — <thesis>"
//   [2]  optional broader market context (CLVR regime, news catalyst)
//   [3]  levels — "Entry: X | Stop: Y (Z% risk) | TP1: A | TP2: B"
//   [4]  R:R + confidence line
//   [5]  current price line (above / below entry)
//   [6]  risk disclaimer
//   [7]  hashtags joined with single spaces
//
// Numeric formatting: prices preserve 4 sig figs for sub-$1 tokens and
// up to 2 decimals for everything ≥ $1. We round percentages to 2 d.p.

export type ReasoningOpts = {
  token: string;
  dir: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  conf: number;                 // 0-100
  currentPrice?: number;        // optional — adds the "current price" line
  thesis?: string;              // 1-line setup rationale (recommended)
  marketContext?: string;       // optional — CLVR regime, macro catalyst, news flow
  banner?: string;              // optional override (defaults derived from `source`)
  source: "morning-brief" | "live-signal" | "manual-test";
  assetClass?: "crypto" | "equity" | "commodity" | "forex" | "unknown";
};

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 1)    return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

function inferAssetClass(token: string): "crypto" | "equity" | "commodity" | "forex" | "unknown" {
  const t = token.toUpperCase();
  if (/^(XAU|XAG|GOLD|SILVER|WTI|BRENT|NG|HG)$/i.test(t)) return "commodity";
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(t) || /^(EURUSD|GBPUSD|USDJPY|AUDUSD|USDCAD|NZDUSD|USDCHF|EURGBP|EURJPY)$/i.test(t)) return "forex";
  if (/^(BTC|ETH|SOL|DOGE|XRP|ADA|AVAX|LINK|MATIC|HYPE|TIA|OP|ARB|UNI|AAVE|NEAR|WIF|TRUMP|BNB|APT|DOT|HBAR|PENDLE|TAO|ONDO|SUI|INJ|SEI|JUP|RUNE|FET|RENDER|ATOM|LTC|BCH|ETC|FIL|ICP|VET|ALGO|XLM|TRX|SHIB|PEPE)$/i.test(t)) return "crypto";
  // 1-5 char uppercase ticker without slash → equity (NVDA, TSLA, AAPL, SPY...)
  if (/^[A-Z]{1,5}$/.test(t)) return "equity";
  return "unknown";
}

function bannerFor(source: ReasoningOpts["source"], custom?: string): string {
  if (custom) return custom;
  if (source === "morning-brief") return "🌅 CLVR Quant AI · Morning Brief Trade Idea";
  if (source === "manual-test")   return "🧪 TEST POST · CLVR Quant AI signal preview";
  return "⚡ CLVR Quant AI · Live Signal";
}

function hashtagsFor(token: string, dir: "LONG" | "SHORT", assetClass: "crypto" | "equity" | "commodity" | "forex" | "unknown"): string {
  const tagToken = token.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const base = [
    `#${tagToken}`,
    `#${dir}`,
    "#CLVRQuantAI",
    "#TradingSignals",
    "#TechnicalAnalysis",
    dir === "LONG" ? "#Bullish" : "#Bearish",
  ];
  const classTag =
    assetClass === "crypto"    ? ["#Crypto", "#CryptoTrading"] :
    assetClass === "equity"    ? ["#Stocks", "#StockMarket"] :
    assetClass === "commodity" ? ["#Commodities", "#Gold"] :
    assetClass === "forex"     ? ["#Forex", "#FX"] :
    [];
  return [...base, ...classTag].join(" ");
}

export function buildEnrichedReasoning(opts: ReasoningOpts): string[] {
  const {
    token, dir, entry, stopLoss, tp1, tp2, conf,
    currentPrice, thesis, marketContext, banner, source,
  } = opts;

  const assetClass = opts.assetClass || inferAssetClass(token);
  const stopPct = Math.abs((stopLoss - entry) / entry) * 100;
  const reward1 = Math.abs(tp1 - entry);
  const risk    = Math.abs(entry - stopLoss);
  const rrTp1   = risk > 0 ? reward1 / risk : 0;

  const dirEmoji = dir === "LONG" ? "📈" : "📉";

  const lines: string[] = [];
  lines.push(bannerFor(source, banner));
  lines.push(
    `${dirEmoji} ${token} ${dir} setup — ${thesis && thesis.trim().length > 0 ? thesis.trim() : "Momentum + structure aligned for a measured entry."}`
  );
  if (marketContext && marketContext.trim().length > 0) {
    lines.push(marketContext.trim());
  }
  const tp2Part = tp2 && Number.isFinite(tp2) && tp2 > 0 ? ` | TP2: ${fmtPrice(tp2)}` : "";
  lines.push(
    `Entry: ${fmtPrice(entry)} | Stop: ${fmtPrice(stopLoss)} (${stopPct.toFixed(2)}% risk) | TP1: ${fmtPrice(tp1)}${tp2Part}`
  );
  lines.push(`R:R to TP1 = ${rrTp1.toFixed(2)}:1 | Confidence: ${Math.round(conf)}%`);
  if (currentPrice && Number.isFinite(currentPrice)) {
    const distancePct = ((currentPrice - entry) / entry) * 100;
    const side = distancePct >= 0 ? "above" : "below";
    lines.push(`Current price: ${fmtPrice(currentPrice)} (${Math.abs(distancePct).toFixed(2)}% ${side} entry)`);
  }
  lines.push("⚠️ Not financial advice — manage your own risk. Stops are non-negotiable.");
  lines.push(hashtagsFor(token, dir, assetClass));

  return lines;
}
