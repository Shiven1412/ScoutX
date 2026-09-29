import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/services/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const webhookSecret = getServerEnv().STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  const payload = await request.text();
  let event: Stripe.Event;
  try { event = getStripe().webhooks.constructEvent(payload, signature, webhookSecret); }
  catch { return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 }); }

  const admin = createAdminClient();
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const { error: receiptError } = await admin.from("stripe_events").insert({ event_id: event.id, event_type: event.type, payload_hash: payloadHash });
  if (receiptError) {
    if (receiptError.code === "23505") {
      const { data: prior } = await admin.from("stripe_events").select("processed_at").eq("event_id", event.id).maybeSingle();
      if (prior?.processed_at) return NextResponse.json({ received: true, duplicate: true });
      const { data: samePayload } = await admin.from("stripe_events").select("id").eq("event_id", event.id).eq("payload_hash", payloadHash).maybeSingle();
      if (!samePayload) return NextResponse.json({ error: "Stripe event ID was reused with a different body." }, { status: 400 });
      const { data: reclaimed, error: claimError } = await admin.from("stripe_events").update({ received_at: new Date().toISOString() }).eq("event_id", event.id).eq("payload_hash", payloadHash).is("processed_at", null).select("id").maybeSingle();
      if (claimError || !reclaimed) return NextResponse.json({ received: true, processing: true });
    } else {
      return NextResponse.json({ error: "Unable to record event receipt." }, { status: 500 });
    }
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.organization_id;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.mode !== "subscription" || !organizationId || !subscriptionId) throw new Error("Checkout session has no organization or subscription binding.");
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      if (subscription.metadata.organization_id !== organizationId) throw new Error("Checkout subscription does not match its organization metadata.");
      await saveSubscription(admin, organizationId, subscription);
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata.organization_id;
      if (!organizationId) throw new Error("Subscription metadata is missing organization_id.");
      await saveSubscription(admin, organizationId, subscription);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) await syncCustomerSubscription(admin, customerId);
    } else if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) await syncCustomerSubscription(admin, customerId);
    }
    const { error: completionError } = await admin.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("event_id", event.id);
    if (completionError) throw new Error("Event processing state could not be committed.");
    return NextResponse.json({ received: true });
  } catch {
    await admin.from("stripe_events").update({ processed_at: null }).eq("event_id", event.id);
    return NextResponse.json({ error: "Event processing failed; Stripe can retry delivery." }, { status: 500 });
  }
}

async function saveSubscription(admin: ReturnType<typeof createAdminClient>, organizationId: string, subscription: Stripe.Subscription) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("Invalid organization binding.");
  const env = getServerEnv();
  const productPrice = subscription.items.data[0]?.price.id;
  const plan = productPrice === env.STRIPE_PRICE_AGENCY ? "agency" : productPrice === env.STRIPE_PRICE_GROWTH ? "growth" : productPrice === env.STRIPE_PRICE_STARTER ? "starter" : subscription.metadata.plan;
  if (!["starter", "growth", "agency"].includes(plan)) throw new Error("Subscription price is not mapped to a supported plan.");
  const status = subscription.status === "active" || subscription.status === "trialing" || subscription.status === "past_due" || subscription.status === "canceled" ? subscription.status : "past_due";
  const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
  const { data: current } = await admin.from("subscriptions").select("stripe_subscription_id, created_at, current_period_start").eq("organization_id", organizationId).maybeSingle();
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== subscription.id) {
    const currentStripeSubscription = await getStripe().subscriptions.retrieve(current.stripe_subscription_id);
    if (["active", "trialing", "past_due"].includes(currentStripeSubscription.status)) {
      if (subscription.status === "canceled" || subscription.created < currentStripeSubscription.created) return;
      throw new Error("Multiple active Stripe subscriptions are associated with one organization.");
    }
    if (subscription.created <= currentStripeSubscription.created) return;
  }
  if (current?.created_at && new Date(current.created_at).getTime() > subscription.created * 1000) throw new Error("Subscription predates the organization subscription record.");
  const newBillingPeriod = !current?.current_period_start || new Date(periodStart).getTime() > new Date(current.current_period_start).getTime();
  const { error } = await admin.from("subscriptions").upsert({
    organization_id: organizationId,
    plan: plan as "starter" | "growth" | "agency",
    status,
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    ...(newBillingPeriod ? { signals_used: 0, ai_credits_used: 0 } : {}),
    signals_total: plan === "starter" ? 5_000 : plan === "growth" ? 75_000 : 500_000,
    ai_credits_total: plan === "starter" ? 5_000 : plan === "growth" ? 25_000 : 100_000,
  }, { onConflict: "organization_id" });
  if (error) throw new Error("Subscription could not be synchronized.");
}

async function syncCustomerSubscription(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const { data: current, error } = await admin.from("subscriptions").select("organization_id, stripe_subscription_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (error) throw new Error("Current Stripe customer mapping could not be loaded.");
  if (!current?.stripe_subscription_id) return;
  const subscription = await getStripe().subscriptions.retrieve(current.stripe_subscription_id);
  const subscriptionCustomer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (subscriptionCustomer !== customerId) throw new Error("Stripe customer and subscription mapping do not match.");
  await saveSubscription(admin, current.organization_id, subscription);
}
