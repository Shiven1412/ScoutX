import type { Metadata } from "next";
import { PasswordForm } from "@/components/auth/password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <PasswordForm mode="forgot" />;
}
