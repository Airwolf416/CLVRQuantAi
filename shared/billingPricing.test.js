import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBSCRIPTION_PRICES, matchesSubscriptionPrice, validatedSubscriptionPrices } from "./billingPricing.js";

const keys = Object.keys(SUBSCRIPTION_PRICES);
function price(key) {
  const { tier, interval, amount } = SUBSCRIPTION_PRICES[key];
  return {
    id: `price_${key}`, lookup_key: key, active: true,
    currency: "cad", unit_amount: amount,
    recurring: { interval, interval_count: 1 },
    product: { id: `prod_${tier}`, active: true, metadata: { app: "clvrquant", tier } },
  };
}

test("each canonical active CAD plan has its exact amount, interval, key and active tier product", () => {
  assert.deepEqual(keys, ["pro_monthly1", "pro_yearly1", "elite_monthly", "elite_yearly"]);
  assert.deepEqual(keys.map(k => SUBSCRIPTION_PRICES[k].amount), [2999, 29900, 12900, 119900]);
  const selected = validatedSubscriptionPrices(keys.map(price));
  for (const key of keys) assert.equal(selected[key].id, `price_${key}`);
});

test("never use legacy USD or invalid amount, interval, interval count, lookup or product", () => {
  for (const key of keys) {
    const good = price(key);
    const bad = [
      { ...good, currency: "usd" },
      { ...good, unit_amount: good.unit_amount - 1 },
      { ...good, recurring: { interval: good.recurring.interval === "month" ? "year" : "month" } },
      { ...good, recurring: { ...good.recurring, interval_count: 2 } },
      { ...good, lookup_key: "other" },
      { ...good, active: false },
      { ...good, product: "prod_unexpanded" },
      { ...good, product: { ...good.product, active: false } },
      { ...good, product: { ...good.product, metadata: { app: "other", tier: good.product.metadata.tier } } },
      { ...good, product: { ...good.product, metadata: { app: "clvrquant", tier: "other" } } },
    ];
    for (const row of bad) {
      assert.equal(matchesSubscriptionPrice(row, key), false, `${key}: ${JSON.stringify(row)}`);
      assert.equal(validatedSubscriptionPrices([row])[key], undefined);
    }
  }
});

test("valid price wins over legacy USD regardless of list ordering", () => {
  const valid = price("pro_monthly1");
  const usd = { ...valid, id: "price_legacy_usd", currency: "usd" };
  for (const rows of [[usd, valid], [valid, usd]]) {
    assert.equal(validatedSubscriptionPrices(rows).pro_monthly1.id, valid.id);
  }
});