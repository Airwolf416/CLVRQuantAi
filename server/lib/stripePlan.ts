// Historical subscriptions may still use old USD prices. Determine their tier
// from the Stripe product, not an amount threshold (Pro annual > Elite monthly).
export async function stripePriceTier(stripe: any, price: any): Promise<"pro" | "elite" | null> {
  if (!price) return null;
  if (typeof price === "string") price = await stripe.prices.retrieve(price);
  const productId = typeof price.product === "string" ? price.product : price.product?.id;
  const product = typeof price.product === "object" && price.product?.metadata
    ? price.product
    : productId ? await stripe.products.retrieve(productId) : null;
  if (product?.metadata?.app === "clvrquant"
      && (product.metadata.tier === "pro" || product.metadata.tier === "elite")) {
    return product.metadata.tier;
  }
  // Older subscriptions may have pre-metadata prices with known plan lookup keys.
  if (price.lookup_key === "pro_monthly1" || price.lookup_key === "pro_yearly1") return "pro";
  if (price.lookup_key === "elite_monthly" || price.lookup_key === "elite_yearly") return "elite";
  return null;
}