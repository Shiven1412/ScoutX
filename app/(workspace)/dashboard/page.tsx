import Link from "next/link";
import { ArrowUpRight, BadgeCheck, MessageSquareText, Radar, Users } from "lucide-react";
import { requireOrganization } from "@/lib/organization";

function Metric({ label, value, caption, icon: Icon }: { label: string; value: string; caption: string; icon: typeof Radar }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/60 p-5"><div className="flex items-start justify-between"><p className="text-sm text-slate-400">{label}</p><Icon className="size-4 text-violet-300" /></div><p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-slate-500">{caption}</p></article>;
}

export default async function DashboardPage() {
  const { supabase, user, organization } = await requireOrganization();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [signals, drafts, convertedLeads, repliedLeads, contactedLeads, activities, trackers] = await Promise.all([
    supabase.from("intent_signals").select("id, platform, keyword, prospect_name, company, post_snippet, intent_score, category, created_at", { count: "exact" }).eq("organization_id", organization.id).gte("created_at", start.toISOString()).order("created_at", { ascending: false }).limit(6),
    supabase.from("outreach_messages").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("status", "draft").is("deleted_at", null),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("status", "converted").is("deleted_at", null),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["replied", "meeting", "converted"]).is("deleted_at", null),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["contacted", "replied", "meeting", "converted"]).is("deleted_at", null),
    supabase.from("activity_logs").select("id, action, entity_type, created_at, metadata").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("keyword_trackers").select("id, keyword, status, alert_threshold, created_at").eq("organization_id", organization.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
  ]);
  const failed = [signals.error, drafts.error, convertedLeads.error, repliedLeads.error, contactedLeads.error, activities.error, trackers.error].find(Boolean);
  if (failed) throw new Error("Dashboard data could not be loaded. Refresh or contact your administrator.");
  const converted = convertedLeads.count ?? 0;
  const replies = repliedLeads.count ?? 0;
  const contacted = contactedLeads.count ?? 0;
  const replyRate = contacted ? `${Math.round((replies / contacted) * 100)}%` : "—";
  const latestSignals = signals.data ?? [];
  const activityRows = activities.data ?? [];
  const trackerRows = trackers.data ?? [];

  return <div className="space-y-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-violet-300">{organization.name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Workspace overview</h1><p className="mt-2 text-sm text-slate-400">Live counts based on records saved to this organization.</p></div><Link href="/campaigns/new" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold hover:bg-violet-500">Create tracker <ArrowUpRight className="size-4" /></Link></div>
    <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Signals today" value={String(signals.count ?? 0)} caption="Stored since midnight UTC" icon={Radar} />
      <Metric label="Drafts in review" value={String(drafts.count ?? 0)} caption="Saved outreach drafts" icon={MessageSquareText} />
      <Metric label="Reply rate" value={replyRate} caption={`${replies} replied from ${contacted} contacted leads`} icon={BadgeCheck} />
      <Metric label="Conversions" value={String(converted)} caption="Leads marked converted" icon={Users} />
    </section>
    <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <section className="rounded-xl border border-white/10 bg-slate-900/50"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><h2 className="font-semibold">Latest intent signals</h2><p className="mt-1 text-xs text-slate-500">Newest records collected for this workspace</p></div><Link href="/intents" className="text-xs text-violet-300 hover:text-violet-200">View all</Link></div>
        {latestSignals.length ? <ul className="divide-y divide-white/[.07]">{latestSignals.map((signal) => <li key={signal.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium">{signal.prospect_name || "Prospect not identified"}{signal.company ? <span className="font-normal text-slate-400"> · {signal.company}</span> : null}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{signal.post_snippet}</p><p className="mt-2 text-xs text-slate-500">{signal.platform} · {signal.keyword} · {new Date(signal.created_at).toLocaleString()}</p></div><span className="shrink-0 rounded-full border border-violet-300/20 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-200">{signal.intent_score} intent</span></li>)}</ul> : <Empty title="No intent signals yet" body="Signals appear after an authorized source or ingestion integration sends real data." href="/integrations" action="Configure sources" />}
      </section>
      <section className="rounded-xl border border-white/10 bg-slate-900/50"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Keyword trackers</h2><p className="mt-1 text-xs text-slate-500">Configured by your team</p></div>
        {trackerRows.length ? <ul className="divide-y divide-white/[.07]">{trackerRows.map((tracker) => <li key={tracker.id} className="flex items-center justify-between px-5 py-4"><div><p className="text-sm font-medium">{tracker.keyword}</p><p className="mt-1 text-xs text-slate-500">Alert threshold: {tracker.alert_threshold}%</p></div><span className="text-xs capitalize text-slate-400">{tracker.status}</span></li>)}</ul> : <Empty title="No trackers configured" body="Add the keywords your team wants to monitor." href="/campaigns/new" action="Create tracker" />}
      </section>
    </div>
    <section className="rounded-xl border border-white/10 bg-slate-900/50"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Recent team activity</h2></div>
      {activityRows.length ? <ul className="divide-y divide-white/[.07]">{activityRows.map((item) => <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3"><p className="text-sm">{item.action.replaceAll(".", " ")}</p><time className="shrink-0 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</time></li>)}</ul> : <p className="px-5 py-8 text-sm text-slate-400">No activity has been recorded in this workspace.</p>}
    </section>
    <p className="text-xs text-slate-500">Signed in as {user.email}</p>
  </div>;
}

function Empty({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return <div className="px-5 py-10 text-center"><p className="text-sm font-medium">{title}</p><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">{body}</p><Link href={href} className="mt-4 inline-flex text-xs font-semibold text-violet-300 hover:text-violet-200">{action} <ArrowUpRight className="ml-1 size-3" /></Link></div>;
}
