"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createWorkspace } from "@/actions/onboarding";
import { organizationSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function OnboardingForm({ suggestedName, industry }: { suggestedName: string; industry: string }) {
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof organizationSchema>>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { name: suggestedName, industry, keywords: "", businessDescription: "" },
  });

  return <form className="mt-8 space-y-5" onSubmit={form.handleSubmit((values) => {
    if (!manual && (values.businessDescription?.trim().length ?? 0) < 20) {
      setError("Describe your product, customers, and value in at least 20 characters.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await createWorkspace(values);
      if (result?.error) setError(result.error);
    });
  })}>
    <FormField label="Workspace name" error={form.formState.errors.name?.message}><Input autoComplete="organization" {...form.register("name")} /></FormField>
    <FormField label="Industry (optional)" error={form.formState.errors.industry?.message}><Input {...form.register("industry")} /></FormField>
    {!manual ? <>
      <FormField label="What do you sell?" error={form.formState.errors.businessDescription?.message}><textarea rows={5} maxLength={3000} placeholder="Describe your product, service, customers, and value proposition.&#10;&#10;For example: We provide mobile app development services for startups and small businesses." className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3 text-sm leading-6 text-white placeholder:text-slate-500 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20" {...form.register("businessDescription")} /></FormField>
      <p className="text-xs leading-5 text-slate-500">ScoutX will build an editable keyword, competitor, community, and buying-signal plan after your workspace is ready.</p>
      <button type="button" className="text-sm text-violet-300 hover:text-violet-200" onClick={() => { form.setValue("businessDescription", ""); setManual(true); }}>Set up with keywords manually instead</button>
    </> : <>
      <FormField label="Keywords to monitor (comma separated)" error={form.formState.errors.keywords?.message}><Input placeholder="e.g. buyer intent, sales automation" {...form.register("keywords")} /></FormField>
      <button type="button" className="text-sm text-violet-300 hover:text-violet-200" onClick={() => setManual(false)}>← Use AI-powered setup</button>
    </>}
    {error && <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating workspace…" : manual ? "Create workspace" : "Create workspace and tracker"}</Button>
    <p className="text-xs leading-5 text-slate-500">Trackers are stored now. Signal collection requires authorized data-source integrations configured by your administrator.</p>
  </form>;
}
