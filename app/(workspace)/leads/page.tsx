import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, Search } from "lucide-react";
import { setLeadStatus } from "@/actions/leads";
import { requireOrganization } from "@/lib/organization";

const statuses = ["new", "contacted", "replied", "meeting", "converted", "disqualified"] as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, organization } = await requireOrganization();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 25;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const status = typeof params.status === "string" && statuses.includes(params.status as typeof statuses[number]) ? params.status as typeof statuses[number] : "";
  let query = supabase.from("leads").select("id, name, company, title, email, platform, status, estimated_value, created_at", { count: "exact" }).eq("organization_id", organization.id).is("deleted_at", null).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("name", `%${q.replace(/[%,_]/g, " ")}%`);
  const { data, count, error } = await query;
  if (error) throw new Error("Leads could not be loaded.");
  const rows = data ?? [];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-violet-300">Customer relationship management</p><h1 className="mt-2 text-3xl font-semibold">Leads</h1><p className="mt-2 text-sm text-slate-400">Manage saved prospects and pipeline status.</p></div><Link href="/leads/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold hover:bg-violet-500"><Plus className="size-4" />Add lead</Link></div>
    <form className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-slate-900/50 p-3"><label className="relative min-w-[220px] flex-1"><span className="sr-only">Search by name</span><Search className="absolute left-3 top-3 size-4 text-slate-500" /><input name="q" defaultValue={q} placeholder="Search leads by name" className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 pl-9 pr-3 text-sm" /></label><select name="status" defaultValue={status} className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="rounded-lg bg-white/10 px-4 text-sm">Search</button></form>
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Lead</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Value</th><th className="px-5 py-3">Quick status</th></tr></thead><tbody className="divide-y divide-white/[.07]">{rows.map((lead) => <tr key={lead.id}><td className="px-5 py-4"><Link href={`/leads/${lead.id}`} className="font-medium hover:text-violet-200">{lead.name}</Link><p className="mt-1 text-xs text-slate-500">{lead.title || lead.email || "—"}</p></td><td className="px-4 py-4">{lead.company}</td><td className="px-4 py-4 text-slate-400">{lead.platform || "—"}</td><td className="px-4 py-4 capitalize">{lead.status}</td><td className="px-4 py-4">{lead.estimated_value === null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(lead.estimated_value)}</td><td className="px-5 py-4"><form action={async (formData) => { "use server"; await setLeadStatus(formData); }} className="flex gap-2"><input type="hidden" name="id" value={lead.id} /><select name="status" defaultValue={lead.status} aria-label={`Update ${lead.name} status`} className="h-8 rounded border border-white/10 bg-slate-950 px-2 text-xs">{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="rounded border border-white/10 px-2 text-xs">Save</button></form></td></tr>)}</tbody></table></div> : <div className="px-6 py-16 text-center"><h2 className="font-medium">No leads found</h2><p className="mt-2 text-sm text-slate-400">Create a lead directly or save one from an intent signal.</p><Link href="/leads/new" className="mt-4 inline-flex text-sm text-violet-300">Create lead <Plus className="ml-1 size-4" /></Link></div>}
    <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-xs text-slate-500"><span>{count ?? 0} leads · Page {page} of {totalPages}</span><div className="flex gap-2">{page > 1 && <Link href={href(params, page - 1)} className="flex items-center gap-1 rounded border border-white/10 px-3 py-2"><ArrowLeft className="size-3" />Previous</Link>}{page < totalPages && <Link href={href(params, page + 1)} className="flex items-center gap-1 rounded border border-white/10 px-3 py-2">Next<ArrowRight className="size-3" /></Link>}</div></div></div>
  </div>;
}

function href(params: Record<string, string | string[] | undefined>, page: number) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") query.set(key, value); query.set("page", String(page)); return `/leads?${query}`; }
