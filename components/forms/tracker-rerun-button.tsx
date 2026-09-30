"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { rerunTracker } from "@/actions/trackers";
import { Button } from "@/components/ui/button";

export function TrackerRerunButton({ trackerId, disabled = false, diagnosticMode = false }: { trackerId: string; disabled?: boolean; diagnosticMode?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function run() {
    setError("");
    const data = new FormData();
    data.set("id", trackerId);
    data.set("diagnosticMode", String(diagnosticMode));
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
  return <div className="space-y-2"><Button type="button" variant={diagnosticMode ? "secondary" : "primary"} disabled={disabled || pending} onClick={run}>{pending ? "Starting…" : <><Play className="mr-2 size-4" />{diagnosticMode ? "Run diagnostic test" : "Run tracker now"}</>}</Button>{diagnosticMode && <p className="max-w-xs text-[11px] leading-4 text-slate-500">Fetches and previews up to 10 raw records; it does not score or save signals.</p>}{error && <p role="alert" className="max-w-xs text-xs text-red-200">{error}</p>}</div>;
}