"use client";

import { useState, useTransition } from "react";
import { createTracker } from "@/actions/trackers";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function TrackerForm() {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return <form className="mt-6 space-y-5" action={(data) => startTransition(async () => {
    setError(undefined);
    const result = await createTracker(data);
    if (result?.error) setError(result.error);
    else window.location.assign("/campaigns");
  })}>
    <FormField label="Keyword"><Input name="keyword" minLength={2} maxLength={180} required /></FormField>
    <FormField label="Exclude phrases (comma separated)"><Input name="negativeKeywords" /></FormField>
    <FormField label="Communities to include (comma separated)"><Input name="communities" placeholder="r/sales, r/saas" /></FormField>
    <FormField label="Sources to monitor (comma separated)"><Input name="platforms" placeholder="reddit, hackernews, rss" /></FormField>
    <FormField label="Alert threshold (0–100)"><Input name="alertThreshold" type="number" min={0} max={100} defaultValue={75} required /></FormField>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save tracker"}</Button>
  </form>;
}
