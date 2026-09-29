import { requirePlatformAdmin } from "@/lib/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlatformRoleToggle } from "@/components/forms/admin-controls";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { user: actor } = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 50;
  const admin = createAdminClient();
  const { data, count, error } = await admin
    .from("users")
    .select(
      "id, email, display_name, created_at, profiles(is_platform_admin, company)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("Platform users could not be loaded.");
  return (
    <div>
      <p className="text-sm text-amber-300">Platform administration</p>
      <h2 className="mt-2 text-3xl font-semibold">Users</h2>
      <p className="mt-2 text-sm text-slate-400">
        {count ?? 0} registered accounts.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/50">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Account</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Platform role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-5 py-3">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[.07]">
            {(data ?? []).map((account) => {
              const profile = Array.isArray(account.profiles)
                ? account.profiles[0]
                : account.profiles;
              return (
                <tr key={account.id}>
                  <td className="px-5 py-4">
                    <p className="font-medium">{account.display_name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {account.email}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-slate-400">
                    {profile?.company || "—"}
                  </td>
                  <td className="px-4 py-4">
                    {profile?.is_platform_admin ? "Platform admin" : "User"}
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500">
                    {new Date(account.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    <PlatformRoleToggle
                      userId={account.id}
                      enabled={Boolean(profile?.is_platform_admin)}
                      isSelf={account.id === actor.id}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
