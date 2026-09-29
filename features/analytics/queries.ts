import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function loadAnalytics(supabase: SupabaseClient<Database>, organizationId: string, startDate: string, endDate: string) {
  const [signals, leads, conversions, sentMessages, daily, sources, trackers] = await Promise.all([
    supabase.from("intent_signals").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("created_at", `${startDate}T00:00:00.000Z`).lt("created_at", `${addDays(endDate, 1)}T00:00:00.000Z`),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).is("deleted_at", null).gte("created_at", `${startDate}T00:00:00.000Z`).lt("created_at", `${addDays(endDate, 1)}T00:00:00.000Z`),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).is("deleted_at", null).eq("status", "converted").gte("created_at", `${startDate}T00:00:00.000Z`).lt("created_at", `${addDays(endDate, 1)}T00:00:00.000Z`),
    supabase.from("outreach_messages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).is("deleted_at", null).eq("status", "sent").gte("created_at", `${startDate}T00:00:00.000Z`).lt("created_at", `${addDays(endDate, 1)}T00:00:00.000Z`),
    supabase.rpc("get_workspace_analytics", { target_org: organizationId, start_date: startDate, end_date: endDate }),
    supabase.rpc("get_signal_source_counts", { target_org: organizationId, start_date: startDate }),
    supabase.from("keyword_trackers").select("id, keyword, status").eq("organization_id", organizationId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
  ]);
  if (signals.error || leads.error || conversions.error || sentMessages.error || daily.error || sources.error || trackers.error) throw new Error("Analytics data could not be loaded.");
  return {
    signals: signals.count ?? 0,
    leads: leads.count ?? 0,
    conversions: conversions.count ?? 0,
    sentMessages: sentMessages.count ?? 0,
    daily: (daily.data ?? []).map((row) => ({ date: row.day, signals: row.signal_count, leads: row.lead_count, replies: row.reply_count, conversions: row.conversion_count })),
    sources: sources.data ?? [],
    trackers: trackers.data ?? [],
  };
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
