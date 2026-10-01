import Link from "next/link";
import { notFound } from "next/navigation";
import { TrackerManualForm, type ManualTrackerValues } from "@/components/forms/tracker-manual-form";
import { requireOrganization } from "@/lib/organization";

const supportedProviders = new Set(["reddit", "serper", "firecrawl", "rss", "hackernews"]);

export default async function EditTrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, organization } = await requireOrganization();
  const [trackerResult, keywordsResult, sourcesResult, queriesResult] = await Promise.all([
    supabase.from("keyword_trackers").select("id, keyword, negative_keywords, communities, platforms, alert_threshold, excluded_categories").eq("id", id).eq("organization_id", organization.id).is("deleted_at", null).maybeSingle(),
    supabase.from("tracker_keywords").select("keyword_type, keyword").eq("tracker_id", id).eq("organization_id", organization.id),
    supabase.from("tracker_sources").select("source_type, source_value").eq("tracker_id", id).eq("organization_id", organization.id),
    supabase.from("tracker_queries").select("query").eq("tracker_id", id).eq("organization_id", organization.id),
  ]);
  if (trackerResult.error || keywordsResult.error || sourcesResult.error || queriesResult.error) throw new Error("Tracker settings could not be loaded.");
  const tracker = trackerResult.data;
  if (!tracker) notFound();
  const productKeywords = keywordsResult.data?.filter((row) => row.keyword_type === "product").map((row) => row.keyword) ?? [];
  const intentKeywords = keywordsResult.data?.filter((row) => row.keyword_type === "intent").map((row) => row.keyword) ?? [];
  const queryValues = queriesResult.data?.map((row) => row.query) ?? [];
  const redundantQueries = new Set([...productKeywords, ...intentKeywords]);
  const values: ManualTrackerValues = {
    id: tracker.id,
    keyword: tracker.keyword,
    keywords: productKeywords.length ? productKeywords : [tracker.keyword],
    intentKeywords,
    negativeKeywords: tracker.negative_keywords,
    communities: tracker.communities,
    sources: tracker.platforms.filter((source) => supportedProviders.has(source)),
    websites: sourcesResult.data?.filter((row) => row.source_type === "website").map((row) => row.source_value) ?? [],
    queries: [...new Set(queryValues.filter((query) => !redundantQueries.has(query)))],
    alertThreshold: tracker.alert_threshold,
    excludedCategories: tracker.excluded_categories,
  };
  return <div className="mx-auto max-w-3xl"><Link href={`/campaigns/${id}`} className="text-sm text-slate-400 hover:text-white">← Back to tracker</Link><h1 className="mt-4 text-3xl font-semibold">Edit tracker</h1><p className="mt-2 text-sm text-slate-400">Update the criteria and sources this tracker uses for future collection runs.</p><section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-6"><TrackerManualForm initialValues={values} mode="edit" /></section></div>;
}