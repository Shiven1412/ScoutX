import { WorkspaceShell } from "@/components/workspace-shell";
import { requireOrganization } from "@/lib/organization";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, organization, membership } = await requireOrganization();
  const { data: profile } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  return <WorkspaceShell organizationName={organization.name} role={membership.role} isPlatformAdmin={Boolean(profile?.is_platform_admin)}>{children}</WorkspaceShell>;
}
