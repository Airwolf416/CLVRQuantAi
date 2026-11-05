import test from "node:test";
import assert from "node:assert/strict";
import { formatRotationContext } from "./marketDecisionContext";
import { readFileSync } from "node:fs";

test("rotation context reports stale and absent evidence rather than inventing values", () => {
  const now = Date.now();
  const text = formatRotationContext({
    cryptoAsOf: new Date(now - 40 * 3600_000).toISOString(),
    crypto: { sentiment: { score: 95 } },
    macroAsOf: new Date(now).toISOString(),
    macro: { status: "partial", score: 10, factors: [{ factor: "vix", stale: true }] },
  }, now);
  assert.match(text, /crypto: unavailable or stale/);
  assert.doesNotMatch(text, /"score":95/);
  assert.match(text, /"stale":true/);
  assert.match(text, /"status":"partial"/);
});

test("all four AI routes load shared evidence and analyze keys include its hash", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  for (const path of ["/api/chart-ai/analyze", "/api/quant", "/api/ai/analyze", "/api/kronos"]) {
    const start = routes.indexOf(`app.post("${path}"`);
    assert.ok(start >= 0, path);
    const next = routes.indexOf("\n  app.", start + 10);
    const body = routes.slice(start, next < 0 ? undefined : next);
    assert.match(body, /await loadMarketDecisionContext\(\)/, path);
    if (path === "/api/ai/analyze") assert.match(body, /update\(alphaDeskContextBlock\)/);
  }
});
