import type { Metadata } from "next";
import { PasswordForm } from "@/components/auth/password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <PasswordForm mode="reset" notice={params.error === "verification" ? "That password reset link is invalid or expired. Request another reset link." : undefined} />;
}
