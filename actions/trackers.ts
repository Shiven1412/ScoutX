"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { requireOrganization } from "@/lib/organization";
import { trackerSchema } from "@/lib/validation/records";
import { businessProfileSchema, discoveryBackendBySource, discoverySourcesSchema, generatedBusinessProfileSchema, manualTrackerSchema, type ManualTrackerInput } from "@/lib/validation/tracker-profile";
import { generateBusinessProfile as generateBusinessProfileWithGemini } from "@/services/ai";
import type { Json } from "@/types/database";
import { markTrackerRunFailed, runTrackerDiscovery } from "@/services/signals/pipeline";

function text(data: FormData, key: string) { return String(data.get(key) ?? ""); }
function list(data: FormData, key: string) { return [...new Set(text(data, key).split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean))]; }

function parseManualTracker(data: FormData) {
  return manualTrackerSchema.safeParse({
    keyword: text(data, "keyword"),
    keywords: list(data, "keywords"),
    intentKeywords: list(data, "intentKeywords"),
    negativeKeywords: list(data, "negativeKeywords"),
    communities: list(data, "communities"),
    sources: data.getAll("sources").map(String),
    websites: list(data, "websites"),
    queries: list(data, "queries"),
    alertThreshold: text(data, "alertThreshold") || "75",
  });
}

function manualTrackerRpcArgs(organizationId: string, tracker: ManualTrackerInput) {
  return {
    target_org: organizationId,
    target_keyword: tracker.keyword,
    target_keywords: tracker.keywords,
    target_intent_keywords: tracker.intentKeywords,
    target_negative_keywords: tracker.negativeKeywords,
    target_communities: tracker.communities,
    target_sources: tracker.sources,
    target_websites: tracker.websites,
    target_queries: tracker.queries,
    target_alert_threshold: tracker.alertThreshold,
  };
}

