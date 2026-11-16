// One source of truth for brief trade levels, ratios and execution narrative.
// This module has no provider, database or delivery side effects.
export interface BriefTradeNumbers {
  instrument: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  rrTp1: number;
  rrTp2: number;
}

function price(value: unknown): number {
  if (typeof value === "number") return value;
  // Accept ordinary currency/grouped prices, not ranges or prose whose digits
  // could otherwise concatenate into a completely different price.
  const text = String(value ?? "").trim().replace(/^[$€£¥]\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text.replaceAll(",", ""));
}

export function validateBriefTrade(raw: any):
  { ok: true; trade: BriefTradeNumbers } | { ok: false; reasons: string[] } {
  const instrument = String(raw?.instrument || raw?.asset || "").trim();
  const direction = String(raw?.direction || raw?.dir || "").trim().toUpperCase();
  const levels = { entry: price(raw?.entry), stop: price(raw?.stop), tp1: price(raw?.tp1), tp2: price(raw?.tp2) };
  const reasons: string[] = [];
  if (!instrument) reasons.push("missing instrument");
  if (direction !== "LONG" && direction !== "SHORT") reasons.push("direction must be LONG or SHORT");
  for (const [field, value] of Object.entries(levels)) {
    if (!Number.isFinite(value) || value <= 0) reasons.push(`${field} must be a finite positive price`);
  }
  if (!reasons.length) {
    const { entry, stop, tp1, tp2 } = levels;
    if (direction === "LONG" ? !(stop < entry) : !(stop > entry)) reasons.push("stop is not strictly on the correct side of entry");
    if (tp1 === entry || tp2 === entry) reasons.push("target equals entry");
    if (tp1 === stop || tp2 === stop) reasons.push("target equals stop");
    if (direction === "LONG" ? !(entry < tp1 && tp1 < tp2) : !(entry > tp1 && tp1 > tp2)) {
      reasons.push(`invalid target order: ${direction} requires ${direction === "LONG" ? "entry < TP1 < TP2" : "entry > TP1 > TP2"}`);
    }
  }
  if (reasons.length) return { ok: false, reasons };
  const risk = Math.abs(levels.entry - levels.stop);
  const rrTp1 = Math.abs(levels.tp1 - levels.entry) / risk;
  const rrTp2 = Math.abs(levels.tp2 - levels.entry) / risk;
  if (![rrTp1, rrTp2].every(Number.isFinite)) return { ok: false, reasons: ["non-finite computed risk/reward"] };
  return { ok: true, trade: { instrument, direction: direction as "LONG" | "SHORT", ...levels, rrTp1, rrTp2 } };
}

export function briefPriceDecimals(instrument: string, value: number): number {
  const symbol = instrument.toUpperCase().replace(/[^A-Z]/g, "");
  // Currency pairs only: XAU/USD, BTC/USD etc. are not FX.
  if (/(?:USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD|MXN|ZAR|TRY|SGD|HKD|NOK|SEK){2}$/.test(symbol)) return 4;
  // Preserve supplied quote precision for non-FX instruments (e.g. natural
  // gas at 3 decimals and sub-cent crypto), with cents as the display minimum.
  // Do not assume that every instrument above $1 trades in whole cents.
  const fractionalDigits = value.toFixed(8).replace(/0+$/, "").split(".")[1]?.length || 0;
  return Math.max(2, fractionalDigits);
}

export function formatBriefPrice(instrument: string, value: number): string {
  return value.toFixed(briefPriceDecimals(instrument, value));
}

export function presentBriefTrade(raw: any) {
  const validated = validateBriefTrade(raw);
  if (!validated.ok) return validated;
  const t = validated.trade;
  const formatted = {
    entry: formatBriefPrice(t.instrument, t.entry),
    stop: formatBriefPrice(t.instrument, t.stop),
    tp1: formatBriefPrice(t.instrument, t.tp1),
    tp2: formatBriefPrice(t.instrument, t.tp2),
  };
  // A display must not quietly round away meaningful stored precision.
  for (const field of ["entry", "stop", "tp1", "tp2"] as const) {
    if (Math.abs(Number(formatted[field]) - t[field]) > Math.max(1e-12, Math.abs(t[field]) * 1e-12)) {
      return { ok: false as const, reasons: [`${field} cannot be represented at the instrument display precision`] };
    }
  }
  const rrTp1Display = `${t.rrTp1.toFixed(2)}:1`;
  const rrTp2Display = `${t.rrTp2.toFixed(2)}:1`;
  // Qualitative rationale is retained only when it contains no execution
  // claims. Price/target/R:R prose from the model is replaced, not patched.
  const qualitative = String(raw?.edge || raw?.thesis || "")
    .split(/(?<=[.!?])\s+/)
    .filter(s => !/\d|R\s*[:/]\s*R|risk[\s/-]*(?:to[\s/-]*)?reward|\b(?:entry|stop|target|TP|ratio|reward|risk)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)[ -]*(?:to|for)[ -]*(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(s))
    .join(" ").trim();
  const execution = `Entry ${formatted.entry}; stop ${formatted.stop}; TP1 ${formatted.tp1}; TP2 ${formatted.tp2}. R:R to TP1 ${rrTp1Display}; R:R to TP2 ${rrTp2Display}.`;
  return {
    ok: true as const,
    trade: { ...t, ...formatted, rrTp1Display, rrTp2Display, thesis: [qualitative, execution].filter(Boolean).join(" "), sessionFlag: raw?.sessionFlag },
  };
}

export function filterBriefTrades(brief: any, log = (message: string) => console.warn(message)): void {
  const keep = (raw: any) => {
    if (!raw) return false;
    const result = presentBriefTrade(raw);
    if (result.ok) {
      // Store canonical levels and execution text before selection/publishing.
      const t = result.trade;
      Object.assign(raw, { entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, edge: t.thesis, thesis: t.thesis });
      return true;
    }
    // No recipients or other user data in these diagnostics.
    const symbol = String(raw.instrument || raw.asset || "unknown").replace(/[\r\n]/g, " ").slice(0, 100);
    log(`[daily-brief] Excluded trade ${symbol}: ${result.reasons.join("; ")}`);
    return false;
  };
  if (!keep(brief.topTrade)) brief.topTrade = null;
  brief.additionalTrades = (Array.isArray(brief.additionalTrades) ? brief.additionalTrades : []).filter(keep);
}
