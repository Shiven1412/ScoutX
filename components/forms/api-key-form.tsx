"use client";

import { useState, useTransition } from "react";
import { createApiKey } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function ApiKeyForm() {
  const [error, setError] = useState<string>(); const [secret, setSecret] = useState<string>(); const [pending, startTransition] = useTransition();
  return <form className="space-y-4" action={(data) => startTransition(async () => { setError(undefined); const result = await createApiKey(data); if (result?.error) setError(result.error); else if (result && "secret" in result) setSecret(result.secret); })}>
    <FormField label="Key name"><Input name="name" minLength={2} maxLength={100} required /></FormField>
    <FormField label="Expires in days (optional)"><Input name="expiresInDays" type="number" min={1} max={365} /></FormField>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {secret && <div role="status" className="break-all rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100"><p className="font-semibold">Copy this key now. It will not be shown again.</p><code className="mt-2 block select-all">{secret}</code></div>}
    <Button disabled={pending}>{pending ? "Creating…" : "Create API key"}</Button>
  </form>;
}
