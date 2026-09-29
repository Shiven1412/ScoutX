"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { ArrowLeft, ArrowRight, Check, Code2, Compass, Globe2, MessageCircle, Rss, Search, Sparkles, Users, Wrench } from "lucide-react";
import { createAiTracker, generateTrackerProfile } from "@/actions/trackers";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";
import { discoverySourcesSchema, generatedBusinessProfileSchema, type GeneratedBusinessProfile } from "@/lib/validation/tracker-profile";

type SourceId = (typeof discoverySourcesSchema._output)[number];
type SourceOption = { id: SourceId; label: string; description: string; mode: "Direct API" | "Public web search" | "Website crawl" | "Direct feed fetch"; icon: typeof MessageCircle };
const sourceOptions: SourceOption[] = [
  { id: "reddit", label: "Reddit", description: "Subreddits, posts, and public discussions", mode: "Direct API", icon: MessageCircle },
  { id: "x", label: "X", description: "Publicly indexed posts and conversations", mode: "Public web search", icon: Globe2 },
  { id: "linkedin", label: "LinkedIn", description: "Publicly indexed professional discussions", mode: "Public web search", icon: Users },
  { id: "hackernews", label: "Hacker News", description: "Ask HN, Show HN, and startup discussions", mode: "Direct API", icon: Code2 },
  { id: "indiehackers", label: "Indie Hackers", description: "Founder stories and product discussions", mode: "Public web search", icon: Compass },
  { id: "producthunt", label: "Product Hunt", description: "Launch pages and indexed product feedback", mode: "Public web search", icon: Sparkles },
  { id: "quora", label: "Quora", description: "Public questions and recommendations", mode: "Public web search", icon: MessageCircle },
  { id: "techforums", label: "Tech forums", description: "Publicly indexed technology communities", mode: "Public web search", icon: Wrench },
  { id: "github", label: "GitHub Discussions", description: "Public discussions indexed by search", mode: "Public web search", icon: Code2 },
  { id: "websites", label: "Custom websites", description: "AI-suggested public websites and feeds", mode: "Website crawl", icon: Globe2 },
  { id: "rss", label: "RSS feeds", description: "Add public RSS/Atom URLs in the review step", mode: "Direct feed fetch", icon: Rss },
];
const stepTitles = ["Describe", "Sources", "Review"];
const emptyGenerated = "Unable to generate discovery plan. Check provider configuration and try again.";

