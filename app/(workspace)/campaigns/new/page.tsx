import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { TrackerForm } from "@/components/forms/tracker-form";
import { TrackerManualForm } from "@/components/forms/tracker-manual-form";

export const metadata: Metadata = { title: "Create tracker" };

export default async function NewTrackerPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: requestedMode } = await searchParams;
  const manualMode = requestedMode === "manual";
  const cookieStore = await cookies();
  const description = cookieStore.get("scoutx_tracker_brief")?.value ?? "";
  return <div className="mx-auto max-w-3xl"><Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">← Back to trackers</Link><h1 className="mt-4 text-3xl font-semibold">Create a tracker</h1><p className="mt-2 text-sm text-slate-400">Choose an AI-suggested plan or enter your monitoring rules yourself.</p>
    <nav aria-label="Tracker setup method" className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-1"><Link href="/campaigns/new" aria-current={!manualMode ? "page" : undefined} className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${!manualMode ? "bg-indigo-500/20 text-indigo-100" : "text-slate-400 hover:text-white"}`}>AI-assisted</Link><Link href="/campaigns/new?mode=manual" aria-current={manualMode ? "page" : undefined} className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${manualMode ? "bg-indigo-500/20 text-indigo-100" : "text-slate-400 hover:text-white"}`}>Manual setup</Link></nav>
    <section className="mt-4 rounded-xl border border-white/10 bg-slate-900/50 p-6">{manualMode ? <TrackerManualForm /> : <TrackerForm initialDescription={description} />}</section></div>;
}
