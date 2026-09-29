import { BillingButton, CancelSubscriptionButton, PlanButton } from "@/components/forms/billing-buttons";
import { requireOrganization } from "@/lib/organization";
import { PLAN_LIMITS } from "@/lib/limits";
import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/services/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

const plans = ["starter", "growth", "agency"] as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const params = await searchParams;
  const { supabase, organization, membership } = await requireOrganization();
  const admin = createAdminClient();
  const [{ data: subscription, error }, usage] = await Promise.all([
    admin.from("subscriptions").select("plan, status, seats_used, ai_credits_total, ai_credits_used, signals_total, signals_used, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id, payment_provider, razorpay_subscription_id").eq("organization_id", organization.id).maybeSingle(),
    supabase.from("usage_records").select("tracked_date, signals_used, ai_credits_used, seats_used").eq("organization_id", organization.id).order("tracked_date", { ascending: false }).limit(30),
  ]);
  if (error || usage.error) throw new Error("Billing data could not be loaded.");
  let invoices: Array<{ id: string; created: number; status: string; amount: number; currency: string; url: string | null }> = [];
  const stripeSecret = getServerEnv().STRIPE_SECRET_KEY;
  if (membership.role !== "member" && subscription?.payment_provider !== "razorpay" && subscription?.stripe_customer_id && stripeSecret) {
    try { invoices = (await getStripe().invoices.list({ customer: subscription.stripe_customer_id, limit: 20 })).data.map((invoice) => ({ id: invoice.id, created: invoice.created, status: invoice.status ?? "pending", amount: invoice.amount_paid, currency: invoice.currency, url: invoice.hosted_invoice_url ?? null })); }
    catch { invoices = []; }
  }
  if (membership.role !== "member" && subscription?.payment_provider === "razorpay") {
    const { data } = await admin.from("invoices").select("external_invoice_id, created_at, status, amount_paid, currency, invoice_url").eq("organization_id", organization.id).eq("provider", "razorpay").order("created_at", { ascending: false }).limit(20);
    invoices = (data ?? []).map((invoice) => ({ id: invoice.external_invoice_id, created: Math.floor(new Date(invoice.created_at).getTime() / 1000), status: invoice.status, amount: invoice.amount_paid, currency: invoice.currency.toLowerCase(), url: invoice.invoice_url }));
  }
  const limits = PLAN_LIMITS[subscription?.plan ?? "starter"];
  return <div className="space-y-7"><div><p className="text-sm text-violet-300">Subscription</p><h1 className="mt-2 text-3xl font-semibold">Billing and usage</h1><p className="mt-2 text-sm text-slate-400">Plan status and consumption reported by the billing database.</p></div>
    {params.checkout === "success" && <p role="status" className="rounded-lg bg-emerald-400/10 p-4 text-sm text-emerald-200">Checkout completed. Subscription status will update when Stripe sends its verified webhook.</p>}{params.checkout === "cancelled" && <p role="status" className="rounded-lg bg-white/[.05] p-4 text-sm text-slate-300">Checkout was canceled; the subscription was not changed.</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Current plan" value={subscription?.plan ?? "starter"} detail={subscription?.status ?? "trialing"} /><Metric label="Seats" value={`${subscription?.seats_used ?? 0} / ${limits.seats}`} detail="Current plan limit" /><Metric label="Signals" value={`${subscription?.signals_used ?? 0} / ${subscription?.signals_total ?? limits.signals}`} detail="Current billing period" /><Metric label="AI credits" value={`${subscription?.ai_credits_used ?? 0} / ${subscription?.ai_credits_total ?? limits.aiCredits}`} detail="Current billing period" /></section>
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/50 p-5"><div><h2 className="font-semibold">Manage your subscription</h2><p className="mt-1 text-sm text-slate-400">{subscription ? `Period ${new Date(subscription.current_period_start).toLocaleDateString()} – ${new Date(subscription.current_period_end).toLocaleDateString()}` : "No subscription record available."}</p><p className="mt-1 text-xs capitalize text-slate-500">Billing provider: {subscription?.payment_provider ?? (subscription?.stripe_customer_id ? "stripe" : "none")}</p></div>{subscription?.payment_provider === "razorpay" && subscription.razorpay_subscription_id && canManage(membership.role) ? <CancelSubscriptionButton /> : subscription?.stripe_customer_id && canManage(membership.role) ? <BillingButton>Open Stripe customer portal</BillingButton> : <p className="text-xs text-slate-500">Checkout is available to workspace admins when a payment provider is configured.</p>}</section>
    {canManage(membership.role) && <section><h2 className="mb-3 text-lg font-semibold">Available plans</h2><div className="grid gap-3 lg:grid-cols-3">{plans.map((plan) => <div key={plan} className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><p className="text-lg font-semibold capitalize">{plan}</p><p className="mt-1 text-sm text-slate-400">{PLAN_LIMITS[plan].seats} seats · {PLAN_LIMITS[plan].signals.toLocaleString()} signals · {PLAN_LIMITS[plan].aiCredits.toLocaleString()} AI credits</p><PlanButton plan={plan} current={subscription?.plan === plan} provider={subscription?.payment_provider ?? (subscription?.stripe_subscription_id ? "stripe" : null)} subscribed={Boolean(subscription && ["active", "trialing", "past_due"].includes(subscription.status) && (subscription.stripe_subscription_id || subscription.razorpay_subscription_id))} /></div>)}</div></section>}
    <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Recent invoices</h2></div>{invoices.length ? <div className="divide-y divide-white/[.07]">{invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"><span>{new Date(invoice.created * 1000).toLocaleDateString()}</span><span className="capitalize text-slate-400">{invoice.status}</span><strong>{new Intl.NumberFormat(undefined, { style: "currency", currency: invoice.currency.toUpperCase() }).format(invoice.amount / 100)}</strong>{invoice.url ? <a href={invoice.url} target="_blank" rel="noreferrer" className="text-violet-300">View invoice</a> : null}</div>)}</div> : <p className="px-5 py-8 text-sm text-slate-500">No invoices have been recorded for this customer.</p>}</section>
    <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Daily usage records</h2>{usage.data?.length ? <div className="mt-3 divide-y divide-white/[.07]">{usage.data.map((row) => <div key={row.tracked_date} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{new Date(row.tracked_date).toLocaleDateString()}</span><span className="text-slate-400">{row.signals_used} signals · {row.ai_credits_used} AI credits · {row.seats_used} seats</span></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No metered usage records yet.</p>}</section>
  </div>;
}

function canManage(role: string) { return role === "owner" || role === "admin"; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><p className="text-sm capitalize text-slate-400">{label}</p><p className="mt-3 text-2xl font-semibold capitalize">{value}</p><p className="mt-1 text-xs capitalize text-slate-500">{detail}</p></div>; }
