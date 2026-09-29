"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { signInSchema, signUpSchema } from "@/lib/validation/auth";
import { signInWithGoogle, signInWithPassword, signUpWithPassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;
type AuthMode = "login" | "register";

export function AuthForm({ mode, next, notice, onRegistered }: { mode: AuthMode; next?: string; notice?: string; onRegistered?: () => void }) {
  const [message, setMessage] = useState<{ error?: string; success?: string } | undefined>(notice ? { success: notice } : undefined);
  const [pending, startTransition] = useTransition();
  const schema = mode === "login" ? signInSchema : signUpSchema;
  const form = useForm<SignInValues | SignUpValues>({ resolver: zodResolver(schema), defaultValues: mode === "login" ? { email: "", password: "" } : { fullName: "", email: "", password: "", company: "", industry: "" } });

  function submit(values: SignInValues | SignUpValues) {
    setMessage(undefined);
    startTransition(async () => {
      const result = mode === "login"
        ? await signInWithPassword(values, next)
        : await signUpWithPassword(values);
      if (result?.success && mode === "register") { onRegistered?.(); return; }
      if (result) setMessage(result);
    });
  }

  function google() {
    setMessage(undefined);
    startTransition(async () => {
      const result = await signInWithGoogle();
      if (result) setMessage(result);
    });
  }

  return <div className="w-full max-w-md">
    <Link href="/" className="mb-10 inline-flex items-center gap-3 text-lg font-bold tracking-tight text-white"><Image src="/logo-mark.svg" width={36} height={36} alt="" aria-hidden="true" /><span>ScoutX<span className="mt-0.5 block text-[10px] font-normal tracking-normal text-slate-400">Find buyers before your competitors do.</span></span></Link>
    <h1 className="text-3xl font-semibold tracking-tight text-white">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
    <p className="mt-2 text-sm leading-6 text-slate-400">{mode === "login" ? "Sign in to your workspace to continue." : "Set up your account. You can create your workspace after email verification."}</p>
    {message?.success ? <p role="status" className="mt-6 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message.success}</p> : null}
    {message?.error ? <p role="alert" className="mt-6 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{message.error}</p> : null}
    <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(submit)} noValidate>
      {mode === "register" && <>
        <FormField label="Full name" error={"fullName" in form.formState.errors ? form.formState.errors.fullName?.message : undefined}>
          <Input autoComplete="name" {...form.register("fullName" as never)} />
        </FormField>
        <FormField label="Company" error={"company" in form.formState.errors ? form.formState.errors.company?.message : undefined}>
          <Input autoComplete="organization" {...form.register("company" as never)} />
        </FormField>
        <FormField label="Industry (optional)">
          <Input autoComplete="organization-title" {...form.register("industry" as never)} />
        </FormField>
      </>}
      <FormField label="Work email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField label="Password" error={form.formState.errors.password?.message}>
        <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} {...form.register("password")} />
      </FormField>
      {mode === "login" && <div className="-mt-2 text-right"><Link href="/forgot-password" className="text-xs text-violet-300 hover:text-violet-200">Forgot password?</Link></div>}
      <Button className="w-full" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Button>
    </form>
    <div className="my-6 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-white/10" />or continue with<span className="h-px flex-1 bg-white/10" /></div>
    <Button variant="secondary" className="w-full" onClick={google} disabled={pending}>Continue with Google</Button>
    <p className="mt-7 text-center text-sm text-slate-400">{mode === "login" ? "New to ScoutX?" : "Already have an account?"}{" "}<Link href={mode === "login" ? "/register" : "/login"} className="font-medium text-violet-300 hover:text-violet-200">{mode === "login" ? "Create an account" : "Sign in"}</Link></p>
    <p className="mt-8 text-center text-xs leading-5 text-slate-500">By continuing, you agree to ScoutX’s terms and privacy policy.</p>
  </div>;
}
