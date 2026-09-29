import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTracker, setTrackerStatus } from "@/actions/trackers";
import { ActionButton } from "@/components/forms/action-button";
import { requireOrganization } from "@/lib/organization";

export default async function TrackerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organization } = await requireOrganization();
  const { data: tracker, error } = await supabase.from("keyword_trackers").select("*").eq("organization_id", organization.id).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Tracker could not be loaded.");
  if (!tracker) notFound();
  const { count, error: signalError } = await supabase.from("intent_signals").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("tracker_id", tracker.id);
  if (signalError) throw new Error("Tracker signal count could not be loaded.");
  return <div className="mx-auto max-w-3xl space-y-6"><Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">← Back to trackers</Link><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-violet-300">{tracker.status}</p><h1 className="mt-2 text-3xl font-semibold">{tracker.keyword}</h1></div><div className="flex gap-2"><ActionButton variant="secondary" action={setTrackerStatus} fields={{ id, status: tracker.status === "active" ? "paused" : "active" }}>{tracker.status === "active" ? "Pause" : "Resume"}</ActionButton><ActionButton variant="ghost" action={deleteTracker} fields={{ id }}>Archive</ActionButton></div></div><section className="grid gap-3 sm:grid-cols-2"><Detail label="Signals saved" value={count ?? 0} /><Detail label="Alert threshold" value={`${tracker.alert_threshold}%`} /><Detail label="Sources" value={tracker.platforms.join(", ") || "No sources configured"} /><Detail label="Communities" value={tracker.communities.join(", ") || "No communities configured"} /><Detail label="Excluded phrases" value={tracker.negative_keywords.join(", ") || "None"} /></section><p className="rounded-xl border border-white/10 bg-slate-900/50 p-5 text-sm leading-6 text-slate-400">A tracker stores the criteria for signal ingestion. Collection only occurs through an authorized connected provider; no sample signals are fabricated.</p></div>;
}

function Detail({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-sm font-medium">{value}</p></div>; }
