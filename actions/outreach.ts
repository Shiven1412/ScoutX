"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Resend } from "resend";
import { requireOrganization } from "@/lib/organization";
import { getServerEnv } from "@/lib/env";
import { generateOutreachDraft } from "@/services/ai";
import { outreachSchema } from "@/lib/validation/records";
import { deliverWebhookEvent } from "@/services/webhooks";

const value = (data: FormData, key: string) => String(data.get(key) ?? "");

export async function createOutreachDraft(data: FormData) {
  const parsed = outreachSchema.safeParse({ leadId: value(data, "leadId"), channel: value(data, "channel"), subject: value(data, "subject"), content: value(data, "content") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid outreach draft." };
  const { supabase, user, organization } = await requireOrganization();
  if (parsed.data.leadId) {
    const { data: lead } = await supabase.from("leads").select("id").eq("id", parsed.data.leadId).eq("organization_id", organization.id).is("deleted_at", null).maybeSingle();
    if (!lead) return { error: "The selected lead is not available in this workspace." };
  }
  const { data: draft, error } = await supabase.from("outreach_messages").insert({ organization_id: organization.id, created_by: user.id, lead_id: parsed.data.leadId || null, channel: parsed.data.channel, subject: parsed.data.subject, content: parsed.data.content }).select("id").single();
  if (error || !draft) return { error: "The outreach draft could not be saved." };
  const { error: versionError } = await supabase.from("outreach_versions").insert({ organization_id: organization.id, outreach_message_id: draft.id, version: 1, subject: parsed.data.subject, content: parsed.data.content, changed_by: user.id });
  if (versionError) return { error: "Draft saved but version history could not be recorded." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "outreach.created", entity_type: "outreach_message", entity_id: draft.id });
  revalidatePath("/outreach");
  redirect(`/outreach/${draft.id}`);
}

export async function generateDraftFromSignal(data: FormData) {
  const id = value(data, "signalId");
  const channel = value(data, "channel");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["email", "linkedin"].includes(channel)) return { error: "Invalid signal or channel." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: signal, error } = await supabase.from("intent_signals").select("id, prospect_name, company, platform, keyword, source_url, post_snippet").eq("id", id).eq("organization_id", organization.id).maybeSingle();
  if (error || !signal) return { error: "Signal is unavailable." };
  let draft: Awaited<ReturnType<typeof generateOutreachDraft>>;
  try {
    draft = await generateOutreachDraft({ organizationId: organization.id, prospectName: signal.prospect_name, company: signal.company, source: signal.platform, context: signal.post_snippet, channel: channel as "email" | "linkedin" });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Draft generation failed." };
  }
  const { data: lead } = await supabase.from("leads").select("id").eq("intent_signal_id", signal.id).eq("organization_id", organization.id).is("deleted_at", null).limit(1).maybeSingle();
  const { data: saved, error: saveError } = await supabase.from("outreach_messages").insert({
    organization_id: organization.id, created_by: user.id, lead_id: lead?.id ?? null, channel: channel as "email" | "linkedin",
    subject: draft.subject || `${signal.keyword} follow-up`, content: draft.content, generation_metadata: { provider: draft.provider, model: draft.model, signal_id: signal.id },
  }).select("id, subject, content").single();
  if (saveError || !saved) return { error: "Generated draft could not be stored." };
  const { error: historyError } = await supabase.from("outreach_versions").insert({ organization_id: organization.id, outreach_message_id: saved.id, version: 1, subject: saved.subject, content: saved.content, generation_metadata: { provider: draft.provider, model: draft.model }, changed_by: user.id });
  if (historyError) return { error: "Draft saved but version history could not be recorded." };
  revalidatePath("/outreach");
  redirect(`/outreach/${saved.id}`);
}

