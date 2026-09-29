import "server-only";

import { createHash } from "node:crypto";
import { scoreIntent } from "@/services/ai";
import { signalProviders, type CollectedSignal, type SignalTracker } from "@/services/signals/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export type ScheduledJob = keyof typeof signalProviders | "reprocess" | "analytics";

export async function runScheduledJob(job: ScheduledJob) {
  const admin = createAdminClient();
  const { data: run, error: startError } = await admin.from("cron_job_runs").insert({ job_name: job, status: "running" }).select("id").single();
  if (startError || !run) throw new Error("Scheduled job could not be recorded.");
  try {
    let processed = 0;
    if (job === "reprocess") processed = await reprocessSignals();
    else if (job === "analytics") processed = await aggregateAnalytics();
    else processed = await collectSignals(job);
    const { error } = await admin.from("cron_job_runs").update({ status: "completed", processed_count: processed, completed_at: new Date().toISOString() }).eq("id", run.id);
    if (error) throw new Error("Scheduled job result could not be recorded.");
    return { job, processed };
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 500) : "Scheduled job failed.";
    await admin.from("cron_job_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: safeMessage }).eq("id", run.id);
    throw error;
  }
}

export async function runTrackerDiscovery(organizationId: string, trackerId: string, runId: string, onlyProvider?: keyof typeof signalProviders) {
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.from("tracker_runs").update({ status: "running", progress: 3, started_at: new Date().toISOString() })
    .eq("id", runId).eq("tracker_id", trackerId).eq("organization_id", organizationId).eq("status", "queued").select("id").maybeSingle();
  if (claimError) throw new Error("Tracker discovery run could not be started.");
  if (!claimed) {
    const { data: existing } = await admin.from("tracker_runs").select("status").eq("id", runId).eq("organization_id", organizationId).maybeSingle();
    return { status: existing?.status ?? "missing", duplicate: true };
  }

  const { data: tracker, error: trackerError } = await admin.from("keyword_trackers")
    .select("id, organization_id, keyword, negative_keywords, communities, platforms, status, deleted_at")
    .eq("id", trackerId).eq("organization_id", organizationId).maybeSingle();
  if (trackerError || !tracker || tracker.status !== "active" || tracker.deleted_at) {
    await finishTrackerRun(organizationId, trackerId, runId, "failed", 0, "Tracker is unavailable or paused.");
    return { status: "failed", signalsFound: 0 };
  }

  const [queryRows, sourceRows, keywordRows] = await Promise.all([
    admin.from("tracker_queries").select("query").eq("tracker_id", trackerId).eq("organization_id", organizationId),
    admin.from("tracker_sources").select("source_type, provider, source_value").eq("tracker_id", trackerId).eq("organization_id", organizationId),
    admin.from("tracker_keywords").select("keyword_type, keyword").eq("tracker_id", trackerId).eq("organization_id", organizationId),
  ]);
  if (queryRows.error || sourceRows.error || keywordRows.error) {
    await finishTrackerRun(organizationId, trackerId, runId, "failed", 0, "Tracker discovery rules could not be loaded.");
    return { status: "failed", signalsFound: 0 };
  }
  const enriched: SignalTracker = {
    ...tracker,
    queries: queryRows.data?.map((row) => row.query) ?? [],
    sources: sourceRows.data ?? [],
    keywords: keywordRows.data?.filter((row) => row.keyword_type === "product").map((row) => row.keyword) ?? [],
  };
    const selected = onlyProvider
    ? tracker.platforms.length === 0 || tracker.platforms.includes(onlyProvider) ? [onlyProvider] : []
    : [...new Set(tracker.platforms.filter((name): name is keyof typeof signalProviders => Object.hasOwn(signalProviders, name)))];
  await writeTrackerEvent(organizationId, trackerId, runId, "discovery_started", "Discovery started", { providers: selected });

  let completedProviders = 0;
  let insertedTotal = 0;
  let failedProviders = 0;
  let recoveredFailures = 0;
  let attemptedProviders = 0;
  const totalProviders = selected.length;
  await admin.from("tracker_runs").update({ providers_total: totalProviders, progress: 8 }).eq("id", runId);

  for (const providerName of selected) {
    const providerStartedAt = Date.now();
    attemptedProviders += 1;
    await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", `${providerNameLabel(providerName)} connecting`, { provider: providerName, status: "connecting" });
    try {
      const provider = signalProviders[providerName];
      const healthy = await provider.healthCheck();
      if (!healthy) throw new Error(`${providerNameLabel(providerName)} is not configured.`);
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "syncing", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      await writeTrackerEvent(organizationId, trackerId, runId, "provider_connected", `${providerNameLabel(providerName)} connected`, { provider: providerName, status: "connected" });
      const collected = await provider.collectSignals(enriched);
      const inserted = await scoreDeduplicateAndIngest(enriched, providerName, collected, runId);
      insertedTotal += inserted;
      completedProviders += 1;
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      await writeTrackerEvent(organizationId, trackerId, runId, "provider_completed", `${providerNameLabel(providerName)} scan complete`, { provider: providerName, collected: collected.length, inserted, duration_ms: Date.now() - providerStartedAt });
    } catch (error) {
      failedProviders += 1;
      const detail = error instanceof Error ? error.message : "Unknown provider failure";
      console.error(`Tracker ${providerName} discovery failed`, { trackerId, organizationId, detail });
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "error", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", `${providerNameLabel(providerName)} could not complete`, { provider: providerName, reason: toSafeProviderReason(detail), duration_ms: Date.now() - providerStartedAt });

      if (providerName === "reddit" && await signalProviders.apify.healthCheck().catch(() => false)) {
        await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", "Trying Apify Reddit fallback", { provider: "apify", status: "connecting" });
        try {
          const fallbackSignals = await signalProviders.apify.collectSignals(enriched);
          const inserted = await scoreDeduplicateAndIngest(enriched, "apify", fallbackSignals, runId);
          insertedTotal += inserted;
          recoveredFailures += 1;
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "apify", connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_completed", "Apify Reddit fallback complete", { provider: "apify", collected: fallbackSignals.length, inserted });
        } catch (fallbackError) {
          console.error("Apify Reddit fallback failed", fallbackError instanceof Error ? fallbackError.message : "Unknown error");
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "apify", connected: true, sync_status: "error", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", "Apify Reddit fallback failed", { provider: "apify", reason: "Check Apify credentials, actor configuration, and provider availability." });
        }
      }

      if ((providerName === "firecrawl" || providerName === "hackernews" || providerName === "rss") && await signalProviders.serper.healthCheck().catch(() => false)) {
        await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", "Trying public search fallback for crawl sources", { provider: "serper", status: "connecting" });
        try {
          const fallbackSignals = await signalProviders.serper.collectSignals({ ...enriched, sources: [] });
          const inserted = await scoreDeduplicateAndIngest(enriched, "serper", fallbackSignals, runId);
          insertedTotal += inserted;
          recoveredFailures += 1;
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "serper", connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_completed", "Public search fallback complete", { provider: "serper", collected: fallbackSignals.length, inserted });
        } catch (fallbackError) {
          console.error("Public search fallback failed", fallbackError instanceof Error ? fallbackError.message : "Unknown error");
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", "Public search fallback failed", { provider: "serper", reason: "Check Serper credentials, quota, and provider availability." });
        }
      }
    }
    const progress = totalProviders ? 8 + Math.floor(attemptedProviders / totalProviders * 88) : 8;
    await admin.from("tracker_runs").update({ progress, signals_found: insertedTotal, providers_completed: completedProviders }).eq("id", runId);
  }

  const status = !selected.length || (completedProviders === 0 && recoveredFailures === 0) ? "failed" : failedProviders > recoveredFailures ? "partial" : "completed";
  await finishTrackerRun(organizationId, trackerId, runId, status, insertedTotal, status === "failed" ? "No selected discovery provider completed successfully." : null);
  await writeTrackerEvent(organizationId, trackerId, runId, "run_completed", status === "completed" ? "Initial discovery complete" : status === "partial" ? "Discovery complete with source warnings" : "Discovery could not start", { status, signalsFound: insertedTotal, providersCompleted: completedProviders, providersFailed: failedProviders });
  return { status, signalsFound: insertedTotal };
}

