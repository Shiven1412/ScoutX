"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Activity, ArrowUpRight, Check, CircleAlert, Clock3, Radio, Sparkles, Zap } from "lucide-react";
import { getTrackerRunSnapshot } from "@/actions/trackers";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/types/database";

type Run = Pick<Database["public"]["Tables"]["tracker_runs"]["Row"], "id" | "tracker_id" | "status" | "progress" | "signals_found" | "providers_total" | "providers_completed" | "last_error" | "started_at" | "completed_at" | "created_at">;
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
  const averageConfidence = signals.length ? Math.round(signals.reduce((total, signal) => total + signal.confidence, 0) / signals.length) : null;
  const sourceCoverage = run.providers_total ? Math.round(run.providers_completed / run.providers_total * 100) : 0;
  const statusLabel = run.status === "queued" ? "Queued to start" : run.status === "running" ? "Discovery in progress" : run.status === "partial" ? "Initial discovery complete with source warnings" : run.status === "failed" ? "Discovery needs attention" : "Initial discovery complete";

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-indigo-300/15 bg-gradient-to-br from-indigo-500/[.12] via-slate-900/80 to-slate-950 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.18em] text-indigo-200"><Sparkles className="size-4" />ScoutX discovery</p><h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{tracker.keyword}</h1><p className="mt-2 text-sm text-slate-400">{statusLabel}. Selected providers are collecting and analyzing public conversations.</p></div><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300"><Radio className={`size-3 ${realtime === "live" ? "animate-pulse text-emerald-300" : "text-amber-300"}`} />{realtime === "live" ? "Live updates" : realtime === "polling" ? "Connected · polling backup" : "Connecting to live updates"}</span></div>
      <div className="mt-7"><div className="flex items-center justify-between text-xs"><span className="text-slate-400">Initial discovery progress</span><span className="font-medium text-indigo-100">{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-300 transition-[width] duration-700 ease-out" style={{ width: `${progress}%` }} /></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Metric icon={<Activity className="size-4" />} label="Signals found" value={run.signals_found} /><Metric icon={<SearchIcon />} label="Keywords monitored" value={keywordCount} /><Metric icon={<Radio className="size-4" />} label="Sources active" value={`${activeProviders}/${displayedProviders.length}`} /><Metric icon={<Activity className="size-4" />} label="Communities" value={tracker.communities.length} /><Metric icon={<Sparkles className="size-4" />} label="Avg. confidence" value={averageConfidence === null ? "—" : `${averageConfidence}%`} /><Metric icon={<Radio className="size-4" />} label="Coverage" value={`${sourceCoverage}%`} /></div>
    </section>

    {signals.length > 0 && <section className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.05] p-5" role="status"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><span aria-hidden="true">🎉</span> First intent signal found</p><p className="mt-2 text-sm text-slate-200">{signals[0].post_snippet}</p><p className="mt-3 text-xs text-slate-400">{signals[0].platform} · {signals[0].category.replaceAll("_", " ")} · <Confidence value={signals[0].confidence} /></p><Link href="/intents" onClick={() => posthog.capture("intent_feed_viewed", { tracker_id: tracker.id })} className="mt-4 inline-flex items-center text-sm font-medium text-emerald-200 hover:text-white">View intent feed <ArrowUpRight className="ml-1 size-4" /></Link></section>}

    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Discovery activity</h2><p className="mt-1 text-xs text-slate-500">Events persisted by the tracker run</p></div><span className="text-xs text-slate-500">{events.length} events</span></div>
        {events.length ? <ol className="mt-5 space-y-0">{events.map((event, index) => <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0"><span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-white/10 bg-slate-950">{event.event_type.includes("failed") ? <CircleAlert className="size-3.5 text-amber-300" /> : event.event_type.includes("signal") ? <Zap className="size-3.5 text-indigo-300" /> : <Check className="size-3.5 text-emerald-300" />}</span>{index < events.length - 1 && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-white/10" />}<span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{event.title}</span><time className="text-[11px] text-slate-500">{new Date(event.created_at).toLocaleTimeString()}</time></span><span className="mt-1 block text-xs leading-5 text-slate-400">{eventDetail(event.details)}</span></span></li>)}</ol> : <div className="mt-5 rounded-lg border border-dashed border-white/10 p-5 text-sm text-slate-400">{run.status === "queued" ? "Tracker saved. Discovery is queued and will begin shortly." : "ScoutX is preparing the selected sources…"}</div>}
      </section>

      <section className="space-y-5"><div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Source health</h2><p className="mt-1 text-xs text-slate-500">Live status from this run. A provider failure does not stop other sources.</p><div className="mt-4 space-y-2">{displayedProviders.map((provider) => <SourceHealth key={provider} provider={provider} status={providerStatus.get(provider) ?? (done ? "not reached" : "connecting")} events={events} />)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Latest discoveries</h2><span className="text-xs text-slate-500">{signals.length}</span></div>{signals.length ? <div className="mt-4 space-y-3">{signals.slice(0, 5).map((signal) => <article key={signal.id} className="rounded-lg border border-white/[.07] bg-slate-950/50 p-3"><div className="flex items-start justify-between gap-3"><p className="line-clamp-3 text-xs leading-5 text-slate-300">{signal.post_snippet}</p><Confidence value={signal.confidence} /></div><p className="mt-2 text-[11px] capitalize text-slate-500">{signal.platform} · {signal.category.replaceAll("_", " ")} · intent {signal.intent_score}</p></article>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-white/10 p-4"><p className="text-sm font-medium text-slate-300">No buying signals found yet</p><p className="mt-1 text-xs leading-5 text-slate-500">ScoutX checked {tracker.communities.length} communities, {keywordCount} keywords, and {tracker.platforms.length} providers in this run.</p><p className="mt-2 flex items-center gap-1 text-[11px] text-indigo-200"><Clock3 className="size-3" />{done ? "Initial discovery finished. Scheduled collection will run according to your deployment schedule." : "Listening for discovery updates…"}</p></div>}
          <Link href="/intents" onClick={() => posthog.capture("intent_feed_viewed", { tracker_id: tracker.id })} className="mt-4 inline-flex items-center text-xs text-indigo-300 hover:text-white">Open full intent feed <ArrowUpRight className="ml-1 size-3" /></Link>
        </div></section>
    </div>
    {run.status === "failed" && <div role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[.05] p-4 text-sm text-red-200">{run.last_error || "Discovery could not start. Review the source configuration and retry from tracker management."}</div>}
    {done && <p className="text-center text-xs text-slate-500">Initial provisioning finished. Scheduled collection will continue based on the configured jobs.</p>}
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/[.08] bg-slate-950/50 p-4"><span className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</span><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>;
}

function SearchIcon() { return <Activity className="size-4" />; }

function Confidence({ value }: { value: number }) {
  const color = value >= 90 ? "text-red-300 bg-red-300/10" : value >= 70 ? "text-amber-200 bg-amber-200/10" : value >= 50 ? "text-sky-200 bg-sky-200/10" : "text-slate-400 bg-white/[.05]";
  const label = value >= 90 ? "Hot" : value >= 70 ? "Warm" : value >= 50 ? "Cold" : "Low";
  return <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${color}`}>{value}% · {label}</span>;
}

function SourceHealth({ provider, status, events }: { provider: string; status: string; events: Event[] }) {
  const active = status === "active" || status === "connected";
  const failed = status === "error" || status === "not reached";
  const providerEvents = events.filter((event) => stringDetail(event.details, "provider") === provider);
  const attempts = providerEvents.filter((event) => event.event_type === "provider_started").length;
  const failures = providerEvents.filter((event) => event.event_type === "provider_failed").length;
  const completed = [...providerEvents].reverse().find((event) => event.event_type === "provider_completed");
  const duration = detailNumber(completed?.details, "duration_ms");
  const collected = detailNumber(completed?.details, "collected");
  const errorRate = attempts ? Math.round(failures / attempts * 100) : null;
  const metrics = [duration !== undefined ? `${duration} ms` : undefined, collected !== undefined ? `${collected} records` : undefined, errorRate !== null ? `${errorRate}% errors` : undefined, completed ? `Last success ${new Date(completed.created_at).toLocaleTimeString()}` : undefined].filter(Boolean).join(" · ");
  return <div className="rounded-lg border border-white/[.06] bg-slate-950/40 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-sm capitalize text-slate-300">{providerLabel(provider)}</span><span className={`text-xs ${active ? "text-emerald-300" : failed ? "text-amber-200" : "text-slate-400"}`}>{active ? "● Active" : failed ? "! Needs attention" : "◌ Connecting"}</span></div>{metrics && <p className="mt-1 text-[10px] leading-4 text-slate-500">{metrics}</p>}</div>;
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

function eventDetail(details: Json) {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return "";
  const provider = typeof details.provider === "string" ? providerLabel(details.provider) : undefined;
  const reason = typeof details.reason === "string" ? details.reason : undefined;
  const inserted = typeof details.inserted === "number" ? `${details.inserted} new signals` : undefined;
  const collected = typeof details.collected === "number" ? `${details.collected} records scanned` : undefined;
  return [provider, reason, collected, inserted].filter(Boolean).join(" · ") || "";
}

function mergeSignals(current: Signal[], incoming: Signal[]) {
  const byId = new Map(current.map((signal) => [signal.id, signal]));
  for (const signal of incoming) byId.set(signal.id, signal);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
}
