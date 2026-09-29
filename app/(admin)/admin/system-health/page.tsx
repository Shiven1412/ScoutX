import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/organization";

export default async function SystemHealthPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const databaseCheck = await admin.from("organizations").select("id", { count: "exact", head: true });
  const billingCheck = await admin.from("stripe_events").select("id", { count: "exact", head: true });
  const publicEnv = getPublicEnv(); const env = getServerEnv();
  const checks = [
    ["Supabase database", databaseCheck.error ? "error" : "healthy", databaseCheck.error?.message ?? `Reachable · ${databaseCheck.count ?? 0} organization records`],
    ["Stripe event ledger", billingCheck.error ? "error" : "healthy", billingCheck.error?.message ?? `Reachable · ${billingCheck.count ?? 0} recorded events`],
    ["Supabase Auth config", publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "configured" : "missing", publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? "Missing project URL"],
    ["Stripe webhook secret", env.STRIPE_WEBHOOK_SECRET ? "configured" : "missing", env.STRIPE_WEBHOOK_SECRET ? "Configured on server" : "Webhook signature verification is unavailable"],
    ["AI draft provider", env.OPENAI_API_KEY ? "configured" : "missing", env.OPENAI_API_KEY ? "OpenAI key present; secret not displayed" : "AI drafting is unavailable"],
    ["Email provider", env.RESEND_API_KEY ? "configured" : "missing", env.RESEND_API_KEY ? "Resend key present; secret not displayed" : "Outbound email is unavailable"],
    ["Webhook secret encryption", env.WEBHOOK_ENCRYPTION_KEY ? "configured" : "missing", env.WEBHOOK_ENCRYPTION_KEY ? "Encryption key present; secret not displayed" : "Webhook registration is disabled"],
  ] as const;
  return <div><p className="text-sm text-amber-300">Platform administration</p><h2 className="mt-2 text-3xl font-semibold">System health</h2><p className="mt-2 text-sm text-slate-400">Live database checks and deployment configuration status. No synthetic health metrics.</p><div className="mt-6 space-y-3">{checks.map(([name, status, detail]) => <article key={name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-5"><div><h3 className="font-medium">{name}</h3><p className="mt-1 text-sm text-slate-400">{detail}</p></div><span className={`rounded-full border px-3 py-1 text-xs capitalize ${status === "healthy" || status === "configured" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : status === "error" ? "border-red-300/20 bg-red-300/10 text-red-200" : "border-amber-300/20 bg-amber-300/10 text-amber-200"}`}>{status}</span></article>)}</div></div>;
}
