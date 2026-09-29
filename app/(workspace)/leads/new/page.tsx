import Link from "next/link";
import { LeadForm } from "@/components/forms/lead-form";

export default function NewLeadPage() {
  return <div className="mx-auto max-w-3xl"><Link href="/leads" className="text-sm text-slate-400 hover:text-white">← Back to leads</Link><h1 className="mt-4 text-3xl font-semibold">Add lead</h1><p className="mt-2 text-sm text-slate-400">Store an actual prospect and its current pipeline state.</p><section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-6"><LeadForm /></section></div>;
}