export async function generateTrackerProfile(data: FormData) {
  const description = text(data, "businessDescription").trim();
  if (description.length < 20 || description.length > 3000) return { error: "Describe your product, customers, and value in 20–3,000 characters." };
  try {
    const cookieStore = await cookies();
    cookieStore.delete("scoutx_tracker_brief");
    const { organization } = await requireOrganization();
    const profile = await generateBusinessProfileWithGemini({ organizationId: organization.id, businessDescription: description });
    return { profile };
  } catch (error) {
    console.error("Tracker profile generation failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "Unable to generate discovery plan. Check the provider configuration and try again." };
  }
}

export async function createAiTracker(data: FormData) {
  const description = text(data, "businessDescription").trim();
  let profileValue: unknown;
  try { profileValue = JSON.parse(text(data, "profile")); }
  catch { return { error: "The tracker preview is invalid. Generate the suggestions again." }; }
  const profile = generatedBusinessProfileSchema.safeParse({ ...profileValue as object, businessDescription: description });
  if (!profile.success) return { error: profile.error.issues[0]?.message ?? "Review the tracker suggestions and try again." };
  if (!businessProfileSchema.safeParse(profile.data).success) return { error: "The generated tracker data is invalid." };
  let sourceValue: unknown;
  try { sourceValue = JSON.parse(text(data, "sources")); }
  catch { return { error: "Select at least one discovery source and try again." }; }
  const sources = discoverySourcesSchema.safeParse(sourceValue);
  if (!sources.success) return { error: sources.error.issues[0]?.message ?? "Select at least one discovery source." };
  try {
    const { supabase, organization } = await requireOrganization();
    const { data: created, error } = await supabase.rpc("create_ai_tracker_with_run", { target_org: organization.id, target_profile: profile.data as unknown as Json, target_sources: sources.data });
    const result = Array.isArray(created) ? created[0] : null;
    if (error || !result?.tracker_id || !result.run_id) {
      console.error("AI tracker creation failed", { code: error?.code, message: error?.message });
      return { error: "Tracker creation failed. Check your workspace configuration and retry." };
    }
    after(async () => {
      try {
        await runTrackerDiscovery(organization.id, result.tracker_id, result.run_id);
      } catch (error) {
        console.error("Tracker discovery background run failed", error instanceof Error ? error.message : "Unknown error");
        await markTrackerRunFailed(organization.id, result.tracker_id, result.run_id).catch((persistError) => console.error("Tracker failure state update failed", persistError));
      }
    });
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    return {
      success: true,
      trackerId: result.tracker_id,
      runId: result.run_id,
      counts: {
        keywords: profile.data.keywords.length + profile.data.intentKeywords.length,
        communities: profile.data.communities.length,
        subreddits: profile.data.subreddits.length,
        searchQueries: profile.data.searchQueries.length + profile.data.intentKeywords.length,
        signalSources: new Set(sources.data.map((source) => discoveryBackendBySource[source])).size,
      },
    };
  } catch (error) {
    console.error("AI tracker save failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "Tracker creation failed. Please check your configuration and retry." };
  }
}

export async function createManualTracker(data: FormData) {
  const parsed = parseManualTracker(data);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the tracker details and try again." };
  try {
    const { supabase, user, organization } = await requireOrganization();
    const { data: created, error } = await supabase.rpc("create_manual_tracker_with_run", manualTrackerRpcArgs(organization.id, parsed.data));
    const result = Array.isArray(created) ? created[0] : null;
    if (error || !result?.tracker_id || !result.run_id) {
      console.error("Manual tracker creation failed", { code: error?.code, message: error?.message });
      return { error: "Tracker could not be created. Check the details and try again." };
    }
    await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "tracker.created", entity_type: "keyword_tracker", entity_id: result.tracker_id, metadata: { creation_mode: "manual" } });
    after(async () => {
      try { await runTrackerDiscovery(organization.id, result.tracker_id, result.run_id); }
      catch (error) {
        console.error("Manual tracker discovery background run failed", error instanceof Error ? error.message : "Unknown error");
        await markTrackerRunFailed(organization.id, result.tracker_id, result.run_id).catch((persistError) => console.error("Tracker failure state update failed", persistError));
      }
    });
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    return { success: true, trackerId: result.tracker_id, runId: result.run_id };
  } catch (error) {
    console.error("Manual tracker save failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "Tracker could not be created. Please try again." };
  }
}

export async function updateTracker(data: FormData) {
  const id = text(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid tracker." };
  const parsed = parseManualTracker(data);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the tracker details and try again." };
  try {
    const { supabase, user, organization } = await requireOrganization();
    const { data: updated, error } = await supabase.rpc("update_manual_tracker", { target_tracker: id, ...manualTrackerRpcArgs(organization.id, parsed.data) });
    if (error || updated !== true) return { error: "Tracker could not be updated. It may have been archived or removed." };
    await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "tracker.updated", entity_type: "keyword_tracker", entity_id: id });
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/dashboard");
    return { success: true, trackerId: id };
  } catch (error) {
    console.error("Tracker update failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "Tracker could not be updated. Please try again." };
  }
}

export async function rerunTracker(data: FormData) {
  const id = text(data, "id");
  const diagnosticMode = text(data, "diagnosticMode") === "true";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid tracker." };
  try {
    const { supabase, organization } = await requireOrganization();
    const { data: runId, error } = await supabase.rpc("create_tracker_run", { target_org: organization.id, target_tracker: id, target_diagnostic_mode: diagnosticMode });
    if (error || !runId) {
      console.error("Tracker run could not be created", { code: error?.code, message: error?.message, diagnosticMode });
      return { error: "A new collection run could not be started. Apply the tracker management and provider diagnostics migrations, ensure the tracker is active, then retry." };
    }
    after(async () => {
      try { await runTrackerDiscovery(organization.id, id, runId); }
      catch (error) {
        console.error("Tracker rerun background execution failed", error instanceof Error ? error.message : "Unknown error");
        await markTrackerRunFailed(organization.id, id, runId).catch((persistError) => console.error("Tracker failure state update failed", persistError));
      }
    });
    revalidatePath(`/campaigns/${id}`);
    return { success: true, trackerId: id, runId };
  } catch (error) {
    console.error("Tracker rerun request failed", error instanceof Error ? error.message : "Unknown error");
    return { error: "A new collection run could not be started. Please try again." };
  }
}

export async function getTrackerRunSnapshot(trackerId: string, runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(trackerId) || !/^[0-9a-f-]{36}$/i.test(runId)) return { error: "Invalid tracker run." };
  const { supabase, organization } = await requireOrganization();
  const [runResult, eventsResult, signalsResult, trackerResult] = await Promise.all([
    supabase.from("tracker_runs").select("id, tracker_id, status, progress, signals_found, providers_total, providers_completed, last_error, diagnostic_mode, started_at, completed_at, created_at").eq("id", runId).eq("tracker_id", trackerId).eq("organization_id", organization.id).maybeSingle(),
    supabase.from("tracker_events").select("id, run_id, event_type, title, details, created_at").eq("run_id", runId).eq("tracker_id", trackerId).eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("intent_signals").select("id, platform, provider, community, post_snippet, confidence, intent_score, category, keyword, created_at").eq("tracker_id", trackerId).eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("keyword_trackers").select("id, keyword, platforms, communities").eq("id", trackerId).eq("organization_id", organization.id).maybeSingle(),
  ]);
  if (runResult.error || eventsResult.error || signalsResult.error || trackerResult.error || !runResult.data || !trackerResult.data) return { error: "Tracker monitoring details could not be loaded." };
  return { run: runResult.data, events: eventsResult.data ?? [], signals: signalsResult.data ?? [], tracker: trackerResult.data };
}

