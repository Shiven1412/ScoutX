"use client";

import { useState, useTransition } from "react";
import { updateOrganization, updateProfile } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

function useSave(action: (data: FormData) => Promise<{ error?: string; success?: boolean }>) {
  const [message, setMessage] = useState<{ error?: string; success?: string }>(); const [pending, startTransition] = useTransition();
  function run(data: FormData) { setMessage(undefined); startTransition(async () => { const result = await action(data); setMessage(result?.error ? { error: result.error } : { success: "Changes saved." }); }); }
  return { message, pending, run };
}

export function ProfileSettingsForm({ fullName, company, industry }: { fullName: string; company: string; industry: string }) {
  const state = useSave(updateProfile);
  return <form className="space-y-4" action={state.run}><FormField label="Full name"><Input name="fullName" defaultValue={fullName} maxLength={120} required /></FormField><FormField label="Company"><Input name="company" defaultValue={company} maxLength={120} /></FormField><FormField label="Industry"><Input name="industry" defaultValue={industry} maxLength={100} /></FormField><Result message={state.message} /><Button disabled={state.pending}>{state.pending ? "Saving…" : "Save profile"}</Button></form>;
}

export function OrganizationSettingsForm({ name, industry }: { name: string; industry: string }) {
  const state = useSave(updateOrganization);
  return <form className="space-y-4" action={state.run}><FormField label="Workspace name"><Input name="name" defaultValue={name} maxLength={120} required /></FormField><FormField label="Industry"><Input name="industry" defaultValue={industry} maxLength={100} /></FormField><Result message={state.message} /><Button disabled={state.pending}>{state.pending ? "Saving…" : "Save workspace"}</Button></form>;
}

function Result({ message }: { message?: { error?: string; success?: string } }) {
  return message?.error ? <p role="alert" className="text-sm text-red-300">{message.error}</p> : message?.success ? <p role="status" className="text-sm text-emerald-300">{message.success}</p> : null;
}
