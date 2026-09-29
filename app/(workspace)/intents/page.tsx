import Link from "next/link";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { requireOrganization } from "@/lib/organization";
import type { Database } from "@/types/database";

const categories: Database["public"]["Tables"]["intent_signals"]["Row"]["category"][] = ["pain_point", "seeking_alternative", "feature_request", "buying_intent", "recommendation_request"];

export default async function IntentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, organization } = await requireOrganization();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 25;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const platform = typeof params.platform === "string" ? params.platform.slice(0, 80) : "";
  const keyword = typeof params.keyword === "string" ? params.keyword.trim().slice(0, 180) : "";
  const dateFrom = validDate(params.from);
  const dateTo = validDate(params.to);
  const category = typeof params.category === "string" && categories.includes(params.category as typeof categories[number]) ? params.category as typeof categories[number] : "";
  const minConfidence = Math.min(100, Math.max(0, Number(params.confidence) || 0));
  const sort = params.sort === "score" ? "intent_score" : "created_at";
  let query = supabase.from("intent_signals").select("id, platform, keyword, prospect_name, company, source_url, post_snippet, intent_score, confidence, category, created_at", { count: "exact" }).eq("organization_id", organization.id).gte("confidence", minConfidence).order(sort, { ascending: params.direction === "asc" }).range((page - 1) * pageSize, page * pageSize - 1);
  if (platform) query = query.eq("platform", platform);
  if (category) query = query.eq("category", category);
  if (keyword) query = query.ilike("keyword", `%${keyword.replace(/[%,_]/g, " ")}%`);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lt("created_at", `${addDays(dateTo, 1)}T00:00:00.000Z`);
  if (q) {
    const safeSearch = q.replace(/[^\p{L}\p{N}\s@-]/gu, " ").trim().replace(/\s+/g, " ");
    if (safeSearch) query = query.or(`post_snippet.ilike.%${safeSearch}%,prospect_name.ilike.%${safeSearch}%,company.ilike.%${safeSearch}%`);
  }
  const { data, count, error } = await query;
  if (error) throw new Error("Intent signals could not be loaded.");
  const rows = data ?? [];
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const platforms = ["reddit", "hackernews", "rss", "slack", "webhook"];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-violet-300">Intent intelligence</p><h1 className="mt-2 text-3xl font-semibold">Signals</h1><p className="mt-2 text-sm text-slate-400">Search and prioritize persisted signals from connected sources.</p></div><p className="text-sm text-slate-500">{count ?? 0} matching records</p></div>
    <form className="grid gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-4 sm:grid-cols-2 xl:grid-cols-5">
      <label className="relative sm:col-span-2 xl:col-span-2"><span className="sr-only">Search signal, prospect, or company</span><Search className="absolute left-3 top-3 size-4 text-slate-500" /><input name="q" defaultValue={q} placeholder="Search signals, prospects, companies" className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm outline-none focus:border-violet-400" /></label>
      <select name="platform" defaultValue={platform} className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="">All sources</option>{platforms.map((value) => <option value={value} key={value}>{value}</option>)}</select>
      <select name="category" defaultValue={category} className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="">All categories</option>{categories.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select>
      <input name="keyword" defaultValue={keyword} placeholder="Keyword" className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm" />
      <div className="flex gap-2"><input type="number" name="confidence" min={0} max={100} defaultValue={minConfidence || ""} placeholder="Min confidence" className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm" /><button className="rounded-lg bg-violet-600 px-4 text-sm font-semibold hover:bg-violet-500">Filter</button></div>
      <label className="text-xs text-slate-500">From<input type="date" name="from" defaultValue={dateFrom} className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-slate-200" /></label>
      <label className="text-xs text-slate-500">To<input type="date" name="to" defaultValue={dateTo} className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-slate-200" /></label>
      <select name="sort" defaultValue={sort === "intent_score" ? "score" : "recent"} className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="recent">Sort: newest</option><option value="score">Sort: intent score</option></select>
      <select name="direction" defaultValue={typeof params.direction === "string" ? params.direction : "desc"} className="h-10 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
    </form>
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50">
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b border-white/10 bg-white/[.025] text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Prospect & context</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Confidence</th><th className="px-4 py-3">Intent score</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-white/[.07]">{rows.map((signal) => <tr key={signal.id} className="hover:bg-white/[.02]"><td className="max-w-lg px-5 py-4"><p className="font-medium">{signal.prospect_name || "Prospect not identified"}{signal.company ? <span className="font-normal text-slate-400"> · {signal.company}</span> : null}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{signal.post_snippet}</p><p className="mt-1 text-xs text-slate-500">{signal.keyword} · {new Date(signal.created_at).toLocaleDateString()}</p></td><td className="px-4 py-4 text-slate-300">{signal.platform}</td><td className="px-4 py-4 text-slate-300">{signal.category.replaceAll("_", " ")}</td><td className="px-4 py-4">{signal.confidence}%</td><td className="px-4 py-4 font-semibold text-violet-200">{signal.intent_score}</td><td className="px-5 py-4"><Link href={`/intents/${signal.id}`} className="text-xs text-violet-300 hover:text-white">Details</Link></td></tr>)}</tbody></table></div> : <div className="px-6 py-16 text-center"><h2 className="font-medium">No signals match these filters</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">Signals only appear after a real data source or authorized integration sends records to this workspace. Adjust filters or configure an integration.</p><Link href="/integrations" className="mt-4 inline-flex text-sm text-violet-300">Configure integrations <ArrowRight className="ml-1 size-4" /></Link></div>}
      <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-xs text-slate-500"><span>Page {page} of {pageCount}</span><div className="flex gap-2">{page > 1 && <Link className="flex items-center gap-1 rounded border border-white/10 px-3 py-2" href={pageHref(params, page - 1)}><ArrowLeft className="size-3" />Previous</Link>}{page < pageCount && <Link className="flex items-center gap-1 rounded border border-white/10 px-3 py-2" href={pageHref(params, page + 1)}>Next<ArrowRight className="size-3" /></Link>}</div></div>
    </div>
  </div>;
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") query.set(key, value);
  query.set("page", String(page));
  return `/intents?${query.toString()}`;
}

function validDate(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
