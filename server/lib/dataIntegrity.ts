// ============================================================================
// Data integrity checker — runs immediately before the daily brief is built.
// Flags stale 0.00% prints, large divergences between correlated instruments,
// and orphan tickers (cited in trade ideas but missing from the price table).
//
// Returns a report with severity and a list of instruments to drop. If
// `criticalFailure === true` the brief send must be aborted and an admin
// alert raised.
// ============================================================================

export interface PriceRow {
  symbol:    string;
  price:     string;
  change:    string;          // e.g. "+1.23%" / "-0.55%"
  changeNum: number;          // numeric percentage move
}

export interface IntegrityReport {
  totalInstruments:  number;
  staleCount:        number;
  staleInstruments:  string[];                 // changeNum === 0 (likely stale feed)
  divergences:       Array<{ pair: string; delta: number; note: string }>;
  orphanTickers:     string[];                 // cited in trades but not in tables
  dropList:          string[];                 // instruments to exclude from brief
  criticalFailure:   boolean;                  // >20% stale → abort send
  warnings:          string[];
}

// Correlated reference pairs — large divergences suggest a stale or bad feed
// on at least one side. Spec: Brent vs WTI > 3% delta on the same day is the
// pattern to catch.
const CORRELATED_PAIRS: Array<[string, string, number]> = [
  ["BRENT", "WTI",   3.0],
  ["GOLD",  "SILVER", 4.0],
  ["BTC",   "ETH",    8.0],   // correlated but more elastic
];

// Symbol normalizer — feed labels can come in many forms ("Brent Crude Oil",
// "Gold XAU/USD", "BTC/USD"). Reduce to a canonical short ticker before
// correlation lookup so divergence checks actually match.
function normalizeSymbol(raw: string): string {
  const s = String(raw || "").toUpperCase();
  if (/BRENT/.test(s))           return "BRENT";
  if (/\bWTI\b|CRUDE/.test(s) && !/BRENT/.test(s)) return "WTI";
  if (/GOLD|XAU/.test(s))        return "GOLD";
  if (/SILVER|XAG/.test(s))      return "SILVER";
  if (/^BTC|BITCOIN/.test(s))    return "BTC";
  if (/^ETH|ETHEREUM/.test(s))   return "ETH";
  return s;
}

export function runIntegrityCheck(
  rows: PriceRow[],
  citedTickers: string[] = [],
): IntegrityReport {
  const warnings: string[] = [];
  const stale: string[] = [];
  const drop: string[] = [];

  // ── Stale check (changeNum exactly 0) ────────────────────────────────────
  for (const r of rows) {
    if (Number.isFinite(r.changeNum) && r.changeNum === 0) {
      stale.push(r.symbol);
      drop.push(r.symbol);
    }
  }
  if (stale.length) warnings.push(`Stale prices (0.00% change): ${stale.join(", ")} — refetch needed`);

  // ── Correlation divergence check ─────────────────────────────────────────
  // Index by both raw upper-case AND normalized canonical ticker. The
  // canonical lookup is what makes Brent/WTI etc. actually match across
  // feeds whose label format varies ("Brent Crude Oil" vs "BRENT").
  const bySymbol = new Map<string, PriceRow>();
  for (const r of rows) {
    bySymbol.set(r.symbol.toUpperCase(), r);
    const norm = normalizeSymbol(r.symbol);
    if (!bySymbol.has(norm)) bySymbol.set(norm, r);
  }

  const divergences: IntegrityReport["divergences"] = [];
  for (const [a, b, threshold] of CORRELATED_PAIRS) {
    const ra = bySymbol.get(a), rb = bySymbol.get(b);
    if (!ra || !rb) continue;
    const delta = Math.abs(ra.changeNum - rb.changeNum);
    if (delta > threshold) {
      divergences.push({
        pair: `${a}/${b}`,
        delta,
        note:  `${a} ${ra.changeNum.toFixed(2)}% vs ${b} ${rb.changeNum.toFixed(2)}% — Δ${delta.toFixed(2)}% > ${threshold}%`,
      });
      warnings.push(`Divergence ${a}/${b}: Δ${delta.toFixed(2)}% — manual review`);
    }
  }

  // ── Orphan tickers: cited in trade ideas but missing from price table ────
  const inTable = new Set(rows.map(r => r.symbol.toUpperCase()));
  const orphanTickers = citedTickers
    .map(t => t.toUpperCase())
    .filter(t => !inTable.has(t));
  if (orphanTickers.length) warnings.push(`Orphan tickers cited: ${orphanTickers.join(", ")}`);

  // ── Critical: >20% of feed stale → abort send ────────────────────────────
  const stalePct = rows.length ? stale.length / rows.length : 0;
  const criticalFailure = stalePct > 0.20;

  return {
    totalInstruments:  rows.length,
    staleCount:        stale.length,
    staleInstruments:  stale,
    divergences,
    orphanTickers,
    dropList:          drop,
    criticalFailure,
    warnings,
  };
}

// Convenience: filter out drop-listed rows from a price table
export function filterDropList(rows: PriceRow[], dropList: string[]): PriceRow[] {
  if (!dropList.length) return rows;
  const drop = new Set(dropList.map(s => s.toUpperCase()));
  return rows.filter(r => !drop.has(r.symbol.toUpperCase()));
}
