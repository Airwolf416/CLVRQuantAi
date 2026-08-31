/** Verifies Stripe customer ownership without exposing customer data. */
export async function stripeResourceOwnedByUser(stripe: any, customer: unknown, user: any): Promise<boolean> {
  const customerId = typeof customer === "string" ? customer : (customer as any)?.id;
  if (!customerId) return false;
  if (user.stripeCustomerId && customerId !== user.stripeCustomerId) return false;
  const customerObject = typeof customer === "object" && customer
    ? customer as any
    : await stripe.customers.retrieve(customerId);
  return !customerObject?.deleted
    && (customerObject?.metadata?.userId === String(user.id)
      || (typeof customerObject?.email === "string"
        && customerObject.email.toLowerCase() === String(user.email).toLowerCase()));
}