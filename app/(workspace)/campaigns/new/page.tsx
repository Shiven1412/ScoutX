import type { Metadata } from "next";
import Link from "next/link";
import { TrackerForm } from "@/components/forms/tracker-form";

export const metadata: Metadata = { title: "Create tracker" };

export default function NewTrackerPage() {
  return <div className="mx-auto max-w-2xl"><Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">← Back to trackers</Link><h1 className="mt-4 text-3xl font-semibold">Create keyword tracker</h1><p className="mt-2 text-sm text-slate-400">Set organization-specific keywords and source criteria.</p><section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-6"><TrackerForm /></section></div>;
}
