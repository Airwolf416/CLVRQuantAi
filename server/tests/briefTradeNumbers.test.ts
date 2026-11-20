import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterBriefTrades, formatBriefPrice, presentBriefTrade, validateBriefTrade } from "../lib/briefTradeNumbers";
import { renderDailyBriefEmail } from "../services/emailTemplates";

const examples = [
  { asset: "Gold", dir: "LONG", entry: 3850, stop: 3828, tp1: 3895, tp2: 3940, ratios: ["2.05:1", "4.09:1"] },
  { asset: "EUR/USD", dir: "SHORT", entry: 1.1005, stop: 1.1050, tp1: 1.0960, tp2: 1.0900, ratios: ["1.00:1", "2.33:1"] },
  { asset: "BTC/USD", dir: "SHORT", entry: 64600, stop: 65800, tp1: 63200, tp2: 61500, ratios: ["1.17:1", "2.58:1"] },
];
const market = { crypto: [], forex: [], metals: [], equities: [] };

for (const e of examples) {
  test(`Nov 16 ${e.asset}: validated stored fields, both ratios and narrative`, () => {
    const r = presentBriefTrade({ ...e, rrDisplay: "21.00", edge: `Approximately 2:1 R:R to TP1. ${e.dir === "LONG" ? "Bullish" : "Bearish"} momentum persists.` });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.trade.rrTp1Display, e.ratios[0]);
    assert.equal(r.trade.rrTp2Display, e.ratios[1]);
    assert.match(r.trade.thesis, new RegExp(`R:R to TP1 ${e.ratios[0].replace(".", "\\.")}`));
    assert.match(r.trade.thesis, new RegExp(`R:R to TP2 ${e.ratios[1].replace(".", "\\.")}`));
    assert.doesNotMatch(r.trade.thesis, /Approximately|21\.00/);
    assert.equal(Number(r.trade.entry), e.entry);
    assert.equal(Number(r.trade.stop), e.stop);
    assert.equal(Number(r.trade.tp1), e.tp1);
    assert.equal(Number(r.trade.tp2), e.tp2);
    console.log(`${e.asset} ${e.dir} | ${r.trade.entry} | ${r.trade.stop} | ${r.trade.tp1} | ${r.trade.tp2} | ${r.trade.rrTp1Display} | ${r.trade.rrTp2Display}\n${r.trade.thesis}`);
  });
}

test("legacy and tiered HTML use the same validated labeled values", () => {
  const brief = { headline: "Fixture", topTrade: examples[0], additionalTrades: examples.slice(1), btc: "Commentary unchanged.", watchToday: ["Watch unchanged"] };
  const before = JSON.stringify(brief);
  const legacy = renderDailyBriefEmail(brief, "November 16, 2026", market, "elite");
  const tiered = renderDailyBriefEmail(brief, "November 16, 2026", market, "elite", "", examples.map(e => ({
    instrument: e.asset, direction: e.dir, entry: String(e.entry), stop: String(e.stop), tp1: String(e.tp1), tp2: String(e.tp2), rrDisplay: "999",
  })));
  for (const html of [legacy, tiered]) {
    for (const e of examples.slice(0, 1)) {
      assert.ok(html.includes(`R:R to TP1: ${e.ratios[0]}`));
      assert.ok(html.includes(`R:R to TP2: ${e.ratios[1]}`));
    }
    assert.ok(html.includes("Stop: 3828.00"));
    assert.ok(html.includes("TP1: 3895.00"));
    assert.doesNotMatch(html, /Stop: 1\.1050|TP1: 1\.0960|TP1: 63200/);
    assert.doesNotMatch(html, /R:R:|999|21\.00/);
    assert.ok(html.includes("Commentary unchanged."));
  }
  assert.equal(JSON.stringify(brief), before);
});

