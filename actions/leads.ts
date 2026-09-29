"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/organization";
import { leadSchema } from "@/lib/validation/records";
import { deliverWebhookEvent } from "@/services/webhooks";

const value = (data: FormData, key: string) => String(data.get(key) ?? "");

export async function createLead(data: FormData) {
  const parsed = leadSchema.safeParse({ name: value(data, "name"), company: value(data, "company"), title: value(data, "title"), email: value(data, "email"), platform: value(data, "platform"), sourcePost: value(data, "sourcePost"), notes: value(data, "notes"), status: value(data, "status") || "new", estimatedValue: value(data, "estimatedValue") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid lead details." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: lead, error } = await supabase.from("leads").insert({
    organization_id: organization.id, created_by: user.id, name: parsed.data.name, company: parsed.data.company,
    title: parsed.data.title || null, email: parsed.data.email || null, platform: parsed.data.platform || null,
    source_post: parsed.data.sourcePost || null, notes: parsed.data.notes ?? "", status: parsed.data.status,
    estimated_value: parsed.data.estimatedValue ?? null,
  }).select("id").single();
  if (error || !lead) return { error: "Lead could not be saved." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "lead.created", entity_type: "lead", entity_id: lead.id });
  await deliverWebhookEvent(organization.id, "lead.created", { lead_id: lead.id }).catch((error: unknown) => console.error("Lead webhook delivery failed", error));
  revalidatePath("/leads"); revalidatePath("/dashboard");
  return { success: true, id: lead.id };
}

export async function updateLead(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid lead." };
  const parsed = leadSchema.safeParse({ name: value(data, "name"), company: value(data, "company"), title: value(data, "title"), email: value(data, "email"), platform: value(data, "platform"), sourcePost: value(data, "sourcePost"), notes: value(data, "notes"), status: value(data, "status") || "new", estimatedValue: value(data, "estimatedValue") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid lead details." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: saved, error } = await supabase.from("leads").update({
    name: parsed.data.name, company: parsed.data.company, title: parsed.data.title || null,
    email: parsed.data.email || null, platform: parsed.data.platform || null, source_post: parsed.data.sourcePost || null,
    notes: parsed.data.notes ?? "", status: parsed.data.status, estimated_value: parsed.data.estimatedValue ?? null,
  }).eq("id", id).eq("organization_id", organization.id).is("deleted_at", null).select("id").maybeSingle();
  if (error) return { error: "Lead changes could not be saved." };
  if (!saved) return { error: "Lead not found in this workspace." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "lead.updated", entity_type: "lead", entity_id: id });
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`); revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteLead(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid lead." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: archived, error } = await supabase.from("leads").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("organization_id", organization.id).is("deleted_at", null).select("id").maybeSingle();
  if (error) return { error: "Lead could not be archived." };
  if (!archived) return { error: "Lead not found in this workspace." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "lead.archived", entity_type: "lead", entity_id: id });
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`);
  return { success: true };
}

export async function restoreLead(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid lead." };
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const { data: restored, error } = await supabase.from("leads").update({ deleted_at: null }).eq("id", id).eq("organization_id", organization.id).not("deleted_at", "is", null).select("id").maybeSingle();
  if (error) return { error: "Lead could not be restored." };
  if (!restored) return { error: "Archived lead not found in this workspace." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "lead.restored", entity_type: "lead", entity_id: id });
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`);
  return { success: true };
}

export async function setLeadStatus(data: FormData) {
  const id = value(data, "id");
  const status = value(data, "status");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["new", "contacted", "replied", "meeting", "converted", "disqualified"].includes(status)) return { error: "Invalid lead status." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: updated, error } = await supabase.from("leads").update({ status: status as "new" | "contacted" | "replied" | "meeting" | "converted" | "disqualified" }).eq("id", id).eq("organization_id", organization.id).is("deleted_at", null).select("id").maybeSingle();
  if (error) return { error: "Lead status could not be changed." };
  if (!updated) return { error: "Lead not found in this workspace." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: `lead.status.${status}`, entity_type: "lead", entity_id: id });
  revalidatePath("/leads"); revalidatePath(`/leads/${id}`); revalidatePath("/dashboard");
  return { success: true };
}