export function TrackerWizard({ initialDescription = "" }: { initialDescription?: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState(initialDescription);
  const [profile, setProfile] = useState<GeneratedBusinessProfile>();
  const [selectedSources, setSelectedSources] = useState<SourceId[]>(["reddit"]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function generatePlan() {
    setError("");
    posthog.capture("tracker_generation_started");
    const form = new FormData();
    form.set("businessDescription", description.trim());
    startTransition(async () => {
      try {
        const result: unknown = await generateTrackerProfile(form);
        if (!result || typeof result !== "object") throw new Error("invalid response");
        if ("error" in result) throw new Error(typeof result.error === "string" ? result.error : emptyGenerated);
        const parsed = generatedBusinessProfileSchema.safeParse("profile" in result ? result.profile : undefined);
        if (!parsed.success) throw new Error(emptyGenerated);
        setProfile(parsed.data);
        posthog.capture("tracker_generation_completed", { keyword_count: parsed.data.keywords.length, community_count: parsed.data.communities.length });
        setStep(1);
      } catch (cause) {
        setError(cause instanceof Error && cause.message !== "invalid response" ? cause.message : emptyGenerated);
      }
    });
  }

  function createTracker() {
    if (!profile) return;
    if (selectedSources.includes("rss") && !profile.websites.some(isFeedUrl)) {
      setError("RSS is selected, but the AI plan has no feed URL. Add at least one public RSS or Atom URL below, or remove RSS from selected sources.");
      return;
    }
    const parsedSources = discoverySourcesSchema.safeParse(selectedSources);
    if (!parsedSources.success) { setError("Select at least one source to monitor."); setStep(1); return; }
    setError("");
    const form = new FormData();
    form.set("businessDescription", description.trim());
    form.set("profile", JSON.stringify(profile));
    form.set("sources", JSON.stringify(parsedSources.data));
    startTransition(async () => {
      try {
        const result = await createAiTracker(form);
        if (result.error) { setError(result.error); return; }
        if (!result.success || !result.trackerId || !result.runId) { setError("Tracker creation failed. Please check your configuration and retry."); return; }
        posthog.capture("tracker_created", { source_count: parsedSources.data.length, keyword_count: result.counts?.keywords ?? 0 });
        router.push(`/campaigns/${result.trackerId}/runs/${result.runId}`);
      } catch {
        setError("Tracker creation failed. Please check your configuration and retry.");
      }
    });
  }

  const visibleSources = sourceOptions.filter((option) => `${option.label} ${option.description}`.toLowerCase().includes(sourceSearch.toLowerCase()));
  const hints = inferCategories(description);

  return <div className="space-y-7">
    <ol aria-label="Tracker creation steps" className="grid grid-cols-3 gap-2">{stepTitles.map((title, index) => <li key={title}><div className={`h-1 rounded-full ${index <= step ? "bg-indigo-400" : "bg-white/10"}`} /><p className={`mt-2 text-xs ${index === step ? "text-indigo-200" : "text-slate-500"}`}>{String(index + 1).padStart(2, "0")} · {title}</p></li>)}</ol>

    {step === 0 && <section className="space-y-5" aria-labelledby="business-step-title">
      <div><p className="text-xs font-medium uppercase tracking-[.18em] text-indigo-300">Step 1 of 3</p><h2 id="business-step-title" className="mt-2 text-xl font-semibold">Tell us what you sell</h2><p className="mt-1 text-sm text-slate-400">Describe your product and who it helps. ScoutX will turn that into an editable discovery strategy.</p></div>
      <div><label htmlFor="business-description" className="mb-2 block text-sm font-medium">What do you sell?</label><textarea id="business-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} maxLength={3000} rows={7} required placeholder="We build an AI chatbot that helps growing support teams answer customer questions and qualify sales leads…" className="w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-4 py-4 text-sm leading-6 text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/20" /><div className="mt-2 flex justify-between gap-3 text-xs text-slate-500"><span>Include your audience, the problem, and alternatives they use today.</span><span>{description.length}/3000</span></div></div>
      <div className="rounded-xl border border-indigo-300/15 bg-indigo-300/[.04] p-4"><p className="flex items-center gap-2 text-sm font-medium text-indigo-200"><Sparkles className="size-4" />Suggested categories</p><div className="mt-3 flex flex-wrap gap-2">{hints.map((hint) => <span key={hint} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300"><Check className="size-3 text-emerald-300" />{hint}</span>)}</div><p className="mt-3 text-xs text-slate-500">Suggestions are inferred from your description and are not saved as market facts.</p></div>
      {error && <ErrorMessage message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Your strategy is reviewed before anything is saved.</p><Button type="button" disabled={pending || description.trim().length < 20} onClick={generatePlan}>{pending ? <><Spinner /> ScoutX is building your plan…</> : <>Continue with AI <ArrowRight className="ml-2 size-4" /></>}</Button></div>
    </section>}

    {step === 1 && <section className="space-y-5" aria-labelledby="source-step-title">
      <div><p className="text-xs font-medium uppercase tracking-[.18em] text-indigo-300">Step 2 of 3</p><h2 id="source-step-title" className="mt-2 text-xl font-semibold">Choose your discovery sources</h2><p className="mt-1 text-sm text-slate-400">Select where ScoutX should look for public buyer conversations. Coverage method is shown for each source.</p></div>
      <label className="relative block"><Search className="absolute left-3 top-3 size-4 text-slate-500" /><input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Search sources" className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></label>
      <div className="grid gap-2 sm:grid-cols-2">{visibleSources.map(({ id, label, description: sourceDescription, mode, icon: Icon }) => {
        const checked = selectedSources.includes(id);
        return <button key={id} type="button" aria-pressed={checked} onClick={() => setSelectedSources((current) => checked ? current.filter((item) => item !== id) : [...current, id])} className={`flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition ${checked ? "border-indigo-400/50 bg-indigo-400/[.08]" : "border-white/10 bg-slate-950/40 hover:border-white/20"}`}><span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${checked ? "bg-indigo-400/15 text-indigo-200" : "bg-white/[.04] text-slate-400"}`}><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{label}</span><span className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-indigo-300 bg-indigo-400 text-slate-950" : "border-white/20"}`}>{checked && <Check className="size-3" />}</span></span><span className="mt-1 block text-xs leading-5 text-slate-400">{sourceDescription}</span><span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-500">{mode}</span></span></button>;
      })}</div>
      <p className="rounded-lg border border-amber-300/10 bg-amber-300/[.03] p-3 text-xs leading-5 text-slate-400">Reddit uses its authorized API. Other public channels currently use search-index discovery; websites and feed URLs use the configured crawl provider. Direct X and LinkedIn APIs are not connected by this workspace.</p>
      {error && <ErrorMessage message={error} />}
      <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="secondary" disabled={pending} onClick={() => setStep(0)}><ArrowLeft className="mr-2 size-4" />Back</Button><Button type="button" disabled={pending || selectedSources.length === 0} onClick={() => { setError(""); setStep(2); }}>Review discovery plan <ArrowRight className="ml-2 size-4" /></Button></div>
    </section>}

    {step === 2 && profile && <section className="space-y-5" aria-labelledby="review-step-title">
      <div><p className="text-xs font-medium uppercase tracking-[.18em] text-indigo-300">Step 3 of 3</p><h2 id="review-step-title" className="mt-2 text-xl font-semibold">Review your AI discovery plan</h2><p className="mt-1 text-sm text-slate-400">Edit any suggestion. ScoutX starts the selected providers after you create the tracker.</p></div>
      <div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Keywords" count={profile.keywords.length + profile.intentKeywords.length} /><SummaryCard label="Communities" count={profile.subreddits.length + profile.communities.length} /><SummaryCard label="Sources" count={selectedSources.length} /></div>
      <FormField label="Business summary"><textarea value={profile.businessSummary} onChange={(event) => setProfile({ ...profile, businessSummary: event.target.value })} rows={3} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none" /></FormField>
      <FormField label="Industry"><Input value={profile.industry} onChange={(event) => setProfile({ ...profile, industry: event.target.value })} /></FormField>
      <EditableList label="Keywords" value={profile.keywords} onChange={(keywords) => setProfile({ ...profile, keywords })} />
      <EditableList label="Buying-intent phrases" value={profile.intentKeywords} onChange={(intentKeywords) => setProfile({ ...profile, intentKeywords })} />
      <EditableList label="Buying signals" value={profile.buyingSignals} onChange={(buyingSignals) => setProfile({ ...profile, buyingSignals })} />
      <EditableList label="Competitors / alternatives" value={profile.competitors} onChange={(competitors) => setProfile({ ...profile, competitors })} />
      <EditableList label="Communities" value={profile.subreddits} onChange={(subreddits) => setProfile({ ...profile, subreddits })} />
      <EditableList label="Community names and forums" value={profile.communities} onChange={(communities) => setProfile({ ...profile, communities })} />
      <EditableList label="Custom websites / RSS feed URLs" value={profile.websites} onChange={(websites) => setProfile({ ...profile, websites })} />
      {selectedSources.includes("rss") && <p className="-mt-3 text-xs leading-5 text-slate-500">RSS is selected. Add at least one public feed URL ending in .rss, .xml, .atom, or a /feed path. ScoutX validates and fetches each feed over HTTPS.</p>}
      <EditableList label="Target personas" value={profile.targetAudience} onChange={(targetAudience) => setProfile({ ...profile, targetAudience })} />
      <EditableList label="Pain points" value={profile.painPoints} onChange={(painPoints) => setProfile({ ...profile, painPoints })} />
      <EditableList label="Search queries" value={profile.searchQueries} onChange={(searchQueries) => setProfile({ ...profile, searchQueries })} />
      <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Selected sources</p><div className="mt-3 flex flex-wrap gap-2">{selectedSources.map((id) => <span key={id} className="rounded-full border border-indigo-300/15 bg-indigo-300/[.05] px-3 py-1 text-xs text-indigo-100">{sourceOptions.find((item) => item.id === id)?.label ?? id}</span>)}</div></div>
      {error && <ErrorMessage message={error} />}
      <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5"><Button type="button" variant="secondary" disabled={pending} onClick={() => setStep(1)}><ArrowLeft className="mr-2 size-4" />Back to sources</Button><Button type="button" disabled={pending} onClick={createTracker}>{pending ? <><Spinner /> Creating tracker…</> : <>Create tracker <ArrowRight className="ml-2 size-4" /></>}</Button></div>
    </section>}
  </div>;
}

function inferCategories(description: string) {
  const text = description.toLowerCase();
  const hints = new Set<string>(["B2B software"]);
  if (/support|chatbot|helpdesk|customer service/.test(text)) { hints.add("Customer support"); hints.add("AI tools"); }
  if (/startup|founder|saas/.test(text)) hints.add("SaaS & startups");
  if (/sales|revenue|lead|crm/.test(text)) hints.add("Sales technology");
  if (/project|task|workflow|team/.test(text)) hints.add("Productivity");
  return [...hints].slice(0, 4);
}

function isFeedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (/\.(rss|xml|atom)$/i.test(url.pathname) || /\/(feed|rss|atom)(\/|$)/i.test(url.pathname));
  } catch {
    return false;
  }
}

function EditableList({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  return <FormField label={`${label} · one per line`}><textarea value={items.join("\n")} onChange={(event) => onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} rows={Math.min(Math.max(items.length, 2), 5)} placeholder="Add one item per line" className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none" /></FormField>;
}

function SummaryCard({ label, count }: { label: string; count: number }) {
  return <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{count}</p></div>;
}

function ErrorMessage({ message }: { message: string }) {
  return <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200">{message}</p>;
}

function Spinner() {
  return <span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
