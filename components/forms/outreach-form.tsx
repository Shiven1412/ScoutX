"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createOutreachDraft, saveOutreachEdits } from "@/actions/outreach";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";
import { outreachSchema } from "@/lib/validation/records";
import type { Database } from "@/types/database";

type Lead = Pick<Database["public"]["Tables"]["leads"]["Row"], "id" | "name" | "company" | "email">;
type Message = Pick<Database["public"]["Tables"]["outreach_messages"]["Row"], "id" | "lead_id" | "channel" | "subject" | "content">;

export function OutreachForm({ leads, message }: { leads: Lead[]; message?: Message }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(outreachSchema),
    defaultValues: { leadId: message?.lead_id ?? "", channel: message?.channel ?? "email", subject: message?.subject ?? "", content: message?.content ?? "" },
  });
  const submit = form.handleSubmit((values) => {
    const data = new FormData();
    if (message) data.set("id", message.id);
    Object.entries(values).forEach(([key, value]) => data.set(key, String(value ?? "")));
    setError(undefined);
    startTransition(async () => {
      const result = message ? await saveOutreachEdits(data) : await createOutreachDraft(data);
      if (result?.error) setError(result.error);
      else if (message) window.location.reload();
    });
  });

  return <form className="space-y-5" onSubmit={submit} noValidate>
    <FormField label="Linked lead" error={form.formState.errors.leadId?.message}><select {...form.register("leadId")} className="h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="">No lead linked</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name} · {lead.company}{lead.email ? ` · ${lead.email}` : ""}</option>)}</select></FormField>
    <FormField label="Channel" error={form.formState.errors.channel?.message}><select {...form.register("channel")} className="h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="email">Email</option><option value="linkedin">LinkedIn</option></select></FormField>
    <FormField label="Subject" error={form.formState.errors.subject?.message}><Input {...form.register("subject")} maxLength={300} /></FormField>
    <FormField label="Message" error={form.formState.errors.content?.message}><textarea {...form.register("content")} rows={12} maxLength={20000} className="w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 outline-none focus:border-violet-400" /></FormField>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : message ? "Save changes" : "Save draft"}</Button>
  </form>;
}
