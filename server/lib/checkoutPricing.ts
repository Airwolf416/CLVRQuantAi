import { SUBSCRIPTION_PRICES, matchesSubscriptionPrice, validatedSubscriptionPrices } from "../../shared/billingPricing.js";

export const ALLOWED_CHECKOUT_LOOKUP_KEYS = Object.keys(SUBSCRIPTION_PRICES);
export class BillingCatalogError extends Error {}

export async function resolveAllowedCheckoutPrice(stripe: any, requested: unknown): Promise<any | null> {
  if (typeof requested !== "string" || !requested) return null;
  // Resolve from the current lookup keys, not from list ordering or an arbitrary
  // client-supplied price ID. Expanded products allow tier/active verification.
  const { data } = await stripe.prices.list({
    lookup_keys: ALLOWED_CHECKOUT_LOOKUP_KEYS,
    active: true,
    expand: ["data.product"],
    limit: 100,
  });
  const prices = validatedSubscriptionPrices(data);
  const missing = ALLOWED_CHECKOUT_LOOKUP_KEYS.filter(key => !prices[key]);
  if (missing.length) throw new BillingCatalogError(`Stripe CAD catalog missing valid prices: ${missing.join(", ")}. Configure active CAD prices matching plan, amount, interval and product.`);
  const key = ALLOWED_CHECKOUT_LOOKUP_KEYS.find(key =>
    key === requested || data.some((price: any) => price.id === requested && price.lookup_key === key));
  if (!key) return null;
  if (!prices[key]) throw new BillingCatalogError(`Stripe ${key} must be an active CAD price matching the plan, amount, interval and active product.`);
  if (requested.startsWith("price_") && prices[key].id !== requested) {
    throw new BillingCatalogError(`Requested Stripe price is not the validated active CAD price for ${key}. Refresh pricing and try again.`);
  }
  // Re-retrieve the exact ID going into Checkout: do not trust only discovery
  // when a lookup key is transferred or a price/product deactivated.
  const checkoutPrice = await stripe.prices.retrieve(prices[key].id, { expand: ["product"] });
  if (!matchesSubscriptionPrice(checkoutPrice, key)) {
    throw new BillingCatalogError(`Stripe ${key} changed or is no longer a valid active CAD price. Refresh pricing and try again.`);
  }
  return checkoutPrice;
}