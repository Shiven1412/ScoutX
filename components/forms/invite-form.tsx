"use client";

import { useState, useTransition } from "react";
import { inviteMember } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function InviteForm() {
  const [message, setMessage] = useState<{ error?: string; success?: string }>(); const [pending, startTransition] = useTransition();
  return <form className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end" action={(data) => startTransition(async () => { setMessage(undefined); const result = await inviteMember(data); setMessage(result?.error ? { error: result.error } : { success: "Invitation sent." }); })}>
    <FormField label="Email"><Input type="email" name="email" autoComplete="email" required /></FormField>
    <FormField label="Role"><select name="role" className="h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="member">Member</option><option value="admin">Admin</option></select></FormField>
    <Button disabled={pending}>{pending ? "Sending…" : "Invite"}</Button>
    {message?.error && <p role="alert" className="text-sm text-red-300 sm:col-span-3">{message.error}</p>}{message?.success && <p role="status" className="text-sm text-emerald-300 sm:col-span-3">{message.success}</p>}
  </form>;
}
