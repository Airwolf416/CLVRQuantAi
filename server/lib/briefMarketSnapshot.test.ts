import test from "node:test";
import assert from "node:assert/strict";
import { getOrCreateBriefMarketSnapshot, type BriefMarketData } from "./briefMarketSnapshot";

function fakeDatabase() {
  const rows = new Map<string, any>();
  return {
    rows,
    async query(sql: string, values: any[] = []) {
      const zone = values[0];
      const date = String(values[1] || "");
      const key = `${zone}/${date}`;
      if (sql.includes("SELECT time_zone, local_date::text")) {
        const row = rows.get(key);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("SELECT payload") && sql.includes("local_date=($2::date - 1)")) {
        const prevDate = new Date(`${date}T12:00:00Z`);
        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
        const row = rows.get(`${zone}/${prevDate.toISOString().slice(0, 10)}`);
        return { rows: row ? [{ payload: row.payload }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO daily_brief_market_snapshots")) {
        if (rows.has(key)) return { rows: [], rowCount: 0 };
        const capturedAt = String(values[2]);
        const payload = JSON.parse(String(values[3]));
        rows.set(key, { time_zone: zone, local_date: date, captured_at: capturedAt, payload });
        return { rows: [{ time_zone: zone }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const prices = (btc: number): BriefMarketData => ({
  crypto: [{ symbol: "BTC/USD", price: `$${btc.toFixed(2)}`, priceValue: btc, change: "+999%", changeNum: 999, sourceChangeNum: 999 }],
  forex: [],
  metals: [],
  equities: [],
});

test("one stored local-morning snapshot is reused and its changes share one reference window", async () => {
  const db = fakeDatabase();
  let firstFetches = 0;
  const first = await getOrCreateBriefMarketSnapshot(
    db,
    "America/Toronto",
    "2026-11-20",
    async () => { firstFetches++; return prices(100); },
    () => new Date("2026-11-20T11:00:00.000Z"),
  );
  assert.equal(firstFetches, 1);
  assert.equal(first.data.crypto[0].change, "—");
  assert.equal(first.changeWindow, "No previous local 6:00 AM snapshot; change unavailable");

  let repeatedFetches = 0;
  const repeated = await getOrCreateBriefMarketSnapshot(
    db,
    "America/Toronto",
    "2026-11-20",
    async () => { repeatedFetches++; return prices(123); },
    () => new Date("2026-11-20T12:09:00.000Z"),
  );
  assert.equal(repeatedFetches, 0);
  assert.equal(repeated.capturedAt, first.capturedAt);
  assert.equal(repeated.data.crypto[0].price, "$100.00");

  const next = await getOrCreateBriefMarketSnapshot(
    db,
    "America/Toronto",
    "2026-11-21",
    async () => prices(110),
    () => new Date("2026-11-21T11:00:00.000Z"),
  );
  assert.equal(next.data.crypto[0].change, "+10.00%");
  assert.equal(next.data.crypto[0].sourceChangeNum, 999);
  assert.equal(next.data.capturedAt, "2026-11-21T11:00:00.000Z");
});

test("snapshots are isolated by timezone and local date", async () => {
  const db = fakeDatabase();
  const first = await getOrCreateBriefMarketSnapshot(db, "Asia/Tokyo", "2026-11-21", async () => prices(200), () => new Date("2026-11-21T00:00:00Z"));
  const second = await getOrCreateBriefMarketSnapshot(db, "America/Toronto", "2026-11-21", async () => prices(300), () => new Date("2026-11-21T11:00:00Z"));
  assert.equal(first.timeZone, "Asia/Tokyo");
  assert.equal(second.timeZone, "America/Toronto");
  assert.equal(first.data.crypto[0].price, "$200.00");
  assert.equal(second.data.crypto[0].price, "$300.00");
});
