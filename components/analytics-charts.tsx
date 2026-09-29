"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DailyMetric = { date: string; signals: number; leads: number; replies: number; conversions: number };

export function AnalyticsCharts({ daily }: { daily: DailyMetric[] }) {
  if (!daily.length) return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 text-center"><div><p className="text-sm font-medium">No activity in this period</p><p className="mt-2 text-xs text-slate-500">Charts populate from actual signal, lead, and outreach records.</p></div></div>;
  return <div className="h-80 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10 }} /><Legend /><Line type="monotone" dataKey="signals" stroke="#a78bfa" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="leads" stroke="#38bdf8" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="replies" stroke="#34d399" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="conversions" stroke="#fbbf24" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>;
}
