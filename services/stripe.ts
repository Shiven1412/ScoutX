import "server-only";

import Stripe from "stripe";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { requireOrganization } from "@/lib/organization";
import { createAdminClient } from "@/lib/supabase/admin";

let stripe: Stripe | undefined;
export function getStripe() {
  const secret = getServerEnv().STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Payments are not configured. Add STRIPE_SECRET_KEY on the server.");
  stripe ??= new Stripe(secret);
  return stripe;
}

export async function createCheckoutUrl(plan: "starter" | "growth" | "agency") {
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const env = getServerEnv();
  const prices = { starter: env.STRIPE_PRICE_STARTER, growth: env.STRIPE_PRICE_GROWTH, agency: env.STRIPE_PRICE_AGENCY };
  const price = prices[plan];
  if (!price) throw new Error(`No Stripe Price ID is configured for the ${plan} plan.`);
  const { data: current } = await supabase.from("subscriptions").select("stripe_customer_id, stripe_subscription_id").eq("organization_id", organization.id).maybeSingle();
  if (current?.stripe_subscription_id) {
    const existing = await getStripe().subscriptions.retrieve(current.stripe_subscription_id);
    if (["active", "trialing", "past_due"].includes(existing.status)) throw new Error("This organization already has a subscription. Use the billing portal to change the plan.");
    const { error: clearError } = await createAdminClient().from("subscriptions").update({ stripe_subscription_id: null }).eq("organization_id", organization.id).eq("stripe_subscription_id", current.stripe_subscription_id);
    if (clearError) throw new Error("The previous subscription state could not be prepared for a new checkout.");
  }
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl}/billing?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
    customer: current?.stripe_customer_id ?? undefined,
    customer_email: current?.stripe_customer_id ? undefined : user.email ?? undefined,
    client_reference_id: organization.id,
    metadata: { organization_id: organization.id, plan },
    subscription_data: { metadata: { organization_id: organization.id, plan } },
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortalUrl() {
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { data: subscription, error } = await supabase.from("subscriptions").select("stripe_customer_id").eq("organization_id", organization.id).maybeSingle();
  if (error) throw new Error("Unable to load the billing customer.");
  if (!subscription?.stripe_customer_id) throw new Error("There is no billing customer yet. Choose a plan to start checkout.");
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const portal = await getStripe().billingPortal.sessions.create({ customer: subscription.stripe_customer_id, return_url: `${appUrl}/billing` });
  return portal.url;
}
