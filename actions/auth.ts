"use server";

import { redirect } from "next/navigation";
import { getPublicEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, passwordSchema, signInSchema, signUpSchema } from "@/lib/validation/auth";

export type ActionResult = { error?: string; success?: string };

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const candidate = error as Error & { code?: unknown; status?: unknown; cause?: { code?: unknown; name?: unknown } };
  return {
    name: error.name,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    causeCode: typeof candidate.cause?.code === "string" ? candidate.cause.code : undefined,
  };
}

function signupProviderMessage(code: string | undefined) {
  switch (code) {
    case "signup_disabled": return "New account registration is disabled in Supabase Auth. Enable Email signups in Supabase Authentication settings.";
    case "over_email_send_rate_limit": return "Supabase is temporarily limiting verification emails. Wait a few minutes, then try again.";
    case "email_address_invalid": return "Supabase rejected this email address. Check it and try again.";
    case "weak_password": return "Supabase requires a stronger password. Use at least 12 characters with a mix of letters, numbers, and symbols.";
    case "user_already_exists":
    case "email_exists": return "Unable to create this account. Try signing in or resetting the password.";
    default: return "Supabase Auth could not create this account. Check the Auth logs and email provider configuration.";
  }
}

function isLocalCertificateTrustError(error: unknown) {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === "SELF_SIGNED_CERT_IN_CHAIN" || candidate?.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN" || candidate?.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
}

export async function signInWithPassword(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid email and password." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { error: "Email or password is incorrect. If this account is new, verify the email address first." };
  } catch {
    return { error: "Authentication is not configured. Contact the workspace administrator." };
  }
  redirect(safeRedirectPath(next));
}

export async function signUpWithPassword(input: unknown): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the registration details." };
  try {
    const supabase = await createClient();
    const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${appUrl}/auth/callback?next=%2Fonboarding`,
        data: { full_name: parsed.data.fullName, company: parsed.data.company, industry: parsed.data.industry ?? "" },
      },
    });
    if (error) {
      console.error("Supabase signup rejected", { ...safeErrorDetails(error), providerCode: error.code });
      return { error: signupProviderMessage(error.code) };
    }
  } catch (error) {
    console.error("Supabase signup request failed", safeErrorDetails(error));
    if (isLocalCertificateTrustError(error)) return { error: "This server cannot verify Supabase’s HTTPS certificate. Trust your organization’s root CA in Windows/Node and restart the dev server; do not disable TLS verification." };
    return { error: "ScoutX could not reach Supabase Auth. Verify the Supabase URL, network connection, and server certificate trust, then try again." };
  }
  return { success: "Check your inbox to verify your email address and continue." };
}

export async function signInWithGoogle(): Promise<ActionResult> {
  let oauthUrl: string;
  try {
    const supabase = await createClient();
    const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appUrl}/auth/callback?next=%2Fonboarding`, queryParams: { access_type: "offline", prompt: "consent" } },
    });
    if (error || !data.url) return { error: "Google sign-in is unavailable right now." };
    oauthUrl = data.url;
  } catch {
    return { error: "Google sign-in is not configured." };
  }
  redirect(oauthUrl);
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid email address." };
  try {
    const supabase = await createClient();
    const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${appUrl}/auth/callback?next=%2Freset-password` });
    if (error) return { error: "Unable to send the reset email. Please try again later." };
  } catch {
    return { error: "Password reset is not configured. Contact the workspace administrator." };
  }
  return { success: "If an account exists for that address, a password reset link has been sent." };
}

export async function updatePassword(input: unknown): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { error: "Password must be at least 12 characters." };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Your reset session is invalid or expired. Request a new reset link." };
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return { error: "Unable to update password. Request a new reset link." };
  } catch {
    return { error: "Password reset is not configured." };
  }
  redirect("/dashboard?password-updated=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
