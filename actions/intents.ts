"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/organization";

export async function saveSignalAsLead(data: FormData) {
  const id = String(data.get("signalId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid signal." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: signal } = await supabase.from("intent_signals").select("id, prospect_name, company, platform, source_url, post_snippet").eq("id", id).eq("organization_id", organization.id).maybeSingle();
  if (!signal) return { error: "Signal not found in this workspace." };
  if (!signal.prospect_name || !signal.company) return { error: "This signal has no verified prospect name and company. Add a lead manually instead." };
  const { data: existing } = await supabase.from("leads").select("id").eq("organization_id", organization.id).eq("intent_signal_id", signal.id).is("deleted_at", null).limit(1).maybeSingle();
  if (existing) redirect(`/leads/${existing.id}`);
  const { data: lead, error } = await supabase.from("leads").insert({ organization_id: organization.id, created_by: user.id, intent_signal_id: signal.id, name: signal.prospect_name, company: signal.company, platform: signal.platform, source_post: signal.post_snippet }).select("id").single();
  if (error || !lead) return { error: "Unable to save this lead." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "lead.created_from_signal", entity_type: "lead", entity_id: lead.id, metadata: { signal_id: signal.id } });
  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}
