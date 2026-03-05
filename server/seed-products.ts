import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  const existing = await stripe.products.search({ query: "name:'CLVRQuant Pro'" });
  if (existing.data.length > 0) {
    console.log('CLVRQuant Pro already exists:', existing.data[0].id);
    const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
    prices.data.forEach(p => {
      console.log(`  Price: ${p.id} — $${(p.unit_amount || 0) / 100}/${p.recurring?.interval}`);
    });
    return;
  }

  const product = await stripe.products.create({
    name: 'CLVRQuant Pro',
    description: 'Full access to CLVRQuant AI trading intelligence: AI analyst, trade ideas, morning briefs, unlimited alerts, signals, liquidation heatmap, volume & funding monitors.',
    metadata: {
      tier: 'pro',
      app: 'clvrquant',
    },
  });
  console.log('Created product:', product.id);

  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 2900,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'pro_monthly' },
  });
  console.log('Monthly price:', monthlyPrice.id, '— $29/month');

  const yearlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 19900,
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { plan: 'pro_yearly' },
  });
  console.log('Yearly price:', yearlyPrice.id, '— $199/year');

  console.log('\nDone! Products created in Stripe.');
}

createProducts().catch(console.error);
