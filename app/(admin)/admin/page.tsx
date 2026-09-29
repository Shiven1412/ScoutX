import Link from "next/link";
import { Activity, Building2, Users } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/organization";

export default async function PlatformAdminPage() {
  await requirePlatformAdmin();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const [users, organizations, subscriptions, events] = await Promise.all([
    admin.from("users").select("id", { count: "exact", head: true }),
    admin.from("organizations").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("subscriptions").select("id, status, plan"),
    admin.from("stripe_events").select("id", { count: "exact", head: true }).not("processed_at", "is", null),
  ]);
  if (users.error || organizations.error || subscriptions.error || events.error) throw new Error("Administrative metrics could not be loaded.");
  const rows = subscriptions.data ?? [];
  const active = rows.filter((row) => row.status === "active").length;
  const cards = [["Users", users.count ?? 0], ["Organizations", organizations.count ?? 0], ["Active subscriptions", active], ["Processed billing events", events.count ?? 0]] as const;
  return <div className="space-y-7"><div><p className="text-sm text-amber-300">Global administration</p><h1 className="mt-2 text-3xl font-semibold">System overview</h1><p className="mt-2 text-sm text-slate-400">Values are counted from production database tables, not sample metrics.</p></div><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-3 text-3xl font-semibold">{value.toLocaleString()}</p></div>)}</section>
    <section className="grid gap-3 md:grid-cols-3">{[["/admin/users", "Users", "Review registered accounts.", Users], ["/admin/organizations", "Organizations", "Review workspaces and subscriptions.", Building2], ["/admin/system-health", "System health", "Verify database, Stripe, and service configuration.", Activity]].map(([href, label, text, Icon]) => { const icon = Icon as typeof Activity; const I = icon; return <Link key={String(href)} href={String(href)} className="rounded-xl border border-white/10 bg-slate-900/50 p-5 hover:border-amber-300/30"><I className="size-5 text-amber-300" /><h2 className="mt-4 font-semibold">{String(label)}</h2><p className="mt-2 text-sm text-slate-400">{String(text)}</p></Link>; })}</section>
  </div>;
}
