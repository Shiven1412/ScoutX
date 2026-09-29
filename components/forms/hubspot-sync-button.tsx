"use client";

import { useState, useTransition } from "react";
import { syncHubSpotLeads } from "@/actions/integrations";
import { Button } from "@/components/ui/button";

export function HubSpotSyncButton() {
  const [message, setMessage] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div className="mt-3"><Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => { setMessage(undefined); const result = await syncHubSpotLeads(); setMessage(result?.error ?? (result ? `Synced ${result.synced}; failed ${result.failed}.` : "Sync completed.")); })}>{pending ? "Syncing leads…" : "Sync workspace leads"}</Button>{message && <p role="status" className="mt-2 text-xs text-slate-400">{message}</p>}</div>;
}
