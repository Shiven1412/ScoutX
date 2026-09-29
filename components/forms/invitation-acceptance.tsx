"use client";

import { useState, useTransition } from "react";
import { acceptInvitation } from "@/actions/settings";
import { Button } from "@/components/ui/button";

export function InvitationAcceptance({ organizationId }: { organizationId: string }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button disabled={pending} onClick={() => startTransition(async () => { const data = new FormData(); data.set("organizationId", organizationId); const result = await acceptInvitation(data); setError(result?.error); })}>{pending ? "Accepting…" : "Accept invitation"}</Button>{error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}</div>;
}
