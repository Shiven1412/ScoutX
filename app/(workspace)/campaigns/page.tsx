import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { setTrackerStatus, deleteTracker } from "@/actions/trackers";
import { ActionButton } from "@/components/forms/action-button";
import { requireOrganization } from "@/lib/organization";

export default async function CampaignsPage() {
  const { supabase, organization } = await requireOrganization();
  const { data: trackers, error } = await supabase.from("keyword_trackers").select("id, keyword, platforms, communities, negative_keywords, alert_threshold, status, last_run_at, created_at").eq("organization_id", organization.id).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw new Error("Keyword trackers could not be loaded.");
  const rows = trackers ?? [];
  const { data: analytics, error: analyticsError } = rows.length
    ? await supabase.rpc("get_tracker_signal_analytics", { target_org: organization.id, target_trackers: rows.map((row) => row.id) })
    : { data: [], error: null };
  if (analyticsError) throw new Error("Tracker signal analytics could not be loaded.");
  const analyticsByTracker = new Map((analytics ?? []).map((row) => [row.tracker_id, row]));
  const active = rows.filter((row) => row.status === "active").length;
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-violet-300">Signal discovery</p><h1 className="mt-2 text-3xl font-semibold">Keyword trackers</h1><p className="mt-2 text-sm text-slate-400">Manage organization-owned monitoring criteria.</p></div><Link href="/campaigns/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold hover:bg-violet-500"><Plus className="size-4" />Add tracker</Link></div>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Trackers" value={rows.length} /><Metric label="Active" value={active} /><Metric label="Paused" value={rows.length - active} /></div>
    {rows.length ? <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50"><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Keyword</th><th className="px-4 py-3">Sources</th><th className="px-4 py-3">Last run</th><th className="px-4 py-3">Today / 7d / 30d</th><th className="px-4 py-3">Excluded terms</th><th className="px-4 py-3">Threshold</th><th className="px-4 py-3">Status</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-white/[.07]">{rows.map((row) => { const stats = analyticsByTracker.get(row.id); return <tr key={row.id}><td className="px-5 py-4 font-medium">{row.keyword}</td><td className="px-4 py-4 text-slate-400">{row.platforms.join(", ") || "No sources selected"}</td><td className="px-4 py-4 text-slate-400">{formatLastRun(row.last_run_at)}</td><td className="px-4 py-4 tabular-nums">{stats?.signals_today ?? 0} / {stats?.signals_7d ?? 0} / {stats?.signals_30d ?? 0}</td><td className="px-4 py-4 text-slate-400">{row.negative_keywords.join(", ") || "—"}</td><td className="px-4 py-4">{row.alert_threshold}%</td><td className="px-4 py-4 capitalize">{row.status}</td><td className="flex items-center gap-2 px-5 py-4"><Link href={`/campaigns/${row.id}`} className="text-xs text-violet-300">Manage</Link><ActionButton size="sm" variant="secondary" action={setTrackerStatus} fields={{ id: row.id, status: row.status === "active" ? "paused" : "active" }}>{row.status === "active" ? "Pause" : "Resume"}</ActionButton><ActionButton size="sm" variant="ghost" action={deleteTracker} fields={{ id: row.id }}>Archive</ActionButton></td></tr>; })}</tbody></table></div></div> : <div className="rounded-xl border border-dashed border-white/15 px-6 py-16 text-center"><h2 className="font-medium">No keyword trackers yet</h2><p className="mt-2 text-sm text-slate-400">Create your first real tracker to define what this workspace wants to monitor.</p><Link href="/campaigns/new" className="mt-4 inline-flex text-sm text-violet-300">Create tracker <ArrowUpRight className="ml-1 size-4" /></Link></div>}</div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }

function formatLastRun(value: string | null) {
  if (!value) return "Never";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed >= 24 * 60 * 60 * 1000) return new Date(value).toLocaleString("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
