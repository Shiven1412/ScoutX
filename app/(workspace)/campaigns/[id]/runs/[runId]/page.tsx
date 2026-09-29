import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrganization } from "@/lib/organization";
import { TrackerRunMonitor } from "@/components/forms/tracker-run-monitor";

export default async function TrackerRunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(runId)) return <p className="text-sm text-slate-400">Tracker run not found.</p>;
  const { supabase, organization } = await requireOrganization();
  const [runResult, trackerResult, eventsResult, signalsResult, rulesResult] = await Promise.all([
    supabase.from("tracker_runs").select("id, tracker_id, status, progress, signals_found, providers_total, providers_completed, last_error, started_at, completed_at, created_at").eq("id", runId).eq("tracker_id", id).eq("organization_id", organization.id).maybeSingle(),
    supabase.from("keyword_trackers").select("id, keyword, platforms, communities").eq("id", id).eq("organization_id", organization.id).maybeSingle(),
    supabase.from("tracker_events").select("id, run_id, event_type, title, details, created_at").eq("run_id", runId).eq("tracker_id", id).eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("intent_signals").select("id, platform, provider, community, post_snippet, confidence, intent_score, category, keyword, created_at").eq("tracker_id", id).eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("tracker_keywords").select("id").eq("tracker_id", id).eq("organization_id", organization.id),
  ]);
  const run = runResult.data;
  const tracker = trackerResult.data;
  if (runResult.error || trackerResult.error || !run || !tracker) return <div className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h1 className="text-xl font-semibold">Tracker run unavailable</h1><p className="mt-2 text-sm text-slate-400">This run may have expired or may not belong to your workspace.</p><Link href="/campaigns" className="mt-4 inline-flex text-sm text-indigo-300">Back to trackers</Link></div>;
  const currentRunSignals = (signalsResult.data ?? []).filter((signal) => signal.created_at >= run.created_at);
  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft className="size-4" />Back to trackers</Link>
    <TrackerRunMonitor initialRun={run} initialEvents={eventsResult.data ?? []} initialSignals={currentRunSignals} tracker={tracker} keywordCount={rulesResult.data?.length ?? 0} />
  </div>;
}
