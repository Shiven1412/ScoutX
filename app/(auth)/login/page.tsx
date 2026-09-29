import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const params = await searchParams;
  const notice = params.error === "verification" ? "That verification link is invalid or expired. Request a new link or try signing in." : params.error === "admin-setup" ? "Your account is verified, but initial platform-admin access could not be assigned. Contact the configured administrator." : params.notice === "verify-email" ? "Your email must be verified before you can create a workspace." : params.notice;
  return <AuthForm mode="login" next={params.next} notice={notice} />;
}
