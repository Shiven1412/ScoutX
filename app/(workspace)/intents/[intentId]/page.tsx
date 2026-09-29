import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { generateDraftFromSignal } from "@/actions/outreach";
import { saveSignalAsLead } from "@/actions/intents";
import { ActionButton } from "@/components/forms/action-button";
import { requireOrganization } from "@/lib/organization";

export default async function IntentDetailPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const { supabase, organization } = await requireOrganization();
  const { data: signal, error } = await supabase.from("intent_signals").select("*").eq("id", intentId).eq("organization_id", organization.id).maybeSingle();
  if (error) throw new Error("Signal could not be loaded.");
  if (!signal) notFound();
  const { data: lead } = await supabase.from("leads").select("id").eq("intent_signal_id", signal.id).eq("organization_id", organization.id).is("deleted_at", null).limit(1).maybeSingle();
  return <div className="space-y-6">
    <Link href="/intents" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft className="size-4" />Back to signals</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-violet-300">{signal.platform} · {signal.keyword}</p><h1 className="mt-2 text-3xl font-semibold">{signal.prospect_name || "Prospect not identified"}</h1><p className="mt-2 text-sm text-slate-400">{signal.company || "Company not identified"} · {new Date(signal.created_at).toLocaleString()}</p></div><div className="flex flex-wrap gap-2">{lead ? <Link href={`/leads/${lead.id}`} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Open saved lead</Link> : <ActionButton action={saveSignalAsLead} fields={{ signalId: signal.id }} variant="secondary">Save lead</ActionButton>}<ActionButton action={generateDraftFromSignal} fields={{ signalId: signal.id, channel: "email" }}>Generate email draft</ActionButton></div></div>
    <div className="grid gap-4 lg:grid-cols-[1.4fr_.7fr]">
      <article className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><div className="flex items-center justify-between"><h2 className="font-semibold">Source context</h2>{signal.source_url && <a href={signal.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-300">Open source <ExternalLink className="size-3" /></a>}</div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-300">{signal.post_snippet}</p><p className="mt-5 text-xs text-slate-500">External source: {signal.external_id}</p></article>
      <aside className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="font-semibold">Signal analysis</h2><div className="mt-4 grid grid-cols-2 gap-3">{[["Intent", signal.intent_score], ["Confidence", signal.confidence], ["Buying probability", signal.buying_probability], ["Urgency", signal.urgency], ["Pain intensity", signal.pain_intensity], ["Budget intent", signal.budget_intent], ["Decision maker", signal.decision_maker_likelihood]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[.07] bg-white/[.025] p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold">{value}%</p></div>)}</div><p className="mt-4 rounded-lg bg-violet-400/[.07] p-3 text-sm capitalize text-violet-100">{signal.category.replaceAll("_", " ")}</p></aside>
    </div>
  </div>;
}