export async function createTracker(data: FormData) {
  const parsed = trackerSchema.safeParse({ keyword: text(data, "keyword"), negativeKeywords: text(data, "negativeKeywords"), communities: text(data, "communities"), platforms: text(data, "platforms"), alertThreshold: text(data, "alertThreshold") || "75" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid tracker details." };
  const { supabase, user, organization } = await requireOrganization();
  const { error } = await supabase.from("keyword_trackers").insert({ organization_id: organization.id, created_by: user.id, keyword: parsed.data.keyword, negative_keywords: parsed.data.negativeKeywords, communities: parsed.data.communities, platforms: parsed.data.platforms, alert_threshold: parsed.data.alertThreshold });
  if (error) return { error: "Tracker could not be saved. Check the details and try again." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "tracker.created", entity_type: "keyword_tracker" });
  revalidatePath("/campaigns"); revalidatePath("/dashboard");
  return { success: true };
}

export async function setTrackerStatus(data: FormData) {
  const id = text(data, "id");
  const status = text(data, "status");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["active", "paused"].includes(status)) return { error: "Invalid tracker." };
  const { supabase, user, organization } = await requireOrganization();
  const { error } = await supabase.from("keyword_trackers").update({ status: status as "active" | "paused" }).eq("id", id).eq("organization_id", organization.id).is("deleted_at", null);
  if (error) return { error: "Tracker status could not be changed." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: `tracker.${status}`, entity_type: "keyword_tracker", entity_id: id });
  revalidatePath("/campaigns"); revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteTracker(data: FormData) {
  const id = text(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid tracker." };
  const { supabase, user, organization } = await requireOrganization();
  const { error } = await supabase.from("keyword_trackers").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("organization_id", organization.id);
  if (error) return { error: "Tracker could not be archived." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "tracker.archived", entity_type: "keyword_tracker", entity_id: id });
  revalidatePath("/campaigns"); revalidatePath("/dashboard");
  return { success: true };
}

export async function restoreTracker(data: FormData) {
  const id = text(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid tracker." };
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const { data: restored, error } = await supabase.from("keyword_trackers").update({ deleted_at: null }).eq("id", id).eq("organization_id", organization.id).not("deleted_at", "is", null).select("id").maybeSingle();
  if (error) return { error: "Tracker could not be restored." };
  if (!restored) return { error: "Archived tracker not found in this workspace." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "tracker.restored", entity_type: "keyword_tracker", entity_id: id });
  revalidatePath("/campaigns"); revalidatePath("/dashboard");
  return { success: true };
}
