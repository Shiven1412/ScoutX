import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteLead } from "@/actions/leads";
import { ActionButton } from "@/components/forms/action-button";
import { LeadForm } from "@/components/forms/lead-form";
import { requireOrganization } from "@/lib/organization";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organization } = await requireOrganization();
  const { data: lead, error } = await supabase.from("leads").select("*").eq("organization_id", organization.id).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Lead could not be loaded.");
  if (!lead) notFound();
  const [activity, outreach] = await Promise.all([
    supabase.from("activity_logs").select("id, action, created_at, metadata").eq("organization_id", organization.id).eq("entity_type", "lead").eq("entity_id", lead.id).order("created_at", { ascending: false }).limit(25),
    supabase.from("outreach_messages").select("id, subject, status, created_at").eq("organization_id", organization.id).eq("lead_id", lead.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
  ]);
  if (activity.error || outreach.error) throw new Error("Lead history could not be loaded.");
  return <div className="mx-auto max-w-4xl space-y-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/leads" className="text-sm text-slate-400 hover:text-white">← Back to leads</Link><h1 className="mt-4 text-3xl font-semibold">{lead.name}</h1><p className="mt-2 text-sm text-slate-400">{lead.company} · {lead.status}</p></div><ActionButton variant="ghost" action={deleteLead} fields={{ id: lead.id }}>Archive lead</ActionButton></div>
    <section className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="mb-5 font-semibold">Lead details</h2><LeadForm lead={lead} /></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Activity timeline</h2>{activity.data?.length ? <ul className="mt-4 space-y-4">{activity.data.map((item) => <li key={item.id} className="border-l border-violet-400/30 pl-4"><p className="text-sm capitalize">{item.action.replaceAll(".", " ")}</p><time className="mt-1 block text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</time></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No activity recorded.</p>}</section><section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Outreach history</h2>{outreach.data?.length ? <ul className="mt-4 space-y-3">{outreach.data.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 border-b border-white/[.07] pb-3"><Link className="truncate text-sm text-violet-200" href={`/outreach/${item.id}`}>{item.subject}</Link><span className="shrink-0 text-xs capitalize text-slate-500">{item.status}</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No outreach messages linked.</p>}</section></div>
  </div>;
}
