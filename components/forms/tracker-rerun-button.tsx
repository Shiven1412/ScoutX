"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { rerunTracker } from "@/actions/trackers";
import { Button } from "@/components/ui/button";

export function TrackerRerunButton({ trackerId, disabled = false }: { trackerId: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function run() {
    setError("");
    const data = new FormData();
    data.set("id", trackerId);
    startTransition(async () => {
      try {
        const result = await rerunTracker(data);
        if (result.error) { setError(result.error); return; }
        if (!result.success || !result.runId) { setError("The collection run could not be started."); return; }
        router.push(`/campaigns/${trackerId}/runs/${result.runId}`);
      } catch {
        setError("The collection run could not be started. Please try again.");
      }
    });
  }
  return <div className="space-y-2"><Button type="button" disabled={disabled || pending} onClick={run}>{pending ? "Starting…" : <><Play className="mr-2 size-4" />Run tracker now</>}</Button>{error && <p role="alert" className="max-w-xs text-xs text-red-200">{error}</p>}</div>;
}