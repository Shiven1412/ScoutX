"use client";

import { useState, useTransition } from "react";
import { saveSlackChannel } from "@/actions/integrations";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function SlackChannelForm({ channelId }: { channelId: string }) {
  const [message, setMessage] = useState<{ error?: string; success?: string }>(); const [pending, startTransition] = useTransition();
  return <form className="mt-4 flex flex-wrap items-end gap-3" action={(data) => startTransition(async () => { const result = await saveSlackChannel(data); setMessage(result?.error ? { error: result.error } : { success: "Slack notification channel saved." }); })}>
    <FormField label="Slack channel/conversation ID"><Input name="channelId" defaultValue={channelId} placeholder="C0123456789" required maxLength={25} className="min-w-56" /></FormField>
    <Button size="sm" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save channel"}</Button>
    {message?.error && <p role="alert" className="w-full text-xs text-red-300">{message.error}</p>}{message?.success && <p role="status" className="w-full text-xs text-emerald-300">{message.success}</p>}
  </form>;
}
