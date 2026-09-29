import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { TrackerForm } from "@/components/forms/tracker-form";

export const metadata: Metadata = { title: "Create tracker" };

export default async function NewTrackerPage() {
  const cookieStore = await cookies();
  const description = cookieStore.get("scoutx_tracker_brief")?.value ?? "";
  return <div className="mx-auto max-w-3xl"><Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">← Back to trackers</Link><h1 className="mt-4 text-3xl font-semibold">Create an AI-powered tracker</h1><p className="mt-2 text-sm text-slate-400">Describe your business. ScoutX will suggest the discovery plan; review and edit it before anything is saved.</p><section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-6"><TrackerForm initialDescription={description} /></section></div>;
}
