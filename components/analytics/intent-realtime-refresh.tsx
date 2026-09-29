"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function IntentRealtimeRefresh({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);

  useEffect(() => {
    posthog.capture("intent_feed_viewed");
    const client = createClient();
    const channel = client.channel(`intent-feed-${organizationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "intent_signals", filter: `organization_id=eq.${organizationId}` }, () => {
        router.refresh();
      })
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        liveRef.current = connected;
        setLive(connected);
      });
    const fallback = window.setInterval(() => {
      if (!liveRef.current) router.refresh();
    }, 15_000);
    return () => { window.clearInterval(fallback); void client.removeChannel(channel); };
  }, [organizationId, router]);

  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${live ? "border-emerald-300/20 bg-emerald-300/[.06] text-emerald-200" : "border-white/10 text-slate-500"}`} aria-live="polite"><Radio className={`size-3 ${live ? "animate-pulse" : ""}`} />{live ? "Live feed" : "Connecting live feed"}</span>;
}
