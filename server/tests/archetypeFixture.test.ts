/**
 * Module 2 T13 — archetype regression fixture.
 *
 * Hand-curated context snapshots that exercise each archetype rule plus
 * edge cases. Run with:
 *   npx tsx server/tests/archetypeFixture.test.ts
 *
 * Exits 0 on full pass, 1 on any failure. No test framework dependency.
 *
 * Property under test: SAME INPUT → SAME ARCHETYPE regardless of caller
 * (the live `/api/quant`, `/api/ai/analyze`, and `/api/kronos` paths all
 * invoke the same `classifyArchetype` from `archetype.ts`, so by testing
 * the classifier directly we cover all three).
 */
import { classifyArchetype, type ArchetypeContext } from "../lib/archetype";

type Fixture = {
  name: string;
  ctx: ArchetypeContext;
  expectedArchetype: string;
};

// Synthetic 1h candle helper — flat-ish bars are fine; rules that need
// candles only pull `close` / `volume` / `high` / `low` directly.
function flatCandles(n: number, basePrice: number): any[] {
  const out: any[] = [];
  const start = Date.now() - n * 3_600_000;
  for (let i = 0; i < n; i++) {
    out.push({
      timestamp: start + i * 3_600_000,
      open: basePrice, high: basePrice * 1.002, low: basePrice * 0.998,
      close: basePrice, volume: 100,
    });
  }
  return out;
}

