import { parseBriefPrice } from "./briefTradeNumbers";
import type { BriefMarketData, BriefMarketRow } from "./briefMarketSnapshot";
import { CRYPTO_SYMS } from "../config/assets";

const ASSET_FIELDS: Record<string, { codes: string[]; labels: string[] }> = {
  btc: { codes: ["BTC"], labels: ["Bitcoin (BTC/USD)"] },
  eth: { codes: ["ETH"], labels: ["Ethereum (ETH/USD)"] },
  sol: { codes: ["SOL"], labels: ["Solana (SOL/USD)"] },
  equities: { codes: ["SPX", "NDX"], labels: ["US Equities (SPX · NDX)"] },
  xau: { codes: ["XAU"], labels: ["Gold (XAU/USD)"] },
  xag: { codes: ["XAG"], labels: ["Silver (XAG/USD)"] },
  oil: { codes: ["WTI", "BRENT", "NATGAS"], labels: ["Oil & Energy (WTI · Brent · NatGas)"] },
  eurusd: { codes: ["EURUSD"], labels: ["EUR/USD"] },
  usdjpy: { codes: ["USDJPY"], labels: ["USD/JPY"] },
  usdcad: { codes: ["USDCAD"], labels: ["USD/CAD"] },
};

const LEVEL_TERMS = /\b(?:support|resistance|trigger|pivot|level|break(?:s|out)?|close(?:s|d)?\s+(?:above|below)|reclaim|invalidate|invalidation)\b/i;
const STRUCTURAL_TERMS = /\b(?:multi[\s-]?week|structural|long[\s-]?term)\b/i;
const SYMBOL_MENTIONS: Array<[RegExp, string]> = [
  [/\b(?:bitcoin|btc(?:\/?usd)?)\b/i, "BTC"],
  [/\b(?:ethereum|eth(?:\/?usd)?)\b/i, "ETH"],
  [/\b(?:solana|sol(?:\/?usd)?)\b/i, "SOL"],
  [/\b(?:gold|xau(?:\/?usd)?)\b/i, "XAU"],
  [/\b(?:silver|xag(?:\/?usd)?)\b/i, "XAG"],
  [/\b(?:wti|crude|brent|nat(?:ural)?\s*gas)\b/i, "ENERGY"],
  [/\b(?:eur\s*\/?\s*usd|eurusd)\b/i, "EURUSD"],
  [/\b(?:usd\s*\/?\s*jpy|usdjpy)\b/i, "USDJPY"],
  [/\b(?:usd\s*\/?\s*cad|usdcad)\b/i, "USDCAD"],
  [/\b(?:spx|s&p\s*500|gspc)\b/i, "SPX"],
  [/\b(?:ndx|nasdaq\s*100)\b/i, "NDX"],
  [/\b(?:aapl|msft|nvda|tsla|googl|amzn|meta)\b/i, "EQUITY"],
  ...CRYPTO_SYMS.filter(symbol => !["BTC", "ETH", "SOL"].includes(symbol))
    .map(symbol => [new RegExp(`\\b${symbol}(?:[/\\-]?(?:USD[TC]?))?\\b`, "i"), symbol] as [RegExp, string]),
];

function codeFor(input: unknown): string {
  const value = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Quotes, ideas, and systematic signals must use the same base identity.
  // Match only registered symbols, never strip USD from arbitrary stock/FX names.
  for (const symbol of CRYPTO_SYMS) {
    if (["", "USD", "USDT", "USDC"].some(quote =>
      value === `${symbol}${quote}` || value === `${symbol}${quote}PERP`)) return symbol;
  }
  if (/BITCOIN|BTC/.test(value)) return "BTC";
  if (/ETHEREUM|ETH/.test(value)) return "ETH";
  if (/SOLANA|SOL/.test(value)) return "SOL";
  if (/GOLD|XAU/.test(value)) return "XAU";
  if (/SILVER|XAG/.test(value)) return "XAG";
  if (/BRENT/.test(value)) return "BRENT";
  if (/NATURALGAS|NATGAS/.test(value)) return "NATGAS";
  if (/WTI|CRUDE/.test(value)) return "WTI";
  if (/EURUSD/.test(value)) return "EURUSD";
  if (/USDJPY/.test(value)) return "USDJPY";
  if (/USDCAD/.test(value)) return "USDCAD";
  if (/SPX|SP500|GSPC/.test(value)) return "SPX";
  if (/NDX|NASDAQ100/.test(value)) return "NDX";
  for (const symbol of ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META"]) {
    if (value === symbol || value.includes(symbol)) return symbol;
  }
  return value;
}

function quoteCode(row: BriefMarketRow): string {
  return codeFor(row.pair || row.symbol);
}

