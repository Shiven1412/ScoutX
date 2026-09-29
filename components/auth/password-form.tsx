"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { emailSchema, passwordSchema } from "@/lib/validation/auth";
import { requestPasswordReset, updatePassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

export function PasswordForm({ mode, notice }: { mode: "forgot" | "reset"; notice?: string }) {
  const [message, setMessage] = useState<{ error?: string; success?: string } | undefined>(notice ? { error: notice } : undefined);
  const [pending, startTransition] = useTransition();
  const schema = mode === "forgot" ? emailSchema : passwordSchema;
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: mode === "forgot" ? { email: "" } : { password: "" } });

  function submit(values: z.infer<typeof schema>) {
    setMessage(undefined);
    startTransition(async () => {
      const result = mode === "forgot" ? await requestPasswordReset(values) : await updatePassword(values);
      if (result) setMessage(result);
    });
  }

  return <div className="w-full max-w-md">
    <Link href="/" className="mb-10 inline-flex items-center gap-3 text-lg font-bold text-white"><Image src="/logo-mark.svg" width={36} height={36} alt="" aria-hidden="true" /><span>ScoutX<span className="mt-0.5 block text-[10px] font-normal text-slate-400">Find buyers before your competitors do.</span></span></Link>
    <h1 className="text-3xl font-semibold text-white">{mode === "forgot" ? "Reset your password" : "Choose a new password"}</h1>
    <p className="mt-2 text-sm leading-6 text-slate-400">{mode === "forgot" ? "We’ll email a secure password reset link if the address is registered." : "Use at least 12 characters for your new password."}</p>
    {message?.success && <p role="status" className="mt-6 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message.success}</p>}
    {message?.error && <p role="alert" className="mt-6 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{message.error}</p>}
    <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(submit)} noValidate>
      {mode === "forgot" ? <FormField label="Work email" error={"email" in form.formState.errors ? form.formState.errors.email?.message : undefined}><Input type="email" autoComplete="email" {...form.register("email" as never)} /></FormField>
        : <FormField label="New password" error={"password" in form.formState.errors ? form.formState.errors.password?.message : undefined}><Input type="password" autoComplete="new-password" {...form.register("password" as never)} /></FormField>}
      <Button className="w-full" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "forgot" ? "Send reset link" : "Update password"}</Button>
    </form>
    <p className="mt-7 text-center text-sm"><Link href="/login" className="text-violet-300 hover:text-violet-200">Back to sign in</Link></p>
  </div>;
}
