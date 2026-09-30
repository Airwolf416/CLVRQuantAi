// Manual provisioning only: npx tsx server/seed-products.ts
// Never run automatically on startup. This changes the catalog, NOT any
// existing subscriptions or customer charges.
import { getUncachableStripeClient } from "./stripeClient";
import { BILLING_CURRENCY, SUBSCRIPTION_PRICES, matchesSubscriptionPrice } from "../shared/billingPricing.js";
import type Stripe from "stripe";

async function createProducts() {
  const stripe = await getUncachableStripeClient();
  const products: Stripe.Product[] = [];
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata.app === "clvrquant") products.push(product);
  }
  for (const tier of ["pro", "elite"]) {
    // Reuse the active tier product; don't create another because a legacy USD
    // price already exists on it. Never modify prices attached to subscriptions.
    let product = products.find(p => p.active && p.metadata.tier === tier && p.metadata.app === "clvrquant");
    if (!product) {
      product = await stripe.products.create({
        name: `CLVRQuant ${tier === "pro" ? "Pro" : "Elite"}`,
        metadata: { app: "clvrquant", tier },
      });
      products.push(product);
      console.log(`Created ${tier} product ${product.id}`);
    }
    for (const [key, spec] of Object.entries(SUBSCRIPTION_PRICES)) {
      if (spec.tier !== tier) continue;
      // The lookup key may still belong to a legacy USD price. A matching CAD
      // price can be reused (and assigned the key), otherwise create a new
      // immutable price and transfer the lookup key atomically.
      const keyed = await stripe.prices.list({ lookup_keys: [key], expand: ["data.product"], limit: 100 });
      if (keyed.data.some(p => matchesSubscriptionPrice(p, key))) {
        console.log(`${key}: valid CAD price already configured`);
        continue;
      }
      let reusable: Stripe.Price | undefined;
      for await (const p of stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
        if (p.currency === BILLING_CURRENCY && p.unit_amount === spec.amount
            && p.recurring?.interval === spec.interval && (p.recurring.interval_count ?? 1) === 1
            && (!p.lookup_key || p.lookup_key === key)) {
          reusable = p;
          break;
        }
      }
      if (reusable) {
        await stripe.prices.update(reusable.id, { lookup_key: key, transfer_lookup_key: true });
        console.log(`${key}: assigned to existing CAD price ${reusable.id}`);
      } else {
        const created = await stripe.prices.create({
          product: product.id,
          currency: BILLING_CURRENCY,
          unit_amount: spec.amount,
          recurring: { interval: spec.interval as "month" | "year" },
          lookup_key: key,
          transfer_lookup_key: true,
          metadata: { plan: key },
        });
        console.log(`${key}: created CAD price ${created.id}`);
      }
    }
  }
}

createProducts().catch(error => {
  console.error("Stripe catalog provisioning failed:", error.message);
  process.exitCode = 1;
});