function allRows(data: BriefMarketData): BriefMarketRow[] {
  return [...(data.crypto || []), ...(data.forex || []), ...(data.metals || []), ...(data.equities || [])];
}

export function findBriefSnapshotQuote(data: BriefMarketData, instrument: unknown): BriefMarketRow | null {
  const code = codeFor(instrument);
  if (!code) return null;
  const rows = allRows(data);
  if (code === "ENERGY") return rows.find(row => ["WTI", "BRENT", "NATGAS"].includes(quoteCode(row))) || null;
  return rows.find(row => quoteCode(row) === code) || null;
}

function numericPriceTokens(text: string, instrumentCode?: string): Array<{ raw: string; value: number }> {
  const quoteContext = !!instrumentCode && (
    /\b(?:trad(?:e|es|ing)|quot(?:e|es|ed)|last|price|spot|at|around|near|above|below)\b/i.test(text)
    || SYMBOL_MENTIONS.some(([pattern, code]) => code === instrumentCode && pattern.test(text))
  );
  const pattern = LEVEL_TERMS.test(text) || quoteContext
    ? /\b\d[\d,]*(?:\.\d+)?[KMB]?\b/gi
    : /(?:[$€£¥]\s*\d[\d,]*(?:\.\d+)?[KMB]?|\b\d+(?:\.\d+)?[KMB]\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?[KMB]?\b|\b\d{4,}(?:\.\d+)?[KMB]?\b|\b\d+\.\d{3,}[KMB]?\b)/gi;
  const matches: Array<{ raw: string; value: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const normalized = raw.replace(/[$€£¥,\s]/g, "");
    const suffix = normalized.match(/[KMB]$/i)?.[0]?.toUpperCase();
    const base = Number(normalized.replace(/[KMB]$/i, ""));
    const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
    const value = base * multiplier;
    if (Number.isFinite(value) && value > 0) matches.push({ raw, value });
  }
  return matches;
}

function spotFor(data: BriefMarketData, code: string): { row: BriefMarketRow; value: number } | null {
  const row = findBriefSnapshotQuote(data, code);
  if (!row) return null;
  const value = Number.isFinite(Number(row.priceValue)) ? Number(row.priceValue) : parseBriefPrice(row.price);
  return Number.isFinite(value) && value > 0 ? { row, value } : null;
}

function mentionsUnavailableInstrument(text: string, data: BriefMarketData): boolean {
  return SYMBOL_MENTIONS.some(([pattern, code]) => {
    if (!pattern.test(text)) return false;
    if (code === "ENERGY") return !["WTI", "BRENT", "NATGAS"].some(symbol => spotFor(data, symbol));
    if (code === "EQUITY") {
      const symbol = text.match(pattern)?.[0];
      return !spotFor(data, codeFor(symbol));
    }
    return !spotFor(data, code);
  });
}

function safeSentence(sentence: string, data: BriefMarketData, code: string): boolean {
  if (mentionsUnavailableInstrument(sentence, data)) return false;
  // The shared snapshot line below carries the only numeric percentage used
  // for an asset. Drop model-supplied percent claims rather than risk a second
  // provider window or a stale daily-change value.
  if (/\b\d+(?:\.\d+)?\s*%/.test(sentence)) return false;
  const prices = numericPriceTokens(sentence, code);
  if (!prices.length) return true;
  const spot = spotFor(data, code);
  if (!spot) return false;
  const levelSentence = LEVEL_TERMS.test(sentence);
  const structural = STRUCTURAL_TERMS.test(sentence);
  for (const price of prices) {
    const distance = Math.abs(price.value - spot.value) / spot.value;
    if (levelSentence) {
      if (distance > 0.15 && !structural) return false;
    } else if (distance > 0.001) {
      // A non-level price statement is a current-price claim; it must match
      // the visible snapshot, not a previous run or a rounded narrative.
      return false;
    }
  }
  return true;
}

function snapshotLine(row: BriefMarketRow, data: BriefMarketData, timeZone: string): string {
  let captured = data.capturedAt || "";
  try {
    if (captured) captured = new Intl.DateTimeFormat("en-US", {
      timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(captured));
  } catch { /* caller still gets the exact stored timestamp in metadata */ }
  return `Snapshot: ${row.price} · Change ${row.change} · ${captured || "capture time unavailable"} · ${data.changeWindow || "change window unavailable"}.`;
}

function sanitizeText(text: string, data: BriefMarketData, code: string, appendSnapshot: boolean, timeZone: string): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean);
  const cleaned = sentences.filter(sentence => safeSentence(sentence, data, code)).join(" ").trim();
  if (!appendSnapshot) return cleaned;
  const quote = spotFor(data, code);
  if (!quote) return "";
  return [cleaned, snapshotLine(quote.row, data, timeZone)].filter(Boolean).join(" ");
}

