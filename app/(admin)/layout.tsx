import { requirePlatformAdmin } from "@/lib/organization";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requirePlatformAdmin();
  return <main className="mx-auto min-h-screen max-w-[1500px] px-5 py-8 sm:px-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-300">Restricted area</p><h1 className="mt-1 text-lg font-semibold">Platform administration</h1></div><span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-200">Platform admin</span></div><nav aria-label="Platform administration" className="mb-7 flex flex-wrap gap-2">{[["/admin", "Overview"], ["/admin/users", "Users"], ["/admin/organizations", "Organizations"], ["/admin/system-health", "System health"], ["/admin/feature-flags", "Feature flags"], ["/admin/audit-logs", "Audit logs"]].map(([href, label]) => <Link key={href} href={href} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/[.05]">{label}</Link>)}</nav>{children}</main>;
}
