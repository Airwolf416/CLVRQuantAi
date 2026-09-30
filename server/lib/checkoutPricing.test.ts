import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBSCRIPTION_PRICES } from "../../shared/billingPricing.js";
import { BillingCatalogError, resolveAllowedCheckoutPrice } from "./checkoutPricing";

const all = Object.entries(SUBSCRIPTION_PRICES).map(([key, spec]) => ({
  id: `price_${key}`, lookup_key: key, active: true, currency: "cad",
  unit_amount: spec.amount, recurring: { interval: spec.interval, interval_count: 1 },
  product: { active: true, metadata: { app: "clvrquant", tier: spec.tier } },
}));
function stripe(rows: any[], retrieved?: any) {
  let checkoutId: string | undefined;
  return {
    prices: {
      list: async () => ({ data: rows }),
      retrieve: async (id: string) => {
        checkoutId = id;
        return retrieved ?? rows.find(row => row.id === id);
      },
    },
    get checkoutId() { return checkoutId; },
  };
}

test("checkout accepts each exact CAD price by ID or key and retrieves the selected ID", async () => {
  for (const p of all) {
    const client = stripe(all);
    assert.equal((await resolveAllowedCheckoutPrice(client, p.id)).id, p.id);
    assert.equal(client.checkoutId, p.id);
    assert.equal((await resolveAllowedCheckoutPrice(client, p.lookup_key)).id, p.id);
  }
});

test("checkout rejects USD, wrong amount, interval, product tier and inactive price or product", async () => {
  const original = all[0];
  const invalid = [
    { ...original, currency: "usd" },
    { ...original, unit_amount: 2900 },
    { ...original, recurring: { interval: "year", interval_count: 1 } },
    { ...original, recurring: { interval: "month", interval_count: 2 } },
    { ...original, product: { active: true, metadata: { app: "clvrquant", tier: "elite" } } },
    { ...original, product: { ...original.product, active: false } },
    { ...original, active: false },
  ];
  for (const bad of invalid) {
    await assert.rejects(resolveAllowedCheckoutPrice(stripe([bad, ...all.slice(1)]), original.id), BillingCatalogError);
    // Even if discovery was valid, checkout rejects a changed Stripe price.
    await assert.rejects(resolveAllowedCheckoutPrice(stripe(all, bad), original.id), BillingCatalogError);
  }
  assert.equal(await resolveAllowedCheckoutPrice(stripe(all), "price_unknown"), null);
});

test("legacy USD list order cannot override CAD checkout", async () => {
  const legacy = { ...all[0], id: "price_legacy", currency: "usd" };
  for (const rows of [[legacy, ...all], [...all, legacy]]) {
    const client = stripe(rows);
    assert.equal((await resolveAllowedCheckoutPrice(client, all[0].lookup_key)).id, all[0].id);
    await assert.rejects(resolveAllowedCheckoutPrice(client, legacy.id), BillingCatalogError);
  }
});