export async function saveOutreachEdits(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid draft." };
  const parsed = outreachSchema.safeParse({ leadId: value(data, "leadId"), channel: value(data, "channel"), subject: value(data, "subject"), content: value(data, "content") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid draft content." };
  const { supabase, user, organization } = await requireOrganization();
  const { data: existing, error: existingError } = await supabase.from("outreach_messages").select("id, subject, content, generation_metadata").eq("id", id).eq("organization_id", organization.id).eq("status", "draft").is("deleted_at", null).maybeSingle();
  if (existingError || !existing) return { error: "Only a saved draft can be edited." };
  const { error } = await supabase.from("outreach_messages").update({ subject: parsed.data.subject, content: parsed.data.content, channel: parsed.data.channel }).eq("id", id).eq("organization_id", organization.id).eq("status", "draft").is("deleted_at", null);
  if (error) return { error: "Draft changes could not be saved." };
  if (existing.subject !== parsed.data.subject || existing.content !== parsed.data.content) {
    const { data: latest } = await supabase.from("outreach_versions").select("version").eq("organization_id", organization.id).eq("outreach_message_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
    const { error: historyError } = await supabase.from("outreach_versions").insert({ organization_id: organization.id, outreach_message_id: id, version: (latest?.version ?? 0) + 1, subject: parsed.data.subject, content: parsed.data.content, generation_metadata: existing.generation_metadata, changed_by: user.id });
    if (historyError) return { error: "Draft saved but version history could not be recorded." };
    await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "outreach.edited", entity_type: "outreach_message", entity_id: id });
  }
  revalidatePath(`/outreach/${id}`); revalidatePath("/outreach");
  return { success: true };
}

export async function approveOutreach(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid draft." };
  const { supabase, organization, user } = await requireOrganization();
  const { data: message, error } = await supabase.from("outreach_messages").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id).eq("organization_id", organization.id).eq("status", "draft").is("deleted_at", null).select("id").maybeSingle();
  if (error || !message) return { error: "Only a saved draft can be approved." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "outreach.approved", entity_type: "outreach_message", entity_id: id });
  revalidatePath(`/outreach/${id}`); revalidatePath("/outreach");
  return { success: true };
}

export async function sendApprovedEmail(data: FormData) {
  const id = value(data, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid outreach message." };
  const { supabase, organization, user } = await requireOrganization();
  const { data: message, error } = await supabase.from("outreach_messages").select("id, lead_id, channel, subject, content, status").eq("id", id).eq("organization_id", organization.id).eq("status", "approved").maybeSingle();
  if (error || !message) return { error: "Only an approved message can be sent." };
  if (message.channel !== "email" || !message.lead_id) return { error: "Email delivery requires an email draft linked to a lead with an email address." };
  const { data: lead } = await supabase.from("leads").select("email").eq("id", message.lead_id).eq("organization_id", organization.id).maybeSingle();
  if (!lead?.email) return { error: "Add a verified recipient email to this lead before sending." };
  const env = getServerEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { error: "Email delivery requires RESEND_API_KEY and a verified EMAIL_FROM address on the server." };

  let sentId: string;
  try {
    const result = await new Resend(env.RESEND_API_KEY).emails.send({ from: env.EMAIL_FROM, to: lead.email, subject: message.subject, text: message.content });
    if (result.error || !result.data?.id) return { error: "The email provider did not accept this message." };
    sentId = result.data.id;
  } catch {
    await supabase.from("outreach_messages").update({ status: "failed" }).eq("id", id).eq("organization_id", organization.id).eq("status", "approved");
    return { error: "Email delivery failed. Check provider configuration and try a new draft." };
  }

  const { error: updateError } = await supabase.from("outreach_messages").update({ status: "sent", sent_at: new Date().toISOString(), generation_metadata: { delivery_provider: "resend", delivery_id: sentId } }).eq("id", id).eq("organization_id", organization.id).eq("status", "approved");
  if (updateError) return { error: "The email was accepted but its delivery status could not be saved; reconcile against the Resend event log." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "outreach.sent", entity_type: "outreach_message", entity_id: id });
  await deliverWebhookEvent(organization.id, "outreach.sent", { outreach_message_id: id, lead_id: message.lead_id }).catch((error: unknown) => console.error("Outreach webhook delivery failed", error));
  revalidatePath(`/outreach/${id}`); revalidatePath("/outreach");
  return { success: true };
}
