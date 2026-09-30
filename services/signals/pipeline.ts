import "server-only";

import { createHash } from "node:crypto";
import { scoreIntent } from "@/services/ai";
import { signalProviders, type CollectedSignal, type ProviderCollectionResult, type SignalTracker } from "@/services/signals/providers";
import { insertSignalBatch, SignalInsertError } from "@/services/signals/persistence";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export type ScheduledJob = keyof typeof signalProviders | "reprocess" | "analytics";

type SignalProcessingDiagnostics = {
  recordsAnalyzed: number;
  recordsScored: number;
  recordsAboveThreshold: number;
  spamFiltered: number;
  batchDuplicates: number;
  existingIdDuplicates: number;
  existingContentDuplicates: number;
  signalsSaved: number;
  scoringFallbacks: number;
  scoringFallbackReasons: string[];
  scoringFallbackCodes: string[];
  geminiStatus: "healthy" | "fallback" | "not_used" | "failed";
  supabaseStatus: "success" | "failed" | "not_attempted";
};

class SignalProcessingError extends Error {
  constructor(message: string, readonly code: string, readonly diagnostics: SignalProcessingDiagnostics) {
    super(message);
    this.name = "SignalProcessingError";
  }
}

function emptyProcessingDiagnostics(): SignalProcessingDiagnostics {
  return { recordsAnalyzed: 0, recordsScored: 0, recordsAboveThreshold: 0, spamFiltered: 0, batchDuplicates: 0, existingIdDuplicates: 0, existingContentDuplicates: 0, signalsSaved: 0, scoringFallbacks: 0, scoringFallbackReasons: [], scoringFallbackCodes: [], geminiStatus: "not_used", supabaseStatus: "not_attempted" };
}

export async function markTrackerRunFailed(organizationId: string, trackerId: string, runId: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: failed, error } = await admin.from("tracker_runs").update({
    status: "failed", progress: 100, last_error: "Collection stopped unexpectedly. Check provider configuration and retry.", completed_at: now,
  }).eq("id", runId).eq("tracker_id", trackerId).eq("organization_id", organizationId).in("status", ["queued", "running"]).select("id").maybeSingle();
  if (error) {
    console.error("Unexpected tracker run failure could not be persisted", { trackerId, runId, code: error.code });
    return;
  }
  if (!failed) return;
  await writeTrackerEvent(organizationId, trackerId, runId, "run_failed", "Collection stopped unexpectedly", { reason: "The run stopped before its providers completed. Check server logs and retry." });
}

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
    .eq("id", runId).eq("tracker_id", trackerId).eq("organization_id", organizationId).eq("status", "queued").select("id, diagnostic_mode").maybeSingle();
  if (claimError) throw new Error("Tracker discovery run could not be started.");
  if (!claimed) {
    const { data: existing } = await admin.from("tracker_runs").select("status").eq("id", runId).eq("organization_id", organizationId).maybeSingle();
    return { status: existing?.status ?? "missing", duplicate: true };
  }
  const diagnosticMode = claimed.diagnostic_mode;

  const { data: tracker, error: trackerError } = await admin.from("keyword_trackers")
    .select("id, organization_id, keyword, negative_keywords, communities, platforms, alert_threshold, status, deleted_at")
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
  let recordsFetchedTotal = 0;
  let recordsFilteredTotal = 0;
  let signalsGeneratedTotal = 0;
  let recordsAnalyzedTotal = 0;
  let recordsScoredTotal = 0;
  let recordsAboveThresholdTotal = 0;
  let warningProviders = 0;
  let failedProviders = 0;
  let recoveredFailures = 0;
  let attemptedProviders = 0;
  const totalProviders = selected.length;
  await admin.from("tracker_runs").update({ providers_total: totalProviders, progress: 8 }).eq("id", runId);

  for (const providerName of selected) {
    const providerStartedAt = Date.now();
    let providerCollection: ProviderCollectionResult | undefined;
    attemptedProviders += 1;
    await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", `${providerNameLabel(providerName)} connecting`, { provider: providerName, status: "connecting" });
    try {
      const provider = signalProviders[providerName];
      console.log("Tracker provider run configuration", {
        trackerId, organizationId, runId, provider: providerName, diagnosticMode,
        keywords: { primary: tracker.keyword, product: enriched.keywords ?? [], queries: enriched.queries ?? [], negative: tracker.negative_keywords },
        selectedProviders: tracker.platforms, communities: tracker.communities,
        sources: (enriched.sources ?? []).filter((source) => source.provider === providerName).map((source) => ({ type: source.source_type, value: redactDiagnosticSource(source.source_value) })),
      });
      const healthy = await provider.healthCheck();
      if (!healthy) throw new Error(`${providerNameLabel(providerName)} is not configured.`);
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "syncing", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      await writeTrackerEvent(organizationId, trackerId, runId, "provider_connected", `${providerNameLabel(providerName)} connected`, { provider: providerName, status: "connected" });
      const collection = await provider.collectSignals(enriched, { diagnosticMode });
      providerCollection = collection;
      recordsFetchedTotal += collection.recordsFetched;
      signalsGeneratedTotal += collection.signals.length;
      let recordsFiltered = collection.recordsFiltered;
      let inserted = 0;
      let pipelineFiltered = 0;
      let scoringFallbacks = 0;
      let processingDiagnostics = emptyProcessingDiagnostics();
      if (!diagnosticMode) {
        const ingested = await scoreDeduplicateAndIngest(enriched, providerName, collection.signals, runId);
        inserted = ingested.inserted;
        pipelineFiltered = ingested.filtered;
        scoringFallbacks = ingested.scoringFallbacks;
        processingDiagnostics = ingested.diagnostics;
        recordsAnalyzedTotal += processingDiagnostics.recordsAnalyzed;
        recordsScoredTotal += processingDiagnostics.recordsScored;
        recordsAboveThresholdTotal += processingDiagnostics.recordsAboveThreshold;
        recordsFiltered += pipelineFiltered;
        insertedTotal += inserted;
      }
      recordsFilteredTotal += recordsFiltered;
      const requestWarning = collection.requests.some((request) => request.status === null || request.status < 200 || request.status >= 300);
      const providerWarning = collection.recordsFetched === 0 || collection.signals.length === 0 || requestWarning || collection.warnings.length > 0 || scoringFallbacks > 0;
      const warningReason = collection.zeroReason ?? (requestWarning ? collection.requests.some((request) => request.status === 429) ? "rate_limited" : "provider_request_failed" : null);
      if (providerWarning) warningProviders += 1;
      completedProviders += 1;
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      const details: Record<string, Json> = {
        provider: providerName, recordsFetched: collection.recordsFetched, recordsFiltered, providerFiltered: collection.recordsFiltered,
        pipelineFiltered, signalsGenerated: collection.signals.length, collected: collection.signals.length,
        inserted, duration_ms: Date.now() - providerStartedAt, warning: providerWarning,
        providerWarnings: collection.warnings,
        ...processingDiagnostics,
        geminiStatus: diagnosticMode ? "not_used" : processingDiagnostics.geminiStatus,
        supabaseStatus: diagnosticMode ? "not_used" : processingDiagnostics.supabaseStatus,
        zeroReason: collection.zeroReason, warningReason, diagnosticMode, requests: collection.requests as unknown as Json,
      };
      if (diagnosticMode) details.rawPreview = collection.rawPreview as unknown as Json;
      const eventTitle = scoringFallbacks > 0
        ? `${providerNameLabel(providerName)} signals scored with keyword fallback`
        : collection.warnings.length > 0
        ? `${providerNameLabel(providerName)} completed with source warnings`
        : collection.recordsFetched === 0 || collection.signals.length === 0
        ? `${providerNameLabel(providerName)} returned no usable records`
        : requestWarning ? `${providerNameLabel(providerName)} completed with request warnings` : `${providerNameLabel(providerName)} collection complete`;
      await writeTrackerEvent(organizationId, trackerId, runId, providerWarning ? "provider_warning" : "provider_completed", eventTitle, details);
      console.log("Tracker provider collection completed", { trackerId, organizationId, runId, provider: providerName, recordsFetched: collection.recordsFetched, recordsFiltered, signalsGenerated: collection.signals.length, signalsSaved: inserted, diagnosticMode, zeroReason: collection.zeroReason, warningReason, providerWarnings: collection.warnings });
    } catch (error) {
      failedProviders += 1;
      warningProviders += 1;
      const detail = error instanceof Error ? error.message : "Unknown provider failure";
      const reasonCode = providerCollection ? "collection_processing_failed" : providerFailureCode(detail);
      const failedRequests: Json = providerCollection ? providerCollection.requests as unknown as Json : providerRequestsFromError(error);
      const failedRecordsFetched = providerCollection?.recordsFetched ?? requestRecordTotal(failedRequests);
      if (!providerCollection) recordsFetchedTotal += failedRecordsFetched;
      else recordsFilteredTotal += providerCollection.recordsFiltered;
      if (error instanceof SignalProcessingError) {
        recordsAnalyzedTotal += error.diagnostics.recordsAnalyzed;
        recordsScoredTotal += error.diagnostics.recordsScored;
        recordsAboveThresholdTotal += error.diagnostics.recordsAboveThreshold;
        recordsFilteredTotal += error.diagnostics.spamFiltered + error.diagnostics.batchDuplicates + error.diagnostics.existingIdDuplicates + error.diagnostics.existingContentDuplicates;
        insertedTotal += error.diagnostics.signalsSaved;
      }
      console.error(`Tracker ${providerName} discovery failed`, { trackerId, organizationId, recordsFetched: failedRecordsFetched, signalsGenerated: providerCollection?.signals.length ?? 0, detail });
      await admin.from("provider_status").upsert({ organization_id: organizationId, provider: providerName, connected: true, sync_status: "error", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
      const failedDetails: Record<string, Json> = {
        provider: providerName, reason: safeSignalProcessingReason(detail), reasonCode,
        recordsFetched: failedRecordsFetched, recordsFiltered: providerCollection?.recordsFiltered ?? 0,
        signalsGenerated: providerCollection?.signals.length ?? 0, signalsSaved: 0, warning: true, requests: failedRequests,
        duration_ms: Date.now() - providerStartedAt,
      };
        if (error instanceof SignalProcessingError) Object.assign(failedDetails, error.diagnostics, { reasonCode: error.code, signalsSaved: error.diagnostics.signalsSaved });
        else Object.assign(failedDetails, emptyProcessingDiagnostics());
      if (diagnosticMode && providerCollection) failedDetails.rawPreview = providerCollection.rawPreview as unknown as Json;
      await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", `${providerNameLabel(providerName)} could not complete`, failedDetails);

      if (providerName === "reddit" && await signalProviders.apify.healthCheck().catch(() => false)) {
        await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", "Trying Apify Reddit fallback", { provider: "apify", status: "connecting" });
        try {
          const fallback = await signalProviders.apify.collectSignals(enriched, { diagnosticMode });
          const ingested = diagnosticMode ? { inserted: 0, filtered: 0, diagnostics: emptyProcessingDiagnostics() } : await scoreDeduplicateAndIngest(enriched, "apify", fallback.signals, runId);
          recordsFetchedTotal += fallback.recordsFetched;
          recordsFilteredTotal += fallback.recordsFiltered + ingested.filtered;
          signalsGeneratedTotal += fallback.signals.length;
          insertedTotal += ingested.inserted;
          const fallbackWarning = fallback.recordsFetched === 0 || fallback.signals.length === 0;
          if (fallbackWarning) warningProviders += 1;
          else recoveredFailures += 1;
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "apify", connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          const fallbackDetails: Record<string, Json> = { provider: "apify", recordsFetched: fallback.recordsFetched, recordsFiltered: fallback.recordsFiltered + ingested.filtered, signalsGenerated: fallback.signals.length, signalsSaved: ingested.inserted, collected: fallback.signals.length, inserted: ingested.inserted, warning: fallbackWarning, zeroReason: fallback.zeroReason, diagnosticMode, requests: fallback.requests as unknown as Json };
          if (diagnosticMode) fallbackDetails.rawPreview = fallback.rawPreview as unknown as Json;
          await writeTrackerEvent(organizationId, trackerId, runId, fallbackWarning ? "provider_warning" : "provider_completed", fallbackWarning ? "Apify fallback returned no usable records" : "Apify Reddit fallback complete", fallbackDetails);
        } catch (fallbackError) {
          console.error("Apify Reddit fallback failed", fallbackError instanceof Error ? fallbackError.message : "Unknown error");
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "apify", connected: true, sync_status: "error", updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          const detail = fallbackError instanceof Error ? fallbackError.message : "Unknown provider failure";
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", "Apify Reddit fallback failed", { provider: "apify", reason: toSafeProviderReason(detail), reasonCode: providerFailureCode(detail), warning: true, recordsFetched: 0, recordsFiltered: 0, signalsGenerated: 0, signalsSaved: 0 });
        }
      }

      if ((providerName === "firecrawl" || providerName === "hackernews" || providerName === "rss") && await signalProviders.serper.healthCheck().catch(() => false)) {
        await writeTrackerEvent(organizationId, trackerId, runId, "provider_started", "Trying public search fallback for crawl sources", { provider: "serper", status: "connecting" });
        try {
          const fallback = await signalProviders.serper.collectSignals({ ...enriched, sources: [] }, { diagnosticMode });
          const ingested = diagnosticMode ? { inserted: 0, filtered: 0, diagnostics: emptyProcessingDiagnostics() } : await scoreDeduplicateAndIngest(enriched, "serper", fallback.signals, runId);
          recordsFetchedTotal += fallback.recordsFetched;
          recordsFilteredTotal += fallback.recordsFiltered + ingested.filtered;
          signalsGeneratedTotal += fallback.signals.length;
          insertedTotal += ingested.inserted;
          const fallbackWarning = fallback.recordsFetched === 0 || fallback.signals.length === 0;
          if (fallbackWarning) warningProviders += 1;
          else recoveredFailures += 1;
          await admin.from("provider_status").upsert({ organization_id: organizationId, provider: "serper", connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" });
          const fallbackDetails: Record<string, Json> = { provider: "serper", recordsFetched: fallback.recordsFetched, recordsFiltered: fallback.recordsFiltered + ingested.filtered, signalsGenerated: fallback.signals.length, signalsSaved: ingested.inserted, collected: fallback.signals.length, inserted: ingested.inserted, warning: fallbackWarning, zeroReason: fallback.zeroReason, diagnosticMode, requests: fallback.requests as unknown as Json };
          if (diagnosticMode) fallbackDetails.rawPreview = fallback.rawPreview as unknown as Json;
          await writeTrackerEvent(organizationId, trackerId, runId, fallbackWarning ? "provider_warning" : "provider_completed", fallbackWarning ? "Public search fallback returned no usable records" : "Public search fallback complete", fallbackDetails);
        } catch (fallbackError) {
          console.error("Public search fallback failed", fallbackError instanceof Error ? fallbackError.message : "Unknown error");
          const detail = fallbackError instanceof Error ? fallbackError.message : "Unknown provider failure";
          await writeTrackerEvent(organizationId, trackerId, runId, "provider_failed", "Public search fallback failed", { provider: "serper", reason: toSafeProviderReason(detail), reasonCode: providerFailureCode(detail), warning: true, recordsFetched: 0, recordsFiltered: 0, signalsGenerated: 0, signalsSaved: 0 });
        }
      }
    }
    const progress = totalProviders ? 8 + Math.floor(attemptedProviders / totalProviders * 88) : 8;
    await admin.from("tracker_runs").update({ progress, signals_found: insertedTotal, providers_completed: completedProviders }).eq("id", runId);
  }

  const status = !selected.length || (completedProviders === 0 && recoveredFailures === 0) ? "failed" : failedProviders > recoveredFailures || warningProviders > 0 ? "partial" : "completed";
  const warning = warningProviders > 0 || recordsFetchedTotal === 0 || signalsGeneratedTotal === 0;
  await finishTrackerRun(organizationId, trackerId, runId, status, insertedTotal, status === "failed" ? "No selected discovery provider completed successfully." : null);
  await writeTrackerEvent(organizationId, trackerId, runId, "run_completed", status === "completed" ? "Collection complete" : status === "partial" ? "Collection complete with warnings" : "Collection could not start", {
    status, warning, diagnosticMode, signalsFound: insertedTotal, recordsFetched: recordsFetchedTotal, recordsFiltered: recordsFilteredTotal,
    signalsGenerated: signalsGeneratedTotal, recordsAnalyzed: recordsAnalyzedTotal, recordsScored: recordsScoredTotal,
    recordsAboveThreshold: recordsAboveThresholdTotal, signalsSaved: insertedTotal,
    geminiStatus: diagnosticMode ? "not_used" : warningProviders ? "fallback_or_warning" : "healthy",
    supabaseStatus: failedProviders ? "partial_failure" : "success",
    providersCompleted: completedProviders, providersFailed: failedProviders, providersWarning: warningProviders,
  });
  console.log("Tracker collection run finished", { trackerId, organizationId, runId, status, warning, diagnosticMode, providersAttempted: attemptedProviders, recordsFetched: recordsFetchedTotal, recordsFiltered: recordsFilteredTotal, signalsGenerated: signalsGeneratedTotal, recordsAnalyzed: recordsAnalyzedTotal, recordsScored: recordsScoredTotal, recordsAboveThreshold: recordsAboveThresholdTotal, signalsSaved: insertedTotal });
  if (recordsFetchedTotal === 0) console.warn("Tracker is not tracking anything", { trackerId, organizationId, runId, reason: selected.length ? "No selected provider returned records." : "No discovery provider is configured." });
  else if (signalsGeneratedTotal === 0) console.warn("Tracker fetched records but generated no signals", { trackerId, organizationId, runId, recordsFetched: recordsFetchedTotal, recordsFiltered: recordsFilteredTotal });
  else if (insertedTotal === 0 && failedProviders === 0 && !diagnosticMode) console.warn("Tracker collection saved no new signals", { trackerId, organizationId, runId, signalsGenerated: signalsGeneratedTotal, recordsFiltered: recordsFilteredTotal, reason: "Records may have been filtered or already deduplicated." });
  if (failedProviders > 0) console.error("Tracker collection completed with provider processing failures", { trackerId, organizationId, runId, failedProviders, signalsSaved: insertedTotal, recordsFetched: recordsFetchedTotal, signalsGenerated: signalsGeneratedTotal });
  return { status, signalsFound: insertedTotal };
}

async function scoreDeduplicateAndIngest(tracker: SignalTracker, providerName: keyof typeof signalProviders, records: CollectedSignal[], runId: string) {
  const admin = createAdminClient();
  const diagnostics = emptyProcessingDiagnostics();
  console.info("Signal processing stage", { stage: "normalize_to_analysis", trackerId: tracker.id, provider: providerName, inputRecords: records.length });
  const candidates = records.filter((signal) => !isSpam(signal.post_snippet, tracker.negative_keywords));
  diagnostics.spamFiltered = records.length - candidates.length;
  const deduplicated = [...new Map(candidates.map((signal) => [`${signal.platform}:${signal.external_id}`, signal])).values()];
  diagnostics.batchDuplicates = candidates.length - deduplicated.length;
  const unique = deduplicated;
  console.info("Signal processing stage", { stage: "keyword_filter_and_batch_dedupe", trackerId: tracker.id, provider: providerName, normalized: records.length, spamFiltered: diagnostics.spamFiltered, batchDuplicates: diagnostics.batchDuplicates, remaining: unique.length });
  await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_processing_stage", "Records analyzed", { provider: providerName, stage: "keyword_filter_and_batch_dedupe", normalized: records.length, spamFiltered: diagnostics.spamFiltered, batchDuplicates: diagnostics.batchDuplicates, recordsAnalyzed: 0 });
  if (!unique.length) return { inserted: 0, filtered: records.length, scoringFallbacks: 0, scoringFallbackReasons: [] as string[], diagnostics };
  const candidateHashes = new Map(unique.map((signal) => [`${signal.platform}:${signal.external_id}`, contentHash(signal.post_snippet)]));
  const [existingIds, existingHashes] = await Promise.all([
    admin.from("intent_signals").select("platform, external_id").eq("organization_id", tracker.organization_id).in("platform", [...new Set(unique.map((signal) => signal.platform))]).in("external_id", unique.map((signal) => signal.external_id)),
    admin.from("intent_signals").select("content_hash").eq("organization_id", tracker.organization_id).in("content_hash", [...candidateHashes.values()]),
  ]);
  if (existingIds.error || existingHashes.error) {
    const dbError = existingIds.error ?? existingHashes.error;
    diagnostics.supabaseStatus = "failed";
    throw new SignalProcessingError(`Signal duplicate check failed (${dbError?.code ?? "unknown"}): ${dbError?.message ?? "database query failed"}`, "signal_duplicate_check_failed", diagnostics);
  }
  const seenIds = new Set(existingIds.data?.map((row) => `${row.platform}:${row.external_id}`) ?? []);
  const seenHashes = new Set(existingHashes.data?.map((row) => row.content_hash).filter((value): value is string => Boolean(value)) ?? []);
  const fresh = unique.filter((signal) => {
    const hash = candidateHashes.get(`${signal.platform}:${signal.external_id}`) ?? "";
    const existingId = seenIds.has(`${signal.platform}:${signal.external_id}`);
    const existingHash = seenHashes.has(hash);
    if (existingId) diagnostics.existingIdDuplicates += 1;
    else if (existingHash) diagnostics.existingContentDuplicates += 1;
    return !existingId && !existingHash;
  });
  diagnostics.recordsAnalyzed = fresh.length;
  console.info("Signal processing stage", { stage: "database_dedupe", trackerId: tracker.id, provider: providerName, candidates: unique.length, existingIdDuplicates: diagnostics.existingIdDuplicates, existingContentDuplicates: diagnostics.existingContentDuplicates, recordsAnalyzed: fresh.length });
  await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_processing_stage", "Existing signals checked", { provider: providerName, stage: "database_dedupe", candidates: unique.length, existingIdDuplicates: diagnostics.existingIdDuplicates, existingContentDuplicates: diagnostics.existingContentDuplicates, recordsAnalyzed: fresh.length });
  const scored: Array<CollectedSignal & Awaited<ReturnType<typeof scoreIntent>> & { content_hash: string; provider: string; community: string | null }> = [];
  for (const signal of fresh) {
    const title = typeof signal.raw_payload.title === "string" ? signal.raw_payload.title : "";
    const score = await scoreIntent({ organizationId: tracker.organization_id, keyword: signal.keyword, source: signal.platform, title, context: signal.post_snippet.slice(0, 5000) });
    const hash = candidateHashes.get(`${signal.platform}:${signal.external_id}`) ?? contentHash(signal.post_snippet);
    const redditCommunity = signal.platform === "reddit" && typeof signal.raw_payload.subreddit === "string" ? signal.raw_payload.subreddit : null;
    const community = redditCommunity ? `r/${redditCommunity.replace(/^r\//i, "")}` : signal.platform === "hackernews" ? "Hacker News" : null;
    scored.push({ ...signal, ...score, content_hash: hash, provider: providerName, community });
    diagnostics.recordsScored += 1;
    if (score.intent_score >= (tracker.alert_threshold ?? 75)) diagnostics.recordsAboveThreshold += 1;
    if (score.model === "keyword-fallback") {
      diagnostics.scoringFallbacks += 1;
      if ("fallbackReason" in score && typeof score.fallbackReason === "string") diagnostics.scoringFallbackReasons = [...new Set([...diagnostics.scoringFallbackReasons, score.fallbackReason])];
      if ("fallbackCode" in score && typeof score.fallbackCode === "string") diagnostics.scoringFallbackCodes = [...new Set([...diagnostics.scoringFallbackCodes, score.fallbackCode])];
    }
  }
  diagnostics.geminiStatus = diagnostics.scoringFallbacks ? "fallback" : scored.length ? "healthy" : "not_used";
  console.info("Signal processing stage", { stage: "analysis_and_scoring", trackerId: tracker.id, provider: providerName, recordsAnalyzed: diagnostics.recordsAnalyzed, recordsScored: diagnostics.recordsScored, recordsAboveThreshold: diagnostics.recordsAboveThreshold, threshold: tracker.alert_threshold ?? 75, scoringFallbacks: diagnostics.scoringFallbacks, scoringFallbackReasons: diagnostics.scoringFallbackReasons });
  await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_processing_stage", "Signals analyzed and scored", { provider: providerName, stage: "analysis_and_scoring", recordsAnalyzed: diagnostics.recordsAnalyzed, recordsScored: diagnostics.recordsScored, recordsAboveThreshold: diagnostics.recordsAboveThreshold, alertThreshold: tracker.alert_threshold ?? 75, scoringFallbacks: diagnostics.scoringFallbacks, scoringFallbackReasons: diagnostics.scoringFallbackReasons, scoringFallbackCodes: diagnostics.scoringFallbackCodes, geminiStatus: diagnostics.geminiStatus });
  if (!scored.length) return { inserted: 0, filtered: records.length, scoringFallbacks: 0, scoringFallbackReasons: [] as string[], diagnostics };

  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions").select("status, signals_used, signals_total").eq("organization_id", tracker.organization_id).maybeSingle();
  if (subscriptionError) {
    diagnostics.supabaseStatus = "failed";
    throw new SignalProcessingError(`Signal quota check failed (${subscriptionError.code}): ${subscriptionError.message}`, "signal_quota_check_failed", diagnostics);
  }
  if (!subscription || !["active", "trialing"].includes(subscription.status)) {
    diagnostics.supabaseStatus = "failed";
    throw new SignalProcessingError("Signal insert blocked: workspace has no active subscription.", "subscription_required", diagnostics);
  }
  let remainingSignalQuota = Math.max(0, subscription.signals_total - subscription.signals_used);

  const batchSize = 100;
  for (let offset = 0; offset < scored.length;) {
    if (remainingSignalQuota <= 0) {
      diagnostics.supabaseStatus = "failed";
      throw new SignalProcessingError(`Signal quota exceeded: ${diagnostics.signalsSaved} signals saved; ${scored.length - offset} scored signals remain, but this workspace has no signal quota left.`, "signal_quota_exceeded", diagnostics);
    }
    const currentBatchSize = Math.min(batchSize, remainingSignalQuota);
    const batch = scored.slice(offset, offset + currentBatchSize);
    const signalRows = batch.map((signal) => ({
      tracker_id: tracker.id, platform: signal.platform, external_id: signal.external_id, keyword: signal.keyword,
      prospect_name: signal.prospect_name, company: signal.company, source_url: signal.source_url, post_snippet: signal.post_snippet,
      intent_score: signal.intent_score, confidence: signal.confidence, category: signal.category, pain_intensity: signal.pain_intensity,
      buying_probability: signal.buying_probability, urgency: signal.urgency, decision_maker_likelihood: signal.decision_maker_likelihood,
      budget_intent: signal.budget_intent, raw_payload: signal.raw_payload, provider: signal.provider, community: signal.community, content_hash: signal.content_hash,
    }));
    console.info("Signal persistence started", {
      trackerId: tracker.id, provider: providerName, batch: Math.floor(offset / batchSize) + 1,
      signalsPrepared: batch.length, previouslySaved: diagnostics.signalsSaved,
      payloadSummary: signalRows.map((row) => ({ platform: row.platform, externalIdHash: createHash("sha256").update(row.external_id).digest("hex").slice(0, 12), keyword: row.keyword.slice(0, 120), snippetCharacters: row.post_snippet.length, prospectNamePresent: Boolean(row.prospect_name), companyPresent: Boolean(row.company), score: row.intent_score, confidence: row.confidence })),
    });
    let inserted: number;
    try {
      inserted = await insertSignalBatch(signalRows, async (batch) => {
        const result = await admin.rpc("ingest_signals", { target_org: tracker.organization_id, signal_rows: batch });
        return { data: result.data, error: result.error };
      }, diagnostics.signalsSaved);
    } catch (error) {
      diagnostics.supabaseStatus = "failed";
      const insertFailure = error instanceof SignalInsertError ? error : new SignalInsertError(error instanceof Error ? error.message : "Unknown Supabase insert error", "unknown", diagnostics.signalsSaved, batch.length);
      console.error("Signal persistence failed", { trackerId: tracker.id, provider: providerName, code: insertFailure.code, message: insertFailure.message, details: insertFailure.details, signalsPrepared: batch.length, signalsSavedBeforeFailure: diagnostics.signalsSaved });
      await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_processing_stage", "Signal insert failed", { provider: providerName, stage: "persistence", supabaseStatus: "failed", recordsAnalyzed: diagnostics.recordsAnalyzed, recordsScored: diagnostics.recordsScored, recordsAboveThreshold: diagnostics.recordsAboveThreshold, signalsSaved: diagnostics.signalsSaved, signalsInFailedBatch: insertFailure.failedBatchSize, errorCode: insertFailure.code, error: safeSignalProcessingReason(insertFailure.message) });
      const failureCode = /quota/i.test(insertFailure.message) ? "signal_quota_exceeded" : "signal_insert_failed";
      const failureText = /quota/i.test(insertFailure.message) ? `Signal quota exceeded during insert: ${safeSignalProcessingReason(insertFailure.message)}` : `Signal insert failed (${insertFailure.code}): ${safeSignalProcessingReason(insertFailure.message)}`;
      throw new SignalProcessingError(failureText, failureCode, diagnostics);
    }
    diagnostics.signalsSaved += inserted;
    remainingSignalQuota = Math.max(0, remainingSignalQuota - inserted);
    diagnostics.supabaseStatus = "success";
    console.info("Signal persistence completed", { trackerId: tracker.id, provider: providerName, batch: Math.floor(offset / batchSize) + 1, signalsPrepared: batch.length, signalsSaved: inserted, totalSignalsSaved: diagnostics.signalsSaved });
    offset += batch.length;
  }
  if (diagnostics.signalsSaved > 0) await writeTrackerEvent(tracker.organization_id, tracker.id, runId, "signal_detected", `${diagnostics.signalsSaved} intent signal${diagnostics.signalsSaved === 1 ? "" : "s"} detected`, { provider: providerName, count: diagnostics.signalsSaved });
  return { inserted: diagnostics.signalsSaved, filtered: Math.max(0, records.length - diagnostics.signalsSaved), scoringFallbacks: diagnostics.scoringFallbacks, scoringFallbackReasons: diagnostics.scoringFallbackReasons, diagnostics };
}

function contentHash(content: string) {
  const normalized = content.normalize("NFKC").toLocaleLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

async function writeTrackerEvent(organizationId: string, trackerId: string, runId: string | null, eventType: string, title: string, details: Record<string, Json>) {
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
  if (/no public RSS feed|no .*source|empty source/i.test(detail)) return "This provider has no usable source URLs configured.";
  if (/status 401|unauthorized/i.test(detail)) return "Provider rejected the credentials. Check the key or token.";
  if (/status 403|forbidden/i.test(detail)) return "Provider denied access. Check account permissions and plan access.";
  if (/status 429|rate limit/i.test(detail)) return "Provider rate limited this request. Check quota or retry later.";
  if (/malformed JSON|instead of JSON|could not be parsed/i.test(detail)) return "Provider returned a response the parser could not read.";
  if (/timeout|timed out/i.test(detail)) return "Provider did not respond in time. It can retry on the next scheduled run.";
  return "Provider request failed. Review its configuration and try again.";
}

function providerFailureCode(detail: string) {
  if (/status 429|rate limit/i.test(detail)) return "rate_limited";
  if (/not configured|credentials are missing/i.test(detail)) return "missing_api_key";
  if (/no public RSS feed|no .*source|empty source/i.test(detail)) return "missing_source_list";
  if (/malformed JSON|instead of JSON|could not be parsed/i.test(detail)) return "parser_failure";
  if (/status 401|unauthorized/i.test(detail)) return "invalid_api_key";
  return "provider_request_failed";
}

function safeSignalProcessingReason(detail: string) {
  const safe = detail
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/(api[_-]?key|token|secret|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return safe.slice(0, 500) || "Signal processing failed for an unknown reason.";
}

function providerRequestsFromError(error: unknown): Json {
  if (typeof error !== "object" || error === null || !("providerRequests" in error) || !Array.isArray(error.providerRequests)) return [];
  return error.providerRequests as Json;
}

function requestRecordTotal(value: Json) {
  if (!Array.isArray(value)) return 0;
  return value.reduce<number>((total, item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return total;
    const count = item.recordsFetched;
    return total + (typeof count === "number" ? count : 0);
  }, 0);
}

function redactDiagnosticSource(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch { return value.slice(0, 240); }
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
