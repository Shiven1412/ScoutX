import Link from "next/link";
import { OutreachForm } from "@/components/forms/outreach-form";
import { requireOrganization } from "@/lib/organization";

export default async function NewOutreachPage() {
  const { supabase, organization } = await requireOrganization();
  const { data: leads, error } = await supabase.from("leads").select("id, name, company, email").eq("organization_id", organization.id).is("deleted_at", null).order("name").limit(500);
  if (error) throw new Error("Leads could not be loaded for the draft form.");
  return <div className="mx-auto max-w-3xl"><Link href="/outreach" className="text-sm text-slate-400 hover:text-white">← Back to outreach</Link><h1 className="mt-4 text-3xl font-semibold">Create outreach draft</h1><p className="mt-2 text-sm text-slate-400">Draft content is stored in your workspace and is not sent automatically.</p><section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-6"><OutreachForm leads={leads ?? []} /></section></div>;
}