async function scoreDeduplicateAndIngest(tracker: SignalTracker, providerName: keyof typeof signalProviders, records: CollectedSignal[], runId: string) {
  const admin = createAdminClient();
  const candidates = records.filter((signal) => !isSpam(signal.post_snippet, tracker.negative_keywords));
  const unique = [...new Map(candidates.map((signal) => [`${signal.platform}:${signal.external_id}`, signal])).values()].slice(0, 8);
  if (!unique.length) return 0;
  const candidateHashes = new Map(unique.map((signal) => [signal.external_id, contentHash(signal.post_snippet)]));
  const [existingIds, existingHashes] = await Promise.all([
    admin.from("intent_signals").select("external_id").eq("organization_id", tracker.organization_id).eq("platform", providerName).in("external_id", unique.map((signal) => signal.external_id)),
    admin.from("intent_signals").select("content_hash").eq("organization_id", tracker.organization_id).in("content_hash", [...candidateHashes.values()]),
  ]);
  if (existingIds.error || existingHashes.error) throw new Error("Signal duplicate check failed.");
  const seenIds = new Set(existingIds.data?.map((row) => row.external_id) ?? []);
  const seenHashes = new Set(existingHashes.data?.map((row) => row.content_hash).filter((value): value is string => Boolean(value)) ?? []);
  const fresh = unique.filter((signal) => !seenIds.has(signal.external_id) && !seenHashes.has(candidateHashes.get(signal.external_id) ?? ""));
  const scored: Array<CollectedSignal & Awaited<ReturnType<typeof scoreIntent>> & { content_hash: string; provider: string; community: string | null }> = [];
  for (const signal of fresh) {
    const score = await scoreIntent({ organizationId: tracker.organization_id, keyword: signal.keyword, source: signal.platform, context: signal.post_snippet.slice(0, 5000) });
    const hash = candidateHashes.get(signal.external_id) ?? contentHash(signal.post_snippet);
    const redditCommunity = signal.platform === "reddit" && typeof signal.raw_payload.subreddit === "string" ? signal.raw_payload.subreddit : null;
    const community = redditCommunity ? `r/${redditCommunity.replace(/^r\//i, "")}` : signal.platform === "hackernews" ? "Hacker News" : null;
    scored.push({ ...signal, ...score, content_hash: hash, provider: providerName, community });
  }
  if (!scored.length) return 0;
  const { data: inserted, error } = await admin.rpc("ingest_signals", { target_org: tracker.organization_id, signal_rows: scored.map((signal) => ({
    tracker_id: tracker.id, platform: signal.platform, external_id: signal.external_id, keyword: signal.keyword,
    prospect_name: signal.prospect_name, company: signal.company, source_url: signal.source_url, post_snippet: signal.post_snippet,
    intent_score: signal.intent_score, confidence: signal.confidence, category: signal.category, pain_intensity: signal.pain_intensity,
    buying_probability: signal.buying_probability, urgency: signal.urgency, decision_maker_likelihood: signal.decision_maker_likelihood,
    budget_intent: signal.budget_intent, raw_payload: signal.raw_payload, provider: signal.provider, community: signal.community, content_hash: signal.content_hash,
  })) });
  if (error) throw new Error("Scored signals could not be saved.");
  if ((inserted ?? 0) > 0) await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_detected", `${inserted} intent signal${inserted === 1 ? "" : "s"} detected`, { provider: providerName, count: inserted });
  return inserted ?? 0;
}

