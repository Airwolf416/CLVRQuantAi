import assert from "node:assert/strict";
import test from "node:test";
import { stripeResourceOwnedByUser } from "./billingOwnership";

const user = { id: "u1", email: "member@example.test", stripeCustomerId: "cus_owned" };
const stripe = { customers: { retrieve: async (id: string) => ({ id, email: "member@example.test" }) } };

test("Stripe ownership requires the current user's customer", async () => {
  assert.equal(await stripeResourceOwnedByUser(stripe, "cus_owned", user), true);
  assert.equal(await stripeResourceOwnedByUser(stripe, "cus_other", user), false);
});