function codeForTitle(title: unknown): string | null {
  const code = codeFor(title);
  return ["BTC", "ETH", "SOL", "XAU", "XAG", "WTI", "BRENT", "NATGAS", "EURUSD", "USDJPY", "USDCAD", "SPX", "NDX"].includes(code)
    || ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META"].includes(code)
    ? code : null;
}

function guardGeneralNarrative(value: unknown, data: BriefMarketData): string {
  return String(value || "").split(/(?<=[.!?])\s+|\n+/).filter(sentence => {
    if (mentionsUnavailableInstrument(sentence, data)) return false;
    const codes = SYMBOL_MENTIONS.filter(([pattern]) => pattern.test(sentence)).map(([, code]) => code);
    const hasNumbers = numericPriceTokens(sentence).length > 0;
    if (!codes.length) return !(LEVEL_TERMS.test(sentence) && hasNumbers);
    // Never compare prices for different instruments against one instrument.
    if (codes.length > 1 && hasNumbers) return false;
    const code = codes[0] === "ENERGY"
      ? (/brent/i.test(sentence) ? "BRENT" : /gas/i.test(sentence) ? "NATGAS" : "WTI")
      : codes[0] === "EQUITY"
        ? codeFor(sentence.match(/\b(?:AAPL|MSFT|NVDA|TSLA|GOOGL|AMZN|META)\b/i)?.[0])
        : codes[0];
    return safeSentence(sentence, data, code);
  }).join(" ").trim();
}

export function guardBriefCommentary(brief: any, data: BriefMarketData, timeZone: string, log = (message: string) => console.warn(message)): void {
  for (const [field, spec] of Object.entries(ASSET_FIELDS)) {
    const original = brief?.[field];
    if (typeof original !== "string" || !original.trim()) continue;
    const available = spec.codes.every(code => spotFor(data, code));
    if (!available) {
      brief[field] = "";
      log(`[daily-brief] Omitted ${field} commentary: required snapshot price unavailable`);
      continue;
    }
    const primary = spec.codes[0];
    const cleaned = sanitizeText(original, data, primary, true, timeZone);
    if (!cleaned) log(`[daily-brief] Omitted ${field} commentary: no snapshot-consistent text remained`);
    brief[field] = cleaned;
  }

  if (Array.isArray(brief?.commentary)) {
    brief.commentary = brief.commentary.flatMap((item: any) => {
      const title = String(item?.title || "");
      const code = codeForTitle(title);
      if (!code) {
        const text = guardGeneralNarrative(item?.text, data);
        return text ? [{ ...item, text }] : [];
      }
      const quote = spotFor(data, code);
      if (!quote) {
        log(`[daily-brief] Omitted ${title} commentary: required snapshot price unavailable`);
        return [];
      }
      const text = sanitizeText(String(item?.text || ""), data, code, true, timeZone);
      if (!text) return [];
      return [{ ...item, text }];
    });
  }
  for (const field of ["summary", "headline", "keyRisk", "riskNote", "macroRiskNote"]) {
    if (typeof brief?.[field] === "string") brief[field] = guardGeneralNarrative(brief[field], data);
  }

  const watchItems = Array.isArray(brief?.watchToday) ? brief.watchToday
    : Array.isArray(brief?.watchItems) ? brief.watchItems : null;
  if (watchItems) {
    const filtered = watchItems.filter((item: unknown) => {
      const text = String(item || "");
      const mentions = SYMBOL_MENTIONS.filter(([pattern]) => pattern.test(text));
      const codes = [...new Set(mentions.map(([, code]) => code))];
      const hasTrigger = LEVEL_TERMS.test(text) || numericPriceTokens(text).length > 0;
      if (hasTrigger && codes.length === 0) {
        log("[daily-brief] Omitted unanchored watch item containing a numeric trigger");
        return false;
      }
      if (!codes.length) return true;
      const equityTicker = text.match(/\b(?:AAPL|MSFT|NVDA|TSLA|GOOGL|AMZN|META)\b/i)?.[0];
      const primary = codes[0] === "ENERGY" ? "WTI" : codes[0] === "EQUITY" ? codeFor(equityTicker) : codes[0];
      if (codes.some(code => code === "ENERGY"
        ? !["WTI", "BRENT", "NATGAS"].some(symbol => spotFor(data, symbol))
        : code === "EQUITY" ? !spotFor(data, codeFor(text.match(/\b(?:AAPL|MSFT|NVDA|TSLA|GOOGL|AMZN|META)\b/i)?.[0]))
          : !spotFor(data, code))) return false;
      return safeSentence(text, data, primary || "BTC");
    });
    if (Array.isArray(brief.watchToday)) brief.watchToday = filtered;
    if (Array.isArray(brief.watchItems)) brief.watchItems = filtered;
  }
}

