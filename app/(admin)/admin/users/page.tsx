import { requirePlatformAdmin } from "@/lib/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlatformRoleToggle } from "@/components/forms/admin-controls";
import Link from "next/link";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { user: actor } = await requirePlatformAdmin();
  const params = await searchParams;
  const query = (params.q ?? "").trim().replace(/[,%()]/g, "").slice(0, 100);
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const pageSize = 50;
  const admin = createAdminClient();
  let usersQuery = admin
    .from("users")
    .select("id, email, display_name, created_at", { count: "exact" });
  if (query) usersQuery = usersQuery.or(`email.ilike.%${query}%,display_name.ilike.%${query}%`);
  const { data: firstPage, count, error } = await usersQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range((requestedPage - 1) * pageSize, requestedPage * pageSize - 1);
  if (error) {
    console.error("Platform user list query failed", { code: error.code, message: error.message });
    return <AdminUsersError />;
  }
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const page = Math.min(requestedPage, totalPages);
  let data = firstPage ?? [];
  if (page !== requestedPage) {
    let correctedQuery = admin.from("users").select("id, email, display_name, created_at");
    if (query) correctedQuery = correctedQuery.or(`email.ilike.%${query}%,display_name.ilike.%${query}%`);
    const corrected = await correctedQuery.order("created_at", { ascending: false }).order("id", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    if (corrected.error) {
      console.error("Platform users corrected-page query failed", { code: corrected.error.code, message: corrected.error.message });
      return <AdminUsersError />;
    }
    data = corrected.data ?? [];
  }
  const userIds = data.map((account) => account.id);
  const { data: profiles, error: profileError } = userIds.length
    ? await admin.from("profiles").select("id, is_platform_admin, company").in("id", userIds)
    : { data: [], error: null };
  if (profileError) {
    console.error("Platform user profiles query failed", { code: profileError.code, message: profileError.message });
    return <AdminUsersError />;
  }
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const pageHref = (targetPage: number) => `/admin/users?page=${targetPage}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  return (
    <div>
      <p className="text-sm text-amber-300">Platform administration</p>
      <h2 className="mt-2 text-3xl font-semibold">Users</h2>
      <p className="mt-2 text-sm text-slate-400">
        {count ?? 0} registered accounts.
      </p>
      <form action="/admin/users" className="mt-5 flex flex-wrap gap-2">
        <input type="search" name="q" defaultValue={query} placeholder="Search name or email" aria-label="Search users" className="h-10 min-w-64 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-500" />
        <button className="h-10 rounded-lg border border-white/10 px-4 text-sm hover:bg-white/[.05]">Search</button>
      </form>
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
            {data.map((account) => {
              const profile = profileById.get(account.id);
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
            {!data.length && <tr><td className="px-5 py-10 text-center text-slate-400" colSpan={5}>{query ? "No matching users." : "No users found."}</td></tr>}
          </tbody>
        </table>
      </div>
      <nav aria-label="User list pagination" className="mt-4 flex items-center justify-between text-sm text-slate-400">
        <span>Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          {page > 1 ? <Link className="rounded-lg border border-white/10 px-3 py-2 hover:bg-white/[.05]" href={pageHref(page - 1)}>Previous</Link> : <span className="rounded-lg border border-white/5 px-3 py-2 text-slate-600">Previous</span>}
          {page < totalPages ? <Link className="rounded-lg border border-white/10 px-3 py-2 hover:bg-white/[.05]" href={pageHref(page + 1)}>Next</Link> : <span className="rounded-lg border border-white/5 px-3 py-2 text-slate-600">Next</span>}
        </div>
      </nav>
    </div>
  );
}

function AdminUsersError() {
  return <section role="alert" className="mt-6 rounded-xl border border-red-300/20 bg-red-300/[.04] p-5"><h3 className="font-semibold text-red-200">Users could not be loaded</h3><p className="mt-2 text-sm text-slate-300">The secure platform user query failed. Check server runtime logs for the database error and retry.</p><Link href="/admin/users" className="mt-3 inline-flex text-sm text-violet-200">Retry loading users →</Link></section>;
}
