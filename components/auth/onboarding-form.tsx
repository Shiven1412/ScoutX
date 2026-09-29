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
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof organizationSchema>>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { name: suggestedName, industry, keywords: "" },
  });

  return <form className="mt-8 space-y-5" onSubmit={form.handleSubmit((values) => {
    setError(undefined);
    startTransition(async () => {
      const result = await createWorkspace(values);
      if (result?.error) setError(result.error);
    });
  })}>
    <FormField label="Workspace name" error={form.formState.errors.name?.message}><Input autoComplete="organization" {...form.register("name")} /></FormField>
    <FormField label="Industry (optional)" error={form.formState.errors.industry?.message}><Input {...form.register("industry")} /></FormField>
    <FormField label="Keywords to monitor (comma separated)" error={form.formState.errors.keywords?.message}><Input placeholder="e.g. buyer intent, sales automation" {...form.register("keywords")} /></FormField>
    {error && <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
    <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating workspace…" : "Create workspace"}</Button>
    <p className="text-xs leading-5 text-slate-500">Trackers are stored now. Signal collection requires authorized data-source integrations configured by your administrator.</p>
  </form>;
}
