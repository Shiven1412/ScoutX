import "server-only";

import { getPublicEnv, getServerEnv } from "@/lib/env";
import { requireOrganization } from "@/lib/organization";
import { createAdminClient } from "@/lib/supabase/admin";

export const isRazorpayConfigured = () => Boolean(getServerEnv().RAZORPAY_KEY_ID && getServerEnv().RAZORPAY_KEY_SECRET);

export async function createRazorpaySubscriptionUrl(plan: "starter" | "growth" | "agency") {
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const env = getServerEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured on the server.");
  const planId = { starter: env.RAZORPAY_PLAN_STARTER, growth: env.RAZORPAY_PLAN_GROWTH, agency: env.RAZORPAY_PLAN_AGENCY }[plan];
  if (!planId) throw new Error(`Razorpay Plan ID is not configured for the ${plan} plan.`);
  const { data: current, error: currentError } = await supabase.from("subscriptions").select("razorpay_subscription_id, stripe_subscription_id, status").eq("organization_id", organization.id).maybeSingle();
  if (currentError) throw new Error("Current subscription state could not be loaded.");
  if (current?.razorpay_subscription_id && ["trialing", "active", "past_due"].includes(current.status)) throw new Error("This workspace already has a Razorpay subscription. Change or cancel its plan first.");
  if (current?.stripe_subscription_id && ["trialing", "active", "past_due"].includes(current.status)) throw new Error("This workspace has an active Stripe subscription. Manage it through the Stripe billing portal before switching providers.");
  if (!user.email) throw new Error("A verified account email is required to start a Razorpay subscription.");

  const admin = createAdminClient();
  const { data: savedCustomer } = await admin.from("payment_customers").select("external_customer_id").eq("organization_id", organization.id).eq("provider", "razorpay").maybeSingle();
  let customerId = savedCustomer?.external_customer_id;
  if (!customerId) {
    const customer = await razorpayRequest<{ id: string }>("/customers", {
      method: "POST", body: JSON.stringify({ name: organization.name, email: user.email, fail_existing: "0", notes: { organization_id: organization.id } }),
    });
    customerId = customer.id;
    const { error: customerError } = await admin.from("payment_customers").upsert({ organization_id: organization.id, provider: "razorpay", external_customer_id: customerId }, { onConflict: "organization_id,provider" });
    if (customerError) throw new Error("Razorpay customer mapping could not be saved.");
  }

  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const subscription = await razorpayRequest<{ id: string; short_url?: string; customer_id?: string }>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ plan_id: planId, customer_id: customerId, customer_notify: 1, total_count: 120, quantity: 1, notes: { organization_id: organization.id, plan, return_url: `${appUrl}/billing?checkout=success` } }),
  });
  if (!subscription.id || !subscription.short_url) throw new Error("Razorpay did not return a subscription checkout URL.");
  const { error: subscriptionError } = await admin.from("subscriptions").update({
    payment_provider: "razorpay", razorpay_customer_id: customerId, razorpay_subscription_id: subscription.id,
  }).eq("organization_id", organization.id);
  if (subscriptionError) throw new Error("The Razorpay subscription could not be associated with the workspace.");
  await admin.from("audit_logs").insert({ organization_id: organization.id, actor_id: user.id, action: "billing.razorpay_subscription_created", resource_type: "subscription", resource_id: subscription.id, metadata: { plan } });
  return subscription.short_url;
}

export async function updateRazorpaySubscriptionPlan(plan: "starter" | "growth" | "agency") {
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const env = getServerEnv();
  const planId = { starter: env.RAZORPAY_PLAN_STARTER, growth: env.RAZORPAY_PLAN_GROWTH, agency: env.RAZORPAY_PLAN_AGENCY }[plan];
  if (!planId) throw new Error(`Razorpay Plan ID is not configured for the ${plan} plan.`);
  const { data: current, error } = await supabase.from("subscriptions").select("plan, razorpay_subscription_id, payment_provider").eq("organization_id", organization.id).maybeSingle();
  if (error || current?.payment_provider !== "razorpay" || !current.razorpay_subscription_id) throw new Error("No active Razorpay subscription is available to change.");
  if (current.plan === plan) throw new Error("This workspace is already on that plan.");
  const planOrder = { starter: 0, growth: 1, agency: 2 };
  await razorpayRequest(`/subscriptions/${encodeURIComponent(current.razorpay_subscription_id)}/update`, {
    method: "POST",
    body: JSON.stringify({ plan_id: planId, schedule_change_at: planOrder[plan] > planOrder[current.plan] ? "now" : "cycle_end", customer_notify: 1 }),
  });
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({ organization_id: organization.id, actor_id: user.id, action: "billing.razorpay_plan_change_requested", resource_type: "subscription", resource_id: current.razorpay_subscription_id, metadata: { from: current.plan, to: plan } });
}

export async function cancelRazorpaySubscription(cancelAtCycleEnd = true) {
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const { data: current, error } = await supabase.from("subscriptions").select("razorpay_subscription_id, payment_provider").eq("organization_id", organization.id).maybeSingle();
  if (error || current?.payment_provider !== "razorpay" || !current.razorpay_subscription_id) throw new Error("No active Razorpay subscription is available to cancel.");
  await razorpayRequest(`/subscriptions/${encodeURIComponent(current.razorpay_subscription_id)}/cancel`, {
    method: "POST", body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd }),
  });
  await createAdminClient().from("audit_logs").insert({ organization_id: organization.id, actor_id: user.id, action: "billing.razorpay_cancellation_requested", resource_type: "subscription", resource_id: current.razorpay_subscription_id, metadata: { cancel_at_cycle_end: cancelAtCycleEnd } });
}

export async function razorpayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getServerEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured on the server.");
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    console.error("Razorpay API request failed", { status: response.status, path });
    throw new Error("Razorpay could not complete the billing request.");
  }
  return await response.json() as T;
}