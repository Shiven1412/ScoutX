"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, Play } from "lucide-react";
import { createManualTracker, updateTracker } from "@/actions/trackers";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

const providers = [
  { id: "reddit", label: "Reddit API", note: "Public posts in selected subreddits" },
  { id: "serper", label: "Public web search", note: "Search-indexed public conversations" },
  { id: "hackernews", label: "Hacker News", note: "Stories and comments" },
  { id: "firecrawl", label: "Website scraping", note: "Public pages you list below" },
  { id: "rss", label: "RSS feeds", note: "Public feed URLs you list below" },
] as const;

export type ManualTrackerValues = {
  id?: string;
  keyword: string;
  keywords: string[];
  intentKeywords: string[];
  negativeKeywords: string[];
  communities: string[];
  sources: string[];
  websites: string[];
  queries: string[];
  alertThreshold: number;
};

const emptyValues: ManualTrackerValues = {
  keyword: "", keywords: [], intentKeywords: [], negativeKeywords: [], communities: [], sources: ["reddit"], websites: [], queries: [], alertThreshold: 75,
};

export function TrackerManualForm({ initialValues = emptyValues, mode = "create" }: { initialValues?: ManualTrackerValues; mode?: "create" | "edit" }) {
  const router = useRouter();
  const [values, setValues] = useState<ManualTrackerValues>(initialValues);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData();
    if (mode === "edit" && values.id) form.set("id", values.id);
    form.set("keyword", values.keyword);
    form.set("keywords", values.keywords.join("\n"));
    form.set("intentKeywords", values.intentKeywords.join("\n"));
    form.set("negativeKeywords", values.negativeKeywords.join("\n"));
    form.set("communities", values.communities.join("\n"));
    form.set("websites", values.websites.join("\n"));
    form.set("queries", values.queries.join("\n"));
    form.set("alertThreshold", String(values.alertThreshold));
    for (const source of values.sources) form.append("sources", source);
    startTransition(async () => {
      try {
        if (mode === "edit") {
          const result = await updateTracker(form);
          if (result.error) { setError(result.error); return; }
          if (!result.success || !result.trackerId) { setError("Tracker could not be saved. Please check the details and retry."); return; }
          router.push(`/campaigns/${result.trackerId}`);
        } else {
          const result = await createManualTracker(form);
          if (result.error) { setError(result.error); return; }
          if (!result.success || !result.trackerId || !result.runId) { setError("Tracker could not be saved. Please check the details and retry."); return; }
          router.push(`/campaigns/${result.trackerId}/runs/${result.runId}`);
        }
        router.refresh();
      } catch {
        setError("Tracker could not be saved. Please check the details and retry.");
      }
    });
  }

  function setList(key: "keywords" | "intentKeywords" | "negativeKeywords" | "communities" | "websites" | "queries", value: string) {
    setValues((current) => ({ ...current, [key]: value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) }));
  }

  function toggleSource(source: string) {
    setValues((current) => ({ ...current, sources: current.sources.includes(source) ? current.sources.filter((item) => item !== source) : [...current.sources, source] }));
  }

  return <form onSubmit={submit} className="space-y-6">
    {mode === "create" && <div className="flex items-start gap-3 rounded-xl border border-indigo-300/15 bg-indigo-300/[.04] p-4"><Activity className="mt-0.5 size-4 shrink-0 text-indigo-200" /><p className="text-sm leading-6 text-slate-300">Set your own keywords and sources. Creating this tracker immediately starts a real collection run; the next screen shows provider activity and results live.</p></div>}
    <FormField label="Primary keyword"><Input required minLength={2} maxLength={180} value={values.keyword} onChange={(event) => setValues({ ...values, keyword: event.target.value })} placeholder="e.g. customer support software" /></FormField>
    <ListField label="Product keywords · required" value={values.keywords} onChange={(value) => setList("keywords", value)} placeholder="One keyword or phrase per line" />
    <ListField label="Buying-intent phrases" value={values.intentKeywords} onChange={(value) => setList("intentKeywords", value)} placeholder={'e.g. looking for an alternative\nneed recommendations'} />
    <ListField label="Exclude phrases" value={values.negativeKeywords} onChange={(value) => setList("negativeKeywords", value)} placeholder="One phrase per line" />
    <ListField label="Reddit communities" value={values.communities} onChange={(value) => setList("communities", value)} placeholder={'r/SaaS\nr/startups'} help="Enter subreddit names (r/ prefix is optional)." />
    <div className="space-y-3"><div><p className="text-sm font-medium">Discovery providers</p><p className="mt-1 text-xs text-slate-500">Only configured and selected providers will be contacted.</p></div><div className="grid gap-2 sm:grid-cols-2">{providers.map((provider) => {
      const checked = values.sources.includes(provider.id);
      return <label key={provider.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? "border-indigo-400/40 bg-indigo-400/[.06]" : "border-white/10 bg-slate-950/30"}`}><input type="checkbox" name="sources" value={provider.id} checked={checked} onChange={() => toggleSource(provider.id)} className="mt-1 accent-indigo-400" /><span><span className="block text-sm font-medium">{provider.label}</span><span className="mt-1 block text-xs text-slate-500">{provider.note}</span></span></label>;
    })}</div></div>
    <ListField label="Public websites or RSS feed URLs" value={values.websites} onChange={(value) => setList("websites", value)} placeholder="https://example.com/feed.xml" help="Use HTTPS URLs. Websites require Website scraping; feed URLs require RSS feeds." />
    <ListField label="Search queries" value={values.queries} onChange={(value) => setList("queries", value)} placeholder="Optional extra search query per line" />
    <FormField label="Alert threshold (%)"><Input type="number" min={0} max={100} value={values.alertThreshold} onChange={(event) => setValues({ ...values, alertThreshold: Number(event.target.value) })} /></FormField>
    {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200">{error}</p>}
    <div className="flex justify-end border-t border-white/10 pt-5"><Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? <><Check className="mr-2 size-4" />Save tracker</> : <>Create and run tracker <Play className="ml-2 size-4" /></>}</Button></div>
  </form>;
}

function ListField({ label, value, onChange, placeholder, help }: { label: string; value: string[]; onChange: (value: string) => void; placeholder: string; help?: string }) {
  return <FormField label={label}>
    <textarea value={value.join("\n")} onChange={(event) => onChange(event.target.value)} rows={Math.min(Math.max(value.length, 2), 5)} placeholder={placeholder} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none" />
    {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
  </FormField>;
}