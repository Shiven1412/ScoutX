"use client";

import { useState, useTransition } from "react";
import { startProviderOAuth } from "@/actions/provider-oauth";
import { SlackChannelForm } from "@/components/forms/slack-channel-form";
import { HubSpotSyncButton } from "@/components/forms/hubspot-sync-button";
import { Button } from "@/components/ui/button";

export function ProviderConnect({ provider, configured, connected, channelId = "" }: { provider: "slack" | "hubspot"; configured: boolean; connected: boolean; channelId?: string }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return <div className="shrink-0">
    <Button type="button" size="sm" variant="secondary" disabled={!configured || pending} onClick={() => startTransition(async () => {
      setError(undefined);
      const form = new FormData(); form.set("provider", provider);
      const result = await startProviderOAuth(form);
      if (result?.error) setError(result.error);
    })}>{pending ? "Connecting…" : !configured ? "OAuth not configured" : connected ? "Reconnect" : "Connect"}</Button>
    {error && <p role="alert" className="mt-2 max-w-48 text-xs text-red-300">{error}</p>}
    {connected && provider === "slack" && <SlackChannelForm channelId={channelId} />}
    {connected && provider === "hubspot" && <HubSpotSyncButton />}
  </div>;
}
