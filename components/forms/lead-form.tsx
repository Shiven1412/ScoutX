"use client";

import { useState, useTransition } from "react";
import { createLead, updateLead } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

export function LeadForm({ lead }: { lead?: Lead }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const action = lead ? updateLead : createLead;
  return <form className="grid gap-5 sm:grid-cols-2" action={(data) => startTransition(async () => {
    setError(undefined);
    const result = await action(data);
    if (result?.error) setError(result.error);
    else window.location.assign(lead ? `/leads/${lead.id}` : `/leads${result && "id" in result && result.id ? `/${result.id}` : ""}`);
  })}>
    {lead && <input type="hidden" name="id" value={lead.id} />}
    <FormField label="Name"><Input name="name" defaultValue={lead?.name} required maxLength={160} /></FormField>
    <FormField label="Company"><Input name="company" defaultValue={lead?.company} required maxLength={180} /></FormField>
    <FormField label="Job title"><Input name="title" defaultValue={lead?.title ?? ""} maxLength={160} /></FormField>
    <FormField label="Email"><Input type="email" name="email" defaultValue={lead?.email ?? ""} maxLength={254} /></FormField>
    <FormField label="Source platform"><Input name="platform" defaultValue={lead?.platform ?? ""} maxLength={80} /></FormField>
    <FormField label="Estimated value"><Input type="number" name="estimatedValue" min={0} step="0.01" defaultValue={lead?.estimated_value ?? ""} /></FormField>
    <FormField label="Status"><select name="status" defaultValue={lead?.status ?? "new"} className="h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm"><option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="meeting">Meeting</option><option value="converted">Converted</option><option value="disqualified">Disqualified</option></select></FormField>
    <FormField label="Source context" className="sm:col-span-2"><textarea name="sourcePost" defaultValue={lead?.source_post ?? ""} rows={3} maxLength={2000} className="w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm outline-none focus:border-violet-400" /></FormField>
    <FormField label="Notes" className="sm:col-span-2"><textarea name="notes" defaultValue={lead?.notes ?? ""} rows={4} maxLength={10000} className="w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm outline-none focus:border-violet-400" /></FormField>
    {error && <p role="alert" className="text-sm text-red-300 sm:col-span-2">{error}</p>}
    <div className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : lead ? "Save lead" : "Create lead"}</Button></div>
  </form>;
}
