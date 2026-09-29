"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/organization";
import { trackerSchema } from "@/lib/validation/records";

function text(data: FormData, key: string) { return String(data.get(key) ?? ""); }

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
