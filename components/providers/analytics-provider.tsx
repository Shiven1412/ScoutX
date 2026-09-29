"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

export function AnalyticsProvider({ children, apiKey, host }: { children: React.ReactNode; apiKey?: string; host: string }) {
  const pathname = usePathname();
  const initialized = useRef(false);
  useEffect(() => {
    if (!apiKey || initialized.current) return;
    posthog.init(apiKey, { api_host: host, capture_pageview: false, capture_pageleave: true, autocapture: false, disable_session_recording: true, person_profiles: "identified_only", persistence: "cookie" });
    initialized.current = true;
  }, [apiKey, host]);
  useEffect(() => {
    if (!apiKey || !initialized.current || !pathname) return;
    posthog.capture("$pageview", { $current_url: `${window.location.origin}${pathname}` });
  }, [apiKey, pathname]);
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
