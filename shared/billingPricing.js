// Canonical public list prices (minor units); Stripe IDs are only trusted after validation.
export const BILLING_CURRENCY = "cad";
export const BOOKING_PRICES = Object.freeze({ standard: 4900, member: 1900 });
export const SUBSCRIPTION_PRICES = Object.freeze({
  pro_monthly1: { tier: "pro", interval: "month", amount: 2999 },
  pro_yearly1: { tier: "pro", interval: "year", amount: 29900 },
  elite_monthly: { tier: "elite", interval: "month", amount: 12900 },
  elite_yearly: { tier: "elite", interval: "year", amount: 119900 },
});

export function matchesSubscriptionPrice(price, key) {
  const spec = SUBSCRIPTION_PRICES[key];
  const product = price?.product;
  return !!spec && price?.active === true && price.lookup_key === key
    && price.currency?.toLowerCase() === BILLING_CURRENCY
    && price.unit_amount === spec.amount
    && price.recurring?.interval === spec.interval
    && (price.recurring?.interval_count ?? 1) === 1
    && typeof product === "object" && product?.active === true
    && product.metadata?.app === "clvrquant" && product.metadata?.tier === spec.tier;
}

/** @returns {Record<string, any>} */
export function validatedSubscriptionPrices(prices) {
  const result = {};
  for (const key of Object.keys(SUBSCRIPTION_PRICES)) {
    const found = prices.find(price => matchesSubscriptionPrice(price, key));
    if (found) result[key] = found;
  }
  return result;
}