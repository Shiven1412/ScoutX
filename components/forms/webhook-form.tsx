"use client";

import { useState, useTransition } from "react";
import { createWebhook } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function WebhookForm() {
  const [error, setError] = useState<string>(); const [secret, setSecret] = useState<string>(); const [pending, startTransition] = useTransition();
  return <form className="space-y-4" action={(data) => startTransition(async () => { setError(undefined); const result = await createWebhook(data); if (result?.error) setError(result.error); else if (result && "secret" in result) setSecret(result.secret); })}>
    <FormField label="Webhook name"><Input name="name" minLength={2} maxLength={100} required /></FormField>
    <FormField label="HTTPS endpoint"><Input name="endpointUrl" type="url" placeholder="https://example.com/scoutx" required /></FormField>
    <FormField label="Events (comma separated)"><Input name="events" placeholder="signal.created, lead.updated" required /></FormField>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {secret && <div role="status" className="break-all rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100"><p className="font-semibold">Signing secret. Copy it now; it will not be shown again.</p><code className="mt-2 block select-all">{secret}</code></div>}
    <Button disabled={pending}>{pending ? "Saving…" : "Register webhook"}</Button>
  </form>;
}
