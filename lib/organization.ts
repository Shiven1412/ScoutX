import "server-only";

import { redirect } from "next/navigation";
import type { Database } from "@/types/database";
import { requireUser } from "@/lib/auth";

export type OrganizationRole = Database["public"]["Tables"]["organization_members"]["Row"]["role"];

export async function requireOrganization(minimumRoles?: OrganizationRole[]) {
  const { supabase, user } = await requireUser();
  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Unable to load organization membership.");
  const membership = memberships?.[0];
  if (!membership) redirect("/onboarding");
  if (minimumRoles && !minimumRoles.includes(membership.role)) redirect("/dashboard?error=insufficient-role");

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name, slug, industry")
    .eq("id", membership.organization_id)
    .is("deleted_at", null)
    .single();
  if (organizationError || !organization) redirect("/onboarding");
  return { supabase, user, membership, organization };
}

export async function requirePlatformAdmin() {
  const { supabase, user } = await requireUser();
  const { data: profile, error } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).single();
  if (error || !profile?.is_platform_admin) redirect("/dashboard?error=insufficient-role");
  return { supabase, user };
}
