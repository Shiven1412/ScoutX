import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { PLAN_LIMITS, type Plan } from "@/lib/limits";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RazorpayEntity = Record<string, unknown>;
type RazorpayEvent = { event?: string; payload?: { subscription?: { entity?: RazorpayEntity }; invoice?: { entity?: RazorpayEntity } } };

export async function POST(request: NextRequest) {
  const secret = getServerEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Razorpay webhook is not configured." }, { status: 503 });
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  if (!signature || !eventId || eventId.length > 200) return NextResponse.json({ error: "Missing Razorpay signature or event ID." }, { status: 400 });
  const rawBody = await request.text();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!safeEqualHex(signature, expected)) return NextResponse.json({ error: "Invalid Razorpay signature." }, { status: 400 });
  let event: RazorpayEvent;
  try { event = JSON.parse(rawBody) as RazorpayEvent; }
  catch { return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  if (typeof event.event !== "string") return NextResponse.json({ error: "Missing webhook event type." }, { status: 400 });

  const admin = createAdminClient();
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const { error: insertError } = await admin.from("billing_events").insert({ provider: "razorpay", event_id: eventId, event_type: event.event, payload_hash: payloadHash, claimed_at: new Date().toISOString() });
  if (insertError) {
    if (insertError.code !== "23505") return NextResponse.json({ error: "Unable to record the billing event." }, { status: 500 });
    const { data: prior, error: priorError } = await admin.from("billing_events").select("id, payload_hash, processed_at, claimed_at, attempts").eq("provider", "razorpay").eq("event_id", eventId).maybeSingle();
    if (priorError || !prior) return NextResponse.json({ error: "Unable to verify the billing event receipt." }, { status: 500 });
    if (prior.payload_hash !== payloadHash) return NextResponse.json({ error: "Event ID was reused with a different payload." }, { status: 400 });
    if (prior.processed_at) return NextResponse.json({ received: true, duplicate: true });
    const now = Date.now();
    if (prior.claimed_at && now - new Date(prior.claimed_at).getTime() < 5 * 60_000) return NextResponse.json({ received: true, processing: true });
    const staleClaim = new Date(now - 5 * 60_000).toISOString();
    const { data: claim, error: claimError } = await admin.from("billing_events").update({ claimed_at: new Date(now).toISOString(), attempts: prior.attempts + 1, last_error: null }).eq("id", prior.id).is("processed_at", null).or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`).select("id").maybeSingle();
    if (claimError) return NextResponse.json({ error: "Billing event retry could not be claimed." }, { status: 500 });
    if (!claim) return NextResponse.json({ received: true, processing: true });
  }

  try {
    if (event.event.startsWith("subscription.")) await processSubscriptionEvent(admin, event);
    else if (event.event.startsWith("invoice.")) await processInvoiceEvent(admin, event);
    const { error: doneError } = await admin.from("billing_events").update({ processed_at: new Date().toISOString(), claimed_at: null, last_error: null }).eq("provider", "razorpay").eq("event_id", eventId);
    if (doneError) throw new Error("Event processing could not be committed.");
    return NextResponse.json({ received: true });
  } catch (error) {
    await admin.from("billing_events").update({ claimed_at: null, last_error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed." }).eq("provider", "razorpay").eq("event_id", eventId);
    return NextResponse.json({ error: "Event processing failed; Razorpay can retry delivery." }, { status: 500 });
  }
}

async function processSubscriptionEvent(admin: ReturnType<typeof createAdminClient>, event: RazorpayEvent) {
  const subscription = event.payload?.subscription?.entity;
  if (!subscription) throw new Error("Subscription event did not include an entity.");
  const subscriptionId = text(subscription.id);
  const customerId = text(subscription.customer_id);
  const notes = isRecord(subscription.notes) ? subscription.notes : {};
  const { data: current } = await admin.from("subscriptions").select("organization_id, plan, current_period_start").eq("razorpay_subscription_id", subscriptionId).maybeSingle();
  const organizationId = current?.organization_id ?? text(notes.organization_id);
  if (!isUuid(organizationId)) throw new Error("Subscription event has no valid organization binding.");
  const plan = resolvePlan(text(notes.plan), text(subscription.plan_id));
  if (!plan) throw new Error("Razorpay plan is not mapped to a supported ScoutX plan.");
  const providerStatus = text(subscription.status);
  const status = providerStatus === "active" || providerStatus === "authenticated" ? "active" : providerStatus === "halted" ? "past_due" : providerStatus === "cancelled" || providerStatus === "completed" ? "canceled" : "trialing";
  const now = new Date();
  const currentStart = epochDate(subscription.current_start) ?? current?.current_period_start ?? now.toISOString();
  const currentEnd = epochDate(subscription.current_end) ?? new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const newPeriod = !current?.current_period_start || new Date(currentStart).getTime() > new Date(current.current_period_start).getTime();
  const limits = PLAN_LIMITS[plan];
  const { error } = await admin.from("subscriptions").update({
    plan,
    status,
    payment_provider: "razorpay",
    razorpay_customer_id: customerId || null,
    razorpay_subscription_id: subscriptionId,
    current_period_start: currentStart,
    current_period_end: currentEnd,
    signals_total: limits.signals,
    ai_credits_total: limits.aiCredits,
    ...(newPeriod ? { signals_used: 0, ai_credits_used: 0 } : {}),
  }).eq("organization_id", organizationId);
  if (error) throw new Error("Subscription record could not be synchronized.");
  const { error: integrationError } = await admin.from("provider_status").upsert({
    organization_id: organizationId,
    provider: "razorpay",
    connected: true,
    sync_status: "healthy",
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider" });
  if (integrationError) throw new Error("Razorpay integration status could not be synchronized.");
  await admin.from("audit_logs").insert({ organization_id: organizationId, action: `billing.razorpay_${event.event}`, resource_type: "subscription", resource_id: subscriptionId, metadata: { plan, status } });
}

async function processInvoiceEvent(admin: ReturnType<typeof createAdminClient>, event: RazorpayEvent) {
  const invoice = event.payload?.invoice?.entity;
  if (!invoice) throw new Error("Invoice event did not include an entity.");
  const subscriptionId = text(invoice.subscription_id);
  const customerId = text(invoice.customer_id);
  const { data: subscription } = await admin.from("subscriptions").select("organization_id").eq("razorpay_subscription_id", subscriptionId).maybeSingle();
  if (!subscription?.organization_id) throw new Error("Invoice does not map to a workspace subscription.");
  const id = text(invoice.id);
  if (!id) throw new Error("Invoice has no provider ID.");
  const { error } = await admin.from("invoices").upsert({
    organization_id: subscription.organization_id,
    provider: "razorpay",
    external_invoice_id: id,
    status: text(invoice.status) || (event.event ?? "invoice.unknown").replace("invoice.", ""),
    currency: text(invoice.currency) || "INR",
    amount_due: integer(invoice.amount),
    amount_paid: integer(invoice.amount_paid),
    invoice_url: nullableText(invoice.short_url),
    period_start: epochDate(invoice.billing_start),
    period_end: epochDate(invoice.billing_end),
  }, { onConflict: "provider,external_invoice_id" });
  if (error) throw new Error("Invoice record could not be saved.");
  if (customerId) await admin.from("payment_customers").upsert({ organization_id: subscription.organization_id, provider: "razorpay", external_customer_id: customerId }, { onConflict: "organization_id,provider" });
}

function resolvePlan(note: string, providerPlanId: string): Plan | null {
  if (note === "starter" || note === "growth" || note === "agency") return note;
  const env = getServerEnv();
  if (providerPlanId && providerPlanId === env.RAZORPAY_PLAN_STARTER) return "starter";
  if (providerPlanId && providerPlanId === env.RAZORPAY_PLAN_GROWTH) return "growth";
  if (providerPlanId && providerPlanId === env.RAZORPAY_PLAN_AGENCY) return "agency";
  return null;
}

function safeEqualHex(value: string, expected: string) {
  if (!/^[a-f\d]+$/i.test(value) || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { return typeof value === "string" && value ? value : null; }
function integer(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function epochDate(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }