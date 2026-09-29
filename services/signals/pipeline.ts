import "server-only";

import { scoreIntent } from "@/services/ai";
import { signalProviders, type SignalProvider, type SignalTracker } from "@/services/signals/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export type ScheduledJob = SignalProvider["name"] | "reprocess" | "analytics";

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

async function collectSignals(providerName: SignalProvider["name"]) {
  const admin = createAdminClient();
  const provider = signalProviders[providerName];
  const configured = await provider.healthCheck();
  const { data: trackers, error } = await admin.from("keyword_trackers").select("id, organization_id, keyword, negative_keywords, communities, platforms").eq("status", "active").is("deleted_at", null).limit(500);
  if (error) throw new Error("Active keyword trackers could not be loaded.");

  const matched = (trackers ?? []).filter((tracker) => tracker.platforms.length === 0 || tracker.platforms.some((platform) => platform.toLowerCase() === providerName));
  const organizationIds = [...new Set(matched.map((tracker) => tracker.organization_id))];
  for (const organizationId of organizationIds) {
    await admin.from("provider_status").upsert({
      organization_id: organizationId,
      provider: providerName,
      connected: configured,
      sync_status: configured ? "syncing" : "error",
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,provider" });
  }
  if (!configured) return 0;

  let insertedTotal = 0;
  const orgErrors = new Set<string>();
  for (const tracker of matched) {
    try {
      const collected = await provider.collectSignals(tracker as SignalTracker);
      const candidates = collected.filter((signal) => !isSpam(signal.post_snippet, tracker.negative_keywords));
      const unique = [...new Map(candidates.map((signal) => [`${signal.platform}:${signal.external_id}`, signal])).values()].slice(0, 25);
      if (!unique.length) continue;
      const { data: alreadyStored, error: duplicateReadError } = await admin.from("intent_signals").select("external_id").eq("organization_id", tracker.organization_id).eq("platform", providerName).in("external_id", unique.map((signal) => signal.external_id));
      if (duplicateReadError) throw new Error("Signal duplicate check failed.");
      const existingIds = new Set((alreadyStored ?? []).map((row) => row.external_id));
      const newCandidates = unique.filter((signal) => !existingIds.has(signal.external_id));
      if (!newCandidates.length) continue;

      const scored = [];
      for (const signal of newCandidates) {
        const scores = await scoreIntent({ organizationId: tracker.organization_id, keyword: signal.keyword, source: signal.platform, context: signal.post_snippet.slice(0, 5000) });
        scored.push({ ...signal, ...scores });
      }
      const { data: inserted, error: ingestError } = await admin.rpc("ingest_signals", {
        target_org: tracker.organization_id,
        signal_rows: scored.map((signal) => ({
          tracker_id: signal.tracker_id,
          platform: signal.platform,
          external_id: signal.external_id,
          keyword: signal.keyword,
          prospect_name: signal.prospect_name,
          company: signal.company,
          source_url: signal.source_url,
          post_snippet: signal.post_snippet,
          intent_score: signal.intent_score,
          confidence: signal.confidence,
          category: signal.category,
          pain_intensity: signal.pain_intensity,
          buying_probability: signal.buying_probability,
          urgency: signal.urgency,
          decision_maker_likelihood: signal.decision_maker_likelihood,
          budget_intent: signal.budget_intent,
          raw_payload: signal.raw_payload,
        })),
      });
      if (ingestError) throw new Error("Scored signals could not be persisted.");
      insertedTotal += inserted ?? 0;
    } catch (error) {
      orgErrors.add(tracker.organization_id);
      console.error(`Scheduled ${providerName} collection failed for a tracker`, error);
    }
  }

  for (const organizationId of organizationIds) {
    await admin.from("provider_status").update({
      connected: configured,
      sync_status: orgErrors.has(organizationId) ? "error" : "healthy",
      ...(orgErrors.has(organizationId) ? {} : { last_sync_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }).eq("organization_id", organizationId).eq("provider", providerName);
  }
  if (orgErrors.size > 0) throw new Error(`${providerName} collection reported failed workspaces. Check provider status for per-workspace details.`);
  return insertedTotal;
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
