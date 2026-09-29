import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "@/components/auth/onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const { supabase, user } = await requireUser();
  const { data: membership, error } = await supabase.from("organization_members").select("id").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
  if (error) throw new Error("Unable to verify your workspace membership.");
  if (membership) redirect("/dashboard");
  const fullName = typeof user.user_metadata.full_name === "string" ? user.user_metadata.full_name : "";
  const company = typeof user.user_metadata.company === "string" ? user.user_metadata.company : "";
  const industry = typeof user.user_metadata.industry === "string" ? user.user_metadata.industry : "";
  return <main className="mx-auto grid min-h-screen max-w-3xl place-items-center px-6 py-12"><section className="w-full rounded-2xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl sm:p-10"><p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-300">Workspace setup</p><h1 className="mt-3 text-3xl font-semibold">Create your first workspace</h1><p className="mt-2 text-sm leading-6 text-slate-400">This organization belongs to your verified account. Invite teammates and connect authorized sources after setup.</p><OnboardingForm suggestedName={company || (fullName ? `${fullName}'s workspace` : "My workspace")} industry={industry} /></section></main>;
}
