import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeEliteMonitor } from "./eliteMonitorAccess";

const OWNER = "owner@example.com";

async function authorize(user: any) {
  return authorizeEliteMonitor(
    user?.id,
    async id => user?.id === id ? user : null,
    async value => value.effectiveTier,
    OWNER,
  );
}

test("Elite Monitor access admits Elite and owner, rejects free and Pro", async () => {
  assert.deepEqual(await authorize(null), { allowed: false, status: 401, error: "Sign in required." });
  assert.equal((await authorize({ id: "free", tier: "free", effectiveTier: "free" })).allowed, false);
  assert.equal((await authorize({ id: "pro", tier: "pro", effectiveTier: "pro" })).allowed, false);
  assert.equal((await authorize({ id: "elite", tier: "elite", effectiveTier: "elite" })).allowed, true);
  assert.equal((await authorize({ id: "owner", email: OWNER, tier: "pro", effectiveTier: "pro" })).allowed, true);
});

test("expired Elite grants use effective tier and cannot retain Monitor access", async () => {
  const result = await authorize({
    id: "expired",
    tier: "elite",
    effectiveTier: "free",
    promoExpiresAt: "expired",
  });
  assert.deepEqual(result, {
    allowed: false,
    status: 403,
    error: "Portfolio Advisor is an Elite feature.",
  });
});

test("every Portfolio Advisor data endpoint passes the common server-side gate", () => {
  const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const endpointPaths = [
    "/api/positions",
    "/api/positions/:id/analyze",
    "/api/portfolio-advisor",
    "/api/portfolio-advisor/pnl",
    "/api/portfolio-advisor/settings",
  ];
  for (const path of endpointPaths) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`app\\.(?:get|post|patch|put)\\("${escaped}"[\\s\\S]{0,800}requireElitePosition`), path);
  }
});

test("logged-out Monitor preview has a clear Elite upgrade path and no plan data", () => {
  const source = readFileSync(new URL("../../client/src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="preview-monitor-upgrade"/);
  assert.match(source, /data-testid="preview-monitor-elite-plans"/);
  assert.match(source, /Portfolio Advisor and the PnL Tracker are available to Elite members/);
  assert.match(source, /tab==="monitor"&&isElite/);
});
