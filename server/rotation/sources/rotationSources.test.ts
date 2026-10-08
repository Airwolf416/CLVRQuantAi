import assert from "node:assert/strict";
import test from "node:test";
import { parseFarsideHtml } from "./etfFlows";
import { createCoinGeckoSource } from "./coingecko";

test("Farside adapter reads dated net flow totals and preserves negative values", () => {
  const html = `
    <table>
      <tr><th>Date</th><th>Fund A</th><th>Total</th></tr>
      <tr><td>07 Oct 2026</td><td>12.4</td><td>$1,234.5</td></tr>
      <tr><td>06 Oct 2026</td><td>-3.2</td><td>($26.7)</td></tr>
    </table>`;
  assert.deepEqual(parseFarsideHtml(html), [
    { date: "2026-10-07", totalNetFlowUsd: 1_234_500_000 },
    { date: "2026-10-06", totalNetFlowUsd: -26_700_000 },
  ]);
});

test("CoinGecko history rejects returned prices beyond the requested as-of date", async () => {
  const fixedNow = Date.parse("2026-10-08T12:00:00.000Z");
  const source = createCoinGeckoSource({
    now: () => fixedNow,
    fetch: async () => new Response(JSON.stringify({
      prices: [[Date.parse("2026-10-08T00:00:00.000Z"), 100]],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(
    source.fetchHistory("rotation-test-coin", "2026-10-07", 1),
    /invalid payload/,
  );
});
