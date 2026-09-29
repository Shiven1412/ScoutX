"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/organization";
import { createAdminClient } from "@/lib/supabase/admin";

const flagSchema = z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,80}$/), description: z.string().trim().max(500), enabled: z.enum(["true", "false"]) });

export async function createFeatureFlag(form: FormData) {
  const parsed = flagSchema.safeParse({ key: form.get("key"), description: form.get("description") ?? "", enabled: form.get("enabled") ?? "false" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid feature flag." };
  const { user } = await requirePlatformAdmin(); const admin = createAdminClient();
  const { error } = await admin.from("feature_flags").insert({ key: parsed.data.key, description: parsed.data.description, enabled: parsed.data.enabled === "true" });
  if (error) return { error: "Feature flag already exists or could not be saved." };
  await admin.from("audit_logs").insert({ actor_id: user.id, action: "feature_flag.created", resource_type: "feature_flag", metadata: { key: parsed.data.key, enabled: parsed.data.enabled === "true" } });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}

export async function setFeatureFlag(form: FormData) {
  const id = String(form.get("id") ?? ""); const enabled = String(form.get("enabled") ?? "");
  if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(id) || !["true", "false"].includes(enabled)) return { error: "Invalid flag update." };
  const { user } = await requirePlatformAdmin(); const admin = createAdminClient();
  const { data: flag, error } = await admin.from("feature_flags").update({ enabled: enabled === "true" }).eq("key", id).select("id, key").single();
  if (error || !flag) return { error: "Feature flag could not be updated." };
  await admin.from("audit_logs").insert({ actor_id: user.id, action: "feature_flag.updated", resource_type: "feature_flag", resource_id: flag.id, metadata: { key: flag.key, enabled: enabled === "true" } });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}

export async function setPlatformAdmin(form: FormData) {
  const userId = String(form.get("userId") ?? ""); const enabled = String(form.get("enabled") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !["true", "false"].includes(enabled)) return { error: "Invalid account update." };
  const { user } = await requirePlatformAdmin();
  if (userId === user.id && enabled === "false") return { error: "You cannot remove your own platform-admin access here." };
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_platform_admin: enabled === "true" }).eq("id", userId);
  if (error) return { error: "Platform role could not be updated." };
  await admin.from("audit_logs").insert({ actor_id: user.id, action: "platform_admin.updated", resource_type: "user", resource_id: userId, metadata: { is_platform_admin: enabled === "true" } });
  revalidatePath("/admin/users");
  return { success: true };
}

export async function suspendSubscription(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { error: "Invalid organization." };
  const { user } = await requirePlatformAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("subscriptions").update({ status: "canceled", stripe_subscription_id: null }).eq("organization_id", organizationId);
  if (error) return { error: "Subscription status could not be changed." };
  await admin.from("audit_logs").insert({ actor_id: user.id, organization_id: organizationId, action: "subscription.admin_canceled", resource_type: "subscription", metadata: {} });
  revalidatePath("/admin/organizations");
  redirect("/admin/organizations");
}

export async function setFeatureFlagEnabled(form: FormData) {
  const key = String(form.get("key") ?? "");
  const enabled = String(form.get("enabled") ?? "");
  if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(key) || !["true", "false"].includes(enabled)) return { error: "Invalid feature flag change." };
  const { user } = await requirePlatformAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("feature_flags").update({ enabled: enabled === "true" }).eq("key", key);
  if (error) return { error: "Feature flag could not be updated." };
  await admin.from("audit_logs").insert({ actor_id: user.id, action: "feature_flag.toggled", resource_type: "feature_flag", metadata: { key, enabled: enabled === "true" } });
  revalidatePath("/admin/feature-flags");
  return { success: true };
}

export async function archiveOrganization(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { error: "Invalid organization." };
  const { user } = await requirePlatformAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ deleted_at: new Date().toISOString() }).eq("id", organizationId).is("deleted_at", null);
  if (error) return { error: "Organization could not be archived." };
  await admin.from("audit_logs").insert({ actor_id: user.id, organization_id: organizationId, action: "organization.archived", resource_type: "organization", resource_id: organizationId, metadata: {} });
  revalidatePath("/admin/organizations");
  return { success: true };
}

export async function deleteOrganizationPermanently(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || confirmation !== organizationId) return { error: "Type the exact organization ID to confirm permanent deletion." };
  const { user } = await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data: organization, error: lookupError } = await admin.from("organizations").select("name").eq("id", organizationId).is("deleted_at", null).maybeSingle();
  if (lookupError || !organization) return { error: "Organization not found or already archived." };
  const { error: auditError } = await admin.from("audit_logs").insert({ actor_id: user.id, organization_id: organizationId, action: "organization.deleted_permanently", resource_type: "organization", resource_id: organizationId, metadata: { organization_name: organization.name, confirmation_id: organizationId } });
  if (auditError) return { error: "Permanent deletion was not performed because the audit record could not be saved." };
  const { error } = await admin.from("organizations").delete().eq("id", organizationId);
  if (error) return { error: "Organization data could not be permanently deleted." };
  revalidatePath("/admin/organizations");
  return { success: true };
}
