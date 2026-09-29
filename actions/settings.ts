"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/organization";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { createSecret } from "@/lib/security";
import { encryptSecret } from "@/lib/secret-box";
import { PLAN_LIMITS } from "@/lib/limits";
import { Resend } from "resend";
import { z } from "zod";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const inviteSchema = z.object({ email: z.string().trim().email().max(254), role: z.enum(["admin", "member"]) });
const apiKeySchema = z.object({ name: z.string().trim().min(2).max(100), expiresInDays: z.coerce.number().int().min(1).max(365).optional() });
const webhookSchema = z.object({ name: z.string().trim().min(2).max(100), endpointUrl: z.string().url().refine((value) => value.startsWith("https://"), "Webhook destinations must use HTTPS."), events: z.string().max(500).transform((value) => [...new Set(value.split(",").map((event) => event.trim()).filter(Boolean))].slice(0, 20)) });

export async function updateProfile(form: FormData) {
  const name = field(form, "fullName").trim();
  const company = field(form, "company").trim();
  const industry = field(form, "industry").trim();
  if (name.length < 2 || name.length > 120 || company.length > 120 || industry.length > 100) return { error: "Profile fields are invalid." };
  const { supabase, user } = await requireOrganization();
  const { error } = await supabase.from("profiles").update({ full_name: name, company: company || null, industry: industry || null }).eq("id", user.id);
  if (error) return { error: "Profile could not be updated." };
  revalidatePath("/settings/security");
  return { success: true };
}

export async function updateOrganization(form: FormData) {
  const name = field(form, "name").trim();
  const industry = field(form, "industry").trim();
  if (name.length < 2 || name.length > 120 || industry.length > 100) return { error: "Organization details are invalid." };
  const { supabase, organization, membership } = await requireOrganization();
  if (membership.role === "member") return { error: "Only organization owners and admins can edit these settings." };
  const { error } = await supabase.from("organizations").update({ name, industry: industry || null }).eq("id", organization.id);
  if (error) return { error: "Organization settings could not be saved." };
  revalidatePath("/settings"); revalidatePath("/dashboard");
  return { success: true };
}

export async function inviteMember(form: FormData) {
  const parsed = inviteSchema.safeParse({ email: field(form, "email"), role: field(form, "role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const { data: subscription } = await supabase.from("subscriptions").select("plan, seats_used").eq("organization_id", organization.id).maybeSingle();
  const plan = subscription?.plan ?? "starter";
  const { count, error: countError } = await supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["active", "invited"]);
  if (countError) return { error: "Unable to verify available seats." };
  if ((count ?? 0) >= PLAN_LIMITS[plan].seats) return { error: `This plan has reached its ${PLAN_LIMITS[plan].seats}-seat limit.` };
  const admin = createAdminClient();
  const email = parsed.data.email.toLowerCase();
  if (email === (user.email ?? "").toLowerCase()) return { error: "You are already a member of this workspace." };
  const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) {
    const { data: existingMembership } = await supabase.from("organization_members").select("status").eq("organization_id", organization.id).eq("user_id", existing.id).maybeSingle();
    if (existingMembership?.status === "active") return { error: "This person is already a member of the workspace." };
    if (existingMembership) return { error: "An invitation is already pending for this person." };
  }
  let invitedUserId = existing?.id;
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const redirectTo = `${appUrl}/auth/callback?next=%2Fsettings%2Fteam%2Finvitations`;
  if (!invitedUserId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) return { error: "The invitation could not be sent. Verify Supabase Auth email delivery and the address." };
    invitedUserId = data.user.id;
  } else {
    const resendKey = getServerEnv().RESEND_API_KEY;
    const from = getServerEnv().EMAIL_FROM;
    if (!resendKey || !from) return { error: "Inviting an existing account requires RESEND_API_KEY and a verified EMAIL_FROM address. No membership was created." };
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
    const actionLink = link?.properties?.action_link;
    if (linkError || !actionLink) return { error: "A secure invitation link could not be generated." };
    const { error: mailError } = await new Resend(resendKey).emails.send({
      from,
      to: email,
      subject: `Invitation to join ${organization.name} on ScoutX`,
      text: `You have been invited to join ${organization.name} as a ${parsed.data.role}. Accept this invitation by signing in with this secure link: ${actionLink}`,
    });
    if (mailError) return { error: "The invitation email could not be delivered. No membership was created." };
  }
  const { error } = await admin.from("organization_members").insert({ organization_id: organization.id, user_id: invitedUserId, role: parsed.data.role, status: "invited", invited_at: new Date().toISOString(), joined_at: null });
  if (error) return { error: "Invitation delivery succeeded, but workspace access could not be created. Contact support before resending." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "member.invited", entity_type: "organization_member", metadata: { email, role: parsed.data.role } });
  revalidatePath("/settings/team");
  return { success: true };
}

