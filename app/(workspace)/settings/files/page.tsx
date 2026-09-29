import { AssetManager } from "@/components/forms/asset-manager";
import { requireOrganization } from "@/lib/organization";

export default async function WorkspaceFilesPage() {
  const { supabase, organization, membership } = await requireOrganization();
  const { data, error } = await supabase.storage.from("organization-files").list(organization.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw new Error("Workspace files could not be loaded. Verify private Storage setup.");
  const folders = (data ?? []).filter((item) => item.id === null).map((folder) => folder.name);
  const nested = await Promise.all(folders.map(async (folder) => {
    const { data: files, error: listError } = await supabase.storage.from("organization-files").list(`${organization.id}/${folder}`, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    if (listError) throw new Error("Workspace files could not be listed.");
    return (files ?? []).map((file) => ({ name: `${organization.id}/${folder}/${file.name}`, created_at: file.created_at ?? file.updated_at ?? new Date(0).toISOString(), metadata: file.metadata }));
  }));
  return <div className="space-y-6"><div><p className="text-sm text-violet-300">Workspace resources</p><h1 className="mt-2 text-3xl font-semibold">Files</h1><p className="mt-2 text-sm text-slate-400">Private documents and images stored for {organization.name}.</p></div><AssetManager organizationId={organization.id} initialAssets={nested.flat()} canManage={membership.role !== "member"} /></div>;
}