function contentHash(content: string) {
  const normalized = content.normalize("NFKC").toLocaleLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

async function writeTrackerEvent(organizationId: string, trackerId: string, runId: string | null, eventType: string, title: string, details: Record<string, string | number | boolean | string[]>) {
  const { error } = await createAdminClient().from("tracker_events").insert({ organization_id: organizationId, tracker_id: trackerId, run_id: runId, event_type: eventType, title, details });
  if (error) console.error("Tracker event could not be persisted", { code: error.code, eventType });
}

async function finishTrackerRun(organizationId: string, trackerId: string, runId: string, status: "completed" | "partial" | "failed", signalsFound: number, lastError: string | null) {
  const { error } = await createAdminClient().from("tracker_runs").update({ status, progress: 100, signals_found: signalsFound, completed_at: new Date().toISOString(), last_error: lastError }).eq("id", runId).eq("tracker_id", trackerId).eq("organization_id", organizationId);
  if (error) console.error("Tracker run completion could not be persisted", { code: error.code, trackerId });
}

function providerNameLabel(provider: keyof typeof signalProviders) {
  return ({ reddit: "Reddit", serper: "Public web search", firecrawl: "Websites", apify: "Apify", rss: "RSS feeds", hackernews: "Hacker News" })[provider];
}

function toSafeProviderReason(detail: string) {
  if (/not configured/i.test(detail)) return "Provider credentials are missing or incomplete.";
  if (/status 401|unauthorized/i.test(detail)) return "Provider rejected the credentials. Check the key or token.";
  if (/status 403|forbidden/i.test(detail)) return "Provider denied access. Check account permissions and plan access.";
  if (/status 429|rate limit/i.test(detail)) return "Provider rate limit reached. It can retry on the next scheduled run.";
  if (/timeout|timed out/i.test(detail)) return "Provider did not respond in time. It can retry on the next scheduled run.";
  return "Provider request failed. Review its configuration and try again.";
}

async function collectSignals(providerName: keyof typeof signalProviders) {
  const admin = createAdminClient();
  const { data: trackers, error } = await admin.from("keyword_trackers").select("id, organization_id, keyword, negative_keywords, communities, platforms").eq("status", "active").is("deleted_at", null).limit(500);
  if (error) throw new Error("Active keyword trackers could not be loaded.");

  const matched = (trackers ?? []).filter((tracker) => tracker.platforms.length === 0 || tracker.platforms.some((platform) => platform.toLowerCase() === providerName));
  if (!matched.length) return 0;
  let processed = 0;
  for (const tracker of matched) {
    const { data: run, error: runError } = await admin.from("tracker_runs").insert({
      organization_id: tracker.organization_id,
      tracker_id: tracker.id,
      status: "queued",
      progress: 0,
      providers_total: 1,
    }).select("id").single();
    if (runError || !run) {
      console.error("Scheduled tracker run could not be created", { trackerId: tracker.id, code: runError?.code });
      continue;
    }
    try {
      const result = await runTrackerDiscovery(tracker.organization_id, tracker.id, run.id, providerName);
      processed += result.signalsFound ?? 0;
    } catch (error) {
      console.error("Scheduled tracker discovery failed", { trackerId: tracker.id, provider: providerName, message: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  return processed;
}

async function reprocessSignals() {
  const admin = createAdminClient();
  const { data: signals, error } = await admin.from("intent_signals").select("id, organization_id, tracker_id, keyword, platform, post_snippet").lt("confidence", 70).order("created_at", { ascending: true }).limit(25);
  if (error) throw new Error("Signals queued for reprocessing could not be loaded.");
  let processed = 0;
  for (const signal of signals ?? []) {
    let score: Awaited<ReturnType<typeof scoreIntent>>;
    try { score = await scoreIntent({ organizationId: signal.organization_id, keyword: signal.keyword, source: signal.platform, context: signal.post_snippet.slice(0, 5000) }); }
    catch (error) {
      if (error instanceof Error && error.message.includes("AI credit limit")) continue;
      throw error;
    }
    const { error: updateError } = await admin.from("intent_signals").update({
      category: score.category,
      confidence: score.confidence,
      intent_score: score.intent_score,
      pain_intensity: score.pain_intensity,
      buying_probability: score.buying_probability,
      urgency: score.urgency,
      decision_maker_likelihood: score.decision_maker_likelihood,
      budget_intent: score.budget_intent,
    }).eq("id", signal.id).eq("organization_id", signal.organization_id);
    if (updateError) throw new Error("A reprocessed signal score could not be saved.");
    processed += 1;
  }
  return processed;
}

async function aggregateAnalytics() {
  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setUTCDate(dayStart.getUTCDate() - 1);
  dayStart.setUTCHours(0, 0, 0, 0);
  const reportDate = dayStart.toISOString().slice(0, 10);
  const { data, error } = await admin.rpc("aggregate_daily_analytics", { target_day: reportDate });
  if (error) throw new Error("Daily analytics could not be calculated or saved.");
  return data ?? 0;
}

function isSpam(content: string, negatives: string[]) {
  const normalized = content.toLocaleLowerCase();
  if (content.trim().length < 30 || /(.)\1{15,}/u.test(content)) return true;
  return negatives.some((term) => term.trim().length > 0 && normalized.includes(term.trim().toLocaleLowerCase()));
}