export async function acceptInvitation(form: FormData) {
  const organizationId = field(form, "organizationId");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { error: "Invalid invitation." };
    const { supabase } = await requireUser();
  const { error } = await supabase.rpc("accept_organization_invitation", { target_org: organizationId });
  if (error) return { error: "This invitation is expired, already used, or not assigned to your account." };
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function changeMemberRole(form: FormData) {
  const memberId = field(form, "memberId"); const role = field(form, "role");
  if (!/^[0-9a-f-]{36}$/i.test(memberId) || !["admin", "member"].includes(role)) return { error: "Invalid member role." };
  const { supabase, organization } = await requireOrganization(["owner"]);
  const { data: member } = await supabase.from("organization_members").select("id, role").eq("id", memberId).eq("organization_id", organization.id).maybeSingle();
  if (!member || member.role === "owner") return { error: "The workspace owner role cannot be changed here." };
  const admin = createAdminClient();
  const { error } = await admin.from("organization_members").update({ role: role as "admin" | "member" }).eq("id", memberId).eq("organization_id", organization.id);
  if (error) return { error: "Member role could not be updated." };
  revalidatePath("/settings/team");
  return { success: true };
}

export async function removeMember(form: FormData) {
  const memberId = field(form, "memberId");
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return { error: "Invalid member." };
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { data: member } = await supabase.from("organization_members").select("user_id, role").eq("id", memberId).eq("organization_id", organization.id).maybeSingle();
  if (!member || member.role === "owner") return { error: "The owner cannot be removed." };
  if (member.user_id === (await supabase.auth.getUser()).data.user?.id) return { error: "You cannot remove yourself from the team here." };
  const admin = createAdminClient();
  const { error } = await admin.from("organization_members").delete().eq("id", memberId).eq("organization_id", organization.id);
  if (error) return { error: "Member access could not be removed." };
  revalidatePath("/settings/team");
  return { success: true };
}

export async function createApiKey(form: FormData) {
  const parsed = apiKeySchema.safeParse({ name: field(form, "name"), expiresInDays: field(form, "expiresInDays") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid API key details." };
  const { supabase, user, organization, membership } = await requireOrganization(["owner", "admin"]);
  const { token, hash, prefix } = createSecret("scoutx");
  const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86400000).toISOString() : null;
  const { error } = await supabase.from("api_keys").insert({ organization_id: organization.id, created_by: user.id, name: parsed.data.name, key_prefix: prefix, key_hash: hash, scopes: ["signals:write"], expires_at: expiresAt });
  if (error) return { error: "API key could not be created." };
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "api_key.created", entity_type: "api_key", metadata: { name: parsed.data.name } });
  revalidatePath("/settings/security");
  return { success: true, secret: token, role: membership.role };
}

export async function revokeApiKey(form: FormData) {
  const id = field(form, "id"); if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid API key." };
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", organization.id).is("revoked_at", null);
  if (error) return { error: "API key could not be revoked." };
  revalidatePath("/settings/security"); return { success: true };
}

export async function createWebhook(form: FormData) {
  const parsed = webhookSchema.safeParse({ name: field(form, "name"), endpointUrl: field(form, "endpointUrl"), events: field(form, "events") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid webhook." };
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const url = new URL(parsed.data.endpointUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".local")) return { error: "Private or local webhook hosts are not allowed." };
  const { token } = createSecret("whsec");
  let encrypted: string;
  try { encrypted = encryptSecret(token); }
  catch { return { error: "Webhook secret encryption is not configured on the server." }; }
  const { error } = await supabase.from("webhooks").insert({ organization_id: organization.id, created_by: user.id, name: parsed.data.name, endpoint_url: parsed.data.endpointUrl, secret_encrypted: encrypted, events: parsed.data.events });
  if (error) return { error: "Webhook could not be saved." };
  revalidatePath("/settings/security");
  return { success: true, secret: token };
}

export async function revokeWebhook(form: FormData) {
  const id = field(form, "id"); if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid webhook." };
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { error } = await supabase.from("webhooks").update({ active: false }).eq("id", id).eq("organization_id", organization.id);
  if (error) return { error: "Webhook could not be disabled." };
  revalidatePath("/settings/security"); return { success: true };
}
