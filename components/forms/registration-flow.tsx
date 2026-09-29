"use client";

import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export function RegistrationFlow() {
  const [verified, setVerified] = useState(false);
  if (verified) return <div className="space-y-4"><div className="size-11 rounded-full bg-emerald-400/10 p-3 text-emerald-300">✓</div><h1 className="text-2xl font-semibold text-white">Check your inbox</h1><p className="text-sm leading-6 text-slate-400">Confirm your email using the link we sent. You’ll be returned here to sign in and create your workspace.</p></div>;
  return <AuthForm mode="register" onRegistered={() => setVerified(true)} />;
}
