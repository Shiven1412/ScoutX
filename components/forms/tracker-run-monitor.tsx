"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Activity, ArrowUpRight, Check, CircleAlert, Clock3, Radio, Sparkles, Zap } from "lucide-react";
import { getTrackerRunSnapshot } from "@/actions/trackers";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/types/database";

type Run = Pick<Database["public"]["Tables"]["tracker_runs"]["Row"], "id" | "tracker_id" | "status" | "progress" | "signals_found" | "providers_total" | "providers_completed" | "last_error" | "diagnostic_mode" | "started_at" | "completed_at" | "created_at">;
type Event = Pick<Database["public"]["Tables"]["tracker_events"]["Row"], "id" | "run_id" | "event_type" | "title" | "details" | "created_at">;
type Signal = Pick<Database["public"]["Tables"]["intent_signals"]["Row"], "id" | "platform" | "provider" | "community" | "post_snippet" | "confidence" | "intent_score" | "category" | "keyword" | "created_at">;
type Tracker = Pick<Database["public"]["Tables"]["keyword_trackers"]["Row"], "id" | "keyword" | "platforms"> & { communities: string[] };

export function TrackerRunMonitor({ initialRun, initialEvents, initialSignals, tracker, keywordCount }: { initialRun: Run; initialEvents: Event[]; initialSignals: Signal[]; tracker: Tracker; keywordCount: number }) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(initialEvents);
  const [signals, setSignals] = useState(initialSignals);
  const [realtime, setRealtime] = useState<"connecting" | "live" | "polling">("connecting");
  const firstSignalTracked = useRef(false);
  const seenEventIds = useRef(new Set(initialEvents.map((event) => event.id)));

  useEffect(() => {
    const client = createClient();
    const channel = client.channel(`tracker-run-${initialRun.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tracker_runs", filter: `id=eq.${initialRun.id}` }, (payload) => {
        setRun((current) => ({ ...current, ...(payload.new as Partial<Run>) }));
        setRealtime("live");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tracker_events", filter: `tracker_id=eq.${tracker.id}` }, (payload) => {
        const event = payload.new as Event;
        if (event.run_id !== initialRun.id) return;
        if (seenEventIds.current.has(event.id)) return;
        seenEventIds.current.add(event.id);
        setEvents((current) => current.some((item) => item.id === event.id) ? current : [event, ...current]);
        if (event.event_type === "provider_connected") posthog.capture("source_connected", { tracker_id: tracker.id, provider: stringDetail(event.details, "provider") });
        setRealtime("live");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "intent_signals", filter: `tracker_id=eq.${tracker.id}` }, (payload) => {
        const signal = payload.new as Signal;
        setSignals((current) => current.some((item) => item.id === signal.id) ? current : [signal, ...current]);
        posthog.capture("signal_detected", { tracker_id: tracker.id, source: signal.platform, confidence: signal.confidence });
        if (!firstSignalTracked.current) {
          firstSignalTracked.current = true;
          posthog.capture("first_signal_detected", { tracker_id: tracker.id, source: signal.platform });
        }
        setRealtime("live");
      })
      .subscribe((status) => setRealtime(status === "SUBSCRIBED" ? "live" : "polling"));
    return () => { void client.removeChannel(channel); };
  }, [initialRun.id, initialRun.status, tracker.id]);

  useEffect(() => {
    if (run.status === "completed" || run.status === "partial" || run.status === "failed") return;
    let cancelled = false;
    const refresh = async () => {
      const snapshot = await getTrackerRunSnapshot(tracker.id, run.id);
      if (cancelled || "error" in snapshot) return;
      setRun(snapshot.run);
      setEvents(snapshot.events);
      setSignals((current) => mergeSignals(current, snapshot.signals.filter((signal) => signal.created_at >= snapshot.run.created_at)));
      setRealtime((state) => state === "live" ? state : "polling");
    };
    const timer = window.setInterval(() => { void refresh(); }, 4_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run.id, run.status, tracker.id]);

  useEffect(() => {
    if (signals.length > 0 && !firstSignalTracked.current) {
      firstSignalTracked.current = true;
      posthog.capture("first_signal_detected", { tracker_id: tracker.id });
    }
  }, [signals, tracker.id]);

  const providerStatus = useMemo(() => {
    const status = new Map<string, string>();
    for (const event of [...events].reverse()) {
      const provider = stringDetail(event.details, "provider");
      const state = stringDetail(event.details, "status");
      if (provider && state) status.set(provider, state);
      if (event.event_type === "provider_completed" && provider) status.set(provider, "active");
      if (event.event_type === "provider_warning" && provider) status.set(provider, "warning");
      if (event.event_type === "provider_failed" && provider) status.set(provider, "error");
    }
    return status;
  }, [events]);
  const displayedProviders = useMemo(() => {
    const providers = new Set(tracker.platforms);
    for (const event of events) {
      const provider = stringDetail(event.details, "provider");
      if (provider && ["reddit", "serper", "firecrawl", "apify", "rss", "hackernews"].includes(provider) && event.event_type.startsWith("provider_")) providers.add(provider);
    }
    return [...providers];
  }, [events, tracker.platforms]);

  const done = ["completed", "partial", "failed"].includes(run.status);
  const progress = Math.min(100, Math.max(0, run.progress));
  const activeProviders = displayedProviders.filter((provider) => providerStatus.get(provider) === "active" || providerStatus.get(provider) === "connected").length;
  const sourceCoverage = run.providers_total ? Math.round(run.providers_completed / run.providers_total * 100) : 0;
  const statusLabel = run.status === "queued" ? "Queued to start" : run.status === "running" ? (run.diagnostic_mode ? "Diagnostic test in progress" : "Collection in progress") : run.status === "partial" ? "Collection complete with warnings" : run.status === "failed" ? "Collection needs attention" : run.diagnostic_mode ? "Diagnostic test complete" : "Collection complete";
  const providerOutcomes = events.filter((event) => ["provider_completed", "provider_warning", "provider_failed"].includes(event.event_type));
  const recordsFetched = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "recordsFetched") ?? detailNumber(event.details, "collected") ?? 0), 0);
  const recordsFiltered = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "recordsFiltered") ?? 0), 0);
  const signalsGenerated = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "signalsGenerated") ?? detailNumber(event.details, "collected") ?? 0), 0);
  const recordsAnalyzed = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "recordsAnalyzed") ?? 0), 0);
  const recordsScored = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "recordsScored") ?? 0), 0);
  const recordsAboveThreshold = providerOutcomes.reduce((total, event) => total + (detailNumber(event.details, "recordsAboveThreshold") ?? 0), 0);
  const geminiStatuses = providerOutcomes.map((event) => stringDetail(event.details, "geminiStatus")).filter((status): status is string => Boolean(status && status !== "not_used"));
  const supabaseStatuses = providerOutcomes.map((event) => stringDetail(event.details, "supabaseStatus")).filter((status): status is string => Boolean(status && status !== "not_attempted"));
  const geminiStatus = geminiStatuses.includes("fallback") ? "Keyword fallback" : geminiStatuses.includes("failed") ? "Failed" : geminiStatuses.length ? "Healthy" : "Not checked";
  const supabaseStatus = supabaseStatuses.includes("failed") || supabaseStatuses.includes("partial_failure") ? "Write failed" : supabaseStatuses.length ? "Writes succeeded" : "Not attempted";
  const previewEvents = events.filter((event) => booleanDetail(event.details, "diagnosticMode") && jsonRecords(event.details, "rawPreview").length > 0);

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-indigo-300/15 bg-gradient-to-br from-indigo-500/[.12] via-slate-900/80 to-slate-950 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.18em] text-indigo-200"><Sparkles className="size-4" />ScoutX discovery</p><h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{tracker.keyword}</h1><p className="mt-2 text-sm text-slate-400">{statusLabel}. Selected providers are collecting and analyzing public conversations.</p></div><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300"><Radio className={`size-3 ${realtime === "live" ? "animate-pulse text-emerald-300" : "text-amber-300"}`} />{realtime === "live" ? "Live updates" : realtime === "polling" ? "Connected · polling backup" : "Connecting to live updates"}</span></div>
      <div className="mt-7"><div className="flex items-center justify-between text-xs"><span className="text-slate-400">Collection run progress</span><span className="font-medium text-indigo-100">{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-300 transition-[width] duration-700 ease-out" style={{ width: `${progress}%` }} /></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={<Activity className="size-4" />} label="Records fetched" value={recordsFetched} /><Metric icon={<Activity className="size-4" />} label="Records analyzed" value={recordsAnalyzed} /><Metric icon={<Sparkles className="size-4" />} label="Records scored" value={recordsScored} /><Metric icon={<Check className="size-4" />} label="Above alert threshold" value={recordsAboveThreshold} /><Metric icon={<CircleAlert className="size-4" />} label="Records filtered" value={recordsFiltered} /><Metric icon={<Sparkles className="size-4" />} label="Signals generated" value={signalsGenerated} /><Metric icon={<Check className="size-4" />} label="Signals saved" value={run.signals_found} /><Metric icon={<Radio className="size-4" />} label="Providers active" value={`${activeProviders}/${displayedProviders.length}`} /><Metric icon={<Radio className="size-4" />} label="Coverage" value={`${sourceCoverage}%`} /></div>
      {!run.diagnostic_mode && <div className="mt-3 flex flex-wrap gap-3 text-xs"><span className={`rounded-full border px-3 py-1.5 ${geminiStatus === "Healthy" ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-100"}`}>Gemini: {geminiStatus}</span><span className={`rounded-full border px-3 py-1.5 ${supabaseStatus === "Writes succeeded" ? "border-emerald-300/20 text-emerald-200" : supabaseStatus === "Write failed" ? "border-red-300/20 text-red-200" : "border-white/10 text-slate-400"}`}>Supabase: {supabaseStatus}</span><span className="self-center text-slate-500">Alert threshold counts are informational; signals below the threshold are still saved.</span></div>}
    </section>

    {run.diagnostic_mode && <section className="rounded-xl border border-sky-300/20 bg-sky-300/[.05] p-5"><h2 className="text-sm font-semibold text-sky-100">Diagnostic test mode</h2><p className="mt-1 text-sm leading-6 text-slate-300">This run bypasses local exclusion, deduplication, scoring, and saving so you can inspect provider output. Providers still receive the configured search keywords. Preview fields are sanitized; at most the first 10 fetched records per provider are shown.</p></section>}

    {previewEvents.map((event) => {
      const provider = stringDetail(event.details, "provider") ?? "Provider";
      const preview = jsonRecords(event.details, "rawPreview");
      return <section key={event.id} className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><details><summary className="cursor-pointer text-sm font-semibold">{providerLabel(provider)} · {preview.length} raw record previews</summary><div className="mt-4 grid gap-3">{preview.map((record, index) => <pre key={`${event.id}-${index}`} className="max-h-64 overflow-auto rounded-lg border border-white/[.07] bg-slate-950 p-3 text-xs leading-5 text-slate-300">{JSON.stringify(record, null, 2)}</pre>)}</div></details></section>;
    })}

    {signals.length > 0 && <section className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.05] p-5" role="status"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><span aria-hidden="true">🎉</span> First intent signal found</p><p className="mt-2 text-sm text-slate-200">{signals[0].post_snippet}</p><p className="mt-3 text-xs text-slate-400">{signals[0].platform} · {signals[0].category.replaceAll("_", " ")} · <Confidence value={signals[0].confidence} /></p><Link href="/intents" onClick={() => posthog.capture("intent_feed_viewed", { tracker_id: tracker.id })} className="mt-4 inline-flex items-center text-sm font-medium text-emerald-200 hover:text-white">View intent feed <ArrowUpRight className="ml-1 size-4" /></Link></section>}

    {done && recordsFetched === 0 && <section role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-5"><p className="text-sm font-semibold text-amber-100">No records fetched · provider warning</p><p className="mt-2 text-sm leading-6 text-slate-300">Inspect each provider event below for the cause: missing credentials, missing sources, an empty API response, parser failure, or rate limiting.</p></section>}
    {done && recordsFetched > 0 && signalsGenerated === 0 && <section role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-5"><p className="text-sm font-semibold text-amber-100">Records were fetched but no signals were generated</p><p className="mt-2 text-sm leading-6 text-slate-300">The provider parser rejected the returned records. Use diagnostic test mode to inspect the first 10 safe raw record previews.</p></section>}
    {done && signalsGenerated > 0 && run.signals_found === 0 && !run.diagnostic_mode && <section role="status" className="rounded-xl border border-sky-300/20 bg-sky-300/[.04] p-5"><p className="text-sm font-semibold text-sky-100">Signals were generated, but none were saved</p><p className="mt-2 text-sm leading-6 text-slate-300">Records may have been excluded, deduplicated, or blocked by a subscription or ingestion constraint.</p></section>}

    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Discovery activity</h2><p className="mt-1 text-xs text-slate-500">Events persisted by the tracker run</p></div><span className="text-xs text-slate-500">{events.length} events</span></div>
        {events.length ? <ol className="mt-5 space-y-0">{events.map((event, index) => <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0"><span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-white/10 bg-slate-950">{event.event_type.includes("failed") || event.event_type.includes("warning") ? <CircleAlert className="size-3.5 text-amber-300" /> : event.event_type.includes("signal") ? <Zap className="size-3.5 text-indigo-300" /> : <Check className="size-3.5 text-emerald-300" />}</span>{index < events.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-white/10" />}<span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{event.title}</span><time className="text-[11px] text-slate-500">{new Date(event.created_at).toLocaleTimeString()}</time></span><span className="mt-1 block break-all text-xs leading-5 text-slate-400">{eventDetail(event.details)}</span></span></li>)}</ol> : <div className="mt-5 rounded-lg border border-dashed border-white/10 p-5 text-sm text-slate-400">{run.status === "queued" ? "Tracker saved. Discovery is queued and will begin shortly." : "ScoutX is preparing the selected sources…"}</div>}
      </section>

      <section className="space-y-5"><div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Source health</h2><p className="mt-1 text-xs text-slate-500">Live status from this run. A provider failure does not stop other sources.</p><div className="mt-4 space-y-2">{displayedProviders.map((provider) => <SourceHealth key={provider} provider={provider} status={providerStatus.get(provider) ?? (done ? "not reached" : "connecting")} events={events} />)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Latest discoveries</h2><span className="text-xs text-slate-500">{signals.length}</span></div>{signals.length ? <div className="mt-4 space-y-3">{signals.slice(0, 5).map((signal) => <article key={signal.id} className="rounded-lg border border-white/[.07] bg-slate-950/50 p-3"><div className="flex items-start justify-between gap-3"><p className="line-clamp-3 text-xs leading-5 text-slate-300">{signal.post_snippet}</p><Confidence value={signal.confidence} /></div><p className="mt-2 text-[11px] capitalize text-slate-500">{signal.platform} · {signal.category.replaceAll("_", " ")} · intent {signal.intent_score}</p></article>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-white/10 p-4"><p className="text-sm font-medium text-slate-300">No buying signals found yet</p><p className="mt-1 text-xs leading-5 text-slate-500">ScoutX checked {tracker.communities.length} communities, {keywordCount} keywords, and {tracker.platforms.length} providers in this run.</p><p className="mt-2 flex items-center gap-1 text-[11px] text-indigo-200"><Clock3 className="size-3" />{done ? "Initial discovery finished. Scheduled collection will run according to your deployment schedule." : "Listening for discovery updates…"}</p></div>}
          <Link href="/intents" onClick={() => posthog.capture("intent_feed_viewed", { tracker_id: tracker.id })} className="mt-4 inline-flex items-center text-xs text-indigo-300 hover:text-white">Open full intent feed <ArrowUpRight className="ml-1 size-3" /></Link>
        </div></section>
    </div>
    {run.status === "failed" && <div role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[.05] p-4 text-sm text-red-200">{run.last_error || "Discovery could not start. Review the source configuration and retry from tracker management."}</div>}
    {done && <p className="text-center text-xs text-slate-500">This run is complete. Scheduled collection will continue based on the configured jobs.</p>}
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/[.08] bg-slate-950/50 p-4"><span className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</span><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>;
}

function Confidence({ value }: { value: number }) {
  const color = value >= 90 ? "text-red-300 bg-red-300/10" : value >= 70 ? "text-amber-200 bg-amber-200/10" : value >= 50 ? "text-sky-200 bg-sky-200/10" : "text-slate-400 bg-white/[.05]";
  const label = value >= 90 ? "Hot" : value >= 70 ? "Warm" : value >= 50 ? "Cold" : "Low";
  return <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${color}`}>{value}% · {label}</span>;
}

function SourceHealth({ provider, status, events }: { provider: string; status: string; events: Event[] }) {
  const active = status === "active" || status === "connected";
  const warning = status === "warning";
  const failed = status === "error" || status === "not reached";
  const providerEvents = events.filter((event) => stringDetail(event.details, "provider") === provider);
  const attempts = providerEvents.filter((event) => event.event_type === "provider_started").length;
  const failures = providerEvents.filter((event) => event.event_type === "provider_failed").length;
  const completed = providerEvents.find((event) => event.event_type === "provider_completed" || event.event_type === "provider_warning" || event.event_type === "provider_failed");
  const duration = detailNumber(completed?.details, "duration_ms");
  const fetched = detailNumber(completed?.details, "recordsFetched") ?? detailNumber(completed?.details, "collected");
  const filtered = detailNumber(completed?.details, "recordsFiltered");
  const generated = detailNumber(completed?.details, "signalsGenerated");
  const reasonCode = stringDetail(completed?.details ?? {}, "zeroReason") ?? stringDetail(completed?.details ?? {}, "warningReason") ?? stringDetail(completed?.details ?? {}, "reasonCode");
  const scoringFallbacks = detailNumber(completed?.details, "scoringFallbacks") ?? 0;
  const scoringFallbackReason = stringArrayDetail(completed?.details ?? {}, "scoringFallbackReasons")[0];
  const providerWarning = stringArrayDetail(completed?.details ?? {}, "providerWarnings")[0];
  const errorRate = attempts ? Math.round(failures / attempts * 100) : null;
  const metrics = [fetched !== undefined ? `${fetched} fetched` : undefined, filtered !== undefined ? `${filtered} filtered` : undefined, generated !== undefined ? `${generated} generated` : undefined, duration !== undefined ? `${duration} ms` : undefined, errorRate !== null ? `${errorRate}% errors` : undefined].filter(Boolean).join(" · ");
  return <div className="rounded-lg border border-white/[.06] bg-slate-950/40 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-sm capitalize text-slate-300">{providerLabel(provider)}</span><span className={`text-xs ${active ? "text-emerald-300" : warning ? "text-amber-200" : failed ? "text-red-200" : "text-slate-400"}`}>{active ? "● Complete" : warning ? "! Warning" : failed ? "! Failed" : "◌ Connecting"}</span></div>{metrics && <p className="mt-1 text-[10px] leading-4 text-slate-500">{metrics}</p>}{reasonCode && <p className="mt-1 text-[10px] text-amber-200">{reasonLabel(reasonCode)}</p>}{scoringFallbacks > 0 && <p className="mt-1 text-[10px] leading-4 text-amber-100">{scoringFallbacks} signal(s) scored using keyword fallback. {scoringFallbackReason}</p>}{providerWarning && <p className="mt-1 break-all text-[10px] leading-4 text-amber-100">{providerWarning}</p>}</div>;
}

function providerLabel(provider: string) {
  return ({ reddit: "Reddit API", serper: "Public web search", firecrawl: "Websites", apify: "Apify fallback", rss: "RSS feeds", hackernews: "Hacker News" } as Record<string, string>)[provider] ?? provider;
}

function stringDetail(details: Json, key: string): string | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function detailNumber(details: Json | undefined, key: string): number | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  const value = details[key];
  return typeof value === "number" ? value : undefined;
}

function booleanDetail(details: Json, key: string) {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return false;
  return details[key] === true;
}

function jsonRecords(details: Json, key: string): Json[] {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return [];
  const value = details[key];
  return Array.isArray(value) ? value.slice(0, 10) : [];
}

function stringArrayDetail(details: Json, key: string): string[] {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return [];
  const value = details[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
}

function reasonLabel(reason: string) {
  return ({ missing_api_key: "Missing API key", missing_source_list: "No sources configured", api_response_empty: "API returned no records", parser_failure: "Records could not be parsed", rate_limited: "Provider rate limited the request", quota_exceeded: "Gemini quota exceeded", model_unavailable: "Gemini model unavailable", response_parse_failed: "Gemini response parsing failed", invalid_api_key: "API key was rejected", provider_request_failed: "Provider request failed", collection_processing_failed: "Signal processing failed", signal_insert_failed: "Signal insert failed", signal_quota_exceeded: "Signal quota exceeded", subscription_required: "Active subscription required", signal_duplicate_check_failed: "Signal duplicate check failed" } as Record<string, string>)[reason] ?? reason.replaceAll("_", " ");
}

function eventDetail(details: Json) {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return "";
  const provider = typeof details.provider === "string" ? providerLabel(details.provider) : undefined;
  const reason = typeof details.reason === "string" ? details.reason : undefined;
  const inserted = typeof details.inserted === "number" ? `${details.inserted} new signals` : undefined;
  const collected = typeof details.collected === "number" ? `${details.collected} records scanned` : undefined;
  const fetched = typeof details.recordsFetched === "number" ? `${details.recordsFetched} fetched` : undefined;
  const filtered = typeof details.recordsFiltered === "number" ? `${details.recordsFiltered} filtered` : undefined;
  const generated = typeof details.signalsGenerated === "number" ? `${details.signalsGenerated} generated` : undefined;
  const saved = typeof details.signalsSaved === "number" ? `${details.signalsSaved} saved` : undefined;
  const rawReason = typeof details.zeroReason === "string" ? details.zeroReason : typeof details.warningReason === "string" ? details.warningReason : typeof details.reasonCode === "string" ? details.reasonCode : undefined;
  const reasonCode = rawReason ? reasonLabel(rawReason) : undefined;
  const scoringFallbacks = typeof details.scoringFallbacks === "number" && details.scoringFallbacks > 0 ? `${details.scoringFallbacks} keyword fallback score(s)` : undefined;
  const scoringFallbackReasons = stringArrayDetail(details, "scoringFallbackReasons");
  const providerWarnings = stringArrayDetail(details, "providerWarnings");
  const stage = typeof details.stage === "string" ? details.stage.replaceAll("_", " ") : undefined;
  const analyzed = typeof details.recordsAnalyzed === "number" ? `${details.recordsAnalyzed} analyzed` : undefined;
  const scored = typeof details.recordsScored === "number" ? `${details.recordsScored} scored` : undefined;
  const aboveThreshold = typeof details.recordsAboveThreshold === "number" ? `${details.recordsAboveThreshold} above threshold` : undefined;
  const requests = requestDetails(details);
  return [[provider, stage, reasonCode, reason, fetched, analyzed, scored, aboveThreshold, filtered, generated, saved, collected, inserted, scoringFallbacks, ...scoringFallbackReasons, ...providerWarnings].filter(Boolean).join(" · "), ...requests].filter(Boolean).join(" | ");
}

function requestDetails(details: Json) {
  if (typeof details !== "object" || details === null || Array.isArray(details) || !Array.isArray(details.requests)) return [];
  return details.requests.slice(0, 20).flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const url = typeof item.url === "string" ? item.url : "Request URL unavailable";
    const status = typeof item.status === "number" ? `HTTP ${item.status}` : "No HTTP response";
    const fetched = typeof item.recordsFetched === "number" ? `${item.recordsFetched} returned` : "count unavailable";
    return [`${status} · ${fetched} · ${url}`];
  });
}

function mergeSignals(current: Signal[], incoming: Signal[]) {
  const byId = new Map(current.map((signal) => [signal.id, signal]));
  for (const signal of incoming) byId.set(signal.id, signal);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
}