test("invalid geometry and malformed prices are rejected with exact reasons", () => {
  const base = examples[1];
  const cases = [
    { ...base, stop: 1.10 }, { ...base, tp1: base.entry },
    { ...base, tp1: base.stop }, { ...base, tp2: base.tp1 },
    { ...base, tp2: 1.099 }, { ...base, dir: "NEUTRAL" },
    { ...base, stop: 0 }, { ...base, stop: NaN },
    { ...base, entry: Infinity }, { ...base, entry: "1.10 to 1.12" },
    { ...base, tp2: undefined },
    { ...examples[0], stop: 3900 }, { ...examples[0], tp2: 3890 },
    // Previously reported Oct 16 broken FX levels.
    { ...base, stop: 1.88, tp1: 10.45, tp2: 20.75 },
  ];
  for (const raw of cases) {
    const result = validateBriefTrade(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    if (!result.ok) assert.ok(result.reasons.length);
  }
  const logs: string[] = [];
  const brief = { topTrade: cases[0], additionalTrades: [cases[1], { ...examples[0] }] };
  filterBriefTrades(brief, line => logs.push(line));
  assert.equal(brief.topTrade, null);
  assert.equal(brief.additionalTrades.length, 1);
  assert.match(logs.join("\n"), /stop is not strictly on the correct side/);
  assert.match(logs.join("\n"), /target equals entry/);
  const html = renderDailyBriefEmail({ topTrade: cases[0], additionalTrades: [] }, "test", market, "elite");
  assert.doesNotMatch(html, /Entry:|R:R to TP1:/);
});

test("FX four-decimal precision, sub-cent tokens, cents for metals/equities/large crypto", () => {
  for (const pair of ["EUR/USD", "USDJPY", "GBP/USD", "AUD/CAD", "USD/CHF"]) {
    assert.equal(formatBriefPrice(pair, 1.105), "1.1050");
  }
  for (const symbol of ["Gold", "XAU/USD", "BTC/USD", "AAPL", "WTI"]) {
    assert.equal(formatBriefPrice(symbol, 3850), "3850.00");
  }
  assert.equal(formatBriefPrice("PEPE/USD", 0.00001234), "0.00001234");
  assert.equal(formatBriefPrice("Natural Gas", 3.527), "3.527");
  assert.equal(formatBriefPrice("SOL/USD", 89.513), "89.513");
  assert.equal(presentBriefTrade({ asset: "Natural Gas", dir: "LONG", entry: 3.527, stop: 3.501, tp1: 3.569, tp2: 3.591 }).ok, true);
  assert.equal(presentBriefTrade({ ...examples[1], entry: 1.10051 }).ok, false);
  assert.equal(validateBriefTrade({ ...examples[2], entry: "$64,600", stop: "65,800" }).ok, true);
});

test("canonical generation is idempotent and removes stale numerical or spelled-out ratio claims", () => {
  const brief = { topTrade: { ...examples[1], tp1: 1.0940, edge: "Offers two-to-one to TP1. Stop above 1.1050. Dollar strength persists." }, additionalTrades: [] };
  filterBriefTrades(brief);
  const once = JSON.stringify(brief);
  filterBriefTrades(brief);
  assert.equal(JSON.stringify(brief), once);
  assert.doesNotMatch(brief.topTrade.edge, /two-to-one|Stop above/);
  assert.match(brief.topTrade.edge, /Dollar strength persists/);
  assert.match(brief.topTrade.edge, /R:R to TP1 1.44:1/);
});

test("Nov 20 low-R:R ideas are excluded without replacement slots", () => {
  const brief: any = {
    topTrade: { asset: "BTC", dir: "SHORT", entry: 60000, stop: 61000, tp1: 59180, tp2: 58000 },
    additionalTrades: [
      { asset: "USD/CAD", dir: "LONG", entry: 1.4, stop: 1.39, tp1: 1.41, tp2: 1.42 },
      { asset: "EUR/USD", dir: "SHORT", entry: 1.1, stop: 1.11, tp1: 1.0895, tp2: 1.08 },
    ],
  };
  const logs: string[] = [];
  filterBriefTrades(brief, line => logs.push(line));
  assert.equal(brief.topTrade, null);
  assert.deepEqual(brief.additionalTrades, []);
  for (const ratio of ["0.82:1", "1.00:1", "1.05:1"]) assert.ok(logs.some(line => line.includes(ratio)));
});

test("email table and commentary share a snapshot timestamp and show the actual send clock", () => {
  const snapshot = {
    capturedAt: "2026-11-20T11:00:00.000Z",
    changeWindow: "Since the previous local 6:00 AM snapshot",
    crypto: [{ symbol: "BTC/USD", price: "$61,734.25", change: "+0.46%", changeNum: 0.46 }],
    forex: [], metals: [], equities: [],
  };
  const html = renderDailyBriefEmail(
    { btc: "Snapshot: $61,734.25 · Change +0.46%", topTrade: null, additionalTrades: [] },
    "November 20, 2026", snapshot, "elite", "", [], "", "",
    { timeZone: "America/Toronto", sentAt: "2026-11-20T11:12:00.000Z" },
  );
  assert.equal(html.match(/Shared snapshot captured 6:00 AM EST/g)?.length, 2);
  assert.ok(html.includes("SENT: 6:12 AM EST"));
  assert.ok(html.includes("$61,734.25"));
  assert.ok(html.includes("+0.46%"));
});

test("empty authoritative selection does not fall back; Free receives no trade", () => {
  const brief = { topTrade: examples[0], additionalTrades: examples.slice(1) };
  for (const html of [
    renderDailyBriefEmail(brief, "test", market, "elite", "", []),
    renderDailyBriefEmail(brief, "test", market, "free", "", examples.map(e => ({
      instrument: e.asset, direction: e.dir, entry: String(e.entry), stop: String(e.stop), tp1: String(e.tp1), tp2: String(e.tp2),
    }))),
  ]) assert.doesNotMatch(html, /Entry:|R:R to TP1:/);
});

test("generation validation surrounds policy and precedes selection and send", () => {
  const source = readFileSync("server/dailyBrief.ts", "utf8");
  const guard = source.indexOf("filterBriefTrades(briefJson)");
  const policy = source.indexOf("const policy = applyEmissionPolicy", guard);
  const recheck = source.indexOf("filterBriefTrades(briefJson)", guard + 1);
  assert.ok(guard < policy && policy < recheck);
  assert.ok(recheck < source.indexOf("const tieredMode = getTieredBriefMode()"));
  assert.ok(recheck < source.indexOf("const html = renderDailyBriefEmail"));
  assert.doesNotMatch(source.slice(guard, recheck), /toFixed/);
});