const FIXTURES: Fixture[] = [
  // NEWS_MOMO (highest priority): recent HIGH-impact news within 30m.
  {
    name: "NEWS_MOMO fires when news ≤30m old",
    expectedArchetype: "NEWS_MOMO",
    ctx: {
      token: "BTC", direction: "LONG", price: 70000,
      candles1h: flatCandles(50, 70000),
      recentNewsMinutesAgo: 12,
    },
  },
  // MEAN_REVERSION_EXHAUSTION: |day move| > 2.5 × ATR_daily AND
  // (OI z>2 OR funding permissive). Up-extension + flat funding = exhaustion.
  {
    name: "MEAN_REV fires on +3 ATR with flat funding",
    expectedArchetype: "MEAN_REVERSION_EXHAUSTION",
    ctx: {
      token: "ETH", direction: "SHORT", price: 4300,
      candles1h: flatCandles(50, 4300),
      dayOpen: 4000, atrDaily: 100, fundingRate: 0.00005,
    },
  },
  // BREAKOUT_RETEST: within 0.5 ATR of breakout level on aligned side.
  {
    name: "BREAKOUT_RETEST fires when LONG retests up-breakout from above",
    expectedArchetype: "BREAKOUT_RETEST",
    ctx: {
      token: "SOL", direction: "LONG", price: 150.5,
      candles1h: flatCandles(50, 150.5),
      atrDaily: 5, breakoutLevel: 150, breakoutWasUp: true,
    },
  },
  // VWAP_RECLAIM: upside cross in last 3 bars + volume confirmation.
  {
    name: "VWAP_RECLAIM fires on upside cross + vol",
    expectedArchetype: "VWAP_RECLAIM",
    ctx: {
      token: "BNB", direction: "LONG", price: 600,
      candles1h: flatCandles(50, 600),
      vwapSession: 595,
      candles5m: [
        { timestamp: 1, open: 590, high: 595, low: 588, close: 590, volume: 100 },
        { timestamp: 2, open: 590, high: 596, low: 589, close: 593, volume: 100 },
        { timestamp: 3, open: 593, high: 600, low: 592, close: 600, volume: 250 },
      ],
    },
  },
  // TREND_PULLBACK: HTF EMA20 slope aligned with direction, price within
  // 0.6 ATR of EMA20.
  {
    name: "TREND_PULLBACK fires when SHORT pulls back to falling EMA20",
    expectedArchetype: "TREND_PULLBACK",
    ctx: {
      token: "DOGE", direction: "SHORT", price: 0.10,
      candles1h: flatCandles(50, 0.10),
      htfEma20: 0.101, htfEma20PrevN: 0.105, atrDaily: 0.005,
    },
  },
  // RANGE_FADE: price ≥90% of day range, SHORT fading back in.
  {
    name: "RANGE_FADE fires when SHORT at upper 10% of range",
    expectedArchetype: "RANGE_FADE",
    ctx: {
      token: "XRP", direction: "SHORT", price: 0.995,
      candles1h: flatCandles(50, 0.995),
      dayHigh: 1.0, dayLow: 0.9,
    },
  },
  // Edge: completely empty context → UNCLASSIFIED.
  {
    name: "UNCLASSIFIED when no rule has enough data",
    expectedArchetype: "UNCLASSIFIED",
    ctx: {
      token: "AVAX", direction: "LONG", price: 30,
      candles1h: flatCandles(50, 30),
    },
  },
  // Edge: near-threshold MEAN_REV (|move| = 2.5 exactly → does NOT fire).
  {
    name: "MEAN_REV does NOT fire at exactly 2.5 ATR (need strict >)",
    expectedArchetype: "UNCLASSIFIED",
    ctx: {
      token: "LINK", direction: "SHORT", price: 22.5,
      candles1h: flatCandles(50, 22.5),
      dayOpen: 20, atrDaily: 1,
    },
  },
  // Edge: MEAN_REV with NULL funding still fires (permissive when missing).
  {
    name: "MEAN_REV fires with NULL funding (permissive default)",
    expectedArchetype: "MEAN_REVERSION_EXHAUSTION",
    ctx: {
      token: "ATOM", direction: "SHORT", price: 12,
      candles1h: flatCandles(50, 12),
      dayOpen: 10, atrDaily: 0.7,
      // fundingRate intentionally omitted
    },
  },
  // Edge: news+MEAN_REV both qualify → NEWS_MOMO wins on priority.
  {
    name: "Priority: NEWS_MOMO beats MEAN_REV when both qualify",
    expectedArchetype: "NEWS_MOMO",
    ctx: {
      token: "MATIC", direction: "SHORT", price: 1.20,
      candles1h: flatCandles(50, 1.20),
      recentNewsMinutesAgo: 5,
      dayOpen: 1.0, atrDaily: 0.05, fundingRate: 0.00003,
    },
  },
  // Edge: BREAKOUT_RETEST with mismatched direction → does not fire.
  {
    name: "BREAKOUT_RETEST does NOT fire on direction mismatch",
    expectedArchetype: "UNCLASSIFIED",
    ctx: {
      token: "SUI", direction: "SHORT", price: 2.01,
      candles1h: flatCandles(50, 2.01),
      atrDaily: 0.05, breakoutLevel: 2.00, breakoutWasUp: true,
    },
  },
  // Edge: RANGE_FADE upper edge with LONG direction → does not fire.
  {
    name: "RANGE_FADE does NOT fire when LONG fades wrong side",
    expectedArchetype: "UNCLASSIFIED",
    ctx: {
      token: "OP", direction: "LONG", price: 1.99,
      candles1h: flatCandles(50, 1.99),
      dayHigh: 2.0, dayLow: 1.5,
    },
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const f of FIXTURES) {
  try {
    const result = classifyArchetype(f.ctx);
    if (result.archetype === f.expectedArchetype) {
      passed++;
      console.log(`  ✓ ${f.name}  →  ${result.archetype}`);
    } else {
      failed++;
      failures.push(`✗ ${f.name}\n      expected: ${f.expectedArchetype}\n      actual:   ${result.archetype}\n      reason:   ${result.reason}`);
      console.log(`  ✗ ${f.name}  →  ${result.archetype} (expected ${f.expectedArchetype})`);
    }
  } catch (err: any) {
    failed++;
    failures.push(`✗ ${f.name} threw: ${err?.message || err}`);
    console.log(`  ✗ ${f.name} threw: ${err?.message || err}`);
  }
}

console.log(`\n[archetypeFixture] ${passed}/${FIXTURES.length} passed.`);
if (failed > 0) {
  console.log(`\nFailures:\n${failures.join("\n\n")}`);
  process.exit(1);
}
process.exit(0);