export function anchorBriefTradesToSnapshot(
  brief: any,
  data: BriefMarketData,
  log = (message: string) => console.warn(message),
): void {
  const keep = (trade: any) => {
    if (!trade) return false;
    const asset = trade.asset || trade.instrument;
    const quote = findBriefSnapshotQuote(data, asset);
    const spot = quote ? (Number.isFinite(Number(quote.priceValue)) ? Number(quote.priceValue) : parseBriefPrice(quote.price)) : NaN;
    const entry = parseBriefPrice(trade.entry);
    const label = String(asset || "unknown").replace(/[\r\n]/g, " ").slice(0, 80);
    if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(entry)) {
      log(`[daily-brief] Excluded trade ${label}: no valid entry or matching snapshot quote`);
      return false;
    }
    if (Math.abs(entry - spot) <= Math.max(1e-8, Math.abs(spot) * 1e-10)) {
      trade.entryMode = "MARKET";
      return true;
    }
    const distance = Math.abs(entry - spot) / spot;
    if (distance > 0.15) {
      log(`[daily-brief] Excluded trade ${label}: non-market entry is ${(distance * 100).toFixed(2)}% from the snapshot price`);
      return false;
    }
    trade.entryMode = "LIMIT / PULLBACK";
    return true;
  };
  if (!keep(brief.topTrade)) brief.topTrade = null;
  brief.additionalTrades = (Array.isArray(brief.additionalTrades) ? brief.additionalTrades : []).filter(keep);
}

function signalTimestamp(row: any): number {
  const raw = row?.ts ?? row?.created_at ?? row?.createdAt;
  if (typeof raw === "number" || /^\d{10,13}$/.test(String(raw))) {
    const value = Number(raw);
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function removeBriefSignalConflicts(
  brief: any,
  signals: any[],
  available: boolean,
  now = Date.now(),
  log = (message: string) => console.warn(message),
): void {
  const clearAll = (reason: string) => {
    if (brief?.topTrade) log(`[daily-brief] Excluded trade ${brief.topTrade.asset || brief.topTrade.instrument || "unknown"}: ${reason}`);
    for (const trade of brief?.additionalTrades || []) {
      log(`[daily-brief] Excluded trade ${trade.asset || trade.instrument || "unknown"}: ${reason}`);
    }
    brief.topTrade = null;
    brief.additionalTrades = [];
  };
  if (!available) {
    clearAll("systematic signal context unavailable; conflict check failed closed");
    return;
  }

  const latest = new Map<string, { direction: string; ts: number; conflict: boolean }>();
  for (const signal of signals || []) {
    const code = codeFor(signal?.token || signal?.symbol || signal?.instrument);
    const direction = String(signal?.direction || signal?.dir || "").toUpperCase();
    const ts = signalTimestamp(signal);
    if (!code || !["LONG", "SHORT"].includes(direction) || !ts || now - ts > 24 * 60 * 60_000 || ts > now + 60_000) continue;
    const old = latest.get(code);
    if (!old || ts > old.ts) latest.set(code, { direction, ts, conflict: false });
    else if (ts === old.ts && old.direction !== direction) old.conflict = true;
  }

  const keep = (trade: any) => {
    if (!trade) return false;
    const code = codeFor(trade.asset || trade.instrument);
    const signal = latest.get(code);
    const direction = String(trade.dir || trade.direction || "").toUpperCase();
    if (signal && (signal.conflict || signal.direction !== direction)) {
      const reason = signal.conflict ? "systematic signal directions conflict at the latest timestamp"
        : `systematic signal says ${signal.direction}, idea says ${direction}`;
      log(`[daily-brief] Excluded trade ${trade.asset || trade.instrument || "unknown"}: ${reason}`);
      return false;
    }
    return true;
  };
  if (!keep(brief.topTrade)) brief.topTrade = null;
  brief.additionalTrades = (Array.isArray(brief.additionalTrades) ? brief.additionalTrades : []).filter(keep);
}

export function briefEntryMode(instrument: unknown, entry: unknown, data: BriefMarketData): string {
  const quote = findBriefSnapshotQuote(data, instrument);
  const spot = quote ? (Number.isFinite(Number(quote.priceValue)) ? Number(quote.priceValue) : parseBriefPrice(quote.price)) : NaN;
  const entryPrice = parseBriefPrice(entry);
  return Number.isFinite(spot) && Number.isFinite(entryPrice)
    && Math.abs(entryPrice - spot) <= Math.max(1e-8, Math.abs(spot) * 1e-10)
    ? "MARKET" : "LIMIT / PULLBACK";
}
