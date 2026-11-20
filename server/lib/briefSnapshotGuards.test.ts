import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorBriefTradesToSnapshot,
  briefEntryMode,
  findBriefSnapshotQuote,
  guardBriefCommentary,
  removeBriefSignalConflicts,
} from "./briefSnapshotGuards";
import type { BriefMarketData } from "./briefMarketSnapshot";

const snapshot: BriefMarketData = {
  capturedAt: "2026-11-20T11:00:00.000Z",
  changeWindow: "Since the previous local 6:00 AM snapshot",
  crypto: [
    { symbol: "BTC/USD", price: "$61,734.25", priceValue: 61734.25, change: "+0.46%", changeNum: 0.46 },
    { symbol: "ETH/USD", price: "$2,100.00", priceValue: 2100, change: "—", changeNum: null },
  ],
  forex: [{ pair: "EUR/USD", price: "1.0850", priceValue: 1.085, change: "+0.15%", changeNum: 0.15 }],
  metals: [{ symbol: "Gold XAU/USD", price: "$3,575.52", priceValue: 3575.52, change: "-1.26%", changeNum: -1.26 }],
  equities: [{ symbol: "NVDA", price: "$190.00", priceValue: 190, change: "+1.10%", changeNum: 1.1 }],
};

test("commentary drops stale levels and provider-percent claims, and repeats the shared snapshot values", () => {
  const brief: any = {
    btc: "Bitcoin trades at $61,734.25 (+0.46%). Support is around $48K and bulls need a close above $60K. Momentum remains constructive.",
    xau: "Gold changed -1.26% today. Gold is trading at $3,575.52. Support is near $3,500.",
    xag: "Silver is down today.",
    equities: "The SPX is up 0.8%.",
  };
  const logs: string[] = [];
  guardBriefCommentary(brief, snapshot, "America/Toronto", value => logs.push(value));
  assert.doesNotMatch(brief.btc.split("Snapshot:")[0], /48K|60K|\+0\.46%/);
  assert.match(brief.btc, /Momentum remains constructive/);
  assert.match(brief.btc, /Snapshot: \$61,734\.25 · Change \+0\.46%/);
  assert.doesNotMatch(brief.xau.split("Snapshot:")[0], /-1\.26%/);
  assert.match(brief.xau, /Snapshot: \$3,575\.52 · Change -1\.26%/);
  assert.equal(brief.xag, "");
  assert.equal(brief.equities, "");
  assert.ok(logs.some(line => /xag.*unavailable/i.test(line)));
  assert.ok(logs.some(line => /equities.*unavailable/i.test(line)));
});

test("unsupported or unanchored numeric watch triggers are removed", () => {
  const brief: any = {
    watchToday: [
      "If BTC support at $48K breaks, reassess risk.",
      "If BTC closes above $62,000, watch for continuation.",
      "Watch the next scheduled macro release.",
      "If SPX clears 6,000, watch breadth.",
    ],
  };
  guardBriefCommentary(brief, snapshot, "America/Toronto", () => {});
  assert.deepEqual(brief.watchToday, [
    "If BTC closes above $62,000, watch for continuation.",
    "Watch the next scheduled macro release.",
  ]);
});

test("trade entries must map to the snapshot and non-market entries are labeled", () => {
  assert.equal(findBriefSnapshotQuote(snapshot, "Gold")?.price, "$3,575.52");
  const brief: any = {
    topTrade: { asset: "BTC/USD", dir: "SHORT", entry: "61734.25", stop: 62000, tp1: 61000, tp2: 60000 },
    additionalTrades: [
      { asset: "EUR/USD", dir: "LONG", entry: 1.08, stop: 1.07, tp1: 1.09, tp2: 1.10 },
      { asset: "BTC/USD", dir: "LONG", entry: 48000, stop: 47000, tp1: 49000, tp2: 50000 },
      { asset: "Silver", dir: "LONG", entry: 30, stop: 29, tp1: 31, tp2: 32 },
    ],
  };
  const logs: string[] = [];
  anchorBriefTradesToSnapshot(brief, snapshot, value => logs.push(value));
  assert.equal(brief.topTrade.entryMode, "MARKET");
  assert.equal(brief.additionalTrades.length, 1);
  assert.equal(brief.additionalTrades[0].entryMode, "LIMIT / PULLBACK");
  assert.equal(briefEntryMode("BTC", 61734.25, snapshot), "MARKET");
  assert.match(logs.join("\n"), /22\.25% from the snapshot price/);
  assert.match(logs.join("\n"), /matching snapshot quote/);
});

test("recent systematic-signal conflicts are excluded; unavailable context fails closed", () => {
  const now = Date.now();
  const conflict: any = {
    topTrade: { asset: "Gold", direction: "LONG" },
    additionalTrades: [{ asset: "BTC/USD", direction: "SHORT" }],
  };
  removeBriefSignalConflicts(conflict, [
    { token: "XAU", direction: "SHORT", ts: now },
    { token: "BTC", direction: "SHORT", ts: now },
  ], true, now, () => {});
  assert.equal(conflict.topTrade, null);
  assert.equal(conflict.additionalTrades.length, 1);

  const unavailable: any = { topTrade: { asset: "BTC", direction: "LONG" }, additionalTrades: [] };
  removeBriefSignalConflicts(unavailable, [], false, now, () => {});
  assert.equal(unavailable.topTrade, null);
});
