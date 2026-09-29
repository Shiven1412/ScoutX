import { AnalyticsCharts, type DailyMetric } from "@/components/analytics-charts";
import { requireOrganization } from "@/lib/organization";
import { loadAnalytics } from "@/features/analytics/queries";

export default async function AnalyticsPage() {
  const { supabase, organization } = await requireOrganization();
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const result = await loadAnalytics(supabase, organization.id, sinceDate, today);
  const daily: DailyMetric[] = result.daily;
  const sourceCounts = result.sources;
  const trackerRows = result.trackers;
  const totals = [
    ["Signals collected", result.signals],
    ["Leads created", result.leads],
    ["Messages sent", result.sentMessages],
    ["Conversions", result.conversions],
  ] as const;
  return <div className="space-y-7"><div><p className="text-sm text-violet-300">Performance</p><h1 className="mt-2 text-3xl font-semibold">Analytics</h1><p className="mt-2 text-sm text-slate-400">Actual workspace records created in the last 30 days. No projections or seeded metrics.</p></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{totals.map(([label, value]) => <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5" key={label}><p className="text-sm text-slate-400">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></div>)}</section>
    <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Daily activity</h2><p className="mt-1 text-xs text-slate-500">Counts grouped by the record creation date.</p><div className="mt-6"><AnalyticsCharts daily={daily} /></div></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Signals by source</h2>{sourceCounts.length ? <ul className="mt-4 space-y-3">{sourceCounts.map(({ platform, signal_count }) => <li key={platform} className="flex items-center justify-between border-b border-white/[.07] pb-3 text-sm"><span className="capitalize text-slate-300">{platform}</span><span>{signal_count}</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No source data recorded during this period.</p>}</section>
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Keyword performance</h2>{trackerRows.length ? <ul className="mt-4 space-y-3">{trackerRows.map((tracker) => <li key={tracker.id} className="flex items-center justify-between border-b border-white/[.07] pb-3 text-sm"><span>{tracker.keyword}</span><span className="text-xs capitalize text-slate-400">{tracker.status}</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No trackers configured.</p>}</section></div>
  </div>